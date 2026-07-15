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

### MobileDrawer — "..." button → AccountsSheet
- **Native**: tapping "..." opens a bottom sheet with drag handle, "Edit | Accounts" header,
  account rows (avatar + checkmark for active), "Add an account" at bottom
- **Web was**: "..." called onAddAccount directly
- **Fixed in**: `src/pages/DashboardPage.tsx` MobileDrawer — added showAccSheet state + AccountsSheet overlay

### Purge Active tab — kindLabel
- **Was**: kindLabel had "likes"/"recasts" as keys instead of "unlike"/"unrecast"
- Active tab showed raw kind string for unlike/unrecast ops
- **Fixed in**: `src/pages/FollowPage.tsx` ActiveGrowsView

## Performance fixes

### Purge scan page size
- getUserReplies/Likes/Recasts: limit 25 → 50 (proxy), up to 150 (direct with pool)
- getUserCasts: limit 100 → 150
- Result: fewer pages needed for same cast count; comments no longer show only 9/page

### Neynar API key pool
- `src/lib/neynar-pool.ts`: round-robin pool, nextKey(primary) falls back to primary if pool empty
- `directNeynarGet()` in neynar.ts: bypasses server proxy, uses pool key directly
- cast-cleanup.ts fetchPage: uses pool key rotation so each sequential page hits a different key
- UI in AppSettingsPanel (Settings → App tab): textarea to paste keys, Save button, active count badge
- **Storage**: `fc_neynar_pool_v1` in localStorage

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
"..." opens AccountsSheet (bottom sheet) not AddAccount modal directly.
