import fs from 'fs'
import path from 'path'
import { app, nativeImage } from 'electron'
import { ulid } from 'ulid'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { importMedia, getMimeType } from '../media-library'
import { DIMENSIONS_DIR, ASSET_ORIGIN } from '../constants'
import { assertPathWithin } from '../ipc-safety'

const MAX_IMPORT_BYTES = 100 * 1024 * 1024 // 100MB cap for URL imports

export const mediaDropCapability: CapabilityModule = {
  name: 'media-drop',
  register(ctx) {
    // Import a dropped file into the media library
    ctx.ipcMain.handle('sdk:media:importDrop', async (_event, widgetId: unknown, fileData: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found' }
      assertCapability(widget, 'media-drop')

      const fd = fileData as any
      if (!fd?.name || !fd?.data || !fd?.mimeType) return { error: 'invalid_file_data' }

      const data = fd.data
      if (!(data instanceof ArrayBuffer) && !Buffer.isBuffer(data)) return { error: 'invalid_data' }
      if ((data as ArrayBuffer).byteLength > 500 * 1024 * 1024) return { error: 'file_too_large' }

      const tempPath = path.join(app.getPath('temp'), `dimensions-drop-${ulid()}`)
      fs.writeFileSync(tempPath, Buffer.from(data))

      try {
        const url = importMedia(tempPath, fd.name, fd.mimeType)
        return { url }
      } finally {
        try { fs.unlinkSync(tempPath) } catch {}
      }
    })

    // Import media from a URL (e.g. dropped from a portal via native drag)
    ctx.ipcMain.handle('sdk:media:importFromUrl', async (_event, widgetId: unknown, url: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof url !== 'string') return { error: 'invalid_url' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found' }
      assertCapability(widget, 'media-drop')

      // Only http/https URLs
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { error: 'invalid_url_scheme' }
      }

      try {
        // Use Electron's net module via the portal's session to follow redirects
        // with proper browser headers (cookies, user-agent) — same as the portal itself
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Accept': 'image/*,video/*,audio/*,*/*;q=0.8',
          },
          redirect: 'follow',
        })
        if (!response.ok) return { error: 'download_failed', status: response.status }

        const contentType = response.headers.get('content-type') || ''

        const contentLength = parseInt(response.headers.get('content-length') || '0')
        if (contentLength > MAX_IMPORT_BYTES) return { error: 'file_too_large', maxBytes: MAX_IMPORT_BYTES }

        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length > MAX_IMPORT_BYTES) return { error: 'file_too_large', maxBytes: MAX_IMPORT_BYTES }

        // Extract filename from URL
        const urlObj = new URL(url)
        const pathParts = urlObj.pathname.split('/')
        let filename = decodeURIComponent(pathParts[pathParts.length - 1] || 'download')
        if (!path.extname(filename)) filename += '.png'

        const tempPath = path.join(app.getPath('temp'), `dimensions-url-import-${ulid()}-${filename}`)
        fs.writeFileSync(tempPath, buffer)

        try {
          // Use content-type from response if available, fall back to extension
          const mimeType = (contentType && !contentType.includes('octet-stream'))
            ? contentType.split(';')[0].trim()
            : getMimeType(tempPath)
          const mediaUrl = importMedia(tempPath, filename, mimeType)
          return { url: mediaUrl }
        } finally {
          try { fs.unlinkSync(tempPath) } catch {}
        }
      } catch (err) {
        return { error: 'download_failed', details: err instanceof Error ? err.message : String(err) }
      }
    })

    // Initiate OS-level drag from a widget (no capability required)
    ctx.ipcMain.handle('sdk:media:startDrag', async (_event, widgetId: unknown, assetUrl: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof assetUrl !== 'string') return { error: 'invalid_url' }

      const prefix = `${ASSET_ORIGIN}/_media/`
      if (!assetUrl.startsWith(prefix)) return { error: 'invalid_asset_url' }

      const filename = assetUrl.slice(prefix.length)
      if (filename.includes('/') || filename.includes('..')) return { error: 'invalid_filename' }

      const mediaDir = path.join(DIMENSIONS_DIR, '_media')
      const filePath = path.join(mediaDir, filename)
      assertPathWithin(filePath, mediaDir)

      if (!fs.existsSync(filePath)) return { error: 'file_not_found' }

      const dimWin = ctx.getWindow(widgetId)
      if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }

      const icon = nativeImage.createFromPath(filePath).resize({ width: 64, height: 64 })
      dimWin.sceneWCV.webContents.startDrag({ file: filePath, icon })

      return { success: true }
    })
  },
}
