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
import { repositionPortals, freezePortals, mountAllWebportals, destroyAllPortals, setSceneScroll } from './webportal-manager'
import { generateClaudeMd } from './claude-md'
import { resolveRoute } from './protocol'
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
  sceneSidebarOpen: boolean
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
    sceneSidebarOpen: false,
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
    // Destroy terminals and WebSocket connections for this window
    destroyTerminalsForWindow(windowId)
    // Lazy require to avoid circular dependency (websocket.ts is part of capabilities system)
    try {
      const { cleanupWebSocketsForWindow } = require('./capabilities/websocket')
      cleanupWebSocketsForWindow(windowId)
    } catch {}

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

export function loadSceneIntoWindow(dimWin: DimensionsWindow, scenePath: string, dimensionId: string | null = null, dimensionPath?: string | null): void {
  // Rule 6: Check window isn't destroyed
  if (dimWin.browserWindow.isDestroyed()) return

  try {
    const scene = loadSceneFromDisk(scenePath, dimensionId, dimensionPath)
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
      const updatedScene = loadSceneFromDisk(scenePath, dimensionId, dimensionPath)
      dimWin.currentScene = updatedScene

      const html = generateSceneHtml(updatedScene)
      const htmlPath = writeSceneHtml(scenePath, html)
      const sceneRelative = path.relative(DIMENSIONS_DIR, htmlPath)
      const sceneUrl = `dimensions-asset://${sceneRelative.split(path.sep).join('/')}`

      dimWin.sceneWCV.webContents.loadURL(sceneUrl)

      // Mount webportal widgets after scene loads
      mountAllWebportals(dimWin)

      // If in edit mode, freeze the newly mounted portals
      if (dimWin.editMode) {
        freezePortals(dimWin, true)
        // Also tell the new scene HTML it's in edit mode
        dimWin.sceneWCV.webContents.once('did-finish-load', () => {
          if (dimWin.editMode && !dimWin.sceneWCV.webContents.isDestroyed()) {
            dimWin.sceneWCV.webContents.send('scene:edit-mode', true)
          }
        })
      }

      // Generate CLAUDE.md for Claude Code context
      if (dimWin.currentScene) {
        generateClaudeMd(dimWin.currentScene)
      }
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
      onWidgetBuilt: (widgetTypeId, success, error) => {
        if (dimWin.browserWindow.isDestroyed()) return

        if (success) {
          // widgetTypeId is the manifest's human-readable ID (e.g. "test-widget")
          // We need to find all instance ULIDs that use this widget type and reload them
          if (dimWin.currentScene) {
            for (const entry of dimWin.currentScene.meta.widgets) {
              if (entry.widgetType === widgetTypeId) {
                dimWin.sceneWCV.webContents.send('scene:widget-reload', entry.id)
              }
            }

            // Regenerate scene state and CLAUDE.md
            const updatedScene = loadSceneFromDisk(scenePath, dimensionId, dimensionPath)
            dimWin.currentScene = updatedScene
            generateClaudeMd(updatedScene)
          }
        } else {
          console.error(`Widget ${widgetTypeId} build failed:`, error)
        }

        // Notify renderer of build status
        if (!dimWin.browserWindow.isDestroyed()) {
          dimWin.browserWindow.webContents.send('widget:build-status', sanitizeIpcData({
            widgetId: widgetTypeId,
            success,
            error,
          }))
        }
      },

      // meta.json or connections.json changed — reload scene
      // Skip reload in edit mode: the app itself writes meta.json on drag/resize,
      // and reloading would wipe edit state (handles, selection, interacting class).
      // Only reload when NOT in edit mode (e.g. Claude Code edited meta.json via terminal).
      onSceneMetaChanged: () => {
        if (dimWin.browserWindow.isDestroyed()) return
        if (dimWin.editMode) {
          // In edit mode: just update in-memory state without reloading scene HTML
          try {
            const updatedScene = loadSceneFromDisk(scenePath, dimensionId, dimensionPath)
            dimWin.currentScene = updatedScene
            generateClaudeMd(updatedScene)
          } catch {}
          return
        }
        try {
          const updatedScene = loadSceneFromDisk(scenePath, dimensionId, dimensionPath)
          dimWin.currentScene = updatedScene

          const html = generateSceneHtml(updatedScene)
          const htmlPath = writeSceneHtml(scenePath, html)
          const sceneRelative = path.relative(DIMENSIONS_DIR, htmlPath)
          const sceneUrl = `dimensions-asset://${sceneRelative.split(path.sep).join('/')}`

          dimWin.sceneWCV.webContents.loadURL(sceneUrl)
          generateClaudeMd(updatedScene)

          if (!dimWin.browserWindow.isDestroyed()) {
            dimWin.browserWindow.webContents.send('scene-updated', sanitizeIpcData({
              id: updatedScene.id,
              slug: updatedScene.slug,
              title: updatedScene.meta.title,
              path: updatedScene.path,
              dimensionId: updatedScene.dimensionId,
              widgets: updatedScene.meta.widgets,
              theme: updatedScene.meta.theme,
            }))
          }
        } catch (e) {
          console.error('Failed to reload scene after meta change:', e)
        }
      },
    })
  } catch (err) {
    console.error(`Failed to load scene at ${scenePath}:`, err)
  }

  // Notify renderer of scene change (breadcrumbs, title, etc.)
  if (dimWin.currentScene && !dimWin.browserWindow.isDestroyed()) {
    dimWin.browserWindow.webContents.send('scene-changed', sanitizeIpcData({
      id: dimWin.currentScene.id,
      slug: dimWin.currentScene.slug,
      title: dimWin.currentScene.meta.title,
      path: dimWin.currentScene.path,
      dimensionId: dimWin.currentScene.dimensionId,
      widgets: dimWin.currentScene.meta.widgets,
      theme: dimWin.currentScene.meta.theme,
      dimensionTitle: dimWin.currentScene.dimensionMeta?.title ?? null,
      dimensionScenes: dimWin.currentScene.dimensionMeta?.scenes ?? null,
    }))
  }
}

