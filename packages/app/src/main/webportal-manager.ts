import { WebContentsView, ipcMain, shell, Menu, MenuItem, Notification, app } from 'electron'
import fs from 'fs'
import path from 'path'
import { ulid } from 'ulid'
import { SECURE_WEB_PREFERENCES, DIMENSIONS_DIR } from './constants'
import { extractAndSaveStylesheets, applyPortalRules } from './css-injection'
import type { DimensionsWindow } from './window-manager'
import type { WidgetState } from './scene-manager'
import type { Bounds } from './schemas'

// ── Late-bound window getter (avoids circular dependency with window-manager) ──

let _getAllWindows: (() => DimensionsWindow[]) | null = null

export function setWindowGetter(fn: () => DimensionsWindow[]): void {
  _getAllWindows = fn
}

function getAllWindows(): DimensionsWindow[] {
  if (!_getAllWindows) throw new Error('webportal-manager: window getter not initialized')
  return _getAllWindows()
}

// ── Types ──

export interface TabState {
  id: string
  contentWCV: WebContentsView
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  isPlayingAudio: boolean
}

// Extract the owning widget ID from a portal key.
// Standalone: "widgetId" → "widgetId"
// Compound child: "compoundId:childId" → "compoundId"
function ownerWidgetId(portalKey: string): string {
  const i = portalKey.indexOf(':')
  return i !== -1 ? portalKey.substring(0, i) : portalKey
}

export interface PortalInstance {
  widgetId: string
  widgetDir: string
  tabs: Map<string, TabState>
  activeTabId: string
  injectedCSS: Map<string, string>
}

// ── Portal registry ──

const portals = new Map<string, PortalInstance>()

export function getPortal(id: string): PortalInstance | undefined {
  return portals.get(id)
}

// ── Pre-warmed content WCV pool (one per window) ──

const prewarmedContentWCVs = new Map<string, WebContentsView>()

