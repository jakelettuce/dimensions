# Vercel Sync

## Overview

Let users deploy their scenes and dimensions as publicly accessible web apps hosted on Vercel. Your Dimensions workspace becomes a website — same scenes, same widgets, running in a browser instead of Electron.

## Why This Matters

- You build a workflow locally → one click → it's a URL anyone can visit
- Private by default, but can be opened up or gated with Vercel auth
- Turns Dimensions from a personal tool into a publishing platform
- Scenes are already HTML/JS/CSS — the gap between local Electron and hosted web app is small

## How It Works

1. User connects their Vercel account (OAuth token stored in OS keychain)
2. Selects a dimension or scene → "Deploy to Vercel"
3. App generates a static export:
   - Widget bundles (already compiled HTML)
   - Scene layout rendered as a static page or lightweight SPA
   - SDK calls that require main process (KV, env, secrets) are swapped for Vercel-compatible backends (KV → Vercel KV or Edge Config, secrets → Vercel env vars)
4. Deployed via Vercel API
5. User gets a URL: `morning-routine.vercel.app`

## Auth & Privacy

- **Public:** anyone can visit
- **Private:** gated by Vercel Authentication (password, OAuth, email allowlist)
- **Team:** shared with specific Vercel team members
- User controls this per-deployment from the Dimensions app or Vercel dashboard

## SDK Translation Layer

Not all SDK features translate 1:1 to web:

| SDK Feature | Electron (local) | Vercel (deployed) |
|---|---|---|
| `sdk.kv.*` | SQLite | Vercel KV / Edge Config |
| `sdk.env.get()` | OS keychain | Vercel environment variables |
| `sdk.fetch()` | Node.js proxy | Vercel serverless function proxy |
| `sdk.secrets.*` | OS keychain | Vercel environment variables (encrypted) |
| Webportals | WebContentsView | iframe (with CORS limitations) |
| Terminal widgets | node-pty | Not supported (excluded from export) |
| `sdk.navigate.*` | dimensions:// protocol | Client-side routing |

## Limitations

- Webportals degrade to iframes — many sites block iframe embedding (X-Frame-Options). CSS injection won't work the same way.
- Terminal widgets can't be deployed — they're excluded from the export with a placeholder message.
- Some SDK capabilities require a serverless backend (fetch proxy, KV) — Vercel functions handle this but add latency.

## Open Questions

- Should deployed scenes auto-update when the local version changes? Or explicit re-deploy?
- How to handle assets (images, videos) — upload to Vercel Blob?
- Should there be a `vercel.json` equivalent in the dimension config for custom domains, redirects, etc.?
