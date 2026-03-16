import fs from 'fs'
import path from 'path'
import { SceneMetaSchema, WidgetManifestSchema, ConnectionsFileSchema } from './schemas'
import type { SceneMeta, WidgetManifest, Connection } from './schemas'
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
  meta: SceneMeta
  connections: Connection[]
  widgets: Map<string, WidgetState>
}

/**
 * Load a scene from disk, validate with Zod, and return the full state.
 * Throws on invalid meta.json or missing files.
 */
export function loadSceneFromDisk(scenePath: string, dimensionId: string | null): SceneState {
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

  return {
    id: meta.id,
    slug: meta.slug,
    path: scenePath,
    dimensionId,
    meta,
    connections,
    widgets,
  }
}

/**
 * Generate the scene HTML shell that mounts widget iframes.
 * This is served via dimensions-asset:// to the scene WCV.
 */
export function generateSceneHtml(scene: SceneState): string {
  const theme = scene.meta.theme ?? { background: '#0a0a0a', accent: '#7c3aed' }

  const widgetFrames = scene.meta.widgets
    .map((entry) => {
      const widget = scene.widgets.get(entry.id)
      if (!widget) return ''

      const { x, y, width, height } = entry.bounds
      // Build asset URL with widget context as search params
      // dimensions-asset://home/widgets/test-widget/dist/bundle.html?widgetId=X&sceneId=Y&sceneTitle=Z
      const baseBundleUrl = widget.bundlePath
        ? `dimensions-asset://${path.relative(DIMENSIONS_DIR, widget.bundlePath).split(path.sep).join('/')}`
        : ''
      const contextParams = `widgetId=${encodeURIComponent(entry.id)}&sceneId=${encodeURIComponent(scene.id)}&sceneTitle=${encodeURIComponent(scene.meta.title)}`
      const bundleUrl = baseBundleUrl ? `${baseBundleUrl}?${contextParams}` : ''

      if (!bundleUrl) {
        return `<div class="widget-wrapper" data-widget-id="${entry.id}"
          style="left:${x}px;top:${y}px;width:${width}px;height:${height}px;">
          <div class="drag-handle"></div>
          <div class="widget-placeholder">
            ${widget.manifest.title} (not built)
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
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: ${theme.background};
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }
    .scene-container {
      position: relative;
      width: 100%;
      height: 100%;
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
    /* Prevent iframe from stealing mouse events during drag/resize */
    body.editing.interacting .widget-wrapper iframe {
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
  </style>
</head>
<body>
  <div class="scene-container">
    ${widgetFrames}
  </div>
  <script>
    // Scene runtime: handles hot-reload and edit mode messages from preload
    if (window.dimensionsScene) {
      window.dimensionsScene.onWidgetReload((widgetId) => {
        const iframe = document.getElementById('widget-' + widgetId);
        if (iframe) {
          // Force reload by re-setting src
          const src = iframe.src;
          iframe.src = '';
          setTimeout(() => { iframe.src = src; }, 0);
        }
      });

      window.dimensionsScene.onEditMode((editing) => {
        document.body.classList.toggle('editing', editing);
        if (!editing) {
          // Remove selected state from all wrappers when leaving edit mode
          document.querySelectorAll('.widget-wrapper.selected').forEach(el => el.classList.remove('selected'));
        }
      });
    }

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

    document.addEventListener('mousedown', function(e) {
      if (!document.body.classList.contains('editing')) return;

      var target = e.target;
      var wrapper = target.closest('.widget-wrapper');
      if (!wrapper) return;

      var widgetId = wrapper.dataset.widgetId;

      // ── Drag handle ──
      if (target.classList.contains('drag-handle')) {
        e.preventDefault();
        document.body.classList.add('interacting');
        var startX = e.clientX;
        var startY = e.clientY;
        var origLeft = parseFloat(wrapper.style.left) || 0;
        var origTop = parseFloat(wrapper.style.top) || 0;

        function onMove(ev) {
          var dx = ev.clientX - startX;
          var dy = ev.clientY - startY;
          wrapper.style.left = (origLeft + dx) + 'px';
          wrapper.style.top = (origTop + dy) + 'px';
          postSdk('sdk:widget:bounds-live', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        function onUp() {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          document.body.classList.remove('interacting');
          postSdk('sdk:widget:bounds-update', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }

      // ── Resize handle ──
      if (target.classList.contains('resize-handle')) {
        e.preventDefault();
        document.body.classList.add('interacting');
        var startRX = e.clientX;
        var startRY = e.clientY;
        var origW = parseFloat(wrapper.style.width) || 0;
        var origH = parseFloat(wrapper.style.height) || 0;

        function onRMove(ev) {
          var dw = ev.clientX - startRX;
          var dh = ev.clientY - startRY;
          wrapper.style.width = Math.max(40, origW + dw) + 'px';
          wrapper.style.height = Math.max(40, origH + dh) + 'px';
          postSdk('sdk:widget:bounds-live', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        function onRUp() {
          document.removeEventListener('mousemove', onRMove);
          document.removeEventListener('mouseup', onRUp);
          document.body.classList.remove('interacting');
          postSdk('sdk:widget:bounds-update', [widgetId, getBoundsFromWrapper(wrapper)]);
        }
        document.addEventListener('mousemove', onRMove);
        document.addEventListener('mouseup', onRUp);
        return;
      }

      // ── Selection (click on widget wrapper or iframe overlay) ──
      document.querySelectorAll('.widget-wrapper.selected').forEach(function(el) { el.classList.remove('selected'); });
      wrapper.classList.add('selected');
      postSdk('sdk:widget:select', [widgetId]);
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
 * Ensure the home scene exists with a starter meta.json.
 */
export function ensureHomeScene(homePath: string): void {
  if (!fs.existsSync(homePath)) {
    fs.mkdirSync(homePath, { recursive: true })
  }

  const metaPath = path.join(homePath, 'meta.json')
  if (!fs.existsSync(metaPath)) {
    const { ulid } = require('ulid')
    const meta: SceneMeta = {
      id: ulid(),
      title: 'Home',
      slug: 'home',
      theme: { background: '#0a0a0a', accent: '#7c3aed' },
      widgets: [],
    }
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
  }

  // Ensure widgets directory exists
  const widgetsDir = path.join(homePath, 'widgets')
  if (!fs.existsSync(widgetsDir)) {
    fs.mkdirSync(widgetsDir, { recursive: true })
  }
}
