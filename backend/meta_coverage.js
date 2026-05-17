// meta_coverage.js — Meta Ads upload tracking for the Ad Library
//
// Answers: "Were the finished creative files uploaded to Meta Ads?"
//
// Pipeline per task:
//   1. Get files from assets table WHERE monday_id = taskId (already indexed)
//   2. Filter to media files only (skip .prproj, .aep, .txt etc.)
//   3. For each media file: search Meta /advideos or /adimages by filename
//   4. Upsert result into meta_coverage table
//
// Qualifying tasks for scanning:
//   - department contains "marketing"
//   - status contains "done" or "completed"
//   - platform contains "meta" OR task name contains "| meta |"

'use strict';

const path = require('path');
const fs   = require('fs');

// ── Settings ─────────────────────────────────────────────────────────────────

const SETTINGS_PATH = path.resolve(__dirname, 'coverage_settings.json');

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  } catch {
    return { metaToken: null, metaAccountIds: [], staleAfterDays: 7 };
  }
}

// ── Meta API helpers (ported from Creative Coverage/backend/meta.js) ─────────

const META_API_BASE = 'https://graph.facebook.com/v19.0';

class RateLimitError extends Error {
  constructor(msg) { super(msg); this.name = 'RateLimitError'; }
}

async function metaGet(urlPath, params, token) {
  const url = new URL(`${META_API_BASE}${urlPath}`);
  url.searchParams.set('access_token', token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res  = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    const json = await res.json();
    if (json.error) {
      if (/too many calls|request limit|rate limit|throttl/i.test(json.error.message)) {
        throw new RateLimitError(`Rate limited: ${json.error.message}`);
      }
      throw new Error(`Meta API error: ${json.error.message}`);
    }
    return json;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new RateLimitError('Request timed out (possible rate limit)');
    throw e;
  }
}

const IMAGE_EXTS = /\.(png|jpg|jpeg|gif|webp|bmp)$/i;
const VIDEO_EXTS = /\.(mp4|mov|avi|mkv|webm|m4v)$/i;
const MEDIA_EXTS = /\.(png|jpg|jpeg|gif|webp|bmp|mp4|mov|avi|mkv|webm|m4v)$/i;

function buildSearchQuery(stem) {
  let q = stem;
  q = q.replace(/ _? ?V\d+$/i, '');
  q = q.replace(/ _? ?\d{3,4}x\d{3,4}$/i, '');
  q = q.replace(/ _ [A-Z]{2,}$/i, '');
  if (q.length > 60) {
    const cut = q.lastIndexOf(' _ ', 60);
    q = cut > 20 ? q.slice(0, cut) : q.slice(0, 60);
  }
  return q;
}

async function findVideoInAccount(accountId, filename, token) {
  const stem = filename.replace(/\.[^.]+$/, '');
  try {
    const data = await metaGet(`/${accountId}/advideos`,
      { fields: 'id,title', title: buildSearchQuery(stem), limit: '25' }, token);
    const match = (data.data || []).find(v => {
      const t = (v.title || '').toLowerCase().replace(/\.[^.]+$/, '');
      const s = stem.toLowerCase();
      return t === s || t.includes(s) || s.includes(t);
    });
    return match ? { id: match.id, name: match.title, type: 'video' } : null;
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    console.warn(`[Coverage] findVideo ${accountId}:`, e.message);
    return null;
  }
}

async function findImageInAccount(accountId, filename, token) {
  const stem = filename.replace(/\.[^.]+$/, '');
  try {
    const data = await metaGet(`/${accountId}/adimages`,
      { fields: 'hash,name,url', name: buildSearchQuery(stem), limit: '25' }, token);
    const match = (data.data || []).find(v => {
      const t = (v.name || '').toLowerCase().replace(/\.[^.]+$/, '');
      const s = stem.toLowerCase();
      return t === s || t.includes(s) || s.includes(t);
    });
    return match ? { id: match.hash, name: match.name, type: 'image' } : null;
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    console.warn(`[Coverage] findImage ${accountId}:`, e.message);
    return null;
  }
}

/**
 * Search for a single file across all configured ad accounts.
 * Returns { meta_id, name, type, account_id } or null.
 */
