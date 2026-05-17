import { useEffect, useState, useCallback } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronRight, Zap, BarChart3, Settings2,
} from 'lucide-react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function api(path, opts = {}) {
  return fetch(`/api/ads${path}`, { credentials: 'include', ...opts })
}

function pct(n, d) {
  if (!d) return 0
  return Math.round((n / d) * 100)
}

function StatusDot({ ok }) {
  return (
    <span
      style={{
        display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
        background: ok ? 'hsl(142 70% 50%)' : 'hsl(0 70% 55%)',
        flexShrink: 0,
      }}
    />
  )
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 28, fontWeight: 700, color: accent || 'var(--foreground)' }}>
        {value}
      </p>
      {sub && <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>{sub}</p>}
    </div>
  )
}

// ─── Task row ─────────────────────────────────────────────────────────────────

function TaskRow({ task, coverage }) {
  const [open, setOpen] = useState(false)
  const cov = coverage[task.monday_id]
  const total    = cov?.total    ?? 0
  const uploaded = cov?.uploaded ?? 0
  const ratio    = pct(uploaded, total)

  const statusColor = total === 0   ? 'var(--muted-foreground)'
    : uploaded === total             ? 'hsl(142 70% 50%)'
    : uploaded > 0                   ? 'hsl(38 90% 55%)'
    :                                  'hsl(0 70% 55%)'

  const statusLabel = total === 0   ? 'No media'
    : uploaded === total             ? 'Uploaded'
    : uploaded > 0                   ? 'Partial'
    :                                  'Not uploaded'

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', background: 'none', border: 'none',
          padding: '12px 20px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 12,
          color: 'var(--foreground)',
        }}
      >
        {open ? <ChevronDown size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
               : <ChevronRight size={13} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />}

        <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {task.task_name || `Task ${task.monday_id}`}
        </span>

        {/* Product badge */}
        {task.product && (
          <span style={{
            padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600,
            background: 'hsl(258 70% 60% / 0.15)', color: 'hsl(258 70% 65%)',
            border: '1px solid hsl(258 70% 60% / 0.25)', flexShrink: 0,
          }}>
            {task.product}
          </span>
        )}

        {/* Coverage pill */}
        <span style={{
          padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
          background: statusColor + '22', color: statusColor,
          border: `1px solid ${statusColor}44`, flexShrink: 0, minWidth: 90, textAlign: 'center',
        }}>
          {statusLabel} {total > 0 ? `${uploaded}/${total}` : ''}
        </span>

        {/* Mini progress bar */}
        {total > 0 && (
          <div style={{
            width: 60, height: 4, borderRadius: 2,
            background: 'var(--border)', flexShrink: 0, overflow: 'hidden',
          }}>
            <div style={{ width: `${ratio}%`, height: '100%', background: statusColor, borderRadius: 2 }} />
          </div>
        )}
      </button>

      {/* Expanded file list */}
      {open && (
        <FileList taskId={task.monday_id} />
      )}
    </div>
  )
}

