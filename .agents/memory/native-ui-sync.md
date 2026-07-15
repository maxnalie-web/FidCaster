---
name: Native UI sync findings
description: Visual differences identified between native (maxnalie-web/fidcaster-native) and web app; which are fixed and which are pending.
---

# Native UI sync findings

## Fixed

### ProfilePage — following/followers order
- **Native**: following count first, followers count second
- **Web was**: followers first, following second
- **Fixed in**: `src/pages/ProfilePage.tsx` stats bar

### MobileDrawer — top row
- **Native**: big avatar (left) + up to 2 mini avatars of other accounts + "..." button (right)
- **Web was**: big avatar + theme-toggle moon/sun button
- **Fixed in**: `src/pages/DashboardPage.tsx` MobileDrawer component

### MobileDrawer — nav items
- **Native**: Channels → FID Market → Mini Apps → Settings → Support
- **Web was**: missing "Mini Apps"
- **Fixed in**: `src/pages/DashboardPage.tsx` MobileDrawer nav section

### MobileDrawer — bio
- **Native**: no bio shown in drawer
- **Web was**: showed bio under name
- **Fixed in**: `src/pages/DashboardPage.tsx` MobileDrawer

### MobileDrawer — expanded accounts list
- **Native**: no inline expanded list; accounts accessed via mini-avatar row at top
- **Web was**: separate accounts list section below divider
- **Fixed in**: `src/pages/DashboardPage.tsx` — removed accounts list section

## Pending / larger scope

### Wallet screen depth
- Native has a full wallet navigation stack: WalletsListScreen, CreateWalletScreen, ImportPrivateKeyScreen, BrowserScreen, SwapScreen, NftGalleryScreen, AddressBookScreen, etc.
- Web has a single WalletPanel tab inside Dashboard
- Would require significant new pages/navigation to match

**Why:** The web wallet is functional but not as deep as native. Matching it fully is a multi-day effort.

## Native tab bar (reference)
Order: Home → Search → Grow → Wallet → Notifications → Profile
Web bottom nav matches this order.

## Native NavDrawer (reference)
From screenshot: big avatar + mini avatars + "..." / Name / @handle / divider / Channels / FID Market / Mini Apps / Settings / Support / [pinned bottom] Sign out
