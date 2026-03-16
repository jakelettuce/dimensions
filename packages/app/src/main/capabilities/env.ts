import { safeStorage } from 'electron'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { getDb, persistDb } from '../database'

// Migration SQL — add this to database.ts migrations:
// CREATE TABLE IF NOT EXISTS env_values (
//   key TEXT PRIMARY KEY,
//   encrypted_value BLOB NOT NULL
// );

export const envCapability: CapabilityModule = {
  name: 'env',
  register(ctx: CapabilityContext) {
    // Ensure table exists
    ctx.db.run(`
      CREATE TABLE IF NOT EXISTS env_values (
        key TEXT PRIMARY KEY,
        encrypted_value BLOB NOT NULL
      )
    `)

    // sdk.env.get(key)
    ctx.ipcMain.handle('sdk:env:get', async (_event, widgetId: unknown, key: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'env')
      } catch {
        return { error: 'capability_denied', capability: 'env', widgetId }
      }

      // Validate key is in manifest envKeys
      const envKeys = widget.manifest.envKeys ?? []
      if (!envKeys.includes(key)) {
        return { error: 'env_key_not_allowed', key, allowedKeys: envKeys }
      }

      const result = ctx.db.exec(
        'SELECT encrypted_value FROM env_values WHERE key = ?',
        [key],
      )

      if (result.length === 0 || result[0].values.length === 0) {
        return null
      }

      const encryptedValue = result[0].values[0][0] as Uint8Array
      if (!safeStorage.isEncryptionAvailable()) {
        return { error: 'encryption_unavailable' }
      }

      try {
        const decrypted = safeStorage.decryptString(Buffer.from(encryptedValue))
        return ctx.sanitize(decrypted)
      } catch {
        return { error: 'decryption_failed', key }
      }
    })

    // sdk.env.set(key, value) — for V1 single-player: auto-grant, no prompt
    ctx.ipcMain.handle('sdk:env:set', async (_event, widgetId: unknown, key: unknown, value: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }
      if (typeof value !== 'string') return { error: 'invalid_value' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'env')
      } catch {
        return { error: 'capability_denied', capability: 'env', widgetId }
      }

      // Validate key is in manifest envKeys
      const envKeys = widget.manifest.envKeys ?? []
      if (!envKeys.includes(key)) {
        return { error: 'env_key_not_allowed', key, allowedKeys: envKeys }
      }

      if (!safeStorage.isEncryptionAvailable()) {
        return { error: 'encryption_unavailable' }
      }

      try {
        const encrypted = safeStorage.encryptString(value)
        ctx.db.run(
          `INSERT OR REPLACE INTO env_values (key, encrypted_value) VALUES (?, ?)`,
          [key, encrypted],
        )
        persistDb()
        return null
      } catch {
        return { error: 'encryption_failed', key }
      }
    })

    // sdk.env.delete(key)
    ctx.ipcMain.handle('sdk:env:delete', async (_event, widgetId: unknown, key: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'env')
      } catch {
        return { error: 'capability_denied', capability: 'env', widgetId }
      }

      const envKeys = widget.manifest.envKeys ?? []
      if (!envKeys.includes(key)) {
        return { error: 'env_key_not_allowed', key, allowedKeys: envKeys }
      }

      ctx.db.run('DELETE FROM env_values WHERE key = ?', [key])
      persistDb()
      return null
    })
  },
}
