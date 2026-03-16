# Multiplayer

## Overview

Remote scene resolution via `dimensions://username/scene-slug`. Users can navigate to other people's published scenes directly from their local app.

## How It Works

- `dimensions://` protocol extended: `dimensions://jack/morning-routine/inbox` resolves to a remote scene
- Remote scenes are fetched, verified (signed bundle), and rendered locally in the scene WCV
- The local app is the runtime — remote scenes run in the same sandbox as local scenes
- Remote widgets get their own isolated KV namespace (no access to your local data)

## Requirements

- User accounts (Supabase auth or similar)
- Scene publishing pipeline (see `store.md`)
- Bundle signing for integrity verification
- Remote scene caching (R2/CDN)
- Permission model for remote widgets requesting env vars / secrets (default: deny all, user must explicitly grant)

## Open Questions

- Can you fork/remix a remote scene locally?
- How do remote scene updates propagate? Auto-update vs pinned version?
- Should remote scenes be able to link to other remote scenes? (Probably yes, but needs trust chain)
