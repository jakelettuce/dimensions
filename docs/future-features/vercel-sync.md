# Vercel Sync

> Status: V2+ — not in current scope

## Overview

Deploy scenes and dimensions as publicly accessible web apps on Vercel. Build locally, one click to deploy, get a URL anyone can visit. Same scenes, same widgets — running in a browser instead of Electron.

## Why This Matters

- You build a workflow locally → deploy → it's a URL
- Private by default, can be opened up or gated with Vercel auth
- Turns Dimensions from a personal tool into a publishing platform
- Scenes are already HTML/JS/CSS — the gap between local and hosted is small

## How It Works

1. User connects Vercel account (OAuth token stored in OS keychain)
2. Selects a dimension or scene → "Deploy to Vercel"
3. App generates a static export:
   - Widget bundles (already compiled HTML)
   - Scene layout as a lightweight SPA
   - SDK calls that need main process swapped for Vercel-compatible backends
4. Deployed via Vercel API
5. User gets a URL: `morning-routine.vercel.app`

## Auth & Privacy

- **Public** — anyone can visit
- **Private** — gated by Vercel Authentication (password, OAuth, email allowlist)
- **Team** — shared with specific Vercel team members
- Controlled per-deployment from the Dimensions app or Vercel dashboard

## SDK Translation Layer

Not all SDK features translate 1:1 to web:

| Feature | Electron (local) | Vercel (deployed) |
|---|---|---|
| `sdk.kv.*` | SQLite | Vercel KV / Edge Config |
| `sdk.env.get()` | OS keychain | Vercel environment variables |
| `sdk.fetch()` | Node.js proxy | Vercel serverless function proxy |
| `sdk.secrets.*` | OS keychain | Vercel environment variables (encrypted) |
| Webportals | WebContentsView | iframe (CORS limitations apply) |
| Terminal widgets | node-pty | Not supported (excluded from export) |
| `sdk.navigate.*` | `dimensions://` protocol | Client-side routing |

## Limitations

- Webportals degrade to iframes — many sites block iframe embedding. CSS injection won't work the same way.
- Terminal widgets can't be deployed — excluded from export with a placeholder.
- Some SDK capabilities need a serverless backend (fetch proxy, KV) — adds latency vs local.

## Open Questions

- Auto-update on local change, or explicit re-deploy?
- Asset hosting — upload to Vercel Blob?
- Custom domains / redirects via dimension config?
