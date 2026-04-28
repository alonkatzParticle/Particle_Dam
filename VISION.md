# Creative Production Hub — Vision & Product Spec

> Internal document — Particle Productions  
> Replacing: MediaValet  
> Deployment: New subdomain under `particleface.com`, Docker VPS  
> Built with: Claude Code  
> Status: Pre-build. Name & logo TBD — chosen by coordinator.

---

## The Why

MediaValet is expensive, generic, and not built around how a creative production team actually works.

This replaces it with a platform that:
- Treats **raw footage and final deliverables as different species** — not just different folders
- Recognizes people in content automatically (Google Photos-style, one confirmation)
- Transcribes every video on upload — any spoken word becomes searchable
- Connects directly to Dropbox, Figma, Premiere, and After Effects
- Feels like a flagship creative tool, not enterprise software

> *Every asset. Every brand. Every persona. In one place. Fast, beautiful, searchable, and ours.*

---

## The One Non-Negotiable

**Final Assets and Raw Assets are two separate, visually unmistakable workspaces.**

| | Final Assets | Raw Assets |
|---|---|---|
| **Color** | Green `#4ade80` | Orange `#f97316` |
| **Content** | Approved exports, deliverables, published work | Camera originals, unedited footage, working files |
| **Density** | Clean grid, large thumbnails | Higher density, more metadata per row |
| **Access** | Team + clients (with permission) | Internal only |
| **EXIF** | Not emphasized | Surfaced prominently (camera, lens, ISO) |
| **Sharing** | Permanent CDN URLs, watermark option | No client access |
| **Storage** | Standard | Archival cold-storage option |

Same system, same login, same search. A prominent toggle at the top switches between zones — not hidden in a filter.

---

## Navigation Structure

### Desktop Sidebar
```
[ LOGO ]  [ SYSTEM NAME ]

🔍  Search                 ⌘K
──────────────────────────────
🏠  Home
📦  Products               — by product, bundle, campaign
🎬  Library
    ├─ Final Assets        — green accent, client-ready
    └─ Raw Assets          — orange accent, team-only
👤  Personas               — real + AI, unified
🎨  Brand Kit
📂  Collections            — custom, shareable
──────────────────────────────
📤  Upload Queue           — live progress
🔔  Notifications
──────────────────────────────
⚙️  Settings
👥  Team
```

### Mobile Bottom Nav
Five items: **Home · Library · Search · Personas · Profile**  
Full feature parity — not a stripped-down version.

---

## Feature Areas (20 Sections)

### § 04 — Home Dashboard
- **Hero stats strip** — total assets, storage, active uploads, personas count
- **Recently Added** — horizontal scroll, 12 assets, hover to silent-preview video
- **My Products** — cards with last activity
- **Personas Needing Attention** — contracts expiring in 30 days
- **Activity Feed** — uploads, comments, status changes, @mentions
- **Quick Actions** — Upload · New Product · Invite Teammate · Open Brand Kit

---

### § 05 — Products & Flexible Grouping

Organization types the system accepts:

| Type | What it is |
|---|---|
| Product | A single SKU or offering |
| Bundle | A group of products sold/released together |
| Campaign | Time-bound marketing push across multiple products |
| Shoot | A production session — location, day, team |
| Collection | Curated pull from anywhere |
| Custom | Any grouping the team invents |

Containers can nest and mix — no rigid hierarchy. The team shapes it to the work.

**Per-container linked resources:**
- Dropbox folder link (Raw + Final subfolders, set via OAuth picker)
- Figma file link
- Premiere project path
- Team assignments with per-product roles

---

### § 06 — Library (Final vs Raw)

**View options:** Grid (small/medium/large) · List · Masonry

**Filters:**
File type · Product/Bundle · Persona · Date range · Resolution · Aspect ratio · Camera · Uploader · Has transcript · Dominant color (swatch picker) · Tags

---

### § 07 — Upload Approval

Three uploader trust levels:

| Role | Behavior |
|---|---|
| **Trusted Uploaders** | Admins, producers, senior editors — uploads go live immediately |
| **Standard Uploaders** | Most team members — enter Pending queue for reviewer approval |
| **Restricted Uploaders** | Freelancers, externals — can only upload to assigned products |

