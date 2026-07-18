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

// Free public hubs - no Neynar credits, raced in parallel first.
// Prefer HTTPS-port hubs (443) - port 2281 is commonly blocked on cloud providers.
//
// CUSTOM_HUB_URL (env): point this at YOUR OWN Snapchain hub for truly unlimited,
// zero-credit writes with no Neynar dependency. A hub runs for free forever on an
// Oracle Cloud "Always Free" ARM instance (4 cores / 24 GB). When set it's raced
// FIRST - if it accepts, no credits are spent and Neynar is never touched.
const STATIC_FREE_HUB_URLS = [
  "https://api.hub.wevm.dev",                      // wevm/viem team (HTTPS 443)
  "https://hub.pinata.cloud",                       // Pinata public hub (HTTPS 443)
  "https://hoyt.farcaster.xyz:2281",               // Merkle hub (port 2281 - may be blocked)
  "https://hub.farcaster.standardcrypto.vc:2281",  // Standard Crypto (port 2281)
];

// Read lazily, not at module top level - ESM import evaluation order runs
// this before server/index.ts's own .env-loading code, which would silently
// capture undefined for a CUSTOM_HUB_URL set only via the .env file (same
// bug class already fixed in cloudinary-upload.ts and neynar-limit.ts).
function getFreeHubUrls(): string[] {
  const custom = process.env.CUSTOM_HUB_URL;
  return custom ? [custom.replace(/\/$/, ""), ...STATIC_FREE_HUB_URLS] : STATIC_FREE_HUB_URLS;
}

// Neynar hub - costs credits per submission; used only when ALL free hubs fail.
const NEYNAR_HUB_URL = "https://hub-api.neynar.com";

/** Read every NEYNAR_API_KEY* env var - used for key rotation below. */
export function getAllNeynarKeys(): string[] {
  const keys: string[] = [];
  const p = process.env.NEYNAR_API_KEY;
  if (p) keys.push(p);
  // Scan the whole range WITHOUT breaking on a gap - keys are often numbered with
  // holes (e.g. _16 missing but _17…_20 present); an early break would silently
  // drop every key after the first gap.
  for (let i = 2; i <= 55; i++) {
    const k = process.env[`NEYNAR_API_KEY_${i}`] ?? process.env[`NEYNAR_API_KEY${i}`];
    if (k && !keys.includes(k)) keys.push(k);
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
  timeoutMs = 8_000,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (apiKey) headers["api_key"] = apiKey;

  // Combine per-request timeout with the shared abort signal (if supported).
  // AbortSignal.any is available in Node ≥ 20.3; fall back to shared signal alone.
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
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
  throw new Error(`${url}: HTTP ${res.status} · ${txt.slice(0, 120)}`);
}

/**
 * Submit already-signed protobuf bytes to Farcaster hubs.
 *
 * Strategy:
 *  Phase 1 - Race ALL free hubs simultaneously (Promise.any + AbortController).
 *             First hub to accept aborts the siblings → 0 credits consumed.
 *  Phase 2 - Only if every free hub failed: try Neynar keys SEQUENTIALLY in
 *             round-robin order → ~1 request (and 1 credit) per action, and the
 *             server IP never bursts N parallel requests per action.
 */
export async function submitSignedBytes(msgBytes: Uint8Array): Promise<string> {
  const message = Message.decode(msgBytes);
  const msgHash = Buffer.from(message.hash).toString("hex");

  // Phase 1: race free hubs (parallel, no credits) - cancel siblings on first win.
  // Short 2.5s timeout: some free hubs (e.g. the :2281-port ones) are unreachable on
  // many networks and would otherwise hang the whole Promise.any for 8s before we
  // fall through to Neynar. A reachable free hub responds well under 2.5s anyway.
  const FREE_HUB_TIMEOUT_MS = 1_500;
  const freeHubUrls = getFreeHubUrls();
  const freeAbort = new AbortController();
  const freeResult = await Promise.any(
    freeHubUrls.map(async url => {
      const hash = await tryHubOnce(url, msgBytes, msgHash, undefined, freeAbort.signal, FREE_HUB_TIMEOUT_MS);
      freeAbort.abort("free hub won"); // cancel any still-pending sibling requests
      return hash;
    }),
  ).catch((e: unknown) => {
    const errs = (e instanceof AggregateError ? e.errors : [e])
      .map(x => String(x))
      .filter(m => !m.includes("AbortError") && !m.includes("abort"));
    if (errs.length) console.warn(`[farcaster-submit] free hubs all failed: ${errs.join(" | ")}`);
    return null as null;
  });

  if (freeResult) return freeResult;

  // Phase 2: all free hubs failed → try Neynar keys ONE AT A TIME (round-robin).
  // The old approach fired every key in PARALLEL, so each action sent N simultaneous
  // requests to hub-api.neynar.com from this single server IP. At ~40 actions/min with
  // 19 keys that's ~760 req/min from one IP - tripping Neynar's per-IP limit even with
  // a single user ("1 user rate-limits itself"). Sequential rotation sends ~1 request
  // per action and spreads consecutive actions across all keys, so neither a single
  // key nor the server IP gets hammered. We only advance to the next key on transient
  // failures (429/timeout); a permanent validation failure stops immediately since
  // rotating keys can never fix a bad/deleted target FID.
  const neynarKeys = getAllNeynarKeys();
  if (neynarKeys.length === 0) throw new Error("No Neynar API keys configured and all free hubs failed.");

  const n = neynarKeys.length;
  const start = _neynarRR % n;
  _neynarRR = (_neynarRR + 1) % n;
  const errs: string[] = [];

  for (let i = 0; i < n; i++) {
    const key = neynarKeys[(start + i) % n];
    try {
      return await tryHubOnce(NEYNAR_HUB_URL, msgBytes, msgHash, key);
    } catch (e: unknown) {
      const msg = String(e);
      errs.push(msg);
      // Permanent validation failure (bad/deleted target FID) that is NOT a
      // signer-sync issue - rotating keys is pointless, stop now.
      if (/validation_failure/i.test(msg) && !/signer/i.test(msg)) {
        throw new Error(msg);
      }
      // else: 429 / timeout / transient → try the next key.
    }
  }

  const allSignerErrors = errs.length > 0 && errs.every(m =>
    m.includes("fid cannot be 0") || m.includes("unknown signer") || m.includes("invalid signer")
  );
  if (allSignerErrors) {
    throw new Error(
      "SIGNER_NOT_REGISTERED: Your signer key is not yet recognized by the hub. " +
      "The on-chain registration is confirmed but hubs may take a few minutes to sync. " +
      "Please try again in 1–2 minutes.",
    );
  }
  throw new Error(`All ${freeHubUrls.length + n} hub targets failed: ${errs.join(" | ")}`);
}

// Round-robin cursor so consecutive submits start on a different Neynar key.
let _neynarRR = 0;

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
  | { type: "update-user-data"; dataType: "pfp" | "display" | "bio" | "banner"; value: string };

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
    const validTypes = ["pfp", "display", "bio", "banner"];
    if (!validTypes.includes(action.dataType)) throw new Error("Invalid dataType for update-user-data");
    if (typeof action.value !== "string" || action.value.length === 0 || action.value.length > 256) {
      throw new Error("User data value must be 1–256 characters");
    }
    if ((action.dataType === "pfp" || action.dataType === "banner") && !action.value.startsWith("https://")) {
      throw new Error("Image must be a https:// URL");
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
      banner: UserDataType.BANNER,
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
 * Does NOT submit to any hub - the caller (browser) does the submission directly,
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
    // pool not ready - fall through to main-thread signing
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
