import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { mnemonicToAccount } from "viem/accounts";
import { submitFarcasterAction, signFarcasterAction, type FarcasterAction } from "./farcaster-submit.js";
import { registerFidMarketRoutes } from "./fid-market-routes.js";
import { registerProxyRoutes } from "./neynar-proxy.js";
import { cacheStats } from "./cache.js";
import { metrics } from "./metrics.js";

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
} catch { /* .env not found — rely on real env vars */ }

const app = express();
app.set("trust proxy", 1);
// In production the artifact routes traffic to PORT (set to 5173 in artifact.toml).
// In dev the server runs on API_PORT (3001) and Vite proxies /api/* to it.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? "3001");
const START_TIME = Date.now();

// Additional production origins from env: ALLOWED_ORIGINS=https://fidcaster.com,https://www.fidcaster.com
const extraOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",").map(s => s.trim()).filter(Boolean)
  .map(o => new RegExp(`^${o.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));

const ALLOWED_ORIGINS = [
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/[\w.-]+\.replit\.dev$/,
  /^https:\/\/[\w.-]+\.replit\.app$/,
  /^https:\/\/[\w.-]+\.repl\.co$/,
  /^https:\/\/[\w.-]+\.spock\.replit\.dev$/,
  /^https:\/\/[\w.-]+\.worf\.replit\.dev$/,
  ...extraOrigins,
];

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:", "wss:"],
      frameSrc: ["'none'"],
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

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header = non-browser client (curl, server-to-server). Allow GET,
    // block write methods via the CORS preflight mechanism being skipped — real
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
}));

app.use(compression());
app.use(express.json({ limit: "20mb" })); // large limit for base64 image upload route (10MB file ≈ 13.3MB base64)

// Global limiter — skip follow/following list endpoints (already protected by Neynar throttle)
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

// Action limiter — covers follow/unfollow/like/recast/cast per IP.
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
          // Just store it — the UI can show total messages
          const total = d?.dbStats?.numMessages || 0;
          if (total > 0) dailyCasts = null; // not daily — skip
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
// Not proxied to the public — only reachable directly on the server port.
// Shows cache hit/miss ratio, SWR refreshes, hub success/fail, SQLite queue peak.
app.get("/internal/metrics", (_req, res) => {
  res.json({ ...metrics.snapshot(), cache_store: cacheStats() });
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
// (NOT the per-user seed). Each user just scans a QR and approves in Warpcast — seedless.
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
    res.status(500).json({ error: msg });
  }
});

// ── Browser-direct hub submission — sign only, no hub round-trip from server ──
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

// ── Image upload proxy (avoids exposing Imgur client ID in client bundle) ──
const uploadLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

app.post("/api/farcaster/upload-image", uploadLimiter, async (req, res) => {
  try {
    const { image: imageDataUrl, type: mimeType = "image/jpeg" } = req.body as { image?: string; type?: string };
    if (!imageDataUrl) {
      res.status(400).json({ error: "Expected JSON body {image: dataURL}" });
      return;
    }
    // Strip optional data URL prefix — keep only raw base64
    const base64 = imageDataUrl.includes(",") ? imageDataUrl.split(",")[1] : imageDataUrl;
    const buffer = Buffer.from(base64, "base64");

    const imgurClientId = process.env.IMGUR_CLIENT_ID || process.env.VITE_IMGUR_CLIENT_ID;
    if (imgurClientId) {
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
            res.json({ url: data.data.link });
            return;
          }
        }
        console.warn("[upload] Imgur failed, falling back to freeimage.host");
      } catch {
        console.warn("[upload] Imgur error, falling back to freeimage.host");
      }
    }

    // Fallback: freeimage.host — free, permanent, no account required
    const params = new URLSearchParams({
      key: "6d207e02198a847aa98d0a2a901485a5",
      action: "upload",
      source: base64,
      format: "json",
    });
    const fihRes = await fetch("https://freeimage.host/api/1/upload", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(30_000),
    });
    const fihData = await fihRes.json() as { status_code?: number; image?: { url: string }; error?: { message?: string } };
    if (fihData.status_code === 200 && fihData.image?.url) {
      res.json({ url: fihData.image.url });
      return;
    }
    const fihErr = fihData.error?.message ?? "unknown error";
    res.status(502).json({ error: `Image upload failed: ${fihErr}` });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : "Upload failed" });
  }
});

registerFidMarketRoutes(app);
registerProxyRoutes(app); // Neynar read proxy (cached) + Hub direct reads

// ── Production static file serving ────────────────────────────────────────────
// In production the Express server is the only process — it serves the React
// SPA and all API routes. Vite's dev server handles this in development.
if (process.env.NODE_ENV === "production") {
  const __dir = dirname(fileURLToPath(import.meta.url));
  const distPath = resolve(__dir, "../dist/public");
  if (existsSync(distPath)) {
    // Static assets (JS/CSS/images) have content-hashed names → safe to cache 1y
    app.use(express.static(distPath, {
      maxAge: "1y",
      index: false, // handled explicitly below
      etag: true,
      setHeaders: (res: express.Response, filePath: string) => {
        // HTML files must never be cached — they reference hashed assets
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    }));

    // SPA fallback — any non-/api/* path serves index.html
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.path.startsWith("/api/")) { next(); return; }
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.sendFile(resolve(distPath, "index.html"));
    });
  } else {
    console.warn("[server] dist/public not found — run `pnpm build` first");
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
  console.error("[server] unhandled error:", msg);
  res.status(500).json({ error: "Internal server error" });
});

const host = process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
const server = app.listen(PORT, host, () => {
  console.log(`[farcaster-server] listening on ${host}:${PORT} (${process.env.NODE_ENV ?? "development"})`);
});

function shutdown(signal: string) {
  console.log(`[farcaster-server] ${signal} received — shutting down gracefully`);
  server.close(() => {
    console.log("[farcaster-server] closed");
    process.exit(0);
  });
  setTimeout(() => { console.error("[farcaster-server] forced exit"); process.exit(1); }, 10_000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT",  () => shutdown("SIGINT"));
