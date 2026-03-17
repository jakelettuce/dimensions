import fs from 'fs'
import path from 'path'
import { ulid } from 'ulid'
import { SceneMetaSchema, WidgetManifestSchema, ConnectionsFileSchema, DimensionMetaSchema } from './schemas'
import type { SceneMeta, WidgetManifest, Connection, DimensionMeta, Theme, Viewport } from './schemas'
import { DIMENSIONS_DIR } from './constants'

// ── Widget state (runtime, not persisted) ──

export interface WidgetState {
  id: string              // ULID instance ID (unique per placement in scene)
  widgetType: string      // human-readable type from manifest (e.g. "test-widget")
  manifest: WidgetManifest
  bundlePath: string | null // absolute path to dist/bundle.html
  widgetDir: string       // absolute path to the widget directory (contains src/ and dist/)
  scenePath: string
}

// ── Scene state (runtime, not persisted) ──

export interface SceneState {
  id: string
  slug: string
  path: string
  dimensionId: string | null
  dimensionPath: string | null
  dimensionMeta: DimensionMeta | null
  meta: SceneMeta
  connections: Connection[]
  widgets: Map<string, WidgetState>
  layoutMode: 'canvas' | 'layout'
  layoutHtml: string | null
}

// ── Layout helpers ──

export function loadLayoutHtml(scenePath: string): string | null {
  const layoutPath = path.join(scenePath, 'layout.html')
  if (!fs.existsSync(layoutPath)) return null
  try {
    return fs.readFileSync(layoutPath, 'utf-8')
  } catch {
    return null
  }
}

// ── Dimension helpers ──

export function loadDimensionMeta(dimensionPath: string): DimensionMeta | null {
  const dimJsonPath = path.join(dimensionPath, 'dimension.json')
  if (!fs.existsSync(dimJsonPath)) return null
  try {
    const raw = JSON.parse(fs.readFileSync(dimJsonPath, 'utf-8'))
    return DimensionMetaSchema.parse(raw)
  } catch {
    return null
  }
}

export function mergeThemes(dimensionTheme?: Theme, sceneTheme?: Theme): Theme {
  // Shallow merge: scene values override dimension values
  return {
    background: '#0a0a0a',
    accent: '#7c3aed',
    ...dimensionTheme,
    ...sceneTheme,
  }
}

/**
 * Load a scene from disk, validate with Zod, and return the full state.
 * Throws on invalid meta.json or missing files.
 */
export function loadSceneFromDisk(scenePath: string, dimensionId: string | null, dimensionPath?: string | null): SceneState {
  const metaPath = path.join(scenePath, 'meta.json')
  if (!fs.existsSync(metaPath)) {
    throw new Error(`Scene meta.json not found: ${metaPath}`)
  }

  let meta: SceneMeta
  try {
    const rawMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    meta = SceneMetaSchema.parse(rawMeta)
  } catch (err) {
    throw new Error(`Invalid or corrupted meta.json at ${metaPath}: ${err instanceof Error ? err.message : err}`)
  }

  // Load connections
  const connectionsPath = path.join(scenePath, 'connections.json')
  let connections: Connection[] = []
  if (fs.existsSync(connectionsPath)) {
    try {
      const rawConnections = JSON.parse(fs.readFileSync(connectionsPath, 'utf-8'))
      connections = ConnectionsFileSchema.parse(rawConnections)
    } catch (err) {
      console.error(`Invalid connections.json at ${connectionsPath}, using empty:`, err)
    }
  }

  // Load widget manifests
  const widgets = new Map<string, WidgetState>()
  for (const entry of meta.widgets) {
    const manifestPath = path.join(scenePath, entry.manifestPath)
    if (!fs.existsSync(manifestPath)) {
      console.warn(`Widget manifest not found: ${manifestPath}, skipping widget ${entry.id}`)
      continue
    }

    try {
      const rawManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      const manifest = WidgetManifestSchema.parse(rawManifest)

      // manifestPath points to widgets/<name>/src/widget.manifest.json
      // widgetDir is widgets/<name>/
      const srcDir = path.dirname(manifestPath)
      const widgetDir = path.dirname(srcDir)
      const bundlePath = path.join(widgetDir, 'dist', 'bundle.html')

      widgets.set(entry.id, {
        id: entry.id,
        widgetType: entry.widgetType,
        manifest,
        bundlePath: fs.existsSync(bundlePath) ? bundlePath : null,
        widgetDir,
        scenePath,
      })
    } catch (err) {
      console.error(`Invalid widget manifest at ${manifestPath}:`, err)
    }
  }

  // Load dimension meta if dimensionPath is provided
  const dimMeta = dimensionPath ? loadDimensionMeta(dimensionPath) : null

  // Detect layout mode
  const layoutHtml = loadLayoutHtml(scenePath)
  const layoutMode = layoutHtml !== null ? 'layout' : 'canvas'

  return {
    id: meta.id,
    slug: meta.slug,
    path: scenePath,
    dimensionId,
    dimensionPath: dimensionPath ?? null,
    dimensionMeta: dimMeta,
    meta,
    connections,
    widgets,
    layoutMode,
    layoutHtml,
  }
}

