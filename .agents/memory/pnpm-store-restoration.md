---
name: pnpm store restoration
description: How to restore a broken/partial pnpm virtual store without full internet install
---

## Problem
Running `npm install` inside a workspace package breaks pnpm's node_modules (npm doesn't understand `workspace:*` protocol, creates package-lock.json, and wipes pnpm symlinks). The pnpm virtual store (`node_modules/.pnpm/`) has directory stubs but no actual package content.

## Symptoms
- `vite: command not found` — node_modules/.bin/vite missing
- `Cannot find package 'X'` on server startup  
- `node-pty` native binary not found (crashes api-server)
- pnpm install times out at 120s bash limit

## Why pnpm install times out
The bash tool has a 120s max. First run of `pnpm install --prefer-offline --ignore-scripts` downloads many packages from npm registry (takes >120s). But the packages ARE being cached. Second run (same command) reuses all downloaded packages and completes in ~3 seconds.

## Resolution Strategy
1. Run `pnpm install --filter @workspace/<artifact> --prefer-offline --ignore-scripts` with 115s timeout — let it download as much as possible, then time out.
2. Run the same command again — this time it reuses cache and completes instantly.
3. Restart the workflow.

## node-pty Linux issue
node-pty@1.1.0 only ships prebuilds for darwin-arm64, darwin-x64, win32-arm64, win32-x64. On Replit (Linux x64), the native `pty.node` binary is missing. The server crashes at startup if node-pty is imported at module level.

**Fix**: Wrap the import in try/catch using `require()`:
```typescript
let ptyModule: typeof import("node-pty") | null = null;
try { ptyModule = require("node-pty"); } catch(e) { console.warn("[terminal] node-pty unavailable"); }
```
Then check `if (!ptyModule)` before using it.

## Manual package restoration (when pnpm install totally fails)
If specific packages have empty virtual store entries:
1. Find the virtual store dir: `ls node_modules/.pnpm/ | grep "package-name@"`
2. Download tarball: `curl -sL "https://registry.npmjs.org/pkg/-/pkg-X.Y.Z.tgz" -o pkg.tgz`
3. Extract: `tar xzf pkg.tgz && cp -r package/* node_modules/.pnpm/<vsdir>/node_modules/<pkgname>/`

**Why:** Faster than waiting for pnpm to finish; useful for specific blocking packages (drizzle-zod, react, etc.).
