import { safeStorage } from 'electron'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { getDb, persistDb } from '../database'

// Migration SQL — add this to database.ts migrations:
// CREATE TABLE IF NOT EXISTS widget_secrets (
//   widget_id TEXT NOT NULL,
//   key TEXT NOT NULL,
//   encrypted_value BLOB NOT NULL,
//   PRIMARY KEY (widget_id, key)
// );

export const secretsCapability: CapabilityModule = {
  name: 'secrets',
  register(ctx: CapabilityContext) {
    // Ensure table exists
    ctx.db.run(`
      CREATE TABLE IF NOT EXISTS widget_secrets (
        widget_id TEXT NOT NULL,
        key TEXT NOT NULL,
        encrypted_value BLOB NOT NULL,
        PRIMARY KEY (widget_id, key)
      )
    `)

    // sdk.secrets.get(key)
    ctx.ipcMain.handle('sdk:secrets:get', async (_event, widgetId: unknown, key: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'secrets')
      } catch {
        return { error: 'capability_denied', capability: 'secrets', widgetId }
      }

      const result = ctx.db.exec(
        'SELECT encrypted_value FROM widget_secrets WHERE widget_id = ? AND key = ?',
        [widgetId, key],
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

    // sdk.secrets.set(key, value)
    ctx.ipcMain.handle('sdk:secrets:set', async (_event, widgetId: unknown, key: unknown, value: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }
      if (typeof value !== 'string') return { error: 'invalid_value' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'secrets')
      } catch {
        return { error: 'capability_denied', capability: 'secrets', widgetId }
      }

      if (!safeStorage.isEncryptionAvailable()) {
        return { error: 'encryption_unavailable' }
      }

      try {
        const encrypted = safeStorage.encryptString(value)
        ctx.db.run(
          `INSERT OR REPLACE INTO widget_secrets (widget_id, key, encrypted_value) VALUES (?, ?, ?)`,
          [widgetId, key, encrypted],
        )
        persistDb()
        return null
      } catch {
        return { error: 'encryption_failed', key }
      }
    })

    // sdk.secrets.delete(key)
    ctx.ipcMain.handle('sdk:secrets:delete', async (_event, widgetId: unknown, key: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof key !== 'string') return { error: 'invalid_key' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'secrets')
      } catch {
        return { error: 'capability_denied', capability: 'secrets', widgetId }
      }

      ctx.db.run(
        'DELETE FROM widget_secrets WHERE widget_id = ? AND key = ?',
        [widgetId, key],
      )
      persistDb()
      return null
    })
  },
}
