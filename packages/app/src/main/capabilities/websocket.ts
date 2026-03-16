import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

// Track active WebSocket connections: connectionId → WebSocket
const activeConnections = new Map<string, WebSocket>()

let connectionCounter = 0

function generateConnectionId(widgetId: string): string {
  connectionCounter += 1
  return `ws_${widgetId}_${connectionCounter}_${Date.now()}`
}

export const websocketCapability: CapabilityModule = {
  name: 'websocket',
  register(ctx: CapabilityContext) {
    // sdk.ws.connect(url)
    ctx.ipcMain.handle('sdk:ws:connect', async (_event, widgetId: unknown, url: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof url !== 'string') return { error: 'invalid_url' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'websocket')
      } catch {
        return { error: 'capability_denied', capability: 'websocket', widgetId }
      }

      // Validate URL host is in manifest allowedWsHosts
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return { error: 'invalid_url', url }
      }

      const allowedWsHosts = widget.manifest.allowedWsHosts ?? []
      if (!allowedWsHosts.includes(parsedUrl.hostname)) {
        return { error: 'host_not_allowed', host: parsedUrl.hostname, allowedWsHosts }
      }

      const connectionId = generateConnectionId(widgetId)

      try {
        const ws = new WebSocket(url)
        activeConnections.set(connectionId, ws)

        const dimWin = ctx.getWindow(widgetId)

        ws.onmessage = (event) => {
          if (dimWin && !dimWin.browserWindow.isDestroyed()) {
            dimWin.sceneWCV.webContents.send(`sdk:ws:message:${connectionId}`, {
              data: typeof event.data === 'string' ? event.data : String(event.data),
            })
          }
        }

        ws.onclose = (event) => {
          activeConnections.delete(connectionId)
          if (dimWin && !dimWin.browserWindow.isDestroyed()) {
            dimWin.sceneWCV.webContents.send(`sdk:ws:close:${connectionId}`, {
              code: event.code,
              reason: event.reason,
            })
          }
        }

        ws.onerror = () => {
          if (dimWin && !dimWin.browserWindow.isDestroyed()) {
            dimWin.sceneWCV.webContents.send(`sdk:ws:error:${connectionId}`, {
              message: 'WebSocket error',
            })
          }
        }

        // Wait for the connection to open before returning
        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve()
          // Also handle immediate failure
          const origError = ws.onerror
          ws.onerror = (ev) => {
            reject(new Error('WebSocket connection failed'))
            // Restore the bridge error handler
            ws.onerror = origError
          }
        })

        return ctx.sanitize({ connectionId })
      } catch (err) {
        activeConnections.delete(connectionId)
        return { error: 'ws_connect_failed', message: err instanceof Error ? err.message : String(err) }
      }
    })

    // sdk.ws.send(connectionId, data)
    ctx.ipcMain.handle('sdk:ws:send', async (_event, widgetId: unknown, connectionId: unknown, data: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof connectionId !== 'string') return { error: 'invalid_connection_id' }
      if (typeof data !== 'string') return { error: 'invalid_data' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'websocket')
      } catch {
        return { error: 'capability_denied', capability: 'websocket', widgetId }
      }

      const ws = activeConnections.get(connectionId)
      if (!ws) return { error: 'connection_not_found', connectionId }

      try {
        ws.send(data)
        return null
      } catch (err) {
        return { error: 'ws_send_failed', message: err instanceof Error ? err.message : String(err) }
      }
    })

    // sdk.ws.close(connectionId)
    ctx.ipcMain.handle('sdk:ws:close', async (_event, widgetId: unknown, connectionId: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof connectionId !== 'string') return { error: 'invalid_connection_id' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'websocket')
      } catch {
        return { error: 'capability_denied', capability: 'websocket', widgetId }
      }

      const ws = activeConnections.get(connectionId)
      if (!ws) return { error: 'connection_not_found', connectionId }

      try {
        ws.close()
        activeConnections.delete(connectionId)
        return null
      } catch (err) {
        return { error: 'ws_close_failed', message: err instanceof Error ? err.message : String(err) }
      }
    })
  },
}
