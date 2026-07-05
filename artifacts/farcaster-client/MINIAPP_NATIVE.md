# Running Farcaster Mini Apps embedded (native shell)

## Why a native shell is required

Production Farcaster mini apps refuse to render unless they believe they're
inside an official client. They detect this in **their own JavaScript** by
reading `document.referrer` and `window.ReactNativeWebView`, then matching
against a hardcoded allowlist (`farcaster.xyz`, `warpcast.com`, `base.app`,
`coinbase.com`). In a **web iframe** we cannot touch a cross-origin document, so
those apps stay blank — this is browser-enforced and unbypassable on the web.

A **native WebView** can inject JavaScript at *document-start* (before the app's
own code runs), which is exactly how Base / the Farcaster app do it. We inject a
small script that spoofs `document.referrer` and `window.ReactNativeWebView`, so
the app's gate passes and it renders embedded.

- Web build → mini apps open in an in-app **iframe** (works for apps that don't
  gate; the rest offer "open in new tab").
- Native build → mini apps open in a native WebView with the document-start
  spoof, so the gated apps render too.

Platform detection and the iframe fallback are automatic
(`src/lib/miniapp-native.ts`, used by `src/components/MiniAppsPanel.tsx`).

## One-time setup (on a Mac with Xcode / Android Studio)

```bash
cd artifacts/farcaster-client

# Build the web bundle Capacitor will wrap
npm run build

# Add the native platforms (creates ios/ and android/ projects)
npm run cap:add:ios
npm run cap:add:android
```

## Backend (important)

The web app calls `/api/*` (the Express server). A packaged native build loads
the app straight from the live deployment (`https://fidcaster.xyz`, set in
`capacitor.config.ts`) so those calls reach the real backend. Override it for
local device/simulator testing against a LAN dev server:

```bash
CAP_SERVER_URL=http://<your-LAN-ip>:5001 npm run cap:sync
```

## Run on device / simulator

```bash
npm run cap:ios       # builds, syncs, opens Xcode → Run
npm run cap:android   # builds, syncs, opens Android Studio → Run
```

Open the **Mini Apps** tab and tap an app (e.g. Spor). It loads in the native
WebView with the document-start spoof and should render instead of going blank.

## Status / stages

- **Stage 1 (done):** document-start injection spoofs `document.referrer` +
  `window.ReactNativeWebView` so apps pass their client gate and **render**.
- **Stage 2 (next):** wire the full Farcaster host over the native message bridge
  (`InAppBrowser` `messageFromWebview` / `postMessage`) using
  `exposeToEndpoint` from `@farcaster/miniapp-host`, so the app also receives the
  signed-in **context** (fid/username) and an **auto-connected wallet**
  (EIP-1193 provider) — the `ReactNativeWebView` shim already forwards the SDK's
  messages to the app; only the native-side responder remains.

The injection script and native opener live in `src/lib/miniapp-native.ts`.
