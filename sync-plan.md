# FidCaster — Bidirectional Sync Plan
**Based on:** web `artifacts/farcaster-client` (React + Vite/Tailwind) ↔ native `fidcaster-native` (React Native)  
**Date analysed:** 2026-07-14  
**Rule:** Each app is edited in its own language. Web = React/TSX + Tailwind. Native = React Native/TSX + StyleSheet. No cross-contamination of primitives (no `div`/`className` in native, no `View`/`StyleSheet` in web).

---

## Ground Rules

- Web and native are **separate, independent apps** — they share logic concepts and feature parity goals, not code files.
- Port means "re-implement in the target platform's idioms", not copy-paste.
- Native never uses DOM APIs; web never uses RN primitives.
- Priorities below reflect impact-to-effort ratio and user-facing value.
- Features marked **web-only** (AdminPage, DownloadPage) are intentionally not ported.
- Features marked **native-only** (BrowserScreen, SensitiveContentGuard, push FCM wiring) are intentionally not ported.

---

## PART 1 — WEB → NATIVE
*Features/depth the web app has that native needs to catch up on.*

---

### 1.1 FidDetailPage → FidDetailScreen
**Web file:** `src/pages/FidDetailPage.tsx` (1 265 L)  
**Native file:** `src/features/fid-market/screens/FidDetailScreen.tsx` (661 L)

**Gap — web has, native is missing:**

| Feature | Web location | Notes |
|---|---|---|
| Post-sale "FID Sold" celebration redirect | `FidDetailPage` navigates to `FidSoldScreen` after successful buy | native has no equivalent; currently the screen just resets to idle |
| Full recent-casts section with CastCard | `FidDetailPage` lines ~800-1000 | native shows raw cast text rows, not full CastCard rendering |
| RecoveryAddress display + change flow | `FidDetailPage` lines ~600-700 | native reads `recoveryAddress` but doesn't show a recovery-change panel |
| Signer state warning (no wallet = SIWF) | inline banner in web buy panel | native has `extWallet` fallback gateway but missing the "You are SIWF, connect wallet" explanation banner |
| `FidSoldScreen` component itself | `src/components/FidSoldScreen.tsx` (250 L) | entire component missing in native — needs full port as a screen pushed on the MarketStack after a successful buy, with confetti/animation |

**What to do in native:**
1. Create `src/features/fid-market/screens/FidSoldScreen.tsx` — port `FidSoldScreen.tsx`, replace `View`/CSS with RN primitives, use `useTheme` colors.
2. Add `FidSold` route to `MarketStackParamList` and `MarketStack.tsx`.
3. In `FidDetailScreen.tsx` `buyPhase === 'done'` path: `navigation.replace('FidSold', { fid })` instead of just resetting state.
4. Expand the recent-casts section: swap plain `Text` cast rows for `CastCard` component (already exists at `src/features/feed/components/CastCard.tsx`).
5. Add `RecoveryAddress` panel (read-only display + "Change" CTA that deep-links to a wallet action or shows a modal) — port from web's `FidDetailPage` lines ~620-700.

---

### 1.2 FidMarketPage → FidMarketScreen (Watchlist + Activity tabs)
**Web file:** `src/pages/FidMarketPage.tsx` (954 L)  
**Native files:** `FidMarketScreen.tsx` (585 L), `WatchlistScreen.tsx` (372 L), `ActivityFeedScreen.tsx` (101 L)

**Gap — architecture difference:**

Web integrates Watchlist and Activity Feed as tabs _inside_ `FidMarketPage`. Native splits them into separate screens (`WatchlistScreen`, `ActivityFeedScreen`) pushed onto the stack, which is fine architecturally — **but the Market tab's header navigation between these screens is incomplete in native:**

