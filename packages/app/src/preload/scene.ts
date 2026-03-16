import { contextBridge, ipcRenderer } from 'electron'

// ── IPC channel whitelist ──
// Only these channels are forwarded from widget iframes to main process.
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
  'sdk:env:get',
  'sdk:secrets:get',
  'sdk:secrets:set',
  'sdk:secrets:delete',
  'sdk:editing:setBounds',
  'sdk:editing:getBounds',
  'sdk:editing:select',
  'sdk:emit',
  'sdk:navigate:to',
  'sdk:navigate:back',
  'sdk:navigate:forward',
  'sdk:theme:get',
  'sdk:clipboard:read',
  'sdk:clipboard:write',
  'sdk:notify',
  'sdk:scene:info',
])

// Strip dangerous keys to prevent prototype pollution
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

// ── Widget iframe → IPC bridge ──
// Widget iframes send postMessage with { type: 'sdk-call', callId, method, args }
// This preload forwards whitelisted calls to main via ipcRenderer.invoke()
// Response sent back to iframe as { type: 'sdk-response', callId, result }

window.addEventListener('message', async (event) => {
  if (!event.data || event.data.type !== 'sdk-call') return

  const { callId, method, args } = event.data

  if (typeof method !== 'string' || !ALLOWED_SDK_CHANNELS.has(method)) {
    event.source?.postMessage(
      { type: 'sdk-response', callId, result: { error: 'channel_not_allowed', method } },
      { targetOrigin: '*' },
    )
    return
  }

  try {
    const sanitizedArgs = Array.isArray(args) ? args.map(sanitize) : []
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
})
