import { useEffect, useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { useNavigate } from 'react-router-dom'
import { Shield, Users, ChevronDown } from 'lucide-react'

const ROLE_LABELS = { admin: 'Admin', member: 'Member', pending: 'Pending' }
const ROLE_COLORS = {
  admin:   'hsl(258 70% 65%)',
  member:  'hsl(160 60% 50%)',
  pending: 'hsl(38 90% 55%)',
}

export default function AdminUsersPage() {
  const { user: me } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)

  // Guard: non-admins get kicked out
  useEffect(() => {
    if (me && me.role !== 'admin') navigate('/raw/library', { replace: true })
  }, [me, navigate])

  const load = () => {
    setLoading(true)
    fetch('/api/admin/users', { credentials: 'include' })
      .then(r => r.json())
      .then(d => { setUsers(d.users || []); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(load, [])

  const setRole = async (id, role) => {
    await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    load()
  }

  const remove = async (id) => {
    if (!confirm('Remove this user? They will need to sign in again to get access.')) return
    await fetch(`/api/admin/users/${id}`, { method: 'DELETE', credentials: 'include' })
    load()
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 760, margin: '0 auto', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10,
          background: 'hsl(258 70% 30% / 0.4)',
          border: '1px solid hsl(258 70% 50% / 0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Users size={18} color="hsl(258 70% 65%)" />
        </div>
        <div>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--foreground)' }}>User Management</h1>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted-foreground)' }}>
            Manage who has access to the DAM
          </p>
        </div>
      </div>

      {/* Pending badge */}
      {!loading && users.some(u => u.role === 'pending') && (
        <div style={{
          padding: '12px 16px', borderRadius: 10, marginBottom: 20,
          background: 'hsl(38 90% 50% / 0.12)',
          border: '1px solid hsl(38 90% 50% / 0.3)',
          color: 'hsl(38 90% 65%)', fontSize: 13,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Shield size={14} />
          {users.filter(u => u.role === 'pending').length} user(s) awaiting approval
        </div>
      )}

      {/* Table */}
      <div style={{
        borderRadius: 14, overflow: 'hidden',
        border: '1px solid var(--sidebar-border)',
        background: 'var(--sidebar-bg)',
      }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            Loading…
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted-foreground)', fontSize: 13 }}>
            No users yet
          </div>
        ) : users.map((u, i) => (
          <div key={u.id} style={{
            display: 'flex', alignItems: 'center', gap: 14,
            padding: '14px 20px',
            borderTop: i > 0 ? '1px solid var(--sidebar-border)' : 'none',
          }}>
            {/* Avatar */}
            {u.picture ? (
              <img src={u.picture} alt="" style={{ width: 36, height: 36, borderRadius: '50%', flexShrink: 0 }} />
            ) : (
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: 'var(--sidebar-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, color: 'var(--muted-foreground)',
              }}>
                {u.name?.[0]?.toUpperCase() ?? '?'}
              </div>
            )}

            {/* Name + email */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', marginBottom: 1 }}>
                {u.name || '—'}
                {u.id === me?.id && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--muted-foreground)', fontWeight: 400 }}>
                    (you)
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {u.email}
              </div>
            </div>

            {/* Role badge */}
            <div style={{
              padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600,
              background: ROLE_COLORS[u.role] + '22',
              color: ROLE_COLORS[u.role],
              border: `1px solid ${ROLE_COLORS[u.role]}44`,
              flexShrink: 0,
            }}>
              {ROLE_LABELS[u.role]}
            </div>

            {/* Role selector — disabled for self */}
            {u.id !== me?.id && (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <select
                  value={u.role}
                  onChange={e => setRole(u.id, e.target.value)}
                  style={{
                    appearance: 'none',
                    background: 'var(--background)',
                    border: '1px solid var(--sidebar-border)',
                    borderRadius: 8,
                    padding: '5px 28px 5px 10px',
                    fontSize: 12,
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                  }}
                >
                  <option value="pending">Pending</option>
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <ChevronDown size={12} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--muted-foreground)' }} />
              </div>
            )}

            {/* Remove */}
            {u.id !== me?.id && (
              <button
                onClick={() => remove(u.id)}
                style={{
                  background: 'transparent', border: 'none', padding: '4px 8px',
                  borderRadius: 6, cursor: 'pointer', fontSize: 12,
                  color: 'var(--muted-foreground)',
                  transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'hsl(0 70% 60%)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--muted-foreground)'}
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