**Reviewer queue shows:** thumbnail, filename, uploader, target product, size, timestamp  
**Actions:** Approve · Reject (with reason) · Reassign · Edit metadata before approving  
**Bulk actions** for batch uploads. **Auto-approve rules** configurable.  
Uploader always sees status: Pending → Approved → Rejected (with reason + resubmit option).

---

### § 08 — Asset Detail View

Full-screen view: **left 70% preview / right 30% collapsible metadata panel.**

**Top action bar:**
```
Download Original   Download Proxy   Share
Go to Project Files (Dropbox)   Open in Figma   Send to Premiere
```

**Metadata panel sections:**
- **Details** — name, file type, size, dimensions/duration, resolution, FPS, codec, color space, EXIF (camera/lens/ISO), shot date, GPS, uploader, product, tier badge (FINAL / RAW)
- **Personas** — auto-detected face avatars; prompt for unknown faces
- **Tags** — AI-suggested (confirm/dismiss individually) + manual
- **Versions** — full version history, one-click restore
- **Comments** — timecoded on video (scrubber markers), pinned on images, thread replies, @mentions
- **Used In** — collections, share links, products

**Video transcript panel:**
- Full scrollable transcript with timecodes and speaker labels
- Click any line → video jumps to that exact moment
- Keyword highlight on search within transcript
- Manually editable (fix transcription errors)
- Export: TXT, SRT, VTT, PDF

---

### § 09 — Personas (Real & AI)

Two types, one UI:

| Real Person | AI-Generated |
|---|---|
| Usage rights tracking | Model used (Midjourney, Flux, Runway…) |
| Contract file upload | Prompt recipe / seed references |
| License territory + expiry | Character sheet link |
| Restrictions ("no competitor brands") | Consistency notes |
| Social handles | No usage rights — they're ours |
| **Expiry alerts active** | **No expiry alerts** |

**Face recognition (like Google Photos / Apple Photos):**
1. AI detects faces on every upload
2. Unknown face → prompt: *"This is a new face — who is this?"*
3. User picks existing persona or creates new one — **one click, that's the only manual step**
4. All future uploads with that face are auto-tagged
5. Retroactive: *"We found 34 older assets that appear to match [Persona] — tag them?"*
6. False matches unlinkable in one click
7. Confidence threshold tunable

AI-generated personas use visual similarity instead of biometric matching.

**Persona page:** one grid of every asset (images + videos) featuring this persona. Filter by media type, product, date, Final vs Raw.

**Expiry alerts (real personas only):**
- 30 days → yellow strip + home dashboard
- 7 days → orange + email/Slack alert to admin
- Day of → red + optional auto-block on downloads

---

### § 10 — Video Transcription

- **Whisper** runs on every new video upload automatically
- Language auto-detected, manual override available
- Speaker diarization where possible
- Timecoded per sentence
- Processing status: Queued → Processing → Done
- Manually editable, export: TXT, SRT, VTT, PDF

**Search via transcript:**
- Search "product launch" → every video where those words were spoken
- Click result → video opens at exact second
- Boolean search: `"product launch" AND "Q4"`
- Filter transcript search by: product, date, persona, language
- Results show: thumbnail, matched quote in context, timecode, product name

---

### § 11 — Global Search (⌘K)

Searches across: filenames, AI + manual tags, video transcripts, persona names, product/bundle/campaign names, Brand Kit content, comments, OCR on PDFs/images.

**Results grouped by:** All · Assets · Personas · Products · Transcripts · Brand Kit  
Each result explains why it matched (e.g. *"found in transcript at 0:42"*).

**Visual similarity:** select an asset → "Find Similar" → AI returns visually similar assets.  
**Color search:** dominant color swatch picker in filters.  
**Saved searches** → become **Smart Collections** that auto-update.

---

### § 12 — Collections & Sharing

Collections are custom, user-created groupings outside the product hierarchy.  
Add any asset from anywhere (Final or Raw). Reorder manually. Cover thumbnail + description.

**Three sharing modes:**

| Mode | Who sees it |
|---|---|
| Private | Creator only |
| Team | Specific invited team members |
| Shared Link | External — generated with an auto-system-password |

**Shared link settings:** expiry date · download permissions (original / proxy-only / view-only) · watermark on/off  
**Access log:** who opened it, when, from where. Revoke anytime — link dies instantly.

Password is **system-generated, cryptographically secure, 12-character.** One-click copy link + password together or separately.

