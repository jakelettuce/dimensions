import { WebContentsView, ipcMain, shell } from 'electron'
import fs from 'fs'
import path from 'path'
import { ulid } from 'ulid'
import { SECURE_WEB_PREFERENCES, DIMENSIONS_DIR } from './constants'
import { extractAndSaveStylesheets, applyPortalRules } from './css-injection'
import { generatePortalChromeHtml } from './portal-chrome-html'
import type { DimensionsWindow } from './window-manager'
import type { WidgetState } from './scene-manager'
import type { Bounds } from './schemas'

// ── Constants ──

const CHROME_HEIGHT = 36

// ── Types ──

interface TabState {
  id: string
  contentWCV: WebContentsView
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isPlayingAudio: boolean
}

interface PortalInstance {
  widgetId: string
  widgetDir: string
  chromeWCV: WebContentsView
  tabs: Map<string, TabState>
  activeTabId: string
  injectedCSS: Map<string, string> // hostname -> css key, stored for reinjection on navigation
}

// ── Portal registry ──
// Keyed by widgetInstanceId, stores all portal instances across windows.

const portals = new Map<string, PortalInstance>()

// ── Pre-warmed content WCV pool (one per window) ──

const prewarmedContentWCVs = new Map<string, WebContentsView>()

function createContentWCV(): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      // NO preload — content WCVs are fully sandboxed
    },
  })
}

function createChromeWCV(): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
      preload: path.join(__dirname, '../preload/portal-chrome.js'),
    },
  })
}

export function warmContentWCV(dimWin: DimensionsWindow): void {
  if (prewarmedContentWCVs.has(dimWin.id)) return
  prewarmedContentWCVs.set(dimWin.id, createContentWCV())
}

function acquireContentWCV(dimWin: DimensionsWindow): WebContentsView {
  const existing = prewarmedContentWCVs.get(dimWin.id)
  if (existing) {
    prewarmedContentWCVs.delete(dimWin.id)
    // Replenish in background
    setTimeout(() => warmContentWCV(dimWin), 0)
    return existing
  }
  return createContentWCV()
}

// ── Bounds calculation ──

function calculatePortalBounds(
  widgetBounds: Bounds,
  sceneWCVBounds: { x: number; y: number },
): { chrome: Electron.Rectangle; content: Electron.Rectangle } {
  const absX = Math.round(widgetBounds.x + sceneWCVBounds.x)
  const absY = Math.round(widgetBounds.y + sceneWCVBounds.y)
  const width = Math.round(widgetBounds.width)
  const height = Math.round(widgetBounds.height)

  return {
    chrome: { x: absX, y: absY, width, height: CHROME_HEIGHT },
    content: {
      x: absX,
      y: absY + CHROME_HEIGHT,
      width,
      height: Math.max(0, height - CHROME_HEIGHT),
    },
  }
}

// ── Tab helpers ──

function getHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

function buildTabListForChrome(portal: PortalInstance): Array<{
  id: string
  title: string
  active: boolean
  isPlayingAudio: boolean
}> {
  const list: Array<{
    id: string
    title: string
    active: boolean
    isPlayingAudio: boolean
  }> = []
  for (const [id, tab] of portal.tabs) {
    list.push({
      id,
      title: tab.title || 'New Tab',
      active: id === portal.activeTabId,
      isPlayingAudio: tab.isPlayingAudio,
    })
  }
  return list
}

function sendNavUpdate(portal: PortalInstance): void {
  const tab = portal.tabs.get(portal.activeTabId)
  if (!tab) return
  const wc = portal.chromeWCV.webContents
  if (wc.isDestroyed()) return

  wc.send('portal:navUpdate', {
    url: tab.url,
    loading: tab.isLoading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
  })
}

function sendTabsUpdate(portal: PortalInstance): void {
  const wc = portal.chromeWCV.webContents
  if (wc.isDestroyed()) return
  wc.send('portal:tabsUpdate', buildTabListForChrome(portal))
}

// ── CSS injection helpers ──

async function injectCSSForTab(
  tab: TabState,
  portal: PortalInstance,
): Promise<void> {
  const wc = tab.contentWCV.webContents
  if (wc.isDestroyed()) return

  const hostname = getHostname(tab.url)
  if (!hostname) return

  // Apply portal-rules.json rules
  await applyPortalRules(wc, portal.widgetDir, hostname).catch(() => {})
}

