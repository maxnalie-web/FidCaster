import { readFileSync, existsSync } from "fs";
import { resolve, dirname, sep } from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { mnemonicToAccount } from "viem/accounts";
import { submitFarcasterAction, signFarcasterAction, submitSignedBytes, type FarcasterAction } from "./farcaster-submit.js";
import { registerFidMarketRoutes } from "./fid-market-routes.js";
import { registerProxyRoutes } from "./neynar-proxy.js";
import { registerRpcProxy } from "./rpc-proxy.js";
import { registerPushRoutes } from "./push-routes.js";
import { initPushTokenStore } from "./push-token-store.js";
import { registerActionsRoutes } from "./actions-routes.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerPointsRoutes } from "./points-routes.js";
import { registerMiniRoutes } from "./mini-routes.js";
import { registerWalletRoutes } from "./wallet-routes.js";
import { initLedger } from "./db/ledger.js";
import { initActionsLedgerStore } from "./actions-ledger-store.js";
import { startVerificationJob } from "./verification-job.js";
import { startSybilDetector } from "./sybil-detector.js";
import { startWatchers } from "./watcher.js";
import { safeFetch } from "./ssrf-guard.js";
import { cacheStats } from "./cache.js";
import { metrics } from "./metrics.js";
import { initSignPool } from "./sign-pool.js";
import { healthSnapshot } from "./health.js";
import { getSpamLabels, scheduleSpamLabelRefresh, awaitInitialSpamLabels } from "./spam-labels.js";
import { getUserPref, setUserPref } from "./user-prefs.js";
import { isCloudinaryConfigured, uploadToCloudinary } from "./cloudinary-upload.js";
import { isUnderUploadQuota, recordUpload, DAILY_UPLOAD_LIMIT } from "./upload-quota.js";
import {
  isAdminConfigured, checkAdminPassword, issueSessionToken,
  requireAdminSession, hasValidAdminSession, setSessionCookie, clearSessionCookie,
} from "./admin-auth.js";
import { createNftPassRouter } from "./nft-pass-routes.js";
import { getPublicConfig, setPublicConfig, getAdminSecrets, setAdminSecrets } from "./admin-store.js";
import { setAdminNeynarKey } from "./neynar-limit.js";
import {
  upsertNotificationToken,
  disableNotificationToken,
  deleteNotificationToken,
} from "./db/notifications.js";

// Load .env from project root (tsx doesn't auto-load .env like Vite does)
try {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dir, "../.env");
  const lines = readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const val = match[2].trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = val;
  }
} catch { /* .env not found - rely on real env vars */ }

const app = express();
app.set("trust proxy", 1);
// In production the artifact routes traffic to PORT (set to 5173 in artifact.toml).
// In dev the server runs on API_PORT (3001) and Vite proxies /api/* to it - API_PORT
// must win over PORT here, since dev tooling may set PORT for Vite's own dev server.
const PORT = Number(process.env.API_PORT ?? process.env.PORT ?? "3001");
const START_TIME = Date.now();

