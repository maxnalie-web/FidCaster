import type { Express, Request, Response, NextFunction } from "express";
import { cacheGet, cacheSet } from "./cache.js";

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
    const r = await fetch(upstream, {
      headers: { accept: "application/json", api_key: apiKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const body = await r.json().catch(() => ({}));
      res.status(r.status).json(body);
      return;
    }
    const data = await r.json();
    cacheSet(cacheKey, data, ttlFor(neynarPath));
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } catch (e: unknown) {
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

// ── Follow list — 100% Hub, zero Neynar calls ────────────────────────────────
// Step 1: Hub linksByFid / linksByTargetFid  → FIDs (free, no rate limit)
// Step 2: Hub userDataByFid in parallel      → profiles (free, no rate limit)
// viewer_context.following: true when viewing own following list (everyone listed
// is being followed). Defaults false otherwise — Follow button is idempotent.

type HubLinkMsg = {
  data?: {
    fid?: number;
    linkBody?: { type?: string; targetFid?: number };
  };
};

async function fetchHubProfile(fid: number): Promise<Record<string, unknown>> {
  const cacheKey = `hub:user:${fid}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    const c = cached as { users?: Record<string, unknown>[] };
    if (c.users?.[0]) return c.users[0];
  }
  const r = await fetch(`${HUB_BASE}/userDataByFid?fid=${fid}&pageSize=10`, {
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) return { fid, username: String(fid), display_name: String(fid), pfp_url: "", profile: { bio: { text: "" } } };
  const data = await r.json() as { messages?: HubMsg[] };
  const user = normalizeHubUser(fid, data.messages ?? []);
  cacheSet(cacheKey, { users: [user] }, 300_000); // 5 min per profile
  return user;
}

async function fetchFollowList(
  mode: "followers" | "following",
  fid: number,
  viewerFid: number,
  pageToken?: string
): Promise<{ users: { user: Record<string, unknown> }[]; next?: { cursor: string } }> {
  // 1. Get FIDs from Hub
  const hubEndpoint = mode === "followers"
    ? `linksByTargetFid?target_fid=${fid}&link_type=follow&pageSize=100${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`
    : `linksByFid?fid=${fid}&link_type=follow&pageSize=100${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;

  const hubRes = await fetch(`${HUB_BASE}/${hubEndpoint}`, { signal: AbortSignal.timeout(10_000) });
  if (!hubRes.ok) throw new Error(`Hub error ${hubRes.status}`);
  const hubData = await hubRes.json() as { messages?: HubLinkMsg[]; nextPageToken?: string };

  const messages = hubData.messages ?? [];
  const fids = messages
    .map(m => mode === "followers" ? m.data?.fid : m.data?.linkBody?.targetFid)
    .filter((f): f is number => typeof f === "number" && f > 0);

  const nextCursor = hubData.nextPageToken && hubData.nextPageToken !== "" ? hubData.nextPageToken : undefined;
  if (fids.length === 0) return { users: [], next: nextCursor ? { cursor: nextCursor } : undefined };

  // 2. Fetch profiles from Hub in parallel batches of 20
  const BATCH = 20;
  const profileMap = new Map<number, Record<string, unknown>>();
  for (let i = 0; i < fids.length; i += BATCH) {
    const batch = fids.slice(i, i + BATCH);
    const results = await Promise.allSettled(batch.map(f => fetchHubProfile(f)));
    results.forEach((r, idx) => {
      if (r.status === "fulfilled") profileMap.set(batch[idx], r.value);
    });
  }

  // viewer_context: if viewing own following list, all entries are being followed
  const ownFollowing = mode === "following" && fid === viewerFid;

  const users = fids
    .map(f => {
      const profile = profileMap.get(f);
      if (!profile) return undefined;
      return {
        user: {
          ...profile,
          viewer_context: { following: ownFollowing, followed_by: mode === "followers" },
        },
      };
    })
    .filter((u): u is { user: Record<string, unknown> } => u !== undefined);

  return { users, next: nextCursor ? { cursor: nextCursor } : undefined };
}

async function followListHandler(mode: "followers" | "following", req: Request, res: Response): Promise<void> {
  const fid = Number(req.query.fid);
  const viewerFid = Number(req.query.viewer_fid ?? req.query.fid);
  if (!fid) { res.status(400).json({ error: "fid required" }); return; }

  const cursor = (req.query.cursor as string) || undefined;
  // Cache key includes viewerFid only for viewer_context accuracy
  const cacheKey = `follow:${mode}:${fid}:v${viewerFid}:${cursor ?? "start"}`;

  const hit = cacheGet(cacheKey);
  if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

  try {
    const result = await fetchFollowList(mode, fid, viewerFid, cursor);
    cacheSet(cacheKey, result, 180_000); // 3 min page cache (profiles cached 5 min separately)
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
      const r = await fetch(`${NEYNAR_V2}/farcaster/notifications?${qs}`, {
        headers: { accept: "application/json", api_key: apiKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) { const b = await r.json().catch(() => ({})); res.status(r.status).json(b); return; }
      const data = await r.json();
      cacheSet(cacheKey, data, 60_000); // cache 60s per fid+cursor
      res.setHeader("X-Cache", "MISS");
      res.json(data);
    } catch (e: unknown) {
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

  // ── General Neynar read proxy (future use) ─────────────────────────────────
  // /api/fc/* — requires /api/fc to be in Vite proxy config
  app.use("/api/fc", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") { next(); return; }
    void neynarProxy(req, res);
  });
}