| Feature | Web | Native |
|---|---|---|
| Watchlist tab inline in market | `FidMarketPage` Tab = `'listings' \| 'activity' \| 'watchlist'` | `WatchlistScreen` exists but not reachable from a header tab |
| Activity Feed inline | `FidMarketPage` Tab = `'activity'` | `ActivityFeedScreen` exists as a stack screen but entry point from market header is missing |
| "Search by address" wallet-lookup bar | `FidMarketPage` wallet search card | `WalletSearchScreen.tsx` (10 505 B) exists in native but isn't surfaced from the FidMarket header |
| Filter sort dropdown | web `DropdownMenu` | native has `DropdownMenu` component — sort menu wired, but missing some sort keys |
| FID listing banner for connected wallet | auto-detected via `lookupFid` | native already has `ownedFid` detection — display is present |

**What to do in native:**
1. Add a segment control / tab strip at the top of `FidMarketScreen` with tabs: **Listings | Activity | Watchlist** — tapping each navigates (or scrolls) to the matching screen. Can be implemented as `navigation.navigate('Watchlist')` / `navigation.navigate('ActivityFeed')` tabs in the stack header, matching the web's tab UX.
2. Expose `WalletSearchScreen` via a search icon in `MarketStack`'s header (right button), mirroring web's "search by wallet address" entry point.
3. Add missing sort keys to the sort dropdown if any are absent (compare `FidMarketPage.tsx` sort options vs native `SortKey` type).

---

### 1.3 ProfilePage → ProfileScreen (Cast Search + missing menu items)
**Web file:** `src/pages/ProfilePage.tsx` (1 158 L)  
**Native file:** `src/features/profile/screens/ProfileScreen.tsx` (780 L)

**Gap:**

| Feature | Web | Native |
|---|---|---|
| "Search casts" entry on profile | `ProfileCastSearchSheet` (110 L) opened from profile header | not implemented in native |
| BatchFollow from profile | "Browse & follow their community" CTA → `FollowPage?fid=X` | native `GrowStack` already accepts `{ fid?: number }` param — CTA missing from ProfileScreen |
| Spam label badges on cast list | `getSpamLabelsFor` integrated in profile casts | native ProfileScreen doesn't show spam labels on casts |
| Copy profile link menu item | "Copy link" in `showMoreMenu` | `ProfileMoreMenuSheet.tsx` in native — check if "Copy link" row exists |
| FID Market listing indicator on own profile | small banner showing "Your FID is listed" with price | native reads `getCachedListings` but the banner may not be rendered |

**What to do in native:**
1. Create `src/features/profile/screens/ProfileCastSearchScreen.tsx` — port `ProfileCastSearchSheet.tsx`; in native this becomes a full pushed screen (or a modal) that filters the profile's casts by keyword. Add route to `ProfileStack`.
2. In `ProfileScreen.tsx` add a "Browse & follow community" button (or menu item) that calls `navigation.navigate('GrowTab', { screen: 'Grow', params: { fid: targetFid } })`.
3. In `ProfileMoreMenuSheet.tsx` verify "Copy link" row exists; if not, add it using `@react-native-clipboard/clipboard`.
4. Verify and add the "Your FID is listed" banner to own-profile view in `ProfileScreen`.

---

### 1.4 CastCard — web → native feature gap
**Web file:** `src/components/CastCard.tsx` (1 154 L)  
**Native file:** `src/features/feed/components/CastCard.tsx` (730 L)

**Gap (web is ~424 lines more):**

| Feature | Web | Native |
|---|---|---|
| Frame / Mini App embed detection | checks embed URLs for frame meta, renders launch button | native has `miniapp-bridge.ts` but CastCard doesn't auto-detect + render frame embeds |
| Image carousel (multi-image embeds) | left/right swipe arrows for multiple images | native has `ChevronLeft/Right` imported but may not have full carousel implementation |
| NFT embed rendering | renders NFT thumbnail with chain/contract metadata | not in native CastCard |
| Sensitive content guard on cast media | `SensitiveContentGuard` wraps images | native has `SensitiveContentGuard.tsx` component — wire it into CastCard media |
| Long-press to select / copy text | native's clipboard is Clipboard pkg | may already exist but verify |
| Channel badge on casts | shows channel pill below author | verify native has channel display |

