import { useEffect, useState, useCallback, useRef } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, CheckCircle2, XCircle, Clock,
  ChevronDown, ChevronRight, Zap, BarChart3,
  Settings2, PlayCircle, PauseCircle,
} from 'lucide-react'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function api(path, opts = {}) {
  return fetch(`/api/ads${path}`, { credentials: 'include', ...opts })
}

function pct(n, d) { return d ? Math.round((n / d) * 100) : 0 }

function StatusDot({ ok }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: ok ? 'hsl(142 70% 50%)' : 'hsl(0 70% 55%)',
      flexShrink: 0,
    }} />
  )
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 14, padding: '18px 22px',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: accent || 'var(--foreground)' }}>
        {value ?? '—'}
      </p>
      {sub && <p style={{ margin: 0, fontSize: 11, color: 'var(--muted-foreground)' }}>{sub}</p>}
    </div>
  )
}

// ─── File list (expanded per task) ───────────────────────────────────────────

function FileList({ taskId, files }) {
  if (!files) return (
    <div style={{ padding: '10px 20px 10px 45px', fontSize: 12, color: 'var(--muted-foreground)' }}>
      Not yet scanned — click Scan on this task to check.
    </div>
  )
  if (!files.length) return (
    <div style={{ padding: '10px 20px 10px 45px', fontSize: 12, color: 'var(--muted-foreground)' }}>
      No media files indexed for this task.
    </div>
  )
  return (
    <div style={{ padding: '4px 20px 12px 45px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      {files.map(f => (
        <div key={f.filename} style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '6px 10px', borderRadius: 8,
          background: f.uploaded_to_meta ? 'hsl(142 70% 50% / 0.06)' : 'transparent',
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
              act…{f.account_id.slice(-6)}
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

// ─── Single task row ──────────────────────────────────────────────────────────

function TaskRow({ task, coverageFiles, scanStatus, onScan }) {
  const [open, setOpen] = useState(false)

  // Derive summary from coverageFiles
  const total    = coverageFiles?.length ?? 0
  const uploaded = coverageFiles?.filter(f => f.uploaded_to_meta === 1).length ?? 0
  const scanned  = !!coverageFiles

  const statusColor = !scanned           ? 'var(--muted-foreground)'
    : total === 0                        ? 'var(--muted-foreground)'
    : uploaded === total && total > 0    ? 'hsl(142 70% 50%)'
    : uploaded > 0                       ? 'hsl(38 90% 55%)'
    :                                      'hsl(0 70% 55%)'

  const statusLabel = !scanned           ? 'Not scanned'
    : total === 0                        ? 'No media'
    : uploaded === total                 ? 'Uploaded'
    : uploaded > 0                       ? `Partial (${uploaded}/${total})`
    :                                      'Not uploaded'

  const isScanning = scanStatus === 'scanning'

  return (
    <div style={{ borderTop: '1px solid var(--border)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
      }}>
        {/* Expand toggle */}
        <button
          onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--muted-foreground)', flexShrink: 0 }}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>

        {/* Task name */}
        <span style={{ flex: 1, fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--foreground)' }}>
          {task.task_name}
        </span>

        {/* Dept badge */}
        {task.department && (
          <span style={{
            padding: '2px 7px', borderRadius: 20, fontSize: 10, fontWeight: 600,
            background: 'hsl(258 70% 60% / 0.12)', color: 'hsl(258 70% 65%)',
            border: '1px solid hsl(258 70% 60% / 0.2)', flexShrink: 0,
          }}>
            {task.department}
          </span>
        )}

        {/* Files count */}
        <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0, minWidth: 40, textAlign: 'right' }}>
          {task.asset_count} files
        </span>

        {/* Coverage pill */}
        <span style={{
          padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
          background: statusColor + '22', color: statusColor,
          border: `1px solid ${statusColor}44`,
          flexShrink: 0, minWidth: 100, textAlign: 'center',
        }}>
          {isScanning ? 'Scanning…' : statusLabel}
        </span>

        {/* Scan button */}
        <button
          onClick={() => onScan(task.monday_id)}
          disabled={isScanning}
          style={{
            background: 'none', border: '1px solid var(--border)', borderRadius: 6,
            padding: '3px 10px', cursor: isScanning ? 'not-allowed' : 'pointer',
            fontSize: 11, fontWeight: 600,
            color: isScanning ? 'var(--muted-foreground)' : 'hsl(215 100% 65%)',
            flexShrink: 0, transition: 'opacity 0.15s',
            opacity: isScanning ? 0.5 : 1,
          }}
        >
          {isScanning ? '…' : 'Scan'}
        </button>
      </div>

      {open && <FileList taskId={task.monday_id} files={coverageFiles ?? null} />}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MetaCoveragePage() {
  const { user: me } = useAuth()
  const navigate     = useNavigate()

  const [connection, setConnection] = useState(null)
  const [tasks,      setTasks]      = useState([])
  const [loading,    setLoading]    = useState(true)
  // { [taskId]: { files: [...], summary: {...} } | 'scanning' }
  const [taskData,   setTaskData]   = useState({})
  const [filter,     setFilter]     = useState('all')  // all|uploaded|partial|none|unscanned
  const [search,     setSearch]     = useState('')
  const [scanning,   setScanning]   = useState(false)  // bulk scan running
  const [scanIdx,    setScanIdx]    = useState(null)    // current bulk scan index
  const stopRef = useRef(false)

  // Admin guard
  useEffect(() => {
    if (me && me.role !== 'admin') navigate('/ads/library', { replace: true })
  }, [me, navigate])

  // Load Meta connection settings
  useEffect(() => {
    api('/coverage/settings')
      .then(r => r.ok ? r.json() : null)
      .then(setConnection)
      .catch(() => {})
  }, [])

  // Load qualifying tasks (instant — from server RAM cache)
  const loadTasks = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await api('/coverage/qualifying-tasks')
      const data = res.ok ? await res.json() : { tasks: [] }
      setTasks(data.tasks || [])
      setLoading(false)  // ← show task list immediately, don't wait for coverage

      // Load existing coverage summaries in background (non-blocking)
      const ids = (data.tasks || []).map(t => t.monday_id).filter(Boolean)
      if (ids.length) {
        const covRes = await api('/coverage/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskIds: ids }),
        })
        if (covRes.ok) {
          const batchSummary = await covRes.json()
          const initial = {}
          for (const [taskId, summary] of Object.entries(batchSummary)) {
            if (summary.total > 0) {
              initial[taskId] = { files: null, summary, preloaded: true }
            }
          }
          setTaskData(initial)
        }
      }
    } catch {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadTasks() }, [loadTasks])

  // ── Single task scan ──────────────────────────────────────────────────────

  const scanOne = useCallback(async (taskId) => {
    setTaskData(prev => ({ ...prev, [taskId]: 'scanning' }))
    try {
      const res  = await api(`/coverage/scan/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const data = res.ok ? await res.json() : null
      setTaskData(prev => ({
        ...prev,
        [taskId]: data?.coverage
          ? { files: data.coverage.files, summary: data.coverage.summary }
          : prev[taskId] === 'scanning' ? null : prev[taskId],
      }))
    } catch {
      setTaskData(prev => ({ ...prev, [taskId]: null }))
    }
  }, [])

  // ── Bulk scan (one by one) ────────────────────────────────────────────────

  const handleScanAll = async () => {
    if (scanning) { stopRef.current = true; return }
    stopRef.current = false
    setScanning(true)

    const toScan = filtered.filter(t => {
      const d = taskData[t.monday_id]
      // Skip tasks already fully confirmed uploaded
      if (d && d !== 'scanning' && d.summary?.uploaded === d.summary?.total && d.summary?.total > 0) return false
      return true
    })

    for (let i = 0; i < toScan.length; i++) {
      if (stopRef.current) break
      setScanIdx(i)
      await scanOne(toScan[i].monday_id)
      await new Promise(r => setTimeout(r, 300)) // small pause between tasks
    }

    setScanIdx(null)
    setScanning(false)
  }

  // ── Derived stats ─────────────────────────────────────────────────────────

  const totalTasks    = tasks.length
  const scannedTasks  = Object.entries(taskData).filter(([, v]) => v && v !== 'scanning').length
  const uploadedAll   = Object.entries(taskData).filter(([, v]) => {
    if (!v || v === 'scanning') return false
    const s = v.summary || {}
    return s.total > 0 && s.uploaded === s.total
  }).length
  const partialTasks  = Object.entries(taskData).filter(([, v]) => {
    if (!v || v === 'scanning') return false
    const s = v.summary || {}
    return s.uploaded > 0 && s.uploaded < s.total
  }).length
  const totalFiles    = Object.values(taskData).reduce((s, v) => s + (v?.summary?.total    ?? 0), 0)
  const uploadedFiles = Object.values(taskData).reduce((s, v) => s + (v?.summary?.uploaded ?? 0), 0)

  // ── Filtered task list ────────────────────────────────────────────────────

  const filtered = tasks.filter(t => {
    const d = taskData[t.monday_id]
    const matchSearch = !search || t.task_name.toLowerCase().includes(search.toLowerCase())
    if (!matchSearch) return false
    if (filter === 'unscanned') return !d || d === null
    if (filter === 'uploaded') {
      const s = d?.summary
      return s && s.total > 0 && s.uploaded === s.total
    }
    if (filter === 'partial') {
      const s = d?.summary
      return s && s.uploaded > 0 && s.uploaded < s.total
    }
    if (filter === 'none') {
      const s = d?.summary
      return !s || s.uploaded === 0
    }
    return true
  })

  return (
    <div style={{
      padding: '28px 36px', maxWidth: 1100, margin: '0 auto',
      fontFamily: 'Inter, system-ui, sans-serif', color: 'var(--foreground)',
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 42, height: 42, borderRadius: 12,
            background: 'hsl(215 100% 55% / 0.15)',
            border: '1px solid hsl(215 100% 55% / 0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BarChart3 size={20} color="hsl(215 100% 65%)" />
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Meta Coverage</h1>
            <p style={{ margin: 0, fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
              Video Marketing + Design Marketing · Done/Completed tasks
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={loadTasks} style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '7px 14px', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 500, color: 'var(--foreground)',
          }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={handleScanAll} disabled={loading} style={{
            background: scanning ? 'hsl(0 70% 55% / 0.8)' : 'hsl(215 100% 55%)',
            border: 'none', borderRadius: 8, padding: '7px 16px',
            cursor: loading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 600, color: '#fff',
          }}>
            {scanning
              ? <><PauseCircle size={13} /> Stop ({scanIdx + 1}/{filtered.length})</>
              : <><PlayCircle size={13} /> Scan All ({filtered.length})</>
            }
          </button>
        </div>
      </div>

      {/* ── Connection status ── */}
      <div style={{
        padding: '12px 18px', borderRadius: 12, marginBottom: 22,
        background: 'var(--card)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      }}>
        <Settings2 size={13} style={{ color: 'var(--muted-foreground)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted-foreground)' }}>
          Meta
        </span>
        <StatusDot ok={connection?.configured} />
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {connection === null ? 'Checking…'
            : connection.configured
              ? `Connected · ${connection.accountCount} ad accounts`
              : 'Not configured — check coverage_settings.json'}
        </span>
      </div>

      {/* ── Stats ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 14, marginBottom: 24,
      }}>
        <StatCard label="Tasks"         value={loading ? '…' : totalTasks}    sub="Marketing + Done" />
        <StatCard label="Scanned"       value={scannedTasks}                   sub={`${pct(scannedTasks, totalTasks)}% checked`} />
        <StatCard label="Fully Uploaded" value={uploadedAll}                   sub="All files on Meta" accent="hsl(142 70% 50%)" />
        <StatCard label="Partial"        value={partialTasks}                  sub="Some missing" accent="hsl(38 90% 55%)" />
        <StatCard label="Files on Meta"  value={uploadedFiles}                 sub={`of ${totalFiles} scanned`} accent="hsl(215 100% 65%)" />
      </div>

      {/* ── Task list ── */}
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' }}>
        {/* List header */}
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
            {loading ? 'Loading tasks…' : `${filtered.length} of ${totalTasks} tasks`}
          </span>

          <input
            type="text" placeholder="Search tasks…" value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'var(--background)', border: '1px solid var(--border)',
              borderRadius: 8, padding: '5px 10px', fontSize: 11,
              color: 'var(--foreground)', outline: 'none', width: 180,
            }}
          />

          {['all', 'unscanned', 'uploaded', 'partial', 'none'].map(v => (
            <button key={v} onClick={() => setFilter(v)} style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600,
              border: '1px solid',
              borderColor: filter === v ? 'hsl(215 100% 55%)' : 'var(--border)',
              background:  filter === v ? 'hsl(215 100% 55% / 0.12)' : 'transparent',
              color:       filter === v ? 'hsl(215 100% 65%)' : 'var(--muted-foreground)',
              cursor: 'pointer', textTransform: 'capitalize',
            }}>
              {v === 'none' ? 'Not uploaded' : v === 'all' ? 'All' : v}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            Loading qualifying tasks…
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            {totalTasks === 0
              ? 'No qualifying tasks found. Make sure Monday sync is up to date.'
              : 'No tasks match the current filter.'}
          </div>
        ) : (
          filtered.map(task => {
            const d = taskData[task.monday_id]
            const files   = d && d !== 'scanning' ? (d.files ?? null) : null
            const scanSt  = d === 'scanning' ? 'scanning'
              : task.monday_id === (filtered[scanIdx]?.monday_id) && scanning ? 'scanning'
              : 'idle'
            return (
              <TaskRow
                key={task.monday_id}
                task={task}
                coverageFiles={files}
                scanStatus={scanSt}
                onScan={scanOne}
              />
            )
          })
        )}
      </div>

      <p style={{ marginTop: 14, fontSize: 10, color: 'var(--muted-foreground)', textAlign: 'center' }}>
        Daily scan runs at 06:00 (Jerusalem) · Token: {connection?.configured ? '✓ valid' : '✗ not configured'}
      </p>
    </div>
  )
}
