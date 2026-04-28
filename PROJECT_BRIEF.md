# Project Brief — Creative Production Hub

## What this is

A custom Digital Asset Management (DAM) platform for **Particle Productions**, built to replace MediaValet.
It manages creative assets (videos, images, GIFs, documents) used by the production team.

Built with Claude Code. Deployed on a Hostinger VPS via Docker Compose. Currently local dev, VPS deployment is the end goal.

---

## The Core Concept

Two distinct asset zones in one system:

| Zone | Color | Who | What |
|---|---|---|---|
| **Raw Assets** | Orange | Internal team only | Camera originals, unedited footage, working files |
| **Final Assets** | Green | Team + clients | Approved exports, deliverables, published work |

These are not just filters — they are architecturally separate workspaces with different UI, different density, different access rules.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React + Vite (JSX), TailwindCSS |
| **Backend** | Node.js + Express |
| **Database** | SQLite (via `better-sqlite3`) |
| **File Storage** | Dropbox (source of truth for actual files) |
| **AI Tagging** | Anthropic Claude API |
| **Semantic Search** | `@xenova/transformers` (CLIP embeddings, cosine similarity) |
| **Deployment** | Docker Compose, single container (nginx + Express), VPS |

---

## How the Data Layer Works

**Dropbox = file storage.** The actual video/image files live in Dropbox. The app never stores files itself.

**SQLite = local index.** The backend crawls Dropbox and builds a local database of asset metadata. All search, filtering, and pagination runs against SQLite — fast, no Dropbox API call needed. The Dropbox path/ID is stored in SQLite so we can fetch thumbnails, previews, and downloads on demand.

### Asset Object (what SQLite stores per file)

```
Asset
├── id, dropbox_id, dropbox_path, name, content_hash
├── media_type        image | video | gif | document | audio | other
├── extension         mp4, jpg, png, mov, pdf, etc.
├── tier              raw | final   ← first-class field
├── size, modified_at, width, height, duration, fps, codec, exif_data
├── product_id        → FK to Products table
├── ai_tags, ai_description, ai_actions, ai_tagged_at
├── embedding         vector for semantic search
└── indexed_at, last_seen_sync, deleted
```

Related tables: `products`, `tags`, `asset_tags`, `personas` (Phase 2), `transcripts` (Phase 2)

---

## Current Codebase State

The project exists at `/Users/alonkatz/Develop/Asset Library/` and is partially built:

```
Asset Library/
├── backend/
│   ├── server.js        # Express API (553 lines, monolithic — needs splitting)
│   ├── makeDb.js        # SQLite factory — creates DB + all ops
│   ├── makeSync.js      # Dropbox crawl + sync logic
│   ├── dropbox_lib.js   # Dropbox API helpers
│   ├── monday_sync.js   # Monday.com sync (Final Assets)
│   ├── embeddings.js    # CLIP embedding computation
│   ├── ffmpeg_lib.js    # Video frame extraction
│   └── asset_library.db # 20MB SQLite DB (already populated)
│
├── frontend/
│   └── src/
│       ├── App.jsx          # Router: /raw/* and /ads/* routes
│       ├── pages/           # LibraryPage, TaggingQueuePage, UploadPage
│       └── components/      # AppLayout, AssetCard, TagSidebar, SearchBar, MondayPanel
│
├── docker-compose.yml   # Maps port 3010:3001
├── Dockerfile           # Builds frontend + serves via nginx + backend
├── CLAUDE.md            # Engineering guidelines (read this)
└── VISION.md            # Full product spec (read this)
```

### What already works
- Dropbox sync (full + incremental)
- Asset library with search, tag filtering, extension filtering, pagination
- AI tagging via Anthropic Claude (single asset + bulk job)
- Semantic search via CLIP embeddings + cosine similarity
- Thumbnail/preview/download proxied from Dropbox
- Monday.com sync for Final Assets
- Docker deployment

### What needs to be built / restructured
- `tier` (raw/final) as a first-class DB field (currently handled by two separate DB instances)
- `Product` model (containers: Product, Bundle, Campaign, Shoot, Collection)
- Upload approval queue (Trusted / Standard / Restricted uploaders)
- User model with 5 roles (Admin, Producer, Editor, Viewer, Client)
- Split `server.js` into `routes/` + `services/` + `repositories/`
- TypeScript (currently plain JS)
- Full UI redesign per spec design language
- Brand Kit page (Phase 3)
- Personas + face recognition (Phase 2)
- Video transcription via Whisper (Phase 2)

---

## Build Roadmap

| Phase | Focus |
|---|---|
| **1 — Foundation** | Core library, Raw/Final split, Products, upload, roles, search |
| **2 — Intelligence** | Transcription (Whisper), Personas, face recognition, AI tagging improvements |
| **3 — Brand & Collab** | Brand Kit, Collections, Premiere panel, Slack |
| **4 — Polish** | Analytics, Smart Collections, mobile PWA, offline cache |

---

## Key Engineering Rules (from CLAUDE.md)

1. **Observe before you build** — understand the full data flow before writing anything
2. **Type everything** — named interfaces for every boundary (no `any`)
3. **Thin routes → services → repositories** — no business logic in route handlers
4. **Debugging: isolate with a test first** — don't spiral; reproduce → find cause → fix cause
5. **No magic strings, no files over ~300 lines, one function = one job**
6. **Always plan before implementing** — for any non-trivial task, describe the approach first

---

## Design Language (from spec)

- Dark-first: `#0a0a0a` base, `#111` / `#151515` surfaces
- One accent color (TBD by coordinator — violet, orange, blue, or green)
- Typography: display serif + clean sans + monospace for labels
- Motion: 150–200ms ease-out, purposeful only
- Raw zone = orange tint, Final zone = green tint — unmistakable

---

## Open Decisions (coordinator chooses)

- System name, logo, tagline
- Primary accent color + font system
- Subdomain on `particleface.com`
- Object storage vendor (Backblaze B2 vs Cloudflare R2) — Phase 2+
- Whisper: self-hosted or OpenAI API — Phase 2