function createContentWCV(): WebContentsView {
  return new WebContentsView({
    webPreferences: {
      ...SECURE_WEB_PREFERENCES,
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
    setTimeout(() => warmContentWCV(dimWin), 0)
    return existing
  }
  return createContentWCV()
}

// ── Bounds calculation ──

interface SceneBounds {
  x: number
  y: number
  width?: number
  height?: number
  scrollX?: number
  scrollY?: number
}

const MIN_VISIBLE_SIZE = 40

function calculatePortalBounds(
  widgetBounds: Bounds,
  scene: SceneBounds,
  scale: number = 1,
): { bounds: Electron.Rectangle; hidden: boolean } {
  const scrollX = scene.scrollX || 0
  const scrollY = scene.scrollY || 0

  let absX = Math.round(widgetBounds.x * scale + scene.x - scrollX)
  let absY = Math.round(widgetBounds.y * scale + scene.y - scrollY)
  let width = Math.round(widgetBounds.width * scale)
  let height = Math.round(widgetBounds.height * scale)

  // Clamp to scene edges
  if (absX < scene.x) {
    width -= scene.x - absX
    absX = scene.x
  }
  if (absY < scene.y) {
    height -= scene.y - absY
    absY = scene.y
  }
  if (scene.width != null) {
    const maxRight = scene.x + scene.width
    if (absX + width > maxRight) width = maxRight - absX
  }
  if (scene.height != null) {
    const maxBottom = scene.y + scene.height
    if (absY + height > maxBottom) height = maxBottom - absY
  }

  const hidden = width < MIN_VISIBLE_SIZE || height < MIN_VISIBLE_SIZE

  return {
    bounds: { x: absX, y: absY, width: Math.max(0, width), height: Math.max(0, height) },
    hidden,
  }
}

// ── Tab helpers ──

function getHostname(url: string): string {
  try { return new URL(url).hostname } catch { return '' }
}

// ── Portal state notifications ──
// When portal state changes, notify subscribing widgets via the scene WCV.

function getPortalState(portal: PortalInstance) {
  const tab = portal.tabs.get(portal.activeTabId)
  return {
    url: tab?.url ?? '',
    title: tab?.title ?? '',
    isLoading: tab?.isLoading ?? false,
    canGoBack: tab?.canGoBack ?? false,
    canGoForward: tab?.canGoForward ?? false,
    isPlayingAudio: tab?.isPlayingAudio ?? false,
    activeTabId: portal.activeTabId,
    tabs: Array.from(portal.tabs.entries()).map(([id, t]) => ({
      id,
      url: t.url,
      title: t.title,
      isLoading: t.isLoading,
      canGoBack: t.canGoBack,
      canGoForward: t.canGoForward,
      isActive: id === portal.activeTabId,
    })),
  }
}

function notifyPortalStateChange(portal: PortalInstance): void {
  const fullId = portal.widgetId
  const ownerId = ownerWidgetId(fullId)
  const colonIdx = fullId.indexOf(':')
  const shortId = colonIdx !== -1 ? fullId.substring(colonIdx + 1) : fullId

  for (const dimWin of getAllWindows()) {
    if (!dimWin.currentScene?.widgets.has(ownerId)) continue
    if (dimWin.sceneWCV.webContents.isDestroyed()) continue

    // Only send to widgets authorized to control this portal
    const authorizedWidgetIds: string[] = []
    for (const [wid, ws] of dimWin.currentScene.widgets) {
      if (!ws.manifest.capabilities.includes('portal-control')) continue
      const targets = ws.manifest.targetPortals ?? []
      if (targets.some(t => fullId === t || fullId.endsWith(':' + t) || shortId === t)) {
        authorizedWidgetIds.push(wid)
      }
    }
    // The owning compound widget is always authorized
    if (ownerId !== fullId && !authorizedWidgetIds.includes(ownerId)) {
      authorizedWidgetIds.push(ownerId)
    }
    if (authorizedWidgetIds.length === 0) break

    dimWin.sceneWCV.webContents.send('scene:portal-state-update', {
      portalId: fullId,
      shortPortalId: shortId,
      state: getPortalState(portal),
      targetWidgetIds: authorizedWidgetIds,
    })
    break
  }
}

// ── CSS injection helpers ──

async function injectCSSForTab(tab: TabState, portal: PortalInstance): Promise<void> {
  const wc = tab.contentWCV.webContents
  if (wc.isDestroyed()) return
  const hostname = getHostname(tab.url)
  if (!hostname) return
  await applyPortalRules(wc, portal.widgetDir, hostname).catch(() => {})
}

async function extractCSSForTab(tab: TabState, portal: PortalInstance): Promise<void> {
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

  wc.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url).catch(() => {})
      }
    } catch {}
    return { action: 'deny' }
  })

  wc.on('did-start-navigation', (_event, url) => {
    if (wc.isDestroyed()) return
    tab.url = url
    tab.isLoading = true
    tab.canGoBack = wc.navigationHistory.canGoBack()
    tab.canGoForward = wc.navigationHistory.canGoForward()
    if (tab.id === portal.activeTabId) notifyPortalStateChange(portal)
  })

  wc.on('did-navigate', (_event, url) => {
    if (wc.isDestroyed()) return
    tab.url = url
    tab.canGoBack = wc.navigationHistory.canGoBack()
    tab.canGoForward = wc.navigationHistory.canGoForward()
    if (tab.id === portal.activeTabId) notifyPortalStateChange(portal)
  })

  wc.on('did-navigate-in-page', (_event, url) => {
    if (wc.isDestroyed()) return
    tab.url = url
    tab.canGoBack = wc.navigationHistory.canGoBack()
    tab.canGoForward = wc.navigationHistory.canGoForward()
    if (tab.id === portal.activeTabId) notifyPortalStateChange(portal)
  })

  wc.on('page-title-updated', (_event, title) => {
    if (wc.isDestroyed()) return
    tab.title = title
    notifyPortalStateChange(portal)
  })

  wc.on('dom-ready', () => {
    if (wc.isDestroyed()) return
    injectCSSForTab(tab, portal).catch(() => {})
  })

  wc.on('did-finish-load', () => {
    if (wc.isDestroyed()) return
    tab.isLoading = false
    tab.canGoBack = wc.navigationHistory.canGoBack()
    tab.canGoForward = wc.navigationHistory.canGoForward()
    if (tab.id === portal.activeTabId) notifyPortalStateChange(portal)
    extractCSSForTab(tab, portal).catch(() => {})
  })

  wc.on('did-fail-load', () => {
    if (wc.isDestroyed()) return
    tab.isLoading = false
    if (tab.id === portal.activeTabId) notifyPortalStateChange(portal)
  })

  wc.on('media-started-playing', () => {
    if (wc.isDestroyed()) return
    tab.isPlayingAudio = true
    notifyPortalStateChange(portal)
  })

  wc.on('media-paused', () => {
    if (wc.isDestroyed()) return
    tab.isPlayingAudio = false
    notifyPortalStateChange(portal)
  })

  // ── Copy/paste: let standard editing shortcuts pass through to Chromium ──
  wc.on('before-input-event', (_event, input) => {
    if (input.meta || input.control) {
      const key = input.key.toLowerCase()
      if (['c', 'v', 'x', 'a', 'z'].includes(key)) {
        return // Don't prevent default — Chromium handles natively
      }
    }
  })

  // ── Downloads: auto-save to ~/Downloads with notification ──
  wc.session.on('will-download', (_event, item) => {
    const defaultPath = path.join(app.getPath('downloads'), item.getFilename())
    item.setSavePath(defaultPath)

    item.on('done', (_e, state) => {
      if (state === 'completed') {
        new Notification({
          title: 'Download Complete',
          body: item.getFilename(),
        }).show()
      }
    })
  })

  // ── Right-click context menu ──
  wc.on('context-menu', (_event, params) => {
    const menu = new Menu()

    if (params.selectionText) {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
    }
    if (params.linkURL) {
      menu.append(new MenuItem({
        label: 'Open Link in Browser',
        click: () => shell.openExternal(params.linkURL).catch(() => {}),
      }))
    }
    if (params.srcURL && params.mediaType === 'image') {
      menu.append(new MenuItem({
        label: 'Save Image',
        click: () => { if (!wc.isDestroyed()) wc.downloadURL(params.srcURL) },
      }))
    }
    if (params.isEditable) {
      menu.append(new MenuItem({ label: 'Cut', role: 'cut' }))
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }))
    }

    if (menu.items.length > 0) {
      menu.popup()
    }
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

  if (!dimWin.browserWindow.isDestroyed()) {
    dimWin.browserWindow.contentView.addChildView(contentWCV)

    const rect = portalRect(dimWin, portal.widgetId)
    if (rect) contentWCV.setBounds(rect)
  }

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
  try { dimWin.browserWindow.contentView.removeChildView(tab.contentWCV) } catch {}
}

