# Dimensions V1 — Product Requirements Document

**Scope:** Single-player, local-only, macOS + Windows
**Status:** Active development

---

## 1. What This Is

A desktop app where AI agents (Claude Code, etc.) build you custom interfaces, workspaces, and workflows. You describe what you want, it gets built into a scene you can use immediately. Scenes embed real websites, custom widgets, terminals — anything you need. Scenes link together into flows. Everything persists locally.

V1 is single-player: you build and use your own scenes on your own machine. Sharing, accounts, and multiplayer are V2.

---

## 2. Core Primitives

### Scene
A folder on disk. Contains all widgets, metadata, assets, and wiring for one workspace. Scenes are the unit of navigation — every screen is a scene.

```
~/Dimensions/
  home/
    meta.json                 # layout, theme, widget instances
    connections.json           # dataflow wiring between widgets
    CLAUDE.md                  # auto-generated, Claude Code reads this
    widgets/
      my-widget/
        src/
          index.html
          widget.manifest.json
        dist/
          bundle.html          # esbuild output
        assets/
      my-portal/
        src/
          widget.manifest.json
        portal-rules.json      # CSS injection rules per domain
```

### Widget
A self-contained piece of a scene. Lives in its own subfolder. Types:

| Type | What it is |
|---|---|
| **Custom** | HTML/JS/CSS built by Claude Code, compiled by esbuild. Handles everything — media, text, visualizations, controls, whatever you need. |
| **Webportal** | Real website in a WebContentsView — Gmail, GitHub, anything |
| **Terminal** | node-pty + xterm.js shell, scoped to scene folder |

### Background Widget

Every scene automatically includes a `_background` widget at `widgets/_background/`. It renders full-screen behind all other widgets at z-index 0 — no drag/resize handles in edit mode.

The background is a regular custom widget with full SDK access. By default it's a solid `#0a0a0a` background. Edit `widgets/_background/src/index.html` to customize:
- Gradients, CSS animations, color cycles
- Canvas/WebGL (particles, generative art, visualizations)
- Video backgrounds (`<video>` with `object-fit: cover`)
- Live data (fetch APIs via `sdk.fetch()`, display weather, stocks, etc.)

The `theme.background` in `meta.json` is a fallback color shown while widgets load — it's not the actual background. The `_background` widget is the actual background.

### Dimension
A group of related scenes packaged together. A dimension is a folder containing scene folders plus a `dimension.json` manifest. Standalone scenes live at the top level.

```
~/Dimensions/
  morning-routine/                # a dimension
    dimension.json                # title, scene order, shared theme, shared env keys
    inbox/
      meta.json
      widgets/...
    calendar/
      meta.json
      widgets/...
    focus/
      meta.json
      widgets/...
  home/                           # standalone scene (top level)
    meta.json
    widgets/...
  scratch/                        # standalone scene
    meta.json
    widgets/...
```

**`dimension.json`:**
```json
{
  "id": "ulid",
  "title": "Morning Routine",
  "scenes": ["inbox", "calendar", "focus"],
  "theme": { "background": "#0a0a0a", "accent": "#7c3aed" },
  "sharedEnvKeys": ["GOOGLE_API_KEY"]
}
```

What dimensions give you beyond mental organization:
- **Shared config** — theme, env bindings, KV namespace inherited by all scenes in the dimension
- **Ordered flows** — `scenes` array defines a sequence. "Start morning routine" → scene 1 → 2 → 3
- **Navigation scope** — back/forward scoped within a dimension, command palette groups by dimension
- **Sharing unit** — dimensions are the natural package for sharing workflows with others (V2)
- **Isolation** — installing someone else's dimension gives it its own KV namespace and env grants

### Scene Navigation
`dimensions://` is a custom protocol registered with the OS. App-level routes and user content are separated:

```
App routes (built-in):
  dimensions://home                              → home screen
  dimensions://settings                          → settings
  dimensions://settings/env                      → env variable management

User content (prefixed with /go/):
  dimensions://go/scratch                        → standalone scene
  dimensions://go/morning-routine                → dimension (loads first scene)
  dimensions://go/morning-routine/inbox          → scene within a dimension
  dimensions://go/morning-routine/inbox#email    → deep link to widget
```

