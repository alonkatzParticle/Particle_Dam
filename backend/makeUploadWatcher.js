// makeUploadWatcher.js — Upload approval queue
//
// Polls /Creative 2026/DAM/Upload/ for new files.
// Each file detected creates a pending_uploads record.
// Approve: moves file to Assets/ via Dropbox API, triggers incremental sync.
// Reject:  moves file to Rejected/ via Dropbox API (preserves file for uploader reference).
//
// Upload folder structure:
//   /Creative 2026/DAM/Upload/{username}/{container_type}/{container_name}/{content_type}/{filename}
// Destination on approval:
//   /Creative 2026/DAM/Assets/{container_type}/{container_name}/{content_type}/{filename}
// Destination on rejection:
//   /Creative 2026/DAM/Rejected/{username}/{container_type}/{container_name}/{content_type}/{filename}

const { listFolderRecursive, getDropboxToken } = require('./dropbox_lib');
const path = require('path');

const UPLOAD_ROOT   = '/Creative 2026/DAM/Upload';
const ASSETS_ROOT   = '/Creative 2026/DAM/Assets';
const REJECTED_ROOT = '/Creative 2026/DAM/Rejected';

const VIDEO_EXTS    = new Set(['mp4', 'mov', 'avi', 'mkv', 'mxf', 'webm', 'm4v']);
const IMAGE_EXTS    = new Set(['jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif', 'bmp', 'heic']);
const DOCUMENT_EXTS = new Set(['pdf', 'docx', 'doc', 'pptx', 'ppt', 'xlsx', 'xls']);

function deriveMediaType(ext) {
  if (!ext) return 'other';
  const e = ext.toLowerCase();
  if (e === 'gif')           return 'gif';
  if (VIDEO_EXTS.has(e))    return 'video';
  if (IMAGE_EXTS.has(e))    return 'image';
  if (DOCUMENT_EXTS.has(e)) return 'document';
  return 'other';
}

// Parse /Upload/{username}/{container_type}/{container_name}/{content_type}/filename
// Returns { uploaded_by, container_type, container_name, content_type, destination_path }
function parseUploadPath(filePath) {
  const uploadLower = UPLOAD_ROOT.toLowerCase();
  if (!filePath.toLowerCase().startsWith(uploadLower)) return null;

  const relative = filePath.slice(UPLOAD_ROOT.length);
  const parts = relative.split('/').filter(Boolean);
  // parts[0] = username
  // parts[1] = container_type (Products, Bundles, etc.)
  // parts[2] = container_name (Face Cream, etc.)
  // parts[3] = content_type (Real, AI, CTA, etc.)
  // parts[4] = filename

  if (parts.length < 2) return null;

  const uploaded_by    = parts[0] || null;
  const container_type = parts[1] ? parts[1].toLowerCase().replace(/\s+/g, '_') : null;
  const container_name = parts[2] || null;
  const content_type   = parts[3] ? parts[3].toLowerCase() : null;

  // Build destination path: replace Upload/{username}/ with Assets/
  const afterUsername = parts.slice(1).join('/');
  const destination_path = `${ASSETS_ROOT}/${afterUsername}`;

  return { uploaded_by, container_type, container_name, content_type, destination_path };
}

// ─── Dropbox API helpers ──────────────────────────────────────────────────────

async function dropboxMove(fromPath, toPath) {
  const token = await getDropboxToken();
  const res = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from_path: fromPath,
      to_path: toPath,
      allow_shared_folder: false,
      autorename: false,
      allow_ownership_transfer: false,
    }),
  });
  if (!res.ok) throw new Error(`Dropbox move failed: ${await res.text()}`);
  return res.json();
}

async function dropboxDelete(filePath) {
  const token = await getDropboxToken();
  const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath }),
  });
  if (!res.ok) throw new Error(`Dropbox delete failed: ${await res.text()}`);
  return res.json();
}

// ─── Watcher factory ──────────────────────────────────────────────────────────

