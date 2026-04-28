// monday_sync.js — Monday-driven asset discovery with denormalized JSON + non-blocking sync
//
// Flow:
//   1. Fetch all Monday tasks
//   2. Resolve Dropbox URLs → folder paths (cached, incremental)
//   3. For each task with a resolved path: list files in the Dropbox folder
//   4. Upsert each file into `assets` with monday_id + monday_json blob (no matching needed)
//   5. After full scan: soft-delete assets not seen in this sync run
//   6. UI continues serving from existing data throughout; only clean-up happens at end

const { fetchAllTasks }           = require('./monday');
const { getDropboxToken, listFolderRecursive } = require('./dropbox_lib');

// ─── Sync state ───────────────────────────────────────────────────────────────

let syncState = {
  running: false, phase: null, lastSyncAt: null,
  taskCount: 0, resolvedCount: 0, resolveTotal: 0,
  indexedFiles: 0, indexedTasks: 0,
  error: null,
};

function getMondaySyncStatus() { return { ...syncState }; }

// ─── Dropbox shared-link resolver ─────────────────────────────────────────────

async function resolveDropboxLink(url) {
  if (!url) return null;
  try {
    const token = await getDropboxToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000); // 8s timeout per URL
    try {
      const res = await fetch('https://api.dropboxapi.com/2/sharing/get_shared_link_metadata', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 5000));
        return null; // skip on rate limit — will retry next sync
      }
      if (!res.ok) return null;
      const data = await res.json();
      return data.path_lower || null;
    } finally {
      clearTimeout(timeout);
    }
  } catch { return null; }
}

