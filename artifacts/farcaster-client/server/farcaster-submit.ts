import {
  makeCastAdd,
  makeCastRemove,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  makeUserDataAdd,
  UserDataType,
  NobleEd25519Signer,
  FarcasterNetwork,
  Message,
} from "@farcaster/hub-nodejs";

// Public Snapchain hubs — tried as fallback after Neynar.
// NOTE: post-Snapchain migration (2025) some of these may be unreachable from
// cloud server IPs (port 2281 blocked) or out-of-sync, but they remain as
// fallback for non-server environments (Cloudflare Worker, user's own browser IP).
const FREE_HUB_URLS = [
  "https://api.hub.wevm.dev",                      // wevm/viem team (HTTPS 443)
  "https://hub.pinata.cloud",                       // Pinata public hub (HTTPS 443)
  "https://hoyt.farcaster.xyz:2281",               // Merkle hub (port 2281)
  "https://hub.farcaster.standardcrypto.vc:2281",  // Standard Crypto (port 2281)
];

// Neynar hub — primary submission target (fully synced Snapchain node, blockDelay=0).
const NEYNAR_HUB_URL = "https://hub-api.neynar.com";

/** Read every NEYNAR_API_KEY* env var — used for parallel key racing below. */
export function getAllNeynarKeys(): string[] {
  const keys: string[] = [];
  const p = process.env.NEYNAR_API_KEY;
  if (p) keys.push(p);
  for (let i = 2; i <= 20; i++) {
    const k = process.env[`NEYNAR_API_KEY_${i}`] ?? process.env[`NEYNAR_API_KEY${i}`];
    if (k && !keys.includes(k)) keys.push(k);
    if (!process.env[`NEYNAR_API_KEY_${i}`] && !process.env[`NEYNAR_API_KEY${i}`]) break;
  }
  return keys;
}

/**
 * Submit pre-signed protobuf bytes to a single hub URL.
 * Pass a shared AbortSignal so sibling races can be cancelled the moment one wins.
 */
async function tryHubOnce(
  url: string,
  msgBytes: Uint8Array,
  msgHash: string,
  apiKey?: string,
  sharedAbort?: AbortSignal,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (apiKey) headers["api_key"] = apiKey;

  // Combine per-request timeout with the shared abort signal (if supported).
  // AbortSignal.any is available in Node ≥ 20.3; fall back to shared signal alone.
  // 5 s for Neynar (reliable), 4 s for free hubs (fast-fail — most are unreachable from cloud)
  const timeoutSignal = AbortSignal.timeout(apiKey ? 5_000 : 4_000);
  const signal = sharedAbort
    ? (typeof AbortSignal.any === "function"
        ? AbortSignal.any([sharedAbort, timeoutSignal])
        : sharedAbort)
    : timeoutSignal;

  const res = await fetch(`${url}/v1/submitMessage`, {
    method: "POST",
    headers,
    body: msgBytes,
    signal,
  });
  if (res.ok) {
    console.log(`[farcaster-submit] ✓ ${apiKey ? "(neynar) " : "(free)"}${url}`);
    return msgHash;
  }
  const txt = await res.text().catch(() => "");
  if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) return msgHash;
  throw new Error(`${url}: HTTP ${res.status} — ${txt.slice(0, 120)}`);
}

/**
 * Submit already-signed protobuf bytes to Farcaster hubs.
 *
 * Strategy — Neynar first, free hubs as fallback:
 *
 *  Phase 1 — Try Neynar hub (always reachable from server, fully synced).
 *             Free hubs on port 2281 are blocked by most cloud providers; even
 *             HTTPS free hubs may be out-of-sync or unreachable from a Replit
 *             server IP, so Neynar is the reliable path.
 *             AbortController ensures exactly 1 credit consumed across all keys.
 *
 *  Phase 2 — Fallback: race all free hubs simultaneously.
 *             Useful when Neynar is temporarily down or when running outside
 *             Replit where port 2281 is reachable.
 *
 * Permanent errors (unknown signer / fid=0) surface as SIGNER_NOT_REGISTERED
 * so callers can show a meaningful retry prompt instead of a generic failure.
 */
