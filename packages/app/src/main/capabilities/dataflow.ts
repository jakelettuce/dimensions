import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

/**
 * Dataflow engine — routes values between widget outputs and inputs
 * based on the scene's connections.json wiring.
 *
 * IPC channel (fire-and-forget, already whitelisted):
 *   sdk:emit  — args: widgetId, outputKey, value
 *
 * Scene WCV contract:
 *   The scene preload must handle 'scene:dataflow-input' IPC messages
 *   with shape { targetWidgetId: string, inputKey: string, value: any }
 *   and forward them to the target widget iframe via postMessage:
 *     { type: 'sdk-dataflow-input', key: string, value: any }
 */

// ── Portal output helper ──

/**
 * Called by webportal-manager when a portal emits an output
 * (e.g. did-navigate -> 'currentUrl', page-title-updated -> 'pageTitle').
 * Routes the value through the connection graph to any wired inputs.
 */
export function emitPortalOutput(
  widgetId: string,
  outputKey: string,
  value: any,
  ctx: CapabilityContext,
): void {
  const scene = ctx.getScene(widgetId)
  if (!scene) return

  const connections = scene.connections.filter(
    (c) => c.from.widgetId === widgetId && c.from.output === outputKey,
  )

  for (const conn of connections) {
    const targetWidget = scene.widgets.get(conn.to.widgetId)
    if (!targetWidget) continue

    if (targetWidget.manifest.type === 'custom') {
      deliverToCustomWidget(conn.to.widgetId, conn.to.input, value, ctx)
    } else if (targetWidget.manifest.type === 'webportal') {
      deliverToPortal(conn.to.widgetId, conn.to.input, value, ctx)
    }
  }
}

// ── Internal delivery helpers ──

/**
 * Send a dataflow value to a custom widget iframe via the scene WCV.
 */
function deliverToCustomWidget(
  targetWidgetId: string,
  inputKey: string,
  value: any,
  ctx: CapabilityContext,
): void {
  const dimWin = ctx.getWindow(targetWidgetId)
  if (!dimWin || dimWin.browserWindow.isDestroyed()) return

  const sceneWC = dimWin.sceneWCV.webContents
  if (sceneWC.isDestroyed()) return

  sceneWC.send('scene:dataflow-input', {
    targetWidgetId,
    inputKey,
    value: ctx.sanitize(value),
  })
}

/**
 * Deliver a dataflow value to a webportal's special inputs.
 * Supported inputs:
 *   - 'navigateTo' — load a URL in the portal's active tab
 *   - 'injectCSS'  — insert CSS into the portal's active tab
 *   - 'switchTab'  — switch to a specific tab by ID
 *
 * NOTE: Requires webportal-manager to export getPortal(id).
 * Until that export exists, we use a lazy require to access the function.
 */
function deliverToPortal(
  portalWidgetId: string,
  inputKey: string,
  value: any,
  ctx: CapabilityContext,
): void {
  // Lazy require to avoid circular deps and to pick up the getPortal export
  // when it becomes available in webportal-manager.
  let getPortal: (id: string) => any
  try {
    getPortal = require('../webportal-manager').getPortal
  } catch {
    console.warn('[dataflow] webportal-manager.getPortal not available yet')
    return
  }

  if (!getPortal) {
    console.warn('[dataflow] webportal-manager.getPortal not exported yet')
    return
  }

  const portal = getPortal(portalWidgetId)
  if (!portal) return

  const activeTab = portal.tabs.get(portal.activeTabId)
  if (!activeTab) return

  const wc = activeTab.contentWCV.webContents
  if (wc.isDestroyed()) return

  switch (inputKey) {
    case 'navigateTo': {
      if (typeof value !== 'string') break
      let url = value.trim()
      if (url && !url.match(/^[a-zA-Z]+:\/\//)) {
        url = url.match(/^[^\s]+\.[^\s]+/)
          ? `https://${url}`
          : `https://www.google.com/search?q=${encodeURIComponent(url)}`
      }
      wc.loadURL(url).catch(() => {})
      break
    }

    case 'injectCSS': {
      if (typeof value !== 'string') break
      wc.insertCSS(value).catch(() => {})
      break
    }

    case 'switchTab': {
      if (typeof value !== 'string') break
      // Lazy require for switchTab helper
      // For now, switch via the portal IPC path by finding the window
      const dimWin = ctx.getWindow(portalWidgetId)
      if (!dimWin) break

      const { ipcMain } = require('electron')
      // Invoke the already-registered handler indirectly isn't clean.
      // Instead, directly manipulate the portal: hide old tab, show new tab.
      const targetTab = portal.tabs.get(value)
      if (!targetTab) break

      if (portal.activeTabId !== value) {
        const oldTab = portal.tabs.get(portal.activeTabId)
        if (oldTab && !dimWin.browserWindow.isDestroyed()) {
          try {
            dimWin.browserWindow.contentView.removeChildView(oldTab.contentWCV)
          } catch {}
        }
        portal.activeTabId = value
        if (!dimWin.browserWindow.isDestroyed()) {
          dimWin.browserWindow.contentView.addChildView(targetTab.contentWCV)
        }
      }
      break
    }

    default:
      console.warn(`[dataflow] Unknown portal input key: "${inputKey}" on widget ${portalWidgetId}`)
  }
}

// ── Capability module ──

export const dataflowCapability: CapabilityModule = {
  name: 'dataflow',
  register(ctx: CapabilityContext) {
    // sdk:emit — fire-and-forget (on() not handle())
    // Any widget can emit outputs; no special capability required.
    // The connections.json wiring determines where values go.
    ctx.ipcMain.on(
      'sdk:emit',
      (_event, widgetId: unknown, outputKey: unknown, value: unknown) => {
        if (typeof widgetId !== 'string' || typeof outputKey !== 'string') return

        const widget = ctx.getWidget(widgetId)
        if (!widget) return

        const scene = ctx.getScene(widgetId)
        if (!scene) return

        // Validate that this widget declares the output in its manifest
        const declaredOutputs = widget.manifest.outputs ?? []
        const hasOutput = declaredOutputs.some((o) => o.key === outputKey)
        if (!hasOutput) {
          console.warn(
            `[dataflow] Widget "${widgetId}" emitted undeclared output "${outputKey}", ignoring`,
          )
          return
        }

        // Route to all connected inputs
        const connections = scene.connections.filter(
          (c) => c.from.widgetId === widgetId && c.from.output === outputKey,
        )

        for (const conn of connections) {
          const targetWidget = scene.widgets.get(conn.to.widgetId)
          if (!targetWidget) continue

          if (targetWidget.manifest.type === 'custom') {
            deliverToCustomWidget(conn.to.widgetId, conn.to.input, value, ctx)
          } else if (targetWidget.manifest.type === 'webportal') {
            deliverToPortal(conn.to.widgetId, conn.to.input, value, ctx)
          }
        }
      },
    )
  },
}
