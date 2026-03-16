import fs from 'fs'
import path from 'path'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

export const editingCapability: CapabilityModule = {
  name: 'editing',
  register(ctx: CapabilityContext) {
    // sdk.editing.setBounds(widgetId, bounds)
    ctx.ipcMain.handle('sdk:editing:setBounds', async (_event, widgetId: unknown, targetWidgetId: unknown, bounds: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof targetWidgetId !== 'string') return { error: 'invalid_target_widget_id' }
      if (!bounds || typeof bounds !== 'object') return { error: 'invalid_bounds' }

      const { x, y, width, height } = bounds as Record<string, unknown>
      if (typeof x !== 'number' || typeof y !== 'number' ||
          typeof width !== 'number' || typeof height !== 'number') {
        return { error: 'invalid_bounds', expected: '{ x: number, y: number, width: number, height: number }' }
      }

      if (width < 1 || height < 1) {
        return { error: 'invalid_bounds', message: 'width and height must be >= 1' }
      }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'editing')
      } catch {
        return { error: 'capability_denied', capability: 'editing', widgetId }
      }

      const dimWin = ctx.getWindow(widgetId)
      if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }
      if (!dimWin.currentScene) return { error: 'scene_not_found' }

      // Find the target widget entry in scene meta
      const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === targetWidgetId)
      if (!entry) return { error: 'target_widget_not_found', targetWidgetId }

      // Update bounds in memory
      entry.bounds = {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      }

      // Persist to meta.json
      try {
        const metaPath = path.join(dimWin.currentScene.path, 'meta.json')
        fs.writeFileSync(metaPath, JSON.stringify(dimWin.currentScene.meta, null, 2), 'utf-8')
      } catch (err) {
        return { error: 'persist_failed', message: err instanceof Error ? err.message : String(err) }
      }

      return null
    })

    // sdk.editing.getBounds(targetWidgetId)
    ctx.ipcMain.handle('sdk:editing:getBounds', async (_event, widgetId: unknown, targetWidgetId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof targetWidgetId !== 'string') return { error: 'invalid_target_widget_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'editing')
      } catch {
        return { error: 'capability_denied', capability: 'editing', widgetId }
      }

      const dimWin = ctx.getWindow(widgetId)
      if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }
      if (!dimWin.currentScene) return { error: 'scene_not_found' }

      const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === targetWidgetId)
      if (!entry) return { error: 'target_widget_not_found', targetWidgetId }

      return ctx.sanitize(entry.bounds)
    })

    // sdk.editing.selectWidget(targetWidgetId)
    ctx.ipcMain.handle('sdk:editing:select', async (_event, widgetId: unknown, targetWidgetId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof targetWidgetId !== 'string') return { error: 'invalid_target_widget_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'editing')
      } catch {
        return { error: 'capability_denied', capability: 'editing', widgetId }
      }

      const dimWin = ctx.getWindow(widgetId)
      if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }

      // Forward selection event to the renderer
      dimWin.browserWindow.webContents.send('sdk:editing:widget-selected', targetWidgetId)
      return null
    })
  },
}
