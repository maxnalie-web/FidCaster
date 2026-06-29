import type { Express, Request, Response, NextFunction } from "express";
import { cacheGet, cacheSet } from "./cache.js";
import { neynarThrottle, singleFlight, penalize429 } from "./neynar-limit.js";

const NEYNAR_V2 = "https://api.neynar.com/v2";
const HUB_BASE  = "https://hub.pinata.cloud/v1";

// ── TTL rules (ms) ────────────────────────────────────────────────────────────
// req.path here is ALREADY stripped of the mount prefix by Express app.use()
function ttlFor(path: string): number {
  if (path.includes("/notifications"))     return   60_000; // 1 min  per user
  if (path.includes("/feed/trending"))     return  180_000; // 3 min  global
  if (path.includes("/feed"))              return   90_000; // 90 s   personalized
  if (path.includes("/user/bulk"))         return  300_000; // 5 min  profiles
  if (path.includes("/user/search"))       return   30_000; // 30 s   search
  if (path.includes("/cast/search"))       return   30_000;
  if (path.includes("/cast/conversation")) return  120_000; // 2 min  thread
  if (path.includes("/followers"))         return  180_000; // 3 min
  if (path.includes("/following"))         return  180_000;
  if (path.includes("/reactions"))         return  120_000; // 2 min
  if (path.includes("/frame/catalog"))     return  300_000; // 5 min
  if (path.includes("/feed/user"))         return   90_000;
  return 90_000;
}

