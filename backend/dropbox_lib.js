// dropbox_lib.js — Dropbox API helper for Asset Library
// Based on Slack Summary's dropbox_lib.js with extensions for folder crawling,
// thumbnails, and temporary preview links.
//
// IMPORTANT: encodeDropboxArg is critical for non-ASCII / Hebrew / special chars
// in file paths. Do NOT remove or simplify this function.

let cachedToken = null;
let tokenExpiresAt = 0;

function encodeDropboxArg(arg) {
  return JSON.stringify(arg).replace(/[\u007F-\uFFFF]/g, chr =>
    '\\u' + ('0000' + chr.charCodeAt(0).toString(16)).slice(-4)
  );
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function getDropboxToken() {
  const refreshToken = process.env.DROPBOX_REFRESH_TOKEN;
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (refreshToken && appKey && appSecret) {
    if (cachedToken && Date.now() < tokenExpiresAt - 5 * 60 * 1000) {
      return cachedToken;
    }
    const res = await fetch('https://api.dropbox.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: appKey,
        client_secret: appSecret,
      }),
    });
    if (!res.ok) throw new Error(`Dropbox token refresh failed: ${await res.text()}`);
    const data = await res.json();
    cachedToken = data.access_token;
    tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return cachedToken;
  }

  const staticToken = process.env.DROPBOX_TOKEN;
  if (!staticToken) throw new Error('No Dropbox credentials configured');
  return staticToken;
}

// ─── Folder listing ───────────────────────────────────────────────────────────

/**
 * List all entries (files + folders) under a Dropbox path, handling pagination.
 * Returns { files: [...], folders: [...] }
 */
async function listFolderRecursive(rootPath) {
  const token = await getDropboxToken();
  const files = [];
  const folders = [];

  const fetchPage = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Dropbox list_folder failed: ${await res.text()}`);
    return res.json();
  };

  let data = await fetchPage('https://api.dropboxapi.com/2/files/list_folder', {
    path: rootPath,
    recursive: true,
    include_media_info: false,
    include_deleted: false,
    limit: 2000,
  });

  const processEntries = (entries) => {
    for (const entry of entries) {
      if (entry['.tag'] === 'file') files.push(entry);
      else if (entry['.tag'] === 'folder') folders.push(entry);
    }
  };

  processEntries(data.entries);

  while (data.has_more) {
    data = await fetchPage('https://api.dropboxapi.com/2/files/list_folder/continue', {
      cursor: data.cursor,
    });
    processEntries(data.entries);
  }

  return { files, folders, cursor: data.cursor };
}

/**
 * Incremental sync using a stored cursor.
 * Returns { files, folders, deletedPaths, cursor }
 */
async function listFolderContinue(cursor) {
  const token = await getDropboxToken();
  const files = [];
  const folders = [];
  const deletedPaths = [];

  let data;
  let currentCursor = cursor;

  do {
    const res = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor: currentCursor }),
    });
    if (!res.ok) throw new Error(`Dropbox continue failed: ${await res.text()}`);
    data = await res.json();

    for (const entry of data.entries) {
      if (entry['.tag'] === 'file') files.push(entry);
      else if (entry['.tag'] === 'folder') folders.push(entry);
      else if (entry['.tag'] === 'deleted') deletedPaths.push(entry.path_lower);
    }
    currentCursor = data.cursor;
  } while (data.has_more);

  return { files, folders, deletedPaths, cursor: currentCursor };
}

// ─── Thumbnails ───────────────────────────────────────────────────────────────

const THUMBNAIL_ELIGIBLE = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'tiff', 'bmp', 'mp4', 'mov', 'avi']);

function isThumbnailable(extension) {
  return THUMBNAIL_ELIGIBLE.has((extension || '').toLowerCase());
}

/**
 * Fetch a thumbnail for an image or video. Returns the raw fetch Response
 * so the caller can stream it directly to the Express response.
 * Returns null if the file type is unsupported or Dropbox returns an error.
 */
async function getThumbnailResponse(path, size = 'w960h640') {
  const token = await getDropboxToken();
  const res = await fetch('https://content.dropboxapi.com/2/files/get_thumbnail', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': encodeDropboxArg({ path, format: 'jpeg', size }),
    },
  });
  if (!res.ok) return null;
  return res;
}

/**
 * Get a temporary direct-download link (4 hours).
 */
async function getTemporaryLink(path) {
  const token = await getDropboxToken();
  const res = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error(`Dropbox temporary link failed: ${await res.text()}`);
  const data = await res.json();
  return data.link;
}

/**
 * Create or retrieve a public shared link for a file.
 * Returns a www.dropbox.com URL with ?dl=0 (web viewer).
 * Append ?dl=1 to force a download.
 */
async function getSharedLink(path) {
  const token = await getDropboxToken();

  // Try to create first
  const createRes = await fetch('https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, settings: { requested_visibility: { '.tag': 'public' } } }),
  });

  if (createRes.ok) {
    const data = await createRes.json();
    // Keep www.dropbox.com with dl=0 for web viewer
    return data.url.replace('?dl=1', '?dl=0');
  }

  const err = await createRes.json();
  if (err?.error?.['.tag'] === 'shared_link_already_exists') {
    const listRes = await fetch('https://api.dropboxapi.com/2/sharing/list_shared_links', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, direct_only: true }),
    });
    if (listRes.ok) {
      const data = await listRes.json();
      const link = data.links?.[0]?.url;
      if (link) return link.replace('?dl=1', '?dl=0');
    }
  }
  throw new Error('Could not get shared link');
}

// ─── Upload ───────────────────────────────────────────────────────────────────

async function uploadToDropbox(fileBuffer, fileName, dropboxPath) {
  const token = await getDropboxToken();
  const path = `${dropboxPath}/${fileName}`.replace(/\/+/g, '/');

  const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Dropbox-API-Arg': encodeDropboxArg({
        path,
        mode: 'add',
        autorename: true,
        mute: false,
      }),
      'Content-Type': 'application/octet-stream',
    },
    body: fileBuffer,
  });

  if (!response.ok) {
    const error = await response.text();
    return { success: false, error: `Dropbox upload failed: ${error}` };
  }

  const result = await response.json();
  return { success: true, path: result.path_display, dropboxId: result.id };
}

module.exports = {
  encodeDropboxArg,
  getDropboxToken,
  listFolderRecursive,
  listFolderContinue,
  getThumbnailResponse,
  getTemporaryLink,
  getSharedLink,
  uploadToDropbox,
  isThumbnailable,
};