function closeTabInternal(
  portal: PortalInstance,
  tabId: string,
  dimWin: DimensionsWindow,
): void {
  const tab = portal.tabs.get(tabId)
  if (!tab) return

  destroyTabWCV(tab, dimWin)
  portal.tabs.delete(tabId)

  if (portal.tabs.size === 0) return

  if (portal.activeTabId === tabId) {
    const tabIds = Array.from(portal.tabs.keys())
    portal.activeTabId = tabIds[tabIds.length - 1]

    const newActiveTab = portal.tabs.get(portal.activeTabId)
    if (newActiveTab && !dimWin.browserWindow.isDestroyed()) {
      try { dimWin.browserWindow.contentView.removeChildView(newActiveTab.contentWCV) } catch {}
      dimWin.browserWindow.contentView.addChildView(newActiveTab.contentWCV)

      const rect = portalRect(dimWin, portal.widgetId)
      if (rect) newActiveTab.contentWCV.setBounds(rect)
    }

    notifyPortalStateChange(portal)
  }
}

export function switchPortalTab(
  portal: PortalInstance,
  tabId: string,
  dimWin: DimensionsWindow,
): void {
  if (!portal.tabs.has(tabId)) return
  if (portal.activeTabId === tabId) return

  const oldTab = portal.tabs.get(portal.activeTabId)
  const newTab = portal.tabs.get(tabId)
  if (!newTab) return

  if (oldTab && !dimWin.browserWindow.isDestroyed()) {
    try { dimWin.browserWindow.contentView.removeChildView(oldTab.contentWCV) } catch {}
    if (!oldTab.isPlayingAudio) {
      try { oldTab.contentWCV.webContents.setBackgroundThrottling(true) } catch {}
    }
  }

  portal.activeTabId = tabId

  if (!dimWin.browserWindow.isDestroyed()) {
    try { dimWin.browserWindow.contentView.removeChildView(newTab.contentWCV) } catch {}
    dimWin.browserWindow.contentView.addChildView(newTab.contentWCV)

    const rect = portalRect(dimWin, portal.widgetId)
    if (rect) newTab.contentWCV.setBounds(rect)

    try { newTab.contentWCV.webContents.setBackgroundThrottling(false) } catch {}
  }

  notifyPortalStateChange(portal)
}