The `/go/` prefix cleanly separates user-created content from application routes. App routes are reserved and cannot be used as scene/dimension slugs. Widgets and scenes link to each other with these URLs. The app intercepts navigation and routes it.

A separate `dimensions-asset://` protocol handles static file serving (images, widget bundles, media). It is read-only with path traversal protection. Separating navigation from file serving provides clean security boundaries — a bug in one can't escalate through the other. In V2 multiplayer, the asset resolver switches from local filesystem to CDN without changing widget code.

---

## 3. Architecture

### Process Model

```
Main Process (Node.js, fully trusted)
  ├── Window manager
  ├── Scene WCV manager (one WebContentsView per window, always alive)
  ├── Webportal WCV pool (1 pre-warmed blank per window)
  ├── File watcher (chokidar) → esbuild → hot reload
  ├── IPC handlers (capability-gated SDK calls)
  ├── Capability modules (pluggable)
  ├── dimensions:// protocol resolver (navigation, routing)
  ├── dimensions-asset:// protocol handler (static file serving, read-only)
  ├── SQLite database (sql.js — WASM, no native modules)
  ├── Env/secrets manager
  └── CLAUDE.md generator

Renderer Process (app chrome, trusted)
  ├── Top bar (scene title, mode indicators)
  ├── Editor tools panel (Claude Code terminal / no-code panel)
  ├── Content area (Live view / Files view with Monaco)
  └── Cmd+K command palette

Scene WCV (one per window, sandboxed)
  └── Renders scene HTML + widget iframes
      Communicates via postMessage → IPC only

Webportal WCVs (N per window, most sandboxed)
  └── Real websites, no SDK access, positioned over widget slots
```

### Live Editing Loop

```
Claude Code writes widget/src/index.html
  → chokidar detects change
  → esbuild compiles src/ → dist/bundle.html (~50-100ms)
  → main sends IPC to scene WCV
  → scene reloads that widget's iframe
  → other widgets untouched
```

### Multiple Windows
Each window is independent: own scene WCV, own webportal pool, own edit mode state. `Cmd+N` opens a new window.

---

## 4. Storage

### Decision: SQLite (via sql.js) + Files

Scene structure lives as **files on disk** (inspectable, git-friendly, Claude Code reads/writes them directly). All queryable/indexable data lives in **SQLite** (fast, single-file).

**Why sql.js over better-sqlite3:** sql.js compiles SQLite to WASM — zero native modules, no node-gyp, no `@electron/rebuild`, no `asarUnpack` hacks. Works identically on every platform and every Electron version with zero build toolchain configuration. The tradeoff is ~2x slower than native bindings, which is irrelevant at our data volumes (thousands of rows, single-digit millisecond queries either way). sql.js runs in-memory and serializes the full DB to disk on writes — for a DB measured in kilobytes, this is a non-issue. Writes are debounced and auto-saved.

| Data | Where | Why |
|---|---|---|
| Scene layout, widget positions, theme | `meta.json` | Claude Code edits this directly |
| Widget source code | `widgets/*/src/` | Claude Code writes this |
| Widget manifests | `widget.manifest.json` | Inspectable, per-widget |
| Dataflow wiring | `connections.json` | Inspectable, scene-level |
| Portal CSS rules | `portal-rules.json` | Per-portal, editable |
| Widget KV storage | SQLite `kv` table | Fast read/write, no file sprawl |
| Scene index (titles, slugs, thumbnails) | SQLite `scenes` table | Fast search/listing |
| Capability grants | SQLite `grants` table | Track user-approved permissions |
| Navigation history | SQLite `history` table | Back/forward, recent scenes |
| Env variable bindings | SQLite `env_bindings` table | Which widgets can access which vars |

### SQLite Schema (core tables)

