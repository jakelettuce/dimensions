# Dimensions

Your AI assistant should be able to build you software — not just write code, but create the actual interfaces you use every day. Dimensions makes that possible.

It's a desktop environment where AI tools like Claude Code can spin up fully custom workspaces, workflows, and interfaces on the fly. Embed real websites, build bespoke widgets, wire things together, and use it all immediately — no deploy, no config, no waiting.

## What it does

- **Custom interfaces, instantly.** Claude Code (or any AI agent) builds you exactly the UI you need — a morning dashboard, a research workspace, a media control panel — as a scene made of widgets, webportals, and terminals.
- **Real web apps, embedded.** Gmail, GitHub, Notion — rendered natively via Electron WebContentsViews. Restyle them with CSS injection. Copy, paste, download files, right-click context menus — all work.
- **Compound widgets.** Group a browser chrome + webportal into a single draggable unit. Or build a sidebar + portal. Or a tabbed browser. Compound widgets are just widgets that contain other widgets — fully customizable.
- **Rich media.** Images, video, audio, custom visualizations — all first-class in custom widgets.
- **Persistent.** Storage, state, and layout survive between sessions. Your workspaces are yours.
- **Two layout modes.** Canvas mode (absolute positioning with viewport scaling) or Layout mode (CSS flexbox/grid via `layout.html`). Switch by creating or deleting `layout.html`.
- **Scenes link to scenes.** Navigate between workspaces with `dimensions://` links. Build flows — a morning routine that moves from inbox triage to calendar to focus mode.
- **Dimensions.** Group related scenes into ordered flows with shared theme and env config. Navigate sequentially with `sdk.navigate.next()` / `previous()`, or jump to any scene.
- **Shareable.** Scenes are folders on disk. Share them, remix them, publish them for others.

## How it works

A scene is a folder. Widgets are HTML/JS/CSS. Claude Code writes directly into the scene folder, esbuild compiles it, and the app hot-reloads in ~100ms. You describe what you want, it appears on screen, you use it.

```
You: "Build me a morning routine that starts with my email,
      then shows my calendar, then transitions to a focus timer"

Claude Code: writes three scenes, links them with dimensions://,
             embeds Gmail and Google Calendar as webportals,
             builds a custom focus timer widget

You: using it 30 seconds later
```

## Architecture

```
~/Dimensions/
  morning-routine/              # a "dimension" (grouped scenes)
    dimension.json              # title, scene order, shared theme, shared env keys
    inbox/                      # scene 1
      meta.json                 # widget positions, theme, viewport
      layout.html               # (optional) CSS layout — if present, uses Layout mode
      widgets/
        _background/            # every scene gets a customizable background widget
          src/index.html
        my-browser/             # compound widget: chrome + webportal
          src/
            index.html          # renders URL bar, tabs, nav buttons
            widget.manifest.json # type: "compound", children: [{type: "webportal"}]
          dist/bundle.html
        email-summary/          # custom widget
          src/index.html
          dist/bundle.html
    calendar/                   # scene 2
    focus/                      # scene 3
  home/                         # standalone scene (not in a dimension)
    meta.json
    widgets/...
```

### Process model

```
Main Process (Node.js, trusted)
  ├── Window manager (multi-window, each fully independent)
  ├── Scene WCV (one sandboxed WebContentsView per window)
  ├── Webportal manager
  │   ├── Single content WCV per portal (no built-in chrome — you build it)
  │   ├── Multi-tab support with per-tab navigation state
  │   ├── Pre-warmed WCV pool for instant portal creation
  │   ├── CSS injection (dom-ready) + extraction (for AI agent context)
  │   ├── Downloads (auto-save to ~/Downloads with notification)
  │   └── Context menu (copy, open in browser, save image)
  ├── File watcher → esbuild → hot reload (~100ms)
  ├── Capability-gated IPC handlers
  ├── Keyboard shortcuts (window-scoped menu accelerators)
  ├── Terminal manager (node-pty, login shell, scoped per scene)
  ├── dimensions:// protocol (navigation)
  ├── dimensions-asset:// protocol (static file serving)
  └── SQLite database (sql.js/WASM)

Renderer (app chrome, trusted)
  ├── Top bar (always visible — scene title, navigation, mode indicator)
  ├── Toolbar (edit mode — widget tools, layout controls)
  ├── Scene sidebar (Cmd+S — scene navigation within dimensions)
  ├── Editor tools panel (Claude Code terminal / no-code properties)
  ├── Command palette (Cmd+K)
  └── Themed with Tailwind CSS + CSS custom properties
```

