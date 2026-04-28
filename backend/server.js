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
const Anthropic = require('@anthropic-ai/sdk');

const makeDb             = require('./makeDb');
const makeSync           = require('./makeSync');
const { getAuthUrl, handleCallback, requireAuth, requireAdmin, FRONTEND_URL } = require('./auth');
const makeUploadWatcher  = require('./makeUploadWatcher');
const { getTemporaryLink, getThumbnailResponse, getSharedLink, uploadToDropbox,
        isThumbnailable, getDropboxToken, encodeDropboxArg } = require('./dropbox_lib');
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

  const sendToPopup = (data) => {
    const json = JSON.stringify(data)
    // Use '*' — the message contains no secrets (session is in the httpOnly cookie)
    res.send(authHtml(`
      try { window.opener.postMessage(${json}, '*'); } catch(e) {}
      window.close();
    `))
  }

  if (error || !code) return sendToPopup({ type: 'dam-auth', status: 'error', code: 'cancelled' })

  // Decode intended destination from OAuth state
  let redirectTo = '/raw/library'
  if (state) {
    try { redirectTo = Buffer.from(state, 'base64url').toString('utf8') || redirectTo } catch (_) {}
  }

  try {
    const { token, user } = await handleCallback(code, raw.db);
    res.cookie('dam_session', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });
    sendToPopup({ type: 'dam-auth', status: 'success', role: user.role, redirectTo })
  } catch (err) {
    console.error('[Auth] OAuth callback error:', err.message);
    const code = err.message === 'EMAIL_NOT_ALLOWED' ? 'domain' : 'error';
    sendToPopup({ type: 'dam-auth', status: 'error', code })
  }
});

app.post('/auth/logout', (req, res) => {
  res.clearCookie('dam_session');
  res.json({ ok: true });
});

app.get('/auth/me', requireAuth(raw.db), (req, res) => {
  const { id, email, name, picture, role } = req.user;
  res.json({ user: { id, email, name, picture, role } });
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
              monday_linked = '', container_name = '', content_type = '', sort = 'newest', page = '1', limit = '60' } = req.query;
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
        containerName: container_name || null,
        contentType:   content_type   || null,
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
  runTagJob(ids, ads, job => { adsTagJob = job; }).catch(err => console.error('[BulkTag]', err.message));
  res.json({ ok: true, total: ids.length });
});
app.get('/api/ads/tag-jobs/status', (_req, res) => res.json(adsTagJob || { status: 'idle' }));
app.delete('/api/ads/tag-jobs', (_req, res) => { if (adsTagJob?.status === 'running') adsTagJob.cancelled = true; res.json({ ok: true }); });

// ─── Shared: AI taxonomy + embedding logic ────────────────────────────────────

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
];
const VALID_TAG_IDS = new Set(AI_TAXONOMY.map(t => t.id));

app.get('/api/raw/ai-tags/taxonomy', (_req, res) => res.json(AI_TAXONOMY));
app.get('/api/ads/ai-tags/taxonomy', (_req, res) => res.json(AI_TAXONOMY));

async function tagSingleAsset(assetId, db) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const asset = db.db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);
  if (!asset) throw new Error('Asset not found');

  let imageBlocks = [];
  const isVideo = ['mp4','mov','avi','mkv','webm','mxf','m4v'].includes(asset.extension?.toLowerCase());
  if (isVideo) {
    const cachedUrl = db.linkOps.get(asset.path);
    const videoUrl  = cachedUrl || await getTemporaryLink(asset.path);
    if (!cachedUrl) db.linkOps.set(asset.path, videoUrl, new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString());
    const frames = await extractVideoFrames(videoUrl, 4);
    if (!frames.length) throw new Error('Could not extract frames from video');
    imageBlocks = frames.map(buf => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }));
  } else {
    if (!isThumbnailable(asset.extension)) throw new Error('No thumbnail available for this file type');
    const thumbRes = await getThumbnailResponse(asset.path, 'w960h640');
    if (!thumbRes) throw new Error('Could not fetch thumbnail from Dropbox');
    imageBlocks = [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(await thumbRes.arrayBuffer()).toString('base64') } }];
  }

  const tagList = AI_TAXONOMY.map(t => `"${t.id}" — ${t.label} (category: ${t.category})`).join('\n');
  const client  = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 512,
    messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: `You are analyzing a creative asset.\n\nFilename: "${asset.name}"\n\nAvailable taxonomy tags:\n${tagList}\n\nReply with a JSON object: {"tags": [...], "actions": [...], "description": "..."}` }] }],
  });
  const raw2    = response.content[0]?.text?.trim() || '{}';
  const parsed  = JSON.parse(raw2.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim());
  const tags    = Array.isArray(parsed.tags)    ? parsed.tags.filter(t => VALID_TAG_IDS.has(t)) : [];
  const actions = Array.isArray(parsed.actions) ? parsed.actions.filter(a => typeof a === 'string').slice(0, 5) : [];
  const desc    = typeof parsed.description === 'string' ? parsed.description.slice(0, 200) : '';
  db.assetOps.setAiContent(asset.id, { tags, actions, description: desc });
  console.log(`[AI Tags] ${asset.name}: tags=[${tags}]`);
  return { tags, actions, description: desc };
}

