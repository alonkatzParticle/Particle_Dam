// server.js — Unified Asset + Ad Library API
// Two databases, one Express server, one port.
//   /api/raw/*  → asset_library.db  (Raw Files from Dropbox /Video Assets)
//   /api/ads/*  → ad_library.db     (Final Assets from Monday → Dropbox /Marketing Ads)

require('dotenv').config();

process.on('uncaughtException',  err    => console.error('[Server] Uncaught exception:', err.message));
process.on('unhandledRejection', reason => console.error('[Server] Unhandled rejection:', reason?.message || reason));

const express      = require('express');
const cors         = require('cors');
const cookieParser = require('cookie-parser');
const multer       = require('multer');
const path         = require('path');
const jwt          = require('jsonwebtoken');
const Anthropic = require('@anthropic-ai/sdk');

const makeDb             = require('./makeDb');
const makeSync           = require('./makeSync');
const { getAuthUrl, handleCallback, requireAuth, requireAdmin, FRONTEND_URL, JWT_SECRET } = require('./auth');
const makeUploadWatcher  = require('./makeUploadWatcher');
const { getTemporaryLink, getThumbnailResponse, getSharedLink, uploadToDropbox,
        isThumbnailable, getDropboxToken, encodeDropboxArg,
        moveDropboxFile, createDropboxFolder } = require('./dropbox_lib');
const { runMondaySync, getMondaySyncStatus, resolveDropboxPaths } = require('./monday_sync');
const { computeEmbedding, cosineSimilarity } = require('./embeddings');
const { extractVideoFrames } = require('./ffmpeg_lib');

// ─── Database instances ────────────────────────────────────────────────────────

const RAW_DB_PATH   = process.env.RAW_DB_PATH   || path.resolve(__dirname, './asset_library.db');
const ADS_DB_PATH   = process.env.ADS_DB_PATH   || path.resolve(__dirname, '../../Ad Library/backend/ad_library.db');
const BRAND_DB_PATH = process.env.BRAND_DB_PATH || path.resolve(__dirname, './brand_library.db');
const RAW_ROOT      = process.env.DROPBOX_ROOT_PATH       || '/Creative 2026/Video Assets';
const BRAND_ROOT    = process.env.BRAND_DROPBOX_ROOT_PATH || '/Creative 2026/DAM/Brand Kit';

const raw   = makeDb(RAW_DB_PATH);
const ads   = makeDb(ADS_DB_PATH);
const brand = makeDb(BRAND_DB_PATH);

// ─── Sync instances ────────────────────────────────────────────────────────────

const rawSync   = makeSync(raw,   RAW_ROOT);
const brandSync = makeSync(brand, BRAND_ROOT);
const uploadWatcher = makeUploadWatcher(raw.db, rawSync);

// ─── Express setup ────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });

// ─── Google OAuth routes ──────────────────────────────────────────────────────

const authHtml = (script) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Signing in…</title></head>` +
  `<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#030a03;color:#00ff41;">` +
  `<p>Signing in…</p><script>${script}</scr` + `ipt></body></html>`

app.get('/auth/google', (req, res) => {
  const from = req.query.from || ''
  res.redirect(getAuthUrl(from));
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error, state } = req.query;

  // Decode intended destination from OAuth state
  let redirectTo = '/raw/library'
  if (state) {
    try { redirectTo = Buffer.from(state, 'base64url').toString('utf8') || redirectTo } catch (_) {}
  }

  if (error || !code) {
    return res.send(authHtml(`
      (function(){
        var d={type:'dam-auth',status:'error',code:'cancelled'};
        try{var bc=new BroadcastChannel('dam-auth');bc.postMessage(d);bc.close();}catch(e){}
        try{if(window.opener)window.opener.postMessage(d,'*');}catch(e){}
        window.close();
      })()
    `))
  }

  try {
    const { token, user } = await handleCallback(code, raw.db);
    res.cookie('dam_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    // The popup fetches /auth/me itself (it has the cookie) then passes the
    // full user to the parent — avoids any cross-window cookie timing issues.
    const userData = { id: user.id, email: user.email, name: user.name, picture: user.picture, role: user.role };
    const fallback = JSON.stringify(userData);
    res.send(authHtml(`
      fetch('/auth/me', { credentials: 'include' })
        .then(r => r.json())
        .then(d => {
          var u = (d && d.user) ? d.user : ${fallback};
          var msg = {type:'dam-auth',status:'success',user:u,redirectTo:${JSON.stringify(redirectTo)}};
          try{var bc=new BroadcastChannel('dam-auth');bc.postMessage(msg);bc.close();}catch(e){}
          try{if(window.opener)window.opener.postMessage(msg,'*');}catch(e){}
          window.close();
        })
        .catch(function(){
          var msg = {type:'dam-auth',status:'success',user:${fallback},redirectTo:${JSON.stringify(redirectTo)}};
          try{var bc=new BroadcastChannel('dam-auth');bc.postMessage(msg);bc.close();}catch(e){}
          try{if(window.opener)window.opener.postMessage(msg,'*');}catch(e){}
          window.close();
        });
    `))
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err.message);
    const code = err.message === 'EMAIL_NOT_ALLOWED' ? 'domain' : 'error';
    res.send(authHtml(`
      (function(){
        var d={type:'dam-auth',status:'error',code:'${code}'};
        try{var bc=new BroadcastChannel('dam-auth');bc.postMessage(d);bc.close();}catch(e){}
        try{if(window.opener)window.opener.postMessage(d,'*');}catch(e){}
        window.close();
      })()
    `))
  }
});



app.post('/auth/logout', (req, res) => {
  res.clearCookie('dam_session');
  res.json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  const token = req.cookies?.dam_session
  if (!token) return res.json({ user: null })
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    const user = raw.db.prepare('SELECT id, email, name, picture, role FROM users WHERE id = ?').get(payload.id)
    if (!user) {
      res.clearCookie('dam_session')
      return res.json({ user: null })
    }
    res.json({ user })
  } catch (err) {
    res.clearCookie('dam_session')
    res.json({ user: null })
  }
});

// ─── Admin: user management ───────────────────────────────────────────────────

app.get('/api/admin/users', requireAuth(raw.db), requireAdmin, (_req, res) => {
  const users = raw.db.prepare('SELECT id, email, name, picture, role, created_at FROM users ORDER BY created_at ASC').all();
  res.json({ users });
});