**What to do in native:**
1. **Frame / Mini App embed:** In `CastCard.tsx`, after rendering regular embeds, check if any embed URL matches frame patterns (has `fc:frame` meta or is a known mini-app URL). If yes, render a "Launch" button that calls `navigateOnce('MiniApp', { url, name })`. The detection logic exists in `src/core/miniapp-bridge.ts`.
2. **Image carousel:** Verify multi-image embed swipe is implemented; if not, add `currentImageIndex` state and Left/Right arrow pressables (pattern already imported).
3. **Sensitive content guard:** Wrap `FastImage` media renders in `<SensitiveContentGuard>`.
4. **Channel badge:** Confirm channel display is rendered on casts that have a `channel` field.

---

### 1.5 FidSoldScreen — new native screen
**Web file:** `src/components/FidSoldScreen.tsx` (250 L)  
**Native:** does not exist

Covered as part of §1.1 item 1 — create `src/features/fid-market/screens/FidSoldScreen.tsx`.

---

### 1.6 ProfileCastSearchSheet → native screen
**Web file:** `src/components/ProfileCastSearchSheet.tsx` (110 L)  
**Native:** does not exist

Covered in §1.3 item 1.

---

### 1.7 UserProfileSheet — inline author card
**Web file:** `src/components/UserProfileSheet.tsx` (205 L)  
**Native:** no equivalent (profile taps navigate to `ProfileScreen`)

**Gap:**  
Web shows a mini pop-up card when tapping an author's avatar in CastCard / notifications — quick follow/unfollow without leaving the current screen. Native navigates full-screen to `ProfileScreen`.

**What to do in native:**  
Decision point: either keep full-screen navigation (acceptable for mobile) or add a bottom-sheet mini card. **Recommended:** Add a lightweight `ProfilePreviewSheet.tsx` bottom sheet showing avatar, display name, bio, follower count, and a Follow/Following button. Used from `CastCard` author-avatar long-press. Port logic from `UserProfileSheet.tsx` using `@gorhom/bottom-sheet` (already used in the project).

---

### 1.8 BatchFollowSheet — "Follow from profile" flow
**Web file:** `src/components/BatchFollowSheet.tsx` (538 L)  
**Native:** integrated directly into `GrowScreen.tsx`

**Gap:**  
Web's `ProfilePage` shows a "Browse & follow their community" CTA that opens `BatchFollowSheet` pre-seeded with the target FID. Native's `GrowStack` already accepts `{ fid?: number }` — but the CTA button is missing from `ProfileScreen`.

Covered in §1.3 item 2 — no new file needed; just wire the nav call.

---

### 1.9 farcaster-db.ts — IndexedDB follow-list cache
**Web file:** `src/lib/farcaster-db.ts` (278 L)  
**Native:** explicitly deferred (noted in `GrowScreen.tsx` file header)

**Gap:**  
Web caches the follow list in IndexedDB so subsequent "Load" calls are instant. Native always does a fresh network fetch.

**What to do in native:**  
Create `src/core/follow-list-cache.ts` — port `farcaster-db.ts` using `kvStore` (MMKV) instead of IndexedDB. Key structure: `fc_follow_cache_${fid}_${mode}` with a TTL check. Wire into `GrowScreen.tsx`'s `loadList` to check the cache before making network calls — matches the reference exactly.

---

### 1.10 SpamAnalyzerSheet — account health scoring
**Web file:** `src/components/SpamAnalyzerSheet.tsx` (211 L) + `src/lib/spam-analysis.ts` (280 L)  
**Native:** `src/core/spam-labels.ts` + `src/core/spam-filter.ts` exist, but no UI sheet

**Note:** The "Health check" button was removed from both apps. The underlying analysis logic and sheet still exist in web.

**What to do in native (optional / lower priority):**  
Port `SpamAnalyzerSheet` as `src/components/SpamAnalyzerSheet.tsx` + `src/core/spam-analysis.ts`. Add entry point in `ProfileMoreMenuSheet.tsx` as a new row. The analysis functions in `spam-analysis.ts` use only data from `NeynarUser` so they translate 1:1. This is lower priority since the button was intentionally removed from both UIs.

