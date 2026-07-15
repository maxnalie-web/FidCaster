---
name: Native wallet port
description: How web WalletPanel.tsx was ported from native WalletPanelScreen.tsx — key decisions and adaptation patterns.
---

## Rule
WalletPanel.tsx is a full port of native WalletPanelScreen.tsx. When updating wallet UI, always sync changes back to native (or vice versa) to keep them in sync.

## Key adaptations (RN → web)
- `walletColor(address)` — derives consistent color from address hash (WALLET_COLORS[hash % 8]); native uses walletStore.wallet.color per-wallet, web has no multi-wallet store so derives from address.
- `walletLabel` = `profile?.displayName ?? profile?.username ?? "My Wallet"` (native uses walletStore.wallet.label).
- `walletInitial` = first char of walletLabel — displayed in hero avatar circle.
- QR code: `QRCodeSVG` from `qrcode.react` (installed). Native uses `react-native-qrcode-svg`.
- Send sheet: 3 steps (recipient → asset → amount) as a slide-up bottom sheet. Backdrop click closes it.
- Activity: Blockscout API (optimism.blockscout.com, base.blockscout.com) for OP+Base, grouped Today/Yesterday/This Month/Earlier, classified by method string.
- NFTs tab: stub only (matching NftGrid boundary — full port is separate work).
- Tabs: segmented pill control (bg-muted rounded, active = bg-background shadow).
- Quick actions: 5 circular buttons (Receive/Send/Refresh/Swap/Browser), all colored with walletColor. Swap/Browser show `toast.info("coming soon")`.

## Why
Native is the UI/UX reference. Web wallet must match it exactly. Money logic (gas estimation +30%, simulateContract for USDC, max ETH math) preserved unchanged from previous web version.

## How to apply
When adding wallet features (swap screen, NFT gallery, address book, etc.), read native's screen first via GITHUB_TOKEN then port the same pattern.
