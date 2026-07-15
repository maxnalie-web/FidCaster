---
name: Wallet avatar identicons
description: Emoji removed from all wallet avatar displays; replaced with address-based hex initials.
---

## Rule
Never use `wallet.emoji` for avatar display. Always render the first 2 hex chars of the wallet's first account address as uppercase initials inside a colored circle.

## Pattern
```tsx
<div
  className="w-9 h-9 rounded-full flex items-center justify-center font-black text-white text-xs"
  style={{ backgroundColor: wallet.color }}
>
  {wallet.accounts[0]?.address
    ? wallet.accounts[0].address.slice(2, 4).toUpperCase()
    : wallet.label.slice(0, 2).toUpperCase()}
</div>
```

For the main hero avatar in WalletPanel (uses `address` directly, not `wallet`):
```tsx
<span className="text-[26px] font-black text-white leading-none select-none tracking-tight">
  {address ? address.slice(2, 4).toUpperCase() : "WL"}
</span>
```

**Why:** User explicitly requested no emoji for wallet avatars. Emoji look inconsistent across devices and platforms; hex initials are deterministic and clean.

**Files changed:** WalletPanel.tsx, WalletsList.tsx, WalletSwitcherSheet.tsx, WalletSettings.tsx

**Note:** The `emoji` field still exists on the `Wallet` type in walletStore.ts and is still persisted — just never rendered.
