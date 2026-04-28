# ── Stage 1: Build the React frontend ──────────────────────────────────────
FROM node:20-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build


# ── Stage 2: Production image ────────────────────────────────────────────────
# node:20-slim uses Debian (glibc) — required for onnxruntime-node prebuilt binaries.
# node:20-alpine uses musl and cannot load glibc-linked .node native modules.
FROM node:20-slim

# ffmpeg needed for AI video frame extraction
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install backend production dependencies
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# Copy backend source
COPY backend/ ./backend/

# Copy built frontend from Stage 1
COPY --from=frontend-build /build/frontend/dist ./frontend/dist

# Databases are volume-mounted at runtime — never baked into the image
# model_cache is also volume-mounted to avoid re-downloading on each restart

EXPOSE 3001

WORKDIR /app/backend
CMD ["node", "server.js"]