---

## PART 2 — NATIVE → WEB
*Features/depth the native app has that web needs to catch up on.*

---

### 2.1 WalletPanelScreen → WalletPanel (address book + NFT gallery)
**Native file:** `src/features/wallet/screens/WalletPanelScreen.tsx` (1 817 L)  
**Web file:** `src/components/WalletPanel.tsx` (642 L)

**Gap — native has, web is missing:**

| Feature | Web | Native |
|---|---|---|
| Address book integration in Send flow | not present | `useAddressBookStore` used in send form — shows saved contacts with avatar |
| Speed Up / Cancel pending transactions | not present | `speedUpTransaction` / `cancelTransaction` from `core/tx-control.ts` |
| NFT gallery tab | not present | `NftGrid` + `NftGalleryScreen` — shows NFTs per wallet |
| Gas estimation with 30 % headroom | basic `estimateGas` | native adds `* 130n / 100n` padding for reliability |
| Pending transaction indicators | not present | `usePendingTxStore` shows pending tx rows with status |
| Wallet switcher sheet | not present (implicit in AccountModals) | `WalletSwitcherSheet` with search + balances |

**What to do in web:**
1. **Address book in Send:** Add a saved-contacts dropdown in `WalletPanel`'s Send flow. Create `src/lib/address-book.ts` (localStorage-backed) — port `src/state/addressBookStore.ts`'s shape. Render a `<AddressBookDropdown>` below the "To address" input.
2. **Speed Up / Cancel:** Port `src/core/tx-control.ts` as `src/lib/tx-control.ts`. In `WalletPanel`'s activity tab (if it has one) or in a pending-tx panel, add "Speed Up" and "Cancel" action buttons for pending transactions. Show using `useEffect` polling on pending tx hashes.
3. **NFT gallery tab:** Add an "NFTs" tab to `WalletPanel` using the existing `getWalletNfts` / OpenSea API. Port `NftGrid` logic into a `<WalletNftGrid>` React component.
4. **Gas headroom:** In `WalletPanel`'s `executeSend`, apply the same `estimatedGas * 130n / 100n` padding that native uses.

---

### 2.2 Global GrowActivityPill — floating batch progress across all tabs
**Native file:** `src/components/GrowActivityPill.tsx` (128 L)  
**Web:** does not exist — batch progress only visible inside `FollowPage`

**Gap:**  
Native has a globally-mounted floating pill (rendered in `RootNavigator.tsx`) that stays visible on every screen while a Follow/Unfollow/Purge batch is running. Tapping it navigates to the Active tab of GrowScreen. Web shows progress only inside `FollowPage`; if the user navigates away, they lose sight of the running batch.

**What to do in web:**
1. Create `src/components/BatchProgressPill.tsx` — a fixed-position pill (bottom-right, above nav bar) that reads state from `BatchOperationContext`. Render it in `App.tsx` outside the router outlet so it's always visible.
2. Clicking the pill navigates to `/follow?showActive=1` (add `showActive` query param support to `FollowPage`).
3. The pill should be dismissible per-operation (same `hiddenFromStack` concept from `BatchOperationContext`).

---

### 2.3 WatchlistScreen → web FidMarketPage watchlist tab
**Native file:** `src/features/fid-market/screens/WatchlistScreen.tsx` (372 L)  
**Web:** no watchlist feature anywhere in web

**Gap:**  
Native has a complete `WatchlistScreen` with add/remove FIDs, activity-level filter, watchlist-based market monitoring (`watchlist-monitor.ts`). Web has no watchlist concept at all.

