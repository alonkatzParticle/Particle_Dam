// makeSync.js — Dropbox sync factory
// Returns runFullSync / runIncrementalSync / getSyncStatus bound to the supplied db ops.
//
// DAM folder hierarchy (under Assets root):
//   {root}/{container_type}/{container_name}/{content_type}/{filename}
//   e.g. /Creative 2026/DAM/Assets/Products/Face Cream/Real/video.mp4
//        /Creative 2026/DAM/Assets/Bundles/Golfer's Bundle/AI/image.jpg
//        /Creative 2026/DAM/Assets/General/Brand/logo.png

const { listFolderRecursive, listFolderContinue } = require('./dropbox_lib');
const path = require('path');

// ─── Media type derivation ────────────────────────────────────────────────────

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

// ─── Structured field extraction ──────────────────────────────────────────────
//
// Parses the known DAM folder hierarchy from a file path.
// Returns { container_type, container_name, content_type } or nulls if
// the path doesn't match the expected structure (e.g. file at root level).

const CONTAINER_TYPES = new Set(['products', 'bundles', 'general', 'tv campaigns', 'tv_campaigns']);

function deriveStructuredFields(filePath, rootPath) {
  const rootLower = rootPath.toLowerCase();
  const lowerPath = filePath.toLowerCase();

  if (!lowerPath.startsWith(rootLower)) {
    return { container_type: null, container_name: null, content_type: null };
  }

  // Get the path relative to root, split into parts, drop empty strings
  const relative = filePath.slice(rootPath.length);
  const parts = relative.split('/').filter(Boolean);
  // parts[0] = container type folder  (Products, Bundles, General, TV Campaigns)
  // parts[1] = container name folder  (Face Cream, Golfer's Bundle, etc.)
  // parts[2] = content type folder    (Real, AI, CTA, Brand, Logos, etc.)
  // parts[3+] = filename (ignored here)

  if (parts.length < 1) {
    return { container_type: null, container_name: null, content_type: null };
  }

  const container_type = parts[0].toLowerCase().replace(/\s+/g, '_') || null;
  const container_name = parts[1] || null;
  const content_type   = parts[2] ? parts[2].toLowerCase() : null;

  return { container_type, container_name, content_type };
}

// ─── Sync factory ─────────────────────────────────────────────────────────────

module.exports = function makeSync({ syncOps, tagOps, assetOps }, rootPath) {
  let syncState = {
    running: false,
    lastSyncAt: null,
    error: null,
    progress: { phase: 'idle', filesIndexed: 0, totalFiles: 0 },
  };

  function getSyncStatus() { return { ...syncState }; }

  async function runFullSync() {
    if (syncState.running) return;
    syncState.running = true;
    syncState.error = null;
    syncState.progress = { phase: 'crawling', filesIndexed: 0, totalFiles: 0 };
    console.log(`[Sync] Starting full sync of ${rootPath}`);
    try {
      const { files, folders, cursor } = await listFolderRecursive(rootPath);
      syncState.progress.totalFiles = files.length;
      syncState.progress.phase = 'indexing';
      console.log(`[Sync] Found ${files.length} files, ${folders.length} folders`);

      const existingIds = new Set(assetOps.getAll());
      const seenDropboxIds = new Set();

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const ext = path.extname(file.name).replace('.', '').toLowerCase() || null;
        const structured = deriveStructuredFields(file.path_display, rootPath);

        const assetId = assetOps.upsert({
          dropbox_id:     file.id,
          name:           file.name,
          path:           file.path_display,
          path_lower:     file.path_lower,
          extension:      ext,
          size:           file.size,
          modified_at:    file.server_modified,
          content_hash:   file.content_hash,
          media_type:     deriveMediaType(ext),
          container_type: structured.container_type,
          container_name: structured.container_name,
          content_type:   structured.content_type,
        });

        seenDropboxIds.add(file.id);
        syncState.progress.filesIndexed = i + 1;
      }

      // Remove assets that no longer exist in Dropbox
      for (const oldId of existingIds) {
        if (!seenDropboxIds.has(oldId)) assetOps.deleteByDropboxId(oldId);
      }

      syncOps.set('dropbox_cursor', cursor);
      syncOps.set('last_full_sync', new Date().toISOString());
      syncState.lastSyncAt = new Date().toISOString();
      syncState.progress = { phase: 'done', filesIndexed: files.length, totalFiles: files.length };
      console.log(`[Sync] Complete — ${files.length} files indexed`);
    } catch (err) {
      syncState.error = err.message;
      syncState.progress.phase = 'error';
      console.error('[Sync] Error:', err.message);
    } finally {
      syncState.running = false;
    }
  }

  async function runIncrementalSync() {
    const cursor = syncOps.get('dropbox_cursor');
    if (!cursor) return runFullSync();
    if (syncState.running) return;
    syncState.running = true;
    syncState.error = null;
    console.log('[Sync] Running incremental sync...');
    try {
      const { files, deletedPaths, cursor: newCursor } = await listFolderContinue(cursor);
      if (files.length === 0 && deletedPaths.length === 0) {
        console.log('[Sync] No changes detected');
        syncState.running = false;
        syncState.lastSyncAt = new Date().toISOString();
        return;
      }
      console.log(`[Sync] ${files.length} changed, ${deletedPaths.length} deleted`);

      for (const file of files) {
        const ext = path.extname(file.name).replace('.', '').toLowerCase() || null;
        const structured = deriveStructuredFields(file.path_display, rootPath);

        assetOps.upsert({
          dropbox_id:     file.id,
          name:           file.name,
          path:           file.path_display,
          path_lower:     file.path_lower,
          extension:      ext,
          size:           file.size,
          modified_at:    file.server_modified,
          content_hash:   file.content_hash,
          media_type:     deriveMediaType(ext),
          container_type: structured.container_type,
          container_name: structured.container_name,
          content_type:   structured.content_type,
        });
      }

      for (const deletedPath of deletedPaths) {
        const asset = assetOps.getByPath(deletedPath);
        if (asset) assetOps.deleteByDropboxId(asset.dropbox_id);
      }

      syncOps.set('dropbox_cursor', newCursor);
      syncState.lastSyncAt = new Date().toISOString();
      console.log('[Sync] Incremental sync complete');
    } catch (err) {
      if (err.message.includes('reset') || err.message.includes('expired')) {
        console.warn('[Sync] Cursor expired, running full sync');
        syncState.running = false;
        return runFullSync();
      }
      syncState.error = err.message;
      console.error('[Sync] Incremental sync error:', err.message);
    } finally {
      syncState.running = false;
    }
  }

  return { runFullSync, runIncrementalSync, getSyncStatus };
};
