export type Cast = {
  hash: string;
  fid: number;
  author: {
    fid: number;
    username: string;
    displayName: string;
    pfpUrl: string;
  };
  text: string;
  timestamp: number;
  likesCount: number;
  recastsCount: number;
  repliesCount: number;
  embeds: string[];
};

export type FeedResult = {
  casts: Cast[];
  nextPageToken?: string;
  hasMore: boolean;
};

export type FarcasterProfile = {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  custodyAddress: string;
};

const FNAMES_API = "https://fnames.farcaster.xyz";
const NEYNAR_BASE = "https://api.neynar.com/v2";
// All reads go through the Express proxy (server's 300-RPM key + cache), never
// the browser's weak demo key. See src/lib/neynar.ts for the full rationale.
const PROXY_BASE = "/api/fc";

function neynarKey(): string {
  try { return localStorage.getItem("fc_neynar_key") || "NEYNAR_API_DOCS"; } catch { return "NEYNAR_API_DOCS"; }
}

export type ReactionCounts = {
  likesCount: number;
  recastsCount: number;
  repliesCount: number;
  viewerLiked?: boolean;
  viewerRecasted?: boolean;
};

/**
 * Batch-fetch reaction counts for up to 150 cast hashes via Neynar's bulk-cast
 * endpoint. Returns a Map keyed by cast hash (lowercase hex, no 0x prefix).
 * Falls back to empty map on any error so callers can use 0 gracefully.
 */
