import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { persistDb } from '../database'
import { resolveRoute } from '../protocol'
import { loadSceneIntoWindow, cleanupPortalsForWindow } from '../window-manager'
import { destroyTerminalsForWindow } from '../terminal'

// Per-window navigation state: index into history for back/forward
const windowNavIndex = new Map<string, number>()

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

      const route = resolveRoute(url)
      if (route.type === 'scene') {
        // Clean up old scene resources
        destroyTerminalsForWindow(dimWin.id)
        cleanupPortalsForWindow(dimWin)

        loadSceneIntoWindow(dimWin, route.scenePath, route.dimensionId)
        windowNavIndex.set(dimWin.id, 0)
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

      const dimWin = ctx.getWindow(widgetId)
      if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }

      // Record current scene before going back
      const currentScene = ctx.getScene(widgetId)
      if (currentScene) {
        ctx.db.run(
          'INSERT INTO history (scene_id, timestamp) VALUES (?, ?)',
          [currentScene.id, Date.now()],
        )
        persistDb()
      }

      // Get current offset, increase by 1 to go further back
      const currentOffset = windowNavIndex.get(dimWin.id) ?? 0
      const nextOffset = currentOffset + 1

      // Query history: skip the entries we've gone back through, get the next one
      const result = ctx.db.exec(
        'SELECT scene_id FROM history ORDER BY id DESC LIMIT 1 OFFSET ?',
        [nextOffset],
      )

      if (result.length === 0 || result[0].values.length === 0) {
        return { error: 'no_history' }
      }

      const sceneId = result[0].values[0][0] as string

      // Resolve scene_id to path via scenes table
      const sceneResult = ctx.db.exec(
        'SELECT path FROM scenes WHERE id = ?',
        [sceneId],
      )

      if (sceneResult.length === 0 || sceneResult[0].values.length === 0) {
        return { error: 'scene_not_in_index', sceneId }
      }

      const scenePath = sceneResult[0].values[0][0] as string
      destroyTerminalsForWindow(dimWin.id)
      cleanupPortalsForWindow(dimWin)
      windowNavIndex.set(dimWin.id, nextOffset)
      loadSceneIntoWindow(dimWin, scenePath)
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

      const dimWin = ctx.getWindow(widgetId)
      if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }

      const currentOffset = windowNavIndex.get(dimWin.id) ?? 0
      if (currentOffset <= 0) {
        return { error: 'no_forward_history' }
      }

      const nextOffset = currentOffset - 1

      const result = ctx.db.exec(
        'SELECT scene_id FROM history ORDER BY id DESC LIMIT 1 OFFSET ?',
        [nextOffset],
      )

      if (result.length === 0 || result[0].values.length === 0) {
        return { error: 'no_forward_history' }
      }

      const sceneId = result[0].values[0][0] as string
      const sceneResult = ctx.db.exec(
        'SELECT path FROM scenes WHERE id = ?',
        [sceneId],
      )

      if (sceneResult.length === 0 || sceneResult[0].values.length === 0) {
        return { error: 'scene_not_in_index', sceneId }
      }

      const scenePath = sceneResult[0].values[0][0] as string
      destroyTerminalsForWindow(dimWin.id)
      cleanupPortalsForWindow(dimWin)
      windowNavIndex.set(dimWin.id, nextOffset)
      loadSceneIntoWindow(dimWin, scenePath)
      return null
    })
  },
}