async function searchFileInMeta(filename, accountIds, token) {
  if (!token || !accountIds?.length) return null;

  // Try non-main accounts first, then Particle Main
  const PARTICLE_MAIN = 'act_491904784778245';
  const ordered = [
    ...accountIds.filter(id => id !== PARTICLE_MAIN),
    ...accountIds.filter(id => id === PARTICLE_MAIN),
  ];

  const rateLimited = [];
  for (const accountId of ordered) {
    try {
      let asset = null;
      if (IMAGE_EXTS.test(filename)) {
        asset = await findImageInAccount(accountId, filename, token);
      } else if (VIDEO_EXTS.test(filename)) {
        asset = await findVideoInAccount(accountId, filename, token);
      } else {
        asset = (await findVideoInAccount(accountId, filename, token))
             ?? (await findImageInAccount(accountId, filename, token));
      }
      if (asset) return { ...asset, account_id: accountId };
    } catch (e) {
      if (e instanceof RateLimitError) { rateLimited.push(accountId); }
    }
  }

  // Retry rate-limited accounts once
  for (const accountId of rateLimited) {
    try {
      let asset = IMAGE_EXTS.test(filename)
        ? await findImageInAccount(accountId, filename, token)
        : await findVideoInAccount(accountId, filename, token);
      if (asset) return { ...asset, account_id: accountId };
    } catch { /* still limited — skip */ }
  }

  return null;
}

// ── Task qualification ────────────────────────────────────────────────────────

function isQualifyingTask(task) {
  const monday = task.monday || (task.monday_json ? JSON.parse(task.monday_json) : null);
  if (!monday) return false;

  const dept     = (monday.department || '').toLowerCase();
  const status   = (monday.status     || '').toLowerCase();
  const platform = (monday.platform   || '').toLowerCase();
  const name     = (monday.name       || '').toLowerCase();

  if (!/marketing/i.test(dept))                    return false;
  if (!/done|completed/i.test(status))              return false;
  if (!/meta/i.test(platform) && !/\|\s*meta\s*\|/i.test(name)) return false;
  return true;
}

// ── Scan a single task ────────────────────────────────────────────────────────

/**
 * Scan one task's files against Meta.
 * @param {object} adsDb   - better-sqlite3 database instance (ads DB)
 * @param {string} taskId  - monday_id
 * @returns {{ checked, matched, rateLimited }}
 */
async function scanTask(adsDb, taskId) {
  const { metaToken, metaAccountIds } = loadSettings();
  if (!metaToken) {
    console.warn('[Coverage] No Meta token configured — skipping scan');
    return { checked: 0, matched: 0, rateLimited: false };
  }

  // Get files for this task from the assets table
  const files = adsDb.prepare(
    `SELECT id, name, extension FROM assets
     WHERE monday_id = ? AND (deleted IS NULL OR deleted = 0)`
  ).all(taskId);

  const mediaFiles = files.filter(f => MEDIA_EXTS.test(f.name));
  if (!mediaFiles.length) return { checked: 0, matched: 0, rateLimited: false };

  const upsert = adsDb.prepare(`
    INSERT INTO meta_coverage (task_id, asset_id, filename, uploaded_to_meta, meta_id, meta_status, account_id, last_checked)
    VALUES (?, ?, ?, ?, ?, ?, ?, date('now'))
    ON CONFLICT(task_id, filename) DO UPDATE SET
      uploaded_to_meta=excluded.uploaded_to_meta,
      meta_id=excluded.meta_id,
      meta_status=excluded.meta_status,
      account_id=excluded.account_id,
      last_checked=excluded.last_checked
  `);

  let checked = 0, matched = 0, rateLimited = false;
  const STALE_DAYS = loadSettings().staleAfterDays ?? 7;

  for (const file of mediaFiles) {
    // Skip recently-confirmed files (not found) — don't hammer API for known misses
    const existing = adsDb.prepare(
      `SELECT uploaded_to_meta, last_checked FROM meta_coverage WHERE task_id = ? AND filename = ?`
    ).get(taskId, file.name);

    if (existing?.uploaded_to_meta === 1) continue; // already confirmed — skip
    if (existing?.uploaded_to_meta === 0 && existing.last_checked) {
      const daysSince = (Date.now() - new Date(existing.last_checked).getTime()) / 86400000;
      if (daysSince < STALE_DAYS) continue; // checked recently, still not found — skip
    }

    await new Promise(r => setTimeout(r, 200)); // 200ms between calls

    try {
      const result = await searchFileInMeta(file.name, metaAccountIds, metaToken);
      upsert.run(taskId, file.id, file.name, result ? 1 : 0,
        result?.meta_id ?? null, result ? 'UPLOADED' : null, result?.account_id ?? null);
      checked++;
      if (result) matched++;
    } catch (e) {
      if (e instanceof RateLimitError) {
        console.warn('[Coverage] Rate limited — stopping scan for this task');
        rateLimited = true;
        break;
      }
      console.warn(`[Coverage] Error scanning ${file.name}:`, e.message);
    }
  }

  return { checked, matched, rateLimited };
}