async function extractCSSForTab(
  tab: TabState,
  portal: PortalInstance,
): Promise<void> {
  const wc = tab.contentWCV.webContents
  if (wc.isDestroyed()) return

  const hostname = getHostname(tab.url)
  if (!hostname) return

  await extractAndSaveStylesheets(wc, portal.widgetDir, hostname).catch(() => {})
}

// ── Content WCV event wiring ──

function wireContentWCVEvents(
  tab: TabState,
  portal: PortalInstance,
  dimWin: DimensionsWindow,
): void {
  const wc = tab.contentWCV.webContents

  // Block popups — open http/https externally, deny everything else
  wc.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url).catch(() => {})
      }
    } catch {}
    return { action: 'deny' }
  })

  // Navigation events
  wc.on('did-start-navigation', (_event, url) => {
    if (wc.isDestroyed()) return
    tab.url = url
    tab.isLoading = true
    tab.canGoBack = wc.canGoBack()
    tab.canGoForward = wc.canGoForward()
    if (tab.id === portal.activeTabId) sendNavUpdate(portal)
  })

  wc.on('did-navigate', (_event, url) => {
    if (wc.isDestroyed()) return
    tab.url = url
    tab.canGoBack = wc.canGoBack()
    tab.canGoForward = wc.canGoForward()
    if (tab.id === portal.activeTabId) sendNavUpdate(portal)
    sendTabsUpdate(portal)
  })

  wc.on('did-navigate-in-page', (_event, url) => {
    if (wc.isDestroyed()) return
    tab.url = url
    tab.canGoBack = wc.canGoBack()
    tab.canGoForward = wc.canGoForward()
    if (tab.id === portal.activeTabId) sendNavUpdate(portal)
  })

  wc.on('page-title-updated', (_event, title) => {
    if (wc.isDestroyed()) return
    tab.title = title
    sendTabsUpdate(portal)
  })

  // CSS injection on dom-ready (NOT did-finish-load)
  wc.on('dom-ready', () => {
    if (wc.isDestroyed()) return
    injectCSSForTab(tab, portal).catch(() => {})
  })

  // CSS extraction on did-finish-load
  wc.on('did-finish-load', () => {
    if (wc.isDestroyed()) return
    tab.isLoading = false
    tab.canGoBack = wc.canGoBack()
    tab.canGoForward = wc.canGoForward()
    if (tab.id === portal.activeTabId) sendNavUpdate(portal)
    extractCSSForTab(tab, portal).catch(() => {})
  })

  wc.on('did-fail-load', () => {
    if (wc.isDestroyed()) return
    tab.isLoading = false
    if (tab.id === portal.activeTabId) sendNavUpdate(portal)
  })

  // Audio state
  wc.on('media-started-playing', () => {
    if (wc.isDestroyed()) return
    tab.isPlayingAudio = true
    sendTabsUpdate(portal)
  })

  wc.on('media-paused', () => {
    if (wc.isDestroyed()) return
    tab.isPlayingAudio = false
    sendTabsUpdate(portal)
  })
}

// ── Tab management ──

function createTab(
  portal: PortalInstance,
  dimWin: DimensionsWindow,
  url: string,
): TabState {
  const contentWCV = acquireContentWCV(dimWin)
  const tabId = ulid()

  const tab: TabState = {
    id: tabId,
    contentWCV,
    url,
    title: '',
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isPlayingAudio: false,
  }

  portal.tabs.set(tabId, tab)
  wireContentWCVEvents(tab, portal, dimWin)

  // Attach the contentWCV before the chromeWCV to maintain z-order:
  // contentWCV goes below chromeWCV
  if (!dimWin.browserWindow.isDestroyed()) {
    const contentView = dimWin.browserWindow.contentView

    // Insert content WCV just before the chrome WCV to maintain z-order
    // Remove chrome temporarily, add content, re-add chrome on top
    try { contentView.removeChildView(portal.chromeWCV) } catch {}
    contentView.addChildView(contentWCV)
    contentView.addChildView(portal.chromeWCV)

    // Set bounds for the new content WCV
    const sceneBounds = dimWin.sceneWCV.getBounds()
    const widgetBounds = getWidgetBounds(dimWin, portal.widgetId)
    if (widgetBounds) {
      const bounds = calculatePortalBounds(widgetBounds, sceneBounds)
      contentWCV.setBounds(bounds.content)
    }
  }

  // Freeze if in edit mode
  if (dimWin.editMode) {
    contentWCV.webContents.setIgnoreMouseEvents(true)
  }

  // Fire-and-forget load
  contentWCV.webContents.loadURL(url).catch(() => {})

  return tab
}

