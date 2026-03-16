# Multiplayer

> Status: V2+ — not in current scope

## Overview

Remote scene resolution via `dimensions://` protocol. Users navigate to other people's published scenes directly from their local app. Your app is the runtime — remote content runs in the same sandbox as local scenes.

## How It Works

- Protocol extended with usernames: `dimensions://go/jack/morning-routine/inbox`
- Remote scenes fetched from CDN, verified (signed bundle), cached locally
- Remote widgets get their own isolated KV namespace — no access to your local data
- Capability grants for remote widgets default to deny-all — user must explicitly approve

## What's Needed

- **User accounts** — auth via Supabase or similar
- **Publishing pipeline** — bundle, sign, upload to R2/CDN (see [store.md](store.md))
- **Bundle signing** — integrity verification before execution
- **Remote caching** — downloaded scenes cached locally for offline access
- **Permission model** — remote widgets requesting env vars, network access, etc. require explicit user approval

## Open Questions

- Can you fork/remix a remote scene locally? (Probably yes — copy to `~/Dimensions/`)
- How do remote scene updates propagate? Auto-update vs pinned version?
- Should remote scenes link to other remote scenes? (Likely yes, but needs trust chain)
- How to handle remote scenes that require capabilities the user hasn't approved?