app.patch('/api/admin/users/:id', requireAuth(raw.db), requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!['admin', 'member', 'pending'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  raw.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAuth(raw.db), requireAdmin, (req, res) => {
  raw.db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ─── Protect all /api/* routes ────────────────────────────────────────────────

app.use('/api', requireAuth(raw.db));

// ─── Helper: mount all standard asset routes on a given prefix + db ───────────
// This avoids duplicating 300+ lines of route code for raw vs ads.

function mountAssetRoutes(prefix, db, opts = {}) {
  const { assetOps, tagOps, linkOps, syncOps } = db;

  // ── Tags ──────────────────────────────────────────────────────────────────
  app.get(`${prefix}/tags`, (_req, res) => {
    try { res.json(tagOps.getAll()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Containers (Products + Bundles for sidebar) ───────────────────────────
  app.get(`${prefix}/containers`, (_req, res) => {
    try { res.json(assetOps.getContainers()); }
    catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Assets list ───────────────────────────────────────────────────────────
  app.get(`${prefix}/assets`, (req, res) => {
    try {
      const { search = '', tags = '', ext = '', ai_tags = '', untagged = '',
              monday_linked = '', container_name = '', content_type = '',
              platform = '', campaign = '', monday_product = '',
              sort = 'newest', page = '1', limit = '60' } = req.query;
      // Fast single-asset lookup by dropbox_id (used for deep-link URL restore)
      if (req.query.dropbox_id) {
        const asset = db.db.prepare('SELECT * FROM assets WHERE dropbox_id = ?').get(req.query.dropbox_id);
        return res.json({ assets: asset ? [asset] : [], total: asset ? 1 : 0, pages: 1, page: 1 });
      }

      const result = assetOps.query({
        search,
        tagIds:        tags    ? tags.split(',').map(Number).filter(Boolean) : [],
        extensions:    ext     ? ext.split(',').filter(Boolean) : [],
        aiTags:        ai_tags ? ai_tags.split(',').filter(Boolean) : [],
        untagged:      untagged === 'true',
        mondayLinked:  monday_linked === 'true' ? true : monday_linked === 'false' ? false : null,
        containerName: container_name  || null,
        contentType:   content_type    || null,
        platform:      platform        || null,
        campaign:      campaign        || null,
        mondayProduct: monday_product  || null,
        sort,
        page:  parseInt(page)  || 1,
        limit: parseInt(limit) || 60,
      });
      result.assets = result.assets.map(a => ({
        ...a,
        monday: a.monday_json ? JSON.parse(a.monday_json) : null,
      }));
      res.json(result);
    } catch (err) {
      console.error(`[${prefix}/assets]`, err);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Stats ─────────────────────────────────────────────────────────────────
  app.get(`${prefix}/assets/stats`, (_req, res) => {
    try {
      res.json({
        byExtension: assetOps.countByExtension(),
        tagCount:    tagOps.getAll().length,
        lastSync:    syncOps.get('last_full_sync'),
      });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Single asset by ID ────────────────────────────────────────────────────
  app.get(`${prefix}/assets/:id`, (req, res) => {
    try {
      const asset = db.db.prepare('SELECT * FROM assets WHERE id = ?').get(parseInt(req.params.id));
      if (!asset) return res.status(404).json({ error: 'Not found' });
      res.json(asset);
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Thumbnail ─────────────────────────────────────────────────────────────
  app.get(`${prefix}/assets/:id/thumbnail`, async (req, res) => {
    try {
      const asset = db.db.prepare('SELECT * FROM assets WHERE id = ? OR dropbox_id = ?')
        .get(req.params.id, req.params.id);
      if (!asset) return res.status(404).end();

      const ext = (asset.extension || '').toLowerCase();

      // SVG & PNG: download raw file — browser renders with true transparency
      if (ext === 'svg' || ext === 'png') {
        const token = await getDropboxToken();
        const rawRes = await fetch('https://content.dropboxapi.com/2/files/download', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Dropbox-API-Arg': encodeDropboxArg({ path: asset.path }),
          },
        });
        if (!rawRes.ok) return res.status(204).end();
        res.setHeader('Content-Type', ext === 'svg' ? 'image/svg+xml' : 'image/png');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const { Readable } = require('stream');
        return Readable.fromWeb(rawRes.body).pipe(res);
      }

      if (!isThumbnailable(asset.extension)) return res.status(204).end();
      const dropboxRes = await getThumbnailResponse(asset.path, req.query.size || 'w960h640');
      if (!dropboxRes) return res.status(204).end();
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      const { Readable } = require('stream');
      Readable.fromWeb(dropboxRes.body).pipe(res);
    } catch { res.status(204).end(); }
  });

  // ── Preview (temp link) ───────────────────────────────────────────────────
  app.get(`${prefix}/assets/:id/preview`, async (req, res) => {
    try {
      const asset = db.db.prepare('SELECT * FROM assets WHERE id = ? OR dropbox_id = ?')
        .get(req.params.id, req.params.id);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      const cached = linkOps.get(asset.path);
      if (cached) return res.json({ url: cached });
      const url = await getTemporaryLink(asset.path);
      linkOps.set(asset.path, url, new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString());
      res.json({ url });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Share link ────────────────────────────────────────────────────────────
  app.get(`${prefix}/assets/:id/share`, async (req, res) => {
    try {
      const asset = db.db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      res.json({ url: await getSharedLink(asset.path) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  // ── Download ──────────────────────────────────────────────────────────────
  app.get(`${prefix}/assets/:id/download`, async (req, res) => {
    const { pipeline } = require('stream/promises');
    const { Readable } = require('stream');
    try {
      const asset = db.db.prepare('SELECT * FROM assets WHERE id = ?').get(req.params.id);
      if (!asset) return res.status(404).json({ error: 'Asset not found' });
      const token = await getDropboxToken();
      const upstream = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Dropbox-API-Arg': encodeDropboxArg({ path: asset.path }) },
      });
      if (!upstream.ok) return res.status(502).json({ error: 'Dropbox download failed' });
      const safe = encodeURIComponent(asset.name).replace(/['()]/g, encodeURIComponent);
      res.setHeader('Content-Disposition', `attachment; filename="${asset.name}"; filename*=UTF-8''${safe}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      await pipeline(Readable.fromWeb(upstream.body), res);
    } catch (err) {
      if (!res.headersSent) res.status(500).json({ error: err.message });
    }
  });

  // ── Single-asset AI tagging ────────────────────────────────────────────────
  app.post(`${prefix}/assets/:id/ai-tags/generate`, async (req, res) => {
    try {
      const result = await tagSingleAsset(req.params.id, db);
      res.json({ ok: true, ...result, ai_tagged_at: new Date().toISOString() });
    } catch (err) {
      console.error('[ai-tags/generate]', err);
      res.status(500).json({ error: err.message });
    }
  });
}

// ─── Mount routes for both databases ─────────────────────────────────────────

mountAssetRoutes('/api/raw',   raw);
mountAssetRoutes('/api/ads',   ads);
mountAssetRoutes('/api/brand', brand);

// ─── Raw-only: Dropbox sync ───────────────────────────────────────────────────

app.post('/api/raw/sync', (_req, res) => {
  const status = rawSync.getSyncStatus();
  res.json({ started: true, alreadyRunning: status.running });
  if (!status.running) rawSync.runFullSync().catch(err => console.error('[Sync]', err.message));
});

app.get('/api/raw/sync/status', (_req, res) => {
  const status = rawSync.getSyncStatus();
  res.json({ ...status, lastFullSync: raw.syncOps.get('last_full_sync') });
});

// Ads has no Dropbox crawl sync — return idle so AppLayout polling doesn't throw
app.get('/api/ads/sync/status', (_req, res) => {
  res.json({ running: false, phase: 'idle', lastFullSync: null });
});

// Brand Kit sync
app.post('/api/brand/sync', (_req, res) => {
  const status = brandSync.getSyncStatus();
  res.json({ started: true, alreadyRunning: status.running });
  if (!status.running) brandSync.runFullSync().catch(err => console.error('[Brand Sync]', err.message));
});
app.get('/api/brand/sync/status', (_req, res) => {
  res.json({ ...brandSync.getSyncStatus(), lastFullSync: brand.syncOps.get('last_full_sync') });
});

// ─── Upload approval queue ──────────────────────────────────────────────────

app.get('/api/uploads/pending', (_req, res) => {
  try { res.json(uploadWatcher.getPending()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/uploads/all', (_req, res) => {
  try { res.json(uploadWatcher.getAll()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/uploads/count', (_req, res) => {
  try { res.json({ count: uploadWatcher.getPendingCount() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/uploads/scan', async (_req, res) => {
  try {
    const result = await uploadWatcher.scan();
    res.json({ ok: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/uploads/:id/approve', async (req, res) => {
  try {
    const result = await uploadWatcher.approve(parseInt(req.params.id));
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

app.post('/api/uploads/:id/reject', async (req, res) => {
  try {
    const { reason } = req.body || {};
    const result = await uploadWatcher.reject(parseInt(req.params.id), reason);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Thumbnail for pending uploads — file is in Upload/, not in assets table yet
app.get('/api/uploads/:id/thumbnail', async (req, res) => {
  try {
    const record = raw.db.prepare('SELECT * FROM pending_uploads WHERE id = ?').get(parseInt(req.params.id));
    if (!record) return res.status(404).end();
    if (!isThumbnailable(record.extension)) return res.status(204).end();
    const dropboxRes = await getThumbnailResponse(record.dropbox_path, req.query.size || 'w640h480');
    if (!dropboxRes) return res.status(204).end();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const { Readable } = require('stream');
    Readable.fromWeb(dropboxRes.body).pipe(res);
  } catch { res.status(204).end(); }
});

// Temporary preview link for pending uploads (4 hour Dropbox temp link)
app.get('/api/uploads/:id/preview', async (req, res) => {
  try {
    const record = raw.db.prepare('SELECT * FROM pending_uploads WHERE id = ?').get(parseInt(req.params.id));
    if (!record) return res.status(404).json({ error: 'Not found' });
    const url = await getTemporaryLink(record.dropbox_path);
    res.json({ url, name: record.name, media_type: record.media_type });
  } catch (err) { res.status(500).json({ error: err.message }); }
});


// Raw tag-jobs (AI bulk tagging on raw assets)
let rawTagJob = null;
app.post('/api/raw/tag-jobs', (req, res) => {
  if (rawTagJob?.status === 'running') return res.status(409).json({ error: 'A job is already running' });
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  runTagJob(ids, raw, job => { rawTagJob = job; }).catch(err => console.error('[BulkTag]', err.message));
  res.json({ ok: true, total: ids.length });
});
app.get('/api/raw/tag-jobs/status', (_req, res) => res.json(rawTagJob || { status: 'idle' }));
app.delete('/api/raw/tag-jobs', (_req, res) => { if (rawTagJob?.status === 'running') rawTagJob.cancelled = true; res.json({ ok: true }); });

// Raw upload
app.post('/api/raw/upload', upload.array('files', 20), async (req, res) => {
  try {
    const { targetPath } = req.body;
    if (!targetPath) return res.status(400).json({ error: 'targetPath is required' });
    if (!req.files?.length) return res.status(400).json({ error: 'No files provided' });
    const fullTarget = `${RAW_ROOT}/${targetPath}`.replace(/\/+/g, '/');
    const results = [];
    for (const file of req.files) {
      results.push({ name: file.originalname, ...await uploadToDropbox(file.buffer, file.originalname, fullTarget) });
    }
    rawSync.runIncrementalSync().catch(err => console.error('[upload-sync]', err.message));
    res.json({ ok: true, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Raw AI tag suggestions
app.post('/api/raw/ai/suggest-tags', async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
    const { filename, mimeType = '', thumbnailBase64 = null } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename required' });
    const tags = raw.tagOps.getAll();
    if (!tags.length) return res.json({ suggestions: [] });
    const tagTree = tags.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name))
      .map(t => `  ${'  '.repeat(t.depth - 1)}[${t.id}] ${t.path}`).join('\n');
    const client = new Anthropic({ apiKey });
    const messages = [{ role: 'user', content: [] }];
    if (thumbnailBase64?.startsWith('data:image/')) {
      messages[0].content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: thumbnailBase64.split(',')[1] } });
    }
    messages[0].content.push({ type: 'text', text: `You are helping categorize a creative asset for a video production studio.\nFile: "${filename}"\nType: ${mimeType}\nAvailable folder tags:\n${tagTree}\nSuggest 1-3 most appropriate tag IDs. Reply ONLY with a JSON array of numbers. Example: [3, 7]` });
    const response = await client.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 128, messages });
    const raw2 = response.content[0]?.text?.trim() || '[]';
    const ids = JSON.parse(raw2.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim());
    res.json({ suggestions: tags.filter(t => ids.includes(t.id)) });
  } catch (err) { res.json({ suggestions: [] }); }
});

// ─── Ads-only: Task-grouped view ─────────────────────────────────────────────

app.get('/api/ads/tasks', (req, res) => {
  try {
    const { search = '', product = '', platform = '', campaign = '', board = '',
            page = '1', limit = '30' } = req.query;
    const pg = parseInt(page) || 1;
    const lm = Math.min(parseInt(limit) || 30, 100);
    const offset = (pg - 1) * lm;

    const conditions = [
      `monday_id IS NOT NULL`,
      `(deleted IS NULL OR deleted = 0)`,
    ];
    const params = [];

    if (search) {
      conditions.push(`JSON_EXTRACT(monday_json, '$.name') LIKE ?`);
      params.push(`%${search}%`);
    }
    if (product) {
      conditions.push(`JSON_EXTRACT(monday_json, '$.product') = ?`);
      params.push(product);
    }
    if (platform) {
      conditions.push(`JSON_EXTRACT(monday_json, '$.platform') = ?`);
      params.push(platform);
    }
    if (campaign) {
      conditions.push(`JSON_EXTRACT(monday_json, '$.campaign') = ?`);
      params.push(campaign);
    }
    if (board) {
      conditions.push(`JSON_EXTRACT(monday_json, '$.board_id') = ?`);
      params.push(board);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = ads.db.prepare(`
      SELECT COUNT(DISTINCT monday_id) AS total
      FROM assets ${where}
    `).get(...params);
    const total = countRow?.total || 0;
    const pages = Math.ceil(total / lm) || 1;

    const rows = ads.db.prepare(`
      SELECT
        monday_id,
        JSON_EXTRACT(monday_json, '$.name')        AS task_name,
        JSON_EXTRACT(monday_json, '$.product')     AS product,
        JSON_EXTRACT(monday_json, '$.platform')    AS platform,
        JSON_EXTRACT(monday_json, '$.campaign')    AS campaign,
        JSON_EXTRACT(monday_json, '$.status')      AS status,
        JSON_EXTRACT(monday_json, '$.department')  AS department,
        JSON_EXTRACT(monday_json, '$.board_id')    AS board_id,
        JSON_EXTRACT(monday_json, '$.timeline_end') AS timeline_end,
        JSON_EXTRACT(monday_json, '$.frame_url')   AS frame_url,
        JSON_EXTRACT(monday_json, '$.project_url') AS project_url,
        JSON_EXTRACT(monday_json, '$.dropbox_url') AS dropbox_url,
        COUNT(*) AS asset_count,
        json_group_array(json_object(
          'id', id,
          'name', name,
          'path', path,
          'extension', extension,
          'dropbox_id', dropbox_id,
          'size', size,
          'monday_json', monday_json
        )) AS assets_json
      FROM assets ${where}
      GROUP BY monday_id
      ORDER BY
        CASE WHEN MAX(JSON_EXTRACT(monday_json, '$.timeline_end')) IS NULL THEN 1 ELSE 0 END,
        MAX(JSON_EXTRACT(monday_json, '$.timeline_end')) DESC,
        MAX(modified_at) DESC
      LIMIT ? OFFSET ?
    `).all(...params, lm, offset);

    const tasks = rows.map(r => ({
      monday_id:   r.monday_id,
      task_name:   r.task_name,
      product:     r.product,
      platform:    r.platform,
      campaign:    r.campaign,
      status:      r.status,
      department:  r.department,
      board_id:    r.board_id,
      timeline_end: r.timeline_end,
      frame_url:   r.frame_url,
      project_url: r.project_url,
      dropbox_url: r.dropbox_url,
      asset_count: r.asset_count,
      assets: JSON.parse(r.assets_json || '[]').map(a => ({
        ...a,
        monday: a.monday_json ? JSON.parse(a.monday_json) : null,
        monday_json: undefined,
      })),
    }));

    res.json({ tasks, total, page: pg, pages });
  } catch (err) {
    console.error('[/api/ads/tasks]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Ads-only: Available boards ───────────────────────────────────────────────

app.get('/api/ads/boards', (_req, res) => {
  const boards = [
    { id: process.env.MONDAY_BOARD_ID,       label: 'Video' },
    { id: process.env.MONDAY_IMAGE_BOARD_ID, label: 'Image / Design' },
  ].filter(b => b.id);
  res.json({ boards });
});

// ─── Ads-only: Departments (for filter dropdown) ──────────────────────────────

app.get('/api/ads/monday/departments', (_req, res) => {
  try {
    const rows = ads.db.prepare(`
      SELECT DISTINCT JSON_EXTRACT(monday_json, '$.department') AS dept
      FROM assets
      WHERE monday_id IS NOT NULL
        AND JSON_EXTRACT(monday_json, '$.department') IS NOT NULL
        AND (deleted IS NULL OR deleted = 0)
      ORDER BY dept
    `).all();
    res.json(rows.map(r => r.dept).filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Ads-only: Meta Coverage ──────────────────────────────────────────────────

const {
  scanTask: coverageScanTask,
  runBatchScan,
  refreshCoverageForTasks,
  getTaskCoverage,
  getBatchCoverage,
  loadSettings: loadCoverageSettings,
  batchRunning: isBatchRunning,
} = require('./meta_coverage');

// GET /api/ads/coverage/:taskId — file-level coverage for one task
app.get('/api/ads/coverage/:taskId', requireAuth, (req, res) => {
  try {
    const data = getTaskCoverage(ads.db, req.params.taskId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ads/coverage/batch — summary for multiple tasks (used by grid filter)
app.post('/api/ads/coverage/batch', requireAuth, (req, res) => {
  try {
    const { taskIds } = req.body;
    if (!Array.isArray(taskIds)) return res.status(400).json({ error: 'taskIds must be an array' });
    res.json(getBatchCoverage(ads.db, taskIds));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/ads/coverage/refresh — background refresh for visible tasks (fire & forget)
app.post('/api/ads/coverage/refresh', requireAuth, (req, res) => {
  const { taskIds } = req.body || {};
  res.json({ started: true });
  // Run in background — don't await
  refreshCoverageForTasks(ads.db, taskIds || []).catch(e =>
    console.error('[Coverage] refresh error:', e.message)
  );
});

// POST /api/ads/coverage/scan/all — manual trigger for full batch scan
app.post('/api/ads/coverage/scan/all', requireAuth, (req, res) => {
  res.json({ started: true, alreadyRunning: isBatchRunning() });
  if (!isBatchRunning()) {
    runBatchScan(ads.db).catch(e => console.error('[Coverage] batch error:', e.message));
  }
});

// GET /api/ads/coverage/settings — check if Meta is configured
app.get('/api/ads/coverage/settings', requireAuth, (_req, res) => {
  const { metaToken, metaAccountIds, metaAccountNames } = loadCoverageSettings();
  res.json({
    configured: !!(metaToken && metaAccountIds?.length),
    accountCount: metaAccountIds?.length || 0,
    accounts: metaAccountNames || {},
  });
});

// ─── Daily cron: batch Meta coverage scan at 06:00 ───────────────────────────

const cron = require('node-cron');
cron.schedule('0 6 * * *', () => {
  console.log('[Coverage] Starting scheduled daily scan…');
  runBatchScan(ads.db).catch(e => console.error('[Coverage] Daily scan error:', e.message));
}, { timezone: 'Asia/Jerusalem' });

console.log('[Coverage] Daily 06:00 scan scheduled');

// ─── Ads-only: Monday sync ────────────────────────────────────────────────────

app.post('/api/ads/monday/sync', (req, res) => {
  const status = getMondaySyncStatus();
  const forceFetch = req.body?.force === true;
  res.json({ started: true, alreadyRunning: status.running, forceFetch });
  if (!status.running) runMondaySync(ads.db, { forceFetch }).catch(err => console.error('[Monday]', err.message));
});

app.get('/api/ads/monday/sync/status', (_req, res) => res.json(getMondaySyncStatus()));

app.post('/api/ads/monday/resolve', (_req, res) => {
  const status = getMondaySyncStatus();
  if (status.resolving || status.running) return res.json({ started: false, reason: 'already running' });
  res.json({ started: true });
  resolveDropboxPaths(ads.db).catch(err => console.error('[Monday resolve]', err.message));
});

app.get('/api/ads/monday/tasks', (_req, res) => {
  try { res.json(ads.db.prepare('SELECT * FROM monday_tasks ORDER BY name ASC').all()); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Dynamic platform + campaign lists from Monday data
app.get('/api/ads/monday/platforms', (_req, res) => {
  try {
    const rows = ads.db.prepare(`SELECT DISTINCT platform FROM monday_tasks WHERE platform IS NOT NULL AND platform != '' ORDER BY platform ASC`).all();
    res.json(rows.map(r => r.platform));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ads/monday/campaigns', (_req, res) => {
  try {
    const rows = ads.db.prepare(`SELECT DISTINCT campaign FROM monday_tasks WHERE campaign IS NOT NULL AND campaign != '' ORDER BY campaign ASC`).all();
    res.json(rows.map(r => r.campaign));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ads/monday/products', (_req, res) => {
  try {
    const rows = ads.db.prepare(`SELECT DISTINCT product FROM monday_tasks WHERE product IS NOT NULL AND product != '' ORDER BY product ASC`).all();
    res.json(rows.map(r => r.product));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Asset use-count tracking (Raw + Brand)
app.post('/api/raw/assets/:id/use', (req, res) => {
  try {
    raw.db.prepare('UPDATE assets SET use_count = COALESCE(use_count, 0) + 1 WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/brand/assets/:id/use', (req, res) => {
  try {
    brand.db.prepare('UPDATE assets SET use_count = COALESCE(use_count, 0) + 1 WHERE id = ?').run(parseInt(req.params.id));
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Real/AI toggle: move file in Dropbox and update DB ───────────────────────
app.patch('/api/raw/assets/:id/content-type', async (req, res) => {
  try {
    const { content_type } = req.body || {};
    if (!['ai', 'real'].includes(content_type)) {
      return res.status(400).json({ error: 'content_type must be "ai" or "real"' });
    }
    const asset = raw.db.prepare('SELECT * FROM assets WHERE id = ?').get(parseInt(req.params.id));
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    if (!asset.path) return res.status(400).json({ error: 'Asset has no path' });

    // Replace the /AI/ or /Real/ segment (case-insensitive) with the target folder
    const fromLabel = content_type === 'ai' ? 'Real' : 'AI';
    const toLabel   = content_type === 'ai' ? 'AI'   : 'Real';
    const fromPath  = asset.path;

    // Match /AI/ or /Real/ anywhere in the path (case-insensitive)
    const regex = new RegExp(`/${fromLabel}/`, 'i');
    if (!regex.test(fromPath)) {
      return res.status(400).json({ error: `Path does not contain /${fromLabel}/ segment` });
    }

    const toPath = fromPath.replace(regex, `/${toLabel}/`);

    // Move in Dropbox
    await moveDropboxFile(fromPath, toPath);

    // Update DB
    raw.db.prepare('UPDATE assets SET path = ?, content_type = ? WHERE id = ?')
      .run(toPath, content_type, asset.id);

    res.json({ ok: true, path: toPath, content_type });
  } catch (err) {
    console.error('[content-type toggle]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Create product folder with full AI/Real/CTA hierarchy ────────────────────
// When a new product is created in the uploader, mirror the subfolder structure
app.post('/api/raw/folders', async (req, res) => {
  try {
    const { name } = req.body || {};
    if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
    const safeName   = name.trim();
    const productDir = `${RAW_ROOT}/Products/${safeName}`;
    const subfolders = ['Real', 'AI', 'CTA'];

    const created = [];
    for (const sub of subfolders) {
      const result = await createDropboxFolder(`${productDir}/${sub}`);
      created.push({ path: `${productDir}/${sub}`, ...result });
    }

    res.json({ ok: true, product: safeName, folders: created });
  } catch (err) {
    console.error('[create folders]', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/ads/assets/:id/monday-link', (req, res) => {
  try {
    const { monday_id } = req.body || {};
    const assetId = parseInt(req.params.id);
    ads.db.prepare(`DELETE FROM asset_monday_links WHERE asset_id = ? AND match_type != 'manual'`).run(assetId);
    if (monday_id) {
      ads.db.prepare(`INSERT OR REPLACE INTO asset_monday_links (asset_id, monday_id, match_type, score) VALUES (?, ?, 'manual', 100)`).run(assetId, monday_id);
    } else {
      ads.db.prepare('DELETE FROM asset_monday_links WHERE asset_id = ?').run(assetId);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/ads/assets/by-link', async (req, res) => {
  try {
    const url = (req.query.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url param required' });
    let assets = [];
    const mondayMatch = url.match(/\/pulses\/(\d+)/);
    if (mondayMatch) {
      const mondayId = mondayMatch[1];
      assets = ads.db.prepare(`SELECT * FROM assets WHERE monday_id = ? AND (deleted IS NULL OR deleted = 0) ORDER BY name ASC`).all(mondayId);
      if (!assets.length) {
        const task = ads.db.prepare('SELECT * FROM monday_tasks WHERE monday_id = ?').get(mondayId);
        if (task?.dropbox_path) {
          assets = ads.db.prepare(`SELECT * FROM assets WHERE path_lower LIKE ? AND (deleted IS NULL OR deleted = 0) ORDER BY name ASC`).all(task.dropbox_path + '%');
        }
      }
      return res.json({ type: 'monday', monday_id: mondayId, count: assets.length, assets: assets.map(a => ({ ...a, monday: a.monday_json ? JSON.parse(a.monday_json) : null })) });
    }
    if (url.includes('dropbox.com')) {
      let task = ads.db.prepare('SELECT * FROM monday_tasks WHERE dropbox_url = ?').get(url);
      if (!task) task = ads.db.prepare(`SELECT * FROM monday_tasks WHERE dropbox_url LIKE ?`).get(url.split('?')[0] + '%');
      if (task?.dropbox_path) {
        assets = ads.db.prepare(`SELECT * FROM assets WHERE path_lower LIKE ? AND (deleted IS NULL OR deleted = 0) ORDER BY name ASC`).all(task.dropbox_path + '%');
        return res.json({ type: 'dropbox', dropbox_path: task.dropbox_path, task_name: task.name, count: assets.length, assets: assets.map(a => ({ ...a, monday: a.monday_json ? JSON.parse(a.monday_json) : null })) });
      }
      return res.json({ type: 'dropbox', count: 0, assets: [], error: 'Could not resolve Dropbox URL' });
    }
    res.status(400).json({ error: 'URL must be a monday.com or dropbox.com link' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Ads tag-jobs
let adsTagJob = null;
app.post('/api/ads/tag-jobs', (req, res) => {
  if (adsTagJob?.status === 'running') return res.status(409).json({ error: 'A job is already running' });
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  runTagJob(ids, ads, job => { adsTagJob = job; }, ADS_AI_TAXONOMY).catch(err => console.error('[BulkTag]', err.message));
  res.json({ ok: true, total: ids.length });
});
app.get('/api/ads/tag-jobs/status', (_req, res) => res.json(adsTagJob || { status: 'idle' }));
app.delete('/api/ads/tag-jobs', (_req, res) => { if (adsTagJob?.status === 'running') adsTagJob.cancelled = true; res.json({ ok: true }); });

// ─── Shared: AI taxonomy + embedding logic ────────────────────────────────────

// ── Final Assets (Ads) taxonomy ───────────────────────────────────────────────
const ADS_AI_TAXONOMY = [
  // Platform
  { id: 'ad-plat-tiktok',    label: 'TikTok',           category: 'Platform' },
  { id: 'ad-plat-instagram', label: 'Instagram',         category: 'Platform' },
  { id: 'ad-plat-facebook',  label: 'Facebook',          category: 'Platform' },
  { id: 'ad-plat-youtube',   label: 'YouTube',           category: 'Platform' },
  { id: 'ad-plat-pinterest', label: 'Pinterest',         category: 'Platform' },
  { id: 'ad-plat-email',     label: 'Email',             category: 'Platform' },
  // Format
  { id: 'ad-fmt-story',      label: 'Story (9:16)',      category: 'Format' },
  { id: 'ad-fmt-feed',       label: 'Feed (1:1)',        category: 'Format' },
  { id: 'ad-fmt-landscape',  label: 'Landscape (16:9)', category: 'Format' },
  { id: 'ad-fmt-reel',       label: 'Reel',              category: 'Format' },
  // Ad Type
  { id: 'ad-type-ugc',         label: 'UGC',            category: 'Ad Type' },
  { id: 'ad-type-studio',      label: 'Studio',         category: 'Ad Type' },
  { id: 'ad-type-testimonial', label: 'Testimonial',    category: 'Ad Type' },
  { id: 'ad-type-demo',        label: 'Demo',           category: 'Ad Type' },
  { id: 'ad-type-lifestyle',   label: 'Lifestyle',      category: 'Ad Type' },
  { id: 'ad-type-animation',   label: 'Animation',      category: 'Ad Type' },
  { id: 'ad-type-product',     label: 'Product Shot',   category: 'Ad Type' },
  // Hook / Angle
  { id: 'ad-hook-problem',     label: 'Problem / Solution', category: 'Hook' },
  { id: 'ad-hook-before-after',label: 'Before & After',     category: 'Hook' },
  { id: 'ad-hook-stats',       label: 'Stats & Proof',      category: 'Hook' },
  { id: 'ad-hook-howto',       label: 'How-To',             category: 'Hook' },
  { id: 'ad-hook-social',      label: 'Social Proof',       category: 'Hook' },
  { id: 'ad-hook-lifestyle',   label: 'Lifestyle Hook',     category: 'Hook' },
  // Phase
  { id: 'ad-phase-awareness',  label: 'Awareness',      category: 'Phase' },
  { id: 'ad-phase-consider',   label: 'Consideration',  category: 'Phase' },
  { id: 'ad-phase-convert',    label: 'Conversion',     category: 'Phase' },
  { id: 'ad-phase-retarget',   label: 'Retargeting',    category: 'Phase' },
  // CTA
  { id: 'ad-cta-shop',        label: 'Shop Now',        category: 'CTA' },
  { id: 'ad-cta-learn',       label: 'Learn More',      category: 'CTA' },
  { id: 'ad-cta-try',         label: 'Try Free',        category: 'CTA' },
  { id: 'ad-cta-discover',    label: 'Discover',        category: 'CTA' },
  { id: 'ad-cta-subscribe',   label: 'Subscribe',       category: 'CTA' },
];
const VALID_ADS_TAG_IDS = new Set(ADS_AI_TAXONOMY.map(t => t.id));

// ── Raw Files taxonomy ────────────────────────────────────────────────────────
const AI_TAXONOMY = [
  { id: 'ugc',           label: 'UGC',                 category: 'Style' },
  { id: 'professional',  label: 'Professional',        category: 'Style' },
  { id: 'lifestyle',     label: 'Lifestyle',           category: 'Style' },
  { id: 'clinical',      label: 'Clinical',            category: 'Style' },
  { id: 'dramatic',      label: 'Dramatic',            category: 'Style' },
  { id: 'minimal',       label: 'Minimal',             category: 'Style' },
  { id: 'person',        label: 'Person',              category: 'Subject' },
  { id: 'woman',         label: 'Woman',               category: 'Subject' },
  { id: 'man',           label: 'Man',                 category: 'Subject' },
  { id: 'couple',        label: 'Couple',              category: 'Subject' },
  { id: 'face',          label: 'Face',                category: 'Subject' },
  { id: 'hands',         label: 'Hands',               category: 'Subject' },
  { id: 'product',       label: 'Product',             category: 'Subject' },
  { id: 'product-shot',  label: 'Product Shot',        category: 'Subject' },
  { id: 'packaging',     label: 'Packaging',           category: 'Subject' },
  { id: 'text-graphic',  label: 'Text / Graphic',      category: 'Subject' },
  { id: 'child',         label: 'Child (< 18)',        category: 'Age' },
  { id: 'young-adult',   label: 'Young Adult (18–35)', category: 'Age' },
  { id: 'middle-aged',   label: 'Middle Aged (35–55)', category: 'Age' },
  { id: 'senior',        label: 'Senior (55+)',        category: 'Age' },
  { id: 'indoor',        label: 'Indoor',              category: 'Setting' },
  { id: 'outdoor',       label: 'Outdoor',             category: 'Setting' },
  { id: 'bathroom',      label: 'Bathroom',            category: 'Setting' },
  { id: 'kitchen',       label: 'Kitchen',             category: 'Setting' },
  { id: 'studio',        label: 'Studio',              category: 'Setting' },
  { id: 'nature',        label: 'Nature',              category: 'Setting' },
  { id: 'close-up',      label: 'Close-up',            category: 'Shot' },
  { id: 'medium-shot',   label: 'Medium Shot',         category: 'Shot' },
  { id: 'wide-shot',     label: 'Wide Shot',           category: 'Shot' },
  { id: 'overhead',      label: 'Overhead',            category: 'Shot' },
  { id: 'warm-tones',    label: 'Warm Tones',          category: 'Color' },
  { id: 'cool-tones',    label: 'Cool Tones',          category: 'Color' },
  { id: 'dark',          label: 'Dark & Moody',        category: 'Color' },
  { id: 'bright',        label: 'Bright',              category: 'Color' },
  { id: 'blazer',        label: 'Blazer / Jacket',     category: 'Clothing' },
  { id: 'dress',         label: 'Dress',               category: 'Clothing' },
  { id: 'polo-shirt',    label: 'Polo Shirt',          category: 'Clothing' },
  { id: 'cardigan',      label: 'Cardigan / Knit',     category: 'Clothing' },
  { id: 't-shirt',       label: 'T-Shirt',             category: 'Clothing' },
  { id: 'tank-top',      label: 'Tank Top',            category: 'Clothing' },
  { id: 'hoodie',        label: 'Hoodie / Sweatshirt', category: 'Clothing' },
  { id: 'button-shirt',  label: 'Button-Up / Blouse',  category: 'Clothing' },
  { id: 'bathrobe',      label: 'Bathrobe',            category: 'Clothing' },
  { id: 'sweater',       label: 'Sweater',             category: 'Clothing' },
  { id: 'athletic-top',  label: 'Athletic Top',        category: 'Clothing' },
  { id: 'minimal-clothing', label: 'Minimal / No Top', category: 'Clothing' },
  { id: 'clothing-white',   label: 'White Clothing',   category: 'Clothing Color' },
  { id: 'clothing-black',   label: 'Black Clothing',   category: 'Clothing Color' },
  { id: 'clothing-neutral', label: 'Neutral Clothing', category: 'Clothing Color' },
  { id: 'clothing-pastel',  label: 'Pastel Clothing',  category: 'Clothing Color' },
  { id: 'clothing-bold',    label: 'Bold / Bright Clothing', category: 'Clothing Color' },
  { id: 'smiling',       label: 'Smiling',             category: 'Emotion' },
  { id: 'confident',     label: 'Confident',           category: 'Emotion' },
  { id: 'relaxed',       label: 'Relaxed',             category: 'Emotion' },
  { id: 'aspirational',  label: 'Aspirational',        category: 'Emotion' },
  { id: 'neutral-expr',  label: 'Neutral Expression',  category: 'Emotion' },
  // Content Type
  { id: 'before-after',  label: 'Before & After',      category: 'Content Type' },
  { id: 'transformation',label: 'Transformation',      category: 'Content Type' },
  { id: 'tutorial',      label: 'Tutorial / How-To',   category: 'Content Type' },
  { id: 'review',        label: 'Review',              category: 'Content Type' },
  { id: 'unboxing',      label: 'Unboxing',            category: 'Content Type' },
];
const VALID_TAG_IDS = new Set(AI_TAXONOMY.map(t => t.id));

// ─── Brand Kit taxonomy ────────────────────────────────────────────────────────
const BRAND_AI_TAXONOMY = [
  // Asset Type
  { id: 'b-logo',        label: 'Logo',          category: 'Asset Type' },
  { id: 'b-3d-model',    label: '3D Model',       category: 'Asset Type' },
  { id: 'b-texture',     label: 'Texture',        category: 'Asset Type' },
  { id: 'b-background',  label: 'Background',     category: 'Asset Type' },
  { id: 'b-project-file',label: 'Project File',   category: 'Asset Type' },
  { id: 'b-archive',     label: 'Archive',        category: 'Asset Type' },
  // Format
  { id: 'b-horizontal',  label: 'Horizontal',     category: 'Format' },
  { id: 'b-vertical',    label: 'Vertical',       category: 'Format' },
  { id: 'b-square',      label: 'Square',         category: 'Format' },
  { id: 'b-icon-size',   label: 'Icon',           category: 'Format' },
  // Color Mode
  { id: 'b-full-color',  label: 'Full Color',     category: 'Color Mode' },
  { id: 'b-monochrome',  label: 'Monochrome',     category: 'Color Mode' },
  { id: 'b-white',       label: 'White',          category: 'Color Mode' },
  { id: 'b-black',       label: 'Black',          category: 'Color Mode' },
  { id: 'b-outline',     label: 'Outline',        category: 'Color Mode' },
  // Brand
  { id: 'b-brand-particle', label: 'Particle',    category: 'Brand' },
  { id: 'b-brand-gravite',  label: 'Gravité',     category: 'Brand' },
  { id: 'b-brand-gt',       label: 'GT',          category: 'Brand' },
  // Product
  { id: 'b-prod-face-cream',    label: 'Face Cream',    category: 'Product' },
  { id: 'b-prod-body-wash',     label: 'Body Wash',     category: 'Product' },
  { id: 'b-prod-face-mask',     label: 'Face Mask',     category: 'Product' },
  { id: 'b-prod-hair-gummies',  label: 'Hair Gummies',  category: 'Product' },
  { id: 'b-prod-skin-gummies',  label: 'Skin Gummies',  category: 'Product' },
  { id: 'b-prod-deodorant',     label: 'Deodorant',     category: 'Product' },
  { id: 'b-prod-neck-cream',    label: 'Neck Cream',    category: 'Product' },
  { id: 'b-prod-shampoo',       label: 'Shampoo',       category: 'Product' },
  { id: 'b-prod-shaving-gel',   label: 'Shaving Gel',   category: 'Product' },
  { id: 'b-prod-sunscreen',     label: 'Sunscreen',     category: 'Product' },
  { id: 'b-prod-face-wash',     label: 'Face Wash',     category: 'Product' },
  { id: 'b-prod-hand-cream',    label: 'Hand Cream',    category: 'Product' },
  { id: 'b-prod-lip-balm',      label: 'Lip Balm',      category: 'Product' },
  { id: 'b-prod-eye-cream',     label: 'Eye Cream',     category: 'Product' },
  { id: 'b-prod-ab-cream',      label: 'Ab Firming',    category: 'Product' },
  { id: 'b-prod-bundle',        label: 'Bundle',        category: 'Product' },
  // Status
  { id: 'b-status-current',     label: 'Current',       category: 'Status' },
  { id: 'b-status-approval',    label: 'For Approval',  category: 'Status' },
  { id: 'b-status-legacy',      label: 'Legacy',        category: 'Status' },
];
const VALID_BRAND_TAG_IDS = new Set(BRAND_AI_TAXONOMY.map(t => t.id));

app.get('/api/raw/ai-tags/taxonomy',   (_req, res) => res.json(AI_TAXONOMY));
app.get('/api/ads/ai-tags/taxonomy',   (_req, res) => res.json(ADS_AI_TAXONOMY));
app.get('/api/brand/ai-tags/taxonomy', (_req, res) => res.json(BRAND_AI_TAXONOMY));

// ─── Folder-based tag inference for brand assets ─────────────────────────────
function inferBrandTagsFromPath(path, ext) {
  const lower   = path.toLowerCase();
  const parts   = lower.split('/').filter(Boolean);
  const tags    = new Set();

  // Asset Type from top-level design folder
  if (parts.includes('logos') || parts.some(p => p.includes('animated logo'))) {
    tags.add('b-logo');
  } else if (parts.includes('3d models') || parts.some(p => p === '3d models')) {
    // Check if it's a texture (inside /tex/ folder or specific image extension inside 3D hierarchy)
    if (parts.includes('tex') || parts.some(p => p === 'tex')) {
      tags.add('b-texture');
    } else if (['c4d','blend','obj','fbx','abc','mtl'].includes(ext)) {
      tags.add('b-project-file');
    } else if (['zip','rar','7z'].includes(ext)) {
      tags.add('b-archive');
    } else {
      tags.add('b-3d-model');
    }
  } else if (parts.includes('backgrounds')) {
    tags.add('b-background');
  }

  // Override asset type by extension if more specific
  if (['c4d','blend','obj','fbx','abc','mtl','ksp'].includes(ext) && !tags.has('b-texture')) {
    tags.delete('b-3d-model'); tags.add('b-project-file');
  }
  if (['zip','rar','7z'].includes(ext)) {
    tags.delete('b-3d-model'); tags.add('b-archive');
  }

  // Brand from subfolder name
  if (parts.some(p => p === 'gt' || p.startsWith('gt '))) {
    tags.add('b-brand-gt');
  } else if (parts.some(p => p.includes('gravit') || p.includes('gravité'))) {
    tags.add('b-brand-gravite');
  } else {
    tags.add('b-brand-particle');
  }

  // Product — from 3D Models/Products/<name>/...
  const prodIdx = parts.indexOf('products');
  if (prodIdx >= 0 && parts[prodIdx + 1]) {
    const prod = parts[prodIdx + 1];
    const prodMap = {
      'ab firming cream': 'b-prod-ab-cream',
      'body wash':        'b-prod-body-wash',
      'deodorant':        'b-prod-deodorant',
      'face cream':       'b-prod-face-cream',
      'face mask':        'b-prod-face-mask',
      'face wash':        'b-prod-face-wash',
      'hair gummies':     'b-prod-hair-gummies',
      'hand cream':       'b-prod-hand-cream',
      'instant eye firming cream': 'b-prod-eye-cream',
      'lip balm':         'b-prod-lip-balm',
      'neck cream':       'b-prod-neck-cream',
      'shampoo':          'b-prod-shampoo',
      'shaving gel':      'b-prod-shaving-gel',
      'skin gummies':     'b-prod-skin-gummies',
      'starter bundle':   'b-prod-bundle',
      'sunscreen':        'b-prod-sunscreen',
      'gravite':          null, // brand tag already added above
    };
    const tagId = Object.entries(prodMap).find(([key]) => prod.includes(key))?.[1];
    if (tagId) tags.add(tagId);
  }

  // Bundles folder
  if (parts.includes('bundles')) tags.add('b-prod-bundle');

  // Status
  if (lower.includes('for approval')) {
    tags.add('b-status-approval');
  } else if (lower.includes('/old') || lower.includes('old (') || lower.includes('(old)') || lower.includes('bagus')) {
    tags.add('b-status-legacy');
  } else {
    tags.add('b-status-current');
  }

  return [...tags].filter(t => VALID_BRAND_TAG_IDS.has(t));
}

// Extensions Claude vision can process
const VISION_EXTS = new Set(['jpg','jpeg','png','gif','webp','tiff','bmp']);
const VIDEO_EXTS  = new Set(['mp4','mov','avi','mkv','webm','mxf','m4v']);

async function tagSingleAsset(assetId, db, taxonomy = null) {
  const usedTaxonomy = taxonomy || AI_TAXONOMY;
  const usedValidIds = new Set(usedTaxonomy.map(t => t.id));
  const isBrand      = usedTaxonomy === BRAND_AI_TAXONOMY;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const asset = db.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) throw new Error('Asset not found');

  const ext      = (asset.extension || '').toLowerCase();
  const isVideo  = VIDEO_EXTS.has(ext);
  const isVisual = VISION_EXTS.has(ext);
  const isSvg    = ext === 'svg';

  // ── Deterministic text → taxonomy tag mapper ─────────────────────────────
  function tagsFromDetectedText(text) {
    if (!text) return [];
    const t = text.toLowerCase();
    const extra = [];
    if (t.includes('particle'))                           extra.push('b-brand-particle');
    if (t.includes('gravit') || t.includes('gravit\u00e9'))    extra.push('b-brand-gravite');
    if (/\bgt\b/.test(t))                                 extra.push('b-brand-gt');
    if (t.includes('face cream'))   extra.push('b-prod-face-cream');
    if (t.includes('body wash'))    extra.push('b-prod-body-wash');
    if (t.includes('face mask'))    extra.push('b-prod-face-mask');
    if (t.includes('hair gum'))     extra.push('b-prod-hair-gummies');
    if (t.includes('skin gum'))     extra.push('b-prod-skin-gummies');
    if (t.includes('deodorant'))    extra.push('b-prod-deodorant');
    if (t.includes('neck cream'))   extra.push('b-prod-neck-cream');
    if (t.includes('shampoo'))      extra.push('b-prod-shampoo');
    if (t.includes('shaving gel') || t.includes('shave gel')) extra.push('b-prod-shaving-gel');
    if (t.includes('sunscreen') || t.includes('spf'))    extra.push('b-prod-sunscreen');
    if (t.includes('face wash'))    extra.push('b-prod-face-wash');
    if (t.includes('hand cream'))   extra.push('b-prod-hand-cream');
    if (t.includes('lip balm'))     extra.push('b-prod-lip-balm');
    if (t.includes('eye cream') || t.includes('eye firm')) extra.push('b-prod-eye-cream');
    if (t.includes('ab firm') || t.includes('ab cream'))   extra.push('b-prod-ab-cream');
    return [...new Set(extra)].filter(id => usedValidIds.has(id));
  }


  const tagList = usedTaxonomy.map(t => `"${t.id}" — ${t.label} (category: ${t.category})`).join('\n');
  const context = isBrand
    ? "You are tagging a brand design asset (logo, 3D model, texture, background, etc.) for a men's skincare brand called Particle. Use the filename and folder path as strong hints."
    : "You are analyzing a creative video/photo asset for a men's skincare brand.";

  // ── Branch 1: Brand non-visual, non-SVG, non-video → folder tags only ──────
  if (isBrand && !isVisual && !isVideo && !isSvg) {
    // Read existing AI tags and merge with folder inference (never delete existing)
    let existing = [];
    try { existing = JSON.parse(asset.ai_tags || '[]'); } catch {}
    const folderT = inferBrandTagsFromPath(asset.path, ext);
    const tags = [...new Set([...existing, ...folderT])];
    const desc = asset.ai_description || `Auto-tagged from folder: ${asset.path.split('/').slice(-3, -1).join(' › ')}`;
    db.assetOps.setAiContent(asset.id, { tags, actions: [], description: desc });
    console.log(`[AI Tags] ${asset.name}: folder tags=[${tags}]`);
    return { tags, actions: [], description: desc };
  }

  // ── Branch 2: SVG → text-only Claude (vision can't read SVG) ───────────────
  if (isSvg) {
    let existing = [];
    try { existing = JSON.parse(asset.ai_tags || '[]'); } catch {}
    const folderTags = isBrand ? inferBrandTagsFromPath(asset.path, ext) : [];
    const client = new Anthropic({ apiKey });
    let aiTags = [], desc = '';
    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 256,
        messages: [{ role: 'user', content:
          `${context}\n\nFilename: "${asset.name}"\nFile path: "${asset.path}"\nFile type: SVG vector graphic\n\nAvailable taxonomy tags:\n${tagList}\n\nBased on the filename and path (you cannot see the file), reply with ONLY a JSON object: {"tags": [...], "description": "..."}` }],
      });
      const raw = response.content[0]?.text?.trim() || '{}';
      const parsed = JSON.parse(raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim());
      aiTags = Array.isArray(parsed.tags) ? parsed.tags.filter(t => usedValidIds.has(t)) : [];
      desc   = typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : '';
    } catch { /* if Claude fails, folder tags are sufficient */ }
    const tags = [...new Set([...existing, ...folderTags, ...aiTags])];
    db.assetOps.setAiContent(asset.id, { tags, actions: [], description: desc });
    console.log(`[AI Tags] ${asset.name}: svg tags=[${tags}]`);
    return { tags, actions: [], description: desc };
  }

  // ── Branch 3: Visual / video → Claude vision + merge with ALL existing tags ─
  let existing = [];
  try { existing = JSON.parse(asset.ai_tags || '[]'); } catch {}
  const folderTags = isBrand ? inferBrandTagsFromPath(asset.path, ext) : [];
  let imageBlocks = [];

  if (isVideo) {
    const cachedUrl = db.linkOps.get(asset.path);
    const videoUrl  = cachedUrl || await getTemporaryLink(asset.path);
    if (!cachedUrl) db.linkOps.set(asset.path, videoUrl, new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString());
    const frames = await extractVideoFrames(videoUrl, 4);
    if (!frames.length) throw new Error('Could not extract frames from video');
    imageBlocks = frames.map(buf => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }));
  } else {
    // isVisual (jpg/png/gif/webp/tiff/bmp)
    const thumbRes = await getThumbnailResponse(asset.path, 'w960h640');
    if (!thumbRes) throw new Error('Could not fetch thumbnail from Dropbox');
    imageBlocks = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(await thumbRes.arrayBuffer()).toString('base64') } }];
  }

  const client   = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 600,
    messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text:
      `${context}\n\nFilename: "${asset.name}"\nFile path: "${asset.path}"\n\nIMPORTANT: Carefully read ALL text visible in the image (brand names, product names, slogans, labels). Put every word/phrase you can read in detected_text.\n\nAvailable taxonomy tags:\n${tagList}\n\nReply with a JSON object: {"tags": [...], "actions": [...], "description": "...", "detected_text": "<all visible text separated by spaces>"}` }] }],
  });
  const raw2    = response.content[0]?.text?.trim() || '{}';
  const parsed  = JSON.parse(raw2.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim());
  const aiTags  = Array.isArray(parsed.tags)    ? parsed.tags.filter(t => usedValidIds.has(t)) : [];
  const actions = Array.isArray(parsed.actions) ? parsed.actions.filter(a => typeof a === 'string').slice(0, 5) : [];
  const detectedText = typeof parsed.detected_text === 'string' && parsed.detected_text.trim()
    ? parsed.detected_text.trim() : '';
  const textTags = isBrand ? tagsFromDetectedText(detectedText) : [];
  const baseDesc = typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : '';
  const desc = detectedText ? `${baseDesc}${baseDesc ? ' · ' : ''}Text: ${detectedText}`.slice(0, 300) : baseDesc;
  // Merge: existing DB tags + folder-inferred + Claude AI + text-derived (never delete)
  const tags = [...new Set([...existing, ...folderTags, ...aiTags, ...textTags])];
  db.assetOps.setAiContent(asset.id, { tags, actions, description: desc });
  console.log(`[AI Tags] ${asset.name}: tags=[${tags}] text="${detectedText}"`);
  return { tags, actions, description: desc };
}

