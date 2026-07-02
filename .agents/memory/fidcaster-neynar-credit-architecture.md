---
name: FidCaster Neynar credit architecture
description: Minimum 1 Neynar credit per write action is unavoidable. Documents why and what was fixed.
---

## Current state (after fixes)
- **1 credit per action** — AbortController in `server/farcaster-submit.ts` cancels all 12 competing Neynar key requests the moment the first succeeds. Previous `Promise.any()` without abort = 12 credits per action.
- **Browser signs locally** — `vite-plugin-node-polyfills` fixes Buffer; `buildAndSignLocal()` works; private key stays in browser.
- **Server relay path**: `/api/farcaster/submit-bytes` (bytes only, no key) → server races free hubs → falls to Neynar (AbortController, 1 key wins).

## Why free hubs don't work
Farcaster signers registered via SIWF (Sign In With Farcaster) through Neynar are indexed on **Neynar's hub only** at registration time. Other hubs sync from on-chain KeyRegistry (Optimism) but may lag or miss signers.

Tested free hubs from Replit server:
- `api.hub.wevm.dev` — `TypeError: fetch failed` (network/port blocked)
- `hoyt.farcaster.xyz:2281` — `TypeError: fetch failed` (port 2281 blocked)
- `hub.farcaster.standardcrypto.vc:2281` — `TypeError: fetch failed` (port 2281 blocked)
- `hub.pinata.cloud` (HTTPS) — HTTP 400 `bad_request.validation_failure` (reachable, but signer not indexed there)

**Conclusion**: Free hubs cannot accept messages signed by our signer. Neynar's hub is the only viable target. Minimum cost = 1 credit per write action.

## What cannot be fixed without CF Worker
Going below 1 credit/action requires a Cloudflare Worker that has Neynar key embedded and can route to free hubs after checking signer state. User declined to deploy CF Worker.

## Fallback chain in hub-submit.ts
1. CF Worker (if `VITE_HUB_WORKER_URL` set) — optional, user-deployed
2. Browser-direct free hubs (CORS-blocked in practice) → skip
3. `POST /api/farcaster/submit-bytes` — server races free hubs then Neynar (1 credit)
4. `POST /api/farcaster/action` — full relay (fallback only if browser signing fails)