function destroyTabWCV(tab: TabState, dimWin: DimensionsWindow): void {
  const wc = tab.contentWCV.webContents
  if (!wc.isDestroyed()) {
    wc.setAudioMuted(true)
    wc.executeJavaScript(
      'document.querySelectorAll("video,audio").forEach(el=>{el.pause();el.src=""})',
    ).catch(() => {})
  }
  try {
    dimWin.browserWindow.contentView.removeChildView(tab.contentWCV)
  } catch {}
}

function closeTab(
  portal: PortalInstance,
  tabId: string,
  dimWin: DimensionsWindow,
): void {
  const tab = portal.tabs.get(tabId)
  if (!tab) return

  destroyTabWCV(tab, dimWin)
  portal.tabs.delete(tabId)

  // If no tabs remain, this is unusual — the portal itself should be destroyed
  if (portal.tabs.size === 0) return

  // If closing the active tab, switch to an adjacent tab
  if (portal.activeTabId === tabId) {
    const tabIds = Array.from(portal.tabs.keys())
    portal.activeTabId = tabIds[tabIds.length - 1]

    // Show the new active tab's content WCV
    const newActiveTab = portal.tabs.get(portal.activeTabId)
    if (newActiveTab && !dimWin.browserWindow.isDestroyed()) {
      const contentView = dimWin.browserWindow.contentView
      // Re-add content WCV just before chrome WCV
      try { contentView.removeChildView(portal.chromeWCV) } catch {}
      try { contentView.removeChildView(newActiveTab.contentWCV) } catch {}
      contentView.addChildView(newActiveTab.contentWCV)
      contentView.addChildView(portal.chromeWCV)

      // Set correct bounds
      const sceneBounds = dimWin.sceneWCV.getBounds()
      const widgetBounds = getWidgetBounds(dimWin, portal.widgetId)
      if (widgetBounds) {
        const bounds = calculatePortalBounds(widgetBounds, sceneBounds)
        newActiveTab.contentWCV.setBounds(bounds.content)
      }
    }

    sendNavUpdate(portal)
  }

  sendTabsUpdate(portal)
}

function switchTab(
  portal: PortalInstance,
  tabId: string,
  dimWin: DimensionsWindow,
): void {
  if (!portal.tabs.has(tabId)) return
  if (portal.activeTabId === tabId) return

  const oldTab = portal.tabs.get(portal.activeTabId)
  const newTab = portal.tabs.get(tabId)
  if (!newTab) return

  // Hide old tab's content WCV
  if (oldTab && !dimWin.browserWindow.isDestroyed()) {
    try {
      dimWin.browserWindow.contentView.removeChildView(oldTab.contentWCV)
    } catch {}

    // Throttle inactive tab unless playing audio
    if (!oldTab.isPlayingAudio) {
      try {
        oldTab.contentWCV.webContents.setBackgroundThrottling(true)
      } catch {}
    }
  }

  portal.activeTabId = tabId

  // Show new tab's content WCV
  if (!dimWin.browserWindow.isDestroyed()) {
    const contentView = dimWin.browserWindow.contentView
    // Maintain z-order: content below chrome
    try { contentView.removeChildView(portal.chromeWCV) } catch {}
    try { contentView.removeChildView(newTab.contentWCV) } catch {}
    contentView.addChildView(newTab.contentWCV)
    contentView.addChildView(portal.chromeWCV)

    // Set correct bounds
    const sceneBounds = dimWin.sceneWCV.getBounds()
    const widgetBounds = getWidgetBounds(dimWin, portal.widgetId)
    if (widgetBounds) {
      const bounds = calculatePortalBounds(widgetBounds, sceneBounds)
      newTab.contentWCV.setBounds(bounds.content)
    }

    // Un-throttle the newly active tab
    try {
      newTab.contentWCV.webContents.setBackgroundThrottling(false)
    } catch {}
  }

  sendNavUpdate(portal)
  sendTabsUpdate(portal)
}

