// @dimensions/sdk — Runtime
// Runs inside widget iframes. All calls go through:
//   postMessage → scene preload → IPC → main process → capability module → response back
//
// WIDGET_ID, SCENE_ID, SCENE_TITLE are injected by the host into each iframe's
// window.__DIMENSIONS_CONTEXT__ before this script runs.

export type {
  Bounds,
  ThemeVars,
  AssetInfo,
  SDKResponse,
  WSConnection,
  WidgetManifest,
  WidgetInput,
  WidgetOutput,
  WidgetProp,
  SceneMeta,
  WidgetEntry,
  DimensionMeta,
  Connection,
  PortalRule,
  PortalState,
  DroppedFile,
  DimensionsSDK,
} from './types'

import type { Bounds, ThemeVars, AssetInfo, SDKResponse, WSConnection, PortalState, DroppedFile, DimensionsSDK } from './types'

// ── Context injected by host ──

interface DimensionsContext {
  widgetId: string
  sceneId: string
  sceneTitle: string
}

declare global {
  interface Window {
    __DIMENSIONS_CONTEXT__?: DimensionsContext
  }
}

function getContext(): DimensionsContext {
  const ctx = window.__DIMENSIONS_CONTEXT__
  if (!ctx) {
    throw new Error('SDK not initialized: __DIMENSIONS_CONTEXT__ not found. Is this running inside a Dimensions widget iframe?')
  }
  return ctx
}

// ── postMessage bridge ──

let callCounter = 0
const pendingCalls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()

// Listen for responses from scene preload
window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdk-response') return
  const { callId, result } = event.data
  const pending = pendingCalls.get(callId)
  if (!pending) return
  pendingCalls.delete(callId)

  if (result && typeof result === 'object' && 'error' in result) {
    pending.reject(new Error(result.error))
  } else {
    pending.resolve(result)
  }
})

function call<T = any>(method: string, ...args: any[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const callId = ++callCounter
    pendingCalls.set(callId, { resolve, reject })

    // Post to parent (scene WCV) — the scene preload forwards to main via IPC
    window.parent.postMessage(
      { type: 'sdk-call', callId, method, args: [getContext().widgetId, ...args] },
      '*',
    )

    // Timeout after 30s to prevent leaked promises
    setTimeout(() => {
      if (pendingCalls.has(callId)) {
        pendingCalls.delete(callId)
        reject(new Error(`SDK call "${method}" timed out after 30s`))
      }
    }, 30000)
  })
}

// Fire-and-forget (for sdk.emit)
function fire(method: string, ...args: any[]): void {
  window.parent.postMessage(
    { type: 'sdk-call', callId: 0, method, args: [getContext().widgetId, ...args] },
    '*',
  )
}

// ── Theme change subscriptions ──

const themeListeners: Array<(vars: ThemeVars) => void> = []

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdk-theme-update') return
  for (const cb of themeListeners) {
    try { cb(event.data.theme) } catch {}
  }
})

// ── Portal state change subscriptions ──

const portalStateListeners = new Map<string, Array<(state: PortalState) => void>>()

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdk-portal-state-update') return
  const { portalId, shortPortalId, state } = event.data
  // Try matching on full ID first, then short ID (for compound children)
  const listeners = portalStateListeners.get(portalId) || portalStateListeners.get(shortPortalId)
  if (listeners) {
    for (const cb of listeners) {
      try { cb(state) } catch {}
    }
  }
})

// ── Props cache + subscriptions ──

let propsCache: Record<string, any> | null = null
const propChangeListeners = new Map<string, Array<(value: any) => void>>()
const propAnyChangeListeners: Array<(props: Record<string, any>) => void> = []

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdk-prop-change') return
  const { key, value } = event.data
  // Update cache
  if (propsCache) propsCache[key] = value
  // Fire key-specific listeners
  const listeners = propChangeListeners.get(key)
  if (listeners) {
    for (const cb of listeners) { try { cb(value) } catch {} }
  }
  // Fire any-change listeners
  if (propsCache) {
    for (const cb of propAnyChangeListeners) { try { cb({ ...propsCache }) } catch {} }
  }
})

