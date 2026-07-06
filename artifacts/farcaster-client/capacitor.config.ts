import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config — wraps the FidCaster web build as a native iOS/Android app.
 *
 * The native shell exists primarily so mini apps can run embedded: a native
 * WebView lets us inject JS at document-start to satisfy each app's
 * "am I inside a Farcaster client?" gate (see src/lib/miniapp-native.ts).
 *
 * `webDir` points at the Vite build output, loaded LOCALLY from the device ·
 * this is what makes the app launch instantly and feel like a real native
 * app instead of a website loaded live over the network on every open. The
 * app's own `fetch("/api/...")` calls still need to reach the real hosted
 * backend though, since there's no server behind the WebView's local
 * origin · src/lib/native-api-bridge.ts rewrites those at runtime instead of
 * pointing the whole WebView at the live site (the previous approach: simple,
 * but every navigation genuinely showed the live website, and any page that
 * relied on same-origin behavior became indistinguishable from a browser tab).
 *
 * For local device/simulator testing against a LAN dev server, override with
 * an env var to fall back to the old remote-loading behavior:
 *   CAP_SERVER_URL=http://192.168.1.10:5001 npm run cap:sync
 */
const config: CapacitorConfig = {
  appId: "xyz.fidcaster.app",
  appName: "FidCaster",
  webDir: "dist/public",
  ...(process.env.CAP_SERVER_URL
    ? {
        server: {
          url: process.env.CAP_SERVER_URL,
          cleartext: process.env.CAP_SERVER_URL.startsWith("http://"),
        },
      }
    : {}),
  ios: { contentInset: "always" },
  android: { allowMixedContent: true },
};

export default config;
