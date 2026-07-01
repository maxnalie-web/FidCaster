export const NEYNAR_BASE = "https://api.neynar.com/v2";
// Read proxy base — all GET reads go through the Express server (cached, no client key needed)
const PROXY_BASE = "/api/fc";
// Hub proxy base — direct Hub reads (free, no rate limit)
export const HUB_PROXY_BASE = "/api/hub";
// Runtime key — only needed for write operations (signers, etc.)
export const DEFAULT_API_KEY: string = (() => {
  try { return localStorage.getItem("fc_neynar_key") || "NEYNAR_API_DOCS"; } catch { return "NEYNAR_API_DOCS"; }
})();

export type NeynarUser = {
  fid: number;
  username: string;
  display_name: string;
  pfp_url: string;
  follower_count: number;
  following_count: number;
  power_badge?: boolean;   // Farcaster Power Badge — set by Warpcast, returned by Neynar
  profile?: { bio?: { text: string } };
  viewer_context?: { following: boolean; followed_by: boolean };
};

/** Returns true only if user has the Farcaster Power Badge (power_badge === true from Neynar) */
export function hasPowerBadge(user: NeynarUser): boolean {
  return user.power_badge === true;
}

export type NeynarEmbed = {
  url?: string;
  cast_id?: { hash: string; fid: number };
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
  // For likes/recasts — each entry is a single reactor.
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

async function neynar<T>(
  path: string,
  method: "GET" | "POST" | "DELETE",
  key: string,
  body?: unknown
): Promise<T> {
  // Reads ALWAYS go through our Express proxy (/api/fc): the server holds the
  // registered 300-RPM key and caches responses. The browser must never call
  // api.neynar.com directly for reads — the client's fallback key is the public
  // demo key (NEYNAR_API_DOCS = 6 req/60s = PUBLIC_TRIAL), which is the sole
  // source of the rate-limit errors. Routing through the server eliminates them.
  if (method === "GET") {
    let proxied: Response | null = null;
    try {
      proxied = await fetch(`${PROXY_BASE}${path}`, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      proxied = null; // server unreachable → fall through to direct as last resort
    }
    if (proxied) {
      if (proxied.ok) return proxied.json() as Promise<T>;
      const err = await proxied.json().catch(() => ({}));
      throw new Error(
        (err as { error?: string; message?: string }).error ??
        (err as { message?: string }).message ?? `HTTP ${proxied.status}`
      );
    }
  }

  const res = await fetch(`${NEYNAR_BASE}${path}`, {
    method,
    headers: headers(key),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ?? `HTTP ${res.status}`
    );
  }
  return res.json() as Promise<T>;
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

// In-memory cache for trending feed — avoids hammering rate limit (6 req/60s on PUBLIC_TRIAL)
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
    if (res.ok) return res.json();
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
  key: string
): Promise<{ result: { casts: NeynarCast[] } }> {
  const params = new URLSearchParams({ q, viewer_fid: String(viewerFid), limit: "25" });
  return neynar(`/farcaster/cast/search?${params}`, "GET", key);
}

export async function getUserCasts(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({ fid: String(fid), limit: "20", viewer_fid: String(viewerFid), include_replies: "false" });
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

/** Fetch basic user profile from Hub (hub.pinata.cloud) — no Neynar API key needed.
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
  cursor?: string
): Promise<{ reactions: Array<{ cast: NeynarCast }>; next?: { cursor: string } }> {
  const q = new URLSearchParams({ fid: String(fid), type: "likes", limit: "25", viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/reactions/user?${q}`, "GET", key);
}

export async function getUserRecasts(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ reactions: Array<{ cast: NeynarCast }>; next?: { cursor: string } }> {
  const q = new URLSearchParams({ fid: String(fid), type: "recasts", limit: "25", viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  return neynar(`/farcaster/reactions/user?${q}`, "GET", key);
}

export async function getUserReplies(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ casts: NeynarCast[]; next?: { cursor: string } }> {
  const q = new URLSearchParams({ fid: String(fid), limit: "25", viewer_fid: String(viewerFid), include_replies: "true" });
  if (cursor) q.set("cursor", cursor);
  const result = await neynar<{ casts: NeynarCast[]; next?: { cursor: string } }>(`/farcaster/feed/user/casts?${q}`, "GET", key);
  result.casts = result.casts.filter((c) => c.parent_hash != null);
  return result;
}

export async function getFollowers(
  fid: number,
  viewerFid: number,
  key: string,
  cursor?: string
): Promise<{ users: Array<{ user: NeynarUser }>; next?: { cursor: string } }> {
  // Server proxy: 100% Hub — FIDs + profiles, zero Neynar calls, no rate limit
  const q = new URLSearchParams({ fid: String(fid), viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  try {
    const res = await fetch(`/api/farcaster/followers?${q}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return res.json();
  } catch { /* fall through */ }
  // Fallback: direct Neynar (only if server unavailable)
  const qd = new URLSearchParams({ fid: String(fid), limit: "50", viewer_fid: String(viewerFid) });
  if (cursor) qd.set("cursor", cursor);
  return neynar(`/farcaster/followers?${qd}`, "GET", key);
}

/**
 * Bulk-check which of the given target FIDs the viewer currently follows.
 * Uses Neynar /farcaster/user/bulk with viewer_fid — up to 100 FIDs per call.
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
    } catch { /* skip batch on error — will be handled by DUPLICATE detection at runtime */ }
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
  // Server proxy: 100% Hub — FIDs + profiles, zero Neynar calls, no rate limit
  const q = new URLSearchParams({ fid: String(fid), viewer_fid: String(viewerFid) });
  if (cursor) q.set("cursor", cursor);
  try {
    const res = await fetch(`/api/farcaster/following?${q}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.ok) return res.json();
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
