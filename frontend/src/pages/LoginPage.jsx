import { useEffect, useState } from 'react'
import { useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const ERROR_MESSAGES = {
  domain:    'Access denied — this account is not part of the Particle organisation.',
  cancelled: 'Sign-in was cancelled.',
  error:     'Something went wrong. Please try again.',
}

const HEADLINE = 'WELCOME TO PARTICLE DAM'
const SUBLINE  = 'Please sign in with your Google account'

export default function LoginPage() {
  const [searchParams] = useSearchParams()
  const location   = useLocation()
  const navigate   = useNavigate()
  const { setUser } = useAuth()
  const errorCode  = searchParams.get('error')
  const errorMsg   = errorCode ? ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.error : null
  const from       = location.state?.from?.pathname ?? '/raw/library'
  const authUrl    = `/auth/google?from=${encodeURIComponent(from)}`

  const [popupError, setPopupError] = useState(null)

  const [displayed,    setDisplayed]    = useState('')
  const [subDisplayed, setSubDisplayed] = useState('')
  const [showButton,   setShowButton]   = useState(false)
  const [cursor,       setCursor]       = useState(true)

  // Open Google OAuth in a small centred popup
  const openPopup = () => {
    setPopupError(null)
    const w = 500, h = 640
    const left = Math.round((window.screen.width  - w) / 2)
    const top  = Math.round((window.screen.height - h) / 2)
    window.open(authUrl, 'google-oauth',
      `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no,location=no`)
  }

  // Listen for the postMessage from the popup
  useEffect(() => {
    const handler = (e) => {
      if (e.data?.type !== 'dam-auth') return
      if (e.data.status === 'success') {
        fetch('/auth/me', { credentials: 'include' })
          .then(r => r.json())
          .then(d => {
            setUser(d.user)
            if (d.user?.role === 'pending') navigate('/pending')
            else navigate(e.data.redirectTo || '/raw/library')
          })
      } else {
        setPopupError(e.data.code || 'error')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [navigate, setUser])

  // Typewriter effect
  useEffect(() => {
    let i = 0
    const t = setInterval(() => {
      setDisplayed(HEADLINE.slice(0, ++i))
      if (i >= HEADLINE.length) {
        clearInterval(t)
        let j = 0
        const t2 = setInterval(() => {
          setSubDisplayed(SUBLINE.slice(0, ++j))
          if (j >= SUBLINE.length) {
            clearInterval(t2)
            setTimeout(() => setShowButton(true), 300)
          }
        }, 28)
      }
    }, 55)
    return () => clearInterval(t)
  }, [])

  // Blinking block cursor
  useEffect(() => {
    const t = setInterval(() => setCursor(c => !c), 530)
    return () => clearInterval(t)
  }, [])

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
      {/* Monospace font */}
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
          PARTICLE_DAM_OS v0.0.1 — INITIALISED
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
          {displayed}
          {displayed.length < HEADLINE.length && (
            <span style={{ opacity: cursor ? 1 : 0 }}>█</span>
          )}
        </h1>

        {/* Sub-line */}
        <p style={{
          margin: '0 0 52px', fontSize: 14,
          color: 'rgba(0,255,65,0.6)',
          letterSpacing: '0.06em',
          minHeight: 22,
          fontFamily: 'inherit',
        }}>
          {subDisplayed.length > 0 && '> '}
          {subDisplayed}
          {subDisplayed.length > 0 && subDisplayed.length < SUBLINE.length && (
            <span style={{ opacity: cursor ? 1 : 0 }}>█</span>
          )}
          {subDisplayed.length === SUBLINE.length && (
            <span style={{ opacity: cursor ? 1 : 0 }}>█</span>
          )}
        </p>

        {/* Error from popup */}
        {(errorMsg || popupError) && (
          <div style={{
            marginBottom: 32, padding: '12px 16px',
            border: '1px solid rgba(255,50,50,0.4)',
            background: 'rgba(255,50,50,0.07)',
            color: 'rgba(255,110,110,0.9)',
            fontSize: 12, letterSpacing: '0.04em',
            fontFamily: 'inherit',
          }}>
            ERR › {popupError ? (ERROR_MESSAGES[popupError] ?? ERROR_MESSAGES.error) : errorMsg}
          </div>
        )}

        {/* Google button — fades in after typewriter */}
        <div style={{
          opacity: showButton ? 1 : 0,
          transform: showButton ? 'translateY(0)' : 'translateY(10px)',
          transition: 'opacity 0.5s ease, transform 0.5s ease',
          pointerEvents: showButton ? 'auto' : 'none',
        }}>
          <button
            onClick={openPopup}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              padding: '13px 28px',
              background: 'transparent',
              border: '1px solid rgba(0,255,65,0.45)',
              color: '#00ff41',
              fontSize: 13,
              letterSpacing: '0.12em',
              textDecoration: 'none',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              boxShadow: '0 0 14px rgba(0,255,65,0.12), inset 0 0 14px rgba(0,255,65,0.04)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background    = 'rgba(0,255,65,0.07)'
              e.currentTarget.style.borderColor   = 'rgba(0,255,65,0.9)'
              e.currentTarget.style.boxShadow     = '0 0 28px rgba(0,255,65,0.3), inset 0 0 20px rgba(0,255,65,0.07)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background    = 'transparent'
              e.currentTarget.style.borderColor   = 'rgba(0,255,65,0.45)'
              e.currentTarget.style.boxShadow     = '0 0 14px rgba(0,255,65,0.12), inset 0 0 14px rgba(0,255,65,0.04)'
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Sign in with Google
          </button>

          <p style={{
            marginTop: 20, fontSize: 11,
            color: 'rgba(0,255,65,0.28)',
            letterSpacing: '0.1em',
            fontFamily: 'inherit',
          }}>
            ACCESS RESTRICTED TO @PARTICLEFORMEN.COM
          </p>
        </div>
      </div>
    </div>
  )
}