// ── Exported tab management for capability module ──

export function createPortalTab(
  portalId: string,
  url: string,
): string | null {
  const portal = portals.get(portalId)
  if (!portal) return null

  const ownerId = ownerWidgetId(portal.widgetId)

  for (const dimWin of getAllWindows()) {
    if (!dimWin.currentScene?.widgets.has(ownerId)) continue

    const oldTab = portal.tabs.get(portal.activeTabId)
    if (oldTab && !dimWin.browserWindow.isDestroyed()) {
      try { dimWin.browserWindow.contentView.removeChildView(oldTab.contentWCV) } catch {}
    }

    const newTab = createTab(portal, dimWin, url || 'about:blank')
    portal.activeTabId = newTab.id
    notifyPortalStateChange(portal)
    return newTab.id
  }
  return null
}

export function closePortalTab(
  portalId: string,
  tabId: string,
): boolean {
  const portal = portals.get(portalId)
  if (!portal) return false
  if (portal.tabs.size <= 1) return false
  if (!portal.tabs.has(tabId)) return false

  const ownerId = ownerWidgetId(portal.widgetId)

  for (const dimWin of getAllWindows()) {
    if (!dimWin.currentScene?.widgets.has(ownerId)) continue
    closeTabInternal(portal, tabId, dimWin)
    return true
  }
  return false
}

// ── Widget bounds helper ──

interface ResolvedBounds {
  bounds: Bounds
  isScreenCoords: boolean
}

function resolveWidgetBounds(dimWin: DimensionsWindow, widgetId: string): ResolvedBounds | null {
  if (!dimWin.currentScene) return null
  const reported = dimWin.layoutWidgetBounds.get(widgetId)
  if (reported) return { bounds: reported, isScreenCoords: true }
  const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === widgetId)
  if (entry?.bounds) return { bounds: entry.bounds, isScreenCoords: false }
  return null
}

/** Calculate portal WCV rect in window coordinates. */
function portalRect(dimWin: DimensionsWindow, portalWidgetId: string): Electron.Rectangle | null {
  const resolved = resolveWidgetBounds(dimWin, portalWidgetId)
  if (!resolved) return null
  const sceneRect = dimWin.sceneWCV.getBounds()
  if (resolved.isScreenCoords) {
    // Already screen-relative — just offset by scene WCV position, no scale/scroll
    const { bounds } = calculatePortalBounds(resolved.bounds, { ...sceneRect, scrollX: 0, scrollY: 0 }, 1)
    return bounds
  }
  // Design-space coords — apply scale (no scroll for point-in-time positioning)
  const { bounds } = calculatePortalBounds(resolved.bounds, sceneRect, dimWin.totalScale)
  return bounds
}

// ── Public API ──

