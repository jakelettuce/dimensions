// fix-path MUST run before anything else — patches process.env.PATH for GUI-launched Electron
import fixPath from 'fix-path'
fixPath()

import { app, BrowserWindow, ipcMain } from 'electron'
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
import { ensureHomeScene } from './scene-manager'
import type { WidgetState, SceneState } from './scene-manager'
import type { DimensionsWindow } from './window-manager'
import { registerCapabilities } from './capabilities/index'
import { registerTerminalIpcHandlers } from './terminal'
import { registerPortalIpcHandlers, repositionPortals } from './webportal-manager'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
import { registerFileOperationHandlers } from './file-operations'
import { HOME_SCENE_DIR } from './constants'
import { sanitizeIpcData } from './ipc-safety'

// Protocols MUST be registered before app.ready — silently fails otherwise
registerProtocols()

app.whenReady().then(async () => {
  const db = await initDatabase()

  registerProtocolHandlers()
  registerWindowIpcHandlers()
  registerTerminalIpcHandlers()
  registerPortalIpcHandlers()
  registerFileOperationHandlers()
  registerGlobalShortcuts()

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

  ensureHomeScene(HOME_SCENE_DIR)

  const dimWin = createWindow(db)
  loadSceneIntoWindow(dimWin, HOME_SCENE_DIR)

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