function FileList({ taskId }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    api(`/coverage/${taskId}`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {})
  }, [taskId])

  if (!data) return (
    <div style={{ padding: '12px 20px 12px 45px', fontSize: 12, color: 'var(--muted-foreground)' }}>
      Loading…
    </div>
  )

  if (!data.files?.length) return (
    <div style={{ padding: '12px 20px 12px 45px', fontSize: 12, color: 'var(--muted-foreground)' }}>
      No media files indexed for this task.
    </div>
  )

  return (
    <div style={{ padding: '4px 20px 12px 45px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {data.files.map(f => (
        <div key={f.filename} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 10px', borderRadius: 8,
          background: f.uploaded_to_meta ? 'hsl(142 70% 50% / 0.06)' : 'var(--muted)/5',
          border: `1px solid ${f.uploaded_to_meta ? 'hsl(142 70% 50% / 0.2)' : 'var(--border)'}`,
        }}>
          {f.uploaded_to_meta === 1
            ? <CheckCircle2 size={12} style={{ color: 'hsl(142 70% 50%)', flexShrink: 0 }} />
            : f.uploaded_to_meta === 0
              ? <XCircle size={12} style={{ color: 'hsl(0 70% 55%)', flexShrink: 0 }} />
              : <Clock size={12} style={{ color: 'var(--muted-foreground)', flexShrink: 0 }} />
          }
          <span style={{ flex: 1, fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground)' }}>
            {f.filename}
          </span>
          {f.account_id && (
            <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0 }}>
              {f.account_id.replace('act_', 'act …')}
            </span>
          )}
          {f.last_checked && (
            <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0 }}>
              {new Date(f.last_checked).toLocaleDateString()}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MetaCoveragePage() {
  const { user: me } = useAuth()
  const navigate = useNavigate()

  const [connection,  setConnection]  = useState(null)  // { configured, accountCount, accounts }
  const [tasks,       setTasks]       = useState([])
  const [coverage,    setCoverage]    = useState({})
  const [loading,     setLoading]     = useState(true)
  const [scanning,    setScanning]    = useState(false)
  const [scanMsg,     setScanMsg]     = useState(null)
  const [taskFilter,  setTaskFilter]  = useState('all') // all | uploaded | partial | none
  const [search,      setSearch]      = useState('')

  // Admin guard
  useEffect(() => {
    if (me && me.role !== 'admin') navigate('/ads/library', { replace: true })
  }, [me, navigate])

  // Load connection settings
  useEffect(() => {
    api('/coverage/settings')
      .then(r => r.ok ? r.json() : null)
      .then(setConnection)
      .catch(() => {})
  }, [])

  // Load qualifying tasks (Marketing + Meta + Done) with coverage summary
  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch tasks — all pages, filter qualifying ones client-side
      const res  = await api('/tasks?limit=200&page=1')
      const data = res.ok ? await res.json() : { tasks: [] }
      const qualifying = (data.tasks || []).filter(t =>
        /marketing/i.test(t.department || '') &&
        /done|completed/i.test(t.status || '') &&
        (/meta/i.test(t.platform || '') || /\|\s*meta\s*\|/i.test(t.task_name || ''))
      )
      setTasks(qualifying)

      // Fetch batch coverage for qualifying tasks
      if (qualifying.length) {
        const ids = qualifying.map(t => t.monday_id).filter(Boolean)
        const covRes = await api('/coverage/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds: ids }),
        })
        if (covRes.ok) setCoverage(await covRes.json())
      }
    } catch { /* silently fail */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  // Aggregate stats
  const totalTasks   = tasks.length
  const checkedTasks = tasks.filter(t => (coverage[t.monday_id]?.total ?? 0) > 0).length
  const uploadedAll  = tasks.filter(t => {
    const c = coverage[t.monday_id]
    return c && c.total > 0 && c.uploaded === c.total
  }).length
  const partialTasks = tasks.filter(t => {
    const c = coverage[t.monday_id]
    return c && c.uploaded > 0 && c.uploaded < c.total
  }).length
  const totalFiles    = Object.values(coverage).reduce((s, c) => s + (c.total    ?? 0), 0)
  const uploadedFiles = Object.values(coverage).reduce((s, c) => s + (c.uploaded ?? 0), 0)

  // Filtered task list
  const filtered = tasks.filter(t => {
    const c   = coverage[t.monday_id]
    const matchSearch = !search || (t.task_name || '').toLowerCase().includes(search.toLowerCase())
    if (!matchSearch) return false
    if (taskFilter === 'uploaded') return c && c.total > 0 && c.uploaded === c.total
    if (taskFilter === 'partial')  return c && c.uploaded > 0 && c.uploaded < c.total
    if (taskFilter === 'none')     return !c || c.uploaded === 0
    return true
  })

  const handleScan = async () => {
    setScanning(true)
    setScanMsg('Scan started — this runs in the background. Refresh in a few minutes to see results.')
    try {
      await api('/coverage/scan/all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    } catch { /* background */ }
    // Reload coverage after a short delay
    setTimeout(() => { loadTasks(); setScanning(false) }, 5000)
  }

  return (
    <div style={{
      padding: '32px 40px', maxWidth: 1000, margin: '0 auto',
      fontFamily: 'Inter, system-ui, sans-serif', color: 'var(--foreground)',
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'hsl(215 100% 55% / 0.15)',
            border: '1px solid hsl(215 100% 55% / 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChart3 size={20} color="hsl(215 100% 65%)" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Meta Coverage</h1>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)', marginTop: 2 }}>
              Track which completed Marketing + Meta creatives were uploaded to ad accounts
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            onClick={loadTasks}
            style={{
              background: 'var(--card)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '8px 14px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 500, color: 'var(--foreground)',
            }}
          >
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            onClick={handleScan}
            disabled={scanning}
            style={{
              background: scanning ? 'hsl(215 100% 55% / 0.4)' : 'hsl(215 100% 55%)',
              border: 'none', borderRadius: 8, padding: '8px 18px',
              cursor: scanning ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 600, color: '#fff',
              transition: 'opacity 0.15s',
            }}
          >
            <Zap size={13} /> {scanning ? 'Scanning…' : 'Run Scan'}
          </button>
        </div>
      </div>

      {/* Scan message */}
      {scanMsg && (
        <div style={{
          padding: '10px 16px', borderRadius: 10, marginBottom: 20,
          background: 'hsl(215 100% 55% / 0.1)',
          border: '1px solid hsl(215 100% 55% / 0.25)',
          color: 'hsl(215 100% 65%)', fontSize: 12,
        }}>
          {scanMsg}
        </div>
      )}

      {/* ── Connection status ── */}
      <div style={{
        padding: '14px 20px', borderRadius: 12, marginBottom: 28,
        background: 'var(--card)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Settings2 size={14} style={{ color: 'var(--muted-foreground)' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Meta Connection
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StatusDot ok={connection?.configured} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {connection === null ? 'Checking…'
              : connection.configured
                ? `Connected · ${connection.accountCount} ad accounts`
                : 'Not configured — check coverage_settings.json'}
          </span>
        </div>
        {connection?.configured && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto' }}>
            {Object.entries(connection.accounts || {}).map(([id, name]) => (
              <span key={id} style={{
                padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 500,
                background: 'var(--muted)/10', border: '1px solid var(--border)',
                color: 'var(--muted-foreground)',
              }}>
                {name}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Stats ── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 16, marginBottom: 28,
      }}>
        <StatCard label="Qualifying Tasks" value={totalTasks} sub="Marketing + Meta + Done" />
        <StatCard label="Scanned" value={checkedTasks} sub={`${pct(checkedTasks, totalTasks)}% of tasks`} />
        <StatCard label="Fully Uploaded" value={uploadedAll} sub="All files on Meta" accent="hsl(142 70% 50%)" />
        <StatCard label="Partial" value={partialTasks} sub="Some files missing" accent="hsl(38 90% 55%)" />
        <StatCard label="Files Found" value={uploadedFiles} sub={`of ${totalFiles} total media files`} accent="hsl(215 100% 65%)" />
      </div>

      {/* ── Task list ── */}
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        {/* List header + filter */}
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
            Tasks {filtered.length !== totalTasks ? `(${filtered.length} of ${totalTasks})` : `(${totalTasks})`}
          </span>

          {/* Search */}
          <input
            type="text"
            placeholder="Search tasks…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'var(--background)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '6px 12px', fontSize: 12,
              color: 'var(--foreground)', outline: 'none', width: 200,
            }}
          />

          {/* Filter pills */}
          {['all', 'uploaded', 'partial', 'none'].map(v => (
            <button
              key={v}
              onClick={() => setTaskFilter(v)}
              style={{
                padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                border: '1px solid',
                borderColor: taskFilter === v ? 'hsl(215 100% 55%)' : 'var(--border)',
                background: taskFilter === v ? 'hsl(215 100% 55% / 0.15)' : 'transparent',
                color: taskFilter === v ? 'hsl(215 100% 65%)' : 'var(--muted-foreground)',
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {v === 'none' ? 'Not uploaded' : v === 'all' ? 'All' : v}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            Loading tasks…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            {totalTasks === 0 ? 'No qualifying tasks found. Make sure Monday sync is up to date.' : 'No tasks match the current filter.'}
          </div>
        ) : (
          filtered.map(task => (
            <TaskRow key={task.monday_id} task={task} coverage={coverage} />
          ))
        )}
      </div>

      <p style={{ marginTop: 16, fontSize: 11, color: 'var(--muted-foreground)', textAlign: 'center' }}>
        Scans run automatically every day at 06:00 (Jerusalem time) · Last run shows in server logs
      </p>
    </div>
  )
}