// ── Widget bounds helper ──

function getWidgetBounds(
  dimWin: DimensionsWindow,
  widgetId: string,
): Bounds | null {
  if (!dimWin.currentScene) return null
  const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === widgetId)
  return entry?.bounds ?? null
}

// ── Chrome WCV setup ──

function loadChromeWCV(
  chromeWCV: WebContentsView,
  portalId: string,
  dimWin: DimensionsWindow,
): void {
  const html = generatePortalChromeHtml(portalId)
  const scenePath = dimWin.currentScene?.path
  if (!scenePath) return

  // Write chrome HTML to a temp file in the scene directory
  const filename = `.portal-chrome-${portalId}.html`
  const filePath = path.join(scenePath, filename)
  fs.writeFileSync(filePath, html, 'utf-8')

  // Build dimensions-asset:// URL
  const relPath = path.relative(DIMENSIONS_DIR, filePath).split(path.sep).join('/')
  const assetUrl = `dimensions-asset://${relPath}?portalId=${encodeURIComponent(portalId)}`

  chromeWCV.webContents.loadURL(assetUrl).catch((err) => {
    console.error(`Failed to load portal chrome for ${portalId}:`, err)
  })
}

// ── Portal lookup by widgetId ──

function findPortal(widgetId: string): PortalInstance | undefined {
  return portals.get(widgetId)
}

function findPortalAndWindow(
  widgetId: string,
  allWindows: () => DimensionsWindow[],
): { portal: PortalInstance; dimWin: DimensionsWindow } | undefined {
  const portal = portals.get(widgetId)
  if (!portal) return undefined

  for (const dimWin of allWindows()) {
    if (dimWin.currentScene?.widgets.has(widgetId)) {
      return { portal, dimWin }
    }
  }
  return undefined
}

// ── Public API ──

/**
 * Mount a single webportal widget with chrome + content WCVs.
 */
export function mountWebportal(
  dimWin: DimensionsWindow,
  widgetInstanceId: string,
  widget: WidgetState,
  widgetBounds: Bounds,
): void {
  if (dimWin.browserWindow.isDestroyed()) return
  if (!widget.manifest.url) {
    console.warn(`Webportal widget "${widget.widgetType}" has no url in manifest`)
    return
  }

  // Clean up any existing portal for this widget
  if (portals.has(widgetInstanceId)) {
    destroyPortal(dimWin, widgetInstanceId)
  }

  const chromeWCV = createChromeWCV()
  const portal: PortalInstance = {
    widgetId: widgetInstanceId,
    widgetDir: widget.widgetDir,
    chromeWCV,
    tabs: new Map(),
    activeTabId: '',
    injectedCSS: new Map(),
  }

  portals.set(widgetInstanceId, portal)

  // Calculate bounds
  const sceneBounds = dimWin.sceneWCV.getBounds()
  const bounds = calculatePortalBounds(widgetBounds, sceneBounds)

  // Create the first tab (content WCV)
  const tab = createTab(portal, dimWin, widget.manifest.url)
  portal.activeTabId = tab.id

  // Attach chrome WCV AFTER content WCV (chrome must be on top)
  dimWin.browserWindow.contentView.addChildView(chromeWCV)

  // Note: createTab already added contentWCV and re-added chromeWCV,
  // but chromeWCV wasn't added yet at that point. Re-establish z-order.
  const contentView = dimWin.browserWindow.contentView
  try { contentView.removeChildView(chromeWCV) } catch {}
  try { contentView.removeChildView(tab.contentWCV) } catch {}
  contentView.addChildView(tab.contentWCV)
  contentView.addChildView(chromeWCV)

  // Set bounds
  tab.contentWCV.setBounds(bounds.content)
  chromeWCV.setBounds(bounds.chrome)

  // Track in the window's portal map (for legacy compatibility)
  dimWin.portalWCVs.set(widgetInstanceId, chromeWCV)

  // Load the chrome HTML
  loadChromeWCV(chromeWCV, widgetInstanceId, dimWin)

  // Freeze if in edit mode
  if (dimWin.editMode) {
    chromeWCV.webContents.setIgnoreMouseEvents(true)
    tab.contentWCV.webContents.setIgnoreMouseEvents(true)
  }
}