```sql
-- Widget key-value storage
CREATE TABLE kv (
  widget_id TEXT NOT NULL,
  scene_id  TEXT NOT NULL,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,  -- JSON-encoded
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (widget_id, scene_id, key)
);

-- Scene index (rebuilt from disk on startup if stale)
CREATE TABLE scenes (
  id         TEXT PRIMARY KEY,
  slug       TEXT UNIQUE NOT NULL,
  title      TEXT NOT NULL,
  path       TEXT NOT NULL,
  thumbnail  TEXT,
  updated_at INTEGER NOT NULL
);

-- Capability grants (user-approved permissions)
CREATE TABLE grants (
  widget_id  TEXT NOT NULL,
  capability TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (widget_id, capability)
);

-- Env variable bindings
CREATE TABLE env_bindings (
  widget_id TEXT NOT NULL,
  env_key   TEXT NOT NULL,  -- e.g. "OPENAI_API_KEY"
  PRIMARY KEY (widget_id, env_key)
);

-- Navigation history
CREATE TABLE history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scene_id   TEXT NOT NULL,
  timestamp  INTEGER NOT NULL
);
```

### SQLite Location & Persistence
`~/Dimensions/dimensions.db` — single file, next to the scenes folder. sql.js loads the entire DB into memory on startup and writes the full file on changes (debounced, ~50ms delay). If deleted, the app rebuilds the scene index from disk. KV data would be lost (acceptable for v1 — KV is convenience storage, not critical state).

---

## 5. Capabilities Framework

Capabilities are the permission system. Every SDK method requires a declared capability in the widget's manifest. The main process checks capabilities on every IPC call. Undeclared = silent reject + log.

### Design Principle: Pluggable Modules

Each capability is a self-contained module:

```typescript
// capabilities/network.ts
export const networkCapability: CapabilityModule = {
  name: 'network',
  manifestFields: {
    allowedHosts: { type: 'string[]', required: true }
  },
  register(ipc: IPCRouter, db: Database) {
    ipc.handle('sdk:fetch', async (event, widgetId, url, options) => {
      const widget = getWidget(widgetId)
      assertCapability(widget, 'network')
      assertAllowedHost(widget, url)
      return nodeFetch(url, options)
    })
  }
}
```

Adding a new capability = adding a new module file + registering it. No changes to core.

### V1 Capability List

| Capability | SDK Surface | Manifest Fields | Description |
|---|---|---|---|
| `kv` | `sdk.kv.*` | — | Per-widget key-value storage in SQLite |
| `assets` | `sdk.assets.*` | — | Upload/resolve local media assets |
| `network` | `sdk.fetch()` | `allowedHosts: string[]` | HTTP requests proxied through main process |
| `websocket` | `sdk.ws.*` | `allowedWsHosts: string[]` | WebSocket connections proxied through main |
| `env` | `sdk.env.get()` | `envKeys: string[]` | Read bound environment variables |
| `secrets` | `sdk.secrets.*` | — | OS keychain storage (Keychain / Credential Store) |
| `editing` | `sdk.editing.*` | — | Move/resize widgets programmatically |
| `dataflow` | `sdk.emit/on` | — | Wire inputs/outputs between widgets |
| `navigate` | `sdk.navigate.*` | — | Scene-to-scene navigation |
| `theme` | `sdk.theme.*` | — | Read/subscribe to scene theme variables |
| `terminal` | PTY via IPC | — | Spawn terminal in widget (sandboxed) |
| `portal-control` | `sdk.portal.*` | `targetPortals: string[]` | Control webportals from custom widgets |
| `clipboard` | `sdk.clipboard.*` | — | Read/write system clipboard |
| `notifications` | `sdk.notify()` | — | OS-level notifications |

`sdk.scene.*` (scene id, title) is always available — no capability required.

### API Integration Pattern

Widgets that talk to external APIs use the `network` + `env` capabilities together:

```json
// widget.manifest.json
{
  "capabilities": ["network", "env"],
  "allowedHosts": ["api.openai.com", "api.anthropic.com"],
  "envKeys": ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"]
}
```

