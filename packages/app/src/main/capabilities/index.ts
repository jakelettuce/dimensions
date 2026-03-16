import { ipcMain } from 'electron'
import type { Database } from 'sql.js'
import type { WidgetState, SceneState } from '../scene-manager'
import type { DimensionsWindow } from '../window-manager'
import { sanitizeIpcData } from '../ipc-safety'

// ── Interfaces ──

export interface CapabilityModule {
  name: string
  manifestFields?: Record<string, { type: string; required: boolean }>
  register(ctx: CapabilityContext): void
}

export interface CapabilityContext {
  ipcMain: Electron.IpcMain
  db: Database
  getWidget: (widgetId: string) => WidgetState | null
  getScene: (widgetId: string) => SceneState | null
  getWindow: (widgetId: string) => DimensionsWindow | null
  sanitize: <T>(data: T) => T
}

// ── Errors ──

export class CapabilityDeniedError extends Error {
  constructor(widgetId: string, capability: string) {
    super(`Capability "${capability}" not declared for widget "${widgetId}"`)
    this.name = 'CapabilityDeniedError'
  }
}

export function assertCapability(widget: WidgetState, capability: string): void {
  if (!widget.manifest.capabilities.includes(capability)) {
    throw new CapabilityDeniedError(widget.id, capability)
  }
}

// ── Module imports ──

import { kvCapability } from './kv'
import { assetsCapability } from './assets'
import { navigateCapability } from './navigate'
import { themeCapability } from './theme'
import { networkCapability } from './network'
import { websocketCapability } from './websocket'
import { envCapability } from './env'
import { secretsCapability } from './secrets'
import { editingCapability } from './editing'
import { clipboardCapability } from './clipboard'
import { notificationsCapability } from './notifications'
import { dataflowCapability } from './dataflow'
import { portalControlCapability } from './portal-control'

const ALL_CAPABILITIES: CapabilityModule[] = [
  kvCapability,
  assetsCapability,
  navigateCapability,
  themeCapability,
  networkCapability,
  websocketCapability,
  envCapability,
  secretsCapability,
  editingCapability,
  clipboardCapability,
  notificationsCapability,
  dataflowCapability,
  portalControlCapability,
]

// ── Registration ──

export function registerCapabilities(
  db: Database,
  getWidgetFn: (widgetId: string) => WidgetState | null,
  getSceneFn: (widgetId: string) => SceneState | null,
  getWindowFn: (widgetId: string) => DimensionsWindow | null,
): void {
  const ctx: CapabilityContext = {
    ipcMain,
    db,
    getWidget: getWidgetFn,
    getScene: getSceneFn,
    getWindow: getWindowFn,
    sanitize: sanitizeIpcData,
  }

  for (const cap of ALL_CAPABILITIES) {
    cap.register(ctx)
  }

  // Register a catch-all for scene info (no capability required)
  ipcMain.handle('sdk:scene:info', (_event, widgetId: unknown) => {
    if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }
    const scene = ctx.getScene(widgetId)
    if (!scene) return { error: 'scene_not_found' }
    return ctx.sanitize({
      id: scene.id,
      title: scene.meta.title,
      slug: scene.slug,
    })
  })
}
