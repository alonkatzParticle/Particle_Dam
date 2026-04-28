import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function PendingPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()

  // Poll every 10 seconds — if an admin approves the account,
  // the role will change and we redirect automatically.
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/auth/me', { credentials: 'include' })
        const data = await res.json()
        if (data?.user && data.user.role !== 'pending') {
          setUser(data.user)
          navigate('/raw/library')
        }
      } catch (_) {}
    }

    const id = setInterval(check, 10_000)
    return () => clearInterval(id)
  }, [navigate, setUser])

  const handleLogout = async () => {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' })
    window.location.href = '/login'
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--background)',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{
        maxWidth: 420,
        margin: '0 24px',
        padding: '48px 40px',
        borderRadius: 20,
        background: 'var(--sidebar-bg)',
        border: '1px solid var(--sidebar-border)',
        boxShadow: '0 32px 80px -12px rgba(0,0,0,0.5)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 20 }}>⏳</div>
        <h1 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 700, color: 'var(--foreground)' }}>
          Awaiting Access
        </h1>
        <p style={{ margin: '0 0 32px', fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>
          Your account has been registered. An admin will grant you access shortly.
          You'll be redirected automatically once approved.
        </p>
        <button
          onClick={handleLogout}
          style={{
            background: 'transparent',
            border: '1px solid var(--sidebar-border)',
            borderRadius: 10,
            padding: '10px 20px',
            color: 'var(--muted-foreground)',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
