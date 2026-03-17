# Dimensions

Your AI assistant should be able to build you software — not just write code, but create the actual interfaces you use every day. Dimensions makes that possible.

It's a desktop environment where AI tools like Claude Code can spin up fully custom workspaces, workflows, and interfaces on the fly. Embed real websites, build bespoke widgets, wire things together, and use it all immediately — no deploy, no config, no waiting.

## What it does

- **Custom interfaces, instantly.** Claude Code (or any AI agent) builds you exactly the UI you need — a morning dashboard, a research workspace, a media control panel — as a scene made of widgets, webportals, and terminals.
- **Real web apps, embedded.** Gmail, GitHub, Notion — rendered natively via Electron WebContentsViews, not iframes. Restyle them with CSS injection to fit your setup.
- **Rich media.** Images, video, audio, custom visualizations — all first-class in custom widgets.
- **Persistent.** Storage, state, and layout survive between sessions. Your workspaces are yours.
- **Scenes link to scenes.** Navigate between workspaces with `dimensions://` links. Build flows — a morning routine that moves from inbox triage to calendar to focus mode.
- **Dimensions.** Group related scenes into packages with shared config, ordered flows, and isolated storage. The natural unit for sharing workflows.
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
      meta.json
      widgets/
        _background/            # every scene gets a customizable background widget
          src/index.html
        email-summary/
          src/index.html        # Claude Code writes this
          dist/bundle.html      # esbuild compiles this
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
  │   ├── Dual-WCV per portal (chrome WCV + content WCV)
  │   ├── Multi-tab support with per-tab navigation state
  │   ├── Pre-warmed WCV pool for instant portal creation
  │   └── CSS injection (dom-ready) + extraction (for Claude Code context)
  ├── File watcher → esbuild → hot reload (~100ms)
  ├── Capability-gated IPC handlers
  ├── Global keyboard shortcuts (Cmd+E, Cmd+K, etc.)
  ├── Terminal manager (node-pty, login shell, scoped per scene)
  ├── dimensions:// protocol (navigation)
  ├── dimensions-asset:// protocol (static file serving)
  └── SQLite database (sql.js/WASM)

Renderer (app chrome, trusted)
  ├── Top bar (scene title, navigation, mode indicator)
  ├── Editor tools panel (Claude Code terminal / no-code properties)
  ├── Command palette (Cmd+K)
  └── Themed with Tailwind CSS + CSS custom properties
```

### Core concepts

- **Scenes** are folders containing widgets, metadata, and wiring
- **Widgets** are self-contained HTML/JS/CSS — custom UIs, embedded websites, or terminals. Every scene includes a `_background` widget that renders full-screen behind everything else — edit it for gradients, animations, canvas, video, live data, anything
- **Webportals** embed real websites (Gmail, GitHub, anything) via dual-WebContentsView architecture — browser chrome WCV (URL bar, tabs, nav) + content WCV (the actual site, fully sandboxed). Supports multiple tabs, CSS injection, and per-domain styling rules
- **Dimensions** group scenes into ordered flows with shared theme and env config. Navigate sequentially with `sdk.navigate.next()` / `previous()`, or jump to any scene. The command palette groups scenes by dimension with breadcrumb navigation
- **`@dimensions/sdk`** gives widgets access to storage, network, navigation, theming, portal control, and more — all capability-gated
- **Dataflow** wires widgets together — a schedule widget can drive a portal's URL, a theme widget can inject CSS into portals, outputs from one widget feed inputs to another via `connections.json`
- **Two protocols:** `dimensions://` for navigation, `dimensions-asset://` for static file serving — separated for security

### Edit mode / Use mode

**Use mode** (default): App chrome hidden. Scene fills the window. The scene defines all interaction — the app imposes nothing. Could be a dashboard, a workspace, a game, anything.

**Edit mode** (`Cmd+E`): App chrome appears — top bar with scene title and navigation, right panel with a Claude Code terminal (scoped to the scene folder) or a no-code properties panel. Widgets show drag/resize handles. Webportals freeze for interaction passthrough. All changes persist to `meta.json` on disk.

### Widget SDK

Widgets communicate through `@dimensions/sdk` — a lightweight postMessage bridge that routes through the main process. Every SDK method requires a declared capability in the widget's manifest. Capabilities are checked on every IPC call.

```typescript
// Store persistent data
await sdk.kv.set('count', 42)       // requires "kv" capability
const val = await sdk.kv.get('count')

// Fetch from an API (proxied through main process, no CORS)
const res = await sdk.fetch('https://api.example.com/data')  // requires "network" + allowedHosts

// Control a webportal from a custom widget
await sdk.portal.navigate('email-portal', 'https://mail.google.com')  // requires "portal-control"
await sdk.portal.injectCSS('email-portal', 'body { background: #000; }')

// Wire widgets together via dataflow
sdk.emit('searchQuery', 'is:unread')  // other widgets/portals connected to this output receive the value
sdk.on('selectedItem', (item) => { ... })  // receive values from connected widgets
```

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
| `Cmd+E` | Toggle edit mode |
| `Cmd+K` | Command palette |
| `Cmd+1` / `Cmd+2` | Claude Code terminal / No-code panel |
| `Cmd+[` / `Cmd+]` | Navigate back / forward |
| `` Cmd+` `` | Focus terminal |
| `Cmd+Shift+F` | Toggle Live / Files view |

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
| tinykeys | Keyboard shortcuts (renderer fallback) |

## Security model

| Layer | Isolation | Access |
|---|---|---|
| Renderer | Trusted | App chrome only |
| Scene WCV | Sandboxed | SDK via postMessage |
| Webportal WCVs | Most sandboxed | Web only, no SDK |
| Widget iframes | `sandbox` attribute | SDK via postMessage |

- Every SDK call is capability-gated — widgets declare capabilities in their manifest, main process checks on every IPC call
- Network requests proxied through main process, host-checked against manifest allowlist
- Environment variables stored in OS keychain via `safeStorage`, never in files or SQLite
- Path traversal blocked at every boundary (`assertPathWithin` on all file operations)
- IPC channels explicitly whitelisted in preload scripts, data sanitized on every bridge crossing (`__proto__`, `constructor`, `prototype` stripped)
- Webportal content WCVs get **no preload and no SDK access** — fully isolated from the app. Chrome WCVs get a minimal preload for navigation commands only
- Portal popups blocked via `setWindowOpenHandler` — external links open in default browser
- Audio/video explicitly stopped before any WCV destruction (mute → pause → clear src)
- Terminal PTY processes scoped to scene folder — no access outside `~/Dimensions/`
- Global shortcuts guarded by focus check — don't fire when app isn't focused
- GUI-launched PATH resolution ensures terminals work when opened from Finder/Dock

## Roadmap

See [`docs/future-features/`](docs/future-features/) for what's planned:
- [**Multiplayer**](docs/future-features/multiplayer.md) — remote scenes, user accounts, shared workspaces
- [**Store**](docs/future-features/store.md) — publish and install dimensions and widgets
- [**Vercel Sync**](docs/future-features/vercel-sync.md) — deploy scenes as hosted web apps

## Status

Active development. V1 is single-player, local-only. Open source, MIT licensed.

## Contributing

Contributions welcome. See the [PRD](PRD.md) for product context and the full spec.
