import { globalShortcut, BrowserWindow, ipcMain } from 'electron'
import { findWindowByBrowserWindow, findWindowByWebContentsId, toggleEditMode, type DimensionsWindow } from './window-manager'
import { getPortal } from './webportal-manager'

function getFocusedDimWin() {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused) return null
  return findWindowByBrowserWindow(focused)
}

// Track saved WCV state for hide/show
const savedBounds = new Map<string, { x: number; y: number; width: number; height: number }>()

// Collect ALL WCVs that need hiding (scene + all portal chrome + all portal content tabs)
function getAllPortalWCVs(dimWin: DimensionsWindow): Electron.WebContentsView[] {
  const wcvs: Electron.WebContentsView[] = []
  if (!dimWin.currentScene) return wcvs

  for (const entry of dimWin.currentScene.meta.widgets) {
    const portal = getPortal(entry.id)
    if (!portal) continue
    // Chrome WCV
    wcvs.push(portal.chromeWCV)
    // All tab content WCVs
    for (const [, tab] of portal.tabs) {
      wcvs.push(tab.contentWCV)
    }
  }
  return wcvs
}

function hideAllWCVs(dimWin: DimensionsWindow): void {
  try {
    savedBounds.set(dimWin.id, dimWin.sceneWCV.getBounds())
    dimWin.browserWindow.contentView.removeChildView(dimWin.sceneWCV)

    // Remove ALL portal WCVs (chrome + every tab's content)
    for (const wcv of getAllPortalWCVs(dimWin)) {
      try { dimWin.browserWindow.contentView.removeChildView(wcv) } catch {}
    }
  } catch {}
}

function showAllWCVs(dimWin: DimensionsWindow): void {
  try {
    dimWin.browserWindow.contentView.addChildView(dimWin.sceneWCV)
    const bounds = savedBounds.get(dimWin.id)
    if (bounds) {
      dimWin.sceneWCV.setBounds(bounds)
      savedBounds.delete(dimWin.id)
    }

    // Re-add portal WCVs in correct z-order (content before chrome)
    if (dimWin.currentScene) {
      for (const entry of dimWin.currentScene.meta.widgets) {
        const portal = getPortal(entry.id)
        if (!portal) continue
        const activeTab = portal.tabs.get(portal.activeTabId)
        if (activeTab) {
          dimWin.browserWindow.contentView.addChildView(activeTab.contentWCV)
        }
        dimWin.browserWindow.contentView.addChildView(portal.chromeWCV)
      }
    }
  } catch {}
}

export function registerGlobalShortcuts(): void {
  // Cmd+E: Toggle edit mode
  globalShortcut.register('CommandOrControl+E', () => {
    const dimWin = getFocusedDimWin()
    if (dimWin) toggleEditMode(dimWin)
  })

  // Cmd+K: Open command palette — hide ALL WCVs, tell renderer
  globalShortcut.register('CommandOrControl+K', () => {
    const dimWin = getFocusedDimWin()
    if (!dimWin) return
    hideAllWCVs(dimWin)
    dimWin.browserWindow.webContents.send('open-palette')
  })

  // Cmd+1: Claude Code terminal tab
  globalShortcut.register('CommandOrControl+1', () => {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused) return
    focused.webContents.send('set-editor-tool', 'claude')
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

  // Cmd+Shift+F: Toggle Live/Files view — hide/show WCVs
  globalShortcut.register('CommandOrControl+Shift+F', () => {
    const dimWin = getFocusedDimWin()
    if (!dimWin) return
    // Only works in edit mode
    if (!dimWin.editMode) return
    dimWin.browserWindow.webContents.send('toggle-content-view')
  })

  // Cmd+`: Focus terminal (enter edit mode if needed)
  globalShortcut.register('CommandOrControl+`', () => {
    const dimWin = getFocusedDimWin()
    if (!dimWin) return
    if (!dimWin.editMode) toggleEditMode(dimWin)
    dimWin.browserWindow.webContents.send('set-editor-tool', 'claude')
    dimWin.browserWindow.webContents.send('focus-terminal')
  })

  // IPC: renderer signals palette closed → restore WCVs
  ipcMain.handle('palette-close', (event) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return
    showAllWCVs(dimWin)
  })

  // IPC: renderer toggles files view — hide/show WCVs
  ipcMain.handle('toggle-wcv-visibility', (event, visible: unknown) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return
    if (visible) {
      showAllWCVs(dimWin)
    } else {
      hideAllWCVs(dimWin)
    }
  })
}

export function unregisterGlobalShortcuts(): void {
  globalShortcut.unregisterAll()
}
