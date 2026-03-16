import { globalShortcut, BrowserWindow, ipcMain } from 'electron'
import { findWindowByBrowserWindow, findWindowByWebContentsId, toggleEditMode, type DimensionsWindow } from './window-manager'

// Track palette-open state per window to toggle scene WCV visibility
const paletteOpen = new Map<string, boolean>()

function getFocusedDimWin() {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused) return null
  return findWindowByBrowserWindow(focused)
}

// WCVs are native layers that sit above the renderer. When the command palette
// (rendered in React) needs to be visible, we must hide the scene WCV.
function toggleSceneWCVVisibility(dimWin: DimensionsWindow): void {
  const isOpen = paletteOpen.get(dimWin.id) ?? false
  paletteOpen.set(dimWin.id, !isOpen)

  if (!isOpen) {
    // Palette opening — hide scene WCV
    dimWin.sceneWCV.setVisible(false)
    for (const portalWcv of dimWin.portalWCVs.values()) {
      portalWcv.setVisible(false)
    }
  } else {
    // Palette closing — show scene WCV
    dimWin.sceneWCV.setVisible(true)
    for (const portalWcv of dimWin.portalWCVs.values()) {
      portalWcv.setVisible(true)
    }
  }
}

export function registerGlobalShortcuts(): void {
  // Cmd+E: Toggle edit mode
  globalShortcut.register('CommandOrControl+E', () => {
    const dimWin = getFocusedDimWin()
    if (dimWin) toggleEditMode(dimWin)
  })

  // Cmd+K: Toggle command palette
  // Must hide scene WCV so the renderer-drawn palette is visible (WCVs are native layers above the renderer)
  globalShortcut.register('CommandOrControl+K', () => {
    const dimWin = getFocusedDimWin()
    if (!dimWin) return
    dimWin.browserWindow.webContents.send('toggle-palette')
    toggleSceneWCVVisibility(dimWin)
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
    // If not in edit mode, enter it first
    if (!dimWin.editMode) {
      toggleEditMode(dimWin)
    }
    dimWin.browserWindow.webContents.send('set-editor-tool', 'claude')
    dimWin.browserWindow.webContents.send('focus-terminal')
  })

  // IPC: renderer signals palette closed → restore scene WCV
  ipcMain.handle('palette-close', (event) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return
    paletteOpen.set(dimWin.id, false)
    dimWin.sceneWCV.setVisible(true)
    for (const portalWcv of dimWin.portalWCVs.values()) {
      portalWcv.setVisible(true)
    }
  })
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
}
