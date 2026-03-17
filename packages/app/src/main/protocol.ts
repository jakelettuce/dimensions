import { protocol } from 'electron'
import fs from 'fs'
import path from 'path'
import { SCHEME_DIMENSIONS, SCHEME_ASSET, DIMENSIONS_DIR } from './constants'
import { assertPathWithin } from './ipc-safety'
import { DimensionMetaSchema } from './schemas'

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
}

// ── Route types ──

export type SceneRoute =
  | { type: 'app'; route: string }
  | { type: 'scene'; dimensionId: string | null; dimensionPath: string | null; scenePath: string; widgetHash: string }
  | { type: 'not_found' }

const APP_ROUTES = new Set(['home', 'settings', 'settings/env'])

// ── Registration (MUST call before app.ready) ──

export function registerProtocols(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME_DIMENSIONS,
      privileges: { standard: true, secure: true },
    },
    {
      scheme: SCHEME_ASSET,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ])
}

// ── Handler registration (call AFTER app.ready) ──

export function registerProtocolHandlers(): void {
  // dimensions-asset:// — read-only static file serving
  // Format: dimensions-asset://scene-slug/widgets/widget-id/assets/image.png
  // Resolves to: ~/Dimensions/scene-slug/widgets/widget-id/assets/image.png
  protocol.handle(SCHEME_ASSET, (request) => {
    const url = new URL(request.url)
    // hostname + pathname gives us the full path
    const relativePath = decodeURIComponent(url.hostname + url.pathname)
    const resolvedPath = path.resolve(DIMENSIONS_DIR, relativePath)

    // SECURITY: validate path is within ~/Dimensions/
    try {
      assertPathWithin(resolvedPath, DIMENSIONS_DIR)
    } catch {
      return new Response('Forbidden', { status: 403 })
    }

    if (!fs.existsSync(resolvedPath)) {
      return new Response('Not Found', { status: 404 })
    }

    // Serve file directly — no file:// protocol, no CORS issues
    const data = fs.readFileSync(resolvedPath)
    const ext = path.extname(resolvedPath).toLowerCase()
    return new Response(data, {
      headers: { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' },
    })
  })

  // dimensions:// — navigation protocol
  // Handled by the window manager via IPC, not by returning content.
  // We still register a handler to avoid Electron errors on navigation.
  protocol.handle(SCHEME_DIMENSIONS, (_request) => {
    // Navigation is intercepted by window-manager before it reaches here.
    // This handler exists as a fallback — return empty response.
    return new Response('', { status: 200, headers: { 'Content-Type': 'text/html' } })
  })
}

// ── Route resolution ──

export function resolveRoute(url: string): SceneRoute {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return { type: 'not_found' }
  }

  if (parsed.protocol !== `${SCHEME_DIMENSIONS}:`) {
    return { type: 'not_found' }
  }

  // dimensions://home, dimensions://settings, dimensions://settings/env
  const fullPath = (parsed.hostname + parsed.pathname).replace(/^\/+|\/+$/g, '')

  if (APP_ROUTES.has(fullPath)) {
    return { type: 'app', route: fullPath }
  }

  // User content: dimensions://go/...
  if (!fullPath.startsWith('go/')) {
    return { type: 'not_found' }
  }

  const contentPath = fullPath.slice(3) // strip "go/"
  return routeToContent(contentPath, parsed.hash.replace('#', ''))
}

function routeToContent(contentPath: string, hash: string): SceneRoute {
  const parts = contentPath.split('/').filter(Boolean)
  if (parts.length === 0) return { type: 'not_found' }

  const identifier = parts[0] // could be a folder name, dimension ID, or scene ID

  // Try direct folder match first (fast path)
  const basePath = path.join(DIMENSIONS_DIR, identifier)

  // Check if it's a dimension folder
  const dimensionJsonPath = path.join(basePath, 'dimension.json')
  if (fs.existsSync(dimensionJsonPath)) {
    return resolveDimension(basePath, parts[1], hash)
  }

  // Check if it's a standalone scene folder
  const metaJsonPath = path.join(basePath, 'meta.json')
  if (fs.existsSync(metaJsonPath)) {
    return {
      type: 'scene',
      dimensionId: null,
      dimensionPath: null,
      scenePath: basePath,
      widgetHash: hash,
    }
  }

  // Not a direct folder match — scan for matching ID
  // This supports dimensions://go/{dimension-id} and dimensions://go/{scene-id}
  if (fs.existsSync(DIMENSIONS_DIR)) {
    for (const entry of fs.readdirSync(DIMENSIONS_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue
      const entryPath = path.join(DIMENSIONS_DIR, entry.name)

      // Check dimension ID match
      const dimPath = path.join(entryPath, 'dimension.json')
      if (fs.existsSync(dimPath)) {
        try {
          const raw = JSON.parse(fs.readFileSync(dimPath, 'utf-8'))
          if (raw.id === identifier) {
            return resolveDimension(entryPath, parts[1], hash)
          }
        } catch {}
      }

      // Check scene ID match
      const sceneMeta = path.join(entryPath, 'meta.json')
      if (fs.existsSync(sceneMeta)) {
        try {
          const raw = JSON.parse(fs.readFileSync(sceneMeta, 'utf-8'))
          if (raw.id === identifier) {
            return {
              type: 'scene',
              dimensionId: null,
              dimensionPath: null,
              scenePath: entryPath,
              widgetHash: hash,
            }
          }
        } catch {}
      }
    }
  }

  return { type: 'not_found' }
}

function resolveDimension(dimensionPath: string, sceneSlug: string | undefined, hash: string): SceneRoute {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dimensionPath, 'dimension.json'), 'utf-8'))
    const dimMeta = DimensionMetaSchema.parse(raw)
    const sceneName = sceneSlug || dimMeta.entryScene || dimMeta.scenes[0]
    if (!sceneName) return { type: 'not_found' }
    if (!dimMeta.scenes.includes(sceneName)) return { type: 'not_found' }
    const scenePath = path.join(dimensionPath, sceneName)
    // Prevent path traversal via malicious scenes: ["../../etc"]
    assertPathWithin(scenePath, DIMENSIONS_DIR)
    return {
      type: 'scene',
      dimensionId: dimMeta.id ?? null,
      dimensionPath: dimensionPath,
      scenePath,
      widgetHash: hash,
    }
  } catch {
    return { type: 'not_found' }
  }
}

/**
 * Build a dimensions-asset:// URL for a file within a scene.
 * @param scenePath Absolute path to the scene folder
 * @param relativePath Path relative to the scene folder
 */
export function buildAssetUrl(scenePath: string, relativePath: string): string {
  const sceneRelative = path.relative(DIMENSIONS_DIR, scenePath)
  return `${SCHEME_ASSET}://${sceneRelative}/${relativePath}`
}