export async function submitSignedBytes(msgBytes: Uint8Array): Promise<string> {
  const message = Message.decode(msgBytes);
  const msgHash = Buffer.from(message.hash).toString("hex");

  // ── Phase 1: Neynar hub first (reliable from server environment) ─────────────
  const neynarKeys = getAllNeynarKeys();
  if (neynarKeys.length > 0) {
    const neynarAbort = new AbortController();
    const neynarResult = await Promise.any(
      neynarKeys.map(async key => {
        const hash = await tryHubOnce(NEYNAR_HUB_URL, msgBytes, msgHash, key, neynarAbort.signal);
        neynarAbort.abort("neynar key won"); // cancel remaining key attempts
        return hash;
      }),
    ).catch((e: unknown) => {
      const errs = (e instanceof AggregateError ? e.errors : [e])
        .map(x => String(x))
        .filter(m => !m.includes("AbortError") && !m.includes("abort"));

      // Signer not yet indexed → surface immediately so caller can retry
      const allSignerErrors = errs.length > 0 && errs.every(m =>
        m.includes("fid cannot be 0") || m.includes("unknown signer") || m.includes("invalid signer"),
      );
      if (allSignerErrors) {
        throw new Error(
          "SIGNER_NOT_REGISTERED: Your signer key is not yet recognized by the hub. " +
          "The on-chain registration is confirmed but hubs may take a few minutes to sync. " +
          "Please try again in 1–2 minutes.",
        );
      }
      if (errs.length) console.warn(`[farcaster-submit] Neynar hub failed: ${errs.join(" | ")}`);
      return null as null;
    });

    if (neynarResult) return neynarResult;
  } else {
    console.warn("[farcaster-submit] No NEYNAR_API_KEY configured — relying on free hubs only.");
  }

  // ── Phase 2: Fallback — race free hubs in parallel ───────────────────────────
  // These typically fail on cloud providers (port 2281 blocked, out-of-sync nodes)
  // but may succeed in other environments or when Neynar is temporarily unavailable.
  const freeAbort = new AbortController();
  const freeResult = await Promise.any(
    FREE_HUB_URLS.map(async url => {
      const hash = await tryHubOnce(url, msgBytes, msgHash, undefined, freeAbort.signal);
      freeAbort.abort("free hub won");
      return hash;
    }),
  ).catch((e: unknown) => {
    const errs = (e instanceof AggregateError ? e.errors : [e])
      .map(x => String(x))
      .filter(m => !m.includes("AbortError") && !m.includes("abort"));
    if (errs.length) console.warn(`[farcaster-submit] Free hubs also failed: ${errs.join(" | ")}`);
    return null as null;
  });

  if (freeResult) return freeResult;

  if (neynarKeys.length === 0) {
    throw new Error("No Neynar API keys configured and all free hubs failed.");
  }
  throw new Error("All hub targets failed: Neynar hub and free hubs both unavailable.");
}

const VALID_CAST_HASH = /^(0x)?[0-9a-fA-F]{40,80}$/;

export type FarcasterAction =
  | { type: "like";             castHash: string; castAuthorFid: number }
  | { type: "unlike";           castHash: string; castAuthorFid: number }
  | { type: "recast";           castHash: string; castAuthorFid: number }
  | { type: "unrecast";         castHash: string; castAuthorFid: number }
  | { type: "follow";           targetFid: number }
  | { type: "unfollow";         targetFid: number }
  | { type: "cast";             text: string; parentHash?: string; parentFid?: number; parentUrl?: string }
  | { type: "delete-cast";      castHash: string }
  | { type: "update-user-data"; dataType: "pfp" | "display" | "bio"; value: string };