/**
 * Mount all webportal widgets for the current scene.
 */
export function mountAllWebportals(dimWin: DimensionsWindow): void {
  if (!dimWin.currentScene) return

  for (const entry of dimWin.currentScene.meta.widgets) {
    const widget = dimWin.currentScene.widgets.get(entry.id)
    if (!widget || widget.manifest.type !== 'webportal') continue
    mountWebportal(dimWin, entry.id, widget, entry.bounds)
  }
}

/**
 * Recalculate and apply bounds for all portals in a window.
 * Called when scene WCV bounds change (edit mode toggle, window resize).
 */
export function repositionPortals(dimWin: DimensionsWindow): void {
  if (dimWin.browserWindow.isDestroyed() || !dimWin.currentScene) return

  const sceneBounds = dimWin.sceneWCV.getBounds()

  for (const entry of dimWin.currentScene.meta.widgets) {
    const portal = portals.get(entry.id)
    if (!portal) continue

    const widget = dimWin.currentScene.widgets.get(entry.id)
    if (!widget || widget.manifest.type !== 'webportal') continue

    const bounds = calculatePortalBounds(entry.bounds, sceneBounds)

    // Set chrome bounds
    portal.chromeWCV.setBounds(bounds.chrome)

    // Set active tab content bounds
    const activeTab = portal.tabs.get(portal.activeTabId)
    if (activeTab) {
      activeTab.contentWCV.setBounds(bounds.content)
    }
  }
}

/**
 * Destroy a single portal and all its tabs.
 */
export function destroyPortal(dimWin: DimensionsWindow, widgetId: string): void {
  const portal = portals.get(widgetId)
  if (!portal) return

  // Destroy all tabs
  for (const [, tab] of portal.tabs) {
    destroyTabWCV(tab, dimWin)
  }
  portal.tabs.clear()

  // Remove chrome WCV
  if (!dimWin.browserWindow.isDestroyed()) {
    try {
      dimWin.browserWindow.contentView.removeChildView(portal.chromeWCV)
    } catch {}
  }
  try {
    const chromeWC = portal.chromeWCV.webContents
    if (!chromeWC.isDestroyed()) {
      chromeWC.setAudioMuted(true)
    }
  } catch {}

  // Clean up temp chrome HTML file
  if (dimWin.currentScene?.path) {
    const filename = `.portal-chrome-${widgetId}.html`
    const filePath = path.join(dimWin.currentScene.path, filename)
    try { fs.unlinkSync(filePath) } catch {}
  }

  // Remove from registries
  portals.delete(widgetId)
  dimWin.portalWCVs.delete(widgetId)
}

/**
 * Destroy all portals for a window.
 */
export function destroyAllPortals(dimWin: DimensionsWindow): void {
  if (!dimWin.currentScene) return

  // Collect widget IDs that belong to this window
  const widgetIds = Array.from(dimWin.currentScene.widgets.keys()).filter(
    (id) => portals.has(id),
  )

  for (const widgetId of widgetIds) {
    destroyPortal(dimWin, widgetId)
  }

  // Also clean up any orphaned pre-warmed WCVs for this window
  const prewarmed = prewarmedContentWCVs.get(dimWin.id)
  if (prewarmed) {
    try {
      const wc = prewarmed.webContents
      if (!wc.isDestroyed()) {
        wc.setAudioMuted(true)
      }
    } catch {}
    prewarmedContentWCVs.delete(dimWin.id)
  }
}

/**
 * Freeze or unfreeze all portal WCVs for a window (used during edit mode).
 */
export function freezePortals(dimWin: DimensionsWindow, freeze: boolean): void {
  if (!dimWin.currentScene) return

  for (const entry of dimWin.currentScene.meta.widgets) {
    const portal = portals.get(entry.id)
    if (!portal) continue

    // Freeze chrome WCV
    try {
      portal.chromeWCV.webContents.setIgnoreMouseEvents(freeze)
    } catch {}

    // Freeze all tab content WCVs
    for (const [, tab] of portal.tabs) {
      try {
        tab.contentWCV.webContents.setIgnoreMouseEvents(freeze)
      } catch {}
    }
  }
}