// Additional production origins from env: ALLOWED_ORIGINS=https://fidcaster.com,https://www.fidcaster.com
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean)
  .map(o => new RegExp(`^${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));

const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  // Native Capacitor shell's own WebView origin (locally-bundled app, see
  // native-api-bridge.ts) · iOS defaults to the capacitor: scheme, Android
  // to https:, both hosted at "localhost".
  /^capacitor:\/\/localhost$/,
  /^https:\/\/[\w.-]+\.replit\.dev$/,
  /^https:\/\/[\w.-]+\.replit\.app$/,
  /^https:\/\/[\w.-]+\.repl\.co$/,
  /^https:\/\/[\w.-]+\.spock\.replit\.dev$/,
  /^https:\/\/[\w.-]+\.worf\.replit\.dev$/,
  /^https:\/\/(www\.)?fidcaster\.xyz$/,
  /^https:\/\/(www\.)?fidcaster\.com$/,
  /^https:\/\/docs\.fidcaster\.xyz$/,
  ...extraOrigins,
];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      // challenges.cloudflare.com is the CAPTCHA widget shown on the admin
      // login form after repeated failed attempts (see TURNSTILE_SITE_KEY /
      // TURNSTILE_SECRET_KEY below) - allowed unconditionally since it's a
      // fixed, narrow, trusted addition; the widget script itself is only
      // ever loaded client-side if TURNSTILE_SITE_KEY is actually configured.
      scriptSrc: ["'self'", "https://challenges.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      // This HTTP header and index.html's CSP <meta> tag both apply · a
      // browser enforces their INTERSECTION, so any directive missing here
      // silently overrides the meta tag back down to default-src ('self').
      // font-src wasn't set at all (defaulting to 'self' only), which broke
      // both Google Fonts and the WalletConnect/Reown modal's custom font;
      // frameSrc was 'none', which blocked the modal's verify.walletconnect
      // domain-verification iframe outright · both are real causes of "wallet
      // connect" issues, not just cosmetic.
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://fonts.reown.com"],
      // blob: matters here specifically - the Reown/WalletConnect wallet-list
      // modal loads wallet icons through blob URLs (fetched then re-rendered),
      // and worker-src falls back to script-src ('self' only) unless set
      // explicitly, which would silently break its QR/crypto web worker too.
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      mediaSrc: ["'self'", "https:", "blob:"],
      workerSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "https:", "wss:"],
      // "https:" (not a fixed allowlist) - mini apps embedded via
      // MiniAppIframeModal are, by design, arbitrary third-party origins;
      // same reasoning already applied to imgSrc/connectSrc for arbitrary
      // Farcaster content. The iframe itself never gets our own origin's
      // cookies/storage (cross-origin), and postMessage-based communication
      // (miniapp-iframe-host.ts) validates the origin on every message.
      frameSrc: ["'self'", "https:", "https://verify.walletconnect.com", "https://verify.walletconnect.org", "https://challenges.cloudflare.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  // Force HTTPS in production
  strictTransportSecurity: process.env.NODE_ENV === "production"
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
}));

// Farcaster Mini Apps run inside an iframe inside Warpcast/other FC clients.
// The hosted Farcaster manifest for this app has homeUrl = https://fidcaster.xyz
// (the root), NOT /mini. So we must handle BOTH "/" and "/mini" as valid mini
// app entry points.
//
// Must run BEFORE the global cors() middleware below, because that middleware
// blocks every request whose Origin is not in ALLOWED_ORIGINS — including
// warpcast.com and other Farcaster clients. For mini-app routes we open CORS.
const miniAppCors = cors({
  origin: true,          // reflect any Origin — Farcaster clients are arbitrary
  methods: ["GET", "OPTIONS"],
  credentials: false,
});
app.use("/mini", miniAppCors);
app.use("/", miniAppCors);   // hosted manifest uses root as homeUrl

// When the root "/" is loaded inside a cross-origin iframe (i.e. Warpcast is
// embedding it as a mini app), redirect immediately to /mini which contains
// the actual mini app UI and calls sdk.actions.ready().
app.use((req, res, next) => {
  const isMiniAppIframe =
    req.path === "/" &&
    req.headers["sec-fetch-dest"] === "iframe" &&
    req.headers["sec-fetch-site"] === "cross-site";
  if (isMiniAppIframe) {
    return res.redirect(302, "/mini");
  }
  next();
});

const MINI_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com https://fonts.reown.com",
  "img-src 'self' data: https: blob:",
  "media-src 'self' https: blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https: wss:",
  "frame-src 'self' https:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors *",   // allow all Farcaster clients to embed
].join(";");

app.use((req, res, next) => {
  if (req.path === "/mini" || req.path === "/") {
    res.removeHeader("X-Frame-Options");
    // Helmet sets Cross-Origin-Resource-Policy: same-origin which prevents
    // cross-origin iframes from loading the page at all (separate from CORS).
    res.removeHeader("Cross-Origin-Resource-Policy");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    // Allow Warpcast to open the page across origins (COOP same-origin blocks it).
    res.removeHeader("Cross-Origin-Opener-Policy");
    res.setHeader("Content-Security-Policy", MINI_CSP);
  }
  next();
});

// The app never uses camera/mic/geolocation/USB/payment APIs - deny them by
// default so an XSS or a compromised third-party script embedded anywhere
// couldn't invoke a permission prompt for capabilities we never asked for.
app.use((_req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  );
  next();
});

// Mini app entry-points (/mini and /) have their own open-CORS handler above.
// The global strict CORS must NOT run for those paths or it will fire a 403
// that overrides the per-route handler's already-set headers.
const strictCors = cors({
  origin: (origin, callback) => {
    // No Origin header = non-browser client (curl, server-to-server). Allow GET,
    // block write methods via the CORS preflight mechanism being skipped - real
    // protection on write paths is the rate limiter + input validation below.
    if (!origin) return callback(null, false);
    const allowed = ALLOWED_ORIGINS.some((re) => re.test(origin));
    if (allowed) {
      callback(null, origin);
    } else {
      console.warn(`[CORS] blocked origin: ${origin}`);
      callback(new Error(`CORS: origin not allowed`));
    }
  },
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  credentials: false,
  maxAge: 600,
});
app.use((req, res, next) => {
  // Skip strict CORS for mini-app entry points — they use open CORS above.
  if (req.path === "/mini" || req.path === "/") return next();
  strictCors(req, res, next);
});

app.use(compression());
// Small default body limit for every route - the 70MB base64 upload payload
// is the exception, not the norm, and applying it globally meant any cheap
// endpoint (e.g. /api/translate) would accept a 70MB body from an
// unauthenticated caller, letting a handful of requests exhaust server
// memory/bandwidth well before the request-count rate limiter ever kicks in.
// Dispatched by path (rather than two stacked app.use(express.json(...))
// calls) so the request body stream is only ever consumed once.
const smallJsonParser = express.json({ limit: "256kb" });
const uploadJsonParser = express.json({ limit: "70mb" }); // images ≤10MB (~13.3MB base64) + video ≤50MB (~66.7MB base64)
// Admin config saves (custom CSS, copy text, etc.) are capped at 2MB by
// MAX_CONFIG_BYTES below, and user-prefs values (custom feed logo data-URLs)
// are capped at 3MB by MAX_VALUE_BYTES in user-prefs.ts - give these routes
// enough room, but nowhere near the upload route's 70MB.
const mediumJsonParser = express.json({ limit: "3mb" });
const MEDIUM_BODY_PATHS = new Set(["/api/admin/config", "/api/admin/secrets", "/api/user-prefs"]);
// Neynar webhook signatures (see push-routes.ts) are computed over the exact
// raw bytes of the request body - capture them via `verify` before JSON
// parsing discards the original buffer.
const webhookJsonParser = express.json({
  limit: "256kb",
  verify: (req, _res, buf) => { (req as express.Request & { rawBody?: Buffer }).rawBody = buf; },
});
app.use((req, res, next) => {
  if (req.path === "/api/farcaster/upload-image") return uploadJsonParser(req, res, next);
  if (req.path === "/api/push/webhook") return webhookJsonParser(req, res, next);
  if (MEDIUM_BODY_PATHS.has(req.path)) return mediumJsonParser(req, res, next);
  return smallJsonParser(req, res, next);
});

// Global limiter - skip follow/following list endpoints (already protected by Neynar throttle)
// and skip Neynar read proxy endpoints (caching + throttle handle them).
// Batch follow scans can make 50–100 requests per minute for large lists; the global
// cap must not block them. Each unique IP can still burst up to 600 requests/min total.
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
  skip: (req) => {
    const p = req.path;
    // Follow-list scans + Neynar read proxy are throttled at the Neynar layer already.
    return (
      p.startsWith("/api/farcaster/followers") ||
      p.startsWith("/api/farcaster/following") ||
      p.startsWith("/api/fc/") ||
      p.startsWith("/api/hub/") ||
      p.startsWith("/api/pro-status") ||
      p.startsWith("/api/mini-apps")
    );
  },
});
app.use(globalLimiter);

// Action limiter - covers follow/unfollow/like/recast/cast per IP.
// 300/min allows up to 150 batch actions per 30s window without lockout.
const actionLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many actions, please try again later." },
});


/* ─── Farcaster network stats cache ─── */
let fcStatsCache: {
  userCount: number;
  dailyCasts: number | null;
  lastFetched: number;
} | null = null;
const FC_STATS_TTL = 30 * 60 * 1000; // 30 min

async function fetchFarcasterStats(): Promise<{ userCount: number; dailyCasts: number | null }> {
  let userCount = 0;
  let dailyCasts: number | null = null;

  // 1. Try Warpcast public user-count API
  try {
    const r = await fetch("https://client.warpcast.com/v2/user-count", {
      headers: { "User-Agent": "FidCaster/1.0", "Accept": "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (r.ok) {
      const d = await r.json() as any;
      userCount = d?.result?.count || d?.count || 0;
    }
  } catch {}

  // 2. Fallback: Neynar hub /v1/info for message count (daily proxy)
  if (dailyCasts === null) {
    try {
      const neynarKey = process.env.NEYNAR_API_KEY || "";
      if (neynarKey) {
        const r = await fetch("https://hub-api.neynar.com/v1/info", {
          headers: { "accept": "application/json", "api_key": neynarKey },
          signal: AbortSignal.timeout(6000),
        });
        if (r.ok) {
          const d = await r.json() as any;
          // numMessages is cumulative; we can't derive daily from it alone
          // Just store it - the UI can show total messages
          const total = d?.dbStats?.numMessages || 0;
          if (total > 0) dailyCasts = null; // not daily - skip
        }
      }
    } catch {}
  }

  return { userCount, dailyCasts };
}

const VALID_HEX_64 = /^[0-9a-fA-F]{64}$/;
const VALID_ACTIONS = new Set<string>([
  "like", "unlike", "recast", "unrecast",
  "follow", "unfollow", "cast", "delete-cast",
  "update-user-data",
]);

// ── Internal observability ─────────────────────────────────────────────────────
// Not proxied to the public - only reachable directly on the server port.
// Shows cache hit/miss ratio, SWR refreshes, hub success/fail, SQLite queue peak.
// Defense in depth: this is meant to be reachable only by whoever can hit the
// server port directly (not proxied to the public per the comment below),
// but that's an infrastructure assumption, not something this file can
// verify - a reverse-proxy misconfiguration that forwards everything would
// otherwise leak internal cache/health stats to any visitor. Check the raw
// socket address (not req.ip, which honors X-Forwarded-For and is therefore
// spoofable by anyone who can already reach this route) and require loopback.
function isLoopback(req: express.Request): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

app.get("/internal/metrics", (req, res) => {
  if (!isLoopback(req)) { res.status(404).json({ error: "Not found" }); return; }
  const health = healthSnapshot();
  res.json({ ...metrics.snapshot(), cache_store: cacheStats(), health });
});

// Round-robin counter for hub-token key rotation
let _hubKeyIdx = 0;

// Dedicated, low-privilege keys that are SAFE to hand to the browser for hub
// submitMessage from each user's own IP (restores per-IP scaling). Set these to
// THROWAWAY Neynar keys with a strict spending cap in the Neynar dashboard - a key
// sent to a browser is always readable in devtools and cannot be encrypted away, so
// the mitigation is blast-radius (a capped key), never secrecy. NEVER put your main
// read keys here. Format: NEYNAR_HUB_KEYS=key1,key2  (comma-separated).
function getHubPublicKeys(): string[] {
  return (process.env.NEYNAR_HUB_KEYS ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
}

// Own limiter - a leaked key is used against Neynar directly (bypassing us), so this
// only throttles harvesting of the token, not post-leak abuse. Cap on Neynar does that.
const hubTokenLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

// Returns a rotating DEDICATED Neynar key for browser-direct hub submission.
// Secure-by-default: if no NEYNAR_HUB_KEYS are configured we return 503 and the
// client falls back to /api/farcaster/submit-bytes (main keys stay server-side).
app.get("/api/farcaster/hub-token", hubTokenLimiter, (_req, res) => {
  const keys = getHubPublicKeys();
  if (keys.length === 0) {
    res.status(503).json({ error: "hub-token disabled: no dedicated NEYNAR_HUB_KEYS configured" });
    return;
  }
  const key = keys[_hubKeyIdx % keys.length];
  _hubKeyIdx = (_hubKeyIdx + 1) % keys.length;
  res.setHeader("Cache-Control", "no-store");
  res.json({ key, hub: "https://hub-api.neynar.com" });
});

app.get("/api/farcaster/health", (_req, res) => {
  const isProd = process.env.NODE_ENV === "production";
  const mem = process.memoryUsage();
  res.json({
    ok: true,
    uptime: Math.floor((Date.now() - START_TIME) / 1000),
    cache: cacheStats(),
    ...(isProd ? {} : {
      memory: { rss: Math.round(mem.rss / 1024 / 1024) + "MB", heap: Math.round(mem.heapUsed / 1024 / 1024) + "MB" },
      version: process.version,
      env: process.env.NODE_ENV ?? "development",
    }),
  });
});

const NEYNAR_V2 = "https://api.neynar.com/v2";

// ── Native Warpcast Signed Key Request (one-step SIWF write access, no Neynar) ─
// Per Farcaster protocol, the requesting app must sign the key-request metadata with
// its OWN app FID + custody key. APP_FID/APP_MNEMONIC are FidCaster's one-time identity
// (NOT the per-user seed). Each user just scans a QR and approves in Warpcast - seedless.
const SIGNED_KEY_REQUEST_VALIDATOR = "0x00000000fc700472606ed4fa22623acf62c60553" as const;
const SIGNED_KEY_REQUEST_DOMAIN = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: SIGNED_KEY_REQUEST_VALIDATOR,
} as const;
const SIGNED_KEY_REQUEST_TYPES = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;
const WARPCAST_API = "https://api.warpcast.com";
const ED25519_PUBKEY = /^0x[0-9a-fA-F]{64}$/;
const signerReqLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

function getAppCredentials(): { appFid: number; account: ReturnType<typeof mnemonicToAccount> } | null {
  const appFidRaw = process.env.APP_FID;
  const appMnemonic = process.env.APP_MNEMONIC;
  if (!appFidRaw || !appMnemonic) return null;
  const appFid = Number(appFidRaw);
  if (!Number.isInteger(appFid) || appFid <= 0) return null;
  try {
    return { appFid, account: mnemonicToAccount(appMnemonic.trim()) };
  } catch {
    return null;
  }
}

// Step 1: app signs the key-request metadata; Warpcast returns an approval deeplink + token.
app.post("/api/farcaster/signer-request", signerReqLimiter, async (req, res) => {
  const creds = getAppCredentials();
  if (!creds) {
    res.status(503).json({ error: "Farcaster write sign-in is not configured yet. Set APP_FID and APP_MNEMONIC in .env (FidCaster's own app account)." });
    return;
  }
  const { publicKey } = req.body as { publicKey?: string };
  if (!publicKey || !ED25519_PUBKEY.test(publicKey)) {
    res.status(400).json({ error: "publicKey must be a 0x-prefixed 32-byte ed25519 key" });
    return;
  }
  try {
    const deadline = Math.floor(Date.now() / 1000) + 86400; // user has 1 day to approve
    const signature = await creds.account.signTypedData({
      domain: SIGNED_KEY_REQUEST_DOMAIN,
      types: SIGNED_KEY_REQUEST_TYPES,
      primaryType: "SignedKeyRequest",
      message: { requestFid: BigInt(creds.appFid), key: publicKey as `0x${string}`, deadline: BigInt(deadline) },
    });
    const r = await fetch(`${WARPCAST_API}/v2/signed-key-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: publicKey, requestFid: creds.appFid, signature, deadline }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      res.status(r.status).json({ error: `Warpcast rejected the request: ${t.slice(0, 200)}` });
      return;
    }
    const data = await r.json() as { result?: { signedKeyRequest?: { token?: string; deeplinkUrl?: string; state?: string } } };
    const skr = data.result?.signedKeyRequest;
    if (!skr?.token || !skr.deeplinkUrl) { res.status(502).json({ error: "Warpcast returned no deeplink" }); return; }
    res.json({ token: skr.token, deeplinkUrl: skr.deeplinkUrl, state: skr.state ?? "pending", deadline });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to create signer request" });
  }
});

