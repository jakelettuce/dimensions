# Dimensions

Your AI assistant should be able to build you software — not just write code, but create the actual interfaces you use every day. Dimensions makes that possible.

It's a desktop environment where AI tools like Claude Code can spin up fully custom workspaces, workflows, and interfaces on the fly. Embed real websites, build bespoke widgets, wire things together, and use it all immediately — no deploy, no config, no waiting.

## What it does

- **Custom interfaces, instantly.** Claude Code (or any AI agent) builds you exactly the UI you need — a morning dashboard, a research workspace, a media control panel — as a scene made of widgets, webportals, and terminals.
- **Real web apps, embedded.** Gmail, GitHub, Notion — rendered natively in Electron, not iframes. Restyle them with CSS injection to fit your setup.
- **Rich media.** Images, video, audio, custom visualizations — all first-class.
- **Persistent.** Storage, state, and layout all survive between sessions. Your workspaces are yours.
- **Scenes link to scenes.** Navigate between workspaces with `dimensions://` links. Build flows — a morning routine that moves from inbox triage to calendar to focus mode.
- **Shareable.** Scenes are folders. Share them, remix them, publish them for others.

## How it works

A scene is a folder on disk. Widgets are HTML/JS/CSS. Claude Code writes directly into the scene folder, esbuild compiles it, and the app hot-reloads in ~100ms. You describe what you want, it appears on screen, you use it.

```
You: "Build me a morning routine that starts with my email,
      then shows my calendar, then transitions to a focus timer"

Claude Code: writes three scenes, links them with dimensions://,
             embeds Gmail and Google Calendar as webportals,
             builds a custom focus timer widget

You: using it 30 seconds later
```

## Tech

Electron app. Scenes rendered in sandboxed WebContentsViews. Widgets communicate through a lightweight SDK (`@dimensions/sdk`). File-based data model — git-friendly, inspectable, no magic. Built with React, TypeScript, esbuild, better-sqlite3, node-pty.

## Status

Active development. Open source, MIT licensed.
