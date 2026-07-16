export const NEYNAR_BASE = "https://api.neynar.com/v2";
// Read proxy base · all GET reads go through the Express server (cached, no client key needed)
const PROXY_BASE = "/api/fc";
// Hub proxy base · direct Hub reads (free, no rate limit)
export const HUB_PROXY_BASE = "/api/hub";
// User-supplied Neynar key (stored in localStorage). Only needed for legacy
// managed-signer write paths. All reads go through the server proxy which uses
// the server-side NEYNAR_API_KEY env var · never exposed in the client bundle.
export const DEFAULT_API_KEY: string = (() => {
  try { return localStorage.getItem("fc_neynar_key") || "NEYNAR_API_DOCS"; }
  catch { return "NEYNAR_API_DOCS"; }
})();

export type NeynarUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  follower_count: number;
  following_count: number;
  power_badge?: boolean;   // Farcaster Power Badge · set by Warpcast, returned by Neynar
  profile?: {
    bio?: { text: string };
    banner?: { url?: string };
    location?: {
      latitude?: number;
      longitude?: number;
      address?: { city?: string; state?: string; state_code?: string; country?: string; country_code?: string };
    };
  };
  viewer_context?: { following: boolean; followed_by: boolean };
  // Neynar quality score (0–1). Modern replacement for the old 0/1/2 spam label:
  // higher = more human/reputable. Also mirrored under experimental.neynar_user_score.
  score?: number;
  experimental?: { neynar_user_score?: number };
  // Off-platform accounts the user has verified (e.g. their X/Twitter handle).
  verified_accounts?: Array<{ platform: string; username: string }>;
  // Farcaster Pro subscription state.
  pro?: { status?: string; subscribed_at?: string; expires_at?: string };
  /** ISO 8601 timestamp string (e.g. "2023-11-07T19:42:51.000Z"), not a Unix number. */
  registered_at?: string;
  custody_address?: string;
};

/** Returns true only if user has the Farcaster Power Badge (power_badge === true from Neynar) */
export function hasPowerBadge(user: NeynarUser): boolean {
  return user.power_badge === true;
}

/** Neynar quality score in 0–1 (falls back to the experimental field). undefined if absent. */
export function neynarScore(user: NeynarUser): number | undefined {
  return user.score ?? user.experimental?.neynar_user_score;
}

/** The user's verified X/Twitter handle, if any. */
export function xAccount(user: NeynarUser): string | undefined {
  return user.verified_accounts?.find(a => a.platform === "x")?.username;
}

/** Short location label · just the city (Twitter-style), falling back to state/country.
 *  Neynar's geocoder sometimes prefixes a city with a parenthetical qualifier like
 *  "(Old) Ottawa" (a neighborhood/historic-district label from its data source) —
 *  that reads as noise to a viewer, so strip a leading "(...)" before displaying. */
export function formatLocation(user: NeynarUser): string | undefined {
  const a = user.profile?.location?.address;
  if (!a) return undefined;
  const raw = a.city || a.state || a.country;
  return raw?.replace(/^\([^)]*\)\s*/, "") || undefined;
}

export type NeynarEmbed = {
  url?: string;
  cast_id?: { hash: string; fid: number };
  cast?: NeynarCast;
  metadata?: { content_type?: string; image?: { width: number; height: number; url?: string } };
};

export type NeynarCast = {
  hash: string;
  thread_hash?: string;
  parent_hash?: string;
  parent_url?: string;
  author: NeynarUser;
  text: string;
  timestamp: string;
  embeds: NeynarEmbed[];
  reactions: {
    likes_count: number;
    recasts_count: number;
    likes: Array<{ fid: number }>;
    recasts: Array<{ fid: number }>;
  };
  replies: { count: number };
  viewer_context?: { liked: boolean; recasted: boolean };
  mentioned_profiles?: NeynarUser[];
  direct_replies?: NeynarCast[];
  /** Present whenever this cast was posted into a channel · null/absent otherwise. */
  channel?: { id: string; name: string; image_url?: string } | null;
};

export type NeynarFrame = {
  version?: string;
  image?: string;
  frames_url: string;
  name?: string;
  subtitle?: string;
  author?: NeynarUser;
};