Share button is available on: every asset, every search result header, every category page, every persona page.

---

### § 13 — Brand Kit

A living, always-current page. One URL. Always correct. No more out-of-date PDFs.

9 sections, each with last-updated timestamp, edit button (admins), "Request Update" button (everyone):

1. **Identity** — name, tagline, mission, values, elevator pitch, brand story
2. **Colors** — per color: swatch, name, HEX, RGB, CMYK, HSL, Pantone, CSS var, usage rule. One-click copy on any value. Groups: Primary / Secondary / Neutral / Gradients / Do Not Use.
3. **Typography** — typeface, live preview, weights, font file download, license + expiry, fallback. Type scale table: H1→Body Small with size/weight/line-height/letter-spacing/usage.
4. **Logos** — every variant × every background (light/dark/mono/white/black knockout). Downloads: SVG, PNG transparent, EPS, PDF. Rules panel: clear space, min size, misuse gallery. Version history.
5. **Photography style** — mood board, do/don't pairs, shot types, color grade reference, `.cube` LUT download.
6. **Video style** — brand reel, pacing notes, transitions, motion language, `.mogrt` templates, title cards, music direction.
7. **Voice & tone** — personality adjectives, do/don't writing pairs by context, terminology list, sample copy blocks.
8. **Templates** — all channels: social (9:16, 1:1, 16:9), email, pitch deck, press kit, letterhead, ad banners, lower thirds, thumbnails, event backdrop. Each: preview, version, last updated, download, Open in Figma.
9. **Links & resources** — Figma library, Adobe CC library, brand guidelines PDF, press kit, media contact, all socials, legal notes.

**Smart features:** changelog strip at top, freshness indicators, search within Brand Kit, request-update on every section, "See where this is used" on any logo, external share link, iframe embed snippet for Notion/Confluence.

---

### § 14 — Integrations

| Integration | Type | What it does |
|---|---|---|
| **Dropbox** | OAuth per org, per-product folder link | Raw + Final folder picker per product; "Go to Project Files" deep-links to Dropbox desktop app |
| **Figma** | OAuth, per-product file, bidirectional | "Open in Figma" per asset; Brand Kit syncs colors/fonts/logos bidirectionally; push image from DAM → Figma frame; pull Figma frame → DAM as Final asset |
| **Premiere Pro** | UXP panel extension, .zxp installer | Browse + search library from inside Premiere, drag assets to timeline (proxy streams, original swaps on export), push exports back to DAM, transcript search → drop clip at timecode |
| **After Effects** | UXP panel extension | Same panel, same capabilities |
| **Slack** | OAuth, channel routing | Route any notification type to specific channel |
| **Email** | Transactional + digests | Upload digests, expiry alerts, approval alerts — configurable per user |

---

### § 15 — Roles & Permissions

Five roles with per-product overrides (user can be Editor on Product A, Viewer on Product B):

| Role | Access |
|---|---|
| **Admin** | Full. Manages team, billing, Brand Kit, all content, approval rules, integrations. |
| **Producer** | Creates/manages products. Approves upload queue. Views all content. |
| **Editor** | Uploads (may queue). Tags, comments, edits metadata. |
| **Viewer** | Read-only. Download permissions configurable per product. |
| **Client** | Read-only. Final assets only. Watermarked previews. No Raw. No internal comments. |

---

### § 16 — Notifications

Every event routable to: **in-app bell · email · Slack channel**

Events:
- Upload pending review (→ reviewers)
- Upload approved / rejected (→ uploader)
- New comment or @mention (→ mentioned user)
- Share link accessed (→ link creator)
- Persona contract expiring 30d / 7d / day-of (→ admin)
- Font license expiring 30d / 7d (→ admin)
- Template updated (→ users who downloaded prior version)
- Storage 80% / 95% quota (→ admin + owner)
- New team member joined (→ admin)
- Face detected, unknown (→ admin — "who is this?")

---

### § 17 — Analytics

| Module | What it shows |
|---|---|
| Storage | Total vs quota, broken down by product / file type / user / Raw vs Final. Trend over time. |
| Asset Activity | Most viewed, most downloaded, most shared. Orphaned content (zero views) flagged. |
| Team Activity | Uploads per user per week, comments, approvals processed. |
| Product Health | Raw ingested vs Final delivered. Products inactive 30+ days. Over-budget storage. |
| Search Intelligence | Top queries, zero-result queries (content gap), most-used filters. |
| Brand Kit Usage | Internal vs external open count, most-downloaded templates, request-update activity. |

