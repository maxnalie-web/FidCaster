---
name: WalletPanel early-return overlay bug
description: The overlay never renders when wallets.length===0 because the early return is above the overlay JSX
---

## The Rule
When adding an early-return guard in a component that also renders overlay/modal JSX lower down, always check that the overlay state is also "closed" before early-returning, or move the overlay JSX above the early return.

## Why
WalletPanel had `if (!address && wallets.length === 0) { return <NoWalletState />; }` placed ABOVE the `{overlay !== "none" && <OverlaySheet />}` JSX. Clicking "Set Up Wallet" called `setOverlay("list")` but the component kept re-rendering the early-return because `wallets.length` was still 0. The overlay was never shown.

## How to Apply
Fix: change the guard to `if (!address && wallets.length === 0 && overlay === "none")`. This lets the component fall through to the main return (which contains the overlay) as soon as the user triggers the setup flow.
