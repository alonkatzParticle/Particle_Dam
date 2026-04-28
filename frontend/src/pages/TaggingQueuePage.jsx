import { useState, useEffect, useCallback, useRef } from 'react'
import { extGroup, formatBytes, cn } from '../lib/utils'
import { Sparkles, CheckSquare, Square, Loader, ChevronLeft, ChevronRight, CheckCircle2, XCircle, Tag, X, Clock } from 'lucide-react'
import { useApiBase } from '../lib/ApiContext'

const VIDEO_EXTS = new Set(['mp4','mov','avi','mkv','webm','mxf','m4v'])

// Cost estimate constants (Sonnet 4-5 pricing)
const COST_VIDEO  = 0.0145  // 4 frames × ~950 tok + 500 prompt + 150 out @ $3/$15 per MTok
const COST_IMAGE  = 0.0045  // 1 frame  × ~950 tok + 500 prompt + 150 out

function estimateCost(assets) {
  return assets.reduce((sum, a) => {
    const ext = a.extension?.toLowerCase()
    return sum + (VIDEO_EXTS.has(ext) ? COST_VIDEO : COST_IMAGE)
  }, 0)
}

function SelectableCard({ asset, index, selected, status, onToggle }) {
  const apiBase = useApiBase()
  const group = extGroup(asset.extension)
  const canThumb = ['images', 'videos'].includes(group)

  const borderColor = status === 'done'
    ? 'border-green-500/50'
    : status === 'error'
      ? 'border-red-500/50'
      : status === 'running'
        ? 'border-purple-400/60'
        : status === 'pending'
          ? 'border-amber-500/40'
          : selected
            ? 'border-[var(--primary)]'
            : 'border-[var(--border)]'

  return (
    <div
      onMouseDown={e => { if (e.shiftKey) e.preventDefault() }}
      onClick={e => { !['running','done','error','pending'].includes(status) && onToggle(asset.id, index, e) }}
      className={cn(
        'relative rounded-xl border bg-[var(--card)] overflow-hidden transition-all',
        ['running','done','error','pending'].includes(status) ? 'cursor-default' : 'cursor-pointer hover:border-white/20',
        borderColor,
        selected && !status ? 'ring-1 ring-[var(--primary)]/50' : ''
      )}
    >
      {/* Thumbnail */}
      <div className="relative w-full bg-black/30 overflow-hidden" style={{ aspectRatio: '16/10' }}>
        {canThumb ? (
          <img
            src={`${apiBase}/assets/${asset.id}/thumbnail?v=2`}
            alt={asset.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--muted-foreground)] opacity-30">
            <Tag size={24} />
          </div>
        )}

        {/* Status overlays */}
        {status === 'pending' && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Clock size={18} className="text-amber-400/80" />
          </div>
        )}
        {status === 'running' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <Loader size={20} className="text-purple-400 animate-spin" />
          </div>
        )}
        {status === 'done' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <CheckCircle2 size={22} className="text-green-400" />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
            <XCircle size={22} className="text-red-400" />
          </div>
        )}

        {/* Checkbox — only when idle */}
        {!status && (
          <div className="absolute top-2 left-2">
            {selected
              ? <CheckSquare size={16} className="text-[var(--primary)] drop-shadow" />
              : <Square size={16} className="text-white/50 drop-shadow" />
            }
          </div>
        )}

        {/* Extension badge */}
        <span className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-[10px] font-mono text-white/70 px-1.5 py-0.5 rounded">
          {asset.extension?.toUpperCase() || '—'}
        </span>
      </div>

      {/* Name */}
      <div className="px-2.5 py-2">
        <p className="text-[12px] font-medium leading-snug line-clamp-2 text-[var(--foreground)]">{asset.name}</p>
        <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">{formatBytes(asset.size)}</p>
      </div>
    </div>
  )
}

function Pagination({ page, pages, onPage }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center gap-2 py-4 justify-center">
      <button onClick={() => onPage(page - 1)} disabled={page <= 1}
        className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-white/5 disabled:opacity-30 transition-colors">
        <ChevronLeft size={14} />
      </button>
      <span className="text-sm text-[var(--muted-foreground)]">Page {page} of {pages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page >= pages}
        className="p-1.5 rounded-lg border border-[var(--border)] hover:bg-white/5 disabled:opacity-30 transition-colors">
        <ChevronRight size={14} />
      </button>
    </div>
  )
}