async function resolveAllDropboxPaths(db) {
  const syncStart = new Date().toISOString();

  // ── Bulk enrich from already-cached paths (fast — no API calls needed) ────────

  const cached = db.prepare(`
    SELECT mt.*, mt.dropbox_path FROM monday_tasks mt
    WHERE mt.dropbox_path IS NOT NULL AND mt.dropbox_url IS NOT NULL
  `).all();

  if (cached.length) {
    console.log(`[Monday] Enriching assets from ${cached.length} already-resolved paths…`);
    const enrichStmt = db.prepare(`
      UPDATE assets SET monday_id = ?, monday_json = ?, search_text = ?, last_seen_sync = ?
      WHERE path_lower LIKE ? AND (monday_id IS NULL OR monday_id = ?)
      AND (deleted IS NULL OR deleted = 0)
    `);
    let enrichedTotal = 0;
    db.transaction(ts => {
      for (const t of ts) {
        const mondayJson = JSON.stringify({
          monday_id: t.monday_id, board_id: t.board_id, name: t.name, status: t.status,
          product: t.product, platform: t.platform, task_type: t.task_type,
          department: t.department, hook: t.hook, concept: t.concept,
          dropbox_url: t.dropbox_url, frame_url: t.frame_url, project_url: t.project_url,
          dropbox_path: t.dropbox_path,
        });
        const searchTxt = buildSearchText({ name: '', path_display: t.dropbox_path, path_lower: t.dropbox_path }, t);
        const r = enrichStmt.run(t.monday_id, mondayJson, searchTxt, syncStart, t.dropbox_path + '%', t.monday_id);
        enrichedTotal += r.changes;
      }
    })(cached);
    console.log(`[Monday] ✓ Enriched ${enrichedTotal} existing assets from cached paths`);
    syncState.indexedFiles = (syncState.indexedFiles || 0) + enrichedTotal;
  }

  // ── Now resolve the remaining unresolved URLs ─────────────────────────────────
  const tasks = db.prepare(`
    SELECT monday_id, dropbox_url FROM monday_tasks
    WHERE dropbox_url IS NOT NULL AND dropbox_url != '' AND dropbox_path IS NULL
  `).all();

  if (!tasks.length) { console.log('[Monday] All Dropbox paths already resolved'); return; }

  syncState.phase        = 'resolving';
  syncState.resolveTotal = tasks.length;
  syncState.resolvedCount = 0;
  console.log(`[Monday] Resolving ${tasks.length} Dropbox URLs and indexing files inline…`);


  const setPath = db.prepare('UPDATE monday_tasks SET dropbox_path = ? WHERE monday_id = ?');
  const getTask = db.prepare('SELECT * FROM monday_tasks WHERE monday_id = ?');

  const upsertAsset = db.prepare(`
    INSERT INTO assets
      (dropbox_id, path, path_lower, name, size, modified_at, extension, monday_id, monday_json, search_text, last_seen_sync, deleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    ON CONFLICT(dropbox_id) DO UPDATE SET
      path=excluded.path, path_lower=excluded.path_lower, name=excluded.name,
      size=excluded.size, modified_at=excluded.modified_at,
      monday_id=excluded.monday_id, monday_json=excluded.monday_json,
      search_text=excluded.search_text,
      last_seen_sync=excluded.last_seen_sync, deleted=0
  `);

  const BATCH = 8; // safe with crash guards in place

  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    await Promise.all(batch.map(async t => {
      try {
        const path = await resolveDropboxLink(t.dropbox_url);
        if (path) {
          setPath.run(path, t.monday_id);

          // Immediately list folder and index files into the library
          try {
            const fullTask = getTask.get(t.monday_id);
            if (!fullTask) return;

            const mondayJson = JSON.stringify({
              monday_id:    fullTask.monday_id,
              board_id:     fullTask.board_id,
              name:         fullTask.name,
              status:       fullTask.status,
              product:      fullTask.product,
              platform:     fullTask.platform,
              task_type:    fullTask.task_type,
              department:   fullTask.department,
              hook:         fullTask.hook,
              concept:      fullTask.concept,
              dropbox_url:  fullTask.dropbox_url,
              frame_url:    fullTask.frame_url,
              project_url:  fullTask.project_url,
              dropbox_path: path,
            });
            const taskSearchParts = buildSearchText({ name: '', path_display: path, path_lower: path }, { ...fullTask, dropbox_path: path });

            // 1. Try listing files directly (works for regular Dropbox folders)
            const { files } = await listFolderRecursive(path);
            if (files.length) {
              db.transaction(fileList => {
                for (const f of fileList) {
                  upsertAsset.run(
                    f.id, f.path_display, f.path_lower, f.name,
                    f.size || 0, f.server_modified || f.client_modified || null,
                    extOf(f.name), fullTask.monday_id, mondayJson,
                    buildSearchText(f, { ...fullTask, dropbox_path: path }),
                    syncStart
                  );
                }
              })(files);
              syncState.indexedFiles = (syncState.indexedFiles || 0) + files.length;
              syncState.indexedTasks = (syncState.indexedTasks || 0) + 1;
            }

            // 2. ALWAYS also enrich any already-crawled assets at this path
            //    (handles shared folder mounts that listFolderRecursive can't access)
            const enriched = db.prepare(`
              UPDATE assets SET monday_id = ?, monday_json = ?, search_text = ?, last_seen_sync = ?
              WHERE path_lower LIKE ? AND (monday_id IS NULL OR monday_id = ?)
              AND (deleted IS NULL OR deleted = 0)
            `).run(fullTask.monday_id, mondayJson, taskSearchParts, syncStart, path + '%', fullTask.monday_id);

            if (enriched.changes > 0) {
              syncState.indexedFiles = (syncState.indexedFiles || 0) + enriched.changes;
              syncState.indexedTasks = (syncState.indexedTasks || 0) + 1;
            }
          } catch { /* folder listing failure — skip task */ }

        }
      } catch { /* URL resolution failure — skip */ }
      syncState.resolvedCount++;
    }));

    await new Promise(r => setTimeout(r, 300));
    if (syncState.resolvedCount % 100 === 0) {
      console.log(`[Monday] Resolved ${syncState.resolvedCount}/${tasks.length} | Indexed ${syncState.indexedFiles || 0} files`);
    }
  }
  console.log(`[Monday] ✓ Resolve+index complete: ${syncState.indexedFiles || 0} files from ${syncState.indexedTasks || 0} tasks`);
}



// ─── Search text builder ─────────────────────────────────────────────────────
// Combines all meaningful terms so the SQL LIKE search can find by any of them.

