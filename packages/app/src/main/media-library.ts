/**
 * Centralized Media Library
 * =========================
 * All media lives in ~/Dimensions/_media/ — deduplicated by content hash.
 * Widgets reference media via dimensions-asset://app/_media/filename URLs.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { DIMENSIONS_DIR, ASSET_ORIGIN } from './constants'

const MEDIA_DIR = path.join(DIMENSIONS_DIR, '_media')
const METADATA_PATH = path.join(MEDIA_DIR, 'metadata.json')

export interface MediaReference {
  scenePath: string   // absolute path to scene folder
  widgetId: string    // widget instance ID
  propKey: string     // prop key that holds the URL
}

interface MediaMeta {
  originalName: string
  mimeType: string
  size: number
  addedAt: number
  references: MediaReference[]
}

export interface MediaEntry {
  filename: string
  url: string
  meta: MediaMeta
}

// ── MIME type detection by extension ──

const EXT_TO_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
}

export function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return EXT_TO_MIME[ext] || 'application/octet-stream'
}

// ── File dialog filter builder ──

export function buildDialogFilters(accept?: string[]): Electron.FileFilter[] {
  if (!accept || accept.length === 0) {
    return [{ name: 'Media', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'] }]
  }

  const extensions: string[] = []
  for (const pattern of accept) {
    if (pattern === 'image/*') extensions.push('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico')
    else if (pattern === 'video/*') extensions.push('mp4', 'webm', 'mov', 'avi', 'mkv')
    else if (pattern === 'audio/*') extensions.push('mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a')
    else {
      // Specific MIME → find matching extensions
      for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
        if (mime === pattern) extensions.push(ext.slice(1))
      }
    }
  }

  return extensions.length > 0
    ? [{ name: 'Media', extensions: [...new Set(extensions)] }]
    : [{ name: 'All Files', extensions: ['*'] }]
}

// ── Internal helpers ──

function ensureMediaDir(): void {
  if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR, { recursive: true })
  }
}

function readMetadata(): Record<string, MediaMeta> {
  try {
    if (!fs.existsSync(METADATA_PATH)) return {}
    return JSON.parse(fs.readFileSync(METADATA_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function writeMetadata(meta: Record<string, MediaMeta>): void {
  ensureMediaDir()
  fs.writeFileSync(METADATA_PATH, JSON.stringify(meta, null, 2), 'utf-8')
}

function hashFile(filePath: string): string {
  const data = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 24)
}

function assertWithinMediaDir(targetPath: string): void {
  const resolved = path.resolve(targetPath)
  const mediaResolved = path.resolve(MEDIA_DIR)
  if (!resolved.startsWith(mediaResolved + path.sep) && resolved !== mediaResolved) {
    throw new Error('Path traversal blocked')
  }
}

// ── Public API ──

/**
 * Import a file into the media library.
 * Returns a dimensions-asset:// URL.
 */
export function importMedia(sourcePath: string, originalName: string, mimeType: string): string {
  ensureMediaDir()

  const hash = hashFile(sourcePath)
  const ext = path.extname(originalName).toLowerCase() || path.extname(sourcePath).toLowerCase()
  const filename = `${hash}${ext}`
  const destPath = path.join(MEDIA_DIR, filename)

  assertWithinMediaDir(destPath)

  // Deduplicate — only copy if not already present
  if (!fs.existsSync(destPath)) {
    fs.copyFileSync(sourcePath, destPath)
  }

  // Update metadata
  const meta = readMetadata()
  if (!meta[filename]) {
    meta[filename] = {
      originalName,
      mimeType,
      size: fs.statSync(destPath).size,
      addedAt: Date.now(),
      references: [],
    }
    writeMetadata(meta)
  }

  return `${ASSET_ORIGIN}/_media/${filename}`
}

/**
 * List all media entries.
 */
