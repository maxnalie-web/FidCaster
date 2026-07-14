---
name: Admin panel removal
description: How the admin panel was removed from the FidCaster web app and what was hardcoded in its place.
---

## Rule
The admin panel (AdminPage, admin-config, admin-api, useAdminConfig) is fully removed. Do NOT re-add it or any reference to these deleted files.

**Why:** User explicitly requested complete removal. Admin config was used for remote-configurable theming, SEO, feature flags, announcements, and social links — all now hardcoded.

## Hardcoded values
- ADMIN_FID = 16333 (in DashboardPage.tsx, BatchOperationContext.tsx — literal, not imported)
- Social links: twitter=https://x.com/fidcaster, telegram=https://t.me/Fidcaster, farcaster=https://farcaster.xyz/fidcaster
- Landing features: hardcoded LANDING_FEATURE_DATA array in LoginPage.tsx
- Footer: "FidCaster", "The Farcaster client for power users.", copyright via new Date().getFullYear()

## Feature flags after removal
- miniAppsAllowed = false (always off)
- Grow = always shown (no flag)
- Wallet = always shown in desktop sidebar (removed mnemonic-only gate)

## Files deleted
- src/pages/AdminPage.tsx
- src/lib/admin-config.ts
- src/lib/admin-api.ts
- src/hooks/useAdminConfig.ts

## Files edited (beyond the 4 deleted)
- App.tsx, DashboardPage.tsx, DesktopSidebar.tsx, NativeWelcomePage.tsx, BatchOperationContext.tsx, LoginPage.tsx