// Step 2: poll until the user approves in Warpcast (state === "completed"); returns their FID.
const VALID_SKR_TOKEN = /^0x[0-9a-fA-F]{1,200}$/;
app.get("/api/farcaster/signer-request", signerReqLimiter, async (req, res) => {
  const token = req.query.token as string;
  if (!token || !VALID_SKR_TOKEN.test(token)) { res.status(400).json({ error: "Invalid token" }); return; }
  try {
    const r = await fetch(`${WARPCAST_API}/v2/signed-key-request?token=${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); res.status(r.status).json({ error: t.slice(0, 200) }); return; }
    const data = await r.json() as { result?: { signedKeyRequest?: { state?: string; userFid?: number } } };
    const skr = data.result?.signedKeyRequest;
    res.json({ state: skr?.state ?? "pending", userFid: skr?.userFid ?? null });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Failed to check request status" });
  }
});

// ── Neynar Managed Signer Write Actions (legacy fallback; unused by native SIWF) ──
const VALID_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NEYNAR_WRITE_ACTIONS = new Set(["cast", "delete-cast", "like", "unlike", "recast", "unrecast", "follow", "unfollow"]);

app.post("/api/farcaster/neynar-action", actionLimiter, async (req, res) => {
  const key = process.env.NEYNAR_API_KEY;
  if (!key) { res.status(503).json({ error: "Neynar API key not configured." }); return; }

  const { signerUuid, action } = req.body as { signerUuid?: string; action?: { type?: string; [k: string]: unknown } };
  if (!signerUuid || !VALID_UUID.test(signerUuid)) { res.status(400).json({ error: "Invalid signerUuid" }); return; }
  if (!action || typeof action.type !== "string" || !NEYNAR_WRITE_ACTIONS.has(action.type)) {
    res.status(400).json({ error: `Invalid action. Allowed: ${[...NEYNAR_WRITE_ACTIONS].join(", ")}` }); return;
  }

  const VALID_CAST_HASH_NEYNAR = /^(0x)?[0-9a-fA-F]{40,80}$/;
  const FID_MAX = 1_000_000_000;
  const headers = { accept: "application/json", "content-type": "application/json", api_key: key };

  try {
    let r: Response;
    const { type, ...rest } = action;

    if (type === "cast") {
      if (typeof rest.text !== "string" || rest.text.length === 0 || rest.text.length > 1024) {
        res.status(400).json({ error: "text must be 1–1024 characters" }); return;
      }
      if (rest.parentHash && !VALID_CAST_HASH_NEYNAR.test(String(rest.parentHash))) {
        res.status(400).json({ error: "Invalid parentHash" }); return;
      }
      if (Array.isArray(rest.embeds)) {
        for (const url of rest.embeds as unknown[]) {
          if (typeof url !== "string" || !url.startsWith("https://") || url.length > 1024) {
            res.status(400).json({ error: "embeds must be valid https:// URLs" }); return;
          }
        }
      }
      const body: Record<string, unknown> = { signer_uuid: signerUuid, text: rest.text };
      if (rest.parentHash) body.parent = rest.parentHash;
      if (Array.isArray(rest.embeds) && rest.embeds.length) body.embeds = (rest.embeds as string[]).map((url) => ({ url }));
      r = await fetch(`${NEYNAR_V2}/farcaster/cast`, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });

    } else if (type === "delete-cast") {
      if (!rest.castHash || !VALID_CAST_HASH_NEYNAR.test(String(rest.castHash))) {
        res.status(400).json({ error: "Invalid castHash" }); return;
      }
      r = await fetch(`${NEYNAR_V2}/farcaster/cast`, { method: "DELETE", headers, body: JSON.stringify({ signer_uuid: signerUuid, target_hash: rest.castHash }), signal: AbortSignal.timeout(15000) });

    } else if (type === "like" || type === "unlike") {
      if (!rest.castHash || !VALID_CAST_HASH_NEYNAR.test(String(rest.castHash))) {
        res.status(400).json({ error: "Invalid castHash" }); return;
      }
      const method = type === "like" ? "POST" : "DELETE";
      r = await fetch(`${NEYNAR_V2}/farcaster/reaction`, { method, headers, body: JSON.stringify({ signer_uuid: signerUuid, reaction_type: "like", target: rest.castHash }), signal: AbortSignal.timeout(15000) });

    } else if (type === "recast" || type === "unrecast") {
      if (!rest.castHash || !VALID_CAST_HASH_NEYNAR.test(String(rest.castHash))) {
        res.status(400).json({ error: "Invalid castHash" }); return;
      }
      const method = type === "recast" ? "POST" : "DELETE";
      r = await fetch(`${NEYNAR_V2}/farcaster/reaction`, { method, headers, body: JSON.stringify({ signer_uuid: signerUuid, reaction_type: "recast", target: rest.castHash }), signal: AbortSignal.timeout(15000) });

    } else if (type === "follow" || type === "unfollow") {
      const targetFid = Number(rest.targetFid);
      if (!Number.isInteger(targetFid) || targetFid <= 0 || targetFid >= FID_MAX) {
        res.status(400).json({ error: "Invalid targetFid" }); return;
      }
      const method = type === "follow" ? "POST" : "DELETE";
      r = await fetch(`${NEYNAR_V2}/farcaster/follows/v2`, { method, headers, body: JSON.stringify({ signer_uuid: signerUuid, target_fids: [targetFid] }), signal: AbortSignal.timeout(15000) });

    } else {
      res.status(400).json({ error: "Unhandled action type" }); return;
    }

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      let msg = t.slice(0, 300);
      try { msg = JSON.parse(t)?.message ?? msg; } catch { /* ok */ }
      res.status(r.status).json({ error: msg }); return;
    }
    res.json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Neynar action failed" });
  }
});

app.get("/api/farcaster/network-stats", async (_req, res) => {
  const now = Date.now();
  if (fcStatsCache && now - fcStatsCache.lastFetched < FC_STATS_TTL) {
    return res.json({ ...fcStatsCache, cached: true });
  }
  try {
    const stats = await fetchFarcasterStats();
    fcStatsCache = { ...stats, lastFetched: now };
    return res.json({ ...fcStatsCache, cached: false });
  } catch {
    const fallback = { userCount: 0, dailyCasts: null, lastFetched: now };
    fcStatsCache = fallback;
    return res.json({ ...fallback, cached: false, error: "fetch failed" });
  }
});

app.post("/api/farcaster/action", actionLimiter, async (req, res) => {
  try {
    const { signerPrivateKey, fid, action } = req.body as {
      signerPrivateKey: string;
      fid: number;
      action: FarcasterAction;
    };

    if (!signerPrivateKey || typeof signerPrivateKey !== "string") {
      res.status(400).json({ error: "signerPrivateKey required" });
      return;
    }
    const keyClean = signerPrivateKey.replace(/^0x/, "");
    if (!VALID_HEX_64.test(keyClean)) {
      res.status(400).json({ error: "signerPrivateKey must be a 64-character hex string" });
      return;
    }
    if (typeof fid !== "number" || !Number.isInteger(fid) || fid <= 0 || fid > 1_000_000_000) {
      res.status(400).json({ error: "Invalid fid" });
      return;
    }
    if (!action || typeof action.type !== "string" || !VALID_ACTIONS.has(action.type)) {
      res.status(400).json({ error: `Invalid action type. Allowed: ${[...VALID_ACTIONS].join(", ")}` });
      return;
    }

    console.log(`[server] POST /api/farcaster/action type=${action.type} fid=${fid}`);
    const result = await submitFarcasterAction(`0x${keyClean}`, fid, action);
    metrics.incHubRelay();
    res.json({ ok: true, hash: result.hash });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("[server] action error:", msg);
    metrics.incHubFail();
    // bad_request.validation_failure = target FID deleted/deactivated/invalid.
    // This is permanent for that FID - tell client to skip it, not retry.
    if (msg.includes("validation_failure") || msg.includes("bad_request.validation_failure")) {
      res.status(422).json({ skip: true, error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ── Submit pre-signed protobuf bytes - races free hubs + all Neynar keys in parallel ──
// Browser signs locally and POSTs raw bytes here; no private key transmitted.
// Server calls submitSignedBytes() which uses Promise.any() to race every hub target.
// First to accept wins instantly - no sequential retries, no rate-limit waits.
app.post("/api/farcaster/submit-bytes", actionLimiter, async (req, res) => {
  try {
    const { bytes } = req.body as { bytes?: string };
    if (!bytes || typeof bytes !== "string") {
      res.status(400).json({ error: "bytes (base64) required" }); return;
    }
    let msgBytes: Uint8Array;
    try {
      msgBytes = Uint8Array.from(Buffer.from(bytes, "base64"));
      if (msgBytes.length < 10 || msgBytes.length > 100_000) {
        res.status(400).json({ error: "bytes length out of range" }); return;
      }
    } catch {
      res.status(400).json({ error: "bytes is not valid base64" }); return;
    }
    const hash = await submitSignedBytes(msgBytes);
    metrics.incHubRelay();
    res.json({ ok: true, hash });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error";
    console.error("[server] submit-bytes error:", msg);
    metrics.incHubFail();
    if (msg.includes("validation_failure") || msg.includes("bad_request.validation_failure")) {
      res.status(422).json({ skip: true, error: msg });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// ── Browser-direct hub submission - sign only, no hub round-trip from server ──
// The browser receives the signed protobuf bytes and submits directly to public hubs,
// distributing traffic across each user's IP instead of funnelling through one server IP.
// This endpoint is a pure signing service: validate → build → sign → return bytes.
app.post("/api/farcaster/sign-message", actionLimiter, async (req, res) => {
  try {
    const { signerPrivateKey, fid, action } = req.body as {
      signerPrivateKey: string;
      fid: number;
      action: FarcasterAction;
    };
    if (!signerPrivateKey || typeof signerPrivateKey !== "string") {
      res.status(400).json({ error: "signerPrivateKey required" }); return;
    }
    const keyClean = signerPrivateKey.replace(/^0x/, "");
    if (!VALID_HEX_64.test(keyClean)) {
      res.status(400).json({ error: "signerPrivateKey must be a 64-character hex string" }); return;
    }
    if (typeof fid !== "number" || !Number.isInteger(fid) || fid <= 0 || fid > 1_000_000_000) {
      res.status(400).json({ error: "Invalid fid" }); return;
    }
    if (!action || typeof action.type !== "string" || !VALID_ACTIONS.has(action.type)) {
      res.status(400).json({ error: `Invalid action type. Allowed: ${[...VALID_ACTIONS].join(", ")}` }); return;
    }
    const result = await signFarcasterAction(`0x${keyClean}`, fid, action);
    res.json(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Internal error";
    res.status(500).json({ error: msg });
  }
});

// ── Media upload proxy ──────────────────────────────────────────────────────
// Primary path is Cloudinary (our own account, signed server-side - the API
// secret must never reach the client). Imgur/catbox remain as fallbacks for
// resilience if Cloudinary isn't configured or has an outage, but they're
// both third-party free tiers this app doesn't control - freeimage.host's
// old shared demo key dying (rate-limited/revoked with zero notice, since it
// was shared across countless unrelated projects) is exactly why uploads
// went down app-wide before Cloudinary was wired in.
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

app.post("/api/farcaster/upload-image", uploadLimiter, async (req, res) => {
  try {
    const { image: imageDataUrl, type: mimeType = "image/jpeg", fid } = req.body as { image?: string; type?: string; fid?: number };
    if (!imageDataUrl) {
      res.status(400).json({ error: "Expected JSON body {image: dataURL}" });
      return;
    }
    if (typeof fid === "number" && fid > 0 && !isUnderUploadQuota(fid)) {
      res.status(429).json({ error: `Daily upload limit reached (${DAILY_UPLOAD_LIMIT}/day). Try again tomorrow.` });
      return;
    }
    // Strip optional data URL prefix - keep only raw base64
    const base64 = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;
    const buffer = Buffer.from(base64, "base64");
    const isVideo = mimeType.startsWith("video/");

    if (isCloudinaryConfigured()) {
      try {
        const url = await uploadToCloudinary(base64, mimeType, isVideo ? "video" : "image");
        if (typeof fid === "number" && fid > 0) recordUpload(fid);
        res.json({ url });
        return;
      } catch (e) {
        console.warn("[upload] Cloudinary failed, falling back:", (e as Error).message);
      }
    }

    const imgurClientId = process.env.IMGUR_CLIENT_ID || process.env.VITE_IMGUR_CLIENT_ID;
    if (imgurClientId && !isVideo) {
      try {
        const imgurParams = new URLSearchParams({ image: base64, type: "base64" });
        const upstream = await fetch("https://api.imgur.com/3/image", {
          method: "POST",
          headers: {
            Authorization: `Client-ID ${imgurClientId}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: imgurParams.toString(),
          signal: AbortSignal.timeout(15_000),
        });
        if (upstream.ok) {
          const data = await upstream.json() as { success: boolean; data: { link: string } };
          if (data.success) {
            if (typeof fid === "number" && fid > 0) recordUpload(fid);
            res.json({ url: data.data.link });
            return;
          }
        }
        console.warn("[upload] Imgur failed, falling back to tmpfiles.org");
      } catch {
        console.warn("[upload] Imgur error, falling back to tmpfiles.org");
      }
    }

    const ext = mimeType.split("/")[1]?.split(";")[0] || (isVideo ? "mp4" : "jpg");

    // For videos: use litterbox.catbox.moe - temporary CDN (up to 72h), returns direct
    // litter.catbox.moe/xxx.mp4 URL that Warpcast detects as video and plays inline.
    // (catbox.moe permanent endpoint blocks cloud server IPs; litterbox does not.)
    if (isVideo) {
      try {
        const litboxForm = new FormData();
        litboxForm.append("reqtype", "fileupload");
        litboxForm.append("time", "72h");
        litboxForm.append("fileToUpload", new Blob([buffer], { type: mimeType }), `upload.${ext}`);
        const litboxRes = await fetch("https://litterbox.catbox.moe/resources/internals/api.php", {
          method: "POST",
          body: litboxForm,
          signal: AbortSignal.timeout(90_000),
        });
        if (litboxRes.ok) {
          const litboxUrl = (await litboxRes.text()).trim();
          if (litboxUrl.startsWith("https://litter.catbox.moe/")) {
            if (typeof fid === "number" && fid > 0) recordUpload(fid);
            res.json({ url: litboxUrl });
            return;
          }
        }
        console.warn("[upload] litterbox.catbox.moe failed, falling back to tmpfiles.org");
      } catch (e) {
        console.warn("[upload] litterbox error:", (e as Error).message);
      }
    }

    // Last-resort fallback: tmpfiles.org - free, no API key, images + video.
    // Note: tmpfiles.org serves HTML pages for video URLs so Warpcast won't show
    // a video preview; this is only a last-ditch fallback so the upload doesn't fail.
    const form = new FormData();
    form.append("file", new Blob([buffer], { type: mimeType }), `upload.${ext}`);
    const tmpRes = await fetch("https://tmpfiles.org/api/v1/upload", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (tmpRes.ok) {
      const tmpData = await tmpRes.json().catch(() => null) as { status?: string; data?: { url?: string } } | null;
      const tmpUrl = tmpData?.data?.url;
      if (tmpUrl) {
        if (typeof fid === "number" && fid > 0) recordUpload(fid);
        res.json({ url: tmpUrl });
        return;
      }
    }
    const errText = await tmpRes.text().catch(() => "");
    res.status(502).json({ error: `Upload failed: ${errText.slice(0, 200) || "all upload services unavailable"}` });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Upload failed" });
  }
});

