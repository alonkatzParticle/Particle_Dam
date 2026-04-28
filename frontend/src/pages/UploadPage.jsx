import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Upload, X, Sparkles, Check, FolderOpen, ChevronRight, AlertCircle, Loader } from 'lucide-react'
import { formatBytes, extGroup, EXT_ICON, cn } from '../lib/utils'
import { TagPill } from '../components/AssetCard'
import { useApiBase } from '../lib/ApiContext'

const MAX_FILE_SIZE = 500 * 1024 * 1024 // 500MB

function FileRow({ file, tags, allTags, onRemove, onUpdateTags, onSuggestTags }) {
  const [suggesting, setSuggesting] = useState(false)
  const [targetFolder, setTargetFolder] = useState(file.targetFolder || '')
  const group = extGroup(file.file.name.split('.').pop())

  const suggest = async () => {
    setSuggesting(true)
    const suggestions = await onSuggestTags(file)
    setSuggesting(false)
    if (suggestions.length) {
      onUpdateTags(file.id, suggestions)
      setTargetFolder(suggestions[0]?.path || '')
    }
  }

  const assignedTags = file.suggestedTags || []

  return (
    <div className={cn(
      'flex items-start gap-4 p-4 rounded-xl border transition-all',
      assignedTags.length ? 'border-[var(--primary)]/30 bg-[var(--primary)]/5' : 'border-[var(--border)] bg-[var(--card)]'
    )}>
      {/* Icon */}
      <div className="w-10 h-10 rounded-lg bg-black/30 flex items-center justify-center shrink-0 text-lg">
        {EXT_ICON[group] || '📎'}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium truncate">{file.file.name}</p>
          <button onClick={() => onRemove(file.id)} className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors shrink-0">
            <X size={14} />
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted-foreground)]">{formatBytes(file.file.size)}</p>

        {/* Folder selector */}
        <div className="flex items-center gap-2 flex-wrap">
          <FolderOpen size={12} className="text-[var(--muted-foreground)]" />
          <select
            value={targetFolder}
            onChange={e => { setTargetFolder(e.target.value); onUpdateTags(file.id, [], e.target.value) }}
            className="flex-1 bg-[var(--input)] border border-[var(--border)] rounded-lg text-xs px-2 py-1.5 text-[var(--foreground)] outline-none focus:border-[var(--primary)] transition-colors">
            <option value="">— Select folder —</option>
            {allTags.map(t => (
              <option key={t.id} value={t.path}>{t.path}</option>
            ))}
          </select>
        </div>

        {/* Suggested tags */}
        {assignedTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Sparkles size={11} className="text-[var(--primary)]" />
            <span className="text-[11px] text-[var(--primary)] font-medium">AI suggested:</span>
            {assignedTags.map(t => <TagPill key={t.id} tag={t} />)}
          </div>
        )}
      </div>

      {/* Suggest button */}
      <button
        onClick={suggest}
        disabled={suggesting}
        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)]/15 hover:bg-[var(--primary)]/25 text-[var(--primary)] text-xs font-medium transition-colors disabled:opacity-40">
        {suggesting
          ? <Loader size={12} className="animate-spin" />
          : <Sparkles size={12} />}
        {suggesting ? 'Thinking…' : 'Suggest'}
      </button>
    </div>
  )
}