**What to do in web:**
1. Port `src/core/watchlist.ts` and `src/state/watchlistStore.ts` (zustand) → web as `src/lib/watchlist.ts` (localStorage-backed, same shape).
2. Port `src/core/watchlist-monitor.ts` → `src/lib/watchlist-monitor.ts`.
3. Add a "Watchlist" tab to `FidMarketPage.tsx` — renders a `<WatchlistPanel>` component (port `WatchlistScreen`'s UI into a React panel component with Tailwind styling).
4. Add watchlist star button to `FidDetailPage.tsx` (already exists in native's `FidDetailScreen`).
5. Port `src/core/activity-feed.ts` and `src/state/activityFeedStore.ts` → web equivalents. Add a toast/notification when a watchlisted FID's price drops or gets listed.

---

### 2.4 batchOperationStore — bumpOwnFollowingCount optimization
**Native file:** `src/state/batchOperationStore.ts` — `bumpOwnFollowingCount()` function  
**Web file:** `src/hooks/BatchOperationContext.tsx` (859 L)

**Gap:**  
Native's `bumpOwnFollowingCount` immediately patches the cached following count in `recentProfileCache` after each follow/unfollow — so the profile header count updates in real-time during a large batch, not just on the next full profile refetch. Web `BatchOperationContext` does not have this.

**What to do in web:**
1. In `BatchOperationContext.tsx`, after each successful `follow`/`unfollow` hub call, call an equivalent function that updates `recentProfileCache` (if the web has one — check `src/lib/recent-profile-cache.ts` (23 L)). If the cache exists, add a `bumpFollowingCount(myFid, delta)` helper and call it in the batch loop.

---

### 2.5 Address Book Screen — new web feature
**Native file:** `src/features/wallet/screens/AddressBookScreen.tsx` (10 222 B ~250 L)  
**Web:** does not exist

**Gap:**  
Native has a full address book for the wallet (add/edit/delete named addresses, used in Send flow). Web has no address book.

**What to do in web:**  
Covered as part of §2.1 — create `src/lib/address-book.ts` + a `<AddressBookModal>` component accessible from `WalletPanel`'s Send form.

---

### 2.6 ApprovalsScreen → web wallet panel
**Native file:** `src/features/wallet/screens/ApprovalsScreen.tsx` (8 970 B ~220 L)  
**Web:** no equivalent

**Gap:**  
Native shows ERC-20 token approval allowances for the connected wallet and lets the user revoke them. Web has no approvals management.

**What to do in web:**  
Port logic from `ApprovalsScreen.tsx` — create `src/components/ApprovalsPanel.tsx` as a tab or section inside `WalletPanel`. Uses `core/contracts.ts` `ERC20_BALANCE_ABI` pattern — check allowances and surface revoke buttons.

---

### 2.7 NotificationsScreen — push permission + notification mute parity
**Native file:** `src/features/notifications/screens/NotificationsScreen.tsx` (725 L)  
**Web file:** `src/components/NotificationsPanel.tsx` (664 L)

**Status:** Both apps already have notification kind muting (`NotifSettingsMenu` in web, `getMutedNotifKinds` in native). Push permissions are native-only and not applicable to web.

**Remaining gap:**
- Native shows a "Push notifications" settings row that links to the OS settings. Web has no equivalent (browser push notifications not implemented).
- Native groups notifications with date separators ("Today", "Yesterday", weekday names). Web may already have similar grouping — **verify and align**.

**What to do in web:**
1. Verify date-separator grouping logic in `NotificationsPanel.tsx` matches native (`dateHeaderLabel` function). If missing, add it.
2. (Optional) Add a browser `Notification.requestPermission()` call in notification settings — show a "Enable browser notifications" toggle.

---

### 2.8 GrowScreen Active tab — batchOperationStore persisted resume
**Native file:** `GrowScreen.tsx` + `batchOperationStore.ts` — Active tab with auto-resume on mount  
**Web file:** `FollowPage.tsx` + `BatchOperationContext.tsx`

**Status:** Web `BatchOperationContext` already persists to `localStorage` and auto-resumes on mount (same pattern). This is essentially in parity.

**Remaining gap:**  
Web's FollowPage does not have an explicit "Active" tab UI — it shows the progress inline below the controls. Native has a dedicated "Active" tab that takes over the full screen while an op is running.

**What to do in web:**  
Add an "Active" tab button to `FollowPage`'s mode selector (alongside "Follow" / "Clean Up"). When `activeBatchOps.length > 0`, switch to the Active view automatically and show the `BatchProgressStack` full-page. This is purely a UI improvement — the underlying logic already exists.

---

### 2.9 SettingsScreen language + font-size picker parity
**Native file:** `src/features/settings/screens/SettingsScreen.tsx` (347 L) — full language + font size UI  
**Web:** `DashboardPage.tsx` has language tab (`LanguageSettingsPanel`) and font-size settings

**Status:** Both already have language picker and font-size settings. **Parity achieved** — no action needed.

---

### 2.10 SupportScreen → DashboardPage support section
**Native file:** `src/features/settings/screens/SupportScreen.tsx` (287 L)  
**Web:** support section exists inside `DashboardPage.tsx`

**Gap:**  
Native `SupportScreen` has a "Founder" card that fetches the founder's Farcaster profile and displays it. The web `DashboardPage` support panel may use `adminCfg.social` links which are admin-configurable. Native uses hardcoded founder FID `16333`.

**What to do in web:**  
Add a founder profile card to `DashboardPage`'s support section — fetch founder profile by FID using `getUserByFid` and render avatar, display name, bio. Mirror native's `SupportScreen` founder card layout.

---

### 2.11 CleanUpCastsScreen → web FollowPage purge mode
**Native file:** `src/features/grow/screens/CleanUpCastsScreen.tsx` (14 486 B ~360 L)  
**Web:** `FollowPage.tsx` has "cleanup" preset in `batch-follow-utils.tsx` but no Purge (delete casts/unlikes/un-recasts) mode

**Gap:**  
Native has a "Purge" mode (`cleanupOpStore.ts`, `CleanUpCastsScreen`) for bulk-deleting casts, unlikes, un-recasts. Web `FollowPage` only covers follow/unfollow — not cast cleanup.

**What to do in web:**
1. Port `src/core/cast-cleanup.ts` → `src/lib/cast-cleanup.ts`.
2. Port `src/state/cleanupOpStore.ts` → add a `CleanupOperationContext.tsx` (or extend `BatchOperationContext`).
3. Add a "Purge" tab to `FollowPage.tsx` (alongside "Follow" / "Clean Up") that renders `CleanUpCastsPanel` — port the UI from `CleanUpCastsScreen.tsx`.
4. Update `BatchProgressPill` (§2.2) to also show active Purge ops.

---

### 2.12 WalletConnectSessionsScreen → web WalletPanel
**Native file:** `src/features/wallet/screens/WalletConnectSessionsScreen.tsx` (15 777 B ~390 L)  
**Web:** `WalletConnectLogin.tsx` (265 L) handles login only, no session management

**Gap:**  
Native has a full WalletConnect sessions manager (list active sessions, disconnect, inspect). Web only has the login flow.

**What to do in web:**  
Add a "Connected Apps" section to `WalletPanel.tsx` (or a separate modal) that lists active WalletConnect sessions and allows disconnection. Port the sessions-list UI from `WalletConnectSessionsScreen.tsx`. Uses the existing `walletconnect-provider.ts` (`getActiveSessions`) — the logic is already in the web app.

---

### 2.13 GrowActivityPill — also covers native cleanupOpStore
**Native:** `GrowActivityPill.tsx` covers both `batchOperationStore` (follow/unfollow) and `cleanupOpStore` (purge).  
**Web §2.2:** The planned `BatchProgressPill` must also cover the Purge ops from §2.11.  
Already noted in §2.2 and §2.11 — just a reminder to wire both contexts.

---

## PART 3 — SHARED LIBRARY / LOGIC SYNC

These are library-level files where both apps have an implementation but one is ahead of the other.

### 3.1 neynar.ts parity
- **Native:** `src/core/neynar.ts` (27 632 B — very large)
- **Web:** `src/lib/neynar.ts` (628 L) + `src/lib/neynar-write.ts` (76 L)
- Both are independently maintained. Key check: ensure `getUsersByFidsBulk`, `getFollowers`, `getFollowing`, `getNotifications`, `getChannels`, `castByHash` signatures match between apps so ported features don't need API shim rewrites.
- **Action:** Do a function-name audit after each major port to ensure any new API calls added to one app's `neynar.ts` are added to the other. No bulk sync needed — sync per-feature as ports happen.

### 3.2 hub-submit.ts parity
- **Native:** `src/core/hub-submit.ts` (12 880 B ~320 L)
- **Web:** `src/lib/hub-submit.ts` (454 L)
- Both handle `hubFollow`, `hubReact`, `hubDeleteCast`, `hubPost`. Check that error handling and retry logic are equivalent.
- **Action:** Verify `hubDeleteCast` exists in web (needed for §2.11 Purge). Add if missing.

### 3.3 spam-labels.ts parity
- **Native:** `src/core/spam-labels.ts` (4 350 B ~110 L)
- **Web:** `src/lib/spam-labels.ts` (65 L)
- Native is significantly larger — likely has more label types or richer API.
- **Action:** Diff the two files when working on §1.3 (ProfileScreen spam badges). Port any missing label types or utility functions from native → web.

### 3.4 contracts.ts parity
- **Native:** `src/core/contracts.ts` (14 511 B ~360 L)
- **Web:** `src/lib/contracts.ts` (491 L)
- Both define `FID_MARKET_ADDRESS`, `ERC20_BALANCE_ABI`, `publicClient`, etc.
- **Action:** When adding web Approvals panel (§2.6), verify `ERC20_ALLOWANCE_ABI` exists in web `contracts.ts`. Port from native if missing.

### 3.5 translate.ts parity
- **Native:** `src/core/translate.ts` (7 195 B ~180 L) — uses `SUPPORTED_LANGS`, `getPreferredLang`, `setPreferredLang`
- **Web:** `src/lib/translate.ts` (139 L) — has `PREF_LANG_KEY`, direct + server translate paths
- Status: Essentially in parity for translation function. Native's `SUPPORTED_LANGS` array used in SettingsScreen; web's equivalent in `DashboardPage` `LanguageSettingsPanel`. Both functional.
- **Action:** No sync needed unless new languages are added — add to both `SUPPORTED_LANGS` arrays simultaneously.

### 3.6 fid-rating.ts parity
- **Native:** `src/core/fid-rating.ts` (4 760 B ~120 L)
- **Web:** not found as a standalone file — rating logic may be inline in `FidDetailPage` or missing
- **Action:** Check if `computeFidRating` exists in web. If not, port `src/core/fid-rating.ts` → `src/lib/fid-rating.ts` for use in `FidDetailPage` and `FidMarketPage`.

### 3.7 cast-drafts.ts parity
- **Native:** `src/core/cast-drafts.ts` (2 083 B ~52 L)
- **Web:** `src/lib/cast-drafts.ts` (77 L)
- Status: Both exist. Check that draft save/restore logic is equivalent.
- **Action:** Verify — no change likely needed.

---

## PART 4 — WEB-ONLY (do not port to native)

| File | Reason |
|---|---|
| `src/pages/AdminPage.tsx` (1 181 L) | Admin tooling — web-only ops, no mobile equivalent needed |
| `src/pages/DownloadPage.tsx` (189 L) | Promotes the native app — irrelevant inside native |
| `src/pages/NativeWelcomePage.tsx` (113 L) | Web-only native onboarding stub |
| `src/pages/DashboardPage.tsx` (1 412 L) | Web-only settings hub (native uses dedicated SettingsScreen + SupportScreen) |
| `src/lib/miniapp-iframe-host.ts` | Browser iframe bridge — no iframe in native |
| `src/lib/miniapp-web-state.ts` | Browser-specific mini app state |
| `src/lib/native-api-bridge.ts` | Web→Capacitor bridge — irrelevant in native |
| `src/lib/cast-image.ts` | Canvas-based share-as-image — web Canvas API, use `captureRef` in native (already done in `ShareSheet.tsx`) |
| `server/` | Dev-only Express helper — not in native |

---

## PART 5 — NATIVE-ONLY (do not port to web)

| File | Reason |
|---|---|
| `src/core/push.ts` | FCM push tokens — native OS only |
| `src/core/screenSecurity.ts` | Screen capture prevention — OS-level |
| `src/components/SensitiveContentGuard.tsx` | App-switcher blur — iOS/Android feature |
| `src/features/wallet/screens/BrowserScreen.tsx` | In-app WebView browser — web IS the browser |
| `src/components/ConnectedSiteDrawer.tsx` | Browser WebView wallet connector — not applicable to web |
| `src/features/wallet/screens/BridgeScreen.tsx` | Stub — TBD when bridge feature ships |
| `src/navigation/RootNavigator.tsx` etc. | React Navigation stack — web uses Wouter |
| `src/design-system/` | RN-specific design primitives |
| `src/theme/tokens.ts` | RN StyleSheet tokens |
| `src/storage/secureStore.ts` | Keychain / EncryptedSharedPreferences — web uses `session-crypto.ts` + localStorage |
| `src/storage/kvStore.ts` | MMKV — web uses localStorage directly |

---

## PRIORITY MATRIX

| # | Work item | Direction | Impact | Effort | Priority |
|---|---|---|---|---|---|
| 1 | Global `BatchProgressPill` (§2.2) | native→web | High | Low | 🔴 P1 |
| 2 | WatchlistScreen + watchlist logic (§2.3) | native→web | High | Medium | 🔴 P1 |
| 3 | FidSoldScreen + CastCard in FidDetail (§1.1) | web→native | High | Medium | 🔴 P1 |
| 4 | Follow-from-profile CTA in ProfileScreen (§1.3 item 2) | web→native | High | Low | 🔴 P1 |
| 5 | farcaster-db follow-list cache in native (§1.9) | web→native | Medium | Low | 🟡 P2 |
| 6 | ProfileCastSearchScreen in native (§1.3 item 1, §1.6) | web→native | Medium | Low | 🟡 P2 |
| 7 | CastCard frame/mini-app embed in native (§1.4 item 1) | web→native | Medium | Medium | 🟡 P2 |
| 8 | Address book in web WalletPanel Send (§2.1, §2.5) | native→web | Medium | Medium | 🟡 P2 |
| 9 | Speed Up / Cancel txs in web WalletPanel (§2.1) | native→web | Medium | Medium | 🟡 P2 |
| 10 | CleanUpCastsScreen → web Purge tab (§2.11) | native→web | Medium | High | 🟡 P2 |
| 11 | Active tab UI in web FollowPage (§2.8) | native→web | Medium | Low | 🟡 P2 |
| 12 | bumpOwnFollowingCount in web (§2.4) | native→web | Low | Low | 🟢 P3 |
| 13 | Approvals panel in web WalletPanel (§2.6) | native→web | Low | Medium | 🟢 P3 |
| 14 | WalletConnect sessions in web (§2.12) | native→web | Low | Medium | 🟢 P3 |
| 15 | NFT gallery tab in web WalletPanel (§2.1) | native→web | Low | Medium | 🟢 P3 |
| 16 | RecoveryAddress panel in native FidDetail (§1.1) | web→native | Low | Medium | 🟢 P3 |
| 17 | ProfilePreviewSheet mini card in native (§1.7) | web→native | Low | Medium | 🟢 P3 |
| 18 | SpamAnalyzerSheet in native (§1.10) | web→native | Low | Medium | 🟢 P3 |
| 19 | fid-rating.ts in web (§3.6) | native→web | Low | Low | 🟢 P3 |
| 20 | Founder card in web support section (§2.10) | native→web | Low | Low | 🟢 P3 |
| 21 | WatchlistScreen tabs/entry in native market (§1.2) | web→native | Medium | Low | 🟡 P2 |
| 22 | Date-separator grouping in web notifications (§2.7) | native→web | Low | Low | 🟢 P3 |
| 23 | spam-labels.ts parity audit (§3.3) | bidirectional | Low | Low | 🟢 P3 |
| 24 | Market sort-key parity (§1.2 item 3) | web→native | Low | Low | 🟢 P3 |