export async function fetchReactionCounts(
  hashes: string[],
  viewerFid?: number
): Promise<Map<string, ReactionCounts>> {
  if (hashes.length === 0) return new Map();
  const result = new Map<string, ReactionCounts>();
  try {
    const CHUNK = 150;
    for (let i = 0; i < hashes.length; i += CHUNK) {
      const chunk = hashes.slice(i, i + CHUNK);
      const params = new URLSearchParams({ hashes: chunk.join(",") });
      if (viewerFid) params.set("viewer_fid", String(viewerFid));
      const res = await fetch(`${PROXY_BASE}/farcaster/casts?${params}`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const casts: Array<{
        hash?: string;
        reactions?: {
          likes_count?: number;
          recasts_count?: number;
          likes?: Array<{ fid: number }>;
          recasts?: Array<{ fid: number }>;
        };
        replies?: { count?: number };
        viewer_context?: { liked?: boolean; recasted?: boolean };
      }> = data?.result?.casts ?? data?.casts ?? [];
      for (const c of casts) {
        if (!c.hash) continue;
        // Normalize to lowercase so lookups are case-insensitive
        result.set(c.hash.toLowerCase(), {
          likesCount: c.reactions?.likes_count ?? c.reactions?.likes?.length ?? 0,
          recastsCount: c.reactions?.recasts_count ?? c.reactions?.recasts?.length ?? 0,
          repliesCount: c.replies?.count ?? 0,
          viewerLiked: c.viewer_context?.liked,
          viewerRecasted: c.viewer_context?.recasted,
        });
      }
    }
  } catch {
    // best-effort; callers render 0 gracefully
  }
  return result;
}

/** Fetch current fname from fnames.farcaster.xyz for a given FID */
async function fetchFnameForFid(fidNum: number): Promise<string | null> {
  try {
    const r = await fetch(`https://fnames.farcaster.xyz/transfers/current?fid=${fidNum}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const name: string = d?.transfer?.username ?? d?.username ?? "";
    return name || null;
  } catch {
    return null;
  }
}

export async function fetchProfile(fid: bigint): Promise<FarcasterProfile> {
  const fidNum = Number(fid);
  try {
    const params = new URLSearchParams({ fids: String(fidNum), viewer_fid: String(fidNum) });
    const res = await fetch(`${PROXY_BASE}/farcaster/user/bulk?${params}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const user = (data?.users ?? [])[0];
    if (!user) throw new Error("No user data");

    // Neynar may cache stale usernames (returns "!{fid}", empty, or digits-only
    // after a username change). Always check the authoritative fname server.
    let username: string = user.username ?? "";
    const looksInvalid = !username || username.startsWith("!") || /^\d+$/.test(username);
    if (looksInvalid) {
      const fname = await fetchFnameForFid(fidNum);
      if (fname) username = fname;
    }

    return {
      fid: fidNum,
      username: username || `!${fidNum}`,
      displayName: user.display_name ?? "",
      pfpUrl: user.pfp_url ?? "",
      bio: user.profile?.bio?.text ?? "",
      followerCount: user.follower_count ?? 0,
      followingCount: user.following_count ?? 0,
      custodyAddress: user.custody_address ?? "",
    };
  } catch {
    // Full fallback: try fname server at least for the username
    const fname = await fetchFnameForFid(fidNum);
    return {
      fid: fidNum,
      username: fname ?? `!${fidNum}`,
      displayName: `FID ${fidNum}`,
      pfpUrl: "",
      bio: "",
      followerCount: 0,
      followingCount: 0,
      custodyAddress: "",
    };
  }
}

export async function checkFnameAvailability(
  name: string
): Promise<{ available: boolean; owner?: number }> {
  try {
    const res = await fetch(
      `${FNAMES_API}/transfers?name=${encodeURIComponent(name)}`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return { available: true };
    const data = await res.json();
    const transfers: Array<{ to: number }> = data?.transfers ?? [];
    if (transfers.length === 0) return { available: true };
    const last = transfers[transfers.length - 1];
    if (last.to === 0) return { available: true };
    return { available: false, owner: last.to };
  } catch {
    return { available: true };
  }
}

export async function transferFname(params: {
  name: string;
  from: number;
  to: number;
  fid: number;
  owner: `0x${string}`;
  timestamp: number;
  signature: `0x${string}`;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`${FNAMES_API}/transfers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (err as { error?: string })?.error ?? `HTTP ${res.status}`,
      };
    }
    return { success: true };
  } catch (e: unknown) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Network error",
    };
  }
}

export const FNAME_EIP712_DOMAIN = {
  name: "Farcaster name verification",
  version: "1",
  chainId: 1,
  verifyingContract: "0xe3Be01D99bAa8dB9905b33a3cA391238234B79D1",
} as const;

export const FNAME_EIP712_TYPES = {
  UserNameProof: [
    { name: "name", type: "string" },
    { name: "timestamp", type: "uint256" },
    { name: "owner", type: "address" },
  ],
} as const;

export type MiniApp = {
  id: string;
  name: string;
  description: string;
  iconUrl: string;
  url: string;
  category: string;
};

// Real Farcaster Mini Apps (built with the Farcaster Mini Apps SDK).
// These are native apps that run inside Farcaster clients.
export const CURATED_MINI_APPS: MiniApp[] = [
  {
    id: "yoink",
    name: "Yoink",
    description: "Multiplayer flag-capture game on Farcaster",
    iconUrl: "https://yoink.party/favicon.ico",
    url: "https://yoink.party/framesv2/",
    category: "Games",
  },
  {
    id: "moxie",
    name: "Moxie",
    description: "Creator economy — earn rewards from your fans",
    iconUrl: "https://moxie.xyz/favicon.ico",
    url: "https://moxie.xyz",
    category: "Creator",
  },
  {
    id: "clanker",
    name: "Clanker",
    description: "Launch your own token on Base in one cast",
    iconUrl: "https://clanker.world/favicon.ico",
    url: "https://clanker.world",
    category: "DeFi",
  },
  {
    id: "paragraph",
    name: "Paragraph",
    description: "Web3 newsletters and long-form publishing",
    iconUrl: "https://paragraph.xyz/favicon.ico",
    url: "https://paragraph.xyz",
    category: "Creator",
  },
  {
    id: "stack",
    name: "Stack",
    description: "Onchain points and reputation for communities",
    iconUrl: "https://www.stack.so/favicon.ico",
    url: "https://www.stack.so",
    category: "Social",
  },
  {
    id: "rodeo",
    name: "Rodeo",
    description: "Creator social platform built on Farcaster",
    iconUrl: "https://rodeo.club/favicon.ico",
    url: "https://rodeo.club",
    category: "Creator",
  },
  {
    id: "farquest",
    name: "Far.quest",
    description: "Farcaster profile explorer and social scores",
    iconUrl: "https://far.quest/favicon.ico",
    url: "https://far.quest",
    category: "Tools",
  },
  {
    id: "bountycaster",
    name: "Bountycaster",
    description: "Post and complete onchain bounties via casts",
    iconUrl: "https://www.bountycaster.xyz/favicon.ico",
    url: "https://www.bountycaster.xyz",
    category: "Work",
  },
  {
    id: "payflow",
    name: "Payflow",
    description: "Send crypto payments directly in Farcaster",
    iconUrl: "https://payflow.me/favicon.ico",
    url: "https://payflow.me",
    category: "DeFi",
  },
  {
    id: "nounspace",
    name: "Nounspace",
    description: "Customizable Farcaster social profiles and spaces",
    iconUrl: "https://nounspace.com/favicon.ico",
    url: "https://nounspace.com",
    category: "Social",
  },
  {
    id: "supercast",
    name: "Supercast",
    description: "Power-user Farcaster client with advanced features",
    iconUrl: "https://supercast.xyz/favicon.ico",
    url: "https://supercast.xyz",
    category: "Social",
  },
  {
    id: "openrank",
    name: "OpenRank",
    description: "Farcaster social graph rankings and analytics",
    iconUrl: "https://openrank.com/favicon.ico",
    url: "https://openrank.com",
    category: "Tools",
  },
  {
    id: "pods",
    name: "Pods",
    description: "Group conversations and audio rooms on Farcaster",
    iconUrl: "https://pods.media/favicon.ico",
    url: "https://pods.media",
    category: "Social",
  },
  {
    id: "banger",
    name: "Banger",
    description: "Schedule and boost casts for maximum reach",
    iconUrl: "https://banger.fun/favicon.ico",
    url: "https://banger.fun",
    category: "Tools",
  },
  {
    id: "jam",
    name: "Jam",
    description: "Co-create content and collaborate with others",
    iconUrl: "https://jam.so/favicon.ico",
    url: "https://jam.so",
    category: "Creator",
  },
  {
    id: "degen",
    name: "Degen",
    description: "The Farcaster community tip token",
    iconUrl: "https://www.degen.tips/favicon.ico",
    url: "https://www.degen.tips",
    category: "DeFi",
  },
];

function normalizeMiniAppUrl(url: string): string {
  // Strip query params from farcaster.xyz/miniapps/* URLs so we deduplicate properly
  if (url.includes("farcaster.xyz/miniapps/")) {
    return url.split("?")[0];
  }
  // For other URLs keep as-is but strip trailing slash
  return url.replace(/\/$/, "");
}

function categoryFromUrl(url: string): string {
  if (url.includes("game") || url.includes("play") || url.includes("jump") ||
      url.includes("fishing") || url.includes("lottery") || url.includes("dino") ||
      url.includes("rider") || url.includes("crazy") || url.includes("catcher"))
    return "Games";
  if (url.includes("defi") || url.includes("swap") || url.includes("token") ||
      url.includes("earn") || url.includes("pay") || url.includes("coin") ||
      url.includes("degen") || url.includes("moxie") || url.includes("aura") ||
      url.includes("clanker") || url.includes("megapot"))
    return "DeFi";
  if (url.includes("paragraph") || url.includes("blog") || url.includes("write") ||
      url.includes("publish") || url.includes("daily"))
    return "Creator";
  return "App";
}

/**
 * Fetch mini-apps (Farcaster Frames/mini-apps).
 *
 * Source priority:
 *  1. Warpcast client API — `client.warpcast.com/v2/discover-frames` (official)
 *  2. Warpcast client API — `client.warpcast.com/v2/featured-frames` (fallback endpoint)
 *  3. Neynar "frames" channel feed — surfaces community-shared mini apps
 *  4. Curated static list — always-available offline fallback
 */
export async function fetchMiniApps(): Promise<MiniApp[]> {
  // ── 1: Server-proxied Warpcast discovery (avoids browser CORS) ──────────
  const warpcastEndpoints = [
    "/api/warpcast/discover-frames",
  ];

  for (const endpoint of warpcastEndpoints) {
    try {
      const res = await fetch(endpoint, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;

      const data = await res.json();
      // Farcaster returns frames/apps in various shapes; normalise the common ones
      type WarpFrame = { name?: string; title?: string; url?: string; homeUrl?: string; imageUrl?: string; description?: string };
      const items: WarpFrame[] =
        data?.frames ?? data?.featuredFrames ?? data?.discoverFrames ?? data?.result?.frames ?? [];

      const apps: MiniApp[] = items
        .filter((f) => (f.url ?? f.homeUrl) && (f.name ?? f.title))
        .map((f) => {
          const url = normalizeMiniAppUrl(f.url ?? f.homeUrl ?? "");
          return {
            id: url,
            name: (f.name ?? f.title ?? "").slice(0, 40),
            description: (f.description ?? "").slice(0, 120),
            iconUrl: f.imageUrl ?? "",
            url,
            category: categoryFromUrl(url.toLowerCase()),
          };
        })
        .filter((a) => a.url);

      if (apps.length >= 3) return apps;
    } catch {
      // try next endpoint
    }
  }

  // ── 3: Neynar "frames" channel feed (community-shared mini apps) ────────
  try {
    const res = await fetch(
      `${PROXY_BASE}/farcaster/feed/channels?channel_ids=frames&limit=50&with_recasts=false&with_replies=false`,
      {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(6000),
      }
    );
    if (!res.ok) throw new Error("non-ok");

    const data = await res.json();
    const casts: Array<{
      embeds?: Array<{
        url?: string;
        metadata?: {
          html?: {
            ogTitle?: string;
            ogDescription?: string;
            ogImage?: Array<{ url?: string }> | string;
          };
        };
      }>;
    }> = data?.casts ?? [];

    const seen = new Set<string>();
    const official: MiniApp[] = [];
    const other: MiniApp[] = [];

    for (const cast of casts) {
      for (const embed of cast.embeds ?? []) {
        const rawUrl = embed.url ?? "";
        if (!rawUrl) continue;
        if (rawUrl.includes("neynar.app")) continue;
        if (rawUrl.includes("twitter.com") || rawUrl.includes("x.com")) continue;
        if (rawUrl.includes("imagedelivery.net")) continue;

        const html = embed.metadata?.html ?? {};
        const title = html.ogTitle ?? "";
        if (!title) continue;

        const normalized = normalizeMiniAppUrl(rawUrl);
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const desc = html.ogDescription ?? "";
        const imgs = html.ogImage;
        const iconUrl =
          Array.isArray(imgs) && imgs.length > 0
            ? (imgs[0].url ?? "")
            : typeof imgs === "string"
            ? imgs
            : "";

        const app: MiniApp = {
          id: normalized,
          name: title,
          description: desc,
          iconUrl,
          url: normalized,
          category: categoryFromUrl(normalized.toLowerCase()),
        };

        if (normalized.includes("farcaster.xyz/miniapps/")) {
          official.push(app);
        } else {
          other.push(app);
        }
      }
    }

    const merged = [...official, ...other];
    if (merged.length >= 4) return merged;
  } catch {
    // fall through to curated list
  }

  // ── 4: Curated static fallback ──────────────────────────────────────────
  return CURATED_MINI_APPS;
}

// ─── Feed & Cast APIs ──────────────────────────────────────────────────────

const HUB_API = "https://nemes.farcaster.xyz:2281";
const FARCASTER_EPOCH = 1609459200; // seconds since Jan 1, 2021 UTC

function hubTsToUnixMs(ts: number): number {
  return (ts + FARCASTER_EPOCH) * 1000;
}

type HubMessage = {
  data?: {
    type?: string;
    fid?: number;
    timestamp?: number;
    castAddBody?: {
      text?: string;
      embeds?: Array<{ url?: string }>;
    };
    reactionBody?: { type?: string };
    linkBody?: { type?: string; targetFid?: number };
  };
  hash?: string;
};

type ProfileCache = Map<number, { username: string; displayName: string; pfpUrl: string }>;
const _profileCache: ProfileCache = new Map();

async function resolveAuthors(
  fids: number[]
): Promise<ProfileCache> {
  const unique = [...new Set(fids)].filter((f) => !_profileCache.has(f));
  await Promise.allSettled(
    unique.map(async (fid) => {
      try {
        const p = await fetchProfile(BigInt(fid));
        _profileCache.set(fid, {
          username: p.username,
          displayName: p.displayName,
          pfpUrl: p.pfpUrl,
        });
      } catch {
        _profileCache.set(fid, { username: `!${fid}`, displayName: `FID ${fid}`, pfpUrl: "" });
      }
    })
  );
  return _profileCache;
}

function hubMsgToCast(msg: HubMessage, cache: ProfileCache): Cast | null {
  const body = msg.data?.castAddBody;
  if (!body) return null;
  const fid = msg.data?.fid ?? 0;
  const info = cache.get(fid) ?? { username: `!${fid}`, displayName: `FID ${fid}`, pfpUrl: "" };
  return {
    hash: msg.hash ?? "",
    fid,
    author: { fid, ...info },
    text: body.text ?? "",
    timestamp: hubTsToUnixMs(msg.data?.timestamp ?? 0),
    likesCount: 0,
    recastsCount: 0,
    repliesCount: 0,
    embeds: (body.embeds ?? []).map((e) => e.url ?? "").filter(Boolean),
  };
}

export async function fetchCastsByFid(
  fid: number,
  pageToken?: string,
  pageSize = 25,
  viewerFid?: number
): Promise<FeedResult> {
  const params = new URLSearchParams({
    fid: String(fid),
    pageSize: String(pageSize),
    reverse: "1",
  });
  if (pageToken) params.set("pageToken", pageToken);

  try {
    const res = await fetch(`${HUB_API}/v1/castsByFid?${params}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Hub ${res.status}`);
    const data = await res.json();
    const messages: HubMessage[] = data?.messages ?? [];
    const castMsgs = messages.filter((m) => m.data?.type === "MESSAGE_TYPE_CAST_ADD");
    const fids = castMsgs.map((m) => m.data?.fid ?? 0).filter(Boolean);
    const cache = await resolveAuthors(fids);
    const casts = castMsgs.map((m) => hubMsgToCast(m, cache)).filter((c): c is Cast => c !== null);

    // Enrich with real reaction counts from Neynar
    const hashes = casts.map((c) => c.hash).filter(Boolean);
    const counts = await fetchReactionCounts(hashes, viewerFid ?? fid);
    for (const cast of casts) {
      const rc = counts.get(cast.hash.toLowerCase());
      if (rc) {
        cast.likesCount = rc.likesCount;
        cast.recastsCount = rc.recastsCount;
        cast.repliesCount = rc.repliesCount;
      }
    }

    const nextToken = data?.nextPageToken;
    return { casts, nextPageToken: nextToken || undefined, hasMore: !!nextToken };
  } catch {
    return { casts: [], hasMore: false };
  }
}

export async function fetchFollowingFeed(
  fid: number,
  pageToken?: string
): Promise<FeedResult> {
  // Get following list
  let followedFids: number[] = [];
  try {
    const linksRes = await fetch(
      `${HUB_API}/v1/linksByFid?fid=${fid}&linkType=follow&pageSize=100`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (linksRes.ok) {
      const linksData = await linksRes.json();
      const messages: HubMessage[] = linksData?.messages ?? [];
      followedFids = messages
        .filter((m) => m.data?.linkBody?.type === "follow")
        .map((m) => m.data?.linkBody?.targetFid ?? 0)
        .filter(Boolean);
    }
  } catch {
    // ignore; fall through to own casts
  }

  if (followedFids.length === 0) {
    return fetchCastsByFid(fid, pageToken);
  }

  // Pagination offset encoded in pageToken for multi-source feed
  const offset = pageToken ? parseInt(pageToken, 10) : 0;
  const PAGE_SIZE = 25;
  const fidSlice = followedFids.slice(offset, offset + 20);

  const castBatches = await Promise.allSettled(
    fidSlice.map((f) =>
      fetch(`${HUB_API}/v1/castsByFid?fid=${f}&pageSize=5&reverse=1`, {
        signal: AbortSignal.timeout(6000),
      })
        .then((r) => (r.ok ? r.json() : { messages: [] }))
        .then((d) => (d?.messages ?? []) as HubMessage[])
        .catch(() => [] as HubMessage[])
    )
  );

  const allMsgs: HubMessage[] = castBatches.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );
  const castMsgs = allMsgs.filter((m) => m.data?.type === "MESSAGE_TYPE_CAST_ADD");

  const authorFids = castMsgs.map((m) => m.data?.fid ?? 0).filter(Boolean);
  const cache = await resolveAuthors(authorFids);

  const casts = castMsgs
    .map((m) => hubMsgToCast(m, cache))
    .filter((c): c is Cast => c !== null)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, PAGE_SIZE);

  // Enrich with real reaction counts from Neynar
  const hashes = casts.map((c) => c.hash).filter(Boolean);
  const counts = await fetchReactionCounts(hashes, fid);
  for (const cast of casts) {
    const rc = counts.get(cast.hash.toLowerCase());
    if (rc) {
      cast.likesCount = rc.likesCount;
      cast.recastsCount = rc.recastsCount;
      cast.repliesCount = rc.repliesCount;
    }
  }

  const nextOffset = offset + 20;
  const hasMore = nextOffset < followedFids.length;
  return {
    casts,
    nextPageToken: hasMore ? String(nextOffset) : undefined,
    hasMore,
  };
}

export async function submitCastToHub(_params: {
  text: string;
  fid: number;
}): Promise<{ success: boolean; error?: string }> {
  return {
    success: false,
    error: "signer_required",
  };
}