export default function UploadPage() {
  const apiBase  = useApiBase()
  const navigate = useNavigate()
  const dropRef  = useRef(null)
  const inputRef = useRef(null)

  const [files, setFiles]         = useState([])       // { id, file, suggestedTags, targetFolder, status }
  const [tags, setTags]           = useState([])
  const [dragging, setDragging]   = useState(false)
  const [uploading, setUploading] = useState(false)
  const [results, setResults]     = useState(null)
  const [error, setError]         = useState(null)

  useEffect(() => {
    fetch(`${apiBase}/tags`).then(r => r.json()).then(setTags).catch(() => {})
  }, [])

  const addFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter(f => f.size <= MAX_FILE_SIZE)
    setFiles(prev => [
      ...prev,
      ...valid.map(f => ({
        id: `${f.name}-${Date.now()}-${Math.random()}`,
        file: f,
        suggestedTags: [],
        targetFolder: '',
        status: 'pending',
      }))
    ])
  }, [])

  // Drop zone handlers
  const onDrop = e => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }
  const onDragOver = e => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const removeFile = id => setFiles(prev => prev.filter(f => f.id !== id))

  const suggestTagsForFile = async (fileEntry) => {
    try {
      // Try to get thumbnail for vision
      let thumbnailBase64 = null
      const group = extGroup(fileEntry.file.name.split('.').pop())
      if (group === 'images') {
        const reader = new FileReader()
        thumbnailBase64 = await new Promise((resolve) => {
          reader.onload = e => resolve(e.target.result)
          reader.readAsDataURL(fileEntry.file.slice(0, 1024 * 1024)) // First 1MB
        })
      }

      const { suggestions } = await fetch(`${apiBase}/ai/suggest-tags`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: fileEntry.file.name,
          mimeType: fileEntry.file.type,
          thumbnailBase64,
        }),
      }).then(r => r.json())

      return suggestions || []
    } catch { return [] }
  }

  const updateFileTags = (id, suggested, folder) => {
    setFiles(prev => prev.map(f => {
      if (f.id !== id) return f
      return {
        ...f,
        suggestedTags: suggested !== undefined ? suggested : f.suggestedTags,
        targetFolder: folder !== undefined ? folder : (suggested?.[0]?.path || f.targetFolder),
      }
    }))
  }

  const suggestAll = async () => {
    for (const file of files) {
      const suggestions = await suggestTagsForFile(file)
      if (suggestions.length) updateFileTags(file.id, suggestions)
    }
  }

  const handleUpload = async () => {
    const toUpload = files.filter(f => f.targetFolder)
    if (!toUpload.length) {
      setError('Please select a target folder for at least one file')
      return
    }

    setUploading(true)
    setError(null)

    try {
      const formData = new FormData()
      // Group by folder for efficiency (upload per-folder)
      const byFolder = {}
      for (const f of toUpload) {
        const folder = f.targetFolder
        if (!byFolder[folder]) byFolder[folder] = []
        byFolder[folder].push(f)
      }

      const allResults = []
      for (const [folder, folderFiles] of Object.entries(byFolder)) {
        const fd = new FormData()
        fd.append('targetPath', folder)
        for (const f of folderFiles) fd.append('files', f.file)
        const res = await fetch(`${apiBase}/upload`, { method: 'POST', body: fd }).then(r => r.json())
        allResults.push(...(res.results || []))
      }

      setResults(allResults)
      setFiles([])
    } catch (err) {
      setError(err.message || 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const filesWithFolder = files.filter(f => f.targetFolder)

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-3xl mx-auto w-full">
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Upload Assets</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Drop files here and let AI suggest the right folder, or choose manually.
          </p>
        </div>

        {/* Success state */}
        {results && (
          <div className="rounded-xl border border-green-500/30 bg-green-500/8 p-5 fade-in">
            <div className="flex items-center gap-2 mb-3">
              <Check size={16} className="text-green-400" />
              <p className="text-sm font-medium text-green-400">{results.filter(r => r.success).length} file(s) uploaded successfully</p>
            </div>
            <div className="space-y-1">
              {results.map((r, i) => (
                <p key={i} className={cn('text-xs', r.success ? 'text-green-300' : 'text-red-400')}>
                  {r.name} — {r.success ? r.path : `Failed: ${r.error}`}
                </p>
              ))}
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => { setResults(null) }}
                className="px-4 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors">
                Upload More
              </button>
              <button
                onClick={() => navigate('/library')}
                className="px-4 py-1.5 rounded-lg bg-[var(--primary)] hover:opacity-90 text-white text-sm font-medium transition-opacity">
                View Library
              </button>
            </div>
          </div>
        )}

        {/* Drop zone */}
        {!results && (
          <>
            <div
              ref={dropRef}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => inputRef.current?.click()}
              className={cn(
                'rounded-xl border-2 border-dashed p-10 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all',
                dragging
                  ? 'drop-zone-active border-[var(--primary)]'
                  : 'border-[var(--border)] hover:border-[var(--primary)]/30 hover:bg-white/2'
              )}>
              <input ref={inputRef} type="file" multiple className="hidden" onChange={e => addFiles(e.target.files)} />
              <div className={cn('w-14 h-14 rounded-2xl flex items-center justify-center transition-colors', dragging ? 'bg-[var(--primary)]/20' : 'bg-white/5')}>
                <Upload size={24} className={dragging ? 'text-[var(--primary)]' : 'text-[var(--muted-foreground)]'} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">{dragging ? 'Drop to add files' : 'Drop files here or click to browse'}</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-1">
                  Images, videos, documents — up to 500MB per file
                </p>
              </div>
            </div>

            {/* File list */}
            {files.length > 0 && (
              <div className="space-y-3">
                {/* Batch actions */}
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">{files.length} file{files.length !== 1 ? 's' : ''} queued</p>
                  <div className="flex gap-2">
                    <button
                      onClick={suggestAll}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] text-xs font-medium transition-colors">
                      <Sparkles size={12} />
                      Suggest All
                    </button>
                    <button
                      onClick={() => setFiles([])}
                      className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs transition-colors text-[var(--muted-foreground)]">
                      Clear All
                    </button>
                  </div>
                </div>

                {files.map(f => (
                  <FileRow
                    key={f.id}
                    file={f}
                    tags={f.suggestedTags}
                    allTags={tags}
                    onRemove={removeFile}
                    onUpdateTags={updateFileTags}
                    onSuggestTags={suggestTagsForFile}
                  />
                ))}

                {/* Error */}
                {error && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
                    <AlertCircle size={14} />
                    {error}
                  </div>
                )}

                {/* Upload button */}
                <button
                  onClick={handleUpload}
                  disabled={uploading || filesWithFolder.length === 0}
                  className={cn(
                    'w-full py-3 rounded-xl font-semibold text-sm transition-all flex items-center justify-center gap-2',
                    filesWithFolder.length > 0
                      ? 'bg-[var(--primary)] hover:opacity-90 text-white glow-primary'
                      : 'bg-white/5 text-[var(--muted-foreground)]',
                    'disabled:opacity-40'
                  )}>
                  {uploading
                    ? <><Loader size={15} className="animate-spin" /> Uploading…</>
                    : <>
                        <Upload size={15} />
                        Upload {filesWithFolder.length > 0 ? `${filesWithFolder.length} file${filesWithFolder.length !== 1 ? 's' : ''}` : '(select folders first)'}
                      </>
                  }
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
