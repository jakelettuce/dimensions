import { contextBridge, ipcRenderer } from 'electron'

// ── IPC channel whitelist ──
const ALLOWED_SDK_CHANNELS = new Set([
  'sdk:kv:get',
  'sdk:kv:set',
  'sdk:kv:delete',
  'sdk:kv:list',
  'sdk:assets:upload',
  'sdk:assets:resolve',
  'sdk:assets:list',
  'sdk:fetch',
  'sdk:ws:connect',
  'sdk:ws:send',
  'sdk:ws:close',
  'sdk:env:get',
  'sdk:secrets:get',
  'sdk:secrets:set',
  'sdk:secrets:delete',
  'sdk:editing:setBounds',
  'sdk:editing:getBounds',
  'sdk:editing:select',
  'sdk:widget:bounds-update',
  'sdk:widget:bounds-live',
  'sdk:widget:select',
  'sdk:emit',
  'sdk:navigate:to',
  'sdk:navigate:back',
  'sdk:navigate:forward',
  'sdk:navigate:next',
  'sdk:navigate:previous',
  'sdk:theme:get',
  'sdk:clipboard:read',
  'sdk:clipboard:write',
  'sdk:notify',
  'sdk:scene:info',
  // Portal control
  'sdk:portal:navigate',
  'sdk:portal:goBack',
  'sdk:portal:goForward',
  'sdk:portal:reload',
  'sdk:portal:stop',
  'sdk:portal:injectCSS',
  'sdk:portal:removeCSS',
  'sdk:portal:setVisible',
  'sdk:portal:newTab',
  'sdk:portal:closeTab',
  'sdk:portal:switchTab',
  'sdk:portal:getState',
  // Props
  'sdk:props:getAll',
])

// Fire-and-forget channels (no response expected)
const FIRE_AND_FORGET = new Set([
  'sdk:emit',
  'sdk:navigate:to',
  'sdk:navigate:back',
  'sdk:navigate:forward',
  'sdk:navigate:next',
  'sdk:navigate:previous',
  'sdk:widget:bounds-update',
  'sdk:widget:bounds-live',
  'sdk:widget:select',
])

function sanitize(data: unknown): unknown {
  if (data === null || data === undefined) return data
  if (typeof data !== 'object') return data
  try {
    return JSON.parse(JSON.stringify(data, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined
      return value
    }))
  } catch {
    return null
  }
}

// ── Widget iframe -> IPC bridge ──

window.addEventListener('message', async (event) => {
  if (!event.data || event.data.type !== 'sdk-call') return

  const { callId, method, args } = event.data

  if (typeof method !== 'string' || !ALLOWED_SDK_CHANNELS.has(method)) {
    if (callId !== 0) {
      event.source?.postMessage(
        { type: 'sdk-response', callId, result: { error: 'channel_not_allowed', method } },
        { targetOrigin: '*' },
      )
    }
    return
  }

  const sanitizedArgs = Array.isArray(args) ? args.map(sanitize) : []

  if (FIRE_AND_FORGET.has(method)) {
    ipcRenderer.invoke(method, ...sanitizedArgs).catch(() => {})
    return
  }

  try {
    const result = await ipcRenderer.invoke(method, ...sanitizedArgs)
    event.source?.postMessage(
      { type: 'sdk-response', callId, result: sanitize(result) },
      { targetOrigin: '*' },
    )
  } catch (err: any) {
    event.source?.postMessage(
      { type: 'sdk-response', callId, result: { error: err.message || 'ipc_error' } },
      { targetOrigin: '*' },
    )
  }
})

// ── Dataflow input forwarding ──
// Main process sends dataflow values to scene WCV, which forwards to the target widget iframe

ipcRenderer.on('scene:dataflow-input', (_e, data: { targetWidgetId: string; inputKey: string; value: any }) => {
  // Find the target widget iframe and send via postMessage
  const iframes = document.querySelectorAll('iframe[data-widget-id]')
  for (const iframe of iframes) {
    if ((iframe as HTMLIFrameElement).dataset.widgetId === data.targetWidgetId) {
      const contentWindow = (iframe as HTMLIFrameElement).contentWindow
      if (contentWindow) {
        contentWindow.postMessage(
          { type: 'sdk-dataflow-input', key: data.inputKey, value: sanitize(data.value) },
          '*',
        )
      }
      break
    }
  }
})