---

### § 18 — Mobile (PWA)

- Installable PWA — "Add to home screen" on iOS + Android
- Bottom nav: Home · Library · Search · Personas · Profile
- 44px minimum tap targets
- Upload directly from camera roll on-set
- Swipe right = approve upload, swipe left = reject (reviewer flow)
- Video playback with transcript scrubbing
- Persona tagging via tap
- Offline cache of recently viewed assets
- Full feature parity — not a stripped desktop view

---

### § 19 — Technical Stack

**Deployment:**
- New subdomain under `particleface.com`
- Docker Compose on existing VPS infrastructure
- Git workflow: push to fork → pull on server → `docker compose up --build`
- Containers: Frontend (nginx), API (backend), Database (persistent volume)

**Infrastructure needed:**

| Component | Technology | Why |
|---|---|---|
| Object storage | Backblaze B2 or Cloudflare R2 | S3-compatible, much cheaper than AWS |
| Transcription | OpenAI Whisper (self-hosted or API) | Best accuracy, multi-language, open-source option |
| Face recognition | InsightFace / face_recognition | Background worker, async processing |
| AI tagging + similarity | Claude API + CLIP embeddings | Claude for semantic tagging, CLIP for visual similarity |
| Video proxy generation | FFmpeg worker queue | Auto-generates H.264 proxies on upload |
| Search index | Postgres full-text + pgvector | One DB handles text and vector search |
| OAuth | Standard OAuth2 | Dropbox, Figma, Slack, Google |
| Premiere panel | UXP extension | .zxp installer, one-click install |

**Security:**
- SSO: Google Workspace or Microsoft + optional 2FA
- Audit logs: every action logged with user + timestamp
- Daily backups, 90-day retention minimum
- HTTPS enforced, Let's Encrypt auto-renew
- .env handled securely on server — never committed

---

## § 20 — Build Roadmap

### Phase 1 — Foundation (Replace MediaValet)
- Upload, storage (R2/B2), asset library
- Final / Raw separation — two distinct workspaces
- Flexible product / bundle / campaign / shoot organization
- Global search (⌘K) with filters
- Dropbox + Figma "Go to Project Files / Open in Figma" buttons per asset
- Upload approval queue with trust levels
- Team roles + basic permissions (5 roles)

### Phase 2 — Intelligence Layer
- Video auto-transcription + transcript search (Whisper)
- Persona management — real + AI personas, unified media view
- Face recognition → one-click confirm → auto-tag future uploads
- AI auto-tagging suggestions (Claude + CLIP)
- Timecoded comments on video, pinned annotations on images

### Phase 3 — Brand & Collaboration
- Brand Kit — full 9-section page
- Collections — private, team, shared link with auto-password
- Premiere Pro + After Effects UXP panel extension
- Slack integration + routing

### Phase 4 — Polish & Intelligence
- Analytics dashboard
- Smart Collections (auto-updating saved searches)
- Mobile PWA polish + offline cache
- Version comparison, bulk operations, embed player

---

## Design Language (Non-Negotiables)

- **Dark-first** — `#0a0a0a` base, layered surfaces `#111` and `#151515`
- **One accent color** — TBD by coordinator (violet, warm orange, electric blue, or neon green). Used sparingly.
- **Typography** — display serif for hero moments, clean sans for UI, monospace for metadata/labels
- **Motion** — 150–200ms ease-out. Cards lift 2px on hover. Videos auto-preview on hover (silent). Never bounces, never spins forever.
- **Density** — information-dense where the job demands it, generous whitespace for hero moments
- **Details** — subtle grain texture on large surfaces, radial glows behind key CTAs, custom empty states, keyboard shortcuts everywhere

---

## Open Questions for Coordinator

- [ ] System name (guardrails: short, quiet confidence, works as a verb, Particle family)
- [ ] Logo / symbol concept (monogram or single-concept glyph)
- [ ] Primary accent color (violet, warm orange, electric blue, or neon green)
- [ ] Font system selection
- [ ] Which subdomain under `particleface.com`?
- [ ] Object storage vendor: Backblaze B2 or Cloudflare R2?
- [ ] Whisper: self-hosted GPU worker or OpenAI API?