// ── Neynar read proxy ─────────────────────────────────────────────────────────
// Mounted at /api/fc → req.path already has /api/fc stripped by Express
async function neynarProxy(req: Request, res: Response): Promise<void> {
  const apiKey = process.env.NEYNAR_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Neynar API key not configured on server." }); return; }

  // req.path = /farcaster/notifications, req.query = { fid: "16333", ... }
  const neynarPath = req.path;
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const cacheKey = `neynar:${neynarPath}${qs ? "?" + qs : ""}`;

  const hit = cacheGet(cacheKey);
  if (hit !== undefined) {
    res.setHeader("X-Cache", "HIT");
    res.json(hit);
    return;
  }

  const upstream = `${NEYNAR_V2}${neynarPath}${qs ? "?" + qs : ""}`;
  try {
    // single-flight: concurrent identical requests share one Neynar call
    const data = await singleFlight(cacheKey, async () => {
      const cached2 = cacheGet(cacheKey);
      if (cached2 !== undefined) return cached2;
      await neynarThrottle(); // never exceed the key's RPM — queue if needed
      const r = await fetch(upstream, {
        headers: { accept: "application/json", api_key: apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        if (r.status === 429) penalize429();
        const body = await r.json().catch(() => ({}));
        const err = new Error(`HTTP ${r.status}`) as Error & { status?: number; body?: unknown };
        err.status = r.status; err.body = body;
        throw err;
      }
      const d = await r.json();
      cacheSet(cacheKey, d, ttlFor(neynarPath));
      return d;
    });
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } catch (e: unknown) {
    const err = e as Error & { status?: number; body?: unknown };
    if (err.status === 429) {
      res.status(503).set("Retry-After", "5").json({ error: "Rate limit — retry in 5s" });
      return;
    }
    if (err.status) { res.status(err.status).json(err.body ?? { error: err.message }); return; }
    res.status(502).json({ error: e instanceof Error ? e.message : "Upstream error" });
  }
}

// ── Hub user normalizer ───────────────────────────────────────────────────────
type HubMsg = { data?: { fid?: number; userDataBody?: { type?: string; value?: string } } };

function normalizeHubUser(fid: number, messages: HubMsg[]) {
  const user: Record<string, unknown> = {
    fid, username: "", display_name: "", pfp_url: "",
    follower_count: 0, following_count: 0,
    profile: { bio: { text: "" } },
  };
  for (const msg of messages) {
    const body = msg.data?.userDataBody;
    if (!body) continue;
    switch (body.type) {
      case "USER_DATA_TYPE_PFP":      user.pfp_url      = body.value ?? ""; break;
      case "USER_DATA_TYPE_DISPLAY":  user.display_name = body.value ?? ""; break;
      case "USER_DATA_TYPE_USERNAME": user.username      = body.value ?? ""; break;
      case "USER_DATA_TYPE_BIO":      user.profile = { bio: { text: body.value ?? "" } }; break;
    }
  }
  return user;
}

// ── Hub user proxy (/api/hub/user/:fid) ───────────────────────────────────────
async function hubUserProxy(req: Request, res: Response): Promise<void> {
  const fid = Number(req.params.fid);
  if (!Number.isInteger(fid) || fid <= 0) { res.status(400).json({ error: "Invalid fid" }); return; }

  const cacheKey = `hub:user:${fid}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

  try {
    const r = await fetch(`${HUB_BASE}/userDataByFid?fid=${fid}&pageSize=10`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) { res.status(r.status).json({ error: "Hub error" }); return; }
    const data = await r.json() as { messages?: HubMsg[] };
    const user = normalizeHubUser(fid, data.messages ?? []);
    const result = { users: [user] };
    cacheSet(cacheKey, result, 300_000);
    res.setHeader("X-Cache", "MISS");
    res.json(result);
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Hub unreachable" });
  }
}

// ── Hub generic proxy ─────────────────────────────────────────────────────────
// Mounted at /api/hub → req.path already stripped
async function hubGenericProxy(req: Request, res: Response): Promise<void> {
  const hubPath = req.path;
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const cacheKey = `hub:${hubPath}${qs ? "?" + qs : ""}`;

  const hit = cacheGet(cacheKey);
  if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

  try {
    const url = `${HUB_BASE}${hubPath}${qs ? "?" + qs : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) { res.status(r.status).json({ error: "Hub error" }); return; }
    const data = await r.json();
    cacheSet(cacheKey, data, 300_000);
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Hub unreachable" });
  }
}

// ── Follow list — Neynar native endpoint (one reliable call per page) ─────────
// Earlier this used the public Hub (linksByTargetFid + user/bulk), but the free
// Hub (pinata) rate-limits a busy server IP, so deep pages of huge accounts threw
// 502s / fell back to raw FIDs. Since the server key does 300 RPM, Neynar's own
// /followers + /following endpoint is simpler and far more reliable: one call
// returns full profiles WITH follower_count + viewer_context + a cursor. Guarded
// by throttle + cache + single-flight so bursts can never trip the rate limit.

type FollowPage = { users: Array<{ user: Record<string, unknown> }>; next?: { cursor: string } | null };

async function fetchFollowList(
  mode: "followers" | "following",
  fid: number,
  viewerFid: number,
  apiKey: string,
  cursor?: string
): Promise<FollowPage> {
  const q = new URLSearchParams({ fid: String(fid), viewer_fid: String(viewerFid), limit: "100", sort_type: "desc_chron" });
  if (cursor) q.set("cursor", cursor);
  const upstream = `${NEYNAR_V2}/farcaster/${mode}?${q}`;

  // One throttled fetch, retried a couple of times on transient upstream failure
  // before giving up — so a momentary blip doesn't blank the page.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await neynarThrottle();
      const r = await fetch(upstream, {
        headers: { accept: "application/json", api_key: apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) { if (r.status === 429) penalize429(); lastErr = new Error(`${mode} HTTP ${r.status}`); continue; }
      const d = await r.json() as FollowPage;
      return { users: d.users ?? [], next: d.next ?? undefined };
    } catch (e) {
      lastErr = e;
      await new Promise((res) => setTimeout(res, 250 * (attempt + 1)));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("follow list failed");
}

async function followListHandler(mode: "followers" | "following", req: Request, res: Response): Promise<void> {
  const apiKey = process.env.NEYNAR_API_KEY ?? "";
  const fid = Number(req.query.fid);
  const viewerFid = Number(req.query.viewer_fid ?? req.query.fid);
  if (!fid) { res.status(400).json({ error: "fid required" }); return; }

  const cursor = (req.query.cursor as string) || undefined;
  const cacheKey = `follow:${mode}:${fid}:v${viewerFid}:${cursor ?? "start"}`;

  const hit = cacheGet(cacheKey);
  if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

  try {
    const result = await singleFlight(cacheKey, async () => {
      const cached = cacheGet(cacheKey);
      if (cached !== undefined) return cached as FollowPage;
      const r = await fetchFollowList(mode, fid, viewerFid, apiKey, cursor);
      cacheSet(cacheKey, r, 180_000);
      return r;
    });
    res.setHeader("X-Cache", "MISS");
    res.json(result);
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Follow list error" });
  }
}

// ── Register ──────────────────────────────────────────────────────────────────
export function registerProxyRoutes(app: Express): void {
  // ── Cached notifications endpoint ─────────────────────────────────────────
  // Mounted under /api/farcaster (already in Vite proxy config).
  // Intercepts GET /api/farcaster/notifications before the global 404.
  app.get("/api/farcaster/notifications", async (req: Request, res: Response) => {
    const apiKey = process.env.NEYNAR_API_KEY;
    if (!apiKey) { res.status(503).json({ error: "Neynar API key not configured." }); return; }

    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const cacheKey = `neynar:/farcaster/notifications?${qs}`;

    const hit = cacheGet(cacheKey);
    if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

    try {
      const data = await singleFlight(cacheKey, async () => {
        const cached = cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        await neynarThrottle();
        const r = await fetch(`${NEYNAR_V2}/farcaster/notifications?${qs}`, {
          headers: { accept: "application/json", api_key: apiKey },
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          const err = new Error(`HTTP ${r.status}`) as Error & { status?: number; body?: unknown };
          err.status = r.status; err.body = b;
          throw err;
        }
        const d = await r.json();
        cacheSet(cacheKey, d, 60_000); // cache 60s per fid+cursor
        return d;
      });
      res.setHeader("X-Cache", "MISS");
      res.json(data);
    } catch (e: unknown) {
      const err = e as Error & { status?: number; body?: unknown };
      if (err.status) { res.status(err.status).json(err.body ?? { error: err.message }); return; }
      res.status(502).json({ error: e instanceof Error ? e.message : "Upstream error" });
    }
  });

  // ── Followers / Following via Hub+Neynar (no rate limit) ──────────────────
  app.get("/api/farcaster/followers", (req: Request, res: Response) => {
    void followListHandler("followers", req, res);
  });
  app.get("/api/farcaster/following", (req: Request, res: Response) => {
    void followListHandler("following", req, res);
  });

  // ── Hub user proxy ─────────────────────────────────────────────────────────
  app.get("/api/hub/user/:fid", hubUserProxy);

  // ── Hub generic proxy ──────────────────────────────────────────────────────
  app.use("/api/hub", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") { next(); return; }
    void hubGenericProxy(req, res);
  });

  // ── General Neynar read proxy ──────────────────────────────────────────────
  app.use("/api/fc", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") { next(); return; }
    void neynarProxy(req, res);
  });

  // ── Warpcast mini-app discovery proxy (avoids browser CORS) ───────────────
  app.get("/api/warpcast/discover-frames", async (_req: Request, res: Response) => {
    const cacheKey = "warpcast:discover-frames";
    const hit = cacheGet(cacheKey);
    if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }
    try {
      for (const url of ["https://client.warpcast.com/v2/discover-frames", "https://client.warpcast.com/v2/featured-frames"]) {
        const r = await fetch(url, {
          headers: { accept: "application/json", "User-Agent": "FarcasterClient/1.0" },
          signal: AbortSignal.timeout(5_000),
        });
        if (!r.ok) continue;
        const data = await r.json();
        cacheSet(cacheKey, data, 300_000);
        res.setHeader("X-Cache", "MISS");
        res.json(data);
        return;
      }
      res.status(404).json({ error: "Warpcast frames not available" });
    } catch (e) {
      res.status(502).json({ error: e instanceof Error ? e.message : "Upstream error" });
    }
  });
}
