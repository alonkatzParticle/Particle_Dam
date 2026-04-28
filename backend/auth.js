'use strict'
const { OAuth2Client } = require('google-auth-library')
const jwt = require('jsonwebtoken')

const CLIENT_ID      = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET  = process.env.GOOGLE_CLIENT_SECRET
const CALLBACK_URL   = process.env.GOOGLE_CALLBACK_URL   || 'https://dam.particle-creative.cloud/auth/google/callback'
const JWT_SECRET     = process.env.JWT_SECRET            || 'dev-secret-change-in-production'
const ALLOWED_DOMAIN = process.env.ALLOWED_EMAIL_DOMAIN  || 'particleformen.com'
const ADMIN_EMAIL    = (process.env.ADMIN_EMAIL          || 'k.alon@particleformen.com').toLowerCase()
const FRONTEND_URL   = process.env.FRONTEND_URL          || ''   // '' = same origin

const oauthClient = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, CALLBACK_URL)

// ── Build Google OAuth redirect URL ────────────────────────────────────────
function getAuthUrl (redirectTo) {
  const state = redirectTo ? Buffer.from(redirectTo).toString('base64url') : ''
  return oauthClient.generateAuthUrl({
    access_type: 'offline',
    scope: ['openid', 'email', 'profile'],
    hd: ALLOWED_DOMAIN,
    state,
  })
}

// ── Exchange code → verify → upsert user → return JWT ──────────────────────
async function handleCallback (code, db) {
  const { tokens } = await oauthClient.getToken(code)
  const ticket = await oauthClient.verifyIdToken({
    idToken: tokens.id_token,
    audience: CLIENT_ID,
  })
  const { email, name, picture } = ticket.getPayload()

  if (!email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`)) {
    throw new Error('EMAIL_NOT_ALLOWED')
  }

  // Upsert
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  if (!user) {
    const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'pending'
    db.prepare(
      'INSERT INTO users (email, name, picture, role) VALUES (?, ?, ?, ?)'
    ).run(email, name, picture, role)
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  } else {
    db.prepare('UPDATE users SET name = ?, picture = ? WHERE email = ?').run(name, picture, email)
    user = db.prepare('SELECT * FROM users WHERE email = ?').get(email)
  }

  // Safety: always ensure admin email has admin role
  if (email.toLowerCase() === ADMIN_EMAIL && user.role !== 'admin') {
    db.prepare("UPDATE users SET role = 'admin' WHERE email = ?").run(email)
    user = { ...user, role: 'admin' }
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '30d' }
  )
  return { token, user }
}

// ── requireAuth middleware factory ─────────────────────────────────────────
function requireAuth (db) {
  return function (req, res, next) {
    const token = req.cookies?.dam_session
    if (!token) return res.status(401).json({ error: 'Not authenticated' })

    try {
      const payload = jwt.verify(token, JWT_SECRET)
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
      if (!user) {
        res.clearCookie('dam_session')
        return res.status(401).json({ error: 'User not found' })
      }
      if (user.role === 'pending') {
        return res.status(403).json({ error: 'Pending approval', code: 'PENDING' })
      }
      req.user = user
      next()
    } catch (e) {
      res.clearCookie('dam_session')
      return res.status(401).json({ error: 'Session expired' })
    }
  }
}

// ── requireAdmin middleware ────────────────────────────────────────────────
function requireAdmin (req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin required' })
  }
  next()
}

module.exports = {
  getAuthUrl,
  handleCallback,
  requireAuth,
  requireAdmin,
  FRONTEND_URL,
  JWT_SECRET,
}