// ── Cast translation (free, no API key - Google's public translate endpoint) ──
// Supports exactly 8 languages, always including Farsi per product requirement.
// Small in-memory LRU cache keyed by (text, target lang) - the same viral cast
// gets translated by many viewers to the same language, so caching avoids
// re-hitting the upstream endpoint for identical requests.
const SUPPORTED_TRANSLATE_LANGS = new Set([
  "en", "es", "fa", "ar", "fr", "zh-CN", "ru", "pt",
  "de", "it", "ja", "ko", "hi", "tr", "vi", "id", "th", "pl", "nl", "uk",
]);
const translateCache = new Map<string, { text: string; at: number; detected?: string }>();
const TRANSLATE_CACHE_MAX = 500;
const TRANSLATE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h - translations don't change

const translateLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

app.post("/api/translate", translateLimiter, async (req, res) => {
  const { text, target } = req.body as { text?: string; target?: string };
  if (!text || typeof text !== "string" || text.length === 0 || text.length > 2000) {
    res.status(400).json({ error: "text must be 1-2000 characters" }); return;
  }
  if (!target || !SUPPORTED_TRANSLATE_LANGS.has(target)) {
    res.status(400).json({ error: `target must be one of: ${[...SUPPORTED_TRANSLATE_LANGS].join(", ")}` }); return;
  }

  const cacheKey = `${target}:${text}`;
  const cached = translateCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TRANSLATE_CACHE_TTL) {
    res.json({ translated: cached.text, detected: cached.detected, cached: true });
    return;
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) { res.status(502).json({ error: "Translation service unavailable" }); return; }
    const data = await r.json() as [Array<[string, string]>, unknown, string];
    const translated = data[0]?.map((seg) => seg[0]).join("") ?? "";
    const detected = typeof data[2] === "string" ? data[2] : undefined;
    if (!translated) { res.status(502).json({ error: "Empty translation" }); return; }

    if (translateCache.size >= TRANSLATE_CACHE_MAX) {
      const oldestKey = translateCache.keys().next().value;
      if (oldestKey !== undefined) translateCache.delete(oldestKey);
    }
    translateCache.set(cacheKey, { text: translated, at: Date.now(), detected });
    res.json({ translated, detected, cached: false });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Translation failed" });
  }
});

