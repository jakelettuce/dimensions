import fs from 'fs'
import path from 'path'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { DIMENSIONS_DIR } from '../constants'
import { assertPathWithin } from '../ipc-safety'

export const assetsCapability: CapabilityModule = {
  name: 'assets',
  register(ctx: CapabilityContext) {
    // sdk.assets.upload(name, mimeType, base64)
    ctx.ipcMain.handle('sdk:assets:upload', async (_event, widgetId: unknown, name: unknown, mimeType: unknown, base64: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof name !== 'string') return { error: 'invalid_name' }
      if (typeof mimeType !== 'string') return { error: 'invalid_mime_type' }
      if (typeof base64 !== 'string') return { error: 'invalid_data' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'assets')
      } catch {
        return { error: 'capability_denied', capability: 'assets', widgetId }
      }

      // Resolve asset path within widget's assets/ directory
      const widgetDir = resolveWidgetDir(widget.scenePath, widgetId)
      if (!widgetDir) return { error: 'widget_dir_not_found' }

      const assetsDir = path.join(widgetDir, 'assets')
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true })
      }

      // Sanitize filename — strip path separators
      const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')
      const assetPath = path.join(assetsDir, safeName)

      try {
        assertPathWithin(assetPath, assetsDir)
      } catch {
        return { error: 'path_traversal_blocked' }
      }

      // Decode base64 and write
      const buffer = Buffer.from(base64, 'base64')
      fs.writeFileSync(assetPath, buffer)

      // Return dimensions-asset:// URL
      const relPath = path.relative(DIMENSIONS_DIR, assetPath).split(path.sep).join('/')
      return `dimensions-asset://${relPath}`
    })

    // sdk.assets.resolve(assetUrl) — convert dimensions-asset:// URL to a usable URL
    ctx.ipcMain.handle('sdk:assets:resolve', async (_event, widgetId: unknown, assetUrl: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof assetUrl !== 'string') return { error: 'invalid_url' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'assets')
      } catch {
        return { error: 'capability_denied', capability: 'assets', widgetId }
      }

      // dimensions-asset:// URLs are directly usable in iframes served from the same protocol
      return assetUrl
    })

    // sdk.assets.list()
    ctx.ipcMain.handle('sdk:assets:list', async (_event, widgetId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'assets')
      } catch {
        return { error: 'capability_denied', capability: 'assets', widgetId }
      }

      const widgetDir = resolveWidgetDir(widget.scenePath, widgetId)
      if (!widgetDir) return []

      const assetsDir = path.join(widgetDir, 'assets')
      if (!fs.existsSync(assetsDir)) return []

      const files = fs.readdirSync(assetsDir)
      return files
        .filter((f) => !f.startsWith('.'))
        .map((f) => {
          const filePath = path.join(assetsDir, f)
          const stat = fs.statSync(filePath)
          const ext = path.extname(f).toLowerCase()
          const mimeMap: Record<string, string> = {
            '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
            '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg',
            '.pdf': 'application/pdf', '.json': 'application/json',
          }
          const relPath = path.relative(DIMENSIONS_DIR, filePath).split(path.sep).join('/')
          return {
            url: `dimensions-asset://${relPath}`,
            name: f,
            size: stat.size,
            mimeType: mimeMap[ext] || 'application/octet-stream',
          }
        })
    })
  },
}

function resolveWidgetDir(scenePath: string, widgetId: string): string | null {
  const widgetsDir = path.join(scenePath, 'widgets')
  if (!fs.existsSync(widgetsDir)) return null

  // Find widget directory by checking manifests
  const entries = fs.readdirSync(widgetsDir)
  for (const entry of entries) {
    const manifestPath = path.join(widgetsDir, entry, 'src', 'widget.manifest.json')
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
        if (raw.id === widgetId) {
          return path.join(widgetsDir, entry)
        }
      } catch {}
    }
  }
  return null
}
