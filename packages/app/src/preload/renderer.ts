import { contextBridge, ipcRenderer } from 'electron'

// ── Whitelisted IPC channels ──

const INVOKE_CHANNELS = new Set([
  'navigate',
  'get-current-scene',
  'toggle-edit-mode',
  'list-scenes',
  'list-dimensions',
  'get-env-keys',
  'set-env-var',
  'delete-env-var',
  'read-dir',
  'read-file',
  'write-file',
  'create-terminal',
  'destroy-terminal',
])

const SEND_CHANNELS = new Set([
  'terminal-input',
  'terminal-resize',
])

const RECEIVE_CHANNELS = new Set([
  'edit-mode',
  'app:navigate',
  'widget:build-status',
  'widget:select',
  'toggle-palette',
  'set-editor-tool',
  'navigate-back',
  'navigate-forward',
  'toggle-content-view',
  'focus-terminal',
])

// Sanitize data crossing the bridge
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

contextBridge.exposeInMainWorld('dimensions', {
  platform: process.platform,

  // Navigation
  navigateTo: (url: string) => ipcRenderer.invoke('navigate', url),
  getCurrentScene: () => ipcRenderer.invoke('get-current-scene'),

  // Edit mode
  toggleEditMode: () => ipcRenderer.invoke('toggle-edit-mode'),
  onEditModeChange: (cb: (editing: boolean) => void) => {
    ipcRenderer.on('edit-mode', (_e, v) => cb(v))
  },

  // App navigation (from main process)
  onAppNavigate: (cb: (route: string) => void) => {
    ipcRenderer.on('app:navigate', (_e, route) => cb(route))
  },

  // Widget build status
  onWidgetBuildStatus: (cb: (status: { widgetId: string; success: boolean; error?: string }) => void) => {
    ipcRenderer.on('widget:build-status', (_e, status) => cb(sanitize(status) as any))
  },

  // Scene/dimension listing
  listScenes: () => ipcRenderer.invoke('list-scenes'),
  listDimensions: () => ipcRenderer.invoke('list-dimensions'),

  // File operations (scoped to scene folder, for Monaco editor)
  readDir: (dirPath: string) => ipcRenderer.invoke('read-dir', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('write-file', filePath, content),

  // Settings
  getEnvKeys: () => ipcRenderer.invoke('get-env-keys'),
  setEnvVar: (key: string, value: string) => ipcRenderer.invoke('set-env-var', key, value),
  deleteEnvVar: (key: string) => ipcRenderer.invoke('delete-env-var', key),

  // Terminal
  createTerminal: (scenePath: string) => ipcRenderer.invoke('create-terminal', scenePath),
  destroyTerminal: (id: string) => ipcRenderer.invoke('destroy-terminal', id),
  sendTerminalInput: (id: string, data: string) => ipcRenderer.send('terminal-input', id, data),
  resizeTerminal: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal-resize', id, cols, rows),
  onTerminalOutput: (id: string, cb: (data: string) => void) => {
    ipcRenderer.on(`terminal-output:${id}`, (_e, d) => cb(d))
  },
  removeTerminalOutputListener: (id: string) => {
    ipcRenderer.removeAllListeners(`terminal-output:${id}`)
  },

  // Widget selection (from scene WCV)
  onWidgetSelect: (cb: (widgetId: string) => void) => {
    ipcRenderer.on('widget:select', (_e, widgetId) => cb(widgetId))
  },

  // Global shortcut messages from main process
  onTogglePalette: (cb: () => void) => {
    ipcRenderer.on('toggle-palette', () => cb())
  },
  onSetEditorTool: (cb: (tool: string) => void) => {
    ipcRenderer.on('set-editor-tool', (_e, tool) => cb(tool))
  },
  onNavigateBack: (cb: () => void) => {
    ipcRenderer.on('navigate-back', () => cb())
  },
  onNavigateForward: (cb: () => void) => {
    ipcRenderer.on('navigate-forward', () => cb())
  },
  onToggleContentView: (cb: () => void) => {
    ipcRenderer.on('toggle-content-view', () => cb())
  },
  onFocusTerminal: (cb: () => void) => {
    ipcRenderer.on('focus-terminal', () => cb())
  },
})
