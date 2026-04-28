// monday.js — Monday.com API client for Ad Library
// Fetches tasks from both Video Projects board AND Image/Design board.

const MONDAY_API_URL = 'https://api.monday.com/v2';

async function mondayQuery(query) {
  const apiKey = process.env.MONDAY_API_KEY;
  if (!apiKey) throw new Error('MONDAY_API_KEY not set');

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: apiKey },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`Monday API error: ${res.status} ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Monday GraphQL error: ${JSON.stringify(json.errors)}`);
  return json.data;
}

function parseColumnValue(col) {
  if (!col.value) return null;
  try {
    const v = JSON.parse(col.value);
    if (v.url) return v.url;
    return col.text || null;
  } catch {
    return col.text || null;
  }
}

// ─── Board definitions ────────────────────────────────────────────────────────

const BOARDS = {
  video: {
    envKey: 'MONDAY_BOARD_ID',
    columns: [
      'link4__1',               // Dropbox folder
      'link',                   // Frame.io link
      'link1__1',               // Project link
      'status',                 // Status
      'label9',                 // Product
      'label4',                 // Type
      'label',                  // Department
      'single_selectu06tevn',   // Platform
      'long_text_mkn8c1ax',     // Video Concept
      'short_text_mkn8n4bx',    // Hook
      'people',                 // Editor
    ],
    mapItem(item, cols) {
      return {
        monday_id:   item.id,
        board_id:    process.env.MONDAY_BOARD_ID,
        name:        item.name,
        status:      cols['status']                   || null,
        product:     cols['label9']                   || null,
        task_type:   cols['label4']                   || null,
        department:  cols['label']                    || null,
        platform:    cols['single_selectu06tevn']     || null,
        concept:     cols['long_text_mkn8c1ax']       || null,
        hook:        cols['short_text_mkn8n4bx']      || null,
        dropbox_url: cols['link4__1']                 || null,
        frame_url:   cols['link']                     || null,
        project_url: cols['link1__1']                 || null,
        editor:      cols['people']                   || null,
      };
    },
  },

  image: {
    envKey: 'MONDAY_IMAGE_BOARD_ID',
    columns: [
      'link0__1',               // Dropbox folder
      'link',                   // Figma link
      'status',                 // Status
      'label9',                 // Product/Bundle
      'status_1__1',            // Department
      'single_selectrz7230p',   // Platform
      'long_textpvqldjpg',      // Concept
      'people',                 // Designer
      'text_mm1grv7e',          // Ad Name
    ],
    mapItem(item, cols) {
      return {
        monday_id:   item.id,
        board_id:    process.env.MONDAY_IMAGE_BOARD_ID,
        name:        item.name,
        status:      cols['status']                   || null,
        product:     cols['label9']                   || null,
        task_type:   null,
        department:  cols['status_1__1']              || null,
        platform:    cols['single_selectrz7230p']     || null,
        concept:     cols['long_textpvqldjpg']        || null,
        hook:        null,
        dropbox_url: cols['link0__1']                 || null,
        frame_url:   cols['link']                     || null,  // Figma
        project_url: null,
        editor:      cols['people']                   || null,
      };
    },
  },
};

// ─── Fetch all tasks from a board ─────────────────────────────────────────────

async function fetchBoardTasks(boardDef) {
  const boardId = process.env[boardDef.envKey];
  if (!boardId) { console.warn(`[Monday] ${boardDef.envKey} not set — skipping`); return []; }

  const columnIds = boardDef.columns.map(c => `"${c}"`).join(', ');
  const tasks = [];
  let cursor = null;

  do {
    const paginationArg = cursor
      ? `(limit: 100, cursor: "${cursor}")`
      : '(limit: 100)';

    const query = `{
      boards(ids: [${boardId}]) {
        items_page${paginationArg} {
          cursor
          items {
            id
            name
            column_values(ids: [${columnIds}]) {
              id text value
            }
          }
        }
      }
    }`;

    const data = await mondayQuery(query);
    const page = data.boards[0].items_page;

    for (const item of page.items) {
      const cols = {};
      for (const cv of item.column_values) {
        cols[cv.id] = parseColumnValue(cv);
      }
      tasks.push(boardDef.mapItem(item, cols));
    }

    cursor = page.cursor || null;
  } while (cursor);

  return tasks;
}

// ─── Fetch all tasks from all boards ─────────────────────────────────────────

async function fetchAllTasks() {
  const [videoTasks, imageTasks] = await Promise.all([
    fetchBoardTasks(BOARDS.video),
    fetchBoardTasks(BOARDS.image),
  ]);

  console.log(`[Monday] Video board: ${videoTasks.length} tasks | Image board: ${imageTasks.length} tasks`);
  return [...videoTasks, ...imageTasks];
}

module.exports = { fetchAllTasks };
