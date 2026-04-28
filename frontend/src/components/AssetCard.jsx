import { useState, useCallback, useEffect } from 'react'
import { formatBytes, formatDate, extGroup, EXT_ICON, cn } from '../lib/utils'
import { AI_TAG_MAP, AI_TAG_CATEGORIES, parseAiTags } from '../lib/aiTags'
import { Download, ExternalLink, Play, Image, FileText, Archive, Music, X, Sparkles, Loader } from 'lucide-react'
import { useApiBase } from '../lib/ApiContext'
import { wasThumbError, markThumbError } from '../lib/pageCache'

const GROUP_ICONS = { images: Image, videos: Play, audio: Music, documents: FileText, archives: Archive, other: FileText }

export function TagPill({ tag }) {
  return (
    <span
      className="tag-pill"
      style={{
        background: tag.color + '22',
        color: tag.color,
        borderColor: tag.color + '44',
      }}>
      {tag.name}
    </span>
  )
}

function AiTagPill({ tagId }) {
  const def = AI_TAG_MAP[tagId]
  if (!def) return null
  return (
    <span
      className="tag-pill"
      style={{
        background: def.color + '18',
        color: def.color,
        borderColor: def.color + '40',
      }}>
      <Sparkles size={9} strokeWidth={2.5} />
      {def.label}
    </span>
  )
}

