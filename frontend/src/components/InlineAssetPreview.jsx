import { useState, useEffect, useCallback } from 'react'
import { Download, ExternalLink, Copy, Check, Play, Image, FileText, Archive, Music, Loader } from 'lucide-react'
import { formatBytes, formatDate, extGroup, EXT_ICON, cn } from '../lib/utils'
import { useApiBase } from '../lib/ApiContext'

// Fills the main content area above the task drawer.
// Two-column: big media left, details right.

export function InlineAssetPreview({ asset, drawerHeightPx = 208 }) {
  const apiBase = useApiBase()
  const [previewUrl, setPreviewUrl]       = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [copied, setCopied]               = useState(false)

  const group   = extGroup(asset?.extension)
  const ext     = (asset?.extension || '').toLowerCase()
  const isPdf   = ext === 'pdf'
  const isVideo = group === 'videos'
  const isMedia = group === 'images' || group === 'videos' || isPdf

  const monday = asset?.monday || null

  // Load preview URL on asset change
  const loadPreview = useCallback(async () => {
    if (!asset || !isMedia) return
    setPreviewUrl(null)
    setLoadingPreview(true)
    try {
      const { url } = await fetch(`${apiBase}/assets/${asset.id}/preview`).then(r => r.json())
      setPreviewUrl(url)
    } catch { /* silent */ } finally {
      setLoadingPreview(false)
    }
  }, [asset?.id, isMedia, apiBase])

  useEffect(() => { loadPreview() }, [loadPreview])

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
    } catch { }
  }

  const downloadFile = async () => {
    try {
      const a = document.createElement('a')
      a.href = `${apiBase}/assets/${asset.id}/download`
      a.download = asset.name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch { }
  }

  if (!asset) return null

  return (
    <div
      className="flex flex-1 overflow-hidden"
      style={{ paddingBottom: drawerHeightPx }}
    >
      {/* ── Left: Media preview ─────────────────────────────────────── */}
      <div className="flex-1 bg-black/60 flex items-center justify-center overflow-hidden relative">
        {isMedia ? (
          loadingPreview ? (
            <div className="flex flex-col items-center gap-3 text-[var(--muted-foreground)]">
              <Loader size={24} className="animate-spin opacity-40" />
              <span className="text-xs opacity-40">Loading preview…</span>
            </div>
          ) : previewUrl ? (
            isPdf ? (
              <iframe
                src={previewUrl}
                title={asset.name}
                className="w-full h-full border-none"
              />
            ) : isVideo ? (
              <video
                key={previewUrl}
                src={previewUrl}
                controls
                autoPlay
                className="max-w-full max-h-full object-contain"
              />
            ) : (
              <img
                key={previewUrl}
                src={previewUrl}
                alt={asset.name}
                className="max-w-full max-h-full object-contain"
              />
            )
          ) : (
            <div className="flex flex-col items-center gap-2 opacity-30">
              <span className="text-5xl">{EXT_ICON[group] || '📎'}</span>
              <span className="text-xs">{ext.toUpperCase()}</span>
            </div>
          )
        ) : (
          <div className="flex flex-col items-center gap-2 opacity-30">
            <span className="text-5xl">{EXT_ICON[group] || '📎'}</span>
            <span className="text-xs">{ext.toUpperCase()}</span>
          </div>
        )}
      </div>

      {/* ── Right: Details ──────────────────────────────────────────── */}
      <div className="w-72 shrink-0 bg-[var(--card)] border-l border-[var(--border)] flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* File name + ext */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">
              {asset.extension?.toUpperCase() || 'File'}
            </p>
            <p className="text-sm font-semibold leading-snug break-words">
              {asset.name}
            </p>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Size</p>
              <p className="text-sm">{formatBytes(asset.size)}</p>
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Modified</p>
              <p className="text-sm">{formatDate(asset.modified_at)}</p>
            </div>
            {monday?.product && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Product</p>
                <p className="text-sm">{monday.product}</p>
              </div>
            )}
            {monday?.platform && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Platform</p>
                <p className="text-sm">{monday.platform}</p>
              </div>
            )}
            {monday?.status && (
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Status</p>
                <p className="text-sm">{monday.status}</p>
              </div>
            )}
            {monday?.campaign && (
              <div className="col-span-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Campaign</p>
                <p className="text-sm">{monday.campaign}</p>
              </div>
            )}
          </div>

          {/* Path */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted-foreground)] mb-1">Path</p>
            <p className="text-[11px] text-[var(--muted-foreground)] break-all font-mono leading-relaxed">
              {asset.path}
            </p>
          </div>

          {/* Monday links */}
          {(monday?.frame_url || monday?.project_url) && (
            <div className="flex flex-col gap-2">
              {monday.frame_url && monday.frame_url.includes('figma') && (
                <a
                  href={monday.frame_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-pink-500/10 hover:bg-pink-500/20 text-pink-400 border border-pink-500/20 transition-colors"
                >
                  <ExternalLink size={11} /> Figma Frame
                </a>
              )}
              {monday.project_url && (
                <a
                  href={monday.project_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 transition-colors"
                >
                  <ExternalLink size={11} /> Project
                </a>
              )}
            </div>
          )}
        </div>

        {/* Actions footer */}
        <div className="p-4 border-t border-[var(--border)] flex flex-col gap-2 shrink-0">
          <button
            onClick={downloadFile}
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg bg-[var(--primary)] hover:opacity-90 text-white text-sm font-medium transition-opacity"
          >
            <Download size={13} /> Download
          </button>
          <div className="flex gap-2">
            <button
              onClick={openInDropbox}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[var(--muted-foreground)] transition-colors"
            >
              <ExternalLink size={11} /> Dropbox
            </button>
            <button
              onClick={copyLink}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-[var(--muted-foreground)] transition-colors"
            >
              {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
              {copied ? 'Copied!' : 'Copy link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
