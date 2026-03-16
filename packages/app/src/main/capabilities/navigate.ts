import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { persistDb } from '../database'

export const navigateCapability: CapabilityModule = {
  name: 'navigate',
  register(ctx: CapabilityContext) {
    // sdk.navigate.to(url)
    ctx.ipcMain.handle('sdk:navigate:to', async (_event, widgetId: unknown, url: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof url !== 'string') return { error: 'invalid_url' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'navigate')
      } catch {
        return { error: 'capability_denied', capability: 'navigate', widgetId }
      }

      const dimWin = ctx.getWindow(widgetId)
      if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }

      // Record current scene in history before navigating
      const currentScene = ctx.getScene(widgetId)
      if (currentScene) {
        ctx.db.run(
          'INSERT INTO history (scene_id, timestamp) VALUES (?, ?)',
          [currentScene.id, Date.now()],
        )
        persistDb()
      }

      // Route through the window manager's navigate handler
      const { resolveRoute } = require('../protocol')
      const { loadSceneIntoWindow } = require('../window-manager')
      const route = resolveRoute(url)

      if (route.type === 'scene') {
        loadSceneIntoWindow(dimWin, route.scenePath, route.dimensionId)
        return null
      }

      return { error: 'route_not_found', url }
    })

    // sdk.navigate.back()
    ctx.ipcMain.handle('sdk:navigate:back', async (_event, widgetId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'navigate')
      } catch {
        return { error: 'capability_denied', capability: 'navigate', widgetId }
      }

      // Get previous scene from history
      const result = ctx.db.exec(
        'SELECT scene_id FROM history ORDER BY id DESC LIMIT 1 OFFSET 1',
      )

      if (result.length === 0 || result[0].values.length === 0) {
        return { error: 'no_history' }
      }

      // TODO: resolve scene_id back to path and load it
      return null
    })

    // sdk.navigate.forward()
    ctx.ipcMain.handle('sdk:navigate:forward', async (_event, widgetId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'navigate')
      } catch {
        return { error: 'capability_denied', capability: 'navigate', widgetId }
      }

      // TODO: implement forward navigation
      return null
    })
  },
}
