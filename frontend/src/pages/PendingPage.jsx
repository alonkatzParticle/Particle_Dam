import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function PendingPage() {
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const [cursor, setCursor] = useState(true)
  const [dots, setDots]     = useState('')

  // Blinking cursor
  useEffect(() => {
    const t = setInterval(() => setCursor(c => !c), 530)
    return () => clearInterval(t)
  }, [])

  // Animated waiting dots
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 600)
    return () => clearInterval(t)
  }, [])

  // Poll every 10 s — redirect automatically when role changes
  useEffect(() => {
    const check = async () => {
      try {
        const res  = await fetch('/auth/me', { credentials: 'include' })
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
      background: '#030a03',
      fontFamily: '"Share Tech Mono", "Courier New", monospace',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />

      {/* Scanline overlay */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 1,
        backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,255,0,0.015) 2px, rgba(0,255,0,0.015) 4px)',
      }} />

      {/* Green radial glow */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(0,255,65,0.06) 0%, transparent 70%)',
      }} />

      {/* Vignette */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.75) 100%)',
      }} />

      {/* Content */}
      <div style={{
        position: 'relative', zIndex: 2,
        width: '100%', maxWidth: 660,
        margin: '0 32px',
        padding: '56px 48px',
        textAlign: 'left',
      }}>
        {/* System line */}
        <p style={{
          margin: '0 0 36px', fontSize: 11,
          color: 'rgba(0,255,65,0.35)',
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
        }}>
          PARTICLE_DAM_OS v0.0.1 — ACCESS PENDING
        </p>

        {/* Headline */}
        <h1 style={{
          margin: '0 0 18px',
          fontSize: 'clamp(22px, 4vw, 34px)',
          fontWeight: 400,
          letterSpacing: '0.08em',
          color: '#00ff41',
          textShadow: '0 0 10px rgba(0,255,65,0.9), 0 0 32px rgba(0,255,65,0.45), 0 0 70px rgba(0,255,65,0.15)',
          lineHeight: 1.2,
          fontFamily: 'inherit',
        }}>
          AWAITING AUTHORISATION
          <span style={{ opacity: cursor ? 1 : 0 }}>█</span>
        </h1>

        {/* Status */}
        <p style={{
          margin: '0 0 12px', fontSize: 14,
          color: 'rgba(0,255,65,0.6)',
          letterSpacing: '0.06em',
          fontFamily: 'inherit',
        }}>
          {'> '} Account registered. Waiting for admin approval{dots}
        </p>

        <p style={{
          margin: '0 0 52px', fontSize: 11,
          color: 'rgba(0,255,65,0.28)',
          letterSpacing: '0.1em',
          fontFamily: 'inherit',
        }}>
          YOU WILL BE REDIRECTED AUTOMATICALLY ONCE APPROVED
        </p>

        {/* Sign out */}
        <button
          onClick={handleLogout}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '11px 24px',
            background: 'transparent',
            border: '1px solid rgba(0,255,65,0.3)',
            color: 'rgba(0,255,65,0.5)',
            fontSize: 12,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'all 0.2s ease',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color       = '#00ff41'
            e.currentTarget.style.borderColor = 'rgba(0,255,65,0.8)'
            e.currentTarget.style.boxShadow   = '0 0 20px rgba(0,255,65,0.2)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color       = 'rgba(0,255,65,0.5)'
            e.currentTarget.style.borderColor = 'rgba(0,255,65,0.3)'
            e.currentTarget.style.boxShadow   = 'none'
          }}
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
