import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { persistDb } from '../database'

export const kvCapability: CapabilityModule = {
  name: 'kv',
  register(ctx: CapabilityContext) {
    // sdk.kv.get(key)
    ctx.ipcMain.handle('sdk:kv:get', async (_event, widgetId: unknown, key: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'kv')
      } catch {
        return { error: 'capability_denied', capability: 'kv', widgetId }
      }

      const scene = ctx.getScene(widgetId)
      if (!scene) return { error: 'scene_not_found' }

      const result = ctx.db.exec(
        'SELECT value FROM kv WHERE widget_id = ? AND scene_id = ? AND key = ?',
        [widgetId, scene.id, key],
      )

      if (result.length === 0 || result[0].values.length === 0) {
        return null
      }

      try {
        return JSON.parse(result[0].values[0][0] as string)
      } catch {
        return result[0].values[0][0]
      }
    })

    // sdk.kv.set(key, value)
    ctx.ipcMain.handle('sdk:kv:set', async (_event, widgetId: unknown, key: unknown, jsonValue: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }
      if (typeof jsonValue !== 'string') return { error: 'invalid_value' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'kv')
      } catch {
        return { error: 'capability_denied', capability: 'kv', widgetId }
      }

      const scene = ctx.getScene(widgetId)
      if (!scene) return { error: 'scene_not_found' }

      ctx.db.run(
        `INSERT OR REPLACE INTO kv (widget_id, scene_id, key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [widgetId, scene.id, key, jsonValue, Date.now()],
      )
      persistDb()
      return null
    })

    // sdk.kv.delete(key)
    ctx.ipcMain.handle('sdk:kv:delete', async (_event, widgetId: unknown, key: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'kv')
      } catch {
        return { error: 'capability_denied', capability: 'kv', widgetId }
      }

      const scene = ctx.getScene(widgetId)
      if (!scene) return { error: 'scene_not_found' }

      ctx.db.run(
        'DELETE FROM kv WHERE widget_id = ? AND scene_id = ? AND key = ?',
        [widgetId, scene.id, key],
      )
      persistDb()
      return null
    })

    // sdk.kv.list(prefix)
    ctx.ipcMain.handle('sdk:kv:list', async (_event, widgetId: unknown, prefix: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof prefix !== 'string') return { error: 'invalid_prefix' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'kv')
      } catch {
        return { error: 'capability_denied', capability: 'kv', widgetId }
      }

      const scene = ctx.getScene(widgetId)
      if (!scene) return { error: 'scene_not_found' }

      const result = ctx.db.exec(
        'SELECT key FROM kv WHERE widget_id = ? AND scene_id = ? AND key LIKE ?',
        [widgetId, scene.id, prefix + '%'],
      )

      if (result.length === 0) return []
      return result[0].values.map((row) => row[0] as string)
    })
  },
}
