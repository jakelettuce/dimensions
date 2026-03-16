import { app, BrowserWindow } from 'electron'
import { registerProtocols, registerProtocolHandlers } from './protocol'
import { initDatabase, closeDatabase } from './database'
import {
  createWindow,
  registerWindowIpcHandlers,
  loadSceneIntoWindow,
  getAllWindows,
} from './window-manager'
import { ensureHomeScene } from './scene-manager'
import type { WidgetState, SceneState } from './scene-manager'
import type { DimensionsWindow } from './window-manager'
import { registerCapabilities } from './capabilities/index'
import { HOME_SCENE_DIR } from './constants'

// Protocols MUST be registered before app.ready — silently fails otherwise
registerProtocols()

app.whenReady().then(async () => {
  // Initialize database (sql.js WASM)
  const db = await initDatabase()

  // Register protocol handlers (after app.ready)
  registerProtocolHandlers()

  // Register window-level IPC handlers
  registerWindowIpcHandlers()

  // Register capability system — connects SDK IPC channels to capability modules
  // These lookup functions search across all windows to find widget/scene/window by widgetId
  registerCapabilities(
    db,
    // getWidget: find a WidgetState by widgetId across all windows
    (widgetId: string): WidgetState | null => {
      for (const dimWin of getAllWindows()) {
        if (dimWin.currentScene) {
          const widget = dimWin.currentScene.widgets.get(widgetId)
          if (widget) return widget
        }
      }
      return null
    },
    // getScene: find the SceneState that contains a widgetId
    (widgetId: string): SceneState | null => {
      for (const dimWin of getAllWindows()) {
        if (dimWin.currentScene?.widgets.has(widgetId)) {
          return dimWin.currentScene
        }
      }
      return null
    },
    // getWindow: find the DimensionsWindow that contains a widgetId
    (widgetId: string): DimensionsWindow | null => {
      for (const dimWin of getAllWindows()) {
        if (dimWin.currentScene?.widgets.has(widgetId)) {
          return dimWin
        }
      }
      return null
    },
  )

  // Ensure home scene exists
  ensureHomeScene(HOME_SCENE_DIR)

  // Create first window and load home scene
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

app.on('before-quit', () => {
  closeDatabase()
})