registerFidMarketRoutes(app);
registerProxyRoutes(app); // Neynar read proxy (cached) + Hub direct reads
registerRpcProxy(app);    // Optimism/Base JSON-RPC proxy (rotating pool, no CORS/rate-limit)
registerPushRoutes(app);  // FCM token registration + Neynar webhook -> push fan-out
registerActionsRoutes(app); // Points/airdrop action ledger — no-ops if DATABASE_URL unset
registerAuthRoutes(app);    // Session/nonce endpoints for binding requests to a real fid
registerPointsRoutes(app);  // Leaderboard, snapshot, referral, watcher health
registerMiniRoutes(app);    // Mini app eligibility (Neynar score gate)
registerWalletRoutes(app);  // Airdrop ETH address registration (/api/airdrop/wallet)
app.use("/api/nft-pass", createNftPassRouter()); // FidCaster Pass NFT mint + check

// Mini App webhook — Farcaster sends events here when users add/remove the mini app.
// Handles both JWS format (from Farcaster servers) and direct format (from our client).
function decodeBase64Url(str: string): string {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(pad), "base64").toString("utf-8");
}

async function handleMiniAppWebhookBody(body: Record<string, unknown>): Promise<void> {
  let fid: number | null = null;
  let event: string | null = null;
  let notifDetails: { token?: string; url?: string } | null = null;

  // ── JWS format (from Farcaster notification servers) ──────────────────
  if (body.header && body.payload && typeof body.header === "string") {
    try {
      const header  = JSON.parse(decodeBase64Url(body.header as string));
      const payload = JSON.parse(decodeBase64Url(body.payload as string));
      fid           = Number(header.fid) || null;
      event         = String(payload.event ?? "");
      notifDetails  = payload.notificationDetails ?? null;
    } catch { /* malformed JWS — fall through */ }
  }
  // ── Direct format (from our client or farcaster direct) ───────────────
  else if (body.event) {
    event        = String(body.event);
    fid          = body.fid ? Number(body.fid) : null;
    notifDetails = (body.notificationDetails as { token?: string; url?: string }) ?? null;
  }

  if (!event) return;

  const normalised = event.toLowerCase().replace(/^frame_/, "miniapp_");
  if (
    (normalised === "miniapp_added" || normalised === "notifications_enabled") &&
    fid && notifDetails?.token && notifDetails?.url
  ) {
    await upsertNotificationToken(fid, notifDetails.token, notifDetails.url);
    console.log(`[miniapp-webhook] token saved fid=${fid} event=${event}`);
  } else if (normalised === "miniapp_removed" && fid) {
    await deleteNotificationToken(fid);
    console.log(`[miniapp-webhook] token deleted fid=${fid}`);
  } else if (normalised === "notifications_disabled" && fid) {
    await disableNotificationToken(fid);
    console.log(`[miniapp-webhook] token disabled fid=${fid}`);
  }
}

app.post("/api/miniapp/webhook", express.json(), async (_req: express.Request, res: express.Response) => {
  try {
    await handleMiniAppWebhookBody(_req.body as Record<string, unknown>);
  } catch (e) {
    console.warn("[miniapp-webhook] error:", (e as Error).message);
  }
  res.json({ ok: true }); // always 200
});