export function listMedia(): MediaEntry[] {
  const meta = readMetadata()
  return Object.entries(meta).map(([filename, m]) => ({
    filename,
    url: `${ASSET_ORIGIN}/_media/${filename}`,
    meta: m,
  }))
}

/**
 * List media filtered by MIME patterns (e.g. ["image/*", "video/mp4"]).
 */
export function listMediaFiltered(accept: string[]): MediaEntry[] {
  if (accept.length === 0) return listMedia()
  return listMedia().filter(entry => matchesAccept(entry.meta.mimeType, accept))
}

/**
 * Delete a media file and its metadata entry.
 */
export function deleteMedia(filename: string): void {
  // Security: no path separators in filename
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
    throw new Error('Invalid filename')
  }

  const filePath = path.join(MEDIA_DIR, filename)
  assertWithinMediaDir(filePath)

  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }

  const meta = readMetadata()
  delete meta[filename]
  writeMetadata(meta)
}

/**
 * Check if a MIME type matches any of the accept patterns.
 * "image/*" matches "image/jpeg". "video/mp4" matches exactly.
 */
/**
 * Extract the filename from a media URL.
 * dimensions-asset://app/_media/a1b2c3.jpg → a1b2c3.jpg
 */
export function filenameFromUrl(url: string): string | null {
  const prefix = `${ASSET_ORIGIN}/_media/`
  if (!url.startsWith(prefix)) return null
  const fn = url.slice(prefix.length)
  if (fn.includes('/') || fn.includes('..')) return null
  return fn
}

/**
 * Add a reference to a media file. Called when a media prop is set.
 */
export function addMediaReference(url: string, scenePath: string, widgetId: string, propKey: string): void {
  const fn = filenameFromUrl(url)
  if (!fn) return
  const meta = readMetadata()
  const entry = meta[fn]
  if (!entry) return
  if (!entry.references) entry.references = []
  // Avoid duplicates
  const exists = entry.references.some(r => r.scenePath === scenePath && r.widgetId === widgetId && r.propKey === propKey)
  if (!exists) {
    entry.references.push({ scenePath, widgetId, propKey })
    writeMetadata(meta)
  }
}

/**
 * Remove a reference from a media file. Called when a media prop is reset or URL removed.
 */
export function removeMediaReference(url: string, scenePath: string, widgetId: string, propKey: string): void {
  const fn = filenameFromUrl(url)
  if (!fn) return
  const meta = readMetadata()
  const entry = meta[fn]
  if (!entry || !entry.references) return
  entry.references = entry.references.filter(
    r => !(r.scenePath === scenePath && r.widgetId === widgetId && r.propKey === propKey)
  )
  writeMetadata(meta)
}

/**
 * Sync references for a media prop value (array of URLs).
 * Removes stale refs and adds new ones for the given widget+prop.
 */
export function syncMediaReferences(urls: string[], scenePath: string, widgetId: string, propKey: string): void {
  const meta = readMetadata()
  const urlSet = new Set(urls)

  // Remove old references for this widget+prop from all entries
  for (const [, entry] of Object.entries(meta)) {
    if (!entry.references) continue
    entry.references = entry.references.filter(
      r => !(r.scenePath === scenePath && r.widgetId === widgetId && r.propKey === propKey)
    )
  }

  // Add new references
  for (const url of urls) {
    const fn = filenameFromUrl(url)
    if (!fn || !meta[fn]) continue
    if (!meta[fn].references) meta[fn].references = []
    meta[fn].references.push({ scenePath, widgetId, propKey })
  }

  writeMetadata(meta)
}

/**
 * Get all references for a media file.
 */
export function getMediaReferences(filename: string): MediaReference[] {
  const meta = readMetadata()
  return meta[filename]?.references ?? []
}

export function matchesAccept(mimeType: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (pattern === mimeType) return true
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -1) // "image/"
      if (mimeType.startsWith(prefix)) return true
    }
  }
  return false
}