/**
 * Mount a single webportal widget — just a content WCV, no chrome.
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

  if (portals.has(widgetInstanceId)) {
    destroyPortal(dimWin, widgetInstanceId)
  }

  const portal: PortalInstance = {
    widgetId: widgetInstanceId,
    widgetDir: widget.widgetDir,
    tabs: new Map(),
    activeTabId: '',
    injectedCSS: new Map(),
  }

  portals.set(widgetInstanceId, portal)

  const sceneBounds = dimWin.sceneWCV.getBounds()
  const { bounds } = calculatePortalBounds(widgetBounds, sceneBounds, dimWin.totalScale)

  const tab = createTab(portal, dimWin, widget.manifest.url)
  portal.activeTabId = tab.id

  tab.contentWCV.setBounds(bounds)

  dimWin.portalWCVs.set(widgetInstanceId, tab.contentWCV)
}

/**
 * Mount a compound child webportal.
 * Uses `compoundId:childId` as the portal key.
 * Initial bounds are set offscreen — repositioned via reportWidgetBounds from ResizeObserver.
 */
export function mountCompoundChildPortal(
  dimWin: DimensionsWindow,
  compoundInstanceId: string,
  childId: string,
  url: string,
  widget: WidgetState,
): void {
  if (dimWin.browserWindow.isDestroyed()) return

  const portalKey = `${compoundInstanceId}:${childId}`

  if (portals.has(portalKey)) {
    destroyPortal(dimWin, portalKey)
  }

  const portal: PortalInstance = {
    widgetId: portalKey,
    widgetDir: widget.widgetDir,
    tabs: new Map(),
    activeTabId: '',
    injectedCSS: new Map(),
  }

  portals.set(portalKey, portal)

  const tab = createTab(portal, dimWin, url)
  portal.activeTabId = tab.id

  // Start offscreen — repositioned when ResizeObserver reports bounds
  tab.contentWCV.setBounds({ x: -9999, y: -9999, width: 0, height: 0 })
  dimWin.portalWCVs.set(portalKey, tab.contentWCV)
}

/**
 * Mount all webportal widgets for the current scene (standalone + compound children).
 */
export function mountAllWebportals(dimWin: DimensionsWindow): void {
  if (!dimWin.currentScene) return

  for (const entry of dimWin.currentScene.meta.widgets) {
    const widget = dimWin.currentScene.widgets.get(entry.id)
    if (!widget) continue

    if (widget.manifest.type === 'webportal') {
      const bounds = entry.bounds ?? { x: 0, y: 0, width: 400, height: 300 }
      mountWebportal(dimWin, entry.id, widget, bounds)
    } else if (widget.manifest.type === 'compound' && widget.manifest.children) {
      for (const child of widget.manifest.children) {
        if (child.type === 'webportal' && child.url) {
          mountCompoundChildPortal(dimWin, entry.id, child.id, child.url, widget)
        }
      }
    }
  }
}

// ── Scroll tracking ──

const sceneScrollOffsets = new Map<string, { scrollX: number; scrollY: number }>()

export function setSceneScroll(dimWin: DimensionsWindow, scrollX: number, scrollY: number): void {
  sceneScrollOffsets.set(dimWin.id, { scrollX, scrollY })
  repositionPortals(dimWin)
}

/**
 * Recalculate and apply bounds for all portals in a window.
 */