```typescript
// widget code
const apiKey = await sdk.env.get('OPENAI_API_KEY')
const res = await sdk.fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({ model: 'gpt-4', messages: [...] })
})
```

The main process:
1. Checks `network` capability declared
2. Checks URL host is in `allowedHosts`
3. Checks `env` capability declared
4. Checks `OPENAI_API_KEY` is in `envKeys`
5. Looks up the env binding in SQLite — resolves to actual value from env store
6. Proxies the request from Node.js (no CORS issues)

### Environment Variables

Users configure env vars through the app (not raw `.env` files):

```
Settings → Environment Variables
  OPENAI_API_KEY     = sk-...   [stored in OS keychain]
  GITHUB_TOKEN       = ghp_...  [stored in OS keychain]
  WEATHER_API_KEY    = abc123   [stored in OS keychain]
```

When a widget first requests an env var it hasn't been granted:

```
"morning-weather" wants to access WEATHER_API_KEY.
[Allow Once]  [Always Allow]  [Deny]
```

"Always Allow" creates a row in the `env_bindings` table. Subsequent calls skip the prompt.

Sensitive values (API keys, tokens) are stored in the OS keychain via `keytar` or Electron's `safeStorage`. The SQLite `env_bindings` table only records *which widget can access which key* — never the value itself.

### Adding New Capabilities (Scalability)

To add a capability (e.g., `bluetooth`, `filesystem`, `midi`):

1. Create `capabilities/bluetooth.ts` implementing `CapabilityModule`
2. Register it in the capability loader
3. Add SDK surface methods to `@dimensions/sdk`
4. Done — existing capabilities untouched

---

## 6. @dimensions/sdk

NPM package. Injected by the host into every widget context. Widgets never bundle it.

```typescript
// Always available
sdk.scene.id(): string
sdk.scene.title(): string

// kv — requires "kv"
sdk.kv.get(key: string): Promise<any>
sdk.kv.set(key: string, value: any): Promise<void>
sdk.kv.delete(key: string): Promise<void>
sdk.kv.list(prefix?: string): Promise<string[]>

// assets — requires "assets"
sdk.assets.upload(file: File): Promise<string>      // returns dimensions-asset:// URL
sdk.assets.resolve(assetUrl: string): Promise<string> // dimensions-asset:// → usable URL
sdk.assets.list(): Promise<AssetInfo[]>

// network — requires "network"
sdk.fetch(url: string, options?: RequestInit): Promise<SDKResponse>

// websocket — requires "websocket"
sdk.ws.connect(url: string): Promise<WSConnection>
// WSConnection: { send(data), on(event, cb), close() }

// env — requires "env"
sdk.env.get(key: string): Promise<string | null>

// secrets — requires "secrets"
sdk.secrets.get(key: string): Promise<string | null>
sdk.secrets.set(key: string, value: string): Promise<void>
sdk.secrets.delete(key: string): Promise<void>

// editing — requires "editing"
sdk.editing.setWidgetBounds(id: string, bounds: Bounds): Promise<void>
sdk.editing.getWidgetBounds(id: string): Promise<Bounds>
sdk.editing.selectWidget(id: string): Promise<void>

// dataflow — requires "dataflow"
sdk.emit(outputKey: string, value: any): void
sdk.on(inputKey: string, cb: (value: any) => void): void

// navigate — requires "navigate"
sdk.navigate.to(url: string): void     // dimensions://scene-slug
sdk.navigate.back(): void
sdk.navigate.forward(): void

// theme — requires "theme"
sdk.theme.get(): Promise<ThemeVars>
sdk.theme.onChange(cb: (vars: ThemeVars) => void): void

// portal-control — requires "portal-control"
sdk.portal.navigate(portalWidgetId: string, url: string): Promise<void>
sdk.portal.injectCSS(portalWidgetId: string, css: string, key?: string): Promise<void>
sdk.portal.removeCSS(portalWidgetId: string, key: string): Promise<void>
sdk.portal.newTab(portalWidgetId: string, url?: string): Promise<string>  // returns tabId
sdk.portal.closeTab(portalWidgetId: string, tabId: string): Promise<void>
sdk.portal.switchTab(portalWidgetId: string, tabId: string): Promise<void>
sdk.portal.getState(portalWidgetId: string): Promise<PortalState>

// clipboard — requires "clipboard"
sdk.clipboard.read(): Promise<string>
sdk.clipboard.write(text: string): Promise<void>

// notifications — requires "notifications"
sdk.notify(title: string, body?: string): Promise<void>

// widget properties — always available, no capability required
sdk.props.get(key: string): Promise<any>
sdk.props.getAll(): Promise<Record<string, any>>
sdk.props.onChange(key: string, cb: (value: any) => void): void
sdk.props.onAnyChange(cb: (props: Record<string, any>) => void): void
```

