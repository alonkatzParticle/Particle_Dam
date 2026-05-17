import { useEffect, useRef, useState } from 'react'
import { X, ExternalLink, Film, Image, FileText, Files } from 'lucide-react'
import { cn } from '../lib/utils'
import { useApiBase } from '../lib/ApiContext'

const VIDEO_EXTS = new Set(['mp4','mov','avi','mkv','mxf','webm','m4v'])
const IMAGE_EXTS = new Set(['jpg','jpeg','png','webp','tiff','tif','bmp','gif','heic'])

function extIcon(ext) {
  const e = (ext || '').toLowerCase()
  if (VIDEO_EXTS.has(e)) return <Film size={12} />
  if (IMAGE_EXTS.has(e)) return <Image size={12} />
  return <FileText size={12} />
}

function FileThumbnail({ asset, onClick, apiBase }) {
  const [url, setUrl]     = useState(null)
  const [failed, setFailed] = useState(false)
  const imgRef            = useRef(null)

  useEffect(() => {
    const thumbUrl = `${apiBase}/assets/${asset.id}/thumbnail`
    const img = new window.Image()
    img.src = thumbUrl
    img.onload  = () => setUrl(thumbUrl)
    img.onerror = () => setFailed(true)
    return () => { img.onload = null; img.onerror = null }
  }, [asset.id, apiBase])

  return (
    <button
      onClick={() => onClick(asset)}
      className="group/file relative flex-shrink-0 w-36 rounded-lg border border-[var(--border)] bg-[var(--card)] overflow-hidden hover:border-[var(--primary)]/50 hover:shadow-md transition-all text-left"
    >
      {/* Thumbnail area */}
      <div className="relative bg-black/40 overflow-hidden" style={{ aspectRatio: '4/3' }}>
        {url ? (
          <img src={url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center opacity-40">
            {extIcon(asset.extension)}
          </div>
        )}
        {/* Hover overlay */}
        <div className="absolute inset-0 bg-[var(--primary)]/10 opacity-0 group-hover/file:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-[10px] text-white font-medium bg-[var(--primary)]/80 px-2 py-0.5 rounded">
            Preview
          </span>
        </div>
      </div>

      {/* File name */}
      <div className="p-1.5">
        <p className="text-[10px] text-[var(--muted-foreground)] truncate leading-tight">
          {asset.name}
        </p>
        <p className="text-[9px] text-[var(--muted-foreground)]/50 uppercase mt-0.5">
          {asset.extension || '—'}
        </p>
      </div>
    </button>
  )
}

export function TaskExpandedView({ task, onClose, onSelectAsset }) {
  const apiBase  = useApiBase()
  const panelRef = useRef(null)

  // Escape key to close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!task) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />

      {/* Drawer panel */}
      <div
        ref={panelRef}
        className="fixed bottom-0 left-0 right-0 z-50 bg-[var(--background)] border-t border-[var(--border)] shadow-2xl rounded-t-2xl max-h-[60vh] flex flex-col animate-in slide-in-from-bottom duration-300"
      >
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-[var(--border)] shrink-0">
          <div className="space-y-1 min-w-0 flex-1 pr-4">
            <h2 className="text-base font-bold leading-tight truncate">
              {task.task_name || '(Unnamed task)'}
            </h2>
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-[var(--muted-foreground)]">
              {task.product  && <span className="font-medium text-[var(--primary)]">{task.product}</span>}
              {task.platform && <span>{task.platform}</span>}
              {task.campaign && <span>{task.campaign}</span>}
              {task.status   && <span className="opacity-70">{task.status}</span>}
              <span className="flex items-center gap-1 opacity-60">
                <Files size={10} />
                {task.asset_count} file{task.asset_count !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {task.frame_url && task.frame_url.includes('figma') && (
              <a
                href={task.frame_url}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 border border-pink-500/20 transition-colors"
              >
                <ExternalLink size={11} />
                Figma
              </a>
            )}
            {task.project_url && (
              <a
                href={task.project_url}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-colors"
              >
                <ExternalLink size={11} />
                Project
              </a>
            )}
            {task.monday_id && (
              <a
                href={`https://monday.com/boards/${task.board_id || '5433027071'}/pulses/${task.monday_id}`}
                target="_blank"
                rel="noreferrer"
                onClick={e => e.stopPropagation()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] border border-[var(--primary)]/20 transition-colors"
              >
                <ExternalLink size={11} />
                Monday
              </a>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* File grid */}
        <div className="flex-1 overflow-x-auto overflow-y-hidden px-6 py-4">
          <div className="flex gap-3 h-full">
            {task.assets.map(asset => (
              <FileThumbnail
                key={asset.id}
                asset={asset}
                apiBase={apiBase}
                onClick={onSelectAsset}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
