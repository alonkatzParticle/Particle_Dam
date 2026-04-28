// MondayPanel.jsx — Slide-in panel showing Monday task details for a selected asset
import { X, ExternalLink, Link2, Link2Off, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '../lib/utils'
import { useApiBase } from '../lib/ApiContext'

// ─── Status color map ──────────────────────────────────────────────────────────
const STATUS_COLORS = {
  'done':                 'bg-green-500/20 text-green-400 border-green-500/30',
  'working on it':        'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'in progress':          'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'stuck':                'bg-red-500/20 text-red-400 border-red-500/30',
  'review':               'bg-purple-500/20 text-purple-400 border-purple-500/30',
  'ready for assignment': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'waiting for review':   'bg-amber-500/20 text-amber-400 border-amber-500/30',
  'approved':             'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  'cancelled':            'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}
function statusColor(status) {
  return STATUS_COLORS[(status || '').toLowerCase()] || 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30'
}

// ─── Link picker ───────────────────────────────────────────────────────────────
function TaskPicker({ assetId, currentTask, onLinked }) {
  const apiBase = useApiBase()
  const [open, setOpen]     = useState(false)
  const [tasks, setTasks]   = useState([])
  const [query, setQuery]   = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`${apiBase}/monday/tasks`)
      .then(r => r.json())
      .then(data => { setTasks(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [open, apiBase])

  const filtered = tasks.filter(t =>
    !query || t.name.toLowerCase().includes(query.toLowerCase())
  )

  const link = async (mondayId) => {
    await fetch(`${apiBase}/assets/${assetId}/monday-link`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monday_id: mondayId }),
    })
    setOpen(false)
    onLinked()
  }

  const unlink = async () => {
    await fetch(`${apiBase}/assets/${assetId}/monday-link`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ monday_id: null }),
    })
    onLinked()
  }

  return (
    <div className="relative">
      <div className="flex gap-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-[var(--sidebar-border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/5 transition-colors"
        >
          <Link2 size={11} />
          {currentTask ? 'Change task' : 'Link to task'}
        </button>
        {currentTask && (
          <button
            onClick={unlink}
            className="flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 rounded-lg border border-[var(--sidebar-border)] text-[var(--muted-foreground)] hover:text-red-400 hover:border-red-400/30 transition-colors"
          >
            <Link2Off size={11} />
            Unlink
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-80 rounded-xl border border-[var(--sidebar-border)] bg-[#1a1a2e] shadow-2xl z-50 overflow-hidden">
          <div className="p-2 border-b border-[var(--sidebar-border)]">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white/5">
              <Search size={12} className="text-[var(--muted-foreground)]" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search tasks…"
                className="flex-1 bg-transparent text-[12px] text-[var(--foreground)] placeholder-[var(--muted-foreground)] outline-none"
              />
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {loading && <p className="text-[11px] text-[var(--muted-foreground)] text-center py-4">Loading…</p>}
            {!loading && filtered.map(t => (
              <button
                key={t.monday_id}
                onClick={() => link(t.monday_id)}
                className="w-full text-left px-3 py-2 hover:bg-white/5 transition-colors border-b border-[var(--sidebar-border)]/50 last:border-0"
              >
                <p className="text-[11px] text-[var(--foreground)] leading-snug">{t.name}</p>
                {(t.product || t.status) && (
                  <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                    {[t.product, t.status].filter(Boolean).join(' · ')}
                  </p>
                )}
              </button>
            ))}
            {!loading && !filtered.length && (
              <p className="text-[11px] text-[var(--muted-foreground)] text-center py-4">No tasks found</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Main panel ───────────────────────────────────────────────────────────────
export function MondayPanel({ asset, onClose, onRefresh }) {
  const [conceptExpanded, setConceptExpanded] = useState(false)
  if (!asset) return null

  const task = asset.monday
  const isVideo = ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mxf', 'm4v'].includes(
    (asset.extension || '').toLowerCase()
  )

  const mondayTaskUrl = task
    ? `https://view.monday.com/${task.monday_id}`
    : null

  return (
    <div className="flex flex-col h-full border-l border-[var(--sidebar-border)] bg-[var(--sidebar)] w-80 shrink-0 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--sidebar-border)] shrink-0">
        <p className="text-[13px] font-semibold text-[var(--foreground)] truncate pr-2">{asset.name}</p>
        <button
          onClick={onClose}
          className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors shrink-0"
        >
          <X size={15} />
        </button>
      </div>

      <div className="flex-1 p-4 space-y-5 overflow-y-auto">

        {/* Monday task section */}
        {task ? (
          <div className="space-y-3">

            {/* Task name + link */}
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-medium">Monday Task</p>
              <a
                href={mondayTaskUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-start gap-2 group"
              >
                <p className="text-[12px] text-[var(--foreground)] group-hover:text-[var(--primary)] transition-colors leading-snug flex-1">
                  {task.name}
                </p>
                <ExternalLink size={11} className="text-[var(--muted-foreground)] group-hover:text-[var(--primary)] transition-colors shrink-0 mt-0.5" />
              </a>
            </div>

            {/* Status + chips */}
            <div className="flex flex-wrap gap-1.5">
              {task.status && (
                <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', statusColor(task.status))}>
                  {task.status}
                </span>
              )}
              {task.product && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] border border-[var(--primary)]/20">
                  {task.product}
                </span>
              )}
              {task.platform && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--muted-foreground)] border border-white/10">
                  {task.platform}
                </span>
              )}
              {task.task_type && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-[var(--muted-foreground)] border border-white/10">
                  {task.task_type}
                </span>
              )}
            </div>

            {/* Hook */}
            {task.hook && (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-medium">Hook</p>
                <p className="text-[12px] text-[var(--foreground)] italic leading-snug">"{task.hook}"</p>
              </div>
            )}

            {/* Concept */}
            {task.concept && (
              <div className="space-y-1">
                <button
                  onClick={() => setConceptExpanded(e => !e)}
                  className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-medium hover:text-[var(--foreground)] transition-colors"
                >
                  Video Concept
                  {conceptExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                </button>
                {conceptExpanded && (
                  <p className="text-[11px] text-[var(--muted-foreground)] leading-relaxed whitespace-pre-wrap">{task.concept}</p>
                )}
              </div>
            )}

            {/* External links */}
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-medium">Links</p>
              <div className="space-y-1.5">
                {task.dropbox_url && (
                  <a
                    href={task.dropbox_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--sidebar-border)] transition-colors group"
                  >
                    <span className="text-[11px] text-[var(--foreground)] flex-1">📦 Dropbox Folder</span>
                    <ExternalLink size={11} className="text-[var(--muted-foreground)] group-hover:text-[var(--foreground)] transition-colors" />
                  </a>
                )}
                {task.frame_url && (
                  <a
                    href={task.frame_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--sidebar-border)] transition-colors group"
                  >
                    <span className="text-[11px] text-[var(--foreground)] flex-1">
                      {isVideo ? '🎬 Frame.io' : '🎨 Figma'}
                    </span>
                    <ExternalLink size={11} className="text-[var(--muted-foreground)] group-hover:text-[var(--foreground)] transition-colors" />
                  </a>
                )}
                {task.project_url && (
                  <a
                    href={task.project_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-[var(--sidebar-border)] transition-colors group"
                  >
                    <span className="text-[11px] text-[var(--foreground)] flex-1">🔗 Project Link</span>
                    <ExternalLink size={11} className="text-[var(--muted-foreground)] group-hover:text-[var(--foreground)] transition-colors" />
                  </a>
                )}
              </div>
            </div>

            {/* Match confidence */}
            {task.match_type !== 'manual' && (
              <p className="text-[10px] text-[var(--muted-foreground)]">
                Auto-matched · {task.score}% confidence
              </p>
            )}
            {task.match_type === 'manual' && (
              <p className="text-[10px] text-[var(--muted-foreground)]">Manually linked</p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-medium">Monday Task</p>
            <p className="text-[12px] text-[var(--muted-foreground)]">No Monday task linked to this asset.</p>
          </div>
        )}

        {/* Link / change picker */}
        <TaskPicker
          assetId={asset.id}
          currentTask={task}
          onLinked={onRefresh}
        />

        {/* Divider */}
        <div className="border-t border-[var(--sidebar-border)]" />

        {/* Asset meta */}
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest text-[var(--muted-foreground)] font-medium">Asset Info</p>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-[11px] text-[var(--muted-foreground)]">Extension</span>
              <span className="text-[11px] text-[var(--foreground)] uppercase">{asset.extension || '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[11px] text-[var(--muted-foreground)]">Size</span>
              <span className="text-[11px] text-[var(--foreground)]">
                {asset.size ? `${(asset.size / 1024 / 1024).toFixed(1)} MB` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[11px] text-[var(--muted-foreground)]">Modified</span>
              <span className="text-[11px] text-[var(--foreground)]">
                {asset.modified_at ? new Date(asset.modified_at).toLocaleDateString() : '—'}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
