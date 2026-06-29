---
name: FidCaster signer architecture
description: How signing keys are registered in FidCaster — on-chain KeyRegistry only, never Neynar Managed Signer
---

## Rule
FidCaster registers the local Ed25519 signing key **on-chain via Farcaster's KeyRegistry contract on Optimism**. This is a one-time transaction paid with a tiny amount of ETH on Optimism (< $0.01 gas).

**Never use Neynar Managed Signer** (the approach where Neynar creates the key and the user approves via Warpcast deep-link). The user explicitly rejected this.

## Why
The user said: "the signer should be from Farcaster itself with its contract" — they want the native Farcaster protocol approach, not a third-party managed key.

## How to apply
- `WalletProvider._autoActivateSigner`: calls `getSignerState` (check on-chain) → `registerSignerOnchain` (KeyGateway.add) → `publicClient.waitForTransactionReceipt`
- Local cache: `fc_signer_ok_{fid}` = "1" after first successful registration
- Write callsites (CastComposer, CastCard, ProfilePage): use `localSigner` + `hub-submit.ts` protobuf path
- `neynar-write.ts` exists but only as unused utility — do NOT make it the primary write path
- If the user has no ETH on Optimism, show a clear error pointing them to Wallet → Receive
- hub-submit.ts uses field 15 (data_bytes) for snapchain compatibility