// ── Batch scan ────────────────────────────────────────────────────────────────

let batchRunning = false;

/**
 * Scan all qualifying tasks (Marketing + Meta + Completed).
 * Runs 3 tasks sequentially to respect rate limits.
 */
async function runBatchScan(adsDb) {
  if (batchRunning) {
    console.log('[Coverage] Batch scan already running — skipping');
    return;
  }
  batchRunning = true;
  console.log('[Coverage] Starting batch scan…');

  try {
    // Get all tasks with their monday metadata
    const rows = adsDb.prepare(`
      SELECT DISTINCT monday_id, monday_json
      FROM assets
      WHERE monday_id IS NOT NULL
        AND monday_json IS NOT NULL
        AND (deleted IS NULL OR deleted = 0)
    `).all();

    const qualifying = rows
      .map(r => ({ monday_id: r.monday_id, monday: JSON.parse(r.monday_json || '{}') }))
      .filter(t => {
        const dept   = (t.monday.department || '').toLowerCase();
        const status = (t.monday.status     || '').toLowerCase();
        const plat   = (t.monday.platform   || '').toLowerCase();
        const name   = (t.monday.name       || '').toLowerCase();
        return /marketing/i.test(dept)
          && /done|completed/i.test(status)
          && (/meta/i.test(plat) || /\|\s*meta\s*\|/i.test(name));
      });

    console.log(`[Coverage] ${qualifying.length} qualifying tasks to scan`);

    let totalChecked = 0, totalMatched = 0;
    for (const task of qualifying) {
      try {
        const result = await scanTask(adsDb, task.monday_id);
        totalChecked += result.checked;
        totalMatched += result.matched;
        if (result.rateLimited) {
          console.warn('[Coverage] Rate limit hit — stopping batch early');
          break;
        }
      } catch (e) {
        console.warn(`[Coverage] Task ${task.monday_id} scan error:`, e.message);
      }
    }

    console.log(`[Coverage] Batch complete — ${totalChecked} files checked, ${totalMatched} found on Meta`);
  } finally {
    batchRunning = false;
  }
}

/**
 * Scan a specific set of task IDs (for on-page-load refresh of visible tasks).
 * Only scans qualifying tasks with stale/missing coverage data.
 * Fire-and-forget safe.
 */
async function refreshCoverageForTasks(adsDb, taskIds) {
  if (!taskIds?.length) return;
  const { metaToken } = loadSettings();
  if (!metaToken) return;

  for (const taskId of taskIds) {
    try {
      await scanTask(adsDb, taskId);
      await new Promise(r => setTimeout(r, 100));
    } catch (e) {
      if (e.name === 'RateLimitError') break;
      console.warn(`[Coverage] refresh error for ${taskId}:`, e.message);
    }
  }
}

// ── Coverage summary helpers ──────────────────────────────────────────────────

/**
 * Get file-level coverage for a single task.
 */
function getTaskCoverage(adsDb, taskId) {
  const rows = adsDb.prepare(`
    SELECT filename, asset_id, uploaded_to_meta, meta_id, meta_status, account_id, last_checked
    FROM meta_coverage WHERE task_id = ?
  `).all(taskId);

  const total       = rows.length;
  const uploaded    = rows.filter(r => r.uploaded_to_meta === 1).length;
  const notUploaded = rows.filter(r => r.uploaded_to_meta === 0).length;
  const unchecked   = total - uploaded - notUploaded;

  return {
    files: rows,
    summary: { total, uploaded, notUploaded, unchecked },
  };
}

/**
 * Get coverage summaries for multiple task IDs at once.
 */
function getBatchCoverage(adsDb, taskIds) {
  if (!taskIds?.length) return {};
  const placeholders = taskIds.map(() => '?').join(',');
  const rows = adsDb.prepare(`
    SELECT task_id, uploaded_to_meta, COUNT(*) as cnt
    FROM meta_coverage
    WHERE task_id IN (${placeholders})
    GROUP BY task_id, uploaded_to_meta
  `).all(...taskIds);

  const result = {};
  for (const row of rows) {
    if (!result[row.task_id]) result[row.task_id] = { total: 0, uploaded: 0, notUploaded: 0 };
    result[row.task_id].total += row.cnt;
    if (row.uploaded_to_meta === 1) result[row.task_id].uploaded    += row.cnt;
    if (row.uploaded_to_meta === 0) result[row.task_id].notUploaded += row.cnt;
  }
  return result;
}

module.exports = {
  scanTask,
  runBatchScan,
  refreshCoverageForTasks,
  getTaskCoverage,
  getBatchCoverage,
  loadSettings,
  isQualifyingTask,
  batchRunning: () => batchRunning,
};