/**
 * Register IPC handlers for portal navigation, tab management, etc.
 * Must be called once at app startup.
 */
export function registerPortalIpcHandlers(): void {
  // Lazy import to avoid circular dependency
  const getWindows = (): DimensionsWindow[] => {
    const { getAllWindows } = require('./window-manager')
    return getAllWindows()
  }

  // Navigate the active tab to a URL
  ipcMain.handle(
    'portal:navigate',
    (_event, portalId: string, rawUrl: string) => {
      const portal = findPortal(portalId)
      if (!portal) return

      const tab = portal.tabs.get(portal.activeTabId)
      if (!tab) return

      // Normalize URL: add https:// if no protocol
      let url = rawUrl.trim()
      if (url && !url.match(/^[a-zA-Z]+:\/\//)) {
        // If it looks like a domain, add https. Otherwise treat as search.
        if (url.match(/^[^\s]+\.[^\s]+/)) {
          url = `https://${url}`
        } else {
          url = `https://www.google.com/search?q=${encodeURIComponent(url)}`
        }
      }

      tab.contentWCV.webContents.loadURL(url).catch(() => {})
    },
  )

  // Go back
  ipcMain.handle('portal:goBack', (_event, portalId: string) => {
    const portal = findPortal(portalId)
    if (!portal) return

    const tab = portal.tabs.get(portal.activeTabId)
    if (!tab) return

    const wc = tab.contentWCV.webContents
    if (!wc.isDestroyed() && wc.canGoBack()) {
      wc.goBack()
    }
  })

  // Go forward
  ipcMain.handle('portal:goForward', (_event, portalId: string) => {
    const portal = findPortal(portalId)
    if (!portal) return

    const tab = portal.tabs.get(portal.activeTabId)
    if (!tab) return

    const wc = tab.contentWCV.webContents
    if (!wc.isDestroyed() && wc.canGoForward()) {
      wc.goForward()
    }
  })

  // Reload
  ipcMain.handle('portal:reload', (_event, portalId: string) => {
    const portal = findPortal(portalId)
    if (!portal) return

    const tab = portal.tabs.get(portal.activeTabId)
    if (!tab) return

    const wc = tab.contentWCV.webContents
    if (!wc.isDestroyed()) {
      wc.reload()
    }
  })

  // Stop loading
  ipcMain.handle('portal:stop', (_event, portalId: string) => {
    const portal = findPortal(portalId)
    if (!portal) return

    const tab = portal.tabs.get(portal.activeTabId)
    if (!tab) return

    const wc = tab.contentWCV.webContents
    if (!wc.isDestroyed()) {
      wc.stop()
    }
  })

  // New tab
  ipcMain.handle(
    'portal:newTab',
    (_event, portalId: string, url?: string) => {
      const result = findPortalAndWindow(portalId, getWindows)
      if (!result) return

      const { portal, dimWin } = result
      const defaultUrl = url || 'about:blank'

      // Hide the current active tab's content WCV
      const oldTab = portal.tabs.get(portal.activeTabId)
      if (oldTab && !dimWin.browserWindow.isDestroyed()) {
        try {
          dimWin.browserWindow.contentView.removeChildView(oldTab.contentWCV)
        } catch {}
      }

      const newTab = createTab(portal, dimWin, defaultUrl)
      portal.activeTabId = newTab.id

      sendNavUpdate(portal)
      sendTabsUpdate(portal)
    },
  )

  // Close tab
  ipcMain.handle(
    'portal:closeTab',
    (_event, portalId: string, tabId: string) => {
      const result = findPortalAndWindow(portalId, getWindows)
      if (!result) return

      const { portal, dimWin } = result

      // Don't close the last tab — close the portal instead? Or keep one tab.
      if (portal.tabs.size <= 1) return

      closeTab(portal, tabId, dimWin)
    },
  )

  // Switch tab
  ipcMain.handle(
    'portal:switchTab',
    (_event, portalId: string, tabId: string) => {
      const result = findPortalAndWindow(portalId, getWindows)
      if (!result) return

      const { portal, dimWin } = result
      switchTab(portal, tabId, dimWin)
    },
  )
}
