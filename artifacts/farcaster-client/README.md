<div align="center">

<img src="https://fidcaster.xyz/og.png" alt="FidCaster" width="100%" style="border-radius:16px;max-height:280px;object-fit:cover;" />

<br/>
<br/>

# FidCaster

**The only Farcaster client with a built-in peer-to-peer FID marketplace on Optimism.**

Cast. Connect. Trade your Farcaster ID - no registration, no email, just your identity.

[![Live App](https://img.shields.io/badge/Live-fidcaster.xyz-7c3aed?style=for-the-badge&logo=vercel)](https://fidcaster.xyz)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-18-61dafb?style=for-the-badge&logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-7-646cff?style=for-the-badge&logo=vite)](https://vite.dev/)
[![Optimism](https://img.shields.io/badge/Optimism-Mainnet-ff0420?style=for-the-badge&logo=ethereum)](https://www.optimism.io/)

📖 **[User Documentation](./public/docs/index.html)** - the complete, beautifully designed end-user guide

</div>

---

## ✨ What is FidCaster?

FidCaster is a **full-featured Farcaster social client** that goes beyond reading and writing casts. It is the first client to natively integrate a **peer-to-peer FID marketplace** directly on Optimism - letting you list, buy, and sell Farcaster IDs without leaving the app.

Everything runs client-side. Your seed phrase never leaves your device - it is encrypted with **AES-GCM-256 + PBKDF2 (200,000 iterations)** and stored in your browser's IndexedDB vault. Signing happens locally. No server ever sees your private keys.

---

## 🚀 Features

| Category | Features |
|---|---|
| **Social Feed** | Following · For You · Trending · Channels |
| **Casting** | Rich composer · image upload (Imgur) · threads |
| **Reactions** | Likes · Recasts · Quotes · Follows - all on-hub |
| **FID Market** | List · Buy · Cancel FIDs on Optimism |
| **Grow / Follow** | Smart batch-follow with Power Badge, Pro, follower filters |
| **Clean Up** | Batch unfollow non-followers or filtered users |
| **Multi-Account** | Switch accounts; each runs its own independent batch |
| **Mini Apps** | Browse and open Farcaster mini apps in-app |
| **Notifications** | Real-time notification feed with unread badge |
| **Search** | User and cast search |
| **Profile** | Edit display name, bio, PFP; username change |
| **Wallet** | ETH balance, on-chain transactions |
| **Recovery** | View and update Farcaster recovery address |
| **Mobile** | Capacitor builds for iOS & Android |
| **Security** | AES-GCM-256 vault · auto-lock · CORS · rate limits |

---

## 🗂️ Project Structure

```
artifacts/farcaster-client/
├── src/                        # React SPA (TypeScript)
│   ├── main.tsx                # App entry point
│   ├── App.tsx                 # Root component, router, theme
│   ├── index.css               # Global styles (Tailwind v4)
│   │
│   ├── pages/                  # Route-level page components
│   ├── components/             # Reusable UI components
│   ├── hooks/                  # React hooks & context providers
│   └── lib/                    # Core business logic & utilities
│
├── server/                     # Dev-only Express API server
├── ios/                        # Capacitor iOS project
├── hub-worker/                 # Edge hub submission worker
├── vite.config.ts              # Vite bundler config
├── capacitor.config.ts         # Capacitor mobile config
└── package.json
```

---

## 📄 Pages - `src/pages/`

| File | Route | Language | Description |
|---|---|---|---|
| `LoginPage.tsx` | `/` | TSX | Landing + auth entry. Seed phrase, WalletConnect, and SIWF login flows |
| `AuthPage.tsx` | `/auth` | TSX | Session unlock for returning users; decrypts vault with stored password |
| `DashboardPage.tsx` | `/home` | TSX | Main app shell: sidebar nav, feed, notifications, search, profile, wallet panel |
| `FidMarketPage.tsx` | `/market` | TSX | FID marketplace listing grid - browse, filter, sort active listings |
| `FidDetailPage.tsx` | `/market/:fid` | TSX | Single FID detail: price history, buy flow, seller info, on-chain listing |
| `FollowPage.tsx` | `/follow` | TSX | Grow (batch-follow) + Clean Up (batch-unfollow) with advanced filters |
| `ThreadPage.tsx` | `/thread/:hash` | TSX | Full conversation thread with reply composer |
| `ProfilePage.tsx` | `/profile/:fid` | TSX | User profile: posts, followers, following, cast history |
| `AdminPage.tsx` | `/admin` | TSX | Admin dashboard (restricted to admin FID) |
| `not-found.tsx` | `*` | TSX | 404 page |

---

## 🧩 Components - `src/components/`

| File | Language | Purpose |
|---|---|---|
| `BatchFollowSheet.tsx` | TSX | Bottom-sheet for configuring and launching batch follow/unfollow operations. Handles preset strategies, filters (min followers, Power Badge, Farcaster Pro), exclusion lists, and live scan progress |
| `CastCard.tsx` | TSX | Individual cast renderer - author info, text, embeds, images, frames, reaction buttons (like/recast/quote), thread expansion |
| `CastComposer.tsx` | TSX | Cast creation modal - text input, image upload to Imgur, channel picker, character limit, hub submission |
| `FarcasterSignIn.tsx` | TSX | Sign In With Farcaster relay flow - generates EIP-712 signed-key request, polls Warpcast for QR approval |
| `FeedPanel.tsx` | TSX | Feed container - tab switcher (Following / For You / Trending / Channels), infinite scroll, cast rendering |
| `FidCasterLogo.tsx` | TSX | Animated SVG logo component |
| `FidSoldScreen.tsx` | TSX | Full-screen shown when the user's FID has been transferred (sold via market) |
| `FollowListSheet.tsx` | TSX | Scrollable followers/following list sheet with follow-back actions |
| `MiniAppsPanel.tsx` | TSX | Farcaster mini apps browser - catalog fetch, in-app iframe or Capacitor in-app-browser |
| `NotificationsPanel.tsx` | TSX | Notification feed: likes, recasts, follows, mentions - grouped with timestamps |
| `PowerBadgeIcon.tsx` | TSX | Purple ⚡ Power Badge icon (Warpcast power users) |
| `ProBadge.tsx` + `useProStatus` | TSX | Farcaster Pro ($10/mo subscription) badge with server-backed status check |
| `ProfileCard.tsx` | TSX | Compact user profile card - avatar, bio, follower counts, follow button |
| `ProfilePostsPanel.tsx` | TSX | User's cast history with infinite scroll |
| `RecoveryPanel.tsx` | TSX | Shows current Farcaster recovery address; links to on-chain update |
| `SearchPanel.tsx` | TSX | Full-text user and cast search powered by Neynar |
| `SeedPhraseInput.tsx` | TSX | Secure 12/24-word seed phrase entry with per-word validation and paste support |
| `SignerSetup.tsx` | TSX | Step-by-step Ed25519 signer activation wizard - key gen → on-chain KeyRegistry tx → hub readiness polling |
| `ThreadSheet.tsx` | TSX | Side-sheet thread view that opens from cast card interactions |
| `UsernameChange.tsx` | TSX | Username change flow with availability check and hub update |
| `UserProfileSheet.tsx` | TSX | Full user profile modal - posts, follow actions, profile stats |
| `WalletConnectLogin.tsx` | TSX | MetaMask / WalletConnect login flow using `@walletconnect/ethereum-provider` |
| `WalletPanel.tsx` | TSX | ETH balance display, recent on-chain transactions |

---

## 🪝 Hooks - `src/hooks/`

| File | Language | Purpose |
|---|---|---|
| `WalletProvider.tsx` | TSX | **Central auth & wallet state provider.** Manages seed phrase decryption, signer derivation, account switching, session lock/unlock, multi-account storage, and wallet client |
| `BatchOperationContext.tsx` | TSX | **Multi-account batch operation engine.** Per-FID op state (`Map<fid, BatchOp>`), per-FID cancel refs, per-FID localStorage (`fc_batch_v2_{fid}`). Stacked progress pills for concurrent batches across accounts. Auto-resume on page reload |
| `useWallet.ts` | TS | Context consumer hook - exposes wallet state and all auth actions to any component |
| `useAdminConfig.ts` | TS | Fetches admin config (rate limits, feature flags) from server |
| `useEthPrice.ts` | TS | Live ETH/USD price from public oracle |
| `useInfiniteScroll.ts` | TS | IntersectionObserver-based infinite scroll trigger |
| `useLandingStats.ts` | TS | Fetches live user count and market volume for the landing page |
| `useMarketWallet.ts` | TS | `window.ethereum` hook for FID Market transactions - no wagmi dependency |
| `use-mobile.tsx` | TSX | Responsive breakpoint detection |
| `use-toast.ts` | TS | Programmatic toast queue |
| `useUnreadNotifications.ts` | TS | Polls for unread notification count; drives the red badge |

---

## 📦 Library - `src/lib/`

| File | Language | Purpose |
|---|---|---|
| `wallet.ts` | TS | **BIP-39/32 key derivation.** Derives custody wallet at `m/44'/60'/0'/0/0` and Ed25519 Farcaster signer at `m/44'/60'/0'/0/1` using `@scure/bip32` + `@noble/curves/ed25519` |
| `session-crypto.ts` | TS | **AES-GCM-256 vault.** Encrypts mnemonic with PBKDF2 (200k iterations, random salt) into IndexedDB. Stores non-extractable `CryptoKey` across page reloads. TTL: 30 days |
| `farcaster-db.ts` | TS | **IndexedDB cache layer.** Five object stores: `feed_cache` (10 min TTL), `profile_cache` (30 min), `notifications_cache` (5 min), `drafts` (no TTL), `follow_list_cache` |
| `account-store.ts` | TS | Multi-account manager - stores `AccountMeta` (FID, address, username, pfp, signer UUID) in localStorage `fc_accounts_v2`; cross-tab sync via `StorageEvent` |
| `contracts.ts` | TS | `viem` public clients for Optimism and Base with multi-RPC fallback. Exports contract ABIs for KeyRegistry, IdRegistry, and FID Market |
| `neynar.ts` | TS | **Neynar read client.** `getFollowers`, `getFollowing`, `searchUsers`, `getUserByFid`, `getUsersByFids`, `checkFollowStatusBulk`, Power Badge detection - all routed through `/api/fc` proxy |
| `neynar-write.ts` | TS | Neynar write operations (where applicable) |
| `neynar-signer.ts` | TS | Signer UUID management and approval state |
| `hub-submit.ts` | TS | **Hub action submitter.** Thin browser-side fetch wrapper - POSTs signed Farcaster messages to `/api/farcaster/*`. Server handles `@farcaster/hub-nodejs` encoding and Neynar hub submission |
| `batch-follow-utils.tsx` | TSX | Batch operation utilities: `BatchFilters` type, `applyFilters`, `loadList` (10K scan with IndexedDB bypass for strict filters), Pro status batch-fetch, sort/preset logic |
| `farcaster-api.ts` | TS | `FarcasterProfile` type definitions and profile fetch helpers |
| `admin-config.ts` | TS | Admin FID constant and config type |
| `miniapp-native.ts` | TS | Capacitor in-app browser bridge for opening mini apps natively on iOS/Android |
| `utils.ts` | TS | `cn()` - Tailwind class merging via `clsx` + `tailwind-merge` |
| `wallet-events.ts` | TS | Custom event bus for cross-component wallet state changes |

---

## 🖥️ Server - `server/` *(Development only)*

> In production the app is a **pure static SPA** - the Express server is not deployed. All API calls go directly from the browser to Neynar, Farcaster hubs, and Optimism RPC.

| File | Language | Purpose |
|---|---|---|
| `index.ts` | TS | **Express app entry.** Helmet security headers, CORS allowlist (Replit + fidcaster.xyz), rate limiters, body validation, route mounting, error handling |
| `neynar-proxy.ts` | TS | **Neynar API proxy with multi-key rotation.** 12-key pool, RPM throttling, single-flight deduplication, in-memory cache with SWR, Pro-status endpoint (6h cache per FID) |
| `fid-market-routes.ts` | TS | **FID Market indexer + REST API.** Streams `Listed`/`Bought`/`Cancelled` events from Optimism in 5,000-block chunks, maintains in-memory listing cache, exposes `/api/fid-market/*` endpoints |
| `farcaster-submit.ts` | TS | **Hub broadcaster.** Receives pre-signed action params, encodes with `@farcaster/hub-nodejs`, submits to `hub-api.neynar.com`. Actions: follow, unfollow, like, unlike, recast, unrecast, cast, delete-cast |
| `sign-pool.ts` | TS | Worker pool for parallel Ed25519 signing (batch operations) |
| `signer-worker.ts` | TS | Worker thread - receives unsigned payloads, signs with `@noble/curves/ed25519`, returns signature |
| `cache.ts` | TS | In-memory LRU cache with TTL and stale-while-revalidate support |
| `neynar-limit.ts` | TS | Per-key RPM accounting, `singleFlight` deduplication, `penalize429` backoff |
| `profile-db.ts` | TS | SQLite-backed profile cache (`better-sqlite3`) - persists profile data between server restarts |
| `metrics.ts` | TS | Request counters and timing metrics |
| `health.ts` | TS | `GET /health` - uptime + memory stats |

---

## ⛓️ Smart Contracts (Optimism Mainnet)

| Contract | Address | Usage |
|---|---|---|
| **FID Market** | [`0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3`](https://optimistic.etherscan.io/address/0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3) | `list(fid, priceWei, durationSecs, fromDeadline, fromSig)` · `buy(fid, seller, toDeadline, toSig)` · `cancel(fid)` |
| **Farcaster Key Registry** | [`0x00000000Fc6c5F01Fc30151999387Bb99A9f489b`](https://optimistic.etherscan.io/address/0x00000000Fc6c5F01Fc30151999387Bb99A9f489b) | On-chain Ed25519 signer registration (`add`, `remove`) |
| **Farcaster ID Registry** | [`0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69`](https://optimistic.etherscan.io/address/0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69) | FID ownership transfer, recovery address |

---

## 🛠️ Tech Stack

### Frontend

| Technology | Version | Role |
|---|---|---|
| **React** | 18 | UI framework |
| **TypeScript** | 5.x | Type safety across 24,000+ lines |
| **Vite** | 7 | Bundler, dev server, HMR |
| **Tailwind CSS** | 4 | Utility-first styling |
| **Framer Motion** | - | Animations (batch pill, sheets, transitions) |
| **Radix UI** | - | Accessible Dialog, Tabs, Tooltip, Toast primitives |
| **Lucide React** | - | Icon library |
| **Wouter** | 3.x | Lightweight client-side router |
| **Sonner** | 2.x | Toast notifications |
| **viem** | 2.x | Ethereum/Optimism/Base RPC client |

### Cryptography & Blockchain

| Library | Purpose |
|---|---|
| `@noble/curves` | Ed25519 key generation and signing (Farcaster signer) |
| `@noble/hashes` | PBKDF2-SHA256 key derivation for vault encryption |
| `@scure/bip32` | HD key derivation (BIP-32) from seed phrase |
| `@scure/bip39` | Mnemonic validation and seed generation (BIP-39) |
| `@farcaster/core` | Farcaster protocol types and message encoding |
| `@farcaster/hub-nodejs` | Hub RPC client (server-side message submission) |
| `@farcaster/auth-kit` | Sign In With Farcaster (SIWF) |
| `@walletconnect/ethereum-provider` | MetaMask and WalletConnect browser login |

### Backend (Development)

| Technology | Role |
|---|---|
| **Express 5** | HTTP server, middleware, routing |
| **Helmet** | Security headers (CSP, HSTS, X-Frame-Options) |
| **express-rate-limit** | Rate limiting (global / per-action / market) |
| **tsx** | TypeScript execution without compilation |
| **concurrently** | Run Vite + Express in parallel |

### Storage

| Store | What lives there |
|---|---|
| **IndexedDB** (`fc_vault`) | Encrypted mnemonic vault (AES-GCM-256), non-extractable `CryptoKey` |
| **IndexedDB** (`fidcaster_data`) | Feed cache, profile cache, notifications cache, drafts, follow lists |
| **localStorage** | Account list (`fc_accounts_v2`), per-FID batch state (`fc_batch_v2_{fid}`), UI preferences |

### Mobile

| Technology | Purpose |
|---|---|
| **Capacitor 8** | Native iOS and Android bridge |
| `@capgo/capacitor-inappbrowser` | Native in-app browser for Mini Apps |

---

## 🔐 Security Architecture

```
User's seed phrase
      │
      ▼
PBKDF2-SHA256 (200,000 iterations, random 16-byte salt)
      │
      ▼
AES-GCM-256 encryption ──► IndexedDB "fc_vault"
                              (non-extractable CryptoKey)

Signer derivation (in-browser only):
  seed phrase ─► HDKey ─► m/44'/60'/0'/0/1 ─► Ed25519 private key
                                                      │
                                                      ▼
                                           Farcaster KeyRegistry
                                         (on-chain, Optimism tx)
```

**Key guarantees:**
- ✅ Seed phrase never leaves the browser - encrypted at rest in IndexedDB
- ✅ Server never receives private keys - signing is always local
- ✅ Ed25519 signers registered on-chain - cryptographically verifiable
- ✅ Session auto-locks on inactivity (tab hide, idle timer)
- ✅ Rate limiting on all server endpoints (global 100/min, actions 200/min)
- ✅ Input validation on every server route (FID bounds, hex, address regex)
- ✅ CORS allowlist - only trusted origins reach the Express server

---

## 🔑 Authentication Flows

### 1. Seed Phrase (Primary)
```
Enter 12/24-word mnemonic
  → derive custody wallet (m/44'/60'/0'/0/0)
  → derive Ed25519 signer (m/44'/60'/0'/0/1)
  → encrypt mnemonic with AES-GCM-256 into IndexedDB
  → register signer on Farcaster KeyRegistry (Optimism tx)
```

### 2. External Wallet (MetaMask / WalletConnect)
```
Connect wallet (WalletConnect v2 / window.ethereum)
  → signMessage to derive deterministic signer seed
  → derive Ed25519 signer from signature
  → register signer on-chain
```

### 3. Sign In With Farcaster (SIWF)
```
Generate EIP-712 signed-key request locally
  → POST to api.warpcast.com/v2/signed-key-requests
  → display QR code / deep link
  → poll for Warpcast approval
  → read-only access (no local signer unless provided)
```

---

## 🌱 Grow / Batch Follow System

The `/follow` page features a smart batch-follow engine that can process thousands of users:

```
Target profile search
  → Scan up to 10,000 followers/following pages
  → Apply filters:
      · Min / Max follower count
      · Power Badge only (Warpcast ⚡ users)
      · Farcaster Pro only ($10/mo subscribers)
      · Sort: follower count, recency, alphabetical
      · Exclusion list (FIDs or @usernames)
  → Pre-check already-followed status (Neynar bulk API)
  → Submit actions to Farcaster hub (1.5s between each)
  → Auto-retry signer errors (90s × 3)
  → Auto-retry rate limits (62s × 3)
  → Floating progress pill - survives page navigation
  → Per-account isolation - multiple accounts run simultaneously
```

**Filters bypass the 15-minute IndexedDB cache** when strict criteria (minFollowers, Power Badge, Farcaster Pro) are set, ensuring accurate results from a full live scan.

---

## 🏪 FID Market

The integrated peer-to-peer marketplace for Farcaster IDs:

- **List**: specify price (ETH) and duration (10 min – 30 days)
- **Buy**: atomic on-chain transfer with 9% protocol fee
- **Cancel**: remove your listing at any time
- **Indexer**: server-side event scanner streams `Listed`/`Bought`/`Cancelled` logs from Optimism in 5,000-block chunks and maintains an in-memory listing cache

---

## 🚦 API Server Endpoints (Development)

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Uptime and memory stats |
| `GET/POST` | `/api/fc/*` | Neynar API proxy (multi-key, cached) |
| `GET/POST` | `/api/farcaster/*` | Hub action submission |
| `GET` | `/api/fid-market/listings` | Active FID listings |
| `GET` | `/api/fid-market/listing/:fid` | Single FID on-chain state |
| `GET` | `/api/fid-market/activity` | Combined market activity feed |
| `POST` | `/api/fid-market/buy-tx` | Construct buy transaction |
| `POST` | `/api/fid-market/list-tx` | Construct list transaction |
| `GET` | `/api/pro-status` | Farcaster Pro status (up to 100 FIDs, 6h cache) |
| `GET` | `/api/warpcast/*` | Warpcast mini-app discovery proxy |

---

## 🏁 Getting Started

### Prerequisites

- Node.js 20+
- pnpm 9+
- A Neynar API key → [neynar.com](https://neynar.com)

### Installation

```bash
# Clone the repository
git clone https://github.com/maxnalie-web/FidCaster.git
cd FidCaster

# Install dependencies
pnpm install

# Set environment variables
cp artifacts/farcaster-client/.env.example artifacts/farcaster-client/.env
# Edit .env and add your NEYNAR_API_KEY
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `NEYNAR_API_KEY` | ✅ | Your Neynar API key (supports comma-separated list for key rotation) |
| `WALLETCONNECT_PROJECT_ID` | ✅ | WalletConnect Cloud project ID |
| `IMGUR_CLIENT_ID` | ✅ | Imgur API client ID (for image uploads) |
| `APP_FID` | Optional | App FID for signer attribution |
| `APP_MNEMONIC` | Optional | App mnemonic for server-side signing |
| `ALLOWED_ORIGINS` | Optional | Extra CORS origins `https://yourdomain.com,...` |

### Development

```bash
cd artifacts/farcaster-client

# Run both Vite dev server (port 5000) and Express API server (port 3001)
pnpm dev
```

### Production Build

```bash
cd artifacts/farcaster-client

# Build static assets
pnpm build

# Output: dist/public/ - deploy anywhere (Vercel, Netlify, Cloudflare Pages, any Node host)
```

### Mobile (iOS)

```bash
cd artifacts/farcaster-client

pnpm cap:ios   # builds, syncs, opens Xcode
```

---

## 📊 Codebase Overview

| Layer | Files | Primary Language |
|---|---|---|
| Pages | 10 | TypeScript React (`.tsx`) |
| Components | 23 | TypeScript React (`.tsx`) |
| Hooks / Context | 11 | TypeScript React (`.tsx` / `.ts`) |
| Core Library | 14 | TypeScript (`.ts`) |
| Dev Server | 10 | TypeScript (`.ts`) |
| **Total** | **~24,000 lines** | **TypeScript (100%)** |

---

## 📁 Full File Reference

<details>
<summary><strong>src/pages/</strong> - Route-level pages</summary>

| File | Lines | Description |
|---|---|---|
| `LoginPage.tsx` | ~400 | Landing page, seed phrase, WalletConnect, SIWF login |
| `AuthPage.tsx` | ~200 | Session restore / password unlock |
| `DashboardPage.tsx` | ~800 | Main app shell with sidebar navigation |
| `FidMarketPage.tsx` | ~600 | Market listing browse and filter |
| `FidDetailPage.tsx` | ~500 | Single FID buy/detail page |
| `FollowPage.tsx` | ~1100 | Grow (batch-follow) + Clean Up |
| `ThreadPage.tsx` | ~200 | Full conversation thread |
| `ProfilePage.tsx` | ~300 | User profile |
| `AdminPage.tsx` | ~150 | Admin-only config dashboard |
| `not-found.tsx` | ~30 | 404 |

</details>

<details>
<summary><strong>src/components/</strong> - UI components</summary>

| File | Description |
|---|---|
| `BatchFollowSheet.tsx` | Batch follow sheet - preset strategies, filters, scan progress |
| `CastCard.tsx` | Cast renderer - text, embeds, reactions, thread expansion |
| `CastComposer.tsx` | Cast creation - text, images, channel picker |
| `FarcasterSignIn.tsx` | SIWF QR/deep-link relay |
| `FeedPanel.tsx` | Feed tabs + infinite scroll |
| `FidCasterLogo.tsx` | Animated logo SVG |
| `FidSoldScreen.tsx` | Post-sale screen |
| `FollowListSheet.tsx` | Followers/following list sheet |
| `MiniAppsPanel.tsx` | Farcaster mini apps browser |
| `NotificationsPanel.tsx` | Notification feed |
| `PowerBadgeIcon.tsx` | Purple Power Badge icon |
| `ProBadge.tsx` | Farcaster Pro subscription badge |
| `ProfileCard.tsx` | Compact profile card |
| `ProfilePostsPanel.tsx` | User cast history |
| `RecoveryPanel.tsx` | Recovery address view/update |
| `SearchPanel.tsx` | User + cast search |
| `SeedPhraseInput.tsx` | Secure word-by-word seed entry |
| `SignerSetup.tsx` | Ed25519 signer activation wizard |
| `ThreadSheet.tsx` | Thread side-sheet |
| `UsernameChange.tsx` | Username update flow |
| `UserProfileSheet.tsx` | Full profile modal |
| `WalletConnectLogin.tsx` | MetaMask/WC login |
| `WalletPanel.tsx` | ETH balance + transactions |

</details>

<details>
<summary><strong>src/lib/</strong> - Core business logic</summary>

| File | Description |
|---|---|
| `wallet.ts` | BIP-39/32 derivation, Ed25519 signer generation |
| `session-crypto.ts` | AES-GCM-256 vault, PBKDF2 key derivation |
| `farcaster-db.ts` | IndexedDB (feed, profile, notif, drafts, follow cache) |
| `account-store.ts` | Multi-account storage manager |
| `contracts.ts` | viem clients (Optimism, Base), contract ABIs |
| `neynar.ts` | Neynar read API client |
| `neynar-write.ts` | Neynar write operations |
| `neynar-signer.ts` | Signer UUID lifecycle |
| `hub-submit.ts` | Browser-side hub action submitter |
| `batch-follow-utils.tsx` | Batch filter engine, Pro status lookup |
| `farcaster-api.ts` | FarcasterProfile types |
| `admin-config.ts` | Admin FID config |
| `miniapp-native.ts` | Capacitor in-app browser bridge |
| `utils.ts` | Tailwind `cn()` merge helper |
| `wallet-events.ts` | Cross-component wallet event bus |

</details>

<details>
<summary><strong>server/</strong> - Development API server</summary>

| File | Description |
|---|---|
| `index.ts` | Express entry: Helmet, CORS, rate limits, route mounting |
| `neynar-proxy.ts` | 12-key Neynar proxy with cache, throttle, SWR |
| `farcaster-submit.ts` | Hub broadcaster (`@farcaster/hub-nodejs`) |
| `fid-market-routes.ts` | Optimism event indexer + market REST API |
| `sign-pool.ts` | Ed25519 signing worker pool |
| `signer-worker.ts` | Worker thread signing implementation |
| `cache.ts` | In-memory LRU + TTL + SWR cache |
| `neynar-limit.ts` | Per-key RPM, single-flight, 429 backoff |
| `profile-db.ts` | SQLite profile persistence |
| `metrics.ts` | Request counters + timing |
| `health.ts` | Health check endpoint |

</details>

---

## 🌐 Deployment

FidCaster deploys as a **pure static site** (`dist/public/`). No server is required in production - all API calls go directly from the browser to:

- [Neynar API](https://neynar.com) - social data
- [hub-api.neynar.com](https://hub-api.neynar.com) - hub message submission
- [Optimism RPC](https://mainnet.optimism.io) - on-chain reads
- [api.warpcast.com](https://api.warpcast.com) - SIWF + mini app discovery
- [api.imgur.com](https://api.imgur.com) - image hosting

The Express server only runs locally in development to proxy around CORS restrictions and provide FID Market indexing.

---

## 📜 License

MIT - see [LICENSE](LICENSE)

---

<div align="center">

Built with ♥ for the Farcaster community

**[fidcaster.xyz](https://fidcaster.xyz)** · [@maxnalie](https://warpcast.com/maxnalie)

</div>