async function ensurePropsCache(): Promise<Record<string, any>> {
  if (propsCache) return propsCache
  propsCache = await call<Record<string, any>>('sdk:props:getAll')
  return propsCache
}

// ── Media drop subscriptions ──

const mediaDropListeners: Array<(files: DroppedFile[]) => void> = []

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdk-media-drop') return
  if (mediaDropListeners.length > 0) {
    for (const cb of mediaDropListeners) {
      try { cb(event.data.files) } catch {}
    }
  }
})

// ── Widget shortcut subscriptions ──

const shortcutListeners = new Map<string, Array<() => void>>()

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdk-shortcut') return
  const { action } = event.data
  const listeners = shortcutListeners.get(action)
  if (listeners) {
    for (const cb of listeners) {
      try { cb() } catch {}
    }
  }
})

// ── Dataflow subscriptions ──

const dataflowListeners = new Map<string, Array<(value: any) => void>>()

window.addEventListener('message', (event) => {
  if (!event.data || event.data.type !== 'sdk-dataflow-input') return
  const { key, value } = event.data
  const listeners = dataflowListeners.get(key)
  if (listeners) {
    for (const cb of listeners) {
      try { cb(value) } catch {}
    }
  }
})

// ── Public SDK API ──

export const sdk: DimensionsSDK = {
  // Always available — no capability required
  scene: {
    id: () => getContext().sceneId,
    title: () => getContext().sceneTitle,
  },

  // kv — requires "kv"
  kv: {
    get: (key: string) => call('sdk:kv:get', key),
    set: (key: string, value: any) => call('sdk:kv:set', key, JSON.stringify(value)),
    delete: (key: string) => call('sdk:kv:delete', key),
    list: (prefix?: string) => call('sdk:kv:list', prefix ?? ''),
  },

  // assets — requires "assets"
  assets: {
    upload: async (file: File): Promise<string> => {
      // Convert File to base64 for IPC transport
      const buffer = await file.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
      return call('sdk:assets:upload', file.name, file.type, base64)
    },
    resolve: (assetUrl: string) => call('sdk:assets:resolve', assetUrl),
    list: () => call<AssetInfo[]>('sdk:assets:list'),
  },

  // network — requires "network"
  fetch: (url: string, options?: RequestInit) => {
    const serializable = options ? {
      method: options.method,
      headers: options.headers,
      body: options.body,
    } : undefined
    return call<SDKResponse>('sdk:fetch', url, serializable)
  },

  // websocket — requires "websocket"
  ws: {
    connect: (url: string) => call<WSConnection>('sdk:ws:connect', url),
  },

  // env — requires "env"
  env: {
    get: (key: string) => call<string | null>('sdk:env:get', key),
  },

  // secrets — requires "secrets"
  secrets: {
    get: (key: string) => call<string | null>('sdk:secrets:get', key),
    set: (key: string, value: string) => call('sdk:secrets:set', key, value),
    delete: (key: string) => call('sdk:secrets:delete', key),
  },

  // editing — requires "editing"
  editing: {
    setWidgetBounds: (id: string, bounds: Bounds) => call('sdk:editing:setBounds', id, bounds),
    getWidgetBounds: (id: string) => call<Bounds>('sdk:editing:getBounds', id),
    selectWidget: (id: string) => call('sdk:editing:select', id),
  },

  // dataflow — requires "dataflow"
  emit: (outputKey: string, value: any) => {
    fire('sdk:emit', outputKey, value)
  },
  on: (inputKey: string, cb: (value: any) => void) => {
    if (!dataflowListeners.has(inputKey)) {
      dataflowListeners.set(inputKey, [])
    }
    dataflowListeners.get(inputKey)!.push(cb)
  },

  // navigate — requires "navigate"
  navigate: {
    to: (url: string) => { fire('sdk:navigate:to', url) },
    back: () => { fire('sdk:navigate:back') },
    forward: () => { fire('sdk:navigate:forward') },
    next: () => { fire('sdk:navigate:next') },
    previous: () => { fire('sdk:navigate:previous') },
  },

  // theme — requires "theme"
  theme: {
    get: () => call<ThemeVars>('sdk:theme:get'),
    onChange: (cb: (vars: ThemeVars) => void) => {
      themeListeners.push(cb)
    },
  },

  // portal control — requires "portal-control"
  portal: {
    navigate: (portalWidgetId: string, url: string) => call('sdk:portal:navigate', portalWidgetId, url),
    goBack: (portalWidgetId: string) => call('sdk:portal:goBack', portalWidgetId),
    goForward: (portalWidgetId: string) => call('sdk:portal:goForward', portalWidgetId),
    reload: (portalWidgetId: string) => call('sdk:portal:reload', portalWidgetId),
    stop: (portalWidgetId: string) => call('sdk:portal:stop', portalWidgetId),
    injectCSS: (portalWidgetId: string, css: string) => call('sdk:portal:injectCSS', portalWidgetId, css),
    removeCSS: (portalWidgetId: string, key: string) => call('sdk:portal:removeCSS', portalWidgetId, key),
    setVisible: (portalWidgetId: string, visible: boolean) => call('sdk:portal:setVisible', portalWidgetId, visible),
    newTab: (portalWidgetId: string, url?: string) => call<string>('sdk:portal:newTab', portalWidgetId, url),
    closeTab: (portalWidgetId: string, tabId: string) => call('sdk:portal:closeTab', portalWidgetId, tabId),
    switchTab: (portalWidgetId: string, tabId: string) => call('sdk:portal:switchTab', portalWidgetId, tabId),
    getState: (portalWidgetId: string) => call<PortalState>('sdk:portal:getState', portalWidgetId),
    onStateChange: (portalWidgetId: string, cb: (state: PortalState) => void) => {
      if (!portalStateListeners.has(portalWidgetId)) {
        portalStateListeners.set(portalWidgetId, [])
      }
      portalStateListeners.get(portalWidgetId)!.push(cb)
    },
  },

  // clipboard — requires "clipboard"
  clipboard: {
    read: () => call<string>('sdk:clipboard:read'),
    write: (text: string) => call('sdk:clipboard:write', text),
  },

  // notifications — requires "notifications"
  notify: (title: string, body?: string) => call('sdk:notify', title, body),

  // Widget properties — no capability required
  props: {
    get: async (key: string) => {
      const all = await ensurePropsCache()
      return all[key]
    },
    getAll: () => ensurePropsCache().then(c => ({ ...c })),
    onChange: (key: string, cb: (value: any) => void) => {
      if (!propChangeListeners.has(key)) propChangeListeners.set(key, [])
      propChangeListeners.get(key)!.push(cb)
    },
    onAnyChange: (cb: (props: Record<string, any>) => void) => {
      propAnyChangeListeners.push(cb)
    },
  },

  // media-drop — requires "media-drop" capability for receiving
  media: {
    onDrop: (cb: (files: DroppedFile[]) => void) => {
      mediaDropListeners.push(cb)
    },
    importDrop: (file: DroppedFile) => call<string>('sdk:media:importDrop', file),
    importFromUrl: (url: string) => call<string>('sdk:media:importFromUrl', url),
    startDrag: (assetUrl: string) => call('sdk:media:startDrag', assetUrl),
  },

  // Widget shortcuts — declared in manifest, dispatched when widget is focused
  onShortcut: (action: string, cb: () => void) => {
    if (!shortcutListeners.has(action)) {
      shortcutListeners.set(action, [])
    }
    shortcutListeners.get(action)!.push(cb)
  },
}

// Default export for convenience
export default sdk
