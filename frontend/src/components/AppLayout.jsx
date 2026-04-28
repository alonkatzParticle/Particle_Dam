import { Outlet, NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { LayoutGrid, RefreshCw, Library, Sparkles, X, Upload } from 'lucide-react'
import { useState, useEffect } from 'react'
import { cn } from '../lib/utils'
import { ApiContext } from '../lib/ApiContext'

function SyncDot({ status }) {
  if (!status) return null
  if (status.running) return (
    <span className="flex items-center gap-1.5 text-xs text-amber-400">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      Syncing…
    </span>
  )
  if (status.lastSyncAt) return (
    <span className="text-xs text-muted-foreground">
      Synced {new Date(status.lastSyncAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
  return null
}

export function AppLayout() {
  const location = useLocation()
  const isAds    = location.pathname.startsWith('/ads')
  const isBrand  = location.pathname.startsWith('/brand')
  const basePath = isBrand ? '/brand' : isAds ? '/ads' : '/raw'
  const apiBase  = isBrand ? '/api/brand' : isAds ? '/api/ads' : '/api/raw'

  const [syncStatus, setSyncStatus]         = useState(null)
  const [syncing, setSyncing]               = useState(false)
  const [mondaySyncing, setMondaySyncing]   = useState(false)
  const [mondayStatus, setMondayStatus]     = useState(null)
  const [untaggedCount, setUntaggedCount]   = useState(null)
  const [tagJob, setTagJob]                 = useState(null)
  const [pendingCount, setPendingCount]     = useState(0)
  const navigate = useNavigate()

  useEffect(() => {
    const tick = () => {
      fetch(`${apiBase}/sync/status`).then(r => r.json()).then(setSyncStatus).catch(() => {})
      if (isAds) {
        fetch(`${apiBase}/monday/sync/status`).then(r => r.json()).then(d => {
          setMondayStatus(d)
          if (!d.running) setMondaySyncing(false)
        }).catch(() => {})
      }
    }
    tick()
    const interval = setInterval(tick, 10000)
    return () => clearInterval(interval)
  }, [apiBase, isAds])

  // Poll pending upload count
  useEffect(() => {
    const pollCount = () =>
      fetch('/api/uploads/count').then(r => r.json()).then(d => setPendingCount(d.count || 0)).catch(() => {})
    pollCount()
    const interval = setInterval(pollCount, 30000)
    return () => clearInterval(interval)
  }, [])


  // Poll tag job status
  useEffect(() => {
    const poll = async () => {
      try {
        const job = await fetch(`${apiBase}/tag-jobs/status`).then(r => r.json())
        setTagJob(job.status === 'idle' ? null : job)
        if (job.status === 'done' || job.status === 'cancelled') {
          fetch(`${apiBase}/assets?untagged=true&limit=1`).then(r => r.json()).then(d => setUntaggedCount(d.total || 0)).catch(() => {})
        }
      } catch { }
    }
    poll()
    const interval = setInterval(poll, 2000)
    return () => clearInterval(interval)
  }, [apiBase])

  const handleSync = async () => {
    setSyncing(true)
    try {
      await fetch(`${apiBase}/sync`, { method: 'POST' })
      const poll = setInterval(async () => {
        const s = await fetch(`${apiBase}/sync/status`).then(r => r.json()).catch(() => ({}))
        setSyncStatus(s)
        if (!s.running) { setSyncing(false); clearInterval(poll) }
      }, 2000)
    } catch {
      setSyncing(false)
    }
  }

  const handleMondaySync = async () => {
    setMondaySyncing(true)
    try {
      await fetch(`${apiBase}/monday/sync`, { method: 'POST' })
      const poll = setInterval(async () => {
        const s = await fetch(`${apiBase}/monday/sync/status`).then(r => r.json()).catch(() => ({}))
        setMondayStatus(s)
        if (!s.running) { setMondaySyncing(false); clearInterval(poll) }
      }, 2000)
    } catch {
      setMondaySyncing(false)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      {/* ── Sidebar ─────────────────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 flex flex-col border-r border-[var(--sidebar-border)] bg-[var(--sidebar)]">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-[var(--sidebar-border)]">
          <div className="w-7 h-7 rounded-lg bg-[var(--primary)] flex items-center justify-center shrink-0">
            <Library size={14} className="text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-[var(--foreground)] leading-none">
              {isAds ? 'Ad Library' : 'Asset Library'}
            </p>
            <p className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
              {isBrand ? 'Brand Kit' : isAds ? 'Final Assets' : 'Raw Files'}
            </p>
          </div>
        </div>

        {/* ── Tab switcher ───────────────────────────────────────────────── */}
        <div className="px-3 pt-3 pb-1">
          <div className="flex rounded-lg overflow-hidden border border-white/10 text-[12px] font-medium">
            <Link
              to="/raw/library"
              className={cn(
                'flex-1 py-1.5 text-center border-r border-white/10 transition-colors',
                !isAds && !isBrand
                  ? 'bg-orange-500/20 text-orange-400 pointer-events-none'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/5'
              )}
            >
              Raw
            </Link>
            <Link
              to="/ads/library"
              className={cn(
                'flex-1 py-1.5 text-center border-r border-white/10 transition-colors',
                isAds
                  ? 'bg-green-500/20 text-green-400 pointer-events-none'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/5'
              )}
            >
              Final
            </Link>
            <Link
              to="/brand/library"
              className={cn(
                'flex-1 py-1.5 text-center transition-colors',
                isBrand
                  ? 'bg-purple-500/20 text-purple-400 pointer-events-none'
                  : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/5'
              )}
            >
              Brand
            </Link>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 p-3 space-y-0.5">
          <NavLink to={`${basePath}/library`} className={({ isActive }) =>
            cn('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive
                ? 'bg-[var(--primary)] text-white font-medium'
                : 'text-[var(--sidebar-foreground)] hover:bg-white/5')}>
            <LayoutGrid size={15} />
            Browse
          </NavLink>

          {!isAds && !isBrand && (<>
          <NavLink to={`${basePath}/tagging`} className={({ isActive }) =>
            cn('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive
                ? 'bg-[var(--primary)] text-white font-medium'
                : 'text-[var(--sidebar-foreground)] hover:bg-white/5')}>
            <Sparkles size={15} />
            <span className="flex-1">Tagging Queue</span>
            {untaggedCount !== null && untaggedCount > 0 && (
              <span className={cn(
                'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                'bg-[var(--primary)]/20 text-[var(--primary)]'
              )}>
                {untaggedCount > 999 ? '999+' : untaggedCount}
              </span>
            )}
          </NavLink>

          <NavLink to="/uploads" className={({ isActive }) =>
            cn('flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors',
              isActive
                ? 'bg-amber-500 text-white font-medium'
                : 'text-[var(--sidebar-foreground)] hover:bg-white/5')}>
            <Upload size={15} />
            <span className="flex-1">Needs Approval</span>
            {pendingCount > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400">
                {pendingCount > 99 ? '99+' : pendingCount}
              </span>
            )}
          </NavLink>
          </>)}
        </nav>

        {/* ── Persistent tagging job widget ─────────────────────────────── */}
        {tagJob && (tagJob.status === 'running' || tagJob.status === 'done' || tagJob.status === 'cancelled') && (
          <div
            className="mx-3 mb-2 rounded-xl border border-[var(--sidebar-border)] bg-white/[0.03] p-3 cursor-pointer hover:bg-white/[0.05] transition-colors"
            onClick={() => navigate(`${basePath}/tagging`)}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                {tagJob.status === 'running'
                  ? <Sparkles size={11} className="text-[var(--primary)] animate-pulse" />
                  : tagJob.status === 'done'
                    ? <span className="text-[10px]">✓</span>
                    : <span className="text-[10px]">◼</span>
                }
                <span className="text-[11px] font-semibold text-[var(--foreground)]">
                  {tagJob.status === 'running' ? 'Tagging…' : tagJob.status === 'done' ? 'Tagging complete' : 'Tagging cancelled'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-[var(--muted-foreground)]">
                  {tagJob.done}/{tagJob.total}
                </span>
                {tagJob.status === 'running' && (
                  <button
                    onClick={e => { e.stopPropagation(); fetch(`${apiBase}/tag-jobs`, { method: 'DELETE' }); setTagJob(j => ({ ...j, status: 'cancelled' })) }}
                    className="text-[var(--muted-foreground)] hover:text-red-400 transition-colors"
                  >
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-white/5 rounded-full overflow-hidden mb-1.5">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  tagJob.status === 'done' ? 'bg-green-500' : tagJob.status === 'cancelled' ? 'bg-red-400' : 'bg-[var(--primary)]'
                )}
                style={{ width: `${tagJob.total ? Math.round(((tagJob.done) / tagJob.total) * 100) : 0}%` }}
              />
            </div>

            {/* Current file */}
            {tagJob.currentName && tagJob.status === 'running' && (
              <p className="text-[9px] text-[var(--muted-foreground)] truncate leading-snug">{tagJob.currentName}</p>
            )}
            {tagJob.errors > 0 && (
              <p className="text-[9px] text-red-400 mt-0.5">{tagJob.errors} error{tagJob.errors !== 1 ? 's' : ''}</p>
            )}
          </div>
        )}

        {/* Sync control */}
        <div className="p-3 border-t border-[var(--sidebar-border)] space-y-1">
          {/* Monday sync — Final Assets only */}
          {isAds && (
            <>
              <button
                onClick={handleMondaySync}
                disabled={mondaySyncing || mondayStatus?.running}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/5 transition-colors disabled:opacity-40">
                <RefreshCw size={13} className={mondaySyncing || mondayStatus?.running ? 'animate-spin' : ''} />
                {mondayStatus?.running
                  ? mondayStatus.phase === 'fetching' ? 'Fetching tasks…'
                    : mondayStatus.phase === 'resolving' ? `Resolving ${mondayStatus.resolvedCount}/${mondayStatus.resolveTotal}…`
                    : mondayStatus.phase === 'indexing' ? 'Indexing files…'
                    : 'Syncing…'
                  : `Refresh from Monday${mondayStatus?.lastSyncAt ? ' ✓' : ''}`}
              </button>
              {mondayStatus?.running && (
                <div className="px-3 pb-1 space-y-1.5">
                  <p className="text-[10px] text-[var(--muted-foreground)]">
                    {mondayStatus.phase === 'resolving' && <>{`Resolving Dropbox links… ${mondayStatus.resolvedCount}/${mondayStatus.resolveTotal}`}</>}
                    {mondayStatus.phase === 'indexing' && <>{`Indexing files… ${mondayStatus.indexedFiles} files from ${mondayStatus.indexedTasks} tasks`}</>}
                    {mondayStatus.phase === 'updating_json' && 'Refreshing task metadata…'}
                    {mondayStatus.phase === 'cleanup' && 'Cleaning up stale assets…'}
                    {mondayStatus.phase === 'fetching' && 'Fetching Monday tasks…'}
                  </p>
                  {mondayStatus.phase === 'resolving' && mondayStatus.resolveTotal > 0 && (
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[var(--primary)] rounded-full transition-all duration-500"
                        style={{ width: `${Math.round((mondayStatus.resolvedCount / mondayStatus.resolveTotal) * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
              {mondayStatus?.lastSyncAt && !mondayStatus.running && (
                <p className="text-[10px] text-[var(--muted-foreground)] px-3">
                  Monday: {mondayStatus.indexedFiles?.toLocaleString()} files · {new Date(mondayStatus.lastSyncAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </p>
              )}
            </>
          )}
          <button
            onClick={handleSync}
            disabled={syncing || syncStatus?.running}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-white/5 transition-colors disabled:opacity-40">
            <RefreshCw size={13} className={syncing || syncStatus?.running ? 'animate-spin' : ''} />
            {syncing || syncStatus?.running ? 'Syncing…' : 'Sync Library'}
          </button>
          <div className="px-3 pt-1">
            <SyncDot status={syncStatus} />
          </div>
        </div>

        {/* Version */}
        <div className="px-4 pb-3 pt-1">
          <span className="text-[10px] text-[var(--muted-foreground)] opacity-30 font-mono select-none">v0.0.1</span>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden flex flex-col">
        <ApiContext.Provider value={apiBase}>
          <Outlet />
        </ApiContext.Provider>
      </main>
    </div>
  )
}

