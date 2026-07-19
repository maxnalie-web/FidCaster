# FidCaster

A full-featured Farcaster client with a built-in peer-to-peer FID marketplace on Optimism.

## How to run

The workflow **"Start application"** runs:
```
cd artifacts/farcaster-client && pnpm run dev
```

This starts both:
- **Express server** on port 3001 (`API_PORT=3001 tsx server/index.ts`)
- **Vite dev server** on port 5000 (`vite --host 0.0.0.0`)

## Stack

TypeScript · React 18 · Vite 7 · Tailwind v4 · viem · @farcaster/hub-nodejs · Neynar API · Optimism

## Key directories

- `artifacts/farcaster-client/src/` — React frontend
- `artifacts/farcaster-client/server/` — Express API + jobs
- `artifacts/farcaster-client/server/db/` — PostgreSQL schema & queries
- `artifacts/farcaster-client/server/db/schema.sql` — auto-migrated on startup

## Secrets required

All secrets are stored in Replit Secrets. Key ones:
- `NEYNAR_API_KEY` (+ `NEYNAR_API_KEY_2` … `NEYNAR_API_KEY_82`) — Farcaster API
- `APP_MNEMONIC` / `APP_FID` — server signer identity
- `WALLETCONNECT_PROJECT_ID` — WalletConnect
- `OPENSEA_API` — NFT gallery
- `CLOUDINARY_ACCOUNTS` — media uploads
- `SESSION_SECRET` — session encryption
- `DATABASE_URL` — PostgreSQL (managed by Replit)

## Known non-critical warnings on startup

- `better-sqlite3` native module unavailable — spam-labels and admin-store are disabled (no impact on core features)
- `sign-pool worker` falls back to main thread — signing still works

## User preferences
