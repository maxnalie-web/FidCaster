---
name: FarcasterSignIn white-on-light bug
description: FarcasterSignIn.tsx was hardcoded for dark background; becomes invisible in light-mode modal contexts.
---

## Rule
`FarcasterSignIn` is embedded in two places: `AuthPage` (dark gradient background) and `AddAccountModal` (light `bg-background`). All text/icon colors must use theme-aware Tailwind classes, not hardcoded `rgba(255,255,255,...)`.

**Why:** The original component was built solely for AuthPage's dark UI. When reused inside AddAccountModal, every piece of white text became invisible against the white modal background. Users saw a blank input and "Sign In With Farcaster" button with no explanation text.

**How to apply:** Any future edits to FarcasterSignIn must use `text-foreground`, `text-muted-foreground`, `text-foreground/75`, etc. — never inline `color: rgba(255,255,255,...)`. The `lp-cta-btn` button class is safe (has its own purple bg + white text). Border/background accent boxes should use `border-violet-500/20 bg-violet-500/5` or equivalent theme classes.