export default function TaggingQueuePage() {
  const apiBase = useApiBase()
  const [assets, setAssets]       = useState([])
  const [total, setTotal]         = useState(0)
  const [pages, setPages]         = useState(1)
  const [page, setPage]           = useState(1)
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState(new Set())      // asset IDs selected for tagging
  const [statuses, setStatuses]   = useState({})             // { [id]: 'done'|'error' } from server
  const [queuedIds, setQueuedIds] = useState(new Set())      // all IDs submitted to current job
  const [currentId, setCurrentId] = useState(null)           // ID being processed right now
  const [running, setRunning]     = useState(false)
  const [progress, setProgress]   = useState({ done: 0, total: 0, errors: 0 })
  const lastClickedIndexRef       = useRef(null)

  const fetchAssets = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ untagged: 'true', page: p, limit: '60' })
      const data = await fetch(`${apiBase}/assets?${params}`).then(r => r.json())
      setAssets(data.assets || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
    } catch { setAssets([]) } finally { setLoading(false) }
  }, [page])

  useEffect(() => { fetchAssets(page) }, [page])

  const toggleSelect = (id, index, e) => {
    if (e?.shiftKey && lastClickedIndexRef.current !== null) {
      // Range select between lastClickedIndex and current index
      const from = Math.min(lastClickedIndexRef.current, index)
      const to   = Math.max(lastClickedIndexRef.current, index)
      const rangeIds = assets.slice(from, to + 1).map(a => a.id)
      // Determine intent: if current item is being selected, select range; if deselecting, deselect range
      const shouldSelect = !selected.has(id)
      setSelected(prev => {
        const next = new Set(prev)
        rangeIds.forEach(rid => shouldSelect ? next.add(rid) : next.delete(rid))
        return next
      })
    } else {
      setSelected(prev => {
        const next = new Set(prev)
        next.has(id) ? next.delete(id) : next.add(id)
        return next
      })
    }
    lastClickedIndexRef.current = index
  }

  const toggleSelectAll = () => {
    const pageIds = assets.map(a => a.id)
    const allSelected = pageIds.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) pageIds.forEach(id => next.delete(id))
      else pageIds.forEach(id => next.add(id))
      return next
    })
  }

  const selectedAssets = assets.filter(a => selected.has(a.id))
  const allPageSelected = assets.length > 0 && assets.every(a => selected.has(a.id))
  const cost = estimateCost(assets.filter(a => selected.has(a.id)))

  // On mount — reconnect to any job already running on the server
  useEffect(() => {
    fetch(`${apiBase}/tag-jobs/status`)
      .then(r => r.json())
      .then(job => {
        if (job.status === 'running' || job.status === 'done' || job.status === 'cancelled') {
          setRunning(job.status === 'running')
          setProgress({ done: job.done, total: job.total, errors: job.errors })
          setStatuses(job.results || {})
          setCurrentId(job.currentId || null)
          // Reconstruct queued set from all IDs the job knows about
          // Restore full queued set from job.ids (all originally submitted IDs, including pending ones)
          if (Array.isArray(job.ids)) setQueuedIds(new Set(job.ids))
        }
      })
      .catch(() => {})
  }, [])

  // Poll while job is running
  useEffect(() => {
    if (!running) return
    const interval = setInterval(async () => {
      try {
        const job = await fetch(`${apiBase}/tag-jobs/status`).then(r => r.json())
        setProgress({ done: job.done, total: job.total, errors: job.errors })
        setStatuses(job.results || {})
        setCurrentId(job.currentId || null)
        if (job.status !== 'running') {
          setRunning(false)
          setCurrentId(null)
          setTimeout(() => fetchAssets(page), 1000)
        }
      } catch { /* keep polling */ }
    }, 1500)
    return () => clearInterval(interval)
  }, [running])

  const runTagging = async () => {
    const toTag = [...selected]
    if (!toTag.length) return
    try {
      const res = await fetch(`${apiBase}/tag-jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: toTag }),
      })
      if (res.status === 409) {
        alert('A tagging job is already running.')
        return
      }
      setRunning(true)
      setProgress({ done: 0, total: toTag.length, errors: 0 })
      setStatuses({})
      setCurrentId(null)
      setQueuedIds(new Set(toTag))
      setSelected(new Set())
    } catch (err) {
      console.error('Failed to start tag job:', err)
    }
  }

  const cancelTagging = async () => {
    await fetch(`${apiBase}/tag-jobs`, { method: 'DELETE' }).catch(() => {})
    setRunning(false)
  }

  const progressPct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-[var(--border)] shrink-0 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles size={18} className="text-[var(--primary)]" />
              Tagging Queue
            </h1>
            <p className="text-[12px] text-[var(--muted-foreground)] mt-0.5">
              {loading ? 'Loading…' : `${total.toLocaleString()} assets without AI tags`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Select all on page */}
            <button
              onClick={toggleSelectAll}
              disabled={running || loading}
              className="flex items-center gap-1.5 text-[12px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors disabled:opacity-40"
            >
              {allPageSelected
                ? <CheckSquare size={14} className="text-[var(--primary)]" />
                : <Square size={14} />
              }
              {allPageSelected ? 'Deselect page' : 'Select page'}
            </button>

            {/* Tag button */}
            <button
              onClick={runTagging}
              disabled={selected.size === 0 || running}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--primary)] hover:opacity-90 text-white text-sm font-semibold transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running
                ? <><Loader size={14} className="animate-spin" />Tagging {progress.done}/{progress.total}…</>
                : <><Sparkles size={14} />Tag {selected.size > 0 ? `${selected.size} selected` : 'Selected'}</>
              }
            </button>

            {running && (
              <button
                onClick={cancelTagging}
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium transition-colors border border-red-500/20"
              >
                <X size={14} />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Cost estimate + selection summary */}
        {selected.size > 0 && !running && (
          <div className="flex items-center gap-3 text-[11px] text-[var(--muted-foreground)]">
            <span className="px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-medium">
              {selected.size} selected
            </span>
            <span>Estimated cost: <strong className="text-[var(--foreground)]">${cost.toFixed(2)}</strong></span>
            <button onClick={() => setSelected(new Set())} className="hover:text-[var(--foreground)] transition-colors">
              Clear selection
            </button>
          </div>
        )}

        {/* Progress bar */}
        {running && (
          <div className="space-y-1.5">
            <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--primary)] rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
              <span>{progress.done} of {progress.total} processed</span>
              <div className="flex items-center gap-3">
                {progress.errors > 0 && (
                  <span className="text-red-400">{progress.errors} error{progress.errors !== 1 ? 's' : ''}</span>
                )}
                <span>{progressPct}%</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 20 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--card)] overflow-hidden">
                <div className="skeleton" style={{ aspectRatio: '16/10' }} />
                <div className="p-2.5 space-y-1.5">
                  <div className="skeleton h-3 w-3/4 rounded" />
                  <div className="skeleton h-2.5 w-1/3 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <CheckCircle2 size={40} className="text-green-500 opacity-60" />
            <p className="text-[var(--muted-foreground)] text-sm font-medium">All assets are tagged!</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 select-none">
              {assets.map((asset, index) => {
                // Derive effective status
                const serverResult = statuses[asset.id]       // 'done' | 'error' | undefined
                const isRunning    = currentId === asset.id
                const isPending    = !serverResult && !isRunning && queuedIds.has(asset.id)
                const effectiveStatus = serverResult || (isRunning ? 'running' : isPending ? 'pending' : null)
                return (
                  <SelectableCard
                    key={asset.id}
                    asset={asset}
                    index={index}
                    selected={selected.has(asset.id)}
                    status={effectiveStatus}
                    onToggle={toggleSelect}
                  />
                )
              })}
            </div>
            <Pagination page={page} pages={pages} onPage={p => { setPage(p); setSelected(new Set()) }} />
          </>
        )}
      </div>
    </div>
  )
}
