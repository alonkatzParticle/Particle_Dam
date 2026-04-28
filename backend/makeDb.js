// makeDb.js — Database factory
// Returns a fully initialised set of ops for any SQLite database path.
// Call twice with different paths to get two independent connections.

const Database = require('better-sqlite3');

const TAG_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f59e0b',
  '#10b981', '#06b6d4', '#f97316', '#84cc16',
];

module.exports = function makeDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // ─── Schema ─────────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS assets (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      dropbox_id    TEXT UNIQUE NOT NULL,
      name          TEXT NOT NULL,
      path          TEXT NOT NULL,
      path_lower    TEXT NOT NULL,
      extension     TEXT,
      size          INTEGER,
      modified_at   TEXT,
      content_hash  TEXT,
      indexed_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tags (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL,
      path        TEXT UNIQUE NOT NULL,
      path_lower  TEXT NOT NULL,
      depth       INTEGER NOT NULL DEFAULT 1,
      parent_path TEXT,
      color       TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_tags (
      asset_id  INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      tag_id    INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
      PRIMARY KEY (asset_id, tag_id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS shared_links (
      path       TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS monday_tasks (
      monday_id    TEXT PRIMARY KEY,
      name         TEXT,
      status       TEXT,
      product      TEXT,
      task_type    TEXT,
      department   TEXT,
      platform     TEXT,
      concept      TEXT,
      hook         TEXT,
      dropbox_url  TEXT,
      dropbox_key  TEXT,
      dropbox_path TEXT,
      frame_url    TEXT,
      project_url  TEXT,
      editor       TEXT,
      synced_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS asset_monday_links (
      asset_id    INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
      monday_id   TEXT    NOT NULL REFERENCES monday_tasks(monday_id) ON DELETE CASCADE,
      match_type  TEXT    NOT NULL DEFAULT 'fuzzy_name',
      score       INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (asset_id, monday_id)
    );

    CREATE INDEX IF NOT EXISTS idx_assets_path_lower ON assets(path_lower);
    CREATE INDEX IF NOT EXISTS idx_assets_extension  ON assets(extension);
    CREATE INDEX IF NOT EXISTS idx_asset_tags_asset  ON asset_tags(asset_id);
    CREATE INDEX IF NOT EXISTS idx_asset_tags_tag    ON asset_tags(tag_id);
    CREATE INDEX IF NOT EXISTS idx_tags_path         ON tags(path);
    CREATE INDEX IF NOT EXISTS idx_monday_links_asset  ON asset_monday_links(asset_id);
    CREATE INDEX IF NOT EXISTS idx_monday_links_monday ON asset_monday_links(monday_id);

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      email      TEXT UNIQUE NOT NULL,
      name       TEXT,
      picture    TEXT,
      role       TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  // ─── Migrations (safe to re-run) ────────────────────────────────────────────
  try { db.exec('ALTER TABLE assets ADD COLUMN ai_tags TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN ai_tagged_at TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN ai_actions TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN ai_description TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN embedding TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN search_text TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE monday_tasks ADD COLUMN dropbox_path TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN monday_id TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN monday_json TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN last_seen_sync TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN deleted INTEGER DEFAULT 0') } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_monday_id ON assets(monday_id)') } catch (_) {}
  try { db.exec('ALTER TABLE monday_tasks ADD COLUMN board_id TEXT') } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_deleted ON assets(deleted)') } catch (_) {}

  // ─── Phase 1: structured DAM fields ────────────────────────────────────────
  try { db.exec('ALTER TABLE assets ADD COLUMN tier TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN media_type TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN container_type TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN container_name TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN content_type TEXT') } catch (_) {}
  try { db.exec('ALTER TABLE assets ADD COLUMN uploaded_by TEXT') } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_container_type ON assets(container_type)') } catch (_) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_container_name ON assets(container_name)') } catch (_) {}

  // ─── Upload approval queue ──────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_uploads (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      dropbox_id       TEXT UNIQUE NOT NULL,
      dropbox_path     TEXT NOT NULL,
      destination_path TEXT NOT NULL,
      name             TEXT NOT NULL,
      extension        TEXT,
      size             INTEGER,
      media_type       TEXT,
      container_type   TEXT,
      container_name   TEXT,
      content_type     TEXT,
      uploaded_by      TEXT,
      detected_at      TEXT NOT NULL DEFAULT (datetime('now')),
      status           TEXT NOT NULL DEFAULT 'pending',
      reviewed_at      TEXT,
      rejection_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_pending_uploads_status ON pending_uploads(status);
    CREATE INDEX IF NOT EXISTS idx_pending_uploads_dropbox_id ON pending_uploads(dropbox_id);
  `);

  let colorIndex = 0;
  const nextColor = () => TAG_COLORS[colorIndex++ % TAG_COLORS.length];

  // ─── Sync state ─────────────────────────────────────────────────────────────
  const syncOps = {
    get(key) {
      const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
      return row ? row.value : null;
    },
    set(key, value) {
      db.prepare('INSERT OR REPLACE INTO sync_state (key, value) VALUES (?, ?)').run(key, String(value));
    },
  };

  // ─── Tag ops ────────────────────────────────────────────────────────────────
  const tagOps = {
    upsert(name, fullPath, depth, parentPath) {
      const existing = db.prepare('SELECT id, color FROM tags WHERE path = ?').get(fullPath);
      if (existing) return existing;
      const color = nextColor();
      const result = db.prepare(
        'INSERT INTO tags (name, path, path_lower, depth, parent_path, color) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(name, fullPath, fullPath.toLowerCase(), depth, parentPath || null, color);
      return { id: result.lastInsertRowid, color };
    },
    getAll() {
      return db.prepare('SELECT * FROM tags ORDER BY depth ASC, name ASC').all();
    },
    getById(id) {
      return db.prepare('SELECT * FROM tags WHERE id = ?').get(id);
    },
    deleteOrphans(validPaths) {
      if (!validPaths.length) return;
      const placeholders = validPaths.map(() => '?').join(',');
      db.prepare(`DELETE FROM tags WHERE path NOT IN (${placeholders})`).run(...validPaths);
    },
  };

  // ─── Asset ops ──────────────────────────────────────────────────────────────
  const assetOps = {
    upsert(asset) {
      const existing = db.prepare('SELECT id FROM assets WHERE dropbox_id = ?').get(asset.dropbox_id);
      if (existing) {
        db.prepare(`
          UPDATE assets
          SET name=?, path=?, path_lower=?, extension=?, size=?, modified_at=?, content_hash=?,
              media_type=?, container_type=?, container_name=?, content_type=?,
              indexed_at=datetime('now')
          WHERE dropbox_id=?
        `).run(
          asset.name, asset.path, asset.path_lower, asset.extension,
          asset.size, asset.modified_at, asset.content_hash,
          asset.media_type || null, asset.container_type || null,
          asset.container_name || null, asset.content_type || null,
          asset.dropbox_id
        );
        return existing.id;
      }
      const result = db.prepare(`
        INSERT INTO assets
          (dropbox_id, name, path, path_lower, extension, size, modified_at, content_hash,
           media_type, container_type, container_name, content_type, uploaded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        asset.dropbox_id, asset.name, asset.path, asset.path_lower,
        asset.extension, asset.size, asset.modified_at, asset.content_hash,
        asset.media_type || null, asset.container_type || null,
        asset.container_name || null, asset.content_type || null,
        asset.uploaded_by || null
      );
      return result.lastInsertRowid;
    },

    setTags(assetId, tagIds) {
      db.prepare('DELETE FROM asset_tags WHERE asset_id = ?').run(assetId);
      const insert = db.prepare('INSERT OR IGNORE INTO asset_tags (asset_id, tag_id) VALUES (?, ?)');
      for (const tagId of tagIds) insert.run(assetId, tagId);
    },

    setAiContent(assetId, { tags = [], actions = [], description = '' } = {}) {
      db.prepare(`
        UPDATE assets SET ai_tags = ?, ai_actions = ?, ai_description = ?, ai_tagged_at = datetime('now')
        WHERE id = ?
      `).run(JSON.stringify(tags), JSON.stringify(actions), description || null, assetId);
    },

    setEmbedding(id, vector, searchText) {
      db.prepare('UPDATE assets SET embedding = ?, search_text = ? WHERE id = ?')
        .run(JSON.stringify(vector), searchText, id);
    },

    getAllEmbeddings() {
      return db.prepare('SELECT id, embedding FROM assets WHERE embedding IS NOT NULL').all()
        .map(r => ({ id: r.id, vector: JSON.parse(r.embedding) }));
    },

    getByIds(ids) {
      if (!ids.length) return [];
      return db.prepare(`SELECT * FROM assets WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    },

    query({ search = '', tagIds = [], extensions = [], aiTags = [], untagged = false, mondayLinked = null, containerName = null, contentType = null, sort = 'newest', page = 1, limit = 60 } = {}) {
      const offset = (page - 1) * limit;
      const conditions = [];
      const params = [];

      conditions.push('(a.deleted IS NULL OR a.deleted = 0)');
      if (mondayLinked === true)  conditions.push('a.monday_id IS NOT NULL');
      if (mondayLinked === false) conditions.push('a.monday_id IS NULL');
      if (untagged) conditions.push('a.ai_tagged_at IS NULL');
      if (containerName) { conditions.push('a.container_name = ?'); params.push(containerName); }
      if (contentType)   { conditions.push('a.content_type = ?');   params.push(contentType); }
      if (search) {
        conditions.push(`(
          a.name LIKE ? OR
          COALESCE(a.search_text, '') LIKE ? OR
          COALESCE(a.ai_description, '') LIKE ? OR
          COALESCE(a.ai_actions, '') LIKE ? OR
          EXISTS (
            SELECT 1 FROM asset_tags at2
            JOIN tags t ON t.id = at2.tag_id
            WHERE at2.asset_id = a.id AND t.name LIKE ?
          )
        )`);
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
      if (extensions.length) {
        conditions.push(`a.extension IN (${extensions.map(() => '?').join(',')})`);
        params.push(...extensions);
      }
      for (const tag of aiTags) {
        conditions.push(`INSTR(COALESCE(a.ai_tags, ''), ?) > 0`);
        params.push(`"${tag}"`);
      }

      const ORDER_MAP = { newest: 'a.modified_at DESC', oldest: 'a.modified_at ASC', name: 'a.name ASC' };
      const orderBy = ORDER_MAP[sort] || ORDER_MAP.newest;

      const baseQuery = `
        FROM assets a
        ${tagIds.length ? `
          JOIN asset_tags at1 ON at1.asset_id = a.id
          WHERE at1.tag_id IN (${tagIds.map(() => '?').join(',')})
          ${conditions.length ? 'AND ' + conditions.join(' AND ') : ''}
          GROUP BY a.id HAVING COUNT(DISTINCT at1.tag_id) = ${tagIds.length}
        ` : conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      `;

      const countParams = tagIds.length ? [...tagIds, ...params] : [...params];
      const total = db.prepare(`SELECT COUNT(*) as cnt FROM (SELECT a.id ${baseQuery})`).get(...countParams).cnt;
      const rows  = db.prepare(`SELECT a.* ${baseQuery} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...countParams, limit, offset);

      const tagMap = db.prepare(
        'SELECT asset_id, tag_id FROM asset_tags WHERE asset_id IN (' + (rows.map(() => '?').join(',') || '0') + ')'
      ).all(...rows.map(r => r.id));
      const assetTagMap = {};
      for (const at of tagMap) {
        if (!assetTagMap[at.asset_id]) assetTagMap[at.asset_id] = [];
        assetTagMap[at.asset_id].push(at.tag_id);
      }
      return {
        total, page, limit,
        pages: Math.ceil(total / limit),
        assets: rows.map(r => ({ ...r, tagIds: assetTagMap[r.id] || [] })),
      };
    },

    getByPath(path) {
      return db.prepare('SELECT * FROM assets WHERE path_lower = ?').get(path.toLowerCase());
    },

    // Returns { products: string[], bundles: string[] } for the sidebar
    getContainers() {
      const rows = db.prepare(
        `SELECT DISTINCT container_type, container_name
         FROM assets
         WHERE container_type IS NOT NULL AND container_name IS NOT NULL
           AND (deleted IS NULL OR deleted = 0)
         ORDER BY container_name ASC`
      ).all();
      const products = rows.filter(r => r.container_type === 'products').map(r => r.container_name);
      const bundles  = rows.filter(r => r.container_type === 'bundles').map(r => r.container_name);
      return { products, bundles };
    },

    deleteByDropboxId(dropboxId) {
      db.prepare('DELETE FROM assets WHERE dropbox_id = ?').run(dropboxId);
    },

    countByExtension() {
      return db.prepare(`
        SELECT LOWER(extension) as ext, COUNT(*) as count
        FROM assets WHERE extension IS NOT NULL
        GROUP BY LOWER(extension) ORDER BY count DESC
      `).all();
    },

    getAll() {
      return db.prepare('SELECT dropbox_id FROM assets').all().map(r => r.dropbox_id);
    },
  };

  // ─── Shared link cache ───────────────────────────────────────────────────────
  const linkOps = {
    get(path) {
      const row = db.prepare('SELECT url, expires_at FROM shared_links WHERE path = ?').get(path);
      if (!row) return null;
      if (new Date(row.expires_at) < new Date()) {
        db.prepare('DELETE FROM shared_links WHERE path = ?').run(path);
        return null;
      }
      return row.url;
    },
    set(path, url, expiresAt) {
      db.prepare('INSERT OR REPLACE INTO shared_links (path, url, expires_at) VALUES (?, ?, ?)').run(path, url, expiresAt);
    },
  };

  return { db, syncOps, tagOps, assetOps, linkOps };
};
