---
name: FidCaster hub server submission
description: Server-side write action submission for FidCaster using @farcaster/hub-nodejs. Architecture, key facts, and hub ordering.
---

## Architecture

FidCaster write actions (like/recast/follow/cast/unfollow/unrecast) go through a local Express server:

- **Server**: `artifacts/farcaster-client/server/index.ts` — Express on port 3001
- **Logic**: `artifacts/farcaster-client/server/farcaster-submit.ts` — uses `@farcaster/hub-nodejs` make* functions
- **Proxy**: Vite config proxies `/api/farcaster/` → `http://localhost:3001`
- **Browser**: `hub-submit.ts` is now a thin fetch wrapper calling `/api/farcaster/action`
- **Dev start**: `concurrently "tsx server/index.ts" "vite ..."` in package.json dev script

## Key Facts

- `@farcaster/hub-nodejs` v0.16.0 installed as a dependency
- Protobuf encoding done by hub-nodejs `make*` functions + `Message.encode().finish()`
- Hub submission via HTTP REST `/v1/submitMessage` (NOT gRPC)
- Read-only Neynar API calls (feed, user info, etc.) are **untouched** — only writes moved server-side

## Hub Ordering (critical)

```
HUB_URLS = [
  "https://hub-api.neynar.com",   // Has Camila FID=323738 key indexed ✓
  "https://hub.pinata.cloud",     // Does NOT have our key yet
]
```

Neynar hub needs `api_key: NEYNAR_API_DOCS` (or env NEYNAR_API_KEY) header.

## Ed25519 Signer Key Derivation

**Path**: `m/44'/60'/0'/0/1` (NOT `m/44'/461'/0'/0/0`)
**Method**: `HDKey.fromMasterSeed(seed).derive(path)` → `ed25519.getPublicKey(privateKey)`
**File**: `artifacts/farcaster-client/src/lib/wallet.ts` — `deriveSignerKey()`

Camila FID=323738 pubkey: `0xb26cee6048b4c0e931f769afd8566781783791bb6d9f1e40d5e192759babb0f3`
KeyRegistry state: 1 (registered on Optimism) ✓

## What Works

- `{"ok":true,"hash":"132a10f3e3886158c91f6a296361a7e1ed0cdcf3"}` — like confirmed
- Neynar hub returned HTTP 200 with correct signer

**Why:** Browser manual protobuf was incorrectly encoding or hub was rejecting field layout. Official @farcaster/hub-nodejs handles this correctly server-side. Also avoids browser CORS restrictions on hub endpoints.

**How to apply:** Any new write action type → add to `FarcasterAction` union in farcaster-submit.ts and add a branch in `buildMessage()`.