export function repositionPortals(dimWin: DimensionsWindow): void {
  if (dimWin.browserWindow.isDestroyed() || !dimWin.currentScene) return

  const rawBounds = dimWin.sceneWCV.getBounds()
  const scroll = sceneScrollOffsets.get(dimWin.id) || { scrollX: 0, scrollY: 0 }
  const sceneBounds: SceneBounds = { ...rawBounds, ...scroll }
  const isLayoutMode = dimWin.currentScene.layoutMode === 'layout'

  // Collect all portal IDs to reposition (standalone + compound children)
  const portalIds: string[] = []
  for (const entry of dimWin.currentScene.meta.widgets) {
    const widget = dimWin.currentScene.widgets.get(entry.id)
    if (!widget) continue
    if (widget.manifest.type === 'webportal') {
      portalIds.push(entry.id)
    } else if (widget.manifest.type === 'compound' && widget.manifest.children) {
      for (const child of widget.manifest.children) {
        if (child.type === 'webportal') {
          portalIds.push(`${entry.id}:${child.id}`)
        }
      }
    }
  }

  // Scene bounds without scroll — for layoutWidgetBounds entries whose coords
  // already account for scroll (they come from getBoundingClientRect).
  const sceneBoundsNoScroll: SceneBounds = { ...rawBounds, scrollX: 0, scrollY: 0 }

  for (const portalId of portalIds) {
    const portal = portals.get(portalId)
    if (!portal) continue

    let widgetBounds: Bounds | undefined
    let scale: number
    let usedSceneBounds: SceneBounds

    // Compound child portals and layout mode portals use layoutWidgetBounds.
    // These bounds are from getBoundingClientRect (WCV-viewport coords, already scroll-adjusted).
    // Don't subtract scroll again.
    const layoutBounds = dimWin.layoutWidgetBounds.get(portalId)
    if (layoutBounds) {
      widgetBounds = layoutBounds
      scale = 1
      usedSceneBounds = sceneBoundsNoScroll
    } else if (!portalId.includes(':')) {
      // Standalone portal in canvas mode — design-space coords, needs scroll + scale
      const entry = dimWin.currentScene.meta.widgets.find((w) => w.id === portalId)
      if (!entry) continue
      widgetBounds = entry.bounds ?? { x: 0, y: 0, width: 400, height: 300 }
      scale = dimWin.totalScale
      usedSceneBounds = sceneBounds
    } else {
      continue
    }

    const { bounds, hidden } = calculatePortalBounds(widgetBounds, usedSceneBounds, scale)

    const activeTab = portal.tabs.get(portal.activeTabId)
    if (!activeTab) continue

    if (hidden) {
      activeTab.contentWCV.setBounds({ x: -9999, y: -9999, width: 0, height: 0 })
    } else {
      activeTab.contentWCV.setBounds(bounds)
    }
  }
}

/**
 * Destroy a single portal and all its tabs.
 */
export function destroyPortal(dimWin: DimensionsWindow, widgetId: string): void {
  const portal = portals.get(widgetId)
  if (!portal) return

  for (const [, tab] of portal.tabs) {
    destroyTabWCV(tab, dimWin)
  }
  portal.tabs.clear()

  portals.delete(widgetId)
  dimWin.portalWCVs.delete(widgetId)
}

/**
 * Destroy all portals for a window.
 */
export function destroyAllPortals(dimWin: DimensionsWindow): void {
  if (!dimWin.currentScene) return

  // Collect all portal IDs belonging to this scene (standalone + compound children)
  const portalIdsToDestroy: string[] = []
  for (const [portalId] of portals) {
    // Standalone portal: key matches a widget ID in the scene
    if (dimWin.currentScene.widgets.has(portalId)) {
      portalIdsToDestroy.push(portalId)
      continue
    }
    // Compound child: key is "compoundId:childId"
    const colonIdx = portalId.indexOf(':')
    if (colonIdx !== -1) {
      const compoundId = portalId.substring(0, colonIdx)
      if (dimWin.currentScene.widgets.has(compoundId)) {
        portalIdsToDestroy.push(portalId)
      }
    }
  }

  for (const portalId of portalIdsToDestroy) {
    destroyPortal(dimWin, portalId)
  }

  const prewarmed = prewarmedContentWCVs.get(dimWin.id)
  if (prewarmed) {
    try {
      const wc = prewarmed.webContents
      if (!wc.isDestroyed()) wc.setAudioMuted(true)
    } catch {}
    prewarmedContentWCVs.delete(dimWin.id)
  }
}

// ── Edit mode freeze ──

const FREEZE_CSS = `
  body::after {
    content: '';
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    background: rgba(0,0,0,0.12);
    cursor: default;
  }
`