// ── WCV bounds management ──

// Layout constants (must match renderer CSS vars)
const TOPBAR_HEIGHT = 40
const TOOLBAR_HEIGHT = 32
const EDITOR_PANEL_WIDTH = 420
const SCENE_SIDEBAR_WIDTH = 280

export function updateSceneWCVBounds(dimWin: DimensionsWindow): void {
  if (dimWin.browserWindow.isDestroyed()) return

  const [width, height] = dimWin.browserWindow.getContentSize()

  let x = 0, y = TOPBAR_HEIGHT, w = width, h = height - TOPBAR_HEIGHT

  // Scene sidebar (left side)
  if (dimWin.sceneSidebarOpen) {
    x += SCENE_SIDEBAR_WIDTH
    w -= SCENE_SIDEBAR_WIDTH
  }

  // Edit mode (toolbar + right panel)
  if (dimWin.editMode) {
    y += TOOLBAR_HEIGHT
    h -= TOOLBAR_HEIGHT
    w -= EDITOR_PANEL_WIDTH
  }

  dimWin.sceneWCV.setBounds({ x, y, width: Math.max(w, 100), height: Math.max(h, 100) })

  // Reposition all portal WCVs to match the new scene WCV position
  repositionPortals(dimWin)
}

// ── Scene cleanup ──

export function cleanupPortalsForWindow(dimWin: DimensionsWindow): void {
  destroyAllPortals(dimWin)
  dimWin.portalWCVs.clear()
}

// ── Edit mode ──

export function toggleEditMode(dimWin: DimensionsWindow): boolean {
  dimWin.editMode = !dimWin.editMode

  if (!dimWin.browserWindow.isDestroyed()) {
    dimWin.browserWindow.webContents.send('edit-mode', dimWin.editMode)
    dimWin.sceneWCV.webContents.send('scene:edit-mode', dimWin.editMode)
  }

  // Freeze/unfreeze all portal WCVs (chrome + content)
  freezePortals(dimWin, dimWin.editMode)

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
      dimensionTitle: dimWin.currentScene.dimensionMeta?.title ?? null,
      dimensionScenes: dimWin.currentScene.dimensionMeta?.scenes ?? null,
    })
  })

  // Navigate
  ipcMain.handle('navigate', (event, rawUrl: unknown) => {
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (!dimWin) return { error: 'window_not_found' }

    // Sanitize input — must be a string
    if (typeof rawUrl !== 'string') return { error: 'invalid_url' }
    const url = rawUrl

    const route = resolveRoute(url)

    if (route.type === 'scene') {
      // Clean up old scene resources before loading new one
      destroyTerminalsForWindow(dimWin.id)
      cleanupPortalsForWindow(dimWin)

      loadSceneIntoWindow(dimWin, route.scenePath, route.dimensionId, route.dimensionPath)
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

  // Scene scroll — reposition portals to track scroll position
  ipcMain.on('scene:scroll', (event, scrollX: unknown, scrollY: unknown) => {
    if (typeof scrollX !== 'number' || typeof scrollY !== 'number') return
    const dimWin = findWindowByWebContentsId(event.sender.id)
    if (dimWin) setSceneScroll(dimWin, scrollX, scrollY)
  })
}
