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
import { registerPortalIpcHandlers } from './webportal-manager'
import { registerGlobalShortcuts, unregisterGlobalShortcuts } from './shortcuts'
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

  // Widget editing IPC — bounds update from scene drag/resize
  ipcMain.handle('sdk:widget:bounds-update', (_event, widgetId: unknown, bounds: unknown) => {
    if (typeof widgetId !== 'string') return
    if (!bounds || typeof bounds !== 'object') return

    const { x, y, width, height } = bounds as any
    if (typeof x !== 'number' || typeof y !== 'number' ||
        typeof width !== 'number' || typeof height !== 'number') return

    // Find the scene and update meta.json
    for (const dimWin of getAllWindows()) {
      if (!dimWin.currentScene) continue
      const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === widgetId)
      if (entry) {
        entry.bounds = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
        // Persist to meta.json
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