### Widget Properties

Props are declared in the widget manifest, stored per-instance in `meta.json`, and editable in the properties panel. Changes are delivered live to the widget via SDK — no rebuild needed.

Props are always available (no capability required) — a widget reading its own configuration is not a privileged operation.

**Prop types:** `string` (with maxLength), `number` (with min/max/step), `boolean`, `color`, `select` (with options), `scene`, `array` (with itemType: "string" | "number")

**Effective value resolution:** `meta.json props[key]` → `manifest props[key].default` → `undefined`

**Validation:** Every prop value is validated against its declared type before persisting. Color values must be valid CSS hex/rgb/hsl. Array items are validated against `itemType`. Strings capped at 10KB. Numbers checked against min/max.

### SDK Package Contents

```
@dimensions/sdk/
  src/
    index.ts       # Runtime — postMessage bridge (~300 lines)
    types.ts       # All TypeScript interfaces
    mock.ts        # Stub implementation for testing outside the app
  package.json
```

---

## 7. Widget Manifest & Instance IDs

### Widget Type vs Widget Instance

A widget **manifest** declares the widget *type* — what it is and what it needs. The manifest `id` is a human-readable name (e.g. `"morning-weather"`) and identifies the *kind* of widget.

A widget **entry** in `meta.json` is an *instance* of a widget type placed in a scene. Each entry has a ULID `id` that is unique per placement. This means you can place the same widget type multiple times in a scene — each gets its own ULID, its own KV storage, its own position.

```
Widget manifest (type):   "morning-weather"    ← human-readable, shared
Widget entry (instance):  "01ABC123..."         ← ULID, unique per placement
```

**Widget manifest (`widget.manifest.json`):**
```json
{
  "id": "morning-weather",
  "type": "custom",
  "title": "Weather Dashboard",
  "capabilities": ["network", "env", "kv"],
  "allowedHosts": ["api.openweathermap.org"],
  "envKeys": ["WEATHER_API_KEY"],
  "inputs": [
    { "key": "location", "type": "string", "default": "San Francisco" }
  ],
  "outputs": [
    { "key": "temperature", "type": "number" }
  ],
  "props": [
    { "key": "units", "type": "select", "options": ["metric", "imperial"], "default": "imperial", "label": "Units" },
    { "key": "refreshInterval", "type": "number", "default": 300, "label": "Refresh (seconds)" }
  ]
}
```

**Widget entry in `meta.json`:**
```json
{
  "id": "01JRQX7B00WEATHER00001",
  "widgetType": "morning-weather",
  "manifestPath": "widgets/morning-weather/src/widget.manifest.json",
  "bounds": { "x": 50, "y": 50, "width": 400, "height": 300 }
}
```

The instance ULID is what gets passed through the SDK as `widgetId`. KV storage, capability grants, and env bindings are all scoped per instance — two weather widgets in the same scene have independent data.

Validated with Zod on load. Invalid manifest = widget won't mount + clear error in editor.

---

## 8. Edit Mode / Use Mode

### Top Bar (always visible)

The top bar is always visible in both edit and use mode. It shows the scene title, dimension breadcrumbs (if in a dimension), mode indicator, and navigation buttons. The scene WCV is always offset by the top bar height.

