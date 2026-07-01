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

// Hub submission order:
//  1. Public Farcaster hubs (free, no credits consumed) — tried first.
//     Any properly-synced hub accepts messages from on-chain-registered signers.
//  2. Neynar hub (costs API credits) — fallback only when public hubs fail.
//
// Public hubs sync KeyRegistry from Optimism like everyone else;
// "unknown signer" on a public hub = signer not yet on-chain, not a hub limitation.
const PUBLIC_HUB_URLS = [
  "https://hoyt.farcaster.xyz:2281",
  "https://hub.farcaster.standardcrypto.vc:2281",
];
const NEYNAR_HUB_URL = "https://hub-api.neynar.com";

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
 */
export async function signFarcasterAction(
  signerPrivateKeyHex: string,
  fid: number,
  action: FarcasterAction,
): Promise<{ bytes: string; hash: string }> {
  validateAction(action);
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

  const errs: string[] = [];
  const msgHash = Buffer.from(message.hash).toString("hex");

  /** Try a single hub URL. Returns the hash on success, null on failure. */
  async function tryHub(hubUrl: string, apiKey?: string): Promise<string | null> {
    try {
      const headers: Record<string, string> = { "Content-Type": "application/octet-stream" };
      if (apiKey) headers["api_key"] = apiKey;
      const res = await fetch(`${hubUrl}/v1/submitMessage`, {
        method: "POST",
        headers,
        body: msgBytes,
        signal: AbortSignal.timeout(12_000),
      });
      console.log(`[farcaster-submit] ${hubUrl}: HTTP ${res.status}`);
      if (res.ok) return msgHash;
      const txt = await res.text().catch(() => "");
      if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) {
        console.log(`[farcaster-submit] duplicate on ${hubUrl} — treating as success`);
        return msgHash;
      }
      errs.push(`${hubUrl}: HTTP ${res.status} — ${txt.slice(0, 200)}`);
      return null;
    } catch (e: unknown) {
      errs.push(`${hubUrl}: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
      return null;
    }
  }

  // ── 1. Try public hubs first (no Neynar credits) ────────────────────────
  for (const url of PUBLIC_HUB_URLS) {
    const hash = await tryHub(url);
    if (hash) return { hash };
  }

  // ── 2. Fall back to Neynar hub (costs credits, but most reliable) ───────
  const neynarKey = process.env.NEYNAR_API_KEY;
  if (neynarKey) {
    const hash = await tryHub(NEYNAR_HUB_URL, neynarKey);
    if (hash) return { hash };
  } else {
    errs.push(`${NEYNAR_HUB_URL}: skipped (NEYNAR_API_KEY not configured)`);
  }

  const allSignerErrors = errs.every(
    (e) => e.includes("fid cannot be 0") || e.includes("unknown signer") || e.includes("invalid signer"),
  );
  if (allSignerErrors && errs.length > 0) {
    throw new Error(
      "SIGNER_NOT_REGISTERED: Your signer key is not yet recognized by the hub. " +
      "The on-chain registration is confirmed but hubs may take a few minutes to sync. " +
      "Please try again in 1–2 minutes.",
    );
  }

  throw new Error(`Hub submission failed: ${errs.join(" | ")}`);
}
