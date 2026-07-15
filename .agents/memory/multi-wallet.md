---
name: Multi-wallet store architecture
description: How walletStore (Zustand) coexists with WalletProvider for FidCaster web multi-wallet feature.
---

## Rule
`walletStore` (Zustand, `src/store/walletStore.ts`) is the multi-wallet EVM layer; `WalletProvider`/`useWallet()` handles Farcaster identity (FID, signer, profile).

**Why:** WalletProvider is deeply coupled to Farcaster auth. walletStore is a separate layer that tracks all wallets (including the Farcaster custody wallet) so the user can switch, create, import, and use multiple wallets.

## WalletProvider → walletStore link
`linkFarcasterSeed(fid, mnemonic, label)` is called inside `_applyAccount` in WalletProvider (after `setState`) to auto-register the Farcaster wallet into walletStore. This is the only coupling point.

## WalletPanel address resolution
`address = storeActiveAccount?.address ?? fcAddress` — prefers walletStore active account, falls back to Farcaster auth address. This allows the wallet panel to show balances for any active walletStore account.

## Secure storage
`encryptPrivKey`/`decryptPrivKey` from `session-crypto.ts` accept any string (not just hex), so they work for mnemonic storage too. `walletSecureStore.ts` uses `ws_mn_<id>` and `ws_pk_<id>` keys in localStorage.

## Wallet metadata persistence
Wallet metadata (id, kind, label, accounts, color, emoji) is in localStorage under `ws_wallets`. Secrets (mnemonic/key) are stored separately under `ws_mn_<id>` / `ws_pk_<id>`, each encrypted.

## How to apply
- When reading the active address for any wallet operation, always use `walletStore.activeAccount()?.address ?? useWallet().address`.
- When getting a walletClient for sends, call `walletStore.getActiveWalletClient()` first; fall back to `useWallet().walletClient`.
- Watch-only wallets return `null` from `getActiveWalletClient()` — always check before signing.