// Real Neynar v2 notification types (verified against live API):
//   follows | likes | recasts | reply | mention | quote
export type NeynarNotification = {
  type: "follows" | "likes" | "recasts" | "reply" | "mention" | "quote";
  // `cast` is the target cast for likes/recasts/reply/mention/quote.
  cast?: NeynarCast;
  // For likes/recasts · each entry is a single reactor.
  reactions?: Array<{ object: "likes" | "recasts"; cast?: NeynarCast; user: NeynarUser }>;
  follows?: Array<{ user: NeynarUser }>;
  timestamp?: string;
  most_recent_timestamp?: string;
};

export type NeynarSigner = {
  signer_uuid: string;
  public_key: string;
  status: "generated" | "pending_approval" | "approved" | "revoked";
  signer_approval_url?: string;
};

function headers(key: string) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    api_key: key,
  };
}

/** Uncached direct-passthrough proxy · used by high-volume paginated bulk
 *  scans (Purge/Cleanup) where every page is a unique cursor anyway, so the
 *  normal cached proxy's caching would be pointless. The server rotates
 *  through every Neynar key it has configured (env vars only — see
 *  server/neynar-limit.ts) to spread load; no key of any kind is ever sent
 *  from or handled by the browser. */
export async function directNeynarGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/fc-direct${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string; message?: string }).error ?? (err as { message?: string }).message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function neynar<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  key: string,
  body?: unknown
): Promise<T> {
  // ── GET: always through the server proxy (cached, rate-limited, key stays server-side)
  if (method === "GET") {
    const res = await fetch(`${PROXY_BASE}${path}`, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json")) {
      // Non-JSON means the proxy/server is not running (e.g. a CDN 404 page).
      throw new Error("API server unavailable. Please check your connection.");
    }
    if (res.ok) return res.json() as Promise<T>;
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string; message?: string }).error ??
      (err as { message?: string }).message ?? `HTTP ${res.status}`
    );
  }

  // ── POST / DELETE: legacy managed-signer write path · goes directly to Neynar
  // with the user's own key (stored in localStorage). Retries on 429.
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${NEYNAR_BASE}${path}`, {
      method,
      headers: headers(key),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (res.status === 429 && attempt < 2) {
      const retryAfter = res.headers.get("Retry-After");
      const waitMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 10_000)
        : (2 ** attempt) * 1000 + Math.random() * 500;
      await new Promise(r => setTimeout(r, waitMs));
      continue;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `HTTP ${res.status}`);
    }
    return res.json() as Promise<T>;
  }
  throw new Error("Neynar rate limit exceeded. Please try again in a moment.");
}

export async function getHomeFeed(
  fid: number,
  key: string,
  cursor?: string
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({ feed_type: "home", fid: String(fid), limit: "25", viewer_fid: String(fid) });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/feed?${q}`, "GET", key);
}

// In-memory cache for trending feed · avoids hammering rate limit (6 req/60s on PUBLIC_TRIAL)
const _trendingCache: Map<string, { ts: number; data: { casts: NeynarCast[]; next?: { cursor: string } } }> = new Map();
const TRENDING_TTL_MS = 60_000; // 60 seconds

export async function getTrendingFeed(
  fid: number,
  key: string,
  cursor?: string,
  timeWindow?: "1h" | "6h" | "12h" | "24h"
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const tw = timeWindow ?? "";
  const cacheKey = `${fid}:${cursor ?? ""}:${tw}`;
  const cached = _trendingCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < TRENDING_TTL_MS) return cached.data;
  // trending endpoint max limit is 10 on all plans
  const q = new URLSearchParams({ limit: "10", viewer_fid: String(fid) });
  if (cursor) q.set("cursor", cursor);
  if (tw) q.set("time_window", tw);
  const data = await neynar(`/farcaster/feed/trending?${q}`, "GET", key) as { casts: NeynarCast[]; next?: { cursor: string } };
  _trendingCache.set(cacheKey, { ts: Date.now(), data });
  return data;
}

