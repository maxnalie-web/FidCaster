---
name: Playwright E2E in Replit NixOS
description: How to set up and run Playwright E2E tests in Replit's NixOS environment — what works and what doesn't.
---

# Playwright E2E in Replit NixOS

## The rule
Use the Nix system Chromium (`which chromium`) as the `executablePath` — the Playwright-downloaded headless shell fails with missing `libglib-2.0.so.0` even after installing Nix system libraries.

**Why:** The Playwright headless shell binary is dynamically linked and expects libraries at `/usr/lib` paths. Nix puts them in `/nix/store/...`. The wrapper script for the system Nix chromium already patches the library paths correctly.

**How to apply:**
```typescript
// playwright.config.ts
import { execSync } from "child_process";
const chromiumExecutable = (() => {
  try { return execSync("which chromium", { encoding: "utf8" }).trim(); }
  catch { return undefined; }
})();

// In use.launchOptions:
executablePath: chromiumExecutable,
args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu", ...]
```

## Known sandbox limitation
Playwright browser execution hangs (process killed with exit code -1 and no output) when run inside the Replit agent's bash sandbox. The test runner and TypeScript compilation work fine (`--list` shows all tests). Tests execute correctly in proper CI environments (GitHub Actions etc.).

## What to install
```javascript
// System dependencies (required even with Nix Chromium)
await installSystemDependencies({ packages: ["chromium", "glib", "nss", "nspr", "dbus",
  "xorg.libX11", "xorg.libXcursor", "xorg.libXdamage", "xorg.libXext", "xorg.libXi",
  "xorg.libXrandr", "xorg.libXrender", "xorg.libXtst", "xorg.libxcb",
  "libxkbcommon", "at-spi2-atk", "cups", "expat", "fontconfig", "freetype",
  "gtk3", "cairo", "pango", "alsa-lib"] });
// Then install playwright browser (skip for system chromium)
// npx playwright install chromium  (optional, not used with executablePath)
```

## E2E package location
Always put E2E package in `artifacts/e2e` (not `packages/e2e`) because `pnpm-workspace.yaml` only includes `artifacts/*`, `lib/*`, and `scripts`. Package name `@workspace/e2e` works for `pnpm --filter @workspace/e2e test`.

## webServer ports for DevStation
- API server: `PORT=8080 pnpm --filter @workspace/api-server run dev` (Vite proxy target)
- IDE: `PORT=5000 pnpm --filter @workspace/ide run dev`
- Both use `reuseExistingServer: true` so they reuse already-running workflow servers