async function runTagJob(ids, db, setJob, taxonomy = null) {
  const job = { status: 'running', total: ids.length, done: 0, errors: 0, currentId: null, currentName: null, ids, results: {}, startedAt: new Date().toISOString() };
  setJob(job);
  for (const id of ids) {
    if (job.cancelled) break;
    job.currentId = id;
    job.currentName = db.db.prepare('SELECT name FROM assets WHERE id = ?').get(id)?.name || null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await tagSingleAsset(id, db, taxonomy);
        job.results[id] = 'done'; job.done++; break;
      } catch (err) {
        const transient = err.message?.includes('500') || err.message?.includes('529') || err.message?.includes('overloaded');
        if (transient && attempt < 3) await new Promise(r => setTimeout(r, 3000));
        else { job.results[id] = 'error'; job.errors++; break; }
      }
    }
  }
  job.status = job.cancelled ? 'cancelled' : 'done';
  job.currentId = null; job.currentName = null;
  job.finishedAt = new Date().toISOString();
}

// Brand tag-jobs
let brandTagJob = null;
app.post('/api/brand/tag-jobs', (req, res) => {
  if (brandTagJob?.status === 'running') return res.status(409).json({ error: 'A job is already running' });
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids array required' });
  runTagJob(ids, brand, job => { brandTagJob = job; }, BRAND_AI_TAXONOMY).catch(err => console.error('[BrandBulkTag]', err.message));
  res.json({ ok: true, total: ids.length });
});
app.get('/api/brand/tag-jobs/status', (_req, res) => res.json(brandTagJob || { status: 'idle' }));
app.delete('/api/brand/tag-jobs', (_req, res) => { if (brandTagJob?.status === 'running') brandTagJob.cancelled = true; res.json({ ok: true }); });

