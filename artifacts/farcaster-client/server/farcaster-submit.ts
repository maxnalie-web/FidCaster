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

// Free public hubs — no Neynar credits, raced in parallel first.
const FREE_HUB_URLS = [
  "https://hoyt.farcaster.xyz:2281",
  "https://hub.farcaster.standardcrypto.vc:2281",
  "https://api.hub.wevm.dev",          // wevm/viem team public hub (HTTPS)
];

// Neynar hub — costs credits per submission; used only when ALL free hubs fail.
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
 * Resolves with the message hash on success; throws on any failure.
 */
async function tryHubOnce(
  url: string,
  msgBytes: Uint8Array,
  msgHash: string,
  apiKey?: string,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
  if (apiKey) headers["api_key"] = apiKey;
  const res = await fetch(`${url}/v1/submitMessage`, {
    method: "POST",
    headers,
    body: msgBytes,
    signal: AbortSignal.timeout(8_000), // short timeout — we're racing, don't wait long
  });
  if (res.ok) {
    console.log(`[farcaster-submit] ✓ ${apiKey ? "(neynar) " : ""}${url}`);
    return msgHash;
  }
  const txt = await res.text().catch(() => "");
  if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) return msgHash;
  throw new Error(`${url}: HTTP ${res.status} — ${txt.slice(0, 120)}`);
}

/**
 * Submit already-signed protobuf bytes to Farcaster hubs.
 *
 * Strategy (no sequential retries — purely parallel racing):
 *  Phase 1 — Race ALL free hubs simultaneously (Promise.any).
 *             First hub to accept wins immediately → 0 credits consumed.
 *  Phase 2 — Only if every free hub failed: race ALL Neynar keys simultaneously.
 *             First non-rate-limited key wins → effectively no rate-limit wait.
 *
 * With N free hubs + K Neynar keys there are N+K parallel attempts.
 * The effective throughput is the SUM of all accepted RPM, not the minimum.
 */
export async function submitSignedBytes(msgBytes: Uint8Array): Promise<string> {
  const message = Message.decode(msgBytes);
  const msgHash = Buffer.from(message.hash).toString("hex");

  // Phase 1: race free hubs (parallel, no credits)
  const freeResult = await Promise.any(
    FREE_HUB_URLS.map(url => tryHubOnce(url, msgBytes, msgHash))
  ).catch(() => null as null);

  if (freeResult) return freeResult;

  // Phase 2: all free hubs failed → race ALL Neynar keys simultaneously
  const neynarKeys = getAllNeynarKeys();
  if (neynarKeys.length === 0) throw new Error("No Neynar API keys configured and all free hubs failed.");

  try {
    return await Promise.any(
      neynarKeys.map(key => tryHubOnce(NEYNAR_HUB_URL, msgBytes, msgHash, key))
    );
  } catch (e: unknown) {
    const errs = e instanceof AggregateError
      ? e.errors.map(x => String(x))
      : [String(e)];

    const allSignerErrors = errs.every(m =>
      m.includes("fid cannot be 0") || m.includes("unknown signer") || m.includes("invalid signer")
    );
    if (allSignerErrors) {
      throw new Error(
        "SIGNER_NOT_REGISTERED: Your signer key is not yet recognized by the hub. " +
        "The on-chain registration is confirmed but hubs may take a few minutes to sync. " +
        "Please try again in 1–2 minutes.",
      );
    }
    throw new Error(`All ${FREE_HUB_URLS.length + neynarKeys.length} hub targets failed: ${errs.join(" | ")}`);
  }
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
