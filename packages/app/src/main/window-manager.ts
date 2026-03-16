import { BrowserWindow, WebContentsView, ipcMain } from 'electron'
import path from 'path'
import { is } from '@electron-toolkit/utils'
import { SECURE_WEB_PREFERENCES, DIMENSIONS_DIR } from './constants'
import {
  loadSceneFromDisk,
  generateSceneHtml,
  writeSceneHtml,
  type SceneState,
} from './scene-manager'
import { watchScene, stopWatching } from './watcher'
import { sanitizeIpcData } from './ipc-safety'
import { buildWidget } from './builder'
import { destroyTerminalsForWindow } from './terminal'
import type { Database } from 'sql.js'

// ── Types ──

export interface DimensionsWindow {
  id: string
  browserWindow: BrowserWindow
  sceneWCV: WebContentsView
  portalWCVs: Map<string, WebContentsView>
  prewarmedWCV: WebContentsView | null
  currentScene: SceneState | null
  editMode: boolean
}

// ── Window registry ──

const windows = new Map<string, DimensionsWindow>()
let windowCounter = 0

// ── Helpers ──

function getPreloadPath(name: string): string {
  return path.join(__dirname, `../preload/${name}.js`)
}

/**
 * Find the DimensionsWindow that owns a given webContents ID.
 */
export function findWindowByWebContentsId(webContentsId: number): DimensionsWindow | undefined {
  for (const dimWin of windows.values()) {
    if (dimWin.browserWindow.webContents.id === webContentsId) return dimWin
    if (dimWin.sceneWCV.webContents.id === webContentsId) return dimWin
    for (const wcv of dimWin.portalWCVs.values()) {
      if (wcv.webContents.id === webContentsId) return dimWin
    }
  }
  return undefined
}

/**
 * Find the DimensionsWindow for a given BrowserWindow.
 */
export function findWindowByBrowserWindow(bw: BrowserWindow): DimensionsWindow | undefined {
  for (const dimWin of windows.values()) {
    if (dimWin.browserWindow === bw) return dimWin
  }
  return undefined
}

/**
 * Get all tracked windows.
 */
export function getAllWindows(): DimensionsWindow[] {
  return Array.from(windows.values())
}

// ── Scene WCV creation ──

function createSceneWCV(browserWindow: BrowserWindow): WebContentsView {
  const wcv = new WebContentsView({
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: getPreloadPath('scene'),
    },
  })

  // Rule 1: Attach WCV to window BEFORE setting bounds
  browserWindow.contentView.addChildView(wcv)

  // Set initial bounds to fill the window content area
  const [width, height] = browserWindow.getContentSize()
  const bounds = { x: 0, y: 0, width, height }
  wcv.setBounds(bounds)

  // Rule 3: Check for zero-size bounds
  const actualBounds = wcv.getBounds()
  if (actualBounds.width === 0 || actualBounds.height === 0) {
    console.warn('Scene WCV has zero-size bounds after setBounds:', actualBounds)
  }

  return wcv
}

// ── Portal WCV creation (pre-warmed, no preload) ──

function createPortalWCV(): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      // NO preload — portals get no SDK access
    },
  })
}

// ── Cleanup ──

function cleanupWCV(wcv: WebContentsView): void {
  // Rule 4: Clean up audio/video before destroying
  try {
    wcv.webContents.setAudioMuted(true)
    wcv.webContents.executeJavaScript(
      'document.querySelectorAll("video,audio").forEach(el => { el.pause(); el.src = ""; })',
    ).catch(() => {})
  } catch {
    // webContents may already be destroyed
  }
}

// ── Window creation ──

