import type { Express, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { cacheGet, cacheGetSWR, cacheSet } from "./cache.js";
import { metrics } from "./metrics.js";
import { neynarThrottle, singleFlight, penalize429, hasAnyNeynarKey } from "./neynar-limit.js";
import { getCachedProfiles, setCachedProfiles } from "./profile-db.js";

const NEYNAR_V2 = "https://api.neynar.com/v2";
const HUB_BASE  = "https://hub.pinata.cloud/v1";

// ── TTL rules (ms) ────────────────────────────────────────────────────────────
// req.path here is ALREADY stripped of the mount prefix by Express app.use()
function ttlFor(path: string): number {
  if (path.includes("/notifications"))     return  300_000; // 5 min  — was 1 min (5× saving)
  if (path.includes("/feed/trending"))     return  300_000; // 5 min  global
  if (path.includes("/feed"))              return  120_000; // 2 min  personalized
  if (path.includes("/user/bulk"))         return  600_000; // 10 min profiles
  if (path.includes("/user/search"))       return   60_000; // 1 min  search
  if (path.includes("/cast/search"))       return   60_000;
  if (path.includes("/cast/conversation")) return   45_000; // 45s   thread · keep comments fresh (SWR + throttle protect the rate limit)
  if (path.includes("/followers"))         return  900_000; // 15 min — was 3 min (5× saving)
  if (path.includes("/following"))         return  900_000; // 15 min — was 3 min
  if (path.includes("/reactions"))         return  180_000; // 3 min
  if (path.includes("/frame/catalog"))     return  600_000; // 10 min
  if (path.includes("/feed/user"))         return  120_000; // 2 min
  return 120_000;
}

// ── Neynar read proxy ─────────────────────────────────────────────────────────
// Mounted at /api/fc → req.path already has /api/fc stripped by Express
async function neynarProxy(req: Request, res: Response): Promise<void> {
  if (!hasAnyNeynarKey()) {
    res.status(503).json({ error: "Neynar API key not configured on server." }); return;
  }

  // req.path = /farcaster/notifications, req.query = { fid: "16333", ... }
  const neynarPath = req.path;
  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const cacheKey = `neynar:${neynarPath}${qs ? "?" + qs : ""}`;

  const ttlMs = ttlFor(neynarPath);
  const upstream = `${NEYNAR_V2}${neynarPath}${qs ? "?" + qs : ""}`;

  /** Fetch fresh data from Neynar and populate the cache. */
  async function fetchAndCache(): Promise<unknown> {
    const selectedKey = await neynarThrottle();
    const r = await fetch(upstream, {
      headers: { accept: "application/json", api_key: selectedKey },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      if (r.status === 429) penalize429(selectedKey);
      const body = await r.json().catch(() => ({}));
      const err = new Error(`HTTP ${r.status}`) as Error & { status?: number; body?: unknown };
      err.status = r.status; err.body = body;
      throw err;
    }
    const d = await r.json();
    cacheSet(cacheKey, d, ttlMs);
    return d;
  }

  // ── Stale-While-Revalidate: serve cached data (even near-expiry) immediately.
  // When the entry enters its last 20% of TTL, a background refresh is triggered
  // so callers never block on an expiring hot key.
  const staleHit = cacheGetSWR(cacheKey, ttlMs, fetchAndCache);
  if (staleHit !== undefined) {
    metrics.incCacheHit();
    res.setHeader("X-Cache", "HIT");
    res.json(staleHit);
    return;
  }

  try {
    // Hard miss — single-flight: concurrent identical requests share one Neynar call
    metrics.incCacheMiss();
    const data = await singleFlight(cacheKey, async () => {
      const cached2 = cacheGet(cacheKey);
      if (cached2 !== undefined) return cached2;
      return fetchAndCache();
    });
    res.setHeader("X-Cache", "MISS");
    res.json(data);
  } catch (e: unknown) {
    const err = e as Error & { status?: number; body?: unknown };
    if (err.status === 429) {
      res.status(503).set("Retry-After", "5").json({ error: "Rate limit · retry in 5s" });
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
  cursor?: string
): Promise<FollowPage> {
  const q = new URLSearchParams({ fid: String(fid), viewer_fid: String(viewerFid), limit: "100", sort_type: "desc_chron" });
  if (cursor) q.set("cursor", cursor);
  const upstream = `${NEYNAR_V2}/farcaster/${mode}?${q}`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const selectedKey = await neynarThrottle();
      const r = await fetch(upstream, {
        headers: { accept: "application/json", api_key: selectedKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) { if (r.status === 429) penalize429(selectedKey); lastErr = new Error(`${mode} HTTP ${r.status}`); continue; }
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
      const r = await fetchFollowList(mode, fid, viewerFid, cursor);
      cacheSet(cacheKey, r, 900_000); // 15 min — matches ttlFor("/followers")
      return r;
    });
    res.setHeader("X-Cache", "MISS");
    res.json(result);
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : "Follow list error" });
  }
}

// ── Raw follow-graph scan via free hubs (zero Neynar credits) ─────────────────
// linksByTargetFid / linksByFid return up to ~2000 link messages per call with
// reverse=true (newest first) — 20× fewer calls than Neynar's 100-user pages and
// completely free. Used by the Grow fast path, which only needs FIDs up front
// and hydrates profiles lazily through the SQLite-backed /user/bulk cache.
//
// Page tokens are hub-specific, so the cursor we hand out embeds the hub index
// ("<hubIdx>:<token>") and pagination stays pinned to the hub that issued it.
const LINK_HUBS = [
  "https://snap.farcaster.xyz:3381/v1", // official Farcaster snapchain node
  "https://hub.pinata.cloud/v1",
];
const linkHubFailUntil = new Map<string, number>();

type LinkFidsPage = { fids: number[]; nextCursor?: string };
type HubLinkMsg = { data?: { type?: string; fid?: number; linkBody?: { targetFid?: number } } };

async function fetchLinkFidsFromHub(
  base: string, hubIdx: number,
  type: "followers" | "following", fid: number, pageToken?: string,
): Promise<LinkFidsPage> {
  const q = type === "followers"
    ? `linksByTargetFid?target_fid=${fid}&link_type=follow&pageSize=1000&reverse=true`
    : `linksByFid?fid=${fid}&link_type=follow&pageSize=1000&reverse=true`;
  const url = `${base}/${q}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`link hub HTTP ${r.status}`);
  const d = await r.json() as { messages?: HubLinkMsg[]; nextPageToken?: string };
  const fids: number[] = [];
  const seen = new Set<number>();
  for (const m of d.messages ?? []) {
    if (m.data?.type !== "MESSAGE_TYPE_LINK_ADD") continue;
    const f = type === "followers" ? Number(m.data.fid) : Number(m.data.linkBody?.targetFid);
    if (Number.isInteger(f) && f > 0 && !seen.has(f)) { seen.add(f); fids.push(f); }
  }
  return {
    fids,
    nextCursor: d.nextPageToken ? `${hubIdx}:${d.nextPageToken}` : undefined,
  };
}

async function linkFidsHandler(req: Request, res: Response): Promise<void> {
  const fid = Number(req.query.fid);
  const type = req.query.type === "following" ? "following" : "followers";
  if (!Number.isInteger(fid) || fid <= 0) { res.status(400).json({ error: "fid required" }); return; }

  const rawCursor = (req.query.cursor as string) || "";
  let pinnedHub = -1;
  let pageToken: string | undefined;
  if (rawCursor) {
    const sep = rawCursor.indexOf(":");
    pinnedHub = Number(rawCursor.slice(0, sep));
    pageToken = rawCursor.slice(sep + 1);
    if (!Number.isInteger(pinnedHub) || pinnedHub < 0 || pinnedHub >= LINK_HUBS.length) {
      res.status(400).json({ error: "invalid cursor" }); return;
    }
  }

  const cacheKey = `linkfids:${type}:${fid}:${rawCursor || "start"}`;
  const hit = cacheGet(cacheKey);
  if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

  try {
    const result = await singleFlight(cacheKey, async () => {
      const cached = cacheGet(cacheKey);
      if (cached !== undefined) return cached as LinkFidsPage;
      // First page: try any healthy hub. Paginated: stay on the cursor's hub.
      const order = pinnedHub >= 0
        ? [pinnedHub]
        : LINK_HUBS.map((_, i) => i).filter(i => Date.now() >= (linkHubFailUntil.get(LINK_HUBS[i]) ?? 0));
      const tryOrder = order.length > 0 ? order : LINK_HUBS.map((_, i) => i);
      let lastErr: unknown;
      for (const i of tryOrder) {
        try {
          const page = await fetchLinkFidsFromHub(LINK_HUBS[i], i, type, fid, pageToken);
          cacheSet(cacheKey, page, 600_000); // 10 min — follow graphs change slowly
          return page;
        } catch (e) {
          lastErr = e;
          linkHubFailUntil.set(LINK_HUBS[i], Date.now() + 60_000);
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("all link hubs failed");
    });
    res.setHeader("X-Cache", "MISS");
    res.json(result);
  } catch (e: unknown) {
    res.status(502).json({ error: e instanceof Error ? e.message : "link scan failed" });
  }
}

// ── Bulk user lookup with SQLite profile cache ────────────────────────────────
// /api/fc/farcaster/user/bulk?fids=1,2,3&viewer_fid=...
// Checks SQLite first; only fetches missing FIDs from Neynar.
// SQLite cache is shared across ALL users and survives server restarts (12h TTL).
async function bulkUserHandler(req: Request, res: Response): Promise<void> {
  const rawFids = String(req.query.fids ?? "");
  const fids = rawFids
    .split(",")
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0)
    .slice(0, 100);

  if (fids.length === 0) { res.status(400).json({ error: "fids required" }); return; }

  const qs = new URLSearchParams(req.query as Record<string, string>).toString();
  const { hits, misses } = getCachedProfiles(fids);

  // All served from SQLite cache — no Neynar call needed
  if (misses.length === 0) {
    const users = fids.map(f => hits.get(f)).filter(Boolean);
    res.setHeader("X-Cache", "DB-HIT");
    res.json({ users });
    return;
  }

  // Fetch only the missing FIDs from Neynar
  const missQs = new URLSearchParams(req.query as Record<string, string>);
  missQs.set("fids", misses.join(","));
  const cacheKey = `neynar:/farcaster/user/bulk?${qs}`;
  const upstream = `${NEYNAR_V2}/farcaster/user/bulk?${missQs}`;

  try {
    const freshData = await singleFlight(cacheKey, async () => {
      const selectedKey = await neynarThrottle();
      const r = await fetch(upstream, {
        headers: { accept: "application/json", api_key: selectedKey },
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        if (r.status === 429) penalize429(selectedKey);
        const b = await r.json().catch(() => ({}));
        const err = new Error(`HTTP ${r.status}`) as Error & { status?: number; body?: unknown };
        err.status = r.status; err.body = b; throw err;
      }
      const d = await r.json() as { users?: Array<{ fid: number; [k: string]: unknown }> };
      // Persist fresh profiles in SQLite for future requests (any user)
      if (d.users?.length) setCachedProfiles(d.users);
      return d;
    });

    // Merge SQLite hits + fresh Neynar data
    const freshUsers = (freshData as { users?: unknown[] }).users ?? [];
    const cachedUsers = fids
      .filter(f => hits.has(f))
      .map(f => hits.get(f))
      .filter(Boolean);

    res.setHeader("X-Cache", hits.size > 0 ? "DB-PARTIAL" : "MISS");
    res.json({ users: [...cachedUsers, ...freshUsers] });
  } catch (e: unknown) {
    const err = e as Error & { status?: number; body?: unknown };
    if (err.status === 429) {
      res.status(503).set("Retry-After", "5").json({ error: "Rate limit · retry in 5s" });
      return;
    }
    if (err.status) { res.status(err.status).json(err.body ?? { error: err.message }); return; }
    res.status(502).json({ error: e instanceof Error ? e.message : "Upstream error" });
  }
}

// ── Register ──────────────────────────────────────────────────────────────────
export function registerProxyRoutes(app: Express): void {
  // ── Cached notifications endpoint ─────────────────────────────────────────
  // Mounted under /api/farcaster (already in Vite proxy config).
  // Intercepts GET /api/farcaster/notifications before the global 404.
  app.get("/api/farcaster/notifications", async (req: Request, res: Response) => {
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    const cacheKey = `neynar:/farcaster/notifications?${qs}`;

    const hit = cacheGet(cacheKey);
    if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

    try {
      const data = await singleFlight(cacheKey, async () => {
        const cached = cacheGet(cacheKey);
        if (cached !== undefined) return cached;
        const selectedKey = await neynarThrottle();
        const r = await fetch(`${NEYNAR_V2}/farcaster/notifications?${qs}`, {
          headers: { accept: "application/json", api_key: selectedKey },
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          const err = new Error(`HTTP ${r.status}`) as Error & { status?: number; body?: unknown };
          err.status = r.status; err.body = b;
          throw err;
        }
        const d = await r.json();
        cacheSet(cacheKey, d, 300_000); // 5 min — matches ttlFor("/notifications")
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

  // ── Raw follow-graph FIDs from free hubs (Grow fast path, zero credits) ───
  app.get("/api/farcaster/link-fids", (req: Request, res: Response) => {
    void linkFidsHandler(req, res);
  });

  // Both hub routes below fetch a free third-party hub (hub.pinata.cloud)
  // directly, with no per-key throttle underneath — unlike the Neynar routes
  // above. index.ts's global limiter deliberately skips /api/hub/* (assuming
  // Neynar-layer throttling, which doesn't apply here), so this is the only
  // rate limit in front of either of them; without it a client could drive
  // unbounded outbound requests against that third party through our IP.
  const hubProxyLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

  // ── Hub user proxy ─────────────────────────────────────────────────────────
  app.get("/api/hub/user/:fid", hubProxyLimiter, hubUserProxy);

  // ── Hub generic proxy ──────────────────────────────────────────────────────
  app.use("/api/hub", hubProxyLimiter, (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") { next(); return; }
    void hubGenericProxy(req, res);
  });

  // ── Bulk user lookup — SQLite profile cache (cross-user, persistent 12h) ──
  app.get("/api/fc/farcaster/user/bulk", (req: Request, res: Response) => {
    void bulkUserHandler(req, res);
  });

  // ── General Neynar read proxy ──────────────────────────────────────────────
  app.use("/api/fc", (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== "GET") { next(); return; }
    void neynarProxy(req, res);
  });

  // ── Official Farcaster mini apps (the exact ranked list the Farcaster /
  //    Base app shows) ────────────────────────────────────────────────────────
  // Source: api.farcaster.xyz/v1/top-frameapps — a PUBLIC, unauthenticated
  // endpoint (no Neynar, no API key). #1 is Spor, FasterTasks ≈ #64, etc.
  // We paginate to gather the full ranked catalog (~200 apps). Cached 5 min.
  app.get("/api/mini-apps", async (_req: Request, res: Response) => {
    const cacheKey = `mini-apps:top-frameapps:v3`;
    const hit = cacheGet(cacheKey);
    if (hit !== undefined) { res.setHeader("X-Cache", "HIT"); res.json(hit); return; }

    type Frame = {
      domain?: string; name?: string; iconUrl?: string; homeUrl?: string;
      shortId?: string; subtitle?: string; tagline?: string; description?: string;
      primaryCategory?: string;
      author?: { username?: string; displayName?: string; pfp?: { url?: string } };
    };
    type RichApp = {
      name: string; description: string; iconUrl: string; url: string;
      category: string; author: string; authorPfp: string; shortId: string;
    };

    try {
      const result = await singleFlight(cacheKey, async () => {
        const FARCASTER_API = "https://api.farcaster.xyz/v1/top-frameapps";
        const seen = new Set<string>();
        const apps: RichApp[] = [];
        let cursor: string | undefined;

        // Walk up to 3 pages (≈300 apps max) following the API's cursor.
        for (let page = 0; page < 3; page++) {
          const url = `${FARCASTER_API}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
          const r = await fetch(url, {
            headers: { accept: "application/json", "User-Agent": "FarcasterClient/1.0" },
            signal: AbortSignal.timeout(12_000),
          });
          if (!r.ok) {
            if (apps.length > 0) break;          // keep whatever we already gathered
            throw new Error(`top-frameapps HTTP ${r.status}`);
          }
          const data = await r.json() as { result?: { frames?: Frame[] }; next?: { cursor?: string } };
          const frames = data.result?.frames ?? [];
          for (const f of frames) {
            const home = f.homeUrl ?? (f.domain ? `https://${f.domain}` : "");
            if (!home || !f.name) continue;
            const dedupeKey = (f.shortId ?? home).toLowerCase();
            if (seen.has(dedupeKey)) continue;
            seen.add(dedupeKey);
            apps.push({
              name: f.name.slice(0, 60),
              description: (f.subtitle ?? f.tagline ?? f.description ?? "").slice(0, 160),
              iconUrl: f.iconUrl ?? "",
              url: home,
              category: f.primaryCategory ?? "app",
              author: f.author?.username ?? f.author?.displayName ?? "",
              authorPfp: f.author?.pfp?.url ?? "",
              shortId: f.shortId ?? "",
            });
          }
          cursor = data.next?.cursor;
          if (!cursor || frames.length === 0) break;
        }

        return { apps, total: apps.length };
      });

      cacheSet(cacheKey, result, 300_000);
      res.setHeader("X-Cache", "MISS");
      res.json(result);
    } catch (e: unknown) {
      res.status(502).json({ error: e instanceof Error ? e.message : "Mini apps error" });
    }
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

  // ── Farcaster Pro status (NO Neynar) ──────────────────────────────────────
  // Pro = the $10/mo "Farcaster Pro" subscription. The official client gates its
  // badge on `profile.accountLevel === "pro"`, which is exposed (unauthenticated)
  // by api.farcaster.xyz/v2/user. We resolve per-fid, cache each for 6h (Pro
  // status changes rarely), and dedupe in-flight requests.
  // GET /api/pro-status?fids=1,2,3  ->  { "1": false, "2": true, ... }
  app.get("/api/pro-status", async (req: Request, res: Response) => {
    const fids = String(req.query.fids ?? "")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 100);
    if (fids.length === 0) { res.json({}); return; }

    const result: Record<number, boolean> = {};
    const misses: number[] = [];
    for (const fid of fids) {
      const hit = cacheGet(`pro:${fid}`);
      if (hit !== undefined) result[fid] = hit as boolean;
      else misses.push(fid);
    }

    // Resolve cache misses with limited concurrency.
    const BATCH = 8;
    for (let i = 0; i < misses.length; i += BATCH) {
      const batch = misses.slice(i, i + BATCH);
      await Promise.all(batch.map(async (fid) => {
        try {
          const isPro = await singleFlight(`pro:${fid}`, async () => {
            const r = await fetch(`https://api.farcaster.xyz/v2/user?fid=${fid}`, {
              headers: { accept: "application/json", "User-Agent": "FarcasterClient/1.0" },
              signal: AbortSignal.timeout(6_000),
            });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const data = await r.json() as { result?: { user?: { profile?: { accountLevel?: string } } } };
            return data.result?.user?.profile?.accountLevel === "pro";
          });
          cacheSet(`pro:${fid}`, isPro, 6 * 60 * 60_000); // 6h
          result[fid] = isPro;
        } catch {
          result[fid] = false; // treat unknown as non-pro (short cache)
          cacheSet(`pro:${fid}`, false, 5 * 60_000);
        }
      }));
    }

    res.json(result);
  });

}
