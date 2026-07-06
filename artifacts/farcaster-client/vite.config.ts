import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
const port = Number(process.env.PORT ?? "5000");
const basePath = process.env.BASE_PATH ?? "/";
const isReplit = process.env.REPL_ID !== undefined;

// Vite only auto-loads VITE_-prefixed vars. APP_FID / APP_MNEMONIC / etc. live in
// .env WITHOUT that prefix (they're server-side secrets), so load the full env
// explicitly here and fold in real process.env — otherwise SIWF's app identity is
// blank in the browser build ("VITE_APP_FID / VITE_APP_MNEMONIC missing").
const fileEnv = loadEnv(process.env.NODE_ENV ?? "development", import.meta.dirname, "");
const env = { ...fileEnv, ...process.env };

export default defineConfig({
  base: basePath,
  plugins: [
    nodePolyfills({ include: ["buffer", "stream", "util", "process"] }),
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/favicon-16.png", "icons/favicon-32.png", "icons/apple-touch-icon.png"],
      manifest: {
        name: "FidCaster",
        short_name: "FidCaster",
        description: "FidCaster — a luxury Farcaster client. Your keys, your identity.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#6b26d9",
        orientation: "portrait",
        categories: ["social", "utilities"],
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Precache only the built static assets · API responses must never be
        // precached/cached by the service worker (this app already had bugs
        // from stale server-side caching — a SW cache on top would make that
        // far worse and much harder to diagnose).
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,woff,woff2}"],
        // The main JS chunk is a few MB (a separate, pre-existing code-splitting
        // opportunity) · raise Workbox's 2 MiB default so it still gets precached
        // instead of silently being dropped from offline support.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            // Explicit network-only for the API, even though it's outside
            // globPatterns already · documents intent and guards against a
            // future runtimeCaching rule accidentally widening to /api/.
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts-stylesheets" },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts-webfonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    isReplit
      ? [
          await import("@replit/vite-plugin-runtime-error-modal").then((m) =>
            m.default(),
          ),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  define: {
    // Use the merged `env` (loadEnv file vars + process.env) — the non-VITE_
    // secrets live only in .env, so process.env.APP_FID is undefined here and
    // would bake blank credentials into the build (breaking SIWF).
    "import.meta.env.VITE_WALLETCONNECT_PROJECT_ID": JSON.stringify(
      env.WALLETCONNECT_PROJECT_ID ?? env.VITE_WALLETCONNECT_PROJECT_ID ?? ""
    ),
    "import.meta.env.VITE_IMGUR_CLIENT_ID": JSON.stringify(
      env.IMGUR_CLIENT_ID ?? env.VITE_IMGUR_CLIENT_ID ?? ""
    ),
    "import.meta.env.VITE_APP_FID": JSON.stringify(
      env.APP_FID ?? ""
    ),
    "import.meta.env.VITE_APP_MNEMONIC": JSON.stringify(
      env.APP_MNEMONIC ?? ""
    ),
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    // No source maps in the shipped build — esbuild's default minifier already
    // shortens identifiers, but terser's mangle+compress passes go further
    // (property mangling off by default since it can break code that accesses
    // object keys as strings, e.g. JSON responses) and its dead-code removal
    // is more thorough, raising the bar for reading the bundle.
    sourcemap: false,
    minify: "terser",
    terserOptions: {
      compress: { drop_console: true, drop_debugger: true, passes: 2 },
      mangle: true,
      format: { comments: false },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com https://fonts.reown.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https: wss: ws:",
        // Mini apps run inside iframes — allow any https origin to be framed.
        "frame-src 'self' https: https://verify.walletconnect.com https://verify.walletconnect.org",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    },
    proxy: {
      "/api/farcaster": { target: "http://localhost:3001", changeOrigin: true },
      "/api/fid-market": { target: "http://localhost:3001", changeOrigin: true },
      "/api/fc":        { target: "http://localhost:3001", changeOrigin: true },
      "/api/hub":       { target: "http://localhost:3001", changeOrigin: true },
      "/api/mini-apps": { target: "http://localhost:3001", changeOrigin: true },
      "/api/warpcast":  { target: "http://localhost:3001", changeOrigin: true },
      "/api/pro-status": { target: "http://localhost:3001", changeOrigin: true },
      "/api/translate": { target: "http://localhost:3001", changeOrigin: true },
      "/api/rpc":       { target: "http://localhost:3001", changeOrigin: true },
      "/api/spam-labels": { target: "http://localhost:3001", changeOrigin: true },
      "/api/user-prefs": { target: "http://localhost:3001", changeOrigin: true },
      "/api/admin":     { target: "http://localhost:3001", changeOrigin: true },
      "/api/public-config": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com https://fonts.reown.com",
        "img-src 'self' data: blob: https:",
        "connect-src 'self' https: wss:",
        // Mini apps run inside iframes — allow any https origin to be framed.
        "frame-src 'self' https:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    },
  },
});