module.exports = function makeUploadWatcher(db, rawSync) {
  const POLL_INTERVAL = parseInt(process.env.UPLOAD_POLL_INTERVAL_MS || '300000', 10); // 5 min default
  let pollTimer = null;
  let scanning = false;

  // ── Scan: detect new files in Upload/ ──────────────────────────────────────

  async function scan() {
    if (scanning) return { skipped: true };
    scanning = true;
    console.log('[UploadWatcher] Scanning Upload/ folder...');
    let detected = 0;
    try {
      const { files } = await listFolderRecursive(UPLOAD_ROOT);
      const existingIds = new Set(
        db.prepare('SELECT dropbox_id FROM pending_uploads').all().map(r => r.dropbox_id)
      );

      const insert = db.prepare(`
        INSERT OR IGNORE INTO pending_uploads
          (dropbox_id, dropbox_path, destination_path, name, extension, size,
           media_type, container_type, container_name, content_type, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const file of files) {
        if (existingIds.has(file.id)) continue;
        const parsed = parseUploadPath(file.path_display);
        if (!parsed) continue; // skip files that don't match expected structure
        const ext = path.extname(file.name).replace('.', '').toLowerCase() || null;
        insert.run(
          file.id,
          file.path_display,
          parsed.destination_path,
          file.name,
          ext,
          file.size,
          deriveMediaType(ext),
          parsed.container_type,
          parsed.container_name,
          parsed.content_type,
          parsed.uploaded_by
        );
        detected++;
      }
      console.log(`[UploadWatcher] Scan complete — ${detected} new file(s) detected`);
    } catch (err) {
      console.error('[UploadWatcher] Scan error:', err.message);
    } finally {
      scanning = false;
    }
    return { detected };
  }

  // ── Approve ────────────────────────────────────────────────────────────────

  async function approve(id) {
    const record = db.prepare('SELECT * FROM pending_uploads WHERE id = ?').get(id);
    if (!record) throw new Error(`Upload #${id} not found`);
    if (record.status !== 'pending') throw new Error(`Upload #${id} is already ${record.status}`);

    console.log(`[UploadWatcher] Approving #${id}: ${record.name} → ${record.destination_path}`);
    await dropboxMove(record.dropbox_path, record.destination_path);

    db.prepare(`
      UPDATE pending_uploads SET status='approved', reviewed_at=datetime('now') WHERE id=?
    `).run(id);

    // Trigger incremental sync so the asset appears in the library
    rawSync.runIncrementalSync().catch(err => console.error('[UploadWatcher] Post-approve sync error:', err.message));

    console.log(`[UploadWatcher] Approved #${id} — sync triggered`);
    return { ok: true };
  }

  // ── Reject ─────────────────────────────────────────────────────────────────

  async function reject(id, reason) {
    const record = db.prepare('SELECT * FROM pending_uploads WHERE id = ?').get(id);
    if (!record) throw new Error(`Upload #${id} not found`);
    if (record.status !== 'pending') throw new Error(`Upload #${id} is already ${record.status}`);

    // Build rejected path: Rejected/{username}/rest/of/original/path
    const afterUploadRoot = record.dropbox_path.slice(UPLOAD_ROOT.length); // /{username}/Products/...
    const rejectedPath = `${REJECTED_ROOT}${afterUploadRoot}`;

    console.log(`[UploadWatcher] Rejecting #${id}: ${record.name} → ${rejectedPath}`);
    await dropboxMove(record.dropbox_path, rejectedPath);

    db.prepare(`
      UPDATE pending_uploads SET status='rejected', reviewed_at=datetime('now'), rejection_reason=? WHERE id=?
    `).run(reason || null, id);

    console.log(`[UploadWatcher] Rejected #${id} — moved to Rejected/`);
    return { ok: true };
  }

  // ── Query helpers ──────────────────────────────────────────────────────────

  function getPending() {
    return db.prepare(`SELECT * FROM pending_uploads WHERE status='pending' ORDER BY detected_at DESC`).all();
  }

  function getAll() {
    return db.prepare(`SELECT * FROM pending_uploads ORDER BY detected_at DESC`).all();
  }

  function getPendingCount() {
    return db.prepare(`SELECT COUNT(*) as cnt FROM pending_uploads WHERE status='pending'`).get().cnt;
  }

  // ── Polling ────────────────────────────────────────────────────────────────

  function startPolling() {
    if (pollTimer) return;
    console.log(`[UploadWatcher] Polling every ${POLL_INTERVAL / 1000}s`);
    pollTimer = setInterval(() => scan().catch(err => console.error('[UploadWatcher] Poll error:', err.message)), POLL_INTERVAL);
    // Run an initial scan shortly after startup
    setTimeout(() => scan().catch(err => console.error('[UploadWatcher] Initial scan error:', err.message)), 5000);
  }

  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  return { scan, approve, reject, getPending, getAll, getPendingCount, startPolling, stopPolling };
};
