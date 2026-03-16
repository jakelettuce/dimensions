import { Notification } from 'electron'
import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

export const notificationsCapability: CapabilityModule = {
  name: 'notifications',
  register(ctx: CapabilityContext) {
    // sdk.notify(title, body)
    ctx.ipcMain.handle('sdk:notify', async (_event, widgetId: unknown, title: unknown, body: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof title !== 'string') return { error: 'invalid_title' }
      if (typeof body !== 'string') return { error: 'invalid_body' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'notifications')
      } catch {
        return { error: 'capability_denied', capability: 'notifications', widgetId }
      }

      if (!Notification.isSupported()) {
        return { error: 'notifications_not_supported' }
      }

      try {
        const notification = new Notification({
          title,
          body,
        })
        notification.show()
        return null
      } catch (err) {
        return { error: 'notification_failed', message: err instanceof Error ? err.message : String(err) }
      }
    })
  },
}
