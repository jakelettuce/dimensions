import type { CapabilityModule, CapabilityContext } from './index'
import { getPortal } from '../webportal-manager'

// Portal dataflow output helper — called by webportal-manager when a portal emits
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

function deliverToPortal(
  portalWidgetId: string,
  inputKey: string,
  value: any,
  ctx: CapabilityContext,
): void {
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
      // Import switchTab from webportal-manager's IPC handler
      // The portal-manager's switchTab is internal, so call it via the portal instance
      const dimWin = ctx.getWindow(portalWidgetId)
      if (!dimWin) break

      if (!portal.tabs.has(value) || portal.activeTabId === value) break

      // Use the exported switchTab logic from webportal-manager
      const { switchPortalTab } = require('../webportal-manager')
      if (switchPortalTab) {
        switchPortalTab(portal, value, dimWin)
      }
      break
    }

    default:
      break
  }
}

export const dataflowCapability: CapabilityModule = {
  name: 'dataflow',
  register(ctx: CapabilityContext) {
    ctx.ipcMain.on(
      'sdk:emit',
      (_event, widgetId: unknown, outputKey: unknown, value: unknown) => {
        if (typeof widgetId !== 'string' || typeof outputKey !== 'string') return

        const widget = ctx.getWidget(widgetId)
        if (!widget) return

        const scene = ctx.getScene(widgetId)
        if (!scene) return

        const declaredOutputs = widget.manifest.outputs ?? []
        const hasOutput = declaredOutputs.some((o) => o.key === outputKey)
        if (!hasOutput) return

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
