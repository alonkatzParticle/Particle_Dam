/**
 * Module-level in-memory cache for library page data.
 * Persists across React component remounts (route switches).
 * Keys: 'raw' or 'ads'
 */
const cache = new Map()

export function getCache(key) {
  return cache.get(key) ?? null
}

export function setCache(key, value) {
  cache.set(key, value)
}

// Per-asset thumbnail error state — prevents failed images from retrying on remount
const thumbErrors = new Set()

export function wasThumbError(assetId) {
  return thumbErrors.has(String(assetId))
}

export function markThumbError(assetId) {
  thumbErrors.add(String(assetId))
}
