---
name: VITE_APP_MNEMONIC setup
description: APP_MNEMONIC secret is already forwarded to the browser via vite.config.ts define block
---

## The Rule
No extra .env or vite plugin config needed to expose APP_MNEMONIC to the frontend.

## Why
vite.config.ts already has:
  define: { "import.meta.env.VITE_APP_MNEMONIC": JSON.stringify(env.APP_MNEMONIC ?? "") }

This runs at build time (server side) so the secret is baked into the bundle — acceptable for dev/staging, but avoid in production public builds.

## How to Apply
In browser code: `const mnemonic = (import.meta.env.VITE_APP_MNEMONIC as string | undefined)?.trim();`
