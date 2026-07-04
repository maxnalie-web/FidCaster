import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
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
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
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
        "font-src 'self' https://fonts.gstatic.com",
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
      "/api/miniapp-embed": { target: "http://localhost:3001", changeOrigin: true },
      "/api/translate": { target: "http://localhost:3001", changeOrigin: true },
      "/api/rpc":       { target: "http://localhost:3001", changeOrigin: true },
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
        "font-src 'self' https://fonts.gstatic.com",
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
