import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

/**
 * Portal Control capability — allows custom widgets to programmatically
 * control webportal widgets in the same scene.
 *
 * IPC channels (add to scene preload whitelist):
 *   sdk:portal:navigate  — navigate portal's active tab to a URL
 *   sdk:portal:injectCSS — insert CSS into portal's active tab
 *   sdk:portal:removeCSS — remove previously inserted CSS by key
 *   sdk:portal:newTab    — open a new tab in the portal
 *   sdk:portal:closeTab  — close a specific tab by ID
 *   sdk:portal:switchTab — switch to a specific tab by ID
 *   sdk:portal:getState  — get current portal state (tabs, url, title)
 *
 * Validation:
 *   1. Requesting widget must declare 'portal-control' capability
 *   2. Target portalWidgetId must be in the widget manifest's targetPortals array
 *   3. Target portal must exist in the same scene
 *
 * NOTE: Requires webportal-manager to export getPortal(id).
 * Until that export is added, the capability uses a lazy require.
 */

// ── Helpers ──

interface PortalAccessResult {
  portal: any
  dimWin: any
}

/**
 * Validate the requesting widget has portal-control capability and
 * is allowed to target the given portal. Returns the portal instance
 * and DimensionsWindow, or an error object.
 */
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

  // Check targetPortals allowlist in manifest
  const manifest = widget.manifest as any
  const targetPortals: string[] | undefined = manifest.targetPortals
  if (!targetPortals || !targetPortals.includes(portalWidgetId)) {
    return {
      error: 'portal_target_denied',
      widgetId,
      portalWidgetId,
      message: `Widget "${widgetId}" is not allowed to control portal "${portalWidgetId}". Add it to targetPortals in the widget manifest.`,
    }
  }

  // Verify both widgets are in the same scene
  const scene = ctx.getScene(widgetId)
  if (!scene) return { error: 'scene_not_found' }

  if (!scene.widgets.has(portalWidgetId)) {
    return { error: 'portal_not_in_scene', portalWidgetId }
  }

  const portalWidget = scene.widgets.get(portalWidgetId)!
  if (portalWidget.manifest.type !== 'webportal') {
    return { error: 'target_not_a_portal', portalWidgetId }
  }

  // Get portal instance from webportal-manager
  let getPortal: (id: string) => any
  try {
    getPortal = require('../webportal-manager').getPortal
  } catch {
    return { error: 'portal_manager_unavailable' }
  }

  if (!getPortal) {
    return { error: 'portal_manager_getPortal_not_exported' }
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

// ── Capability module ──

export const portalControlCapability: CapabilityModule = {
  name: 'portal-control',
  manifestFields: {
    targetPortals: { type: 'string[]', required: true },
  },
  register(ctx: CapabilityContext) {
    // ── sdk:portal:navigate ──
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

        // Normalize URL
        let normalizedUrl = url.trim()
        if (normalizedUrl && !normalizedUrl.match(/^[a-zA-Z]+:\/\//)) {
          normalizedUrl = normalizedUrl.match(/^[^\s]+\.[^\s]+/)
            ? `https://${normalizedUrl}`
            : `https://www.google.com/search?q=${encodeURIComponent(normalizedUrl)}`
        }

        await wc.loadURL(normalizedUrl).catch(() => {})
        return null
      },
    )

    // ── sdk:portal:injectCSS ──
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

    // ── sdk:portal:removeCSS ──
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

    // ── sdk:portal:newTab ──
    ctx.ipcMain.handle(
      'sdk:portal:newTab',
      async (_event, widgetId: unknown, portalWidgetId: unknown, url: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (url !== undefined && typeof url !== 'string') return { error: 'invalid_url' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal, dimWin } = result

        // Hide the current active tab's content WCV
        const oldTab = portal.tabs.get(portal.activeTabId)
        if (oldTab && !dimWin.browserWindow.isDestroyed()) {
          try {
            dimWin.browserWindow.contentView.removeChildView(oldTab.contentWCV)
          } catch {}
        }

        // Create new tab via the portal-manager's internal createTab
        // Since createTab is not exported, we invoke the existing IPC handler
        // by calling ipcMain's handler directly. This is a pragmatic workaround
        // until webportal-manager exports createTab.
        const { ipcMain } = require('electron')
        // Use the already-registered 'portal:newTab' handler
        await ipcMain.emit('portal:newTab', {} as any, portalWidgetId, url || undefined)

        return null
      },
    )

    // ── sdk:portal:closeTab ──
    ctx.ipcMain.handle(
      'sdk:portal:closeTab',
      async (_event, widgetId: unknown, portalWidgetId: unknown, tabId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof tabId !== 'string') return { error: 'invalid_tab_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result

        // Don't close the last tab
        if (portal.tabs.size <= 1) return { error: 'cannot_close_last_tab' }

        if (!portal.tabs.has(tabId)) return { error: 'tab_not_found', tabId }

        // Invoke the existing IPC handler
        const { ipcMain } = require('electron')
        await ipcMain.emit('portal:closeTab', {} as any, portalWidgetId, tabId)

        return null
      },
    )

    // ── sdk:portal:switchTab ──
    ctx.ipcMain.handle(
      'sdk:portal:switchTab',
      async (_event, widgetId: unknown, portalWidgetId: unknown, tabId: unknown) => {
        if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
        if (typeof portalWidgetId !== 'string') return { error: 'invalid_portal_widget_id' }
        if (typeof tabId !== 'string') return { error: 'invalid_tab_id' }

        const result = validatePortalAccess(widgetId, portalWidgetId, ctx)
        if (isError(result)) return result

        const { portal } = result

        if (!portal.tabs.has(tabId)) return { error: 'tab_not_found', tabId }

        // Invoke the existing IPC handler
        const { ipcMain } = require('electron')
        await ipcMain.emit('portal:switchTab', {} as any, portalWidgetId, tabId)

        return null
      },
    )

    // ── sdk:portal:getState ──
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

        return ctx.sanitize({
          activeTabId: portal.activeTabId,
          tabs,
        })
      },
    )
  },
}