async function runTagJob(ids, db, setJob) {
  const job = { status: 'running', total: ids.length, done: 0, errors: 0, currentId: null, currentName: null, ids, results: {}, startedAt: new Date().toISOString() };
  setJob(job);
  for (const id of ids) {
    if (job.cancelled) break;
    job.currentId = id;
    job.currentName = db.db.prepare('SELECT name FROM assets WHERE id = ?').get(id)?.name || null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await tagSingleAsset(id, db);
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

// ─── Shared: compute embeddings on startup ────────────────────────────────────

function buildSearchCorpus(asset, allTags) {
  const parts = [asset.name];
  if (asset.ai_description) parts.push(asset.ai_description);
  if (asset.ai_actions) { try { parts.push(...JSON.parse(asset.ai_actions)); } catch {} }
  if (asset.ai_tags) { try { const ids = JSON.parse(asset.ai_tags); parts.push(...ids); } catch {} }
  const tagIds = asset.tagIds || [];
  for (const tid of tagIds) { const t = allTags.find(x => x.id === tid); if (t) parts.push(t.path); }
  return parts.join(' ');
}

async function computeAllEmbeddings(db) {
  const assets  = db.db.prepare('SELECT * FROM assets WHERE embedding IS NULL AND ai_tagged_at IS NOT NULL').all();
  if (!assets.length) { console.log('[Embeddings] All assets already embedded'); return; }
  console.log(`[Embeddings] Computing ${assets.length} embeddings…`);
  const allTags = db.tagOps.getAll();
  for (const asset of assets) {
    const tagLinks = db.db.prepare('SELECT tag_id FROM asset_tags WHERE asset_id = ?').all(asset.id);
    const enriched = { ...asset, tagIds: tagLinks.map(r => r.tag_id) };
    const corpus   = buildSearchCorpus(enriched, allTags);
    try {
      const vec = await computeEmbedding(corpus);
      db.assetOps.setEmbedding(asset.id, vec, corpus);
    } catch (err) { console.error('[Embedding]', asset.name, err.message); }
  }
  console.log('[Embeddings] Done');
}

// ─── Semantic search ──────────────────────────────────────────────────────────

function mountSemanticSearch(prefix, db) {
  app.post(`${prefix}/search/semantic`, async (req, res) => {
    try {
      const { query } = req.body || {};
      if (!query) return res.status(400).json({ error: 'query required' });
      const queryVec  = await computeEmbedding(query);
      const stored    = db.assetOps.getAllEmbeddings();
      const scored    = stored.map(r => ({ id: r.id, score: cosineSimilarity(queryVec, r.vector) }))
        .sort((a, b) => b.score - a.score).slice(0, 60);
      const assets    = db.assetOps.getByIds(scored.map(r => r.id));
      const scoreMap  = Object.fromEntries(scored.map(r => [r.id, r.score]));
      res.json({ assets: assets.map(a => ({ ...a, score: scoreMap[a.id] })) });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

  app.post(`${prefix}/search/compute-embeddings`, async (req, res) => {
    res.json({ started: true });
    computeAllEmbeddings(db).catch(err => console.error('[Embeddings]', err.message));
  });
}

mountSemanticSearch('/api/raw', raw);
mountSemanticSearch('/api/ads', ads);

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

  // Compute embeddings in background (raw only — ads uses monday search)
  setTimeout(() => {
    computeAllEmbeddings(raw).catch(err => console.error('[Startup embeddings]', err.message));
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
