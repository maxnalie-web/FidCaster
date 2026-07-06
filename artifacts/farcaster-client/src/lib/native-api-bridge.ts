import { isNativeRuntime } from "./miniapp-native";

/**
 * The real backend origin API calls must reach when this bundle is running
 * inside the native Capacitor shell. The native WebView loads the app's own
 * bundled assets locally (so the app launches instantly and feels like a
 * real native app instead of a website loaded live in a browser), which
 * means its own origin is a synthetic local one (`https://localhost` on
 * Android, `capacitor://localhost` on iOS) with no server behind it — every
 * one of this app's own `fetch("/api/...")` calls needs to be redirected to
 * the actual deployed backend instead.
 */
export const NATIVE_API_ORIGIN = "https://fidcaster.xyz";

/**
 * Patches the global fetch so this app's own same-origin-relative requests
 * ("/api/...") get redirected to NATIVE_API_ORIGIN when running natively.
 * No-op on the web, where relative requests already resolve correctly
 * against whatever origin actually served the app.
 *
 * Must run before any other module in the app issues a fetch call — call it
 * at the very top of main.tsx, before importing/rendering anything else.
 */
export function installNativeFetchBridge(): void {
  if (!isNativeRuntime()) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (typeof input === "string" && input.startsWith("/")) {
      return originalFetch(NATIVE_API_ORIGIN + input, init);
    }
    return originalFetch(input, init);
  }) as typeof window.fetch;
}