// Brand single-asset AI tag (via mountAssetRoutes already wires /api/brand/assets/:id/ai-tags/generate)
// Override it to use brand taxonomy
app.post('/api/brand/assets/:id/ai-tags/generate', async (req, res) => {
  try {
    const result = await tagSingleAsset(req.params.id, brand, BRAND_AI_TAXONOMY);
    res.json({ ok: true, ...result, ai_tagged_at: new Date().toISOString() });
  } catch (err) {
    console.error('[brand ai-tags/generate]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Shared: compute embeddings on startup ────────────────────────────────────

function buildSearchCorpus(asset, allTags) {
  const parts = [];

  // ── 1. File name (most unique identifier) — add twice for weight
  if (asset.name) {
    parts.push(asset.name);
    // Also add name without extension to catch stem searches
    const stem = asset.name.replace(/\.[^.]+$/, '');
    if (stem !== asset.name) { parts.push(stem); parts.push(stem); }
    else parts.push(asset.name);
  }

  // ── 2. Unique folder segments (skip generic ones that appear in every path)
  const SKIP_FOLDERS = new Set(['brand', 'logos', 'assets', 'dam', 'creative', 'dropbox', 'particle', '2026']);
  if (asset.path) {
    const segs = asset.path.split('/').filter(s => s && !SKIP_FOLDERS.has(s.toLowerCase()));
    parts.push(...segs);
  }

  // ── 3. Extension
  if (asset.extension) parts.push(asset.extension);

  // ── 4. AI description — split detected text out, add separately
  if (asset.ai_description) {
    const m = asset.ai_description.match(/·\s*Text:\s*(.+)$/);
    if (m) {
      const cleanDesc = asset.ai_description.replace(/\s*·\s*Text:\s*.+$/, '').trim();
      if (cleanDesc) parts.push(cleanDesc);
      const detected = m[1].trim();
      parts.push(detected);
      parts.push(detected); // repeat detected text for higher weight
    } else {
      parts.push(asset.ai_description);
    }
  }

  // ── 5. AI actions
  if (asset.ai_actions) {
    try { parts.push(...JSON.parse(asset.ai_actions)); } catch {}
  }

  // ── 6. AI tags — human-readable labels repeated for weight, IDs once
  const ALL_TAXONOMY = [...AI_TAXONOMY, ...ADS_AI_TAXONOMY, ...BRAND_AI_TAXONOMY];
  const taxonomyMap  = Object.fromEntries(ALL_TAXONOMY.map(t => [t.id, t.label]));
  if (asset.ai_tags) {
    try {
      const ids = JSON.parse(asset.ai_tags);
      for (const id of ids) {
        const label = taxonomyMap[id];
        if (label) { parts.push(label); parts.push(label); } // label twice
        parts.push(id); // ID once
      }
    } catch {}
  }

  // ── 7. User-assigned tags (folder tag tree paths)
  const tagIds = asset.tagIds || [];
  for (const tid of tagIds) {
    const t = allTags.find(x => x.id === tid);
    if (t) parts.push(t.path);
  }

  return parts.join(' ');
}

// ─── Apply folder-based tags to all un-tagged brand assets ──────────────────
async function applyFolderTagsToBrand() {
  // Fetch ALL brand assets — apply folder tags without touching ai_tagged_at
  // so assets still appear in the Tagging Queue for AI vision enhancement
  const all = brand.db.prepare(
    'SELECT id, name, path, extension FROM assets WHERE (deleted IS NULL OR deleted = 0)'
  ).all();
  if (!all.length) return;
  console.log(`[FolderTags] Pre-tagging ${all.length} brand assets from folder structure…`);
  const stmt = brand.db.prepare(
    'UPDATE assets SET ai_tags = ? WHERE id = ?'
  );
  for (const asset of all) {
    const ext  = (asset.extension || '').toLowerCase();
    const tags = inferBrandTagsFromPath(asset.path, ext);
    if (tags.length) {
      // Merge with any existing AI tags (from previous tagging runs)
      let existing = [];
      try {
        const row = brand.db.prepare('SELECT ai_tags FROM assets WHERE id = ?').get(asset.id);
        existing = JSON.parse(row?.ai_tags || '[]');
      } catch {}
      const merged = [...new Set([...existing, ...tags])];
      stmt.run(JSON.stringify(merged), asset.id);
    }
  }
  console.log('[FolderTags] Done');
}

// Also expose as API so a manual trigger is possible
app.post('/api/brand/folder-tags/apply', async (_req, res) => {
  try {
    await applyFolderTagsToBrand();
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function computeAllEmbeddings(db) {
  const assets = db.db.prepare(
    "SELECT * FROM assets WHERE embedding IS NULL AND (deleted IS NULL OR deleted = 0)"
  ).all();
  if (!assets.length) { console.log('[Embeddings] All assets already embedded'); return; }
  console.log(`[Embeddings] Computing ${assets.length} embeddings…`);
  const allTags = db.tagOps.getAll();
  for (const asset of assets) {
    const tagLinks = db.db.prepare('SELECT tag_id FROM asset_tags WHERE asset_id = ?').all(asset.id);
    const enriched = { ...asset, tagIds: tagLinks.map(r => r.tag_id) };
    // Build full search_text for keyword scoring and store it
    const searchText = buildSearchCorpus(enriched, allTags);
    try {
      // Embed asset.name only — cleaner vector space, avoids tag blob noise
      const vec = await computeEmbedding(asset.name);
      db.assetOps.setEmbedding(asset.id, vec, searchText);
    } catch (err) { console.error('[Embedding]', asset.name, err.message); }
  }
  console.log('[Embeddings] Done');
}

// ─── Semantic search ──────────────────────────────────────────────────────────

// ─── Token buckets ────────────────────────────────────────────────────────────
const EXT_TOKEN_SET  = new Set(['svg','png','jpg','jpeg','gif','webp','pdf','mp4','mov','avi','c4d','blend','obj','fbx','exr','tif','tiff','zip','ai','psd']);
const TYPE_TOKEN_SET = new Set(['logo','icon','banner','background','thumbnail','template','mockup','badge','texture','model','bundle','pattern','overlay']);

function parseQueryTokens(query) {
  const words = stripAccents(query).toLowerCase().split(/\s+/).filter(w => w.length > 1);
  const extensionTokens = words.filter(w => EXT_TOKEN_SET.has(w));
  const typeTokens      = words.filter(w => TYPE_TOKEN_SET.has(w));
  const brandTokens     = words.filter(w => !EXT_TOKEN_SET.has(w) && !TYPE_TOKEN_SET.has(w));
  return { extensionTokens, typeTokens, brandTokens };
}

function fieldAwareScore(asset, { extensionTokens, typeTokens, brandTokens }, queryVec) {
  const normName   = stripAccents(asset.name || '').toLowerCase();
  const normExt    = (asset.extension || '').toLowerCase();
  const normCorpus = stripAccents(asset.search_text || '').toLowerCase();
  const assetVec   = JSON.parse(asset.embedding);

  // 1. Brand tokens vs normalised name (most discriminating)
  const brandScore = brandTokens.length > 0
    ? brandTokens.filter(t => normName.includes(t)).length / brandTokens.length
    : 1.0;

  // 2. Extension match against extension field
  const extScore = extensionTokens.length > 0
    ? (extensionTokens.some(t => t === normExt) ? 1.0 : 0.0)
    : 1.0;

  // 3. Type tokens against full search_text
  const typeScore = typeTokens.length > 0
    ? typeTokens.filter(t => normCorpus.includes(t)).length / typeTokens.length
    : 1.0;

  // 4. Cosine similarity (name-embedded, lightweight fallback)
  const semScore = cosineSimilarity(queryVec, assetVec);

  return brandScore * 0.50 + extScore * 0.25 + typeScore * 0.15 + semScore * 0.10;
}

// ─── Hybrid keyword score: fraction of query tokens found in search_text ────
function stripAccents(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function keywordScore(queryTokens, searchText) {
  if (!queryTokens.length || !searchText) return 0;
  const haystack   = stripAccents(searchText).toLowerCase();
  const normTokens = queryTokens.map(t => stripAccents(t).toLowerCase());
  const matched    = normTokens.filter(w => haystack.includes(w));
  return matched.length / normTokens.length;
}

function mountSemanticSearch(prefix, db) {
  app.post(`${prefix}/search/semantic`, async (req, res) => {
    try {
      const { query } = req.body || {};
      if (!query) return res.status(400).json({ error: 'query required' });

      // Parse tokens into buckets
      const { extensionTokens, typeTokens, brandTokens } = parseQueryTokens(query);

      // Embed query (against name-only vector space)
      const queryVec = await computeEmbedding(query);

      // Load all assets with embeddings
      const stored = db.db.prepare(
        'SELECT id, name, extension, embedding, search_text FROM assets WHERE embedding IS NOT NULL'
      ).all();

      // Pre-filter: if brand tokens present, restrict to assets whose name contains at least one
      let candidates = stored;
      if (brandTokens.length > 0) {
        const filtered = stored.filter(r => {
          const n = stripAccents(r.name || '').toLowerCase();
          return brandTokens.some(t => n.includes(t));
        });
        if (filtered.length > 0) candidates = filtered;
      }

      console.log('brandTokens:', brandTokens);
      console.log('candidates after filter:', candidates.length);

      // Score and sort
      const scored = candidates
        .map(r => ({ id: r.id, score: fieldAwareScore(r, { extensionTokens, typeTokens, brandTokens }, queryVec) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 60);

      console.log('top 3 names:', scored.slice(0, 3).map(r => candidates.find(c => c.id === r.id)?.name));

      const assets   = db.assetOps.getByIds(scored.map(r => r.id));
      const scoreMap = Object.fromEntries(scored.map(r => [r.id, r.score]));
      // Re-sort by score order (getByIds returns SQLite row order, not score order)
      const ordered  = scored.map(r => assets.find(a => a.id === r.id)).filter(Boolean);
      res.json({ assets: ordered.map(a => ({ ...a, score: scoreMap[a.id] })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post(`${prefix}/search/compute-embeddings`, async (req, res) => {
    res.json({ started: true });
    computeAllEmbeddings(db).catch(err => console.error('[Embeddings]', err.message));
  });
}

mountSemanticSearch('/api/raw', raw);
mountSemanticSearch('/api/ads', ads);
mountSemanticSearch('/api/brand', brand);

// ─── Startup ──────────────────────────────────────────────────────────────────

// ─── Static frontend (production / Docker) ───────────────────────────────────
// In dev the Vite server handles the frontend; in production/Docker the built
// dist folder is copied next to the backend and served here.
const FRONTEND_DIST = path.join(__dirname, '../frontend/dist');
if (require('fs').existsSync(FRONTEND_DIST)) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback — any route that isn't an API call gets index.html
  app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND_DIST, 'index.html')));
  console.log(`[Server] Serving frontend from ${FRONTEND_DIST}`);
}

app.listen(PORT, async () => {
  console.log(`[Server] Creative Production Hub running on port ${PORT}`);
  console.log(`[Server] Raw DB:   ${RAW_DB_PATH}`);
  console.log(`[Server] Ads DB:   ${ADS_DB_PATH}`);
  console.log(`[Server] Raw root: ${RAW_ROOT}`);

  // Raw Files: incremental sync on startup
  const lastFull = raw.syncOps.get('last_full_sync');
  if (!lastFull) {
    console.log('[Server] No previous sync — running full sync');
    rawSync.runFullSync().catch(err => console.error('[Startup sync]', err.message));
  } else {
    console.log(`[Server] Last sync: ${lastFull} — running incremental sync`);
    rawSync.runIncrementalSync().catch(err => console.error('[Startup sync]', err.message));
  }

  // Brand Kit: incremental sync on startup
  const lastBrandFull = brand.syncOps.get('last_full_sync');
  if (!lastBrandFull) {
    brandSync.runFullSync().catch(err => console.error('[Brand startup sync]', err.message));
  } else {
    brandSync.runIncrementalSync().catch(err => console.error('[Brand startup sync]', err.message));
  }

  // Start polling Upload/ for new files
  uploadWatcher.startPolling();

  // Compute embeddings in background for both raw and brand
  setTimeout(async () => {
    // Apply folder-based tags to any brand asset not yet tagged
    await applyFolderTagsToBrand();
    computeAllEmbeddings(raw).catch(err => console.error('[Startup embeddings]', err.message));
    computeAllEmbeddings(brand).catch(err => console.error('[Brand embeddings]', err.message));
  }, 8000);
});

// ─── Graceful shutdown — flush WAL into DB before exit ───────────────────────
// Without this, Docker `down` leaves a stale .db-wal file that corrupts the DB
// on the next start if the main file is ever replaced/recreated.
function shutdown(signal) {
  console.log(`[Server] ${signal} received — checkpointing WAL and closing databases...`);
  try { raw.db.pragma('wal_checkpoint(TRUNCATE)');   raw.db.close();   console.log('[Server] Raw DB closed cleanly.');   } catch (e) { console.error('[Server] Raw DB close error:', e.message); }
  try { ads.db.pragma('wal_checkpoint(TRUNCATE)');   ads.db.close();   console.log('[Server] Ads DB closed cleanly.');   } catch (e) { console.error('[Server] Ads DB close error:', e.message); }
  try { brand.db.pragma('wal_checkpoint(TRUNCATE)'); brand.db.close(); console.log('[Server] Brand DB closed cleanly.'); } catch (e) { console.error('[Server] Brand DB close error:', e.message); }
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
