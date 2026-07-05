# Threat Model

## Project Overview

This repository’s deployed application is `artifacts/farcaster-client`, a React + Vite single-page Farcaster client that runs as a static site. In production, users sign in with a Farcaster custody-wallet seed phrase, derive keys locally in the browser, store encrypted session material in browser storage, read social data from Neynar/Farcaster services, upload optional images to Imgur, and submit Optimism transactions from the browser.

The important production fact for security analysis is that the deployed artifact is static-only: the build output (`dist/public`) is served as static files. The Express helper under `artifacts/farcaster-client/server/` is a development-only local service behind Vite proxy rules and is not production-reachable unless deployment architecture changes.

This threat model supersedes stale repo documentation that describes a different app. For production security decisions, use the Farcaster client files and artifact config as authoritative.

## Assets

- **Seed phrases and derived private keys** — the highest-value asset in the app. Compromise allows full control of the user’s custody wallet and Farcaster identity.
- **Session unlock secret and encrypted local vault data** — the session password and encrypted mnemonic material stored in browser storage protect re-entry without retyping the seed phrase. Exposure can turn a same-origin script compromise into full account takeover.
- **Signer state and delegated write capability** — Farcaster signer metadata, signer UUIDs, and approval state enable posting, liking, following, and other write actions as the user.
- **User API keys and third-party credentials** — especially the user-supplied Neynar API key. Leakage can let an attacker consume quota or act through third-party APIs available to that key.
- **Transaction intent and on-chain actions** — market listings, buys, sells, recovery address changes, and username operations must reflect exactly what the user approved.
- **Public profile and social data** — lower sensitivity than wallet material, but integrity still matters because spoofed or tampered social data can mislead users into unsafe actions.

## Trust Boundaries

- **Browser to external APIs** — production requests go directly from the browser to Neynar, Farcaster-related APIs, Imgur, and Optimism RPC/providers. The browser is the only execution environment in production, so all external responses are untrusted input.
- **Browser to local browser storage** — `localStorage`, `sessionStorage`, and `IndexedDB` hold sensitive state. These stores are only as safe as the page origin; any same-origin script execution would have direct access.
- **Public content to rendered UI** — cast text, profile data, embed URLs, avatars, images, and market metadata come from external or user-generated sources and must be treated as hostile input.
- **User intent to wallet / signer operations** — transaction construction, signature prompts, and Farcaster write actions cross from UI state into cryptographic operations. The app must ensure users sign only what they expect.
- **Development-only browser to localhost helper server** — during local development, Vite proxies `/api/farcaster` and `/api/fid-market` to `localhost:3001`. This boundary is out of production scope unless deployment changes to run the helper server publicly.

## Scan Anchors

- **Production entry point**: `artifacts/farcaster-client/src/**` bundled as a static SPA.
- **Highest-risk production areas**: `src/hooks/WalletProvider.tsx`, `src/lib/session-crypto.ts`, `src/lib/wallet.ts`, `src/components/CastCard.tsx`, `src/components/CastComposer.tsx`, `src/pages/FidDetailPage.tsx`, `src/lib/neynar*.ts`.
- **Public/authenticated surface**: all production routes are public static pages; authenticated state is client-local and gates wallet/signer actions in the UI, not server endpoints.
- **Usually dev-only and skip unless deployment changes**: `artifacts/farcaster-client/server/**`, Vite proxy config in `artifacts/farcaster-client/vite.config.ts`.
- **Authoritative deployment scope**: the static build output at `artifacts/farcaster-client/dist/public`.

## Threat Categories

### Spoofing

The main spoofing risk is impersonation of a Farcaster user by stealing or misusing seed-derived keys, delegated signer capability, or the session unlock secret. Production code MUST keep wallet derivation and signing strictly local to the browser, MUST bind signer state to the correct FID/account, and MUST prevent untrusted data from causing silent account switching or unauthorized action submission.

### Tampering

This app builds transactions and Farcaster write actions on the client. Untrusted network responses, cast embeds, market metadata, and UI state MUST NOT be able to alter what is signed or submitted without the user seeing the exact destination and effect. Any action that can move assets, change recovery settings, list or buy FIDs, or post as the user MUST be derived from validated inputs and explicit user interaction.

### Information Disclosure

The highest-impact disclosure is same-origin exposure of seed phrases, derived keys, session passwords, signer metadata, or user API keys through XSS or unsafe handling of untrusted content. Production code MUST treat all remote content as hostile, MUST avoid introducing script execution sinks, and MUST not send wallet secrets to any production server. Third-party API keys stored in the browser should be treated as user-controlled and non-secret from the page’s own origin.

### Denial of Service

Because production depends on third-party APIs and RPC providers directly from the browser, failures or abuse can degrade core functionality. External requests SHOULD have timeouts and bounded retries, and the UI SHOULD fail closed for signing/submission flows rather than leaving users uncertain about action state. User-generated media and remote content MUST remain size-bounded enough that a malicious post cannot trivially freeze the UI.

### Elevation of Privilege

There is no meaningful server-side admin role in the deployed app, so the important privilege-escalation path is client-side: turning untrusted content or a browser-origin compromise into control over wallet assets or Farcaster write capability. Production code MUST ensure that no untrusted input can execute script in the app origin, no client-only convenience state can bypass cryptographic approval, and no dev-only helper path is assumed safe if deployment ever changes to expose it.