### Core concepts

- **Scenes** are folders containing widgets, metadata, and wiring
- **Widgets** are self-contained HTML/JS/CSS — custom UIs, embedded websites, or terminals. Every scene includes a `_background` widget that renders full-screen behind everything else — edit it for gradients, animations, canvas, video, live data, anything
- **Webportals** are bare content WCVs that render real websites. No built-in chrome — you control them from custom widgets via `sdk.portal.*`. This means you can build any browser UI you want, or embed sites with no chrome at all
- **Compound widgets** group child widgets (portals, custom widgets) into one draggable unit with internal layout (anchor: top/bottom/left/right/fill). A "browser" is a compound with a custom chrome widget + webportal child
- **Dimensions** group scenes into ordered flows with shared theme and env config
- **`@dimensions/sdk`** gives widgets access to storage, network, navigation, theming, portal control, and more — all capability-gated
- **Dataflow** wires widgets together — outputs from one widget feed inputs to another via `connections.json`
- **Two layout modes:** Canvas (absolute positioning, viewport scaling, drag/resize) and Layout (CSS via `layout.html`, flexbox/grid, `<dimensions-widget>` custom element)
- **Two protocols:** `dimensions://` for navigation, `dimensions-asset://` for static file serving — separated for security

### Edit mode / Use mode

The **top bar** is always visible — scene title, dimension breadcrumbs, navigation, and mode indicator.

**Use mode** (default): Scene fills the window below the top bar. The scene defines all interaction — the app imposes nothing.

**Edit mode** (`Cmd+E`): Toolbar and right panel appear. Claude Code terminal (scoped to scene folder) or no-code properties panel. Widgets show drag/resize handles (canvas mode). Webportals freeze for interaction passthrough. All changes persist to disk.

### AI agent context (multi-tool)

Every scene auto-generates context files that AI coding tools read: `CLAUDE.md` (Claude Code), `AGENTS.md` (OpenAI Codex), `GEMINI.md` (Gemini CLI), `.cursorrules` (Cursor), `CONTEXT.md` (generic). All identical content from a single source — full SDK reference, widget manifest schema, compound widget examples, layout system docs. Whatever AI tool you use, it has full context.

### Widget SDK

Widgets communicate through `@dimensions/sdk` — a lightweight postMessage bridge that routes through the main process. Every SDK method requires a declared capability in the widget's manifest.

```typescript
// Store persistent data
await sdk.kv.set('count', 42)       // requires "kv" capability
const val = await sdk.kv.get('count')

// Fetch from an API (proxied through main process, no CORS)
const res = await sdk.fetch('https://api.example.com/data')  // requires "network" + allowedHosts

// Control a webportal from a compound widget
await sdk.portal.navigate('my-portal', 'https://mail.google.com')  // requires "portal-control"
await sdk.portal.injectCSS('my-portal', 'body { background: #000; }')
await sdk.portal.onStateChange('my-portal', (state) => {
  console.log(state.url, state.title, state.canGoBack)
})

// Widget properties — declared in manifest, live-updated via panel or meta.json
const bg = await sdk.props.get('bgColor')       // no capability needed
sdk.props.onChange('bgColor', (val) => {         // fires instantly on panel edit
  document.body.style.background = val
})

// Wire widgets together via dataflow
sdk.emit('searchQuery', 'is:unread')  // connected widgets/portals receive the value
sdk.on('selectedItem', (item) => { ... })
```

### Widget properties

Widgets declare configurable props in their manifest — type, default, label. Values are stored per-instance in `meta.json` and editable in the properties panel. Changes are delivered live to the widget via SDK — no rebuild needed.

Prop types: `string`, `number`, `boolean`, `color`, `select`, `scene`, `array`, `media`.

### Media library