function buildSearchText(file, task) {
  const parts = [];

  // Clean filename (no extension, underscores → spaces)
  const cleanName = (file.name || '')
    .replace(/\.[^.]+$/, '')
    .replace(/[_\-]+/g, ' ')
    .trim();
  if (cleanName) parts.push(cleanName);

  // Full Dropbox path segments (folder hierarchy)
  const fullPath = file.path_display || file.path_lower || '';
  const segments = fullPath.split('/').filter(s => s && s !== file.name);
  if (segments.length) parts.push(segments.join(' '));

  // Monday task metadata
  if (task) {
    if (task.name)       parts.push(task.name);
    if (task.product)    parts.push(task.product);
    if (task.platform)   parts.push(task.platform);
    if (task.task_type)  parts.push(task.task_type);
    if (task.department) parts.push(task.department);
    if (task.concept)    parts.push(task.concept);
    if (task.hook)       parts.push(task.hook);
    // Also include the resolved dropbox path (search by folder URL key)
    if (task.dropbox_path) parts.push(task.dropbox_path.replace(/\//g, ' '));
  }

  return parts.join(' ').replace(/\s+/g, ' ').toLowerCase();
}

// ─── File extension helpers ───────────────────────────────────────────────────

function extOf(name) {
  const parts = name.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

// ─── Main sync ────────────────────────────────────────────────────────────────

async function runMondaySync(db, opts = {}) {
  if (syncState.running) { console.log('[Monday] Sync already running'); return; }

  syncState = {
    running: true, phase: 'fetching', lastSyncAt: null,
    taskCount: 0, resolvedCount: 0, resolveTotal: 0,
    indexedFiles: 0, indexedTasks: 0, error: null,
  };
  console.log('[Monday] Starting Monday-driven sync…');
  const syncStart = new Date().toISOString();

  try {
    // ── 1. Fetch Monday tasks (only when DB is empty or forceFetch=true) ───────
    const existingTaskCount = db.prepare('SELECT COUNT(*) as c FROM monday_tasks').get().c;
    const shouldFetch = existingTaskCount === 0 || opts.forceFetch === true;

    if (shouldFetch) {
      syncState.phase = 'fetching';
      const tasks = await fetchAllTasks();
      syncState.taskCount = tasks.length;
      console.log(`[Monday] Fetched ${tasks.length} tasks from API`);

      const upsert = db.prepare(`
        INSERT INTO monday_tasks
          (monday_id, board_id, name, status, product, task_type, department, platform, concept, hook,
           dropbox_url, dropbox_key, frame_url, project_url, editor, synced_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(monday_id) DO UPDATE SET
          board_id=excluded.board_id, name=excluded.name, status=excluded.status,
          product=excluded.product, task_type=excluded.task_type, department=excluded.department,
          platform=excluded.platform, concept=excluded.concept, hook=excluded.hook,
          dropbox_url=excluded.dropbox_url, dropbox_key=excluded.dropbox_key,
          frame_url=excluded.frame_url, project_url=excluded.project_url,
          editor=excluded.editor, synced_at=excluded.synced_at
      `);
      db.transaction(ts => {
        for (const t of ts) upsert.run(t.monday_id, t.board_id, t.name, t.status, t.product, t.task_type, t.department, t.platform, t.concept, t.hook, t.dropbox_url, extractDropboxKey(t.dropbox_url), t.frame_url, t.project_url, t.editor);
      })(tasks);

      // Refresh monday_json on already-linked assets
      syncState.phase = 'updating_json';
      const getPath    = db.prepare('SELECT dropbox_path FROM monday_tasks WHERE monday_id = ?');
      const updateJson = db.prepare('UPDATE assets SET monday_json = ? WHERE monday_id = ? AND (deleted IS NULL OR deleted = 0)');
      db.transaction(ts => {
        for (const t of ts) {
          const row  = getPath.get(t.monday_id);
          const blob = JSON.stringify({ ...t, dropbox_path: row?.dropbox_path || null });
          updateJson.run(blob, t.monday_id);
        }
      })(tasks);
      console.log('[Monday] ✓ monday_json refreshed on existing assets');
    } else {
      syncState.taskCount = existingTaskCount;
      console.log(`[Monday] ${existingTaskCount} tasks cached — skipping API fetch (pass forceFetch to refresh)`);
    }

    // ── 2. Resolve Dropbox URLs → paths (incremental, cached) ─────────────────
    syncState.phase = 'resolving';
    await resolveAllDropboxPaths(db);

    // ── 3. For each task with a resolved path: list + index files ─────────────
    syncState.phase = 'indexing';
    const resolvedTasks = db.prepare(`
      SELECT * FROM monday_tasks WHERE dropbox_path IS NOT NULL AND dropbox_url IS NOT NULL
    `).all();

    console.log(`[Monday] Indexing files from ${resolvedTasks.length} task folders…`);

    const upsertAsset = db.prepare(`
      INSERT INTO assets
        (dropbox_id, path, path_lower, name, size, modified_at, extension, monday_id, monday_json, search_text, last_seen_sync, deleted)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(dropbox_id) DO UPDATE SET
        path=excluded.path, path_lower=excluded.path_lower, name=excluded.name,
        size=excluded.size, modified_at=excluded.modified_at,
        monday_id=excluded.monday_id, monday_json=excluded.monday_json,
        search_text=excluded.search_text,
        last_seen_sync=excluded.last_seen_sync, deleted=0
    `);

    let indexedFiles = 0;
    let indexedTasks = 0;

    for (const task of resolvedTasks) {
      try {
        const { files } = await listFolderRecursive(task.dropbox_path);
        if (!files.length) continue;

        const mondayJson = JSON.stringify({
          monday_id:   task.monday_id,
          board_id:    task.board_id,
          name:        task.name,
          status:      task.status,
          product:     task.product,
          platform:    task.platform,
          task_type:   task.task_type,
          department:  task.department,
          hook:        task.hook,
          concept:     task.concept,
          dropbox_url: task.dropbox_url,
          frame_url:   task.frame_url,
          project_url: task.project_url,
          dropbox_path: task.dropbox_path,
        });

        db.transaction(fileList => {
          for (const f of fileList) {
            const ext = extOf(f.name);
            upsertAsset.run(
              f.id,
              f.path_display,
              f.path_lower,
              f.name,
              f.size || 0,
              f.server_modified || f.client_modified || null,
              ext,
              task.monday_id,
              mondayJson,
              buildSearchText(f, task),
              syncStart
            );
          }
        })(files);

        indexedFiles += files.length;
        indexedTasks++;
        syncState.indexedFiles = indexedFiles;
        syncState.indexedTasks = indexedTasks;

        if (indexedTasks % 50 === 0) {
          console.log(`[Monday] Indexed ${indexedFiles} files from ${indexedTasks}/${resolvedTasks.length} tasks`);
        }
      } catch (err) {
        // Don't abort full sync if one folder fails
        console.warn(`[Monday] Failed to list folder for task ${task.monday_id}: ${err.message}`);
      }
    }

    console.log(`[Monday] ✓ Indexed ${indexedFiles} files from ${indexedTasks} tasks`);

    // ── 5. Soft-delete assets not seen in this sync ───────────────────────────
    // Only delete assets that HAVE a monday_id (i.e. were previously Monday-indexed)
    // and were not touched in this sync run. Assets without monday_id are left alone.
    syncState.phase = 'cleanup';
    const deleted = db.prepare(`
      UPDATE assets SET deleted = 1
      WHERE monday_id IS NOT NULL
      AND (last_seen_sync IS NULL OR last_seen_sync < ?)
    `).run(syncStart);
    console.log(`[Monday] Soft-deleted ${deleted.changes} stale assets`);

    syncState.lastSyncAt = new Date().toISOString();
    syncState.running    = false;
    syncState.phase      = null;
    console.log(`[Monday] ✓ Sync complete — ${indexedFiles} files, ${indexedTasks} tasks`);

  } catch (err) {
    console.error('[Monday] Sync failed:', err.message);
    syncState.error   = err.message;
    syncState.running = false;
    syncState.phase   = null;
  }
}

// ─── Standalone resolver ──────────────────────────────────────────────────────

async function resolveDropboxPaths(db) {
  return resolveAllDropboxPaths(db);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDropboxKey(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'scl' && parts.length >= 3) return parts[2];
    if (parts[0] === 'sh'  && parts.length >= 2) return parts[1];
    return null;
  } catch { return null; }
}

module.exports = { runMondaySync, getMondaySyncStatus, resolveDropboxPaths };
