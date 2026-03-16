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
    dimension.json
    inbox/                      # scene
      meta.json
      widgets/
        email-summary/
          src/index.html        # Claude Code writes this
          dist/bundle.html      # esbuild compiles this
    calendar/                   # scene
    focus/                      # scene
  home/                         # standalone scene
```

- **Scenes** are folders containing widgets, metadata, and wiring
- **Widgets** are self-contained HTML/JS/CSS components — custom UIs, embedded websites, or terminals
- **Dimensions** group scenes into packages with shared config and ordered flows
- **`@dimensions/sdk`** gives widgets access to storage, network, navigation, theming, and more — all capability-gated
- **Two protocols:** `dimensions://` for navigation, `dimensions-asset://` for static file serving — separated for security

## Getting started

```bash
git clone https://github.com/dimensions-app/dimensions
cd dimensions
npm install
npm run dev
```

On first launch, the app creates `~/Dimensions/home/` with a starter scene. No sign-in, no setup — start building immediately.

## Tech

Electron. React + TypeScript renderer. Scenes rendered in sandboxed WebContentsViews. Widgets communicate through `@dimensions/sdk` (postMessage → IPC → capability-gated handlers). File-based data model — git-friendly, inspectable. SQLite (via sql.js/WASM) for KV storage and indexing.

Key dependencies: electron-vite, esbuild, chokidar, node-pty, xterm.js, Zustand, Zod, Tailwind CSS, Radix UI.

## Security model

| Layer | Isolation | Access |
|---|---|---|
| Renderer | Trusted | App chrome only |
| Scene WCV | Sandboxed | SDK via postMessage |
| Webportal WCVs | Most sandboxed | Web only, no SDK |
| Widget iframes | `sandbox` attribute | SDK via postMessage |

Every SDK call is capability-gated. Widgets declare capabilities in their manifest. The main process checks on every IPC call. Network requests are proxied and host-checked. Env variables stored in OS keychain, never in files. Path traversal blocked at every boundary.

## Roadmap

See [`docs/future-features/`](docs/future-features/) for what's planned:
- [**Multiplayer**](docs/future-features/multiplayer.md) — remote scenes, user accounts, shared workspaces
- [**Store**](docs/future-features/store.md) — publish and install dimensions and widgets
- [**Vercel Sync**](docs/future-features/vercel-sync.md) — deploy scenes as hosted web apps

## Status

Active development. V1 is single-player, local-only. Open source, MIT licensed.

## Contributing

Contributions welcome. See the [PRD](PRD.md) for product context and the full spec.
