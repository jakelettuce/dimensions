# Widget & Dimension Store

> Status: V2+ — not in current scope

## Overview

A discovery platform where users publish and install dimensions (scene packages) and individual widgets. Think VS Code extensions marketplace, but for workflows and interfaces.

## How It Works

- Users publish dimensions or standalone widgets from the app
- Published bundles are signed and uploaded to CDN (R2)
- Store UI is a scene within Dimensions itself (dogfooding)
- Installing a dimension creates a local copy in `~/Dimensions/`
- Installed dimensions can be customized locally without affecting the published version

## Publishing Flow

1. User selects a dimension or scene → "Publish"
2. App validates all manifests, bundles widgets, generates metadata
3. Bundle signed with user's key
4. Uploaded to store backend → CDN
5. Listed in store with title, description, screenshots, and capability declarations

## Trust & Safety

- **Signed bundles** — tampered content won't load
- **Capability disclosure** — shown before install ("This dimension needs: network, env")
- **User reviews and ratings** — community quality signal
- **Report mechanism** — flag malicious content

## Store Backend

- Supabase for auth, metadata, reviews
- R2 for bundle storage and CDN delivery
- API endpoints are env-configured — self-hostable for anyone who wants their own store
