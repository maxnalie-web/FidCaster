import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor config — wraps the FidCaster web build as a native iOS/Android app.
 *
 * The native shell exists primarily so mini apps can run embedded: a native
 * WebView lets us inject JS at document-start to satisfy each app's
 * "am I inside a Farcaster client?" gate (see src/lib/miniapp-native.ts).
 *
 * `webDir` points at the Vite build output. The app's /api/* calls must reach a
 * hosted backend in production — set `server.url` (below) to your deployed
 * origin, or run the bundled web build against a remote API base.
 */
const config: CapacitorConfig = {
  appId: "xyz.fidcaster.app",
  appName: "FidCaster",
  webDir: "dist/public",
  // For development against the live dev server, uncomment and point at your LAN IP:
  // server: { url: "http://192.168.1.10:5001", cleartext: true },
  ios: { contentInset: "always" },
  android: { allowMixedContent: true },
};

export default config;
