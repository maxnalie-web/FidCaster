---
name: Android WebView backdrop-blur scroll corruption
description: TV-static/noise rendering artifacts appear over scrolling content on Android (esp. Telegram in-app browser) when a sticky/fixed element uses backdrop-filter blur.
---

Sticky headers or fixed bottom nav bars styled with `backdrop-blur-*` (Tailwind) sitting above a long scrolling list of images (e.g. avatar-heavy cards) can trigger a GPU compositing bug on Android WebViews — most visibly in the Telegram in-app browser — that renders as static/noise-like corruption and ghosted duplicate text over the scrolled content.

**Why:** the blurred, persistently-positioned element forces continuous re-compositing of the layer stack while content scrolls beneath it; some Android WebView GPU drivers corrupt the tile cache in this scenario. Not reproducible in desktop browsers, hard to catch without a real low/mid-end Android device or the report itself.

**How to apply:** if a user reports this exact visual signature (noise/static bands, duplicated ghost text, worse near image-heavy list items) on a page with a sticky/fixed `backdrop-blur` bar, the fix is to remove `backdrop-filter`/`backdrop-blur-*` from persistent (always-visible-during-scroll) nav/header bars and replace with a solid (non-transparent) background instead of just bumping opacity. Leave transient full-screen modal dimmers (`fixed inset-0 bg-black/70 backdrop-blur-sm` used for dialogs) alone — they aren't the same failure mode since they don't sit above continuously scrolling content.

In this project (`artifacts/farcaster-client`), this pattern existed across nearly every page's sticky header and the shared `BottomNav` component — check for regressions there if new sticky/fixed bars with blur are added.
