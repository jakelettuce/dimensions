import { Menu, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { findWindowByBrowserWindow, findWindowByWebContentsId, toggleEditMode, createWindow, updateSceneWCVBounds, type DimensionsWindow } from './window-manager'
import type { Database } from 'sql.js'
import { loadSceneFromDisk, generateSceneHtml, writeSceneHtml } from './scene-manager'
import { getPortal, mountAllWebportals, repositionPortals } from './webportal-manager'
import { DIMENSIONS_DIR } from './constants'

function getFocusedDimWin() {
  const focused = BrowserWindow.getFocusedWindow()
  if (!focused) return null
  return findWindowByBrowserWindow(focused)
}

// Track saved WCV state for hide/show
const savedBounds = new Map<string, { x: number; y: number; width: number; height: number }>()

// Collect ALL portal content WCVs that need hiding
function getAllPortalWCVs(dimWin: DimensionsWindow): Electron.WebContentsView[] {
  const wcvs: Electron.WebContentsView[] = []
  if (!dimWin.currentScene) return wcvs

  for (const entry of dimWin.currentScene.meta.widgets) {
    const portal = getPortal(entry.id)
    if (!portal) continue
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

    if (dimWin.currentScene) {
      for (const entry of dimWin.currentScene.meta.widgets) {
        const portal = getPortal(entry.id)
        if (!portal) continue
        const activeTab = portal.tabs.get(portal.activeTabId)
        if (activeTab) {
          dimWin.browserWindow.contentView.addChildView(activeTab.contentWCV)
        }
      }
    }
  } catch {}
}

// ── Shortcut handlers ──

function handleToggleEditMode() {
  const dimWin = getFocusedDimWin()
  if (dimWin) toggleEditMode(dimWin)
}

function handleOpenPalette() {
  const dimWin = getFocusedDimWin()
  if (!dimWin) return
  hideAllWCVs(dimWin)
  dimWin.browserWindow.webContents.send('open-palette')
}

function handleToggleSidebar() {
  const dimWin = getFocusedDimWin()
  if (!dimWin) return
  dimWin.sceneSidebarOpen = !dimWin.sceneSidebarOpen
  updateSceneWCVBounds(dimWin)
  dimWin.browserWindow.webContents.send('scene-sidebar', dimWin.sceneSidebarOpen)
}

function handleNavBack() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) focused.webContents.send('navigate-back')
}

function handleNavForward() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) focused.webContents.send('navigate-forward')
}

function handleToggleContentView() {
  const dimWin = getFocusedDimWin()
  if (!dimWin || !dimWin.editMode) return
  dimWin.browserWindow.webContents.send('toggle-content-view')
}

function handleFocusTerminal() {
  const dimWin = getFocusedDimWin()
  if (!dimWin) return
  if (!dimWin.editMode) toggleEditMode(dimWin)
  dimWin.browserWindow.webContents.send('set-editor-tool', 'claude')
  dimWin.browserWindow.webContents.send('focus-terminal')
}

function handleTerminalTab() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) focused.webContents.send('set-editor-tool', 'claude')
}

function handleFullscreen() {
  const focused = BrowserWindow.getFocusedWindow()
  if (focused) focused.setFullScreen(!focused.isFullScreen())
}

function handleZoomIn() {
  const dimWin = getFocusedDimWin()
  if (!dimWin) return
  dimWin.zoom = Math.min(3.0, dimWin.zoom * 1.1)
  dimWin.sceneWCV.webContents.send('scene:zoom', dimWin.zoom)
  dimWin.browserWindow.webContents.send('zoom-changed', dimWin.zoom)
  repositionPortals(dimWin)
}

function handleZoomOut() {
  const dimWin = getFocusedDimWin()
  if (!dimWin) return
  dimWin.zoom = Math.max(0.25, dimWin.zoom / 1.1)
  dimWin.sceneWCV.webContents.send('scene:zoom', dimWin.zoom)
  dimWin.browserWindow.webContents.send('zoom-changed', dimWin.zoom)
  repositionPortals(dimWin)
}