// Default bounds for widgets without explicit bounds in canvas mode
const DEFAULT_BOUNDS = { x: 0, y: 0, width: 400, height: 300 }
const DEFAULT_VIEWPORT = { width: 1920, height: 1080 }

function getWidgetBoundsOrDefault(entry: { bounds?: { x: number; y: number; width: number; height: number } }) {
  return entry.bounds ?? DEFAULT_BOUNDS
}

function buildBundleUrl(widget: WidgetState, entryId: string, sceneId: string, sceneTitle: string): string {
  if (!widget.bundlePath) return ''
  const baseBundleUrl = `dimensions-asset://${path.relative(DIMENSIONS_DIR, widget.bundlePath).split(path.sep).join('/')}`
  const contextParams = `widgetId=${encodeURIComponent(entryId)}&sceneId=${encodeURIComponent(sceneId)}&sceneTitle=${encodeURIComponent(sceneTitle)}`
  return `${baseBundleUrl}?${contextParams}`
}

/**
 * Generate the scene HTML shell that mounts widget iframes (Canvas mode).
 * This is served via dimensions-asset:// to the scene WCV.
 */
export function generateSceneHtml(scene: SceneState): string {
  // If layout mode, delegate to layout generator
  if (scene.layoutMode === 'layout' && scene.layoutHtml !== null) {
    return generateLayoutSceneHtml(scene)
  }

  const theme = mergeThemes(scene.dimensionMeta?.theme, scene.meta.theme)
  const viewport = scene.meta.viewport ?? DEFAULT_VIEWPORT

  // Separate background widget from regular widgets — background renders outside the
  // scaled container so it fills the full visible area regardless of viewport scale.
  let backgroundFrame = ''
  const widgetFrames = scene.meta.widgets
    .map((entry) => {
      const widget = scene.widgets.get(entry.id)
      if (!widget) return ''

      const { x, y, width, height } = getWidgetBoundsOrDefault(entry)
      const isBackground = entry.widgetType === '_background'
      const bundleUrl = buildBundleUrl(widget, entry.id, scene.id, scene.meta.title)

      if (isBackground) {
        if (!bundleUrl) return ''
        backgroundFrame = `<iframe
          id="widget-${entry.id}"
          data-widget-id="${entry.id}"
          class="background-widget"
          src="${bundleUrl}"
          sandbox="allow-scripts allow-same-origin"
          style="position:fixed;left:0;top:0;width:100%;height:100%;border:none;z-index:0;"
        ></iframe>`
        return '' // rendered separately outside the container
      }

      if (!bundleUrl) {
        const isPortal = widget.manifest.type === 'webportal'
        return `<div class="widget-wrapper" data-widget-id="${entry.id}"
          style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;">
          <div class="drag-handle"></div>
          <div class="widget-placeholder ${isPortal ? 'portal-placeholder' : ''}">
            ${widget.manifest.title}${isPortal ? '' : ' (not built)'}
          </div>
          <div class="resize-handle"></div>
        </div>`
      }

      return `<div class="widget-wrapper" data-widget-id="${entry.id}"
        style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;">
        <div class="drag-handle"></div>
        <iframe
          id="widget-${entry.id}"
          data-widget-id="${entry.id}"
          src="${bundleUrl}"
          sandbox="allow-scripts allow-same-origin"
          style="width:100%;height:100%;border:none;background:transparent;"
        ></iframe>
        <div class="resize-handle"></div>
      </div>`
    })
    .join('\n    ')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${scene.meta.title}</title>
  <style>
    :root {
      --viewport-w: ${viewport.width};
      --viewport-h: ${viewport.height};
      --viewport-scale: 1;
      --zoom: 1;
      --total-scale: 1;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${theme.background};
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #scene-scroll {
      width: 100%;
      height: 100%;
      overflow: auto;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #scene-scroll.mode-original {
      align-items: flex-start;
      justify-content: flex-start;
    }
    /* Sizer: explicit pixel size set by JS to match scaled content.
       The scene-container is absolutely positioned inside so its
       un-transformed layout box (viewport dimensions) doesn't interfere. */
    .scene-sizer {
      position: relative;
      flex-shrink: 0;
    }
    .scene-container {
      position: absolute;
      top: 0;
      left: 0;
      width: ${viewport.width}px;
      height: ${viewport.height}px;
      transform: scale(var(--total-scale));
      transform-origin: 0 0;
    }
    .widget-wrapper {
      position: absolute;
      border: 2px solid transparent;
      border-radius: 4px;
      overflow: visible;
    }
    .widget-wrapper.selected {
      border-color: ${theme.accent};
    }
    .drag-handle {
      display: none;
      position: absolute;
      top: -12px;
      left: 0;
      right: 0;
      height: 12px;
      background: ${theme.accent};
      opacity: 0.7;
      cursor: grab;
      border-radius: 4px 4px 0 0;
      z-index: 10;
    }
    .drag-handle:active { cursor: grabbing; }
    .drag-handle, .resize-handle { touch-action: none; }
    .resize-handle {
      display: none;
      position: absolute;
      bottom: -6px;
      right: -6px;
      width: 12px;
      height: 12px;
      background: ${theme.accent};
      opacity: 0.7;
      cursor: nwse-resize;
      border-radius: 2px;
      z-index: 10;
    }
    body.editing .widget-wrapper .drag-handle,
    body.editing .widget-wrapper .resize-handle {
      display: block;
    }
    body.editing .widget-wrapper iframe {
      pointer-events: none;
    }
    body.editing .background-widget {
      pointer-events: none;
    }
    .widget-placeholder {
      width: 100%;
      height: 100%;
      background: #1e1e1e;
      border: 1px dashed #444;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #666;
      font-family: monospace;
      font-size: 12px;
      border-radius: 4px;
    }
    .widget-placeholder.portal-placeholder {
      background: #1a1a2e;
      border-color: #334;
      color: #88f;
    }
  </style>
</head>
<body>
  ${backgroundFrame}
  <div id="scene-scroll">
    <div class="scene-sizer">
      <div class="scene-container">
        ${widgetFrames}
      </div>
    </div>
  </div>
  <script>
    // ── Viewport scaling runtime ──
    var VIEWPORT_W = ${viewport.width};
    var VIEWPORT_H = ${viewport.height};
    var currentScaleMode = 'fit';
    var currentZoom = 1;
    var viewportScale = 1;

    var scroller = document.getElementById('scene-scroll');
    var sizer = document.querySelector('.scene-sizer');
    var container = document.querySelector('.scene-container');

    function computeScale() {
      if (currentScaleMode === 'fit') {
        var availW = scroller.clientWidth;
        var availH = scroller.clientHeight;
        viewportScale = Math.min(availW / VIEWPORT_W, availH / VIEWPORT_H);
      } else {
        viewportScale = 1;
      }
      var totalScale = viewportScale * currentZoom;
      document.documentElement.style.setProperty('--viewport-scale', viewportScale);
      document.documentElement.style.setProperty('--zoom', currentZoom);
      document.documentElement.style.setProperty('--total-scale', totalScale);

      // Set sizer to the actual scaled pixel size so flex centering and scroll work correctly.
      // CSS transforms don't affect layout, so we must size the sizer explicitly.
      var scaledW = Math.ceil(VIEWPORT_W * totalScale);
      var scaledH = Math.ceil(VIEWPORT_H * totalScale);
      sizer.style.width = scaledW + 'px';
      sizer.style.height = scaledH + 'px';

      // Ensure the sizer is at least as big as the scroller for centering
      sizer.style.minWidth = '100%';
      sizer.style.minHeight = '100%';

      // Update scroll mode class
      if (currentScaleMode === 'original') {
        scroller.classList.add('mode-original');
      } else {
        scroller.classList.remove('mode-original');
      }

      // Report to main process
      if (window.dimensionsScene) {
        window.dimensionsScene.reportScale(totalScale);
      }
    }

    // Initial computation
    computeScale();

    // Recompute on resize
    var resizeRaf = null;
    new ResizeObserver(function() {
      if (resizeRaf) return;
      resizeRaf = requestAnimationFrame(function() {
        resizeRaf = null;
        computeScale();
      });
    }).observe(scroller);

    // Scene runtime: handles hot-reload and edit mode messages from preload
    if (window.dimensionsScene) {
      window.dimensionsScene.onWidgetReload(function(widgetId) {
        var iframe = document.getElementById('widget-' + widgetId);
        if (iframe) {
          var src = iframe.src;
          iframe.src = '';
          setTimeout(function() { iframe.src = src; }, 0);
        }
      });

      window.dimensionsScene.onEditMode(function(editing) {
        document.body.classList.toggle('editing', editing);
        if (!editing) {
          document.querySelectorAll('.widget-wrapper.selected').forEach(function(el) { el.classList.remove('selected'); });
        }
      });

      window.dimensionsScene.onScaleMode(function(mode) {
        currentScaleMode = mode;
        computeScale();
      });

      window.dimensionsScene.onZoom(function(zoom) {
        currentZoom = zoom;
        computeScale();
      });

      // Report scroll position so portal WCVs track with content
      if (scroller) {
        var lastSX = 0, lastSY = 0;
        scroller.addEventListener('scroll', function() {
          var sx = scroller.scrollLeft, sy = scroller.scrollTop;
          if (sx !== lastSX || sy !== lastSY) {
            lastSX = sx;
            lastSY = sy;
            window.dimensionsScene.reportScroll(sx, sy);
          }
        }, { passive: true });
      }
    }

    // Pinch-to-zoom (ctrlKey on macOS trackpad) → zoom
    // Only ctrlKey — regular two-finger scroll should pan, not zoom
    scroller.addEventListener('wheel', function(e) {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (window.dimensionsScene) {
        window.dimensionsScene.reportZoomDelta(-e.deltaY);
      }
    }, { passive: false });

    // ── Edit-mode: selection, drag, resize ──

    function postSdk(method, args) {
      window.parent.postMessage({ type: 'sdk-call', callId: 0, method: method, args: args }, '*');
    }

    function getBoundsFromWrapper(wrapper) {
      return {
        x: parseFloat(wrapper.style.left) || 0,
        y: parseFloat(wrapper.style.top) || 0,
        width: parseFloat(wrapper.style.width) || 0,
        height: parseFloat(wrapper.style.height) || 0,
      };
    }

    function getTotalScale() {
      return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--total-scale')) || 1;
    }

    document.addEventListener('pointerdown', function(e) {
      if (!document.body.classList.contains('editing')) return;

      var target = e.target;
      var wrapper = target.closest('.widget-wrapper');
      if (!wrapper) return;

      var widgetId = wrapper.dataset.widgetId;
      var totalScale = getTotalScale();

      // ── Drag handle ──
      if (target.classList.contains('drag-handle')) {
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        document.body.classList.add('interacting');
        var startX = e.clientX;
        var startY = e.clientY;
        var origLeft = parseFloat(wrapper.style.left) || 0;
        var origTop = parseFloat(wrapper.style.top) || 0;

        function onMove(ev) {
          var dx = (ev.clientX - startX) / totalScale;
          var dy = (ev.clientY - startY) / totalScale;
          wrapper.style.left = (origLeft + dx) + 'px';
          wrapper.style.top = (origTop + dy) + 'px';
          postSdk('sdk:widget:bounds-live', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        function onUp(ev) {
          target.releasePointerCapture(ev.pointerId);
          target.removeEventListener('pointermove', onMove);
          target.removeEventListener('pointerup', onUp);
          document.body.classList.remove('interacting');
          postSdk('sdk:widget:bounds-update', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', onUp);
        return;
      }

      // ── Resize handle ──
      if (target.classList.contains('resize-handle')) {
        e.preventDefault();
        target.setPointerCapture(e.pointerId);
        document.body.classList.add('interacting');
        var startRX = e.clientX;
        var startRY = e.clientY;
        var origW = parseFloat(wrapper.style.width) || 0;
        var origH = parseFloat(wrapper.style.height) || 0;

        function onRMove(ev) {
          var dw = (ev.clientX - startRX) / totalScale;
          var dh = (ev.clientY - startRY) / totalScale;
          wrapper.style.width = Math.max(40, origW + dw) + 'px';
          wrapper.style.height = Math.max(40, origH + dh) + 'px';
          postSdk('sdk:widget:bounds-live', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        function onRUp(ev) {
          target.releasePointerCapture(ev.pointerId);
          target.removeEventListener('pointermove', onRMove);
          target.removeEventListener('pointerup', onRUp);
          document.body.classList.remove('interacting');
          postSdk('sdk:widget:bounds-update', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        target.addEventListener('pointermove', onRMove);
        target.addEventListener('pointerup', onRUp);
        return;
      }

      // ── Selection ──
      document.querySelectorAll('.widget-wrapper.selected').forEach(function(el) { el.classList.remove('selected'); });
      wrapper.classList.add('selected');
      postSdk('sdk:widget:select', [widgetId]);
    });

    // Click on background (scene container or sizer, not a widget) → select _background widget
    document.getElementById('scene-scroll').addEventListener('pointerdown', function(e) {
      if (!document.body.classList.contains('editing')) return;
      if (e.target.closest('.widget-wrapper')) return;
      // Only trigger on clicks within the scene area (container, sizer, scroller background)
      var bgIframe = document.querySelector('.background-widget');
      if (bgIframe) {
        document.querySelectorAll('.widget-wrapper.selected').forEach(function(el) { el.classList.remove('selected'); });
        postSdk('sdk:widget:select', [bgIframe.dataset.widgetId]);
      }
    });
  </script>
</body>
</html>`
}

/**
 * Generate the scene HTML for Layout mode.
 * Reads layout.html and injects runtime + widget custom element definition.
 */
export function generateLayoutSceneHtml(scene: SceneState): string {
  const theme = mergeThemes(scene.dimensionMeta?.theme, scene.meta.theme)
  const layoutHtml = scene.layoutHtml || ''

  // Build widget map for the custom element
  const widgetMap: Record<string, Array<{ id: string; bundleUrl: string; manifestType: string }>> = {}
  for (const entry of scene.meta.widgets) {
    const widget = scene.widgets.get(entry.id)
    if (!widget) continue
    if (entry.widgetType === '_background') continue
    const bundleUrl = buildBundleUrl(widget, entry.id, scene.id, scene.meta.title)
    if (!widgetMap[entry.widgetType]) widgetMap[entry.widgetType] = []
    widgetMap[entry.widgetType].push({
      id: entry.id,
      bundleUrl,
      manifestType: widget.manifest.type,
    })
  }

  // Find background widget
  let backgroundFrame = ''
  for (const entry of scene.meta.widgets) {
    if (entry.widgetType !== '_background') continue
    const widget = scene.widgets.get(entry.id)
    if (!widget) continue
    const bundleUrl = buildBundleUrl(widget, entry.id, scene.id, scene.meta.title)
    if (bundleUrl) {
      backgroundFrame = `<iframe
        id="widget-${entry.id}"
        data-widget-id="${entry.id}"
        class="background-widget"
        src="${bundleUrl}"
        sandbox="allow-scripts allow-same-origin"
        style="position:fixed;left:0;top:0;width:100%;height:100%;border:none;z-index:-1;"
      ></iframe>`
    }
    break
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${scene.meta.title}</title>
  <style>
    :root {
      --zoom: 1;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${theme.background};
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    #scene-scroll {
      width: 100%;
      height: 100%;
      overflow: auto;
    }
    .layout-container {
      transform: scale(var(--zoom));
      transform-origin: 0 0;
      min-width: 100%;
      min-height: 100%;
    }
    body.editing dimensions-widget iframe {
      pointer-events: none;
    }
    body.editing .background-widget {
      pointer-events: none;
    }
    dimensions-widget {
      display: block;
    }
    dimensions-widget.selected {
      outline: 2px solid ${theme.accent};
      outline-offset: 1px;
    }
  </style>
</head>
<body>
  ${backgroundFrame}
  <div id="scene-scroll">
    <div class="layout-container">
      ${layoutHtml}
    </div>
  </div>
  <script>
    // ── Widget map for custom element ──
    window.__WIDGET_MAP__ = ${JSON.stringify(widgetMap)};

    // Track instance counters per widgetType for multiple instances
    var __instanceCounters = {};

    // ── <dimensions-widget> custom element ──
    class DimensionsWidget extends HTMLElement {
      connectedCallback() {
        var name = this.getAttribute('name');
        if (!name) return;

        var entries = window.__WIDGET_MAP__[name];
        if (!entries || entries.length === 0) {
          this.innerHTML = '<div style="padding:8px;color:#666;font-family:monospace;font-size:12px;">Widget not found: ' + name + '</div>';
          return;
        }

        // Match by order for multiple instances of same type
        if (!__instanceCounters[name]) __instanceCounters[name] = 0;
        var idx = __instanceCounters[name]++;
        if (idx >= entries.length) idx = entries.length - 1;
        var entry = entries[idx];

        this.dataset.widgetId = entry.id;

        if (entry.manifestType === 'webportal') {
          // Portal widget: create placeholder div, report bounds
          var placeholder = document.createElement('div');
          placeholder.className = 'portal-placeholder';
          placeholder.style.cssText = 'width:100%;height:100%;min-height:200px;background:#1a1a2e;border:1px dashed #334;border-radius:4px;';
          this.appendChild(placeholder);

          var widgetId = entry.id;
          var self = this;

          function reportBounds() {
            if (!window.dimensionsScene) return;
            var rect = self.getBoundingClientRect();
            window.dimensionsScene.reportWidgetBounds(widgetId, {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height,
            });
          }

          // Report on resize, scroll, mutation
          var ro = new ResizeObserver(reportBounds);
          ro.observe(this);

          var scroller = document.getElementById('scene-scroll');
          if (scroller) {
            scroller.addEventListener('scroll', reportBounds, { passive: true });
          }

          // Also report after layout settles
          requestAnimationFrame(function() {
            requestAnimationFrame(reportBounds);
          });

          this._cleanup = function() {
            ro.disconnect();
            if (scroller) scroller.removeEventListener('scroll', reportBounds);
          };
        } else if (entry.bundleUrl) {
          // Custom widget: create iframe
          var iframe = document.createElement('iframe');
          iframe.id = 'widget-' + entry.id;
          iframe.dataset.widgetId = entry.id;
          iframe.src = entry.bundleUrl;
          iframe.sandbox = 'allow-scripts allow-same-origin';
          iframe.style.cssText = 'width:100%;height:100%;border:none;background:transparent;display:block;';
          this.appendChild(iframe);
        } else {
          this.innerHTML = '<div style="padding:8px;color:#666;font-family:monospace;font-size:12px;">' + name + ' (not built)</div>';
        }
      }

      disconnectedCallback() {
        if (this._cleanup) this._cleanup();
      }
    }
    customElements.define('dimensions-widget', DimensionsWidget);

    // ── Layout runtime ──
    var currentZoom = 1;
    var scroller = document.getElementById('scene-scroll');

    if (window.dimensionsScene) {
      window.dimensionsScene.onWidgetReload(function(widgetId) {
        var iframe = document.getElementById('widget-' + widgetId);
        if (iframe) {
          var src = iframe.src;
          iframe.src = '';
          setTimeout(function() { iframe.src = src; }, 0);
        }
      });

      window.dimensionsScene.onEditMode(function(editing) {
        document.body.classList.toggle('editing', editing);
        if (!editing) {
          document.querySelectorAll('dimensions-widget.selected').forEach(function(el) { el.classList.remove('selected'); });
        }
      });

      window.dimensionsScene.onZoom(function(zoom) {
        currentZoom = zoom;
        document.documentElement.style.setProperty('--zoom', zoom);
        window.dimensionsScene.reportScale(zoom);
      });

      // Report scroll
      if (scroller) {
        var lastSX = 0, lastSY = 0;
        scroller.addEventListener('scroll', function() {
          var sx = scroller.scrollLeft, sy = scroller.scrollTop;
          if (sx !== lastSX || sy !== lastSY) {
            lastSX = sx;
            lastSY = sy;
            window.dimensionsScene.reportScroll(sx, sy);
          }
        }, { passive: true });
      }

      // Report initial scale
      window.dimensionsScene.reportScale(1);
    }

    // Ctrl+scroll → zoom
    if (scroller) {
      scroller.addEventListener('wheel', function(e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        if (window.dimensionsScene) {
          window.dimensionsScene.reportZoomDelta(-e.deltaY);
        }
      }, { passive: false });
    }

    // ── Edit-mode: selection (no drag/resize in layout mode) ──

    function postSdk(method, args) {
      window.parent.postMessage({ type: 'sdk-call', callId: 0, method: method, args: args }, '*');
    }

    document.addEventListener('pointerdown', function(e) {
      if (!document.body.classList.contains('editing')) return;

      var target = e.target;
      var widget = target.closest('dimensions-widget');
      if (widget && widget.dataset.widgetId) {
        document.querySelectorAll('dimensions-widget.selected').forEach(function(el) { el.classList.remove('selected'); });
        widget.classList.add('selected');
        postSdk('sdk:widget:select', [widget.dataset.widgetId]);
        return;
      }

      // Click on background
      var bgIframe = document.querySelector('.background-widget');
      if (bgIframe) {
        document.querySelectorAll('dimensions-widget.selected').forEach(function(el) { el.classList.remove('selected'); });
        postSdk('sdk:widget:select', [bgIframe.dataset.widgetId]);
      }
    });
  </script>
</body>
</html>`
}

/**
 * Write the generated scene HTML to a temporary file for serving via dimensions-asset://.
 */
export function writeSceneHtml(scenePath: string, html: string): string {
  const outPath = path.join(scenePath, '.scene-runtime.html')
  fs.writeFileSync(outPath, html, 'utf-8')
  return outPath
}

/**
 * Ensure the Home dimension exists with a "main" scene.
 * Home is a dimension, not a standalone scene.
 */
export function ensureHomeDimension(): void {
  const homePath = path.join(DIMENSIONS_DIR, 'home')

  if (!fs.existsSync(DIMENSIONS_DIR)) {
    fs.mkdirSync(DIMENSIONS_DIR, { recursive: true })
  }

  const dimJsonPath = path.join(homePath, 'dimension.json')

  if (!fs.existsSync(dimJsonPath)) {
    // Create the Home dimension with a "main" scene
    fs.mkdirSync(homePath, { recursive: true })

    const mainScenePath = path.join(homePath, 'main')
    fs.mkdirSync(path.join(mainScenePath, 'widgets'), { recursive: true })
    ensureBackgroundWidget(mainScenePath)

    const sceneMeta: SceneMeta = {
      id: ulid(),
      title: 'Main',
      slug: 'main',
      theme: {},
      viewport: { width: 1920, height: 1080 },
      widgets: [
        {
          id: ulid(),
          widgetType: '_background',
          manifestPath: 'widgets/_background/src/widget.manifest.json',
          bounds: { x: 0, y: 0, width: 4000, height: 4000 },
        },
      ],
    }
    fs.writeFileSync(path.join(mainScenePath, 'meta.json'), JSON.stringify(sceneMeta, null, 2), 'utf-8')
    fs.writeFileSync(path.join(mainScenePath, 'connections.json'), '[]', 'utf-8')

    const dimMeta = {
      id: ulid(),
      title: 'Home',
      slug: 'home',
      scenes: ['main'],
      entryScene: 'main',
      theme: { background: '#0a0a0a', accent: '#7c3aed' },
      sharedEnvKeys: [],
    }
    fs.writeFileSync(dimJsonPath, JSON.stringify(dimMeta, null, 2), 'utf-8')
  }
}

// ── Slug & creation helpers ──

/** Sanitize title to URL-safe slug */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'untitled'
}

/** Ensure slug doesn't conflict with existing folders */
function uniqueSlug(baseSlug: string, parentDir: string): string {
  let slug = baseSlug
  let counter = 1
  while (fs.existsSync(path.join(parentDir, slug))) {
    slug = `${baseSlug}-${counter}`
    counter++
  }
  return slug
}

/**
 * Create a new scene on disk with meta.json, connections.json, and _background widget.
 * Returns the absolute path to the new scene folder.
 */
export function createScene(title: string, parentDir?: string): string {
  const dir = parentDir || DIMENSIONS_DIR
  const slug = uniqueSlug(slugify(title), dir)
  const scenePath = path.join(dir, slug)

  fs.mkdirSync(scenePath, { recursive: true })
  fs.mkdirSync(path.join(scenePath, 'widgets'), { recursive: true })

  // Ensure _background widget files exist
  ensureBackgroundWidget(scenePath)

  // Create meta.json with _background widget entry
  const meta: SceneMeta = {
    id: ulid(),
    title,
    slug,
    theme: { background: '#0a0a0a', accent: '#7c3aed' },
    viewport: { width: 1920, height: 1080 },
    widgets: [
      {
        id: ulid(),
        widgetType: '_background',
        manifestPath: 'widgets/_background/src/widget.manifest.json',
        bounds: { x: 0, y: 0, width: 4000, height: 4000 },
      },
    ],
  }
  fs.writeFileSync(path.join(scenePath, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8')

  // Create empty connections.json
  fs.writeFileSync(path.join(scenePath, 'connections.json'), '[]', 'utf-8')

  return scenePath
}

/**
 * Create a new dimension on disk with dimension.json and a first "main" scene.
 * Returns paths to both the dimension folder and the first scene folder.
 */
export function createDimension(title: string): { dimensionPath: string; firstScenePath: string } {
  const slug = uniqueSlug(slugify(title), DIMENSIONS_DIR)
  const dimPath = path.join(DIMENSIONS_DIR, slug)
  fs.mkdirSync(dimPath, { recursive: true })

  // Create the first scene inside the dimension
  const firstSceneSlug = 'main'
  const scenePath = path.join(dimPath, firstSceneSlug)
  fs.mkdirSync(path.join(scenePath, 'widgets'), { recursive: true })

  ensureBackgroundWidget(scenePath)

  const sceneMeta: SceneMeta = {
    id: ulid(),
    title,
    slug: firstSceneSlug,
    theme: {},
    viewport: { width: 1920, height: 1080 },
    widgets: [
      {
        id: ulid(),
        widgetType: '_background',
        manifestPath: 'widgets/_background/src/widget.manifest.json',
        bounds: { x: 0, y: 0, width: 4000, height: 4000 },
      },
    ],
  }
  fs.writeFileSync(path.join(scenePath, 'meta.json'), JSON.stringify(sceneMeta, null, 2), 'utf-8')
  fs.writeFileSync(path.join(scenePath, 'connections.json'), '[]', 'utf-8')

  // Create dimension.json
  const dimMeta = {
    id: ulid(),
    title,
    slug,
    scenes: [firstSceneSlug],
    entryScene: firstSceneSlug,
    theme: { background: '#0a0a0a', accent: '#7c3aed' },
    sharedEnvKeys: [],
  }
  fs.writeFileSync(path.join(dimPath, 'dimension.json'), JSON.stringify(dimMeta, null, 2), 'utf-8')

  return { dimensionPath: dimPath, firstScenePath: scenePath }
}

// Create the _background widget with a default solid color
export function ensureBackgroundWidget(scenePath: string): void {
  const bgDir = path.join(scenePath, 'widgets', '_background', 'src')
  if (fs.existsSync(path.join(bgDir, 'widget.manifest.json'))) return

  fs.mkdirSync(bgDir, { recursive: true })

  fs.writeFileSync(
    path.join(bgDir, 'widget.manifest.json'),
    JSON.stringify({
      id: '_background',
      type: 'custom',
      title: 'Scene Background',
      capabilities: ['kv', 'network', 'theme'],
      allowedHosts: ['*'],
    }, null, 2),
    'utf-8',
  )

  fs.writeFileSync(
    path.join(bgDir, 'index.html'),
    `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; }
  html, body {
    width: 100%;
    height: 100%;
    background: #0a0a0a;
  }
</style>
</head>
<body>
<!-- Edit this file to customize the scene background.
     Examples: gradients, animations, canvas, video, particles.
     This widget renders behind all other widgets. -->
</body>
</html>`,
    'utf-8',
  )
}