// Real Farcaster spam labels (github.com/merkle-team/labels), NOT a Neynar
// field · see server/spam-labels.ts for why this needs its own dataset.
// GET /api/spam-labels?fids=1,2,3 -> { "1": 0, "2": 2 } (absent fid = unknown)
app.get("/api/spam-labels", async (req: express.Request, res: express.Response) => {
  const fids = String(req.query.fids ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .slice(0, 200);
  // On a fresh (e.g. autoscale cold-start) instance the on-disk cache is empty
  // until the initial download finishes · wait for it (bounded) instead of
  // answering with {} and having the client permanently cache these as unknown.
  await awaitInitialSpamLabels();
  res.json(getSpamLabels(fids));
});

// Per-FID small preferences store (currently: Custom Feeds) · lets a feed
// built on one device/browser show up on another under the same account
// instead of only ever existing in that one browser's localStorage.
app.get("/api/user-prefs", (req: express.Request, res: express.Response) => {
  const fid = Number(req.query.fid);
  const key = String(req.query.key ?? "");
  if (!Number.isFinite(fid) || fid <= 0 || !key) { res.status(400).json({ error: "fid and key required" }); return; }
  const value = getUserPref(fid, key);
  res.json({ value: value ?? null });
});

app.put("/api/user-prefs", (req: express.Request, res: express.Response) => {
  const { fid, key, value } = req.body as { fid?: number; key?: string; value?: string };
  if (!fid || !Number.isFinite(fid) || fid <= 0 || !key || typeof value !== "string") {
    res.status(400).json({ error: "fid, key, and value (string) required" });
    return;
  }
  const result = setUserPref(fid, key, value);
  if (!result.ok) { res.status(400).json({ error: result.error }); return; }
  res.json({ ok: true });
});

// ── NFT proxy (OpenSea v2) ───────────────────────────────────────────────────
const nftLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
const OPENSEA_KEY = process.env.OPENSEA_API ?? "";
const OPENSEA_CHAINS: Record<string, string> = {
  optimism: "optimism",
  base: "base",
  arbitrum: "arbitrum",
  ethereum: "ethereum",
};

app.get("/api/nfts/:chain/:address", nftLimiter, async (req, res) => {
  const { chain, address } = req.params;
  const osChain = OPENSEA_CHAINS[chain];
  if (!osChain) { res.status(400).json({ error: "Unsupported chain" }); return; }
  if (!OPENSEA_KEY) { res.status(503).json({ error: "OpenSea API key not configured" }); return; }
  try {
    const cursor = req.query.cursor ? `&next=${encodeURIComponent(String(req.query.cursor))}` : "";
    const url = `https://api.opensea.io/api/v2/chain/${osChain}/account/${address}/nfts?limit=50${cursor}`;
    const r = await fetch(url, {
      headers: { "X-API-KEY": OPENSEA_KEY, "accept": "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => "");
      res.status(r.status).json({ error: `OpenSea error ${r.status}`, detail: text.slice(0, 200) });
      return;
    }
    const data = await r.json();
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "NFT fetch failed", detail: String(e) });
  }
});

// Generic OpenSea v2 pass-through, distinct from the account-NFT-listing
// route above: the native app's client (core/opensea.ts) needs arbitrary
// collection-metadata reads -- /chain/{slug}/contract/{address} (name,
// image, safelist verification), /collections/{slug}/stats (floor price),
// and /chain/{slug}/contract/{address}/nfts/{tokenId} (per-token traits) --
// so rather than add a bespoke route per shape, this mirrors whatever path
// OpenSea's own v2 API exposes under /api/opensea/*, GET-only, same key
// attached server-side. Fixed upstream host (api.opensea.io), so this is
// NOT an open proxy / SSRF risk the way a user-suppliable-URL proxy would
// be -- see ssrf-guard.ts's warning for that different, unrelated case.
app.use("/api/opensea", nftLimiter, async (req, res) => {
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }
  if (!OPENSEA_KEY) { res.status(503).json({ error: "OpenSea API key not configured" }); return; }
  try {
    const r = await fetch(`https://api.opensea.io/api/v2${req.url}`, {
      headers: { "X-API-KEY": OPENSEA_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      res.status(r.status).json(data ?? { error: `OpenSea error ${r.status}` });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=600");
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: "OpenSea proxy failed", detail: String(e) });
  }
});

// ── In-app browser proxy ─────────────────────────────────────────────────────
// Strips X-Frame-Options / CSP frame-ancestors so external sites load in the
// wallet browser iframe. Injects <base> so relative links resolve correctly.
const browserProxyLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

app.get("/api/browser-proxy", browserProxyLimiter, async (req, res) => {
  const targetUrl = String(req.query.url ?? "");
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    res.status(400).json({ error: "Invalid or missing url param" });
    return;
  }
  // helmet() above applies its own CSP/frame/cross-origin headers to every
  // route by default, including this one - 'self' in that policy means OUR
  // origin, so it silently blocked every script on the proxied page (both
  // the target site's own bundle and the nav script injected below) even
  // after the target's own CSP/X-Frame-Options were stripped further down.
  // That combination is what actually produced the permanently-blank frame:
  // the HTML/CSS painted, nothing ever executed. Strip helmet's headers
  // before doing anything else on this route.
  res.removeHeader("Content-Security-Policy");
  res.removeHeader("Content-Security-Policy-Report-Only");
  res.removeHeader("X-Frame-Options");
  res.removeHeader("Cross-Origin-Opener-Policy");
  res.removeHeader("Cross-Origin-Resource-Policy");
  res.removeHeader("Cross-Origin-Embedder-Policy");
  try {
    // safeFetch validates the target's ACTUAL resolved IP (not just the URL
    // text) against private/reserved/loopback/link-local ranges - including
    // the cloud metadata address - and re-checks on every redirect hop, so
    // this can't be pointed at the server's own internal network (SSRF).
    // See ssrf-guard.ts for what specifically is blocked and why.
    const upstream = await safeFetch(targetUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });

    // Build a clean response header map - strip frame-blocking directives.
    // The whole CSP is dropped (not just frame-ancestors): the proxied document
    // is served from OUR origin, so any 'self'-based upstream policy would
    // block every one of the page's own scripts/styles and it renders as a
    // permanently-spinning blank frame.
    const stripped: Record<string, string> = {};
    upstream.headers.forEach((val, key) => {
      const k = key.toLowerCase();
      if (k === "x-frame-options") return;
      if (k === "content-security-policy" || k === "content-security-policy-report-only") return;
      if (k === "transfer-encoding" || k === "connection" || k === "content-encoding" || k === "content-length") return; // hop-by-hop / recomputed
      stripped[key] = val;
    });

    const ct = (stripped["content-type"] ?? upstream.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("text/html")) {
      let html = await upstream.text();
      // Many sites (Uniswap, OpenSea, ...) ALSO ship CSP as an in-body <meta>
      // tag, which the header-strip above never touches. Since the document
      // is served from OUR origin, that meta tag's 'self' resolves to us -
      // not the target site - so it blocks every one of the page's own
      // scripts (and our injected nav script below) from running at all,
      // leaving a permanently blank page. Strip it same as the header.
      html = html.replace(
        /<meta[^>]+http-equiv=["']content-security-policy(?:-report-only)?["'][^>]*>/gi,
        ""
      );
      // Strip any <base> tag the page ships itself - if it's relative (e.g.
      // <base href="/">, common in Angular/webpack builds), it would resolve
      // against OUR origin (the document is served from /api/browser-proxy),
      // not the target site's, breaking every relative script/style/API
      // request on that specific site. Ours (below) always wins.
      html = html.replace(/<base[^>]*>/gi, "");
      // Inject <base> so relative resources resolve against the original origin
      const resolvedUrl = new URL(upstream.url || targetUrl);
      const origin = resolvedUrl.origin + "/";
      const baseTag = `<base href="${origin}">`;
      // The document itself is served from /api/browser-proxy?url=..., so
      // window.location.pathname is ALWAYS that proxy path, never the real
      // page's path/query/hash. Every client-side router (React Router, the
      // frameworks Uniswap/Aave/OpenSea/etc. all ship) reads
      // window.location.pathname to decide what to render, matches nothing,
      // and renders a blank/404 screen - this is what actually produces a
      // blank page for ANY site, not just malformed ones. history.replaceState
      // can rewrite the path/query/hash (same-origin change, allowed) before
      // the target's own bundle runs, so the router sees the real route.
      const realPath = resolvedUrl.pathname + resolvedUrl.search + resolvedUrl.hash;
      const pathFixScript = `<script>(function(){try{history.replaceState(history.state,'',${JSON.stringify(realPath)});}catch(e){}})();</script>`;
      // Keep in-frame navigation flowing through the proxy: without this, the
      // first click navigates the iframe straight to the real site, whose
      // X-Frame-Options blocks rendering and the frame appears to hang forever.
      const navScript = `<script>(function(){
        var PROXY='/api/browser-proxy?url=';
        function proxied(href){try{var u=new URL(href, document.baseURI);if(u.protocol!=='http:'&&u.protocol!=='https:')return null;return PROXY+encodeURIComponent(u.href);}catch(e){return null;}}
        document.addEventListener('click',function(ev){
          var a=ev.target&&ev.target.closest?ev.target.closest('a[href]'):null;
          if(!a)return;
          var p=proxied(a.getAttribute('href'));
          if(!p)return;
          ev.preventDefault();ev.stopPropagation();
          if(a.target==='_blank'){window.open(p);}else{window.location.href=p;}
        },true);
        document.addEventListener('submit',function(ev){
          var f=ev.target;if(!f||f.method&&f.method.toLowerCase()==='post')return;
          try{
            ev.preventDefault();
            var u=new URL(f.getAttribute('action')||document.baseURI,document.baseURI);
            var q=new URLSearchParams(new FormData(f));u.search=q.toString();
            window.location.href=PROXY+encodeURIComponent(u.href);
          }catch(e){}
        },true);
      })();</script>`;
      // Bridges window.ethereum (EIP-1193 + EIP-6963) to the parent page over
      // postMessage. Every account/chain/signing request is relayed to
      // DeFiBrowserSheet.tsx, which is the only place that ever touches the
      // real wallet client - this script itself never sees any key material.
      // Without this, "Connect Wallet" inside the framed dApp had nothing to
      // talk to at all (no window.ethereum existed), so the browser could
      // load pages but never actually interact with them.
      const providerScript = `<script>(function(){
        if (window.top !== window.self && window.parent) {
          var pending = {};
          var reqId = 0;
          var listeners = {};
          var chainIdHex = null;
          var accounts = [];

          function emit(ev, data){
            var hs = listeners[ev] || [];
            for (var i = 0; i < hs.length; i++) { try { hs[i](data); } catch(e){} }
          }

          window.addEventListener('message', function(ev){
            if (ev.source !== window.parent || ev.origin !== window.location.origin) return;
            var d = ev.data;
            if (!d || typeof d !== 'object') return;
            if (d.type === 'fidcaster:wallet:event') {
              if (d.event === 'chainChanged') chainIdHex = d.data;
              if (d.event === 'accountsChanged') accounts = d.data || [];
              if (d.event === 'disconnect') accounts = [];
              emit(d.event, d.data);
              return;
            }
            if (d.type !== 'fidcaster:wallet:response') return;
            var entry = pending[d.id];
            if (!entry) return;
            delete pending[d.id];
            if (d.error) { var err = new Error(d.error.message || 'Request failed'); err.code = d.error.code; entry.reject(err); }
            else entry.resolve(d.result);
          });

          function request(args){
            var method = args && args.method;
            var params = (args && args.params) || [];
            return new Promise(function(resolve, reject){
              var id = 'r' + (++reqId);
              pending[id] = { resolve: resolve, reject: reject };
              window.parent.postMessage({ type: 'fidcaster:wallet:request', id: id, method: method, params: params }, window.location.origin);
              setTimeout(function(){ if (pending[id]) { delete pending[id]; reject(new Error('Request timed out')); } }, 120000);
            });
          }

          var provider = {
            isMetaMask: true,
            isFidCaster: true,
            request: request,
            enable: function(){ return request({ method: 'eth_requestAccounts' }); },
            send: function(a, b){
              if (typeof a === 'string') return request({ method: a, params: b });
              request({ method: a.method, params: a.params }).then(
                function(result){ b(null, { id: a.id, jsonrpc: '2.0', result: result }); },
                function(err){ b(err); }
              );
            },
            sendAsync: function(payload, cb){
              request({ method: payload.method, params: payload.params }).then(
                function(result){ cb(null, { id: payload.id, jsonrpc: '2.0', result: result }); },
                function(err){ cb(err); }
              );
            },
            on: function(ev, h){ (listeners[ev] = listeners[ev] || []).push(h); },
            removeListener: function(ev, h){ if (listeners[ev]) listeners[ev] = listeners[ev].filter(function(x){ return x !== h; }); },
            get chainId(){ return chainIdHex; },
            get selectedAddress(){ return accounts[0] || null; },
          };

          try { Object.defineProperty(window, 'ethereum', { value: provider, configurable: true }); }
          catch(e) { window.ethereum = provider; }

          function announce(){
            var info = { uuid: 'fidcaster-wallet-' + window.location.origin, name: 'FidCaster Wallet', icon: 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTgwIiBoZWlnaHQ9IjE4MCIgdmlld0JveD0iMCAwIDE4MCAxODAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxODAiIGhlaWdodD0iMTgwIiByeD0iNDAiIGZpbGw9IiM3QzNBRUQiLz4KPHJlY3Qgd2lkdGg9IjE4MCIgaGVpZ2h0PSIxODAiIHJ4PSI0MCIgZmlsbD0idXJsKCNncmFkKSIvPgo8dGV4dCB4PSI5MCIgeT0iMTI0IiBmb250LWZhbWlseT0ic3lzdGVtLXVpLCAtYXBwbGUtc3lzdGVtLCBzYW5zLXNlcmlmIiBmb250LXdlaWdodD0iOTAwIiBmb250LXNpemU9Ijk2IiBmaWxsPSJ3aGl0ZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgbGV0dGVyLXNwYWNpbmc9Ii00Ij5GQzwvdGV4dD4KPGRlZnM+CiAgPGxpbmVhckdyYWRpZW50IGlkPSJncmFkIiB4MT0iMCIgeTE9IjAiIHgyPSIxODAiIHkyPSIxODAiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KICAgIDxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM3QzNBRUQiLz4KICAgIDxzdG9wIG9mZnNldD0iMTAwJSIgc3RvcC1jb2xvcj0iIzRGNDZFNSIvPgogIDwvbGluZWFyR3JhZGllbnQ+CjwvZGVmcz4KPC9zdmc+Cg==', rdns: 'xyz.fidcaster.wallet' };
            window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info: info, provider: provider }) }));
          }
          window.addEventListener('eip6963:requestProvider', announce);
          announce();
          window.parent.postMessage({ type: 'fidcaster:wallet:ready' }, window.location.origin);
        }
      })();</script>`;
      const injected = baseTag + pathFixScript + navScript + providerScript;
      html = html.replace(/(<head[^>]*>)/i, `$1${injected}`);
      if (!html.includes(pathFixScript)) html = injected + html;
      res.status(upstream.status);
      res.set({ ...stripped, "cache-control": "no-store" });
      res.send(html);
    } else {
      // Pass binary/other content through unchanged
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.status(upstream.status);
      res.set({ ...stripped, "cache-control": "public, max-age=3600" });
      res.send(buf);
    }
  } catch (e) {
    // A bare JSON error body rendered inside the iframe is visually
    // indistinguishable from a blank page - render something a user
    // actually sees instead of silently leaving them staring at nothing.
    const message = String(e instanceof Error ? e.message : e).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);
    res.status(502).set({ "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).send(
      `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>` +
      `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;` +
      `font-family:-apple-system,system-ui,sans-serif;background:#0b0b10;color:#e5e5ea;text-align:center;padding:24px;box-sizing:border-box;">` +
      `<div><p style="font-size:15px;font-weight:600;margin:0 0 8px;">Couldn't load this page</p>` +
      `<p style="font-size:13px;color:#9a9aa5;margin:0;">${message}</p></div></body></html>`
    );
  }
});

