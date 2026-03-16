import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

export const themeCapability: CapabilityModule = {
  name: 'theme',
  register(ctx: CapabilityContext) {
    // sdk.theme.get()
    ctx.ipcMain.handle('sdk:theme:get', async (_event, widgetId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'theme')
      } catch {
        return { error: 'capability_denied', capability: 'theme', widgetId }
      }

      const scene = ctx.getScene(widgetId)
      if (!scene) return { error: 'scene_not_found' }

      return ctx.sanitize(scene.meta.theme ?? { background: '#0a0a0a', accent: '#7c3aed' })
    })

    // sdk.theme.onChange() is handled client-side via postMessage.
    // When theme changes, the scene runtime sends 'sdk-theme-update' to all iframes.
    // No IPC handler needed — the SDK listens for this message directly.
  },
}