All media lives in `~/Dimensions/_media/` — centralized and deduplicated by content hash. Upload once, reference everywhere. The `media` prop type stores arrays of asset URLs with MIME-based filtering (`accept: ["image/*"]`), a visual picker modal with library browsing and drag-to-reorder, and live thumbnail previews in the properties panel. Media references are tracked per-widget — deleting a file from the library automatically removes it from all widget props.

### Compound widgets

A compound widget wraps child widgets into one unit. The compound's `index.html` renders the container UI (e.g., browser chrome), and child webportals are positioned as WCVs by the main process.

```json
{
  "type": "compound",
  "capabilities": ["portal-control"],
  "targetPortals": ["my-portal"],
  "children": [
    { "id": "my-portal", "type": "webportal", "url": "https://github.com",
      "layout": { "anchor": "fill", "top": 38 } }
  ]
}
```

The compound's source code renders a URL bar and uses `sdk.portal.*` to control the child portal. The portal fills everything below the 38px chrome bar. Move/resize the compound — everything moves together.

## Getting started

```bash
git clone https://github.com/dimensions-app/dimensions
cd dimensions
npm install
npm run dev
```

On first launch, the app creates `~/Dimensions/home/` with a starter scene. No sign-in, no setup — start building immediately.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+E` | Toggle edit mode (toolbar + right editor panel) |
| `Cmd+S` | Toggle scene sidebar (left panel — scene navigation) |
| `Cmd+K` | Command palette |
| `Cmd+1` / `Cmd+2` | Claude Code terminal / No-code panel |
| `Cmd+[` / `Cmd+]` | Navigate back / forward |
| `` Cmd+` `` | Focus terminal |
| `Cmd+Shift+F` | Toggle Live / Files view |
| `Cmd+`+`/`-` | Zoom in / out |
| `Cmd+0` | Reset zoom |

## Tech stack

| Package | Purpose |
|---|---|
| Electron | Desktop shell, WebContentsView management |
| React + TypeScript | Renderer UI |
| Tailwind CSS v4 | Styling (all theming via CSS custom properties in one file) |
| Radix UI + Lucide | Accessible primitives, icons |
| Zustand | State management |
| node-pty + xterm.js | Integrated terminal |
| sql.js | SQLite via WASM (zero native module hassle) |
| esbuild + chokidar | Widget compilation + file watching |
| Zod | Schema validation for all data files |
| Framer Motion | Animations |

## Security model

| Layer | Isolation | Access |
|---|---|---|
| Renderer | Trusted | App chrome only |
| Scene WCV | Sandboxed | SDK via postMessage |
| Webportal WCVs | Most sandboxed | Web only, no SDK, no preload |
| Widget iframes | `sandbox` attribute | SDK via postMessage |

- Every SDK call is capability-gated — widgets declare capabilities in their manifest, main process checks on every IPC call
- Portal state updates only sent to widgets with `portal-control` capability + matching `targetPortals`
- Network requests proxied through main process, host-checked against manifest allowlist
- Environment variables stored in OS keychain via `safeStorage`, never in files or SQLite
- Path traversal blocked at every boundary (`assertPathWithin` on all file operations)
- IPC channels explicitly whitelisted in preload scripts, data sanitized on every bridge crossing
- Webportal content WCVs get **no preload and no SDK access** — fully isolated from the app
- Portal popups blocked via `setWindowOpenHandler` — external links open in default browser
- **All downloads require explicit user confirmation** — app-level modal shows filename, size, source domain before any bytes are written to disk. 60-second auto-cancel timeout. Portal cannot bypass, dismiss, or auto-confirm. Critical for V2 multiplayer where others share dimensions with embedded webportals
- Audio/video explicitly stopped before any WCV destruction
- Terminal PTY processes scoped to scene folder
- GUI-launched PATH resolution ensures terminals work when opened from Finder/Dock

## Roadmap

See [`docs/future-features/`](docs/future-features/) for what's planned:
- [**Multiplayer**](docs/future-features/multiplayer.md) — remote scenes, user accounts, shared workspaces
- [**Store**](docs/future-features/store.md) — publish and install dimensions and widgets
- [**Vercel Sync**](docs/future-features/vercel-sync.md) — deploy scenes as hosted web apps

## Status

Active development. V1 is single-player, local-only. Open source, Apache-2.0 licensed.

## Contributing

Contributions welcome. See the [PRD](PRD.md) for product context and the full spec.
