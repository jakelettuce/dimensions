import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'
import { getPortal, switchPortalTab, createPortalTab, closePortalTab } from '../webportal-manager'
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

  // Resolve portal ID — try direct lookup first, then compound child pattern
  let resolvedPortalId = portalWidgetId
  let portal = getPortal(portalWidgetId)

  if (!portal) {
    // Try as compound child: widgetId:childId
    const compoundPortalId = `${widgetId}:${portalWidgetId}`
    portal = getPortal(compoundPortalId)
    if (portal) {
      resolvedPortalId = compoundPortalId
    }
  }

  if (!portal) {
    // Also check scene widgets for the portal by widgetType matching
    const scene = ctx.getScene(widgetId)
    if (scene) {
      for (const entry of scene.meta.widgets) {
        const w = scene.widgets.get(entry.id)
        if (w && w.manifest.type === 'webportal' && w.widgetType === portalWidgetId) {
          portal = getPortal(entry.id)
          if (portal) {
            resolvedPortalId = entry.id
            break
          }
        }
      }
    }
  }

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
      'sdk:portal:goBack',
      async (_event, widgetId: unknown, portalWidgetId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tab = portal.tabs.get(portal.activeTabId)
        if (!tab) return { error: 'no_active_tab' }

        const wc = tab.contentWCV.webContents
        if (!wc.isDestroyed() && wc.navigationHistory.canGoBack()) {
          wc.navigationHistory.goBack()
        }
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:goForward',
      async (_event, widgetId: unknown, portalWidgetId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tab = portal.tabs.get(portal.activeTabId)
        if (!tab) return { error: 'no_active_tab' }

        const wc = tab.contentWCV.webContents
        if (!wc.isDestroyed() && wc.navigationHistory.canGoForward()) {
          wc.navigationHistory.goForward()
        }
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:reload',
      async (_event, widgetId: unknown, portalWidgetId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tab = portal.tabs.get(portal.activeTabId)
        if (!tab) return { error: 'no_active_tab' }

        const wc = tab.contentWCV.webContents
        if (!wc.isDestroyed()) wc.reload()
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:stop',
      async (_event, widgetId: unknown, portalWidgetId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result
        const tab = portal.tabs.get(portal.activeTabId)
        if (!tab) return { error: 'no_active_tab' }

        const wc = tab.contentWCV.webContents
        if (!wc.isDestroyed()) wc.stop()
        return null
      },
    )

    ctx.ipcMain.handle(
      'sdk:portal:setVisible',
      async (_event, widgetId: unknown, portalWidgetId: unknown, visible: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof visible !== 'boolean') return { error: 'invalid_visible' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal, dimWin } = result
        const activeTab = portal.tabs.get(portal.activeTabId)
        if (!activeTab) return { error: 'no_active_tab' }

        if (!dimWin.browserWindow.isDestroyed()) {
          if (visible) {
            dimWin.browserWindow.contentView.addChildView(activeTab.contentWCV)
          } else {
            try { dimWin.browserWindow.contentView.removeChildView(activeTab.contentWCV) } catch {}
          }
        }
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

        const tabId = createPortalTab(result.portal.widgetId, (url as string) || 'about:blank')
        return tabId ? { tabId } : { error: 'failed_to_create_tab' }
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

        const success = closePortalTab(result.portal.widgetId, tabId)
        return success ? null : { error: 'failed_to_close_tab' }
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
        const tab = portal.tabs.get(portal.activeTabId)
        const tabs = Array.from(portal.tabs.entries()).map(([id, t]: [string, any]) => ({
          id,
          url: t.url,
          title: t.title,
          isLoading: t.isLoading,
          canGoBack: t.canGoBack,
          canGoForward: t.canGoForward,
          isActive: id === portal.activeTabId,
        }))

        return ctx.sanitize({
          url: tab?.url ?? '',
          title: tab?.title ?? '',
          isLoading: tab?.isLoading ?? false,
          canGoBack: tab?.canGoBack ?? false,
          canGoForward: tab?.canGoForward ?? false,
          isPlayingAudio: tab?.isPlayingAudio ?? false,
          activeTabId: portal.activeTabId,
          tabs,
        })
      },
    )
  },
}