export function createWindow(db: Database): DimensionsWindow {
  const windowId = `win-${++windowCounter}`

  const browserWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: getPreloadPath('renderer'),
    },
  })

  const sceneWCV = createSceneWCV(browserWindow)
  const prewarmedWCV = createPortalWCV()

  const dimWin: DimensionsWindow = {
    id: windowId,
    browserWindow,
    sceneWCV,
    portalWCVs: new Map(),
    prewarmedWCV,
    currentScene: null,
    editMode: false,
  }

  windows.set(windowId, dimWin)

  // Rule 2: Use 'resized' event, NOT 'resize'
  // Store listener references for cleanup
  const onBoundsUpdate = () => updateSceneWCVBounds(dimWin)

  browserWindow.on('resized', onBoundsUpdate)
  browserWindow.on('maximize', onBoundsUpdate)
  browserWindow.on('unmaximize', onBoundsUpdate)
  browserWindow.on('enter-full-screen', onBoundsUpdate)
  browserWindow.on('leave-full-screen', onBoundsUpdate)

  browserWindow.on('ready-to-show', () => {
    browserWindow.maximize()
    browserWindow.show()
  })

  // Cleanup on close
  browserWindow.on('closed', () => {
    // Remove event listeners
    browserWindow.removeListener('resized', onBoundsUpdate)
    browserWindow.removeListener('maximize', onBoundsUpdate)
    browserWindow.removeListener('unmaximize', onBoundsUpdate)
    browserWindow.removeListener('enter-full-screen', onBoundsUpdate)
    browserWindow.removeListener('leave-full-screen', onBoundsUpdate)

    // Cleanup WCVs
    cleanupWCV(sceneWCV)
    for (const portalWcv of dimWin.portalWCVs.values()) {
      cleanupWCV(portalWcv)
    }
    if (dimWin.prewarmedWCV) {
      cleanupWCV(dimWin.prewarmedWCV)
    }
    // Destroy terminals for this window
    destroyTerminalsForWindow(windowId)

    windows.delete(windowId)

    // If this was the last window's scene, stop watching
    if (windows.size === 0) {
      stopWatching()
    }
  })

  // Load renderer
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    browserWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    browserWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return dimWin
}

// ── Scene loading into a window ──

export function loadSceneIntoWindow(dimWin: DimensionsWindow, scenePath: string, dimensionId: string | null = null): void {
  // Rule 6: Check window isn't destroyed
  if (dimWin.browserWindow.isDestroyed()) return

  try {
    const scene = loadSceneFromDisk(scenePath, dimensionId)
    dimWin.currentScene = scene

    // Initial build of all custom widgets (async, non-blocking)
    // Uses widgetDir from WidgetState — no scanning needed
    const widgetBuildPromises = Array.from(scene.widgets.values())
      .filter((w) => w.manifest.type === 'custom')
      .map(async (w) => {
        const srcDir = path.join(w.widgetDir, 'src')
        await buildWidget(srcDir)
      })

    // Wait for initial builds, then generate scene HTML and load
    Promise.all(widgetBuildPromises).then(() => {
      if (dimWin.browserWindow.isDestroyed()) return

      // Re-load scene to pick up newly built bundles
      const updatedScene = loadSceneFromDisk(scenePath, dimensionId)
      dimWin.currentScene = updatedScene

      const html = generateSceneHtml(updatedScene)
      const htmlPath = writeSceneHtml(scenePath, html)
      const sceneRelative = path.relative(DIMENSIONS_DIR, htmlPath)
      const sceneUrl = `dimensions-asset://${sceneRelative.split(path.sep).join('/')}`

      dimWin.sceneWCV.webContents.loadURL(sceneUrl)
    }).catch((err) => {
      console.error('Widget initial build error:', err)
    })

    // Also generate and load scene HTML immediately (widgets may show placeholders initially)
    const html = generateSceneHtml(scene)
    const htmlPath = writeSceneHtml(scenePath, html)
    const sceneRelative = path.relative(DIMENSIONS_DIR, htmlPath)
    const sceneUrl = `dimensions-asset://${sceneRelative.split(path.sep).join('/')}`
    dimWin.sceneWCV.webContents.loadURL(sceneUrl)

    // Start watching this scene for file changes
    watchScene(scenePath, {
      onWidgetBuilt: (widgetId, success, error) => {
        if (dimWin.browserWindow.isDestroyed()) return

        if (success) {
          // Notify scene WCV to reload the widget iframe
          dimWin.sceneWCV.webContents.send('scene:widget-reload', widgetId)

          // Also regenerate scene HTML in case widgets changed
          if (dimWin.currentScene) {
            const updatedScene = loadSceneFromDisk(scenePath, dimensionId)
            dimWin.currentScene = updatedScene
          }
        } else {
          console.error(`Widget ${widgetId} build failed:`, error)
        }

        // Notify renderer of build status
        if (!dimWin.browserWindow.isDestroyed()) {
          dimWin.browserWindow.webContents.send('widget:build-status', sanitizeIpcData({
            widgetId,
            success,
            error,
          }))
        }
      },
    })
  } catch (err) {
    console.error(`Failed to load scene at ${scenePath}:`, err)
  }
}