// ── Admin panel: real server-side auth + persisted config/secrets ──────────────
// Replaces the old client-only PIN (a hash compared entirely in the browser,
// trivially bypassable) with a signed session cookie checked here on the
// server, and replaces localStorage-only settings with a real DB so changes
// actually reach every visitor, not just the browser that made them.
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Try again later." },
});

// Tighter than the 600/min global cap - a stolen/leaked session token
// shouldn't be able to hammer config/secret writes at the same rate as
// ordinary read traffic.
const adminWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin writes, please slow down." },
});

// Optional CAPTCHA gate (Cloudflare Turnstile) after repeated failed admin
// login attempts - entirely inert unless TURNSTILE_SITE_KEY/SECRET_KEY are
// both set, so existing deployments that haven't configured Turnstile see no
// behavior change at all. Failure counts are per-IP, in-memory, and reset on
// a successful login or after the same window the rate limiter itself uses.
const CAPTCHA_AFTER_FAILURES = 3;
const failedLoginCounts = new Map<string, { count: number; resetAt: number }>();

function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const entry = failedLoginCounts.get(ip);
  if (!entry || entry.resetAt < now) {
    failedLoginCounts.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
  } else {
    entry.count++;
  }
}

function captchaRequired(ip: string): boolean {
  const entry = failedLoginCounts.get(ip);
  return !!entry && entry.resetAt >= Date.now() && entry.count >= CAPTCHA_AFTER_FAILURES;
}

function getTurnstileKeys(): { siteKey: string; secretKey: string } | null {
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  return siteKey && secretKey ? { siteKey, secretKey } : null;
}

async function verifyTurnstile(token: string, secretKey: string, ip: string): Promise<boolean> {
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(8000),
    });
    const data = await r.json() as { success?: boolean };
    return !!data.success;
  } catch {
    return false;
  }
}

// Public - the Turnstile site key is meant to be embedded in client HTML
// (it's not a secret, only TURNSTILE_SECRET_KEY is); this just tells the
// login form whether to render the widget and with which key.
app.get("/api/admin/login-config", (req, res) => {
  const keys = getTurnstileKeys();
  res.json({
    captchaSiteKey: keys?.siteKey ?? null,
    captchaRequired: keys ? captchaRequired(req.ip ?? "") : false,
  });
});

app.post("/api/admin/login", adminLoginLimiter, async (req, res) => {
  if (!isAdminConfigured()) {
    res.status(503).json({ error: "Admin panel is not configured (ADMIN_PASSWORD unset on the server)." });
    return;
  }
  const ip = req.ip ?? "";
  const keys = getTurnstileKeys();
  if (keys && captchaRequired(ip)) {
    const { captchaToken } = req.body as { captchaToken?: string };
    if (!captchaToken || typeof captchaToken !== "string" || !(await verifyTurnstile(captchaToken, keys.secretKey, ip))) {
      res.status(401).json({ error: "Captcha verification failed", captchaRequired: true });
      return;
    }
  }
  const { password } = req.body as { password?: string };
  if (!password || typeof password !== "string" || !checkAdminPassword(password)) {
    // Deliberately identical response/timing-shape for "wrong password" and
    // "no such thing" - nothing here reveals whether admin is configured.
    recordFailedLogin(ip);
    res.status(401).json({ error: "Invalid password", captchaRequired: keys ? captchaRequired(ip) : undefined });
    return;
  }
  failedLoginCounts.delete(ip);
  const token = issueSessionToken();
  if (!token) { res.status(503).json({ error: "Admin session signing is not configured." }); return; }
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post("/api/admin/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/admin/session", (req, res) => {
  res.json({ valid: hasValidAdminSession(req) });
});

const MAX_CONFIG_BYTES = 2 * 1024 * 1024; // 2MB - generous for JSON settings incl. custom CSS

// Public, unauthenticated - every visitor's app load fetches this so admin
// settings actually apply site-wide instead of only in the editing browser.
app.get("/api/public-config", (_req, res) => {
  const json = getPublicConfig();
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.json({ config: json ? JSON.parse(json) : null });
});

app.get("/api/admin/config", requireAdminSession, (_req, res) => {
  const json = getPublicConfig();
  res.json({ config: json ? JSON.parse(json) : null });
});

app.put("/api/admin/config", requireAdminSession, adminWriteLimiter, (req, res) => {
  const { config } = req.body as { config?: unknown };
  if (!config || typeof config !== "object") { res.status(400).json({ error: "config object required" }); return; }
  const json = JSON.stringify(config);
  if (json.length > MAX_CONFIG_BYTES) { res.status(413).json({ error: "config too large" }); return; }
  setPublicConfig(json);
  res.json({ ok: true });
});

app.get("/api/admin/secrets", requireAdminSession, (_req, res) => {
  res.json(getAdminSecrets());
});

const VALID_SECRET_KEYS = new Set(["neynarApiKey", "imgurClientId", "cloudinaryAccountsJson"]);

app.put("/api/admin/secrets", requireAdminSession, adminWriteLimiter, (req, res) => {
  const body = req.body as Record<string, unknown>;
  if (!body || typeof body !== "object") { res.status(400).json({ error: "body required" }); return; }
  const partial: Record<string, string> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!VALID_SECRET_KEYS.has(k)) { res.status(400).json({ error: `Unknown secret key: ${k}` }); return; }
    if (typeof v !== "string") { res.status(400).json({ error: `${k} must be a string` }); return; }
    if (v.length > MAX_CONFIG_BYTES) { res.status(413).json({ error: `${k} too large` }); return; }
    partial[k] = v;
  }
  if (partial.cloudinaryAccountsJson) {
    try {
      const parsed = JSON.parse(partial.cloudinaryAccountsJson);
      if (!Array.isArray(parsed)) throw new Error("not an array");
    } catch {
      res.status(400).json({ error: "cloudinaryAccountsJson must be valid JSON array" }); return;
    }
  }
  setAdminSecrets(partial);
  if ("neynarApiKey" in partial) setAdminNeynarKey(partial.neynarApiKey || null);
  res.json({ ok: true });
});

