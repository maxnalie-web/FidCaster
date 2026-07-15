---
name: Native UI sync findings
description: Visual differences identified between native (maxnalie-web/fidcaster-native) and web app; which are fixed and which are pending.
---

# Native UI sync findings

## Fixed

### ProfilePage — following/followers order
- **Native**: following count first, followers count second
- **Fixed in**: `src/pages/ProfilePage.tsx` stats bar

### MobileDrawer — top row, nav items, bio, accounts list
- **Fixed in**: `src/pages/DashboardPage.tsx` MobileDrawer component
- Big avatar + mini avatars + "..." → AccountsSheet (bottom sheet)
- Nav: Channels → FID Market → Mini Apps → Settings → Support
- No bio shown in drawer

### Purge "Loading your account..." phantom text
- Was showing below cleanup cards because the idle-state placeholder rendered
  for all modes when `canLoad === false`
- **Fixed**: added `mode !== "purge" &&` guard to the idle/searching block
- **Fixed in**: `src/pages/FollowPage.tsx` ~line 1358

### Real-time profile updates after actions
- After unrecast/unlike/follow/unfollow, profile page was showing stale data
  from `_profileCache` (module-level Map in ProfilePage.tsx)
- **Fixed**: exported `bustProfileCache()` from ProfilePage.tsx; called in:
  - `CleanupOpContext.tsx` when any cleanup op completes
  - `BatchOperationContext.tsx` when any follow/unfollow batch completes
- Next profile visit always fetches fresh data

### Safe area (iPhone notch / home indicator)
- BottomNav and DashboardPage nav bar had fixed `h-[54px]` with no safe area
- **Fixed**:
  - `index.html` viewport meta: added `viewport-fit=cover`
  - `BottomNav.tsx`: `flex-col` + `paddingBottom: env(safe-area-inset-bottom)`
  - `DashboardPage.tsx` nav: same pattern
  - FAB position: `bottom: calc(70px + env(safe-area-inset-bottom))`

### ComposeModal → native-style bottom sheet on mobile
- Was a centered popup on all screen sizes
- **Fixed**: bottom sheet that slides up on mobile (`items-end`), centered modal
  on desktop; drag handle pill visible on mobile; `slide-in-from-bottom` animation

### Purge Active tab — kindLabel
- Was using "likes"/"recasts" keys but CleanupKind values are "unlike"/"unrecast"
- **Fixed in**: `src/pages/FollowPage.tsx` ActiveGrowsView

## Performance fixes

### Purge scan page size
- getUserReplies/Likes/Recasts: limit 25 → 50 (proxy), up to 150 (direct with pool)
- getUserCasts: limit 100 → 150

### Neynar API key pool
- `src/lib/neynar-pool.ts`: round-robin pool, nextKey(primary) falls back to primary
- `directNeynarGet()` in neynar.ts: bypasses server proxy, uses pool key directly
- cast-cleanup.ts fetchPage: pool key rotation per sequential page
- UI in AppSettingsPanel (Settings → App tab): textarea, Save button, active count badge

## Pending

### Notifications not like native
- User says notifications look different from native; no native screenshot available
  to identify specific differences — defer until reference is provided

### Wallet screen depth
- Native has WalletsListScreen, SwapScreen, NftGalleryScreen, etc. (multi-day effort)

## Key constants / patterns
- CleanupKind values: `"casts" | "replies" | "unlike" | "unrecast"` (not "likes"/"recasts")
- Profile cache key: `${myFidNum}:${targetFid}` (viewer + target)
- `_profileCache` is module-level in ProfilePage.tsx → import `bustProfileCache` to clear it
- Safe area: must have `viewport-fit=cover` in meta for `env(safe-area-inset-bottom)` to work on iOS
