export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ThemeVars {
  background: string
  accent: string
  [key: string]: string
}

export interface AssetInfo {
  url: string
  name: string
  size: number
  mimeType: string
}

export interface SDKResponse {
  status: number
  headers: Record<string, string>
  body: string
}

export interface WSConnection {
  send(data: string | ArrayBuffer): void
  on(event: 'message' | 'close' | 'error', cb: (data: any) => void): void
  close(): void
}

export interface WidgetManifest {
  id: string
  type: 'custom' | 'webportal' | 'terminal'
  title: string
  capabilities: string[]
  allowedHosts?: string[]
  allowedWsHosts?: string[]
  envKeys?: string[]
  inputs?: WidgetInput[]
  outputs?: WidgetOutput[]
  props?: WidgetProp[]
}

export interface WidgetInput {
  key: string
  type: string
  default?: any
}

export interface WidgetOutput {
  key: string
  type: string
}

export interface WidgetProp {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select'
  options?: string[]
  default?: any
  label: string
}

export interface SceneMeta {
  id: string
  title: string
  slug: string
  theme?: ThemeVars
  widgets: WidgetEntry[]
}

export interface WidgetEntry {
  id: string              // ULID instance ID — unique per placement in scene
  widgetType: string      // human-readable type from manifest (e.g. "weather-widget")
  manifest: WidgetManifest
  bounds: Bounds
  props?: Record<string, any>
}

export interface DimensionMeta {
  id: string
  title: string
  scenes: string[]
  theme?: ThemeVars
  sharedEnvKeys?: string[]
}

export interface Connection {
  from: { widgetId: string; output: string }
  to: { widgetId: string; input: string }
}

export interface PortalRule {
  domain: string
  css: string
  label: string
  enabled: boolean
}

export interface DimensionsSDK {
  scene: {
    id(): string
    title(): string
  }
  kv: {
    get(key: string): Promise<any>
    set(key: string, value: any): Promise<void>
    delete(key: string): Promise<void>
    list(prefix?: string): Promise<string[]>
  }
  assets: {
    upload(file: File): Promise<string>
    resolve(assetUrl: string): Promise<string>
    list(): Promise<AssetInfo[]>
  }
  fetch(url: string, options?: RequestInit): Promise<SDKResponse>
  ws: {
    connect(url: string): Promise<WSConnection>
  }
  env: {
    get(key: string): Promise<string | null>
  }
  secrets: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    delete(key: string): Promise<void>
  }
  editing: {
    setWidgetBounds(id: string, bounds: Bounds): Promise<void>
    getWidgetBounds(id: string): Promise<Bounds>
    selectWidget(id: string): Promise<void>
  }
  emit(outputKey: string, value: any): void
  on(inputKey: string, cb: (value: any) => void): void
  navigate: {
    to(url: string): void
    back(): void
    forward(): void
  }
  theme: {
    get(): Promise<ThemeVars>
    onChange(cb: (vars: ThemeVars) => void): void
  }
  portal: {
    navigate(portalWidgetId: string, url: string): Promise<void>
    injectCSS(portalWidgetId: string, css: string): Promise<void>
    removeCSS(portalWidgetId: string, key: string): Promise<void>
    newTab(portalWidgetId: string, url?: string): Promise<string>
    closeTab(portalWidgetId: string, tabId: string): Promise<void>
    switchTab(portalWidgetId: string, tabId: string): Promise<void>
    getState(portalWidgetId: string): Promise<PortalState>
  }
  clipboard: {
    read(): Promise<string>
    write(text: string): Promise<void>
  }
  notify(title: string, body?: string): Promise<void>
}

export interface PortalState {
  activeTabId: string
  tabs: Array<{
    id: string
    url: string
    title: string
    isLoading: boolean
    canGoBack: boolean
    canGoForward: boolean
    isActive: boolean
  }>
}
