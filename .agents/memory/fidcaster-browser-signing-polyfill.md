---
name: FidCaster browser signing Buffer polyfill
description: @farcaster/core needs Buffer polyfill in Vite browser builds; without it signing silently falls back to full server relay sending private key.
---

## Rule
`@farcaster/core` uses `Buffer` in its protobuf serialization internals. Vite does NOT inject Node polyfills by default. Without a polyfill, any call to `buildAndSignLocal()` (which calls `makeLinkAdd` / `makeReactionAdd` / etc.) throws `ReferenceError: Buffer is not defined` and is silently caught.

## Why it matters
The threat model requires signing to stay local to the browser. When signing fails, `hub-submit.ts` falls through to `serverRelay()` → `POST /api/farcaster/action` with `signerPrivateKey` in the HTTP body — a direct violation of "private key NEVER leaves browser".

## Fix applied
Installed `vite-plugin-node-polyfills` and added to `vite.config.ts` plugins:
```typescript
nodePolyfills({ include: ["buffer", "stream", "util", "process"] })
```
Must come BEFORE `react()` in the plugins array.

## How to apply
Any time `@farcaster/core` browser imports break (Buffer, stream, process errors in browser console), check that `vite-plugin-node-polyfills` is in `vite.config.ts`. Without it, browser signing silently fails — no build error, no obvious runtime error unless catch blocks log it.
