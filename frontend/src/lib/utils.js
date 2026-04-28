import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatBytes(bytes) {
  if (!bytes) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let value = bytes
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++ }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const EXT_GROUPS = {
  images:    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'tiff', 'bmp', 'heic', 'heif'],
  videos:    ['mp4', 'mov', 'avi', 'mkv', 'webm', 'mxf', 'prproj', 'r3d'],
  audio:     ['mp3', 'wav', 'aac', 'aiff', 'flac'],
  documents: ['pdf', 'psd', 'ai', 'eps', 'sketch', 'fig', 'xd', 'docx', 'xlsx', 'pptx'],
  archives:  ['zip', 'rar', '7z'],
}

export function extGroup(ext) {
  const e = (ext || '').toLowerCase()
  for (const [group, exts] of Object.entries(EXT_GROUPS)) {
    if (exts.includes(e)) return group
  }
  return 'other'
}

export const EXT_ICON = {
  images:    '🖼',
  videos:    '🎬',
  audio:     '🎵',
  documents: '📄',
  archives:  '📦',
  other:     '📎',
}
