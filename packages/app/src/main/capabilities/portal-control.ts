import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { getPortal, switchPortalTab } from '../webportal-manager'
import type { DimensionsWindow } from '../window-manager'

interface PortalAccessResult {
  portal: any
  dimWin: DimensionsWindow
}

function validatePortalAccess(
  widgetId: string,
  portalWidgetId: string,
  ctx: CapabilityContext,
): PortalAccessResult | { error: string; [key: string]: any } {
  const widget = ctx.getWidget(widgetId)
  if (!widget) return { error: 'widget_not_found', widgetId }

  try {
    assertCapability(widget, 'portal-control')
  } catch {
    return { error: 'capability_denied', capability: 'portal-control', widgetId }
  }

  const manifest = widget.manifest as any
  const targetPortals: string[] | undefined = manifest.targetPortals
  if (!targetPortals || !targetPortals.includes(portalWidgetId)) {
    return { error: 'portal_target_denied', widgetId, portalWidgetId }
  }

  const scene = ctx.getScene(widgetId)
  if (!scene) return { error: 'scene_not_found' }

  if (!scene.widgets.has(portalWidgetId)) {
    return { error: 'portal_not_in_scene', portalWidgetId }
  }

  const portalWidget = scene.widgets.get(portalWidgetId)!
  if (portalWidget.manifest.type !== 'webportal') {
    return { error: 'target_not_a_portal', portalWidgetId }
  }

  const portal = getPortal(portalWidgetId)
  if (!portal) return { error: 'portal_not_mounted', portalWidgetId }

  const dimWin = ctx.getWindow(widgetId)
  if (!dimWin || dimWin.browserWindow.isDestroyed()) return { error: 'window_not_found' }

  return { portal, dimWin }
}

function isError(result: any): result is { error: string } {
  return result && typeof result.error === 'string'
}

export const portalControlCapability: CapabilityModule = {
  name: 'portal-control',
  manifestFields: {
    targetPortals: { type: 'string[]', required: true },
  },
  register(ctx: CapabilityContext) {
    ctx.ipcMain.handle(
      'sdk:portal:navigate',
      async (_event, widgetId: unknown, portalWidgetId: unknown, url: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof url !== 'string') return { error: 'invalid_url' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tab = portal.tabs.get(portal.activeTabId)
        if (!tab) return { error: 'no_active_tab' }

        const wc = tab.contentWCV.webContents
        if (wc.isDestroyed()) return { error: 'tab_destroyed' }

        let normalizedUrl = url.trim()
        if (normalizedUrl && !normalizedUrl.match(/^[a-zA-Z]+:\/\//)) {
          normalizedUrl = normalizedUrl.match(/^[^\s]+\.[^\s]+/)
            ? `https://${normalizedUrl}`
            : `https://www.google.com/search?q=${encodeURIComponent(normalizedUrl)}`
        }

        wc.loadURL(normalizedUrl).catch(() => {})
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:injectCSS',
      async (_event, widgetId: unknown, portalWidgetId: unknown, css: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof css !== 'string') return { error: 'invalid_css' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tab = portal.tabs.get(portal.activeTabId)
        if (!tab) return { error: 'no_active_tab' }

        const wc = tab.contentWCV.webContents
        if (wc.isDestroyed()) return { error: 'tab_destroyed' }

        const key = await wc.insertCSS(css).catch(() => null)
        return key ? { key } : { error: 'css_injection_failed' }
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:removeCSS',
      async (_event, widgetId: unknown, portalWidgetId: unknown, key: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof key !== 'string') return { error: 'invalid_key' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tab = portal.tabs.get(portal.activeTabId)
        if (!tab) return { error: 'no_active_tab' }

        const wc = tab.contentWCV.webContents
        if (wc.isDestroyed()) return { error: 'tab_destroyed' }

        await wc.removeInsertedCSS(key).catch(() => {})
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:newTab',
      async (_event, widgetId: unknown, portalWidgetId: unknown, url: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (url !== undefined && typeof url !== 'string') return { error: 'invalid_url' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        // newTab is handled by portal IPC handlers in webportal-manager
        // Invoke via the already-registered handler
        const { portal, dimWin } = result
        // TODO: export createTab from webportal-manager for direct use
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:closeTab',
      async (_event, widgetId: unknown, portalWidgetId: unknown, tabId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof tabId !== 'string') return { error: 'invalid_tab_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        if (portal.tabs.size <= 1) return { error: 'cannot_close_last_tab' }
        if (!portal.tabs.has(tabId)) return { error: 'tab_not_found', tabId }

        // TODO: export closeTab from webportal-manager for direct use
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:switchTab',
      async (_event, widgetId: unknown, portalWidgetId: unknown, tabId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof tabId !== 'string') return { error: 'invalid_tab_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal, dimWin } = result
        if (!portal.tabs.has(tabId)) return { error: 'tab_not_found', tabId }

        switchPortalTab(portal, tabId, dimWin)
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:getState',
      async (_event, widgetId: unknown, portalWidgetId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tabs = Array.from(portal.tabs.entries()).map(([id, tab]: [string, any]) => ({
          id,
          url: tab.url,
          title: tab.title,
          isLoading: tab.isLoading,
          canGoBack: tab.canGoBack,
          canGoForward: tab.canGoForward,
          isActive: id === portal.activeTabId,
        }))

        return ctx.sanitize({ activeTabId: portal.activeTabId, tabs })
      },
    )
  },
}
