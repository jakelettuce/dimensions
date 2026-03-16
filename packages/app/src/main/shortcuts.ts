import { globalShortcut, BrowserWindow } from 'electron'
import { findWindowByBrowserWindow, toggleEditMode } from './window-manager'

// Get the DimensionsWindow for the currently focused BrowserWindow.
// Returns null if app is not focused (critical: globalShortcut fires even when app is in background).
function getFocusedDimWin() {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused) return null
  return findWindowByBrowserWindow(focused)
}

export function registerGlobalShortcuts(): void {
  // Cmd+E: Toggle edit mode
  globalShortcut.register('CommandOrControl+E', () => {
    const dimWin = getFocusedDimWin()
    if (dimWin) toggleEditMode(dimWin)
  })

  // Cmd+K: Toggle command palette (send to renderer)
  globalShortcut.register('CommandOrControl+K', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused) return
    focused.webContents.send('toggle-palette')
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
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
}
