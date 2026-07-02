---
name: FidCaster Grow filter bugs
description: Root causes and fixes for Grow/Follow page filter failures (cache bug, Pro filter, badges)
---

## Cache bypass rule for strict filters
`loadList` in FollowPage.tsx uses an IndexedDB 15-min cache. `minRawNeeded = limit × 4`.
If the cache has 200 users but user sets minFollowers=3000 or onlyPowerBadge=true, cache gives 0 results.

**Fix**: set `strictFilters = minFollowers>0 || maxFollowers>0 || onlyPowerBadge || onlyPro`.
When strictFilters=true, pass `null` to bypass cache entirely and always do a fresh MAX_SCAN scan.

## Pro vs Power Badge (two different purple badges)
- `power_badge: true` (NeynarUser field, from Neynar bulk follower API) = Warpcast Power Badge.
  Shown as PowerBadgeIcon (#7C3AED purple). Checked via `hasPowerBadge()`.
- "Pro" ($10/mo Farcaster subscription) = separate `/api/pro-status?fids=` endpoint.
  Shown as ProBadge (#7c5cff violet). NOT in bulk follower response — requires post-scan batch fetch.

**Why:** User says "I set Pro filter, finds 0 Pro users." `onlyPowerBadge` filter was mis-labeled as "pro"
and the cache bug made it return 0 anyway.

## Pro filter implementation pattern
`onlyPro` is a BatchFilters field handled OUTSIDE applyFilters (async, separate endpoint):
1. Scan full list (skip early-exit — Pro unknown until batch-fetch)
2. Apply all other filters with limit=MAX_SCAN → candidates[]
3. Batch-fetch `/api/pro-status?fids=` in chunks of 100
4. Filter candidates to Pro-only, slice to limit
Server caches Pro status 6h, so repeat scans are fast.

## Early-exit skip for Pro
The scan loop break condition `interim.length >= limit` must be skipped when `onlyPro=true`,
because Pro ratio is unknown during scan and early-exit would leave too few candidates.

**How to apply:** `if (!currentFilters.onlyPro) { if (interim.length >= limit) break; }`
