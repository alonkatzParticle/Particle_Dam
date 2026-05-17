import { useRef, useState, useCallback, useEffect } from 'react'
import { ExternalLink, Film, Image, FileText, Files } from 'lucide-react'
import { cn } from '../lib/utils'
import { useApiBase } from '../lib/ApiContext'

// ── Extension helpers ─────────────────────────────────────────────────────────

const VIDEO_EXTS  = new Set(['mp4','mov','avi','mkv','mxf','webm','m4v'])
const IMAGE_EXTS  = new Set(['jpg','jpeg','png','webp','tiff','tif','bmp','gif','heic'])

function extIcon(ext) {
  const e = (ext || '').toLowerCase()
  if (VIDEO_EXTS.has(e)) return <Film size={10} />
  if (IMAGE_EXTS.has(e)) return <Image size={10} />
  return <FileText size={10} />
}

function extBadgeColor(ext) {
  const e = (ext || '').toLowerCase()
  if (VIDEO_EXTS.has(e)) return 'bg-violet-500/20 text-violet-300 border-violet-500/20'
  if (IMAGE_EXTS.has(e)) return 'bg-blue-500/20 text-blue-300 border-blue-500/20'
  return 'bg-zinc-500/20 text-zinc-300 border-zinc-500/20'
}

// ── Status colour map ─────────────────────────────────────────────────────────

const STATUS_COLORS = {
  'Done':        'bg-emerald-500/15 text-emerald-400',
  'In Progress': 'bg-amber-500/15 text-amber-400',
  'Revision':    'bg-orange-500/15 text-orange-400',
  'Approved':    'bg-teal-500/15 text-teal-400',
}

// ── Scrub preview image ───────────────────────────────────────────────────────

const SCRUB_CAP = 10   // max files shown in scrub; rest visible in expanded view

// Module-level cache: assetId → resolved thumbnail URL (or null on error)
// Survives component unmount so returning to the page doesn't re-fetch.
const thumbCache = new Map()

function ScrubPreview({ assets, apiBase }) {
  const [activeIdx, setActiveIdx]   = useState(0)
  const [thumbUrls, setThumbUrls]   = useState(() => {
    // Seed from module cache on mount so already-loaded thumbs show immediately
    const seed = {}
    assets.slice(0, SCRUB_CAP).forEach((a, i) => {
      if (thumbCache.has(a.id)) seed[i] = thumbCache.get(a.id)
    })
    return seed
  })
  const [restLoaded, setRestLoaded] = useState(() =>
    // If all scrub images were already cached, skip the hover-load step
    assets.slice(1, SCRUB_CAP).every(a => thumbCache.has(a.id))
  )
  const [firstLoaded, setFirstLoaded] = useState(() => thumbCache.has(assets[0]?.id))
  const containerRef                = useRef(null)
  const scrubAssets                 = assets.slice(0, SCRUB_CAP)

  // Load index 0 immediately on mount (skip if already cached)
  useEffect(() => {
    if (!scrubAssets[0]) return
    if (thumbCache.has(scrubAssets[0].id)) return   // already in cache — nothing to do
    const url = `${apiBase}/assets/${scrubAssets[0].id}/thumbnail`
    const img = new window.Image()
    img.src = url
    img.onload  = () => {
      thumbCache.set(scrubAssets[0].id, url)
      setThumbUrls(prev => ({ ...prev, [0]: url }))
      setFirstLoaded(true)
    }
    img.onerror = () => {
      thumbCache.set(scrubAssets[0].id, null)
      setThumbUrls(prev => ({ ...prev, [0]: null }))
    }
  }, [scrubAssets[0]?.id, apiBase])

  // Load indices 1–N on first hover OR immediately after index 0 loads
  const preloadRest = useCallback(() => {
    if (restLoaded) return
    setRestLoaded(true)
    scrubAssets.slice(1).forEach((a, i) => {
      const idx = i + 1
      if (thumbCache.has(a.id)) {
        setThumbUrls(prev => ({ ...prev, [idx]: thumbCache.get(a.id) }))
        return
      }
      const url = `${apiBase}/assets/${a.id}/thumbnail`
      const img = new window.Image()
      img.src = url
      img.onload  = () => {
        thumbCache.set(a.id, url)
        setThumbUrls(prev => ({ ...prev, [idx]: url }))
      }
      img.onerror = () => {
        thumbCache.set(a.id, null)
        setThumbUrls(prev => ({ ...prev, [idx]: null }))
      }
    })
  }, [restLoaded, scrubAssets, apiBase])

  // Kick off rest as soon as index 0 is confirmed loaded
  useEffect(() => {
    if (firstLoaded) preloadRest()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstLoaded])

  const onMouseMove = useCallback((e) => {
    if (!containerRef.current || scrubAssets.length === 0) return
    const { left, width } = containerRef.current.getBoundingClientRect()
    const x = e.clientX - left
    const idx = Math.max(0, Math.min(scrubAssets.length - 1, Math.floor((x / width) * scrubAssets.length)))
    setActiveIdx(idx)
  }, [scrubAssets.length])

  const currentUrl = thumbUrls[activeIdx]
  const currentAsset = scrubAssets[activeIdx] || scrubAssets[0]

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-black/40 overflow-hidden"
      style={{ aspectRatio: '16/10' }}
      onMouseEnter={preloadRest}
      onMouseMove={onMouseMove}
    >
      {/* Thumbnail image */}
      {currentUrl ? (
        <img
          key={currentUrl}
          src={currentUrl}
          alt=""
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-75"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center space-y-2 opacity-40">
            {extIcon(currentAsset?.extension)}
            <p className="text-[10px] text-[var(--muted-foreground)] uppercase tracking-widest">
              {currentAsset?.extension?.toUpperCase() || 'FILE'}
            </p>
          </div>
        </div>
      )}

      {/* File count badge */}
      <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[10px] text-white/70">
        <Files size={9} />
        {assets.length}
      </div>

      {/* Scrub dot indicators */}
      {scrubAssets.length > 1 && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
          {scrubAssets.map((_, i) => (
            <div
              key={i}
              className={cn(
                'rounded-full transition-all duration-75',
                i === activeIdx
                  ? 'w-4 h-1 bg-white'
                  : 'w-1 h-1 bg-white/30'
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── TaskCard ──────────────────────────────────────────────────────────────────

export function TaskCard({ task, onClick }) {
  const apiBase = useApiBase()

  return (
    <div
      onClick={onClick}
      className="group rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden cursor-pointer hover:border-[var(--primary)]/40 hover:shadow-lg hover:shadow-black/20 transition-all duration-200"
    >
      {/* Scrub preview */}
      <ScrubPreview assets={task.assets} apiBase={apiBase} />

      {/* Info */}
      <div className="p-3 space-y-1.5">
        {/* Task name */}
        <p className="text-sm font-semibold leading-snug line-clamp-2 group-hover:text-[var(--primary)] transition-colors">
          {task.task_name || '(Unnamed task)'}
        </p>

        {/* Meta row */}
        <div className="flex items-center gap-2 flex-wrap">
          {task.product && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--primary)]/10 text-[var(--primary)] border border-[var(--primary)]/20">
              {task.product}
            </span>
          )}
          {task.status && STATUS_COLORS[task.status] && (
            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium', STATUS_COLORS[task.status])}>
              {task.status}
            </span>
          )}
          {task.platform && (
            <span className="text-[10px] text-[var(--muted-foreground)]">{task.platform}</span>
          )}
        </div>
      </div>
    </div>
  )
}