function validateAction(action: FarcasterAction): void {
  const FID_MAX = 1_000_000_000;
  if (["like","unlike","recast","unrecast","delete-cast"].includes(action.type)) {
    const a = action as { castHash?: string; castAuthorFid?: number };
    if (!a.castHash || !VALID_CAST_HASH.test(a.castHash)) {
      throw new Error(`Invalid castHash for action ${action.type}`);
    }
    if ("castAuthorFid" in action) {
      const fid = (action as { castAuthorFid: number }).castAuthorFid;
      if (typeof fid !== "number" || fid <= 0 || fid >= FID_MAX) throw new Error("Invalid castAuthorFid");
    }
  }
  if (action.type === "follow" || action.type === "unfollow") {
    if (typeof action.targetFid !== "number" || action.targetFid <= 0 || action.targetFid >= FID_MAX) {
      throw new Error("Invalid targetFid");
    }
  }
  if (action.type === "cast") {
    if (typeof action.text !== "string" || action.text.length === 0 || action.text.length > 1024) {
      throw new Error("Cast text must be between 1 and 1024 characters");
    }
    if (action.parentHash && !VALID_CAST_HASH.test(action.parentHash)) {
      throw new Error("Invalid parentHash");
    }
    if (action.parentFid !== undefined && (typeof action.parentFid !== "number" || action.parentFid <= 0 || action.parentFid >= FID_MAX)) {
      throw new Error("Invalid parentFid");
    }
    if (action.parentUrl !== undefined) {
      if (typeof action.parentUrl !== "string" || action.parentUrl.length > 512) throw new Error("Invalid parentUrl");
      if (!action.parentUrl.startsWith("https://") && !action.parentUrl.startsWith("chain://")) {
        throw new Error("parentUrl must use https:// or chain:// scheme");
      }
    }
  }
  if (action.type === "update-user-data") {
    const validTypes = ["pfp", "display", "bio"];
    if (!validTypes.includes(action.dataType)) throw new Error("Invalid dataType for update-user-data");
    if (typeof action.value !== "string" || action.value.length === 0 || action.value.length > 256) {
      throw new Error("User data value must be 1–256 characters");
    }
    if (action.dataType === "pfp" && !action.value.startsWith("https://")) {
      throw new Error("Profile picture must be a https:// URL");
    }
  }
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

async function buildMessage(
  signerPrivateKeyHex: string,
  fid: number,
  action: FarcasterAction,
): Promise<Message> {
  const privateKeyBytes = hexToBytes(signerPrivateKeyHex);
  const signer = new NobleEd25519Signer(privateKeyBytes);
  const dataOptions = { fid, network: FarcasterNetwork.MAINNET };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any;

  if (action.type === "like") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionAdd(
      { type: 1, targetCastId: { fid: action.castAuthorFid, hash } },
      dataOptions, signer,
    );
  } else if (action.type === "unlike") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionRemove(
      { type: 1, targetCastId: { fid: action.castAuthorFid, hash } },
      dataOptions, signer,
    );
  } else if (action.type === "recast") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionAdd(
      { type: 2, targetCastId: { fid: action.castAuthorFid, hash } },
      dataOptions, signer,
    );
  } else if (action.type === "unrecast") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionRemove(
      { type: 2, targetCastId: { fid: action.castAuthorFid, hash } },
      dataOptions, signer,
    );
  } else if (action.type === "follow") {
    result = await makeLinkAdd(
      { type: "follow", targetFid: action.targetFid },
      dataOptions, signer,
    );
  } else if (action.type === "unfollow") {
    result = await makeLinkRemove(
      { type: "follow", targetFid: action.targetFid },
      dataOptions, signer,
    );
  } else if (action.type === "delete-cast") {
    const hash = hexToBytes(action.castHash);
    result = await makeCastRemove(
      { targetHash: hash },
      dataOptions, signer,
    );
  } else if (action.type === "update-user-data") {
    const typeMap: Record<string, UserDataType> = {
      pfp: UserDataType.PFP,
      display: UserDataType.DISPLAY,
      bio: UserDataType.BIO,
    };
    result = await makeUserDataAdd(
      { type: typeMap[action.dataType], value: action.value },
      dataOptions, signer,
    );
  } else {
    result = await makeCastAdd(
      {
        text: action.text,
        embeds: [],
        embedsDeprecated: [],
        mentions: [],
        mentionsPositions: [],
        ...(action.parentHash && action.parentFid
          ? { parentCastId: { fid: action.parentFid, hash: hexToBytes(action.parentHash) } }
          : action.parentUrl
            ? { parentUrl: action.parentUrl }
            : {}),
      },
      dataOptions, signer,
    );
  }

  privateKeyBytes.fill(0);
  if (!result || result.isErr()) {
    throw new Error(`Failed to build message: ${result?.error?.message ?? "unknown"}`);
  }
  return result.value;
}

/**
 * Sign a Farcaster message and return the serialised protobuf bytes (base64).
 * Does NOT submit to any hub — the caller (browser) does the submission directly,
 * distributing hub traffic across each user's own IP instead of the server's IP.
 *
 * Strategy:
 *  1. Try Worker Thread pool (non-blocking, N-way parallel CPU throughput).
 *  2. Fall back to main-thread signing if pool is unavailable or times out.
 */
export async function signFarcasterAction(
  signerPrivateKeyHex: string,
  fid: number,
  action: FarcasterAction,
): Promise<{ bytes: string; hash: string }> {
  validateAction(action);

  // ── 1. Try worker pool (offloads CPU-bound ed25519 from main event loop) ──
  try {
    const { poolAvailable, signInPool } = await import("./sign-pool.js");
    if (poolAvailable()) {
      return await signInPool(signerPrivateKeyHex, fid, action);
    }
  } catch {
    // pool not ready — fall through to main-thread signing
  }

  // ── 2. Main-thread fallback ───────────────────────────────────────────────
  const message = await buildMessage(signerPrivateKeyHex, fid, action);
  const msgBytes = Message.encode(message).finish();
  return {
    bytes: Buffer.from(msgBytes).toString("base64"),
    hash: Buffer.from(message.hash).toString("hex"),
  };
}

export async function submitFarcasterAction(
  signerPrivateKeyHex: string,
  fid: number,
  action: FarcasterAction,
): Promise<{ hash: string }> {
  validateAction(action);
  const message = await buildMessage(signerPrivateKeyHex, fid, action);
  const msgBytes = Message.encode(message).finish();
  console.log(`[farcaster-submit] action=${action.type} fid=${fid} msgBytes=${msgBytes.length}`);
  const hash = await submitSignedBytes(msgBytes);
  return { hash };
}