// ── Farcaster Mini App plumbing ───────────────────────────────────────────────
// Serve the manifest inline so it is never intercepted by the SPA fallback,
// regardless of whether dist/public/.well-known/ exists in the build output.
const FARCASTER_MANIFEST = {
  accountAssociation: {
    header: "eyJmaWQiOjE2MzMzLCJ0eXBlIjoiY3VzdG9keSIsImtleSI6IjB4NTI3ZmE3MGM5RTJFMEViMWM5MDg2YkRBM2UyMTYwOEYyNTAyQWQwNCJ9",
    payload: "eyJkb21haW4iOiJmaWRjYXN0ZXIueHl6In0",
    signature: "c9x9zyX8rIh8/oWJJhgweM9JzmtTSnCZ24m/RKwOBi9CVLHxRQXXInL4T44BfVPP8LYEJywagy0tilT5ypMpiBs=",
  },
  // ⚠️  Must use "miniapp" key (not "frame") — Farcaster Mini App spec v1
  miniapp: {
    version: "1",
    name: "FidCaster",
    // NOTE: Farcaster's spec technically says iconUrl "must be 1024x1024px
    // PNG, no alpha" — this is a transparent PNG per explicit user request,
    // which deviates from that. If the manifest validator rejects it (same
    // broken-icon symptom as the wrong-size version this replaced), swap
    // back to icon-1024.png (opaque, spec-compliant, kept in the repo).
    iconUrl: "https://fidcaster.xyz/icons/icon-1024-transparent.png",
    homeUrl: "https://fidcaster.xyz/mini",
    imageUrl: "https://fidcaster.xyz/og-mini.png",
    buttonTitle: "Open FidCaster",
    splashImageUrl: "https://fidcaster.xyz/icons/splash-200-transparent.png",
    splashBackgroundColor: "#1D0070",
    webhookUrl: "https://fidcaster.xyz/api/miniapp/webhook",
    subtitle: "Earn points. Get the airdrop.",
    description: "Track your FidCaster points, climb the leaderboard, refer friends, and register your wallet for the token airdrop on Base.",
    primaryCategory: "social",
    heroImageUrl: "https://fidcaster.xyz/og-mini.png",
    ogTitle: "FidCaster Points",
    ogDescription: "Earn points and claim your airdrop on FidCaster.",
    ogImageUrl: "https://fidcaster.xyz/og-mini.png",
  },
};

// fc:miniapp embed metadata for the /mini home URL
// imageUrl must be 3:2 (1200×800), min 600×400 — see Farcaster Mini App spec
const MINI_EMBED = JSON.stringify({
  version: "1",
  imageUrl: "https://fidcaster.xyz/og-mini.png",
  button: {
    title: "Open FidCaster",
    action: {
      type: "launch_miniapp",
      url: "https://fidcaster.xyz/mini",
      name: "FidCaster",
      splashImageUrl: "https://fidcaster.xyz/icons/splash-200-transparent.png",
      splashBackgroundColor: "#1D0070",
    },
  },
});
app.get("/.well-known/farcaster.json", (_req: express.Request, res: express.Response) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
  res.json(FARCASTER_MANIFEST);
});

// Image aliases — farcaster.json references these short paths
app.get("/icon.png",   (_req, res) => res.redirect(307, "/icons/icon-512.png"));
app.get("/splash.png", (_req, res) => res.redirect(307, "/icons/icon-512.png"));
app.get("/image.png",  (_req, res) => res.redirect(307, "/opengraph.jpg"));

// Webhook alias — /api/webhook also accepted (used by some Farcaster clients)
app.post("/api/webhook", express.json(), async (req: express.Request, res: express.Response) => {
  await handleMiniAppWebhookBody(req.body as Record<string, unknown>);
  res.json({ ok: true });
});

// ── Production static file serving ────────────────────────────────────────────
// In production the Express server is the only process - it serves the React
// SPA and all API routes. Vite's dev server handles this in development.
if (process.env.NODE_ENV === "production") {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const distPath = resolve(__dir, "../dist/public");
  if (existsSync(distPath)) {
    // Only files under assets/ have content-hashed names (safe to cache for a
    // year - a changed file gets a new filename). Everything else served from
    // the public root (logo, icons, manifest, service worker, robots.txt) keeps
    // its filename across deploys, so a long maxAge here means a browser that
    // ever cached a bad response for one of these (e.g. hitting the SPA
    // fallback below because the file was briefly missing/stale on a previous
    // deploy) would keep serving that broken copy for up to a year. Cache
    // those short instead so a fix actually reaches users promptly.
    app.use(express.static(distPath, {
      maxAge: "1y",
      index: false, // handled explicitly below
      etag: true,
      setHeaders: (res: express.Response, filePath: string) => {
        if (filePath.endsWith(".html")) {
          // HTML files must never be cached - they reference hashed assets
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        } else if (!filePath.includes(`${sep}assets${sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
        }
      },
    }));

    // /mini: inject fc:miniapp + fc:frame embed meta tags so Farcaster crawlers
    // see them, while the SPA still boots normally for real users.
    app.get("/mini", (_req: express.Request, res: express.Response, next: express.NextFunction) => {
      const indexPath = resolve(distPath, "index.html");
      if (!existsSync(indexPath)) { next(); return; }
      try {
        const html = readFileSync(indexPath, "utf-8");
        const metaTags = [
          `<meta name="fc:miniapp" content='${MINI_EMBED}' />`,
          `<meta name="fc:frame" content='${MINI_EMBED}' />`,
          `<meta property="og:image" content="https://fidcaster.xyz/og-mini.png" />`,
          `<meta property="og:title" content="FidCaster Points" />`,
          `<meta property="og:description" content="Earn points. Get the airdrop." />`,
        ].join("\n    ");
        const modified = html.replace("</head>", `  ${metaTags}\n  </head>`);
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(modified);
      } catch { next(); }
    });

    // SPA fallback - any non-/api/* path serves index.html
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.path.startsWith("/api/")) { next(); return; }
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(resolve(distPath, "index.html"));
    });
  } else {
    console.warn("[server] dist/public not found - run `pnpm build` first");
  }
}

app.use((_req: express.Request, res: express.Response) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const msg = err.message || "Internal server error";
  if (msg.startsWith("CORS:")) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  // body-parser (express.json) throws this for a body over the configured
  // limit - surface it as the 413 it actually is, not a generic 500.
  if ((err as { type?: string }).type === "entity.too.large" || (err as { status?: number }).status === 413) {
    res.status(413).json({ error: "Request body too large" });
    return;
  }
  console.error("[server] unhandled error:", msg);
  res.status(500).json({ error: "Internal server error" });
});

const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const server = app.listen(PORT, host, () => {
  console.log(`[farcaster-server] listening on ${host}:${PORT} (${process.env.NODE_ENV ?? "development"})`);
  // Spin up worker thread pool for ed25519 signing - offloads CPU from main loop.
  // If tsx/ESM worker init fails, signFarcasterAction falls back to main thread silently.
  initSignPool();
  initPushTokenStore(); // warm up pg pool + ensure table exists
  initLedger().catch((e) => console.error("[ledger] init failed:", e));
  initActionsLedgerStore(); // warm up pg pool + ensure points/airdrop ledger tables exist
  startVerificationJob();   // background: verify hub action proofs against Neynar
  startSybilDetector();     // background: hourly fraud exclusion rules
  startWatchers();          // background: data-gap monitors + /api/watchers/health
  scheduleSpamLabelRefresh(); // background: downloads the ~125MB dataset only when it's stale/missing
  // Hydrate the admin-configured Neynar key (if any was saved via the admin
  // panel in a previous run) into the in-memory rate limiter on boot.
  const savedNeynarKey = getAdminSecrets().neynarApiKey;
  if (savedNeynarKey) setAdminNeynarKey(savedNeynarKey);
});

function shutdown(signal: string) {
  console.log(`[farcaster-server] ${signal} received - shutting down gracefully`);
  server.close(() => {
    console.log("[farcaster-server] closed");
    process.exit(0);
  });
  setTimeout(() => { console.error("[farcaster-server] forced exit"); process.exit(1); }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
