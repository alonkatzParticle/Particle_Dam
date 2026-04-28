// explore_dam.mjs — one-off read-only script
// Lists the folder structure at /Creative 2026/DAM/ using existing Dropbox creds
// Run: node explore_dam.mjs

import { config } from 'dotenv';
config({ path: './.env' });

const { DROPBOX_REFRESH_TOKEN, DROPBOX_APP_KEY, DROPBOX_APP_SECRET } = process.env;

async function getToken() {
  const res = await fetch('https://api.dropbox.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: DROPBOX_REFRESH_TOKEN,
      client_id: DROPBOX_APP_KEY,
      client_secret: DROPBOX_APP_SECRET,
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}

async function listFolder(token, path) {
  const res = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, recursive: true, include_deleted: false, limit: 2000 }),
  });
  if (!res.ok) throw new Error(`list_folder failed: ${await res.text()}`);
  const data = await res.json();
  const entries = [...data.entries];
  let cursor = data.cursor;
  let hasMore = data.has_more;

  while (hasMore) {
    const cont = await fetch('https://api.dropboxapi.com/2/files/list_folder/continue', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ cursor }),
    });
    const contData = await cont.json();
    entries.push(...contData.entries);
    cursor = contData.cursor;
    hasMore = contData.has_more;
  }

  return entries;
}

const token = await getToken();
const ROOT = '/Creative 2026/DAM';

console.log(`\nListing: ${ROOT}\n${'─'.repeat(60)}`);

const entries = await listFolder(token, ROOT);
const folders = entries.filter(e => e['.tag'] === 'folder').sort((a, b) => a.path_lower.localeCompare(b.path_lower));
const files   = entries.filter(e => e['.tag'] === 'file');

// Print folder tree
console.log(`\n📁 FOLDERS (${folders.length}):`);
for (const f of folders) {
  const relative = f.path_display.replace(ROOT, '');
  const depth = Math.max(0, (relative.match(/\//g) || []).length - 1);
  const indent = '  '.repeat(depth);
  console.log(`${indent}📁 ${f.name}`);
}

// Print file count per top-level folder
console.log(`\n📄 FILES (${files.length} total):`);
const byFolder = {};
for (const f of files) {
  const relative = f.path_display.replace(ROOT + '/', '');
  const topFolder = relative.includes('/') ? relative.split('/')[0] : '(root)';
  byFolder[topFolder] = (byFolder[topFolder] || 0) + 1;
}
for (const [folder, count] of Object.entries(byFolder).sort()) {
  console.log(`  ${folder}: ${count} file(s)`);
}

// Print unique extensions
const exts = [...new Set(files.map(f => f.name.split('.').pop()?.toLowerCase()).filter(Boolean))].sort();
console.log(`\n🎞  EXTENSIONS FOUND: ${exts.join(', ')}`);

console.log(`\n${'─'.repeat(60)}\nDone.\n`);