// ── Portal state update forwarding ──
// Main process sends portal state updates to scene WCV, which broadcasts to ALL widget iframes.
// Widget SDK filters locally based on onStateChange registrations.

ipcRenderer.on('scene:portal-state-update', (_e, data: {
  portalId: string; shortPortalId: string; state: any; targetWidgetIds: string[]
}) => {
  const targets = new Set(data.targetWidgetIds || [])
  const iframes = document.querySelectorAll('iframe[data-widget-id]')
  for (const iframe of iframes) {
    const wid = (iframe as HTMLIFrameElement).dataset.widgetId
    if (!wid || !targets.has(wid)) continue
    const contentWindow = (iframe as HTMLIFrameElement).contentWindow
    if (contentWindow) {
      contentWindow.postMessage(
        {
          type: 'sdk-portal-state-update',
          portalId: data.portalId,
          shortPortalId: data.shortPortalId,
          state: sanitize(data.state),
        },
        '*',
      )
    }
  }
})

// ── Widget shortcut forwarding ──
// Main process sends shortcut actions to the owning widget iframe.

ipcRenderer.on('scene:widget-shortcut', (_e, data: { widgetId: string; action: string }) => {
  const iframes = document.querySelectorAll('iframe[data-widget-id]')
  for (const iframe of iframes) {
    if ((iframe as HTMLIFrameElement).dataset.widgetId === data.widgetId) {
      const contentWindow = (iframe as HTMLIFrameElement).contentWindow
      if (contentWindow) {
        contentWindow.postMessage(
          { type: 'sdk-shortcut', action: data.action },
          '*',
        )
      }
      break
    }
  }
})

// ── Prop change forwarding ──
// Main process sends prop changes to scene WCV, which forwards to the specific widget iframe.

ipcRenderer.on('scene:prop-change', (_e, data: { widgetId: string; key: string; value: any }) => {
  const iframes = document.querySelectorAll('iframe[data-widget-id]')
  for (const iframe of iframes) {
    if ((iframe as HTMLIFrameElement).dataset.widgetId === data.widgetId) {
      const contentWindow = (iframe as HTMLIFrameElement).contentWindow
      if (contentWindow) {
        contentWindow.postMessage(
          { type: 'sdk-prop-change', key: data.key, value: sanitize(data.value) },
          '*',
        )
      }
      break
    }
  }
})

// ── Widget selection from main process (portal focus in edit mode) ──

ipcRenderer.on('scene:select-widget', (_e, widgetId: string) => {
  // Clear previous selection
  document.querySelectorAll('.widget-wrapper.selected, dimensions-widget.selected').forEach(el => {
    el.classList.remove('selected')
  })
  // Select the widget wrapper by data-widget-id
  const wrapper = document.querySelector(`.widget-wrapper[data-widget-id="${widgetId}"]`)
    || document.querySelector(`dimensions-widget[data-widget-id="${widgetId}"]`)
  if (wrapper) wrapper.classList.add('selected')
})

// ── Exposed API for scene runtime ──

contextBridge.exposeInMainWorld('dimensionsScene', {
  onEditMode: (cb: (editing: boolean) => void) => {
    ipcRenderer.on('scene:edit-mode', (_e, editing) => cb(editing))
  },
  onWidgetReload: (cb: (widgetId: string) => void) => {
    ipcRenderer.on('scene:widget-reload', (_e, widgetId) => cb(widgetId))
  },
  onSceneUpdate: (cb: (meta: unknown) => void) => {
    ipcRenderer.on('scene:update', (_e, meta) => cb(sanitize(meta)))
  },
  reportScroll: (scrollX: number, scrollY: number) => {
    ipcRenderer.send('scene:scroll', scrollX, scrollY)
  },
  reportScale: (scale: number) => {
    ipcRenderer.send('scene:report-scale', scale)
  },
  reportZoomDelta: (delta: number) => {
    ipcRenderer.send('scene:zoom-delta', delta)
  },
  reportWidgetBounds: (widgetId: string, bounds: { x: number; y: number; width: number; height: number }) => {
    ipcRenderer.send('scene:widget-bounds', widgetId, bounds)
  },
  onScaleMode: (cb: (mode: string) => void) => {
    ipcRenderer.on('scene:scale-mode', (_e, mode) => cb(mode))
  },
  onZoom: (cb: (zoom: number) => void) => {
    ipcRenderer.on('scene:zoom', (_e, zoom) => cb(zoom))
  },
})