// ── WCV bounds management ──

// Layout constants (must match renderer CSS vars)
const TOPBAR_HEIGHT = 40
const EDITOR_PANEL_WIDTH = 420

function updateSceneWCVBounds(dimWin: DimensionsWindow): void {
  if (dimWin.browserWindow.isDestroyed()) return

  const [width, height] = dimWin.browserWindow.getContentSize()

  let bounds: { x: number; y: number; width: number; height: number }

  if (dimWin.editMode) {
    // In edit mode: scene WCV shrinks to make room for top bar and editor panel
    bounds = {
      x: 0,
      y: TOPBAR_HEIGHT,
      width: Math.max(0, width - EDITOR_PANEL_WIDTH),
      height: Math.max(0, height - TOPBAR_HEIGHT),
    }
  } else {
    // In use mode: scene fills the window
    bounds = { x: 0, y: 0, width, height }
  }

  dimWin.sceneWCV.setBounds(bounds)

  // Rule 3: Verify bounds
  const actual = dimWin.sceneWCV.getBounds()
  if (actual.width === 0 || actual.height === 0) {
    console.warn('Scene WCV zero-size after resize:', actual)
  }
}

// ── Scene cleanup ──

export function cleanupPortalsForWindow(dimWin: DimensionsWindow): void {
  for (const [, wcv] of dimWin.portalWCVs) {
    cleanupWCV(wcv)
    if (!dimWin.browserWindow.isDestroyed()) {
      dimWin.browserWindow.contentView.removeChildView(wcv)
    }
  }
  dimWin.portalWCVs.clear()
}

// ── Edit mode ──

export function toggleEditMode(dimWin: DimensionsWindow): boolean {
  dimWin.editMode = !dimWin.editMode

  if (!dimWin.browserWindow.isDestroyed()) {
    dimWin.browserWindow.webContents.send('edit-mode', dimWin.editMode)
    dimWin.sceneWCV.webContents.send('scene:edit-mode', dimWin.editMode)
  }

  for (const portalWcv of dimWin.portalWCVs.values()) {
    portalWcv.webContents.setIgnoreMouseEvents(dimWin.editMode)
  }

  updateSceneWCVBounds(dimWin)
  return dimWin.editMode
}

// ── IPC registration ──

export function registerWindowIpcHandlers(): void {
  // Get current scene info
  ipcMain.handle('get-current-scene', (event) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin?.currentScene) return null
    return sanitizeIpcData({
      id: dimWin.currentScene.id,
      slug: dimWin.currentScene.slug,
      title: dimWin.currentScene.meta.title,
      path: dimWin.currentScene.path,
      dimensionId: dimWin.currentScene.dimensionId,
      widgets: dimWin.currentScene.meta.widgets,
      theme: dimWin.currentScene.meta.theme,
    })
  })

  // Navigate
  ipcMain.handle('navigate', (event, rawUrl: unknown) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return { error: 'window_not_found' }

    // Sanitize input — must be a string
    if (typeof rawUrl !== 'string') return { error: 'invalid_url' }
    const url = rawUrl

    // Import lazily to avoid circular deps
    const { resolveRoute } = require('./protocol')
    const route = resolveRoute(url)

    if (route.type === 'scene') {
      // Clean up old scene resources before loading new one
      destroyTerminalsForWindow(dimWin.id)
      cleanupPortalsForWindow(dimWin)

      loadSceneIntoWindow(dimWin, route.scenePath, route.dimensionId)
      return { success: true }
    }

    if (route.type === 'app') {
      // App routes handled by the renderer
      dimWin.browserWindow.webContents.send('app:navigate', route.route)
      return { success: true }
    }

    return { error: 'not_found' }
  })

  // Toggle edit mode (called from IPC and global shortcut)
  ipcMain.handle('toggle-edit-mode', (event) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return
    return toggleEditMode(dimWin)
  })
}
