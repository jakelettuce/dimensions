import fs from 'fs'
import path from 'path'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { DIMENSIONS_DIR, buildAssetUrl } from '../constants'
import { assertPathWithin } from '../ipc-safety'

const ASSETS_MAX_FILE_BYTES = 500 * 1024 * 1024 // 500MB

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

      // Use widgetDir from WidgetState (resolved at scene load time)
      const assetsDir = path.join(widget.widgetDir, 'assets')
      if (!fs.existsSync(assetsDir)) {
        fs.mkdirSync(assetsDir, { recursive: true })
      }

      // Sanitize filename
      const safeName = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, '_')
      const assetPath = path.join(assetsDir, safeName)

      try {
        assertPathWithin(assetPath, assetsDir)
      } catch {
        return { error: 'path_traversal_blocked' }
      }

      const buffer = Buffer.from(base64, 'base64')

      if (buffer.length > ASSETS_MAX_FILE_BYTES) {
        return { error: 'file_too_large', maxBytes: ASSETS_MAX_FILE_BYTES }
      }

      fs.writeFileSync(assetPath, buffer)

      return buildAssetUrl(path.relative(DIMENSIONS_DIR, assetPath))
    })

    // sdk.assets.resolve(assetUrl)
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

      // Validate URL format
      if (!assetUrl.startsWith('dimensions-asset://')) {
        return { error: 'invalid_asset_url', expected: 'dimensions-asset://' }
      }

      // Validate underlying file exists
      try {
        const urlObj = new URL(assetUrl)
        const relativePath = decodeURIComponent(urlObj.pathname.replace(/^\//, ''))
        const resolvedPath = path.resolve(DIMENSIONS_DIR, relativePath)
        assertPathWithin(resolvedPath, DIMENSIONS_DIR)
        if (!fs.existsSync(resolvedPath)) {
          return { error: 'asset_not_found', url: assetUrl }
        }
      } catch {
        return { error: 'invalid_asset_url', url: assetUrl }
      }

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

      const assetsDir = path.join(widget.widgetDir, 'assets')
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
          return {
            url: buildAssetUrl(path.relative(DIMENSIONS_DIR, filePath)),
            name: f,
            size: stat.size,
            mimeType: mimeMap[ext] || 'application/octet-stream',
          }
        })
    })
  },
}