### Edit Mode (`Cmd+E`)

Editor tools panel appears on the right. Scene enters editing state.

- Widget drag/resize handles rendered by the scene
- Webportal WCVs: `setIgnoreMouseEvents(true)` (visible but frozen)
- Editor tools panel: Claude Code terminal OR no-code properties
- Content area: Live view OR Files view (Monaco editor)
- `Cmd+K` command palette available

### Scene Sidebar (`Cmd+S`)

A left-side navigation panel for quickly switching between scenes. Works independently of edit mode — can be open in use mode or edit mode. Shows:
- Current dimension title and ordered scene list (with current scene highlighted)
- Standalone scenes
- "New Scene" button

The scene WCV and portal WCVs reposition when the sidebar toggles, using the same abstracted bounds calculation as edit mode. All four layout states compose: use mode alone, sidebar alone, edit mode alone, or both together.

### Use Mode (default)

Top bar remains visible. Editor tools panel hidden. Scene fills the remaining space. The scene defines all interaction — the app imposes nothing. Could be a dashboard, a workspace, a game, anything.

- Webportal WCVs: fully interactive
- `Cmd+E` to enter edit mode
- `Cmd+S` to toggle scene sidebar
- `Cmd+K` still available (palette overlays, WCVs hide)

---

## 9. Installation & First Launch

### Install (V1 — local dev)

```bash
git clone https://github.com/dimensions-app/dimensions
cd dimensions
npm install
npm run dev
```

That's it. No installers, no signing, no Homebrew/winget. V1 users clone and run locally. Packaged distribution (DMG, NSIS, auto-updates) is deferred to V2.

### First Launch

1. App creates `~/Dimensions/home/` if it doesn't exist
2. Home scene loads with a starter layout — clean canvas with a terminal widget
3. Terminal runs `claude` if installed, otherwise plain shell
4. No sign-in, no setup, no config — user starts building immediately

### Setting Up Environment Variables

On first launch or anytime via settings:

```
Settings → Environment Variables → Add
  Name:  OPENAI_API_KEY
  Value: sk-...
  [Save]  ← stored in OS keychain
```

Widgets request access to specific keys. User approves per-widget.

---

## 10. AI Agent Context Files (Auto-Generated)

Every scene folder gets auto-generated context files that AI coding tools read automatically. The same content is written to multiple filenames so every major tool finds it:

| File | Tool |
|---|---|
| `CLAUDE.md` | Claude Code |
| `AGENTS.md` | OpenAI Codex CLI |
| `GEMINI.md` | Google Gemini CLI |
| `.cursorrules` | Cursor |
| `CONTEXT.md` | Generic / other tools |

All files are identical — generated from a single source in `agent-context.ts`. To update what agents see, edit `generateAgentContextContent()` in one place. To add a new tool, add one filename to the `AGENT_CONTEXT_FILES` array and `.gitignore`.

Regenerated when a scene opens and after each widget build.

Contents:
- Scene title, active widgets with IDs/types/positions
- Full `@dimensions/sdk` API reference (all methods with signatures)
- Widget manifest schema
- Compound widget docs with step-by-step browser example
- Dataflow wiring format
- Webportal CSS injection format
- Layout system docs (canvas mode + layout mode with examples)
- Build conventions (file structure, esbuild expectations)

This is what makes the AI-builds-your-interface loop work — any AI coding tool always has full context about the scene it's editing and the SDK it has access to.

---

## 11. CSS Injection (Webportals)

When a webportal loads a page:

1. Main process extracts `<link>` stylesheet URLs via `webContents.executeJavaScript()`
2. Fetches CSS via Node.js fetch (clean session, no cookies)
3. Sanitizes (strips external `url()` calls except fonts, size-capped at 200KB)
4. Writes to `widgets/my-portal/site-styles/github.com.css`
5. CLAUDE.md references this file — Claude Code can read the site's CSS
6. Claude Code writes targeted rules to `portal-rules.json`
7. App applies rules via `webContents.insertCSS()` on page load

