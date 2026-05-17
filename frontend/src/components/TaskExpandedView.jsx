import { useEffect, useRef } from 'react'
import { X, ExternalLink, Film, Image, FileText, Files } from 'lucide-react'
import { cn } from '../lib/utils'
import { useApiBase } from '../lib/ApiContext'

const VIDEO_EXTS = new Set(['mp4','mov','avi','mkv','mxf','webm','m4v'])
const IMAGE_EXTS = new Set(['jpg','jpeg','png','webp','tiff','tif','bmp','gif','heic'])

function extIcon(ext) {
  const e = (ext || '').toLowerCase()
  if (VIDEO_EXTS.has(e)) return <Film size={11} />
  if (IMAGE_EXTS.has(e)) return <Image size={11} />
  return <FileText size={11} />
}

// Height exported so InlineAssetPreview can pad by the same amount
export const DRAWER_HEIGHT_PX = 208

function FileThumbnail({ asset, isActive, onClick, apiBase, onMeta }) {
  const thumbUrl = `${apiBase}/assets/${asset.id}/thumbnail`

  return (
    <button
      onClick={() => onClick(asset)}
      className={cn(
        'group/file relative flex-shrink-0 w-32 rounded-lg border overflow-hidden transition-all text-left',
        isActive
          ? 'border-[var(--primary)] ring-1 ring-[var(--primary)]/40 shadow-md shadow-[var(--primary)]/20'
          : 'border-[var(--border)] bg-[var(--card)] hover:border-[var(--primary)]/40'
      )}
    >
      {/* Thumbnail area */}
      <div className="relative bg-black/40 overflow-hidden" style={{ aspectRatio: '4/3' }}>
        <img
          src={thumbUrl}
          alt=""
          className="w-full h-full object-cover"
          onError={e => { e.target.style.display = 'none' }}
        />
        {/* Active indicator */}
        {isActive && (
          <div className="absolute inset-0 bg-[var(--primary)]/10 flex items-center justify-center">
            <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
          </div>
        )}
        {/* TODO: Meta badge — re-enable once Settings page pipeline is live */}
        {/* {onMeta && (
          <div className="absolute top-1 left-1">
            <span className="px-1 py-0.5 rounded text-[8px] font-bold tracking-wider bg-black/70 text-white/80 uppercase">Meta</span>
          </div>
        )} */}
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

export function TaskExpandedView({ task, activeAssetId, onSelectAsset, onClose, coverage }) {
  const apiBase = useApiBase()

  // Escape key to close
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (!task) return null

  return (
    <div
      className="fixed bottom-0 left-0 right-0 z-40 bg-[var(--background)] border-t border-[var(--border)] shadow-2xl"
      style={{ height: DRAWER_HEIGHT_PX }}
    >
      {/* Header row */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-[var(--border)]">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">
            {task.task_name || '(Unnamed task)'}
          </p>
          <div className="flex items-center gap-2 shrink-0 text-[11px] text-[var(--muted-foreground)]">
            {task.product && (
              <span className="px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-medium text-[10px]">
                {task.product}
              </span>
            )}
            {task.platform && <span>{task.platform}</span>}
            <span className="flex items-center gap-1 opacity-60">
              <Files size={10} />
              {task.asset_count}
            </span>
          </div>
        </div>

        {/* External links + close */}
        <div className="flex items-center gap-1.5 shrink-0 ml-3">
          {task.frame_url?.includes('figma') && (
            <a href={task.frame_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 border border-pink-500/20 transition-colors">
              <ExternalLink size={10} /> Figma
            </a>
          )}
          {task.project_url && (
            <a href={task.project_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-colors">
              <ExternalLink size={10} /> Project
            </a>
          )}
          {task.monday_id && (
            <a href={`https://monday.com/boards/${task.board_id || '5433027071'}/pulses/${task.monday_id}`}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 text-[var(--primary)] border border-[var(--primary)]/20 transition-colors">
              <ExternalLink size={10} /> Monday
            </a>
          )}
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors ml-1">
            <X size={15} />
          </button>
        </div>
      </div>

      {/* Thumbnail strip */}
      <div className="flex-1 overflow-x-auto px-5 py-2.5 flex gap-2.5 items-start">
        {task.assets.map(asset => (
          <FileThumbnail
            key={asset.id}
            asset={asset}
            isActive={asset.id === activeAssetId}
            apiBase={apiBase}
            onClick={onSelectAsset}
            onMeta={coverage?.[asset.name]?.uploaded_to_meta === 1}
          />
        ))}
      </div>
    </div>
  )
}
