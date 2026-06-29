---
name: FidCaster FID Market integration
description: Architecture and constraints for the FID Market tab integrated into FidCaster from Fidex repo.
---

# FID Market Integration

## Architecture

- **Routes**: `/market` → `FidMarketPage.tsx`, `/market/:id` → `FidDetailPage.tsx`
- **Server**: `artifacts/farcaster-client/server/fid-market-routes.ts` — viem-based indexer + in-memory cache
- **Hook**: `src/hooks/useMarketWallet.ts` — window.ethereum (injected) only, no wagmi
- **Nav**: Market tab added to sidebar and bottom nav in DashboardPage via `navigate("/market")`

## Contract
- FidMarket: `0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3` (Optimism)
- IdRegistry: `0x00000000Fc6c5F01Fc30151999387Bb99A9f489b` (Optimism)
- Fee: 9% (900 bps)

## Vite Proxy
`vite.config.ts` proxies `/api/fid-market` → `http://localhost:3001`

## Optimism RPC Constraint
**Why:** Optimism public RPC (`mainnet.optimism.io`) rejects getLogs with "Block range is too large" if range > ~5000 blocks.
**How to apply:** LOG_CHUNK_SIZE must stay at ≤ 5000. INITIAL_SCAN_RANGE = 500,000 (100 chunks). EVENT_SCAN_RANGE = 50,000 (10 chunks).

## Trading Wallet
Uses `window.ethereum` (injected wallet like MetaMask) with viem `createWalletClient`. Chain switch to Optimism (chainId 10) handled via `wallet_switchEthereumChain`. Separate from FidCaster's Farcaster identity wallet.

## Sell Flow
1. Sign EIP-712 Transfer (fid → FidMarket, 30d deadline) via walletClient.signTypedData
2. Call `list(fid, priceWei, fromDeadline, fromSig)` on FidMarket contract

## Buy Flow
1. Read nonce from IdRegistry.nonces(fid)
2. Sign EIP-712 Transfer (fid → buyer, 24h deadline)
3. Call `buy(fid, seller, fromDeadline, fromSig, toDeadline, toSig)` with `value = price + 9% fee`

## Branding
Never show "Fidex" — always "FID Market". No external Fidex links in UI.