function AssetPreviewModal({ asset, tags, onClose, onAiTagsUpdated }) {
  const apiBase = useApiBase()
  const [previewUrl, setPreviewUrl]     = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [copied, setCopied]             = useState(false)
  const [generating, setGenerating]     = useState(false)
  const [aiTagError, setAiTagError]     = useState(null)
  const [localAiTags, setLocalAiTags]   = useState(parseAiTags(asset.ai_tags))
  const [localActions, setLocalActions] = useState(() => {
    try { return JSON.parse(asset.ai_actions || '[]') } catch { return [] }
  })
  const [localDescription, setLocalDescription] = useState(asset.ai_description || '')

  const group = extGroup(asset.extension)
  const isMedia = group === 'images' || group === 'videos'
  const isVideo = group === 'videos'
  const isAds = apiBase !== '/api'

  // Auto-load preview on mount
  const loadPreview = useCallback(async () => {
    if (previewUrl || loadingPreview || !isMedia) return
    setLoadingPreview(true)
    try {
      const { url } = await fetch(`${apiBase}/assets/${asset.id}/preview`).then(r => r.json())
      setPreviewUrl(url)
    } catch { /* silently fail */ } finally {
      setLoadingPreview(false)
    }
  }, [asset.id, previewUrl, loadingPreview, isMedia, apiBase])

  useEffect(() => { loadPreview() }, [])

  const openInDropbox = async () => {
    try {
      const { url } = await fetch(`${apiBase}/assets/${asset.id}/share`).then(r => r.json())
      window.open(url, '_blank', 'noopener')
    } catch { }
  }

  const copyLink = async () => {
    try {
      const { url } = await fetch(`${apiBase}/assets/${asset.id}/share`).then(r => r.json())
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { setCopied(false) }
  }

  const downloadFile = async () => {
    try {
      if (isAds) {
        // Ad Library: use direct download endpoint with anchor
        const a = document.createElement('a')
        a.href = `${apiBase}/assets/${asset.id}/download`
        a.download = asset.name
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      } else {
        // Raw Files: use Dropbox dl=1 share link (avoids CORS/streaming issues)
        const { url } = await fetch(`${apiBase}/assets/${asset.id}/share`).then(r => r.json())
        let dlUrl = url.replace(/\bdl=0\b/, 'dl=1')
        if (!dlUrl.includes('dl=1')) {
          dlUrl += (dlUrl.includes('?') ? '&' : '?') + 'dl=1'
        }
        window.location.href = dlUrl
      }
    } catch (err) {
      console.error('Download failed:', err)
    }
  }

  const generateAiTags = async () => {
    setGenerating(true)
    setAiTagError(null)
    try {
      const res = await fetch(`${apiBase}/assets/${asset.id}/ai-tags/generate`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setLocalAiTags(data.tags || [])
      setLocalActions(data.actions || [])
      setLocalDescription(data.description || '')
      onAiTagsUpdated?.(asset.id, data)
    } catch (err) {
      setAiTagError(err.message)
    } finally {
      setGenerating(false)
    }
  }

  const assetTags = tags.filter(t => asset.tagIds?.includes(t.id))
  const canGenerateAiTags = isMedia // only images and videos have thumbnails

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-2xl bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-2xl fade-in overflow-hidden max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-[var(--border)] shrink-0">
          <div className="flex-1 min-w-0 pr-4">
            <p className="text-[10px] font-semibold text-[var(--muted-foreground)] uppercase tracking-widest mb-1">
              {asset.extension?.toUpperCase() || 'FILE'}
            </p>
            <h2 className="text-base font-semibold leading-snug truncate">{asset.name}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/5 text-[var(--muted-foreground)] hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 p-5 space-y-4">

          {/* Preview area */}
          {isMedia && (
            <div
              className="w-full rounded-lg bg-black/40 border border-[var(--border)] overflow-hidden flex items-center justify-center"
              style={{ minHeight: 200 }}>
              {previewUrl
                ? group === 'videos'
                  ? <video src={previewUrl} controls className="w-full max-h-80 object-contain" />
                  : <img src={previewUrl} alt={asset.name} className="max-h-80 object-contain mx-auto" />
                : <div className="flex flex-col items-center gap-2 p-8 text-[var(--muted-foreground)]">
                    <span className="text-3xl animate-pulse">{EXT_ICON[group]}</span>
                    <span className="text-xs">Loading preview…</span>
                  </div>
              }
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Size</p>
              <p className="text-sm">{formatBytes(asset.size)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Modified</p>
              <p className="text-sm">{formatDate(asset.modified_at)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Type</p>
              <p className="text-sm">{asset.extension?.toUpperCase() || '—'}</p>
            </div>
          </div>

          {/* Folder tags */}
          {assetTags.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-2">Folders</p>
              <div className="flex flex-wrap gap-1.5">
                {assetTags.map(t => <TagPill key={t.id} tag={t} />)}
              </div>
            </div>
          )}

          {/* AI Smart Tags */}
          <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={13} className="text-[var(--primary)]" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted-foreground)]">AI Smart Tags</p>
                {asset.ai_tagged_at && (
                  <span className="text-[10px] text-[var(--muted-foreground)] opacity-60">
                    · {new Date(asset.ai_tagged_at).toLocaleDateString()}
                  </span>
                )}
              </div>
              {canGenerateAiTags && (
                <button
                  onClick={generateAiTags}
                  disabled={generating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--primary)]/15 hover:bg-[var(--primary)]/25 text-[var(--primary)] text-xs font-semibold transition-colors disabled:opacity-40">
                  {generating
                    ? <><Loader size={11} className="animate-spin" />Analyzing…</>
                    : <><Sparkles size={11} />{localAiTags.length ? 'Re-tag' : 'Generate Tags'}</>
                  }
                </button>
              )}
            </div>

            {aiTagError && (
              <p className="text-xs text-red-400">{aiTagError}</p>
            )}

            {localAiTags.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1.5">Smart Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {localAiTags.map(id => <AiTagPill key={id} tagId={id} />)}
                </div>
              </div>
            )}

            {/* Action tags — free-form, teal */}
            {localActions.length > 0 && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1.5">Actions</p>
                <div className="flex flex-wrap gap-1.5">
                  {localActions.map((action, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                      style={{ background: 'rgba(20,184,166,0.12)', color: '#2dd4bf', border: '1px solid rgba(20,184,166,0.3)' }}>
                      {action}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Scene description */}
            {localDescription && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Scene</p>
                <p className="text-xs text-[var(--muted-foreground)] italic leading-relaxed">{localDescription}</p>
              </div>
            )}

            {!localAiTags.length && !localActions.length && !generating && (
              <p className="text-xs text-[var(--muted-foreground)]">
                {canGenerateAiTags
                  ? 'No AI tags yet — click Generate Tags to analyze this asset.'
                  : 'AI tagging is available for images and videos only.'}
              </p>
            )}
          </div>

          {/* Path */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Dropbox Path</p>
            <p className="text-xs text-[var(--muted-foreground)] font-mono break-all">{asset.path}</p>
          </div>
        </div>

        {/* Actions — all in one row */}
        <div className="flex gap-2 px-5 pb-5 shrink-0 border-t border-[var(--border)] pt-4">
          {asset.monday?.dropbox_url && (
            <a
              href={asset.monday.dropbox_url}
              target="_blank"
              rel="noreferrer"
              title="Open Dropbox folder"
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-sm font-medium transition-colors"
            >
              <ExternalLink size={13} />
              Dropbox
            </a>
          )}
          {asset.monday?.monday_id && (
            <a
              href={`https://monday.com/boards/${asset.monday.board_id || '5433027071'}/pulses/${asset.monday.monday_id}`}
              target="_blank"
              rel="noreferrer"
              title={asset.monday.name || 'Open Monday task'}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 text-sm font-medium transition-colors"
            >
              <ExternalLink size={13} />
              Monday
            </a>
          )}
          {asset.monday?.frame_url && (
            <a
              href={asset.monday.frame_url}
              target="_blank"
              rel="noreferrer"
              title={isVideo ? 'Open Frame.io' : 'Open Figma'}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/20 text-purple-400 text-sm font-medium transition-colors"
            >
              <ExternalLink size={13} />
              {isVideo ? 'Frame.io' : 'Figma'}
            </a>
          )}
          <div className="flex-1" />
          <button
            onClick={copyLink}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors">
            {copied ? '✓ Copied' : 'Copy Link'}
          </button>
          <button
            onClick={downloadFile}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-sm transition-colors">
            <Download size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export function AssetCard({ asset, tags, onClick, onMondayClick }) {
  const apiBase = useApiBase()
  const [thumbError, setThumbError] = useState(() => wasThumbError(`${apiBase}:${asset.id}`))
  const group = extGroup(asset.extension)
  const Icon = GROUP_ICONS[group] || FileText
  const canThumb = ['images', 'videos'].includes(group)
  const isVideo = group === 'videos'
  const aiTags = parseAiTags(asset.ai_tags)
  const hasMondayTask = !!asset.monday

  const assetTags = (asset.tagIds || [])
    .map(id => tags.find(t => t.id === id))
    .filter(Boolean)
    .slice(0, 2)

  return (
    <div
      className="asset-card group relative rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden cursor-pointer"
      onClick={() => onClick(asset)}>

      {/* Thumbnail / icon area */}
      <div className="relative w-full bg-black/30 flex items-center justify-center overflow-hidden" style={{ aspectRatio: '16/10' }}>
        {canThumb && !thumbError ? (
          <img
            src={`${apiBase}/assets/${asset.id}/thumbnail?v=2`}
            alt={asset.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
            onError={() => { markThumbError(`${apiBase}:${asset.id}`); setThumbError(true) }}
          />
        ) : (
          <Icon size={28} className="text-[var(--muted-foreground)] opacity-40" />
        )}

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-white text-xs font-medium">Open</span>
        </div>

        {/* Extension badge */}
        <span className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-[10px] font-mono text-white/70 px-1.5 py-0.5 rounded">
          {asset.extension?.toUpperCase() || '—'}
        </span>

        {/* Monday linked indicator */}
        {hasMondayTask && (
          <button
            onClick={e => { e.stopPropagation(); onMondayClick?.(asset) }}
            className="absolute bottom-2 left-2 bg-black/70 backdrop-blur-sm flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium hover:bg-[#4f46e5]/70 transition-colors"
            title={asset.monday?.name}
          >
            <span className={cn(
              'w-1.5 h-1.5 rounded-full shrink-0',
              asset.monday?.status?.toLowerCase() === 'done' ? 'bg-green-400' :
              asset.monday?.status?.toLowerCase() === 'stuck' ? 'bg-red-400' :
              ['working on it','in progress'].includes(asset.monday?.status?.toLowerCase()) ? 'bg-blue-400' :
              'bg-amber-400'
            )} />
            <span className="text-white/80 truncate max-w-[80px]">
              {asset.monday?.product || 'Monday'}
            </span>
          </button>
        )}
      </div>

      {/* Info */}
      <div className="p-3 space-y-1.5">
        <p className="text-[13px] font-medium leading-snug line-clamp-2 text-[var(--foreground)]">{asset.name}</p>
        <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
          <span>{formatBytes(asset.size)}</span>
          <span>{formatDate(asset.modified_at)}</span>
        </div>
        {assetTags.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-0.5">
            {assetTags.map(t => <TagPill key={t.id} tag={t} />)}
          </div>
        )}

        {/* Quick links — only shown when Monday task has URLs */}
        {asset.monday && (asset.monday.dropbox_url || asset.monday.frame_url || asset.monday.monday_id) && (
          <div className="flex items-center gap-1.5 pt-0.5" onClick={e => e.stopPropagation()}>
            {asset.monday.dropbox_url && (
              <a
                href={asset.monday.dropbox_url}
                target="_blank"
                rel="noreferrer"
                title="Open Dropbox folder"
                className="flex items-center justify-center w-6 h-6 rounded-md bg-white/5 hover:bg-blue-500/20 text-[var(--muted-foreground)] hover:text-blue-400 transition-colors"
              >
                <ExternalLink size={11} />
              </a>
            )}
            {asset.monday.monday_id && (
              <a
                href={`https://monday.com/boards/${asset.monday.board_id}/pulses/${asset.monday.monday_id}`}
                target="_blank"
                rel="noreferrer"
                title={asset.monday.name || 'Open Monday task'}
                className="flex items-center justify-center w-6 h-6 rounded-md bg-white/5 hover:bg-indigo-500/20 text-[var(--muted-foreground)] hover:text-indigo-400 transition-colors text-[9px] font-bold"
              >
                M
              </a>
            )}
            {asset.monday.frame_url && (
              <a
                href={asset.monday.frame_url}
                target="_blank"
                rel="noreferrer"
                title={isVideo ? 'Open Frame.io' : 'Open Figma'}
                className="flex items-center justify-center w-6 h-6 rounded-md bg-white/5 hover:bg-purple-500/20 text-[var(--muted-foreground)] hover:text-purple-400 transition-colors"
              >
                <ExternalLink size={11} />
              </a>
            )}
            {/* Status dot */}
            {asset.monday.status && (
              <span className="ml-auto text-[10px] text-[var(--muted-foreground)] truncate max-w-[80px]">
                {asset.monday.status}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export { AssetPreviewModal }