function freezeJS(widgetId: string): string {
  return `
    (function() {
      if (document.getElementById('__dim_freeze_overlay')) return;
      var overlay = document.createElement('div');
      overlay.id = '__dim_freeze_overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:default;';
      overlay.addEventListener('mousedown', function(e) {
        e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      }, true);
      overlay.addEventListener('click', function(e) {
        e.preventDefault(); e.stopPropagation();
      }, true);
      document.documentElement.appendChild(overlay);
    })();
  `
}

const UNFREEZE_JS = `
  (function() {
    var el = document.getElementById('__dim_freeze_overlay');
    if (el) el.remove();
  })();
`

const frozenState = new Map<string, {
  cssKeys: string[]
  listeners: Array<() => void>
}>()

function injectFreeze(wc: Electron.WebContents, widgetId: string, cssKeys: string[]): void {
  if (wc.isDestroyed()) return
  wc.insertCSS(FREEZE_CSS).then((key) => cssKeys.push(key)).catch(() => {})
  wc.executeJavaScript(freezeJS(widgetId)).catch(() => {})
}

function removeFreeze(wc: Electron.WebContents, cssKeys: string[]): void {
  if (wc.isDestroyed()) return
  for (const key of cssKeys) wc.removeInsertedCSS(key).catch(() => {})
  wc.executeJavaScript(UNFREEZE_JS).catch(() => {})
}

export function freezePortals(dimWin: DimensionsWindow, freeze: boolean): void {
  if (!dimWin.currentScene || dimWin.browserWindow.isDestroyed()) return

  // Collect all portal IDs for this scene (standalone + compound children)
  const portalIds: Array<{ portalId: string; ownerWidgetId: string }> = []
  for (const entry of dimWin.currentScene.meta.widgets) {
    const widget = dimWin.currentScene.widgets.get(entry.id)
    if (!widget) continue
    if (widget.manifest.type === 'webportal') {
      portalIds.push({ portalId: entry.id, ownerWidgetId: entry.id })
    } else if (widget.manifest.type === 'compound' && widget.manifest.children) {
      for (const child of widget.manifest.children) {
        if (child.type === 'webportal') {
          portalIds.push({ portalId: `${entry.id}:${child.id}`, ownerWidgetId: entry.id })
        }
      }
    }
  }

  for (const { portalId, ownerWidgetId } of portalIds) {
    const portal = portals.get(portalId)
    if (!portal) continue
    const widgetId = ownerWidgetId

    if (freeze) {
      const cssKeys: string[] = []
      const listeners: Array<() => void> = []

      for (const [, tab] of portal.tabs) {
        const contentWC = tab.contentWCV.webContents
        injectFreeze(contentWC, widgetId, cssKeys)

        const navHandler = () => {
          if (dimWin.editMode) {
            setTimeout(() => injectFreeze(contentWC, widgetId, cssKeys), 200)
          }
        }
        if (!contentWC.isDestroyed()) {
          contentWC.on('did-finish-load', navHandler)
          listeners.push(() => { try { contentWC.off('did-finish-load', navHandler) } catch {} })
        }
      }

      // Focus on any portal content WCV → select the widget
      const focusHandler = () => {
        if (dimWin.editMode && !dimWin.browserWindow.isDestroyed()) {
          dimWin.browserWindow.webContents.send('widget:select', widgetId)
        }
      }
      for (const [, tab] of portal.tabs) {
        const contentWC = tab.contentWCV.webContents
        if (!contentWC.isDestroyed()) {
          contentWC.on('focus', focusHandler)
          listeners.push(() => { try { contentWC.off('focus', focusHandler) } catch {} })
        }
      }

      frozenState.set(portalId, { cssKeys, listeners })
    } else {
      const state = frozenState.get(portalId)
      if (state) {
        for (const cleanup of state.listeners) cleanup()
        for (const [, tab] of portal.tabs) {
          removeFreeze(tab.contentWCV.webContents, state.cssKeys)
        }
        frozenState.delete(portalId)
      }
    }
  }
}
