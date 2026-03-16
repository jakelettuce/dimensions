import type { CapabilityModule, CapabilityContext } from './index'
import { assertCapability } from './index'

export const networkCapability: CapabilityModule = {
  name: 'network',
  register(ctx: CapabilityContext) {
    // sdk.fetch(url, options)
    ctx.ipcMain.handle('sdk:fetch', async (_event, widgetId: unknown, url: unknown, options: unknown) => {
      if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
      if (typeof url !== 'string') return { error: 'invalid_url' }

      const widget = ctx.getWidget(widgetId)
      if (!widget) return { error: 'widget_not_found', widgetId }

      try {
        assertCapability(widget, 'network')
      } catch {
        return { error: 'capability_denied', capability: 'network', widgetId }
      }

      // Validate URL host is in manifest allowedHosts
      let parsedUrl: URL
      try {
        parsedUrl = new URL(url)
      } catch {
        return { error: 'invalid_url', url }
      }

      const allowedHosts = widget.manifest.allowedHosts ?? []
      if (!allowedHosts.includes(parsedUrl.hostname)) {
        return { error: 'host_not_allowed', host: parsedUrl.hostname, allowedHosts }
      }

      // Build fetch options from serialized RequestInit
      const fetchOptions: RequestInit = {}
      if (options && typeof options === 'object') {
        const opts = options as Record<string, unknown>
        if (typeof opts.method === 'string') fetchOptions.method = opts.method
        if (opts.headers && typeof opts.headers === 'object') {
          fetchOptions.headers = opts.headers as Record<string, string>
        }
        if (typeof opts.body === 'string') fetchOptions.body = opts.body
        if (typeof opts.redirect === 'string') {
          fetchOptions.redirect = opts.redirect as RequestRedirect
        }
      }

      try {
        const response = await fetch(url, fetchOptions)
        const body = await response.text()

        const headers: Record<string, string> = {}
        response.headers.forEach((value, key) => {
          headers[key] = value
        })

        return ctx.sanitize({
          status: response.status,
          headers,
          body,
        })
      } catch (err) {
        return { error: 'fetch_failed', message: err instanceof Error ? err.message : String(err) }
      }
    })
  },
}
