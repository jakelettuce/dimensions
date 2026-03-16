import { app, BrowserWindow } from 'electron'
import { registerProtocols, registerProtocolHandlers } from './protocol'
import { initDatabase, closeDatabase } from './database'
import { createWindow, registerWindowIpcHandlers, loadSceneIntoWindow } from './window-manager'
import { ensureHomeScene } from './scene-manager'
import { HOME_SCENE_DIR } from './constants'

// Protocols MUST be registered before app.ready — silently fails otherwise
registerProtocols()

app.whenReady().then(async () => {
  // Initialize database (sql.js WASM)
  const db = await initDatabase()

  // Register protocol handlers (after app.ready)
  registerProtocolHandlers()

  // Register IPC handlers
  registerWindowIpcHandlers()

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
