// Fix PATH for GUI-launched Electron (Finder/Dock launch has minimal PATH).
// Must run before any pty.spawn() or child_process calls.
import { execSync } from 'child_process'

function fixPath(): void {
  if (process.platform === 'win32') return
  try {
    const shell = process.env.SHELL || '/bin/zsh'
    const result = execSync(`${shell} -ilc 'echo -n "$PATH"'`, {
      encoding: 'utf8',
      timeout: 5000,
    })
    if (result.trim()) {
      process.env.PATH = result.trim()
    }
  } catch {
    const fallback = '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin'
    if (!process.env.PATH?.includes('/usr/local/bin')) {
      process.env.PATH = `${fallback}:${process.env.PATH || ''}`
    }
  }
}

fixPath()

import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import fs from 'fs'
import path from 'path'
import { registerProtocols, registerProtocolHandlers } from './protocol'
import { initDatabase, closeDatabase } from './database'
import {
  createWindow,
  registerWindowIpcHandlers,
  loadSceneIntoWindow,
  getAllWindows,
  findWindowByWebContentsId,
} from './window-manager'
import { ensureHomeDimension, ensureMediaTestDimension } from './scene-manager'
import type { WidgetState, SceneState } from './scene-manager'
import type { DimensionsWindow } from './window-manager'
import { registerCapabilities } from './capabilities/index'
import { registerTerminalIpcHandlers } from './terminal'
import { repositionPortals, setWindowGetter } from './webportal-manager'
import { registerShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import { registerFileOperationHandlers } from './file-operations'
import { HOME_SCENE_DIR, ASSET_ORIGIN } from './constants'
import { sanitizeIpcData } from './ipc-safety'
import { importMedia, listMediaFiltered, deleteMedia, getMimeType, buildDialogFilters, syncMediaReferences, getMediaReferences } from './media-library'

// Protocols MUST be registered before app.ready — silently fails otherwise
registerProtocols()

app.whenReady().then(async () => {
  const db = await initDatabase()

  registerProtocolHandlers()
  setWindowGetter(getAllWindows)
  registerWindowIpcHandlers()
  registerTerminalIpcHandlers()
  registerFileOperationHandlers()
  registerShortcuts(db)

  // Register capability system
  registerCapabilities(
    db,
    (widgetId: string): WidgetState | null => {
      for (const dimWin of getAllWindows()) {
        if (dimWin.currentScene) {
          const widget = dimWin.currentScene.widgets.get(widgetId)
          if (widget) return widget
        }
      }
      return null
    },
    (widgetId: string): SceneState | null => {
      for (const dimWin of getAllWindows()) {
        if (dimWin.currentScene?.widgets.has(widgetId)) {
          return dimWin.currentScene
        }
      }
      return null
    },
    (widgetId: string): DimensionsWindow | null => {
      for (const dimWin of getAllWindows()) {
        if (dimWin.currentScene?.widgets.has(widgetId)) {
          return dimWin
        }
      }
      return null
    },
  )

  // Live bounds update — reposition portal WCVs during drag/resize (no disk write)
  ipcMain.handle('sdk:widget:bounds-live', (_event, widgetId: unknown, bounds: unknown) => {
    if (typeof widgetId !== 'string') return
    if (!bounds || typeof bounds !== 'object') return
    const { x, y, width, height } = bounds as any
    if (typeof x !== 'number' || typeof y !== 'number' ||
        typeof width !== 'number' || typeof height !== 'number') return

    for (const dimWin of getAllWindows()) {
      if (!dimWin.currentScene) continue
      const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === widgetId)
      if (entry) {
        // Update in-memory bounds (no disk write)
        entry.bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
        // Reposition portal WCVs to match
        repositionPortals(dimWin)
        break
      }
    }
  })

  // Final bounds update — persist to meta.json on drop/release
  ipcMain.handle('sdk:widget:bounds-update', (_event, widgetId: unknown, bounds: unknown) => {
    if (typeof widgetId !== 'string') return
    if (!bounds || typeof bounds !== 'object') return
    const { x, y, width, height } = bounds as any
    if (typeof x !== 'number' || typeof y !== 'number' ||
        typeof width !== 'number' || typeof height !== 'number') return

    for (const dimWin of getAllWindows()) {
      if (!dimWin.currentScene) continue
      const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === widgetId)
      if (entry) {
        entry.bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
        repositionPortals(dimWin)
        const metaPath = path.join(dimWin.currentScene.path, 'meta.json')
        fs.writeFileSync(metaPath, JSON.stringify(dimWin.currentScene.meta, null, 2), 'utf-8')
        break
      }
    }
  })

  // Widget selection from scene — forward to renderer for properties panel
  ipcMain.handle('sdk:widget:select', (_event, widgetId: unknown) => {
    if (typeof widgetId !== 'string') return

    for (const dimWin of getAllWindows()) {
      if (!dimWin.currentScene?.widgets.has(widgetId)) continue
      if (!dimWin.browserWindow.isDestroyed()) {
        dimWin.browserWindow.webContents.send('widget:select', widgetId)
      }
      break
    }
  })

  // ── Props system ──

  // Validation for prop values against their declared schema
  function validatePropValue(
    schema: { type: string; options?: string[]; min?: number; max?: number },
    value: unknown,
  ): string | null {
    switch (schema.type) {
      case 'string':
        if (typeof value !== 'string') return 'Expected string'
        if (value.length > 10240) return 'Exceeds 10KB limit'
        if (schema.maxLength && value.length > schema.maxLength) return `Exceeds maxLength ${schema.maxLength}`
        return null
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) return 'Expected number'
        if (schema.min !== undefined && value < schema.min) return `Below minimum ${schema.min}`
        if (schema.max !== undefined && value > schema.max) return `Above maximum ${schema.max}`
        return null
      case 'boolean':
        if (typeof value !== 'boolean') return 'Expected boolean'
        return null
      case 'color':
        if (typeof value !== 'string') return 'Expected color string'
        if (!/^\s*(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*[\d\s,.%]+\)|hsla?\(\s*[\d\s,.%°]+\))\s*$/.test(value))
          return 'Invalid CSS color'
        return null
      case 'select':
        if (!schema.options?.includes(String(value))) return `Not in options: ${schema.options?.join(', ')}`
        return null
      case 'scene':
        if (value === null || value === '') return null
        if (typeof value !== 'string') return 'Expected string or null'
        return null
      case 'media':
        if (!Array.isArray(value)) return 'Expected array'
        if (value.length > ((schema as any).maxItems || 100)) return `Exceeds maxItems ${(schema as any).maxItems || 100}`
        for (let i = 0; i < value.length; i++) {
          if (typeof value[i] !== 'string') return `Item ${i} is not a string`
          if (!value[i].startsWith(`${ASSET_ORIGIN}/_media/`)) return `Item ${i} is not a valid media URL`
          const fn = value[i].replace(`${ASSET_ORIGIN}/_media/`, '')
          if (fn.includes('/') || fn.includes('..')) return `Item ${i} has invalid filename`
        }
        return null
      case 'array':
        if (!Array.isArray(value)) return 'Expected array'
        if (value.length > 1000) return 'Array exceeds 1000 items'
        if (schema.itemType === 'number') {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== 'number' || isNaN(value[i])) return `Item ${i} is not a number`
          }
        } else if (schema.itemType === 'string') {
          for (let i = 0; i < value.length; i++) {
            if (typeof value[i] !== 'string') return `Item ${i} is not a string`
            if (value[i].length > 10240) return `Item ${i} exceeds 10KB`
          }
        }
        return null
      default:
        return null
    }
  }

  // Get all effective prop values for a widget (defaults merged with overrides)
  ipcMain.handle('sdk:props:getAll', (_event, widgetId: unknown) => {
    if (typeof widgetId !== 'string') return { error: 'invalid_widget_id' }

    for (const dimWin of getAllWindows()) {
      if (!dimWin.currentScene) continue
      const widget = dimWin.currentScene.widgets.get(widgetId)
      if (!widget) continue
      const entry = dimWin.currentScene.meta.widgets.find(w => w.id === widgetId)

      const result: Record<string, any> = {}
      for (const prop of widget.manifest.props ?? []) {
        result[prop.key] = entry?.props?.[prop.key] ?? prop.default
      }
      return sanitizeIpcData(result)
    }
    return { error: 'widget_not_found' }
  })

  // Set a widget prop value — validates, writes meta.json, notifies widget live
  ipcMain.handle('set-widget-prop', (event, widgetId: unknown, key: unknown, value: unknown) => {
    if (typeof widgetId !== 'string' || typeof key !== 'string') return { error: 'invalid_args' }

    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin?.currentScene) return { error: 'no_scene' }

    const widget = dimWin.currentScene.widgets.get(widgetId)
    if (!widget) return { error: 'widget_not_found' }

    const propSchema = widget.manifest.props?.find(p => p.key === key)
    if (!propSchema) return { error: 'prop_not_declared', key }

    const validationError = validatePropValue(propSchema, value)
    if (validationError) return { error: 'invalid_value', details: validationError }

    // Write to meta.json
    const metaPath = path.join(dimWin.currentScene.path, 'meta.json')
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const metaEntry = meta.widgets.find((w: any) => w.id === widgetId)
    if (!metaEntry) return { error: 'entry_not_found' }
    if (!metaEntry.props) metaEntry.props = {}
    metaEntry.props[key] = value
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')

    // Update in-memory state
    const memEntry = dimWin.currentScene.meta.widgets.find(w => w.id === widgetId)
    if (memEntry) {
      if (!memEntry.props) memEntry.props = {}
      memEntry.props[key] = value
    }

    // Sync media references if this is a media prop
    if (propSchema.type === 'media' && Array.isArray(value) && dimWin.currentScene) {
      syncMediaReferences(value, dimWin.currentScene.path, widgetId, key)
    }

    // Notify widget iframe live
    if (!dimWin.sceneWCV.webContents.isDestroyed()) {
      dimWin.sceneWCV.webContents.send('scene:prop-change', { widgetId, key, value })
    }

    // Notify renderer so the properties panel reflects the change
    if (!dimWin.browserWindow.isDestroyed()) {
      dimWin.browserWindow.webContents.send('widget:props-updated', {
        widgetId,
        props: memEntry?.props ?? {},
      })
    }

    return { success: true }
  })

  // Reset a widget prop to its manifest default
  ipcMain.handle('reset-widget-prop', (event, widgetId: unknown, key: unknown) => {
    if (typeof widgetId !== 'string' || typeof key !== 'string') return { error: 'invalid_args' }

    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin?.currentScene) return { error: 'no_scene' }

    const widget = dimWin.currentScene.widgets.get(widgetId)
    if (!widget) return { error: 'widget_not_found' }

    const propSchema = widget.manifest.props?.find(p => p.key === key)
    if (!propSchema) return { error: 'prop_not_declared', key }

    // Remove from meta.json
    const metaPath = path.join(dimWin.currentScene.path, 'meta.json')
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    const metaEntry = meta.widgets.find((w: any) => w.id === widgetId)
    if (metaEntry?.props) {
      delete metaEntry.props[key]
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    }

    // Update in-memory state
    const memEntry = dimWin.currentScene.meta.widgets.find(w => w.id === widgetId)
    if (memEntry?.props) delete memEntry.props[key]

    // Clear media references for this prop
    if (propSchema.type === 'media' && dimWin.currentScene) {
      syncMediaReferences([], dimWin.currentScene.path, widgetId, key)
    }

    // Notify widget with default value
    const defaultValue = propSchema.default
    if (!dimWin.sceneWCV.webContents.isDestroyed()) {
      dimWin.sceneWCV.webContents.send('scene:prop-change', { widgetId, key, value: defaultValue })
    }

    // Notify renderer
    if (!dimWin.browserWindow.isDestroyed()) {
      dimWin.browserWindow.webContents.send('widget:props-updated', {
        widgetId,
        props: memEntry?.props ?? {},
      })
    }

    return { success: true }
  })

  // ── Media library ──

  ipcMain.handle('add-media', async (event, options: { accept?: string[]; multiple?: boolean }) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return { error: 'no_window' }

    const filters = buildDialogFilters(options?.accept)
    const result = await dialog.showOpenDialog(dimWin.browserWindow, {
      title: 'Add Media',
      properties: options?.multiple !== false ? ['openFile', 'multiSelections'] : ['openFile'],
      filters,
    })
    if (result.canceled || result.filePaths.length === 0) return { urls: [] }

    const urls: string[] = []
    for (const filePath of result.filePaths) {
      const originalName = path.basename(filePath)
      const mimeType = getMimeType(filePath)
      const url = importMedia(filePath, originalName, mimeType)
      urls.push(url)
    }
    return sanitizeIpcData({ urls })
  })

  ipcMain.handle('list-media', (_event, accept?: string[]) => {
    return sanitizeIpcData(listMediaFiltered(accept ?? []))
  })

  ipcMain.handle('delete-media', (_event, filename: unknown) => {
    if (typeof filename !== 'string') return { error: 'invalid_filename' }
    if (filename.includes('/') || filename.includes('..')) return { error: 'invalid_filename' }

    try {
      const mediaUrl = `${ASSET_ORIGIN}/_media/${filename}`
      const refs = getMediaReferences(filename)

      // Remove the URL from each referenced widget prop in meta.json
      for (const ref of refs) {
        try {
          const metaPath = path.join(ref.scenePath, 'meta.json')
          if (!fs.existsSync(metaPath)) continue
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
          const widget = meta.widgets?.find((w: any) => w.id === ref.widgetId)
          if (!widget?.props?.[ref.propKey]) continue
          const arr = widget.props[ref.propKey]
          if (Array.isArray(arr) && arr.includes(mediaUrl)) {
            widget.props[ref.propKey] = arr.filter((v: string) => v !== mediaUrl)
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
          }
        } catch {}
      }

      // Notify active scene widgets of prop changes
      for (const dimWin of getAllWindows()) {
        if (!dimWin.currentScene) continue
        for (const ref of refs) {
          if (ref.scenePath !== dimWin.currentScene.path) continue
          const memEntry = dimWin.currentScene.meta.widgets.find(w => w.id === ref.widgetId)
          if (!memEntry?.props?.[ref.propKey]) continue
          const arr = memEntry.props[ref.propKey]
          if (Array.isArray(arr)) {
            const updated = arr.filter((v: string) => v !== mediaUrl)
            memEntry.props[ref.propKey] = updated
            if (!dimWin.sceneWCV.webContents.isDestroyed()) {
              dimWin.sceneWCV.webContents.send('scene:prop-change', {
                widgetId: ref.widgetId, key: ref.propKey, value: updated,
              })
            }
            if (!dimWin.browserWindow.isDestroyed()) {
              dimWin.browserWindow.webContents.send('widget:props-updated', {
                widgetId: ref.widgetId, props: memEntry.props,
              })
            }
          }
        }
      }

      deleteMedia(filename)
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'delete_failed' }
    }
  })

  ensureHomeDimension()
  ensureMediaTestDimension()

  // Home is a dimension — load via protocol to get proper dimension routing
  const dimWin = createWindow(db)
  const homeMainPath = path.join(HOME_SCENE_DIR, 'main')
  const homeDimId = (() => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(HOME_SCENE_DIR, 'dimension.json'), 'utf-8'))
      return raw.id || null
    } catch { return null }
  })()
  loadSceneIntoWindow(dimWin, homeMainPath, homeDimId, HOME_SCENE_DIR)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow(db)
      loadSceneIntoWindow(newWin, HOME_SCENE_DIR)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  unregisterGlobalShortcuts()
})

app.on('before-quit', () => {
  closeDatabase()
})
