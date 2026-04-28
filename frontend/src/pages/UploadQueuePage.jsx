import { useState, useEffect, useCallback, useRef } from 'react'
import { Upload, CheckCircle, XCircle, RefreshCw, Clock, User, FolderOpen, Inbox, X, Play } from 'lucide-react'
import { cn } from '../lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mediaTypeIcon(type) {
  const icons = { video: '🎬', image: '🖼️', gif: '✨', document: '📄', other: '📎' }
  return icons[type] || '📎'
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Unknown'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatBytes(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ─── Preview modal ────────────────────────────────────────────────────────────

function PreviewModal({ item, onClose }) {
  const [url, setUrl]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState(null)
  const videoRef = useRef(null)

  useEffect(() => {
    fetch(`/api/uploads/${item.id}/preview`)
      .then(r => r.json())
      .then(data => {
        if (data.error) throw new Error(data.error)
        setUrl(data.url)
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [item.id])

  // Close on Escape
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const isVideo = item.media_type === 'video' || item.media_type === 'gif'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl mx-4 rounded-2xl overflow-hidden bg-[#111] border border-white/10 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.07]">
          <div>
            <p className="text-sm font-medium text-white truncate max-w-lg">{item.name}</p>
            <p className="text-xs text-white/40">
              {item.uploaded_by && `${item.uploaded_by} · `}
              {item.container_name}{item.content_type && ` / ${item.content_type}`}
              {` · ${formatBytes(item.size)}`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-white/40 hover:text-white transition-colors rounded-lg p-1.5 hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="relative bg-black aspect-video flex items-center justify-center">
          {loading && (
            <div className="flex flex-col items-center gap-3 text-white/40">
              <RefreshCw size={24} className="animate-spin" />
              <span className="text-sm">Loading preview…</span>
            </div>
          )}
          {error && (
            <div className="text-red-400 text-sm px-6 text-center">
              Could not load preview: {error}
            </div>
          )}
          {url && isVideo && (
            <video
              ref={videoRef}
              src={url}
              controls
              autoPlay
              className="w-full h-full object-contain"
            />
          )}
          {url && !isVideo && (
            <img
              src={url}
              alt={item.name}
              className="w-full h-full object-contain"
            />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden animate-pulse">
      <div className="h-36 bg-white/[0.05]" />
      <div className="p-4 space-y-2">
        <div className="h-3.5 bg-white/[0.07] rounded w-3/4" />
        <div className="h-3 bg-white/[0.04] rounded w-1/2" />
        <div className="h-3 bg-white/[0.04] rounded w-2/3" />
        <div className="flex gap-2 mt-3">
          <div className="flex-1 h-8 bg-white/[0.05] rounded-lg" />
          <div className="flex-1 h-8 bg-white/[0.05] rounded-lg" />
        </div>
      </div>
    </div>
  )
}

// ─── Upload card ──────────────────────────────────────────────────────────────

function UploadCard({ item, onApprove, onReject, onPreview }) {
  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [done, setDone]           = useState(false)
  const [imgError, setImgError]   = useState(false)
  const [hovered, setHovered]     = useState(false)

  const thumbnailSrc = `/api/uploads/${item.id}/thumbnail`

  async function handleApprove(e) {
    e.stopPropagation()
    setApproving(true)
    try {
      const res = await fetch(`/api/uploads/${item.id}/approve`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setDone(true)
      setTimeout(() => onApprove(item.id), 600)
    } catch (err) {
      alert(`Approval failed: ${err.message}`)
      setApproving(false)
    }
  }

  async function handleReject(e) {
    e.stopPropagation()
    setRejecting(true)
    try {
      const res = await fetch(`/api/uploads/${item.id}/reject`, { method: 'POST' })
      if (!res.ok) throw new Error(await res.text())
      setDone(true)
      setTimeout(() => onReject(item.id), 600)
    } catch (err) {
      alert(`Rejection failed: ${err.message}`)
      setRejecting(false)
    }
  }

  return (
    <div className={cn(
      'bg-white/[0.03] border border-white/10 rounded-2xl overflow-hidden transition-all duration-500',
      done && 'opacity-0 scale-95 pointer-events-none'
    )}>
      {/* Thumbnail — click to preview */}
      <div
        className="h-36 bg-white/[0.05] flex items-center justify-center relative overflow-hidden cursor-pointer group"
        onClick={() => onPreview(item)}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {!imgError ? (
          <img
            src={thumbnailSrc}
            alt={item.name}
            className={cn('w-full h-full object-cover transition-all duration-200', hovered && 'scale-105 brightness-75')}
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="text-4xl">{mediaTypeIcon(item.media_type)}</span>
        )}

        {/* Play overlay on hover */}
        <div className={cn(
          'absolute inset-0 flex items-center justify-center transition-opacity duration-200',
          hovered ? 'opacity-100' : 'opacity-0'
        )}>
          <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center border border-white/30">
            <Play size={16} className="text-white ml-0.5" fill="white" />
          </div>
        </div>

        {/* Media type badge */}
        <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-black/60 text-white/70">
          {item.media_type || 'file'}
        </span>
      </div>

      {/* Info */}
      <div className="p-4 space-y-2">
        <p className="text-sm font-medium text-white truncate" title={item.name}>
          {item.name}
        </p>

        <div className="space-y-1">
          {item.uploaded_by && (
            <div className="flex items-center gap-1.5 text-xs text-white/50">
              <User size={10} />
              <span>{item.uploaded_by}</span>
            </div>
          )}
          {item.container_name && (
            <div className="flex items-center gap-1.5 text-xs text-white/50">
              <FolderOpen size={10} />
              <span>
                {item.container_name}
                {item.content_type && ` / ${item.content_type}`}
              </span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-xs text-white/40">
            <Clock size={10} />
            <span>{timeAgo(item.detected_at)} · {formatBytes(item.size)}</span>
          </div>
        </div>

        <p className="text-[10px] text-white/30 font-mono truncate" title={item.destination_path}>
          → {item.destination_path}
        </p>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={handleApprove}
            disabled={approving || rejecting}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all',
              'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20',
              'hover:bg-emerald-500/25 hover:border-emerald-500/40',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            {approving ? <RefreshCw size={11} className="animate-spin" /> : <CheckCircle size={11} />}
            {approving ? 'Moving…' : 'Approve'}
          </button>
          <button
            onClick={handleReject}
            disabled={approving || rejecting}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-all',
              'bg-red-500/15 text-red-400 border border-red-500/20',
              'hover:bg-red-500/25 hover:border-red-500/40',
              'disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            {rejecting ? <RefreshCw size={11} className="animate-spin" /> : <XCircle size={11} />}
            {rejecting ? 'Deleting…' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UploadQueuePage() {
  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [scanning, setScanning]   = useState(false)
  const [previewItem, setPreviewItem] = useState(null)

  const load = useCallback(async () => {
    try {
      const data = await fetch('/api/uploads/pending').then(r => r.json())
      setItems(data)
    } catch (err) {
      console.error('[UploadQueue] load error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function handleScan() {
    setScanning(true)
    try {
      await fetch('/api/uploads/scan', { method: 'POST' })
      await load()
    } catch (err) {
      console.error('[UploadQueue] scan error:', err)
    } finally {
      setScanning(false)
    }
  }

  function removeItem(id) {
    setItems(prev => prev.filter(i => i.id !== id))
    if (previewItem?.id === id) setPreviewItem(null)
  }

  return (
    <div className="flex flex-col h-full bg-[var(--background)]">
      {/* Preview modal */}
      {previewItem && (
        <PreviewModal item={previewItem} onClose={() => setPreviewItem(null)} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/[0.07] shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
            <Upload size={15} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-white">Needs Approval</h1>
            <p className="text-xs text-white/40">
              {loading ? 'Loading…' : `${items.length} file${items.length !== 1 ? 's' : ''} waiting`}
            </p>
          </div>
        </div>
        <button
          onClick={handleScan}
          disabled={scanning}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
            'bg-white/[0.05] border border-white/[0.08] text-white/60',
            'hover:bg-white/[0.08] hover:text-white/90',
            'disabled:opacity-40 disabled:cursor-not-allowed'
          )}
        >
          <RefreshCw size={12} className={cn(scanning && 'animate-spin')} />
          {scanning ? 'Scanning…' : 'Scan Now'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/[0.07] flex items-center justify-center">
              <Inbox size={22} className="text-white/25" />
            </div>
            <div>
              <p className="text-sm font-medium text-white/50">Nothing waiting for review</p>
              <p className="text-xs text-white/30 mt-1">Files uploaded to the Upload folder will appear here</p>
            </div>
            <button
              onClick={handleScan}
              disabled={scanning}
              className="text-xs text-amber-400/70 hover:text-amber-400 transition-colors disabled:opacity-40"
            >
              {scanning ? 'Scanning…' : 'Scan for new uploads'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {items.map(item => (
              <UploadCard
                key={item.id}
                item={item}
                onApprove={removeItem}
                onReject={removeItem}
                onPreview={setPreviewItem}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