Multiple rules per domain stack in order. CSS is injected on `dom-ready` (before paint) to prevent flash of unstyled content. Injected CSS is reapplied on every navigation since `insertCSS()` doesn't persist across page loads.

### Webportal Architecture

A webportal is a single sandboxed WebContentsView (no preload, no SDK) that renders a real website. There is no built-in browser chrome — portals are bare content primitives. All browser controls (URL bar, back/forward, tabs) are built as custom widgets that control the portal via `sdk.portal.*`.

This means users can:
- Build any browser chrome they want (or none at all for chrome-less embeds)
- Create compound widgets that package chrome + portal as one unit
- Control portals from any widget via the SDK
- Build custom tab managers, sidebars, or navigation UIs

Portals support: multiple tabs with per-tab navigation state, CSS injection (dom-ready), CSS extraction for Claude Code context, downloads (auto-save to ~/Downloads), copy/paste, right-click context menus, and audio detection.

### Compound Widgets

A compound widget wraps child widgets (portals, custom widgets) within its bounds. The compound's `index.html` renders the container UI. Child portals are positioned as WCVs by the main process.

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

Child layout rules:
- `{ "anchor": "top", "height": 36 }` — fixed strip at top
- `{ "anchor": "bottom", "height": 50 }` — fixed strip at bottom
- `{ "anchor": "left", "width": 200 }` — fixed strip at left
- `{ "anchor": "right", "width": 300 }` — fixed strip at right
- `{ "anchor": "fill" }` — remaining space (with optional `top`/`bottom`/`left`/`right` insets)

In edit mode, the compound gets one set of drag/resize handles. Children are internal — moving the compound moves everything.

### Webportal Dataflow

Webportals participate in the dataflow system via special inputs and outputs:

| Direction | Key | Type | Description |
|---|---|---|---|
| Input | `navigateTo` | `string` | Navigate the portal to a URL |
| Input | `injectCSS` | `string` | Inject CSS into the portal |
| Input | `switchTab` | `string` | Switch to a tab by ID |
| Output | `currentUrl` | `string` | Emitted on navigation |
| Output | `pageTitle` | `string` | Emitted on title change |
| Output | `activeTabId` | `string` | Emitted on tab switch |

This means a custom widget can drive portal behavior via `connections.json` — e.g., a schedule widget emitting a URL that navigates the email portal. Custom widgets can also use `sdk.portal.*` methods directly via the `portal-control` capability for programmatic control.

---

## 12. Navigation & Shortcuts

### Cmd+K Command Palette
Primary navigation. Shows recent scenes, navigation history, quick actions (new scene, toggle edit, open files).

### Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Cmd+K` | Command palette |
| `Cmd+E` | Toggle edit mode (top bar + right editor panel) |
| `Cmd+S` | Toggle scene sidebar (left panel — scene navigation) |
| `Cmd+N` | New window |
| `Cmd+T` | New scene |
| `Cmd+[` / `Cmd+]` | Navigate back / forward |
| `Cmd+Ctrl+F` | Toggle fullscreen |
| `` Cmd+` `` | Focus Claude Code terminal |
| `Cmd+1` / `Cmd+2` | Claude Code / No-code panel |
| `Cmd+Shift+F` | Toggle Live / Files view |

---

## 13. Security

### Trust Hierarchy

| Layer | Isolation | Access | Preload |
|---|---|---|---|
| Renderer | Trusted | App chrome, full IPC | Renderer preload (whitelisted channels) |
| Scene WCV | Sandboxed | SDK via postMessage | Scene preload (SDK bridge) |
| Portal content WCV | Most sandboxed | Web only, zero app access | **None** |
| Widget iframes | `sandbox` attribute | SDK via postMessage | Inherited from scene |

### Enforced at Every Boundary

- **Capability gating** — every SDK IPC handler checks widget ID validity + declared capabilities before executing
- **IPC whitelisting** — preload scripts explicitly whitelist allowed channels; all data sanitized on bridge crossing (`__proto__`, `constructor`, `prototype` stripped via JSON round-trip)
- **Path traversal** — `assertPathWithin()` on all file operations; widgets cannot access files outside their scene
- **Network proxy** — all widget HTTP requests proxied through main process, host-checked against manifest `allowedHosts`
- **Secrets encryption** — env variables and secrets stored via Electron `safeStorage` (OS keychain); never in SQLite, never in files, never logged
- **Portal isolation** — content WCVs get no preload, no SDK, no postMessage bridge; popups blocked via `setWindowOpenHandler`, external links opened in default browser; downloads auto-save to ~/Downloads
- **Portal state access control** — portal state updates (URL, title, loading) only sent to widgets with `portal-control` capability and the specific portal in their `targetPortals` manifest field
- **Media cleanup** — audio muted and all media paused/src-cleared before any WCV destruction (prevents phantom audio after app quit)
- **Terminal scoping** — PTY processes spawned with cwd within `~/Dimensions/` only; PATH resolved from login shell at startup for GUI-launched instances
- **Global shortcuts** — guarded by `BrowserWindow.getFocusedWindow()` check; don't fire when app is not focused
- **WebPreferences lockdown** — all WCVs and BrowserWindows enforce: `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`, `webviewTag: false`, `experimentalFeatures: false`, `safeDialogs: true`

---

## 14. Technical Stack

| Dependency | Purpose |
|---|---|
| `electron` | Desktop shell |
| `electron-vite` | Dev/build pipeline |
| `electron-builder` | Installer packaging |
| `react` + `typescript` | Renderer UI |
| `tailwindcss` | Utility-first CSS (all theming via CSS custom properties) |
| `@radix-ui/*` | Unstyled accessible UI primitives |
| `framer-motion` | Animations (command palette, transitions) |
| `tinykeys` | Keyboard shortcut registration |
| `@monaco-editor/react` | Files mode editor |
| `node-pty` + `xterm.js` | Terminal |
| `sql.js` | SQLite via WASM (no native modules) |
| `chokidar` | File watcher |
| `esbuild` | Widget bundler |
| `zod` | Schema validation |
| `zustand` | Renderer state |
| `ulid` | ID generation |
| `safeStorage` | OS-level encryption for secrets |

---

## 15. V1 Scope

### In
- Full Electron app (macOS + Windows)
- Scene-as-folder data model with `_background` widget per scene
- All widget types (custom, webportal, terminal)
- Live editing loop (write → build → reload ~100ms)
- Edit mode / use mode with global shortcuts (Cmd+E, Cmd+K, etc.)
- Editor tools (Claude Code terminal + no-code properties panel)
- Files view (Monaco editor for widget source)
- `@dimensions/sdk` with all V1 capabilities (kv, assets, network, websocket, env, secrets, editing, dataflow, navigate, theme, portal-control, clipboard, notifications)
- Pluggable capability framework
- Single-WCV webportals (no built-in chrome) with tabs, CSS injection (dom-ready), CSS extraction, downloads, copy/paste, context menus
- Compound widgets — group child widgets (portals, custom) with internal layout (anchor system)
- Cross-widget portal control via `sdk.portal.*` and dataflow wiring
- Environment variable management + per-widget grants
- OS keychain secrets storage (safeStorage)
- SQLite (sql.js/WASM) for KV, index, grants, history
- Widget dataflow wiring (connections.json)
- Widget properties system (manifest-declared, panel-editable, live SDK delivery, 7 types)
- `dimensions://` + `dimensions-asset://` protocols
- `Cmd+K` command palette
- CLAUDE.md auto-generation (full SDK reference, build guidance, background widget docs)
- Dimensions (scene grouping with shared config and ordered flows)

### Out (V2+)
- Packaged distribution (DMG, NSIS, Homebrew, winget, auto-updates)
- User accounts / authentication
- Multiplayer / remote scenes
- Widget store + discovery
- Publishing / signing pipeline
- Scene sharing URLs
- CDN delivery
- Vercel sync (host scenes as public webapps)