export async function getFollowingFeed(
  fid: number,
  key: string,
  cursor?: string
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({
    feed_type: "following",
    fid: String(fid),
    limit: "25",
    viewer_fid: String(fid),
  });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/feed?${q}`, "GET", key);
}

/** Feed made up of casts from a specific set of accounts · powers Custom Feeds. */
export async function getFeedByFids(
  fids: number[],
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({
    feed_type: "filter",
    filter_type: "fids",
    fids: fids.join(","),
    limit: "25",
    viewer_fid: String(viewerFid),
  });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/feed?${q}`, "GET", key);
}

export async function publishCast(
  signerUuid: string,
  text: string,
  key: string,
  options?: { parentHash?: string; embeds?: string[] }
): Promise<{ cast: NeynarCast }> {
  const body: Record<string, unknown> = { signer_uuid: signerUuid, text };
  if (options?.parentHash) body.parent = options.parentHash;
  if (options?.embeds?.length)
    body.embeds = options.embeds.map((url) => ({ url }));
  return neynar("/farcaster/cast", "POST", key, body);
}

export async function deleteCast(
  signerUuid: string,
  hash: string,
  key: string
): Promise<void> {
  await neynar("/farcaster/cast", "DELETE", key, {
    signer_uuid: signerUuid,
    target_hash: hash,
  });
}

export async function reactToCast(
  signerUuid: string,
  castHash: string,
  type: "like" | "recast",
  key: string
): Promise<void> {
  await neynar("/farcaster/reaction", "POST", key, {
    signer_uuid: signerUuid,
    reaction_type: type,
    target: castHash,
  });
}

export async function unreactToCast(
  signerUuid: string,
  castHash: string,
  type: "like" | "recast",
  key: string
): Promise<void> {
  await neynar("/farcaster/reaction", "DELETE", key, {
    signer_uuid: signerUuid,
    reaction_type: type,
    target: castHash,
  });
}

export async function followUser(
  signerUuid: string,
  targetFid: number,
  key: string
): Promise<void> {
  await neynar("/farcaster/follows/v2", "POST", key, {
    signer_uuid: signerUuid,
    target_fids: [targetFid],
  });
}

export async function unfollowUser(
  signerUuid: string,
  targetFid: number,
  key: string
): Promise<void> {
  await neynar("/farcaster/follows/v2", "DELETE", key, {
    signer_uuid: signerUuid,
    target_fids: [targetFid],
  });
}

