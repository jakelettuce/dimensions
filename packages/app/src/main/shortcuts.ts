import { globalShortcut, BrowserWindow, ipcMain } from 'electron'
import { findWindowByBrowserWindow, findWindowByWebContentsId, toggleEditMode, type DimensionsWindow } from './window-manager'

function getFocusedDimWin() {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused) return null
  return findWindowByBrowserWindow(focused)
}

// WCVs are native layers above the renderer. To show renderer-drawn overlays
// (command palette), we must remove the WCV from the view tree, then re-add it.
const savedBounds = new Map<string, { x: number; y: number; width: number; height: number }>()

function hideSceneWCV(dimWin: DimensionsWindow): void {
  try {
    savedBounds.set(dimWin.id, dimWin.sceneWCV.getBounds())
    dimWin.browserWindow.contentView.removeChildView(dimWin.sceneWCV)
    for (const portalWcv of dimWin.portalWCVs.values()) {
      dimWin.browserWindow.contentView.removeChildView(portalWcv)
    }
  } catch {}
}

function showSceneWCV(dimWin: DimensionsWindow): void {
  try {
    dimWin.browserWindow.contentView.addChildView(dimWin.sceneWCV)
    const bounds = savedBounds.get(dimWin.id)
    if (bounds) {
      dimWin.sceneWCV.setBounds(bounds)
      savedBounds.delete(dimWin.id)
    }
    for (const portalWcv of dimWin.portalWCVs.values()) {
      dimWin.browserWindow.contentView.addChildView(portalWcv)
    }
  } catch {}
}

export function registerGlobalShortcuts(): void {
  // Cmd+E: Toggle edit mode
  globalShortcut.register('CommandOrControl+E', () => {
    const dimWin = getFocusedDimWin()
    if (dimWin) toggleEditMode(dimWin)
  })

  // Cmd+K: Open command palette — hide WCV, tell renderer
  globalShortcut.register('CommandOrControl+K', () => {
    const dimWin = getFocusedDimWin()
    if (!dimWin) return
    // Always hide WCV and tell renderer to open palette
    hideSceneWCV(dimWin)
    dimWin.browserWindow.webContents.send('open-palette')
  })

  // Cmd+1: Claude Code terminal tab
  globalShortcut.register('CommandOrControl+1', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused) return
    focused.webContents.send('set-editor-tool', 'claude')
  })

  // Cmd+2: No-code properties tab
  globalShortcut.register('CommandOrControl+2', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused) return
    focused.webContents.send('set-editor-tool', 'nocode')
  })

  // Cmd+[: Navigate back
  globalShortcut.register('CommandOrControl+[', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused) return
    focused.webContents.send('navigate-back')
  })

  // Cmd+]: Navigate forward
  globalShortcut.register('CommandOrControl+]', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused) return
    focused.webContents.send('navigate-forward')
  })

  // Cmd+Shift+F: Toggle Live/Files view
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused) return
    focused.webContents.send('toggle-content-view')
  })

  // Cmd+`: Focus terminal
  globalShortcut.register('CommandOrControl+`', () => {
    const dimWin = getFocusedDimWin()
    if (!dimWin) return
    if (!dimWin.editMode) toggleEditMode(dimWin)
    dimWin.browserWindow.webContents.send('set-editor-tool', 'claude')
    dimWin.browserWindow.webContents.send('focus-terminal')
  })

  // IPC: renderer signals palette closed → restore scene WCV
  ipcMain.handle('palette-close', (event) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return
    showSceneWCV(dimWin)
  })
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
}
