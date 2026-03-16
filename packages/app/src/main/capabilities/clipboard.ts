import { clipboard } from 'electron'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

export const clipboardCapability: CapabilityModule = {
  name: 'clipboard',
  register(ctx: CapabilityContext) {
    // sdk.clipboard.read()
    ctx.ipcMain.handle('sdk:clipboard:read', async (_event, widgetId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'clipboard')
      } catch {
        return { error: 'capability_denied', capability: 'clipboard', widgetId }
      }

      try {
        const text = clipboard.readText()
        return ctx.sanitize(text)
      } catch (err) {
        return { error: 'clipboard_read_failed', message: err instanceof Error ? err.message : String(err) }
      }
    })

    // sdk.clipboard.write(text)
    ctx.ipcMain.handle('sdk:clipboard:write', async (_event, widgetId: unknown, text: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof text !== 'string') return { error: 'invalid_text' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'clipboard')
      } catch {
        return { error: 'capability_denied', capability: 'clipboard', widgetId }
      }

      try {
        clipboard.writeText(text)
        return null
      } catch (err) {
        return { error: 'clipboard_write_failed', message: err instanceof Error ? err.message : String(err) }
      }
    })
  },
}