export async function getNotifications(
  fid: number,
  key: string,
  cursor?: string
): Promise<{ notifications: NeynarNotification[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({ fid: String(fid), limit: "25", priority_mode: "false" });
  if (cursor) q.set("cursor", cursor);
  // Try server-side cached proxy first; fall back to direct Neynar on failure
  try {
    const res = await fetch(`/api/farcaster/notifications?${q}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && ct.includes("application/json")) return res.json();
  } catch { /* fall through */ }
  return neynar(`/farcaster/notifications?${q}`, "GET", key);
}

export async function searchUsers(
  q: string,
  viewerFid: number,
  key: string
): Promise<{ result: { users: NeynarUser[] } }> {
  const params = new URLSearchParams({ q, viewer_fid: String(viewerFid), limit: "10" });
  return neynar(`/farcaster/user/search?${params}`, "GET", key);
}

export async function searchCasts(
  q: string,
  viewerFid: number,
  key: string,
  cursor?: string,
  authorFid?: number,
): Promise<{ result: { casts: NeynarCast[]; next?: { cursor?: string } } }> {
  const params = new URLSearchParams({ q, viewer_fid: String(viewerFid), limit: "25" });
  if (cursor) params.set("cursor", cursor);
  if (authorFid) params.set("author_fid", String(authorFid));
  return neynar(`/farcaster/cast/search?${params}`, "GET", key);
}

export type NeynarChannel = {
  id: string;
  url: string;
  name: string;
  description?: string;
  image_url?: string;
  header_image_url?: string;
  follower_count: number;
  member_count?: number;
  lead?: NeynarUser;
};

export async function searchChannels(q: string, key: string): Promise<{ channels: NeynarChannel[] }> {
  const params = new URLSearchParams({ q, limit: "20" });
  return neynar(`/farcaster/channel/search?${params}`, "GET", key);
}

export async function getChannel(id: string, key: string): Promise<{ channel: NeynarChannel }> {
  const params = new URLSearchParams({ id });
  return neynar(`/farcaster/channel?${params}`, "GET", key);
}

export async function getChannelFeed(
  id: string,
  viewerFid: number,
  key: string,
  cursor?: string,
): Promise<{ casts: NeynarCast[]; next?: { cursor?: string } }> {
  const params = new URLSearchParams({ channel_ids: id, viewer_fid: String(viewerFid), limit: "20", with_recasts: "true" });
  if (cursor) params.set("cursor", cursor);
  return neynar(`/farcaster/feed/channels?${params}`, "GET", key);
}

export async function getUserCasts(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string,
  limit = 20,
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({ fid: String(fid), limit: String(limit), viewer_fid: String(viewerFid), include_replies: "false" });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/feed/user/casts?${q}`, "GET", key);
}

export async function getUserByFid(
  fid: number,
  viewerFid: number,
  key: string
): Promise<{ users: NeynarUser[] }> {
  const params = new URLSearchParams({ fids: String(fid), viewer_fid: String(viewerFid) });
  return neynar(`/farcaster/user/bulk?${params}`, "GET", key);
}

/** Fetch basic user profile from Hub (hub.pinata.cloud) · no Neynar API key needed.
 *  Returns name/pfp/bio but NOT follower counts or viewer_context.
 *  Use for display-only contexts where counts aren't needed. */
export async function getUserByFidFromHub(fid: number): Promise<NeynarUser | null> {
  try {
    const res = await fetch(`${HUB_PROXY_BASE}/user/${fid}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { users?: NeynarUser[] };
    return data.users?.[0] ?? null;
  } catch {
    return null;
  }
}

export async function createNeynarSigner(key: string): Promise<NeynarSigner> {
  return neynar("/farcaster/signer", "POST", key);
}

export async function getSignerStatus(
  signerUuid: string,
  key: string
): Promise<NeynarSigner> {
  return neynar(`/farcaster/signer?signer_uuid=${signerUuid}`, "GET", key);
}

export async function getFrameCatalog(
  key: string,
  cursor?: string
): Promise<{ frames: NeynarFrame[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({ limit: "24" });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/frame/catalog?${q}`, "GET", key);
}

export async function getCastReactions(
  hash: string,
  type: "likes" | "recasts",
  key: string,
  cursor?: string
): Promise<{ reactions: Array<{ user: NeynarUser }>; next?: { cursor: string } }> {
  const q = new URLSearchParams({ hash, types: type, limit: "25" });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/reactions/cast?${q}`, "GET", key);
}

export async function getUserLikes(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string,
  fast?: boolean
): Promise<{ reactions: Array<{ cast: NeynarCast }>; next?: { cursor: string } }> {
  const limit = fast ? "100" : "50";
  const q = new URLSearchParams({ fid: String(fid), type: "likes", limit, viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  if (fast) return directNeynarGet(`/farcaster/reactions/user?${q}`);
  return neynar(`/farcaster/reactions/user?${q}`, "GET", key);
}

export async function getUserRecasts(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string,
  fast?: boolean
): Promise<{ reactions: Array<{ cast: NeynarCast }>; next?: { cursor: string } }> {
  const limit = fast ? "100" : "50";
  const q = new URLSearchParams({ fid: String(fid), type: "recasts", limit, viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  if (fast) return directNeynarGet(`/farcaster/reactions/user?${q}`);
  return neynar(`/farcaster/reactions/user?${q}`, "GET", key);
}

export async function getUserReplies(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string,
  fast?: boolean
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const limit = fast ? "150" : "50";
  const q = new URLSearchParams({ fid: String(fid), limit, viewer_fid: String(viewerFid), include_replies: "true" });
  if (cursor) q.set("cursor", cursor);
  let result: { casts: NeynarCast[]; next?: { cursor: string } };
  if (fast) {
    result = await directNeynarGet<{ casts: NeynarCast[]; next?: { cursor: string } }>(`/farcaster/feed/user/casts?${q}`);
  } else {
    result = await neynar<{ casts: NeynarCast[]; next?: { cursor: string } }>(`/farcaster/feed/user/casts?${q}`, "GET", key);
  }
  result.casts = result.casts.filter((c) => c.parent_hash != null);
  return result;
}

export async function getFollowers(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ users: Array<{ user: NeynarUser }>; next?: { cursor: string } }> {
  // Server proxy: 100% Hub · FIDs + profiles, zero Neynar calls, no rate limit
  const q = new URLSearchParams({ fid: String(fid), viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  try {
    const res = await fetch(`/api/farcaster/followers?${q}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && ct.includes("application/json")) return res.json();
  } catch { /* fall through */ }
  // Fallback: direct Neynar (only if server unavailable)
  const qd = new URLSearchParams({ fid: String(fid), limit: "50", viewer_fid: String(viewerFid) });
  if (cursor) qd.set("cursor", cursor);
  return neynar(`/farcaster/followers?${qd}`, "GET", key);
}

/**
 * Raw follow-graph page from free hubs via the server (zero Neynar credits).
 * Returns bare FIDs, newest first, ~1000–2000 per page. Profiles are NOT
 * included · hydrate lazily via /user/bulk (SQLite-cached) where needed.
 */
export async function getFollowListFids(
  fid: number,
  type: "followers" | "following",
  cursor?: string,
): Promise<{ fids: number[]; nextCursor?: string }> {
  const q = new URLSearchParams({ fid: String(fid), type });
  if (cursor) q.set("cursor", cursor);
  const res = await fetch(`/api/farcaster/link-fids?${q}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!res.ok || !ct.includes("application/json")) throw new Error(`link-fids HTTP ${res.status}`);
  return res.json();
}

/**
 * Bulk-check which of the given target FIDs the viewer currently follows.
 * Uses Neynar /farcaster/user/bulk with viewer_fid · up to 100 FIDs per call.
 * Returns a Set of FIDs that the viewer follows.
 */
export async function checkFollowStatusBulk(
  viewerFid: number,
  targetFids: number[],
  key: string,
): Promise<Set<number>> {
  const followed = new Set<number>();
  for (let i = 0; i < targetFids.length; i += 100) {
    const batch = targetFids.slice(i, i + 100);
    try {
      const params = new URLSearchParams({ fids: batch.join(","), viewer_fid: String(viewerFid) });
      const data = await neynar(`/farcaster/user/bulk?${params}`, "GET", key) as { users?: NeynarUser[] };
      for (const u of data.users ?? []) {
        if (u.viewer_context?.following) followed.add(u.fid);
      }
    } catch { /* skip batch on error · will be handled by DUPLICATE detection at runtime */ }
    if (i + 100 < targetFids.length) await new Promise(r => setTimeout(r, 150));
  }
  return followed;
}

export async function getFollowing(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ users: Array<{ user: NeynarUser }>; next?: { cursor: string } }> {
  // Server proxy: 100% Hub · FIDs + profiles, zero Neynar calls, no rate limit
  const q = new URLSearchParams({ fid: String(fid), viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  try {
    const res = await fetch(`/api/farcaster/following?${q}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (res.ok && ct.includes("application/json")) return res.json();
  } catch { /* fall through */ }
  // Fallback: direct Neynar (only if server unavailable)
  const qd = new URLSearchParams({ fid: String(fid), limit: "50", viewer_fid: String(viewerFid) });
  if (cursor) qd.set("cursor", cursor);
  return neynar(`/farcaster/following?${qd}`, "GET", key);
}

export async function getCastConversation(
  hash: string,
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ conversation: { cast: NeynarCast }; next?: { cursor: string } }> {
  const q = new URLSearchParams({
    identifier: hash,
    type: "hash",
    reply_depth: "3",
    limit: "50",
    viewer_fid: String(viewerFid),
  });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/cast/conversation?${q}`, "GET", key);
}

export async function approveSignerWithSignature(
  signerUuid: string,
  appFid: number,
  deadline: number,
  signature: string,
  key: string
): Promise<NeynarSigner> {
  return neynar("/farcaster/signer/signed_key", "POST", key, {
    signer_uuid: signerUuid,
    app_fid: appFid,
    deadline,
    signature,
  });
}