function handleZoomReset() {
  const dimWin = getFocusedDimWin()
  if (!dimWin) return
  dimWin.zoom = 1.0
  dimWin.sceneWCV.webContents.send('scene:zoom', dimWin.zoom)
  dimWin.browserWindow.webContents.send('zoom-changed', dimWin.zoom)
  repositionPortals(dimWin)
}

let _db: Database | null = null

function handleNewWindow() {
  if (_db) createWindow(_db)
}

function handleNewScene() {
  const dimWin = getFocusedDimWin()
  if (!dimWin) return
  hideAllWCVs(dimWin)
  dimWin.browserWindow.webContents.send('open-palette')
  dimWin.browserWindow.webContents.send('open-new-scene-prompt')
}

// ── Menu-based shortcuts (only active when app is focused) ──

export function registerShortcuts(db: Database): void {
  _db = db

  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: 'Dimensions',
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),

    // File
    {
      label: 'File',
      submenu: [
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: handleNewWindow },
        { label: 'New Scene', accelerator: 'CmdOrCtrl+T', click: handleNewScene },
        { type: 'separator' },
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+S', click: handleToggleSidebar },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' as const }] : [{ role: 'quit' as const }]),
      ],
    },

    // Edit
    {
      label: 'Edit',
      submenu: [
        { label: 'Toggle Edit Mode', accelerator: 'CmdOrCtrl+E', click: handleToggleEditMode },
        { type: 'separator' },
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        { label: 'Command Palette', accelerator: 'CmdOrCtrl+K', click: handleOpenPalette },
        { label: 'Toggle Files', accelerator: 'CmdOrCtrl+Shift+F', click: handleToggleContentView },
        { label: 'Terminal', accelerator: 'CmdOrCtrl+`', click: handleFocusTerminal },
        { label: 'Terminal Tab', accelerator: 'CmdOrCtrl+1', click: handleTerminalTab },
        { type: 'separator' },
        { label: 'Navigate Back', accelerator: 'CmdOrCtrl+[', click: handleNavBack },
        { label: 'Navigate Forward', accelerator: 'CmdOrCtrl+]', click: handleNavForward },
        { type: 'separator' },
        { label: 'Toggle Fullscreen', accelerator: 'F11', click: handleFullscreen },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: handleZoomIn },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: handleZoomOut },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: handleZoomReset },
        { type: 'separator' },
        { role: 'reload' as const },
        { role: 'toggleDevTools' as const },
      ],
    },

    // Window
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : []),
      ],
    },
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)

  // ── IPC handlers (these are always available, not shortcut-dependent) ──

  ipcMain.handle('palette-close', (event) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return
    showAllWCVs(dimWin)
  })

  ipcMain.handle('toggle-wcv-visibility', (event, visible: unknown) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return
    if (visible) {
      if (dimWin.currentScene) {
        const scenePath = dimWin.currentScene.path
        const dimensionId = dimWin.currentScene.dimensionId
        const dimensionPath = dimWin.currentScene.dimensionPath
        const updatedScene = loadSceneFromDisk(scenePath, dimensionId, dimensionPath)
        dimWin.currentScene = updatedScene

        const html = generateSceneHtml(updatedScene)
        const htmlPath = writeSceneHtml(scenePath, html)
        const sceneRelative = path.relative(DIMENSIONS_DIR, htmlPath)
        const sceneUrl = `dimensions-asset://${sceneRelative.split(path.sep).join('/')}`

        showAllWCVs(dimWin)
        dimWin.sceneWCV.webContents.loadURL(sceneUrl)
        dimWin.sceneWCV.webContents.once('did-finish-load', () => {
          if (dimWin.editMode && !dimWin.sceneWCV.webContents.isDestroyed()) {
            dimWin.sceneWCV.webContents.send('scene:edit-mode', true)
          }
        })
        repositionPortals(dimWin)
      } else {
        showAllWCVs(dimWin)
      }
    } else {
      hideAllWCVs(dimWin)
    }
  })
}

export function unregisterGlobalShortcuts(): void {
  // No-op — menu accelerators are cleaned up automatically
}
