/**
 * Farcaster Hub Message Submission — Browser Client
 *
 * Signing is done ENTIRELY IN THE BROWSER using @farcaster/core.
 * No server roundtrip for signing → server CPU = 0 → no queue / no pause.
 *
 * Chain for every action:
 *  1. Build + sign locally in this browser tab (private key never leaves device)
 *  2. Submit protobuf bytes directly to a public hub (user's own IP)
 *     Each hub: up to 2 attempts with backoff on 429 / network error.
 *  3. If all public hubs reject → server relay (/action) as last resort.
 *     Server relay also signs + submits server-side (slower, but always works).
 *
 * Exported functions are drop-in identical to the old version — callers unchanged.
 */

import {
  makeCastAdd,
  makeCastRemove,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  makeUserDataAdd,
  NobleEd25519Signer,
  FarcasterNetwork,
  UserDataType,
  Message,
} from "@farcaster/core";
import type { LocalSigner } from "./wallet";

// ─── helpers ──────────────────────────────────────────────────────────────────

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normFid(fid: number | bigint): number {
  const n = Number(fid);
  if (!n || n <= 0) throw new Error(`FID is invalid: ${fid}`);
  return n;
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// ─── browser-local signing ────────────────────────────────────────────────────

type FarcasterAction =
  | { type: "like";             castHash: string; castAuthorFid: number }
  | { type: "unlike";           castHash: string; castAuthorFid: number }
  | { type: "recast";           castHash: string; castAuthorFid: number }
  | { type: "unrecast";         castHash: string; castAuthorFid: number }
  | { type: "follow";           targetFid: number }
  | { type: "unfollow";         targetFid: number }
  | { type: "cast";             text: string; parentHash?: string; parentFid?: number; parentUrl?: string }
  | { type: "delete-cast";      castHash: string }
  | { type: "update-user-data"; dataType: "pfp" | "display" | "bio"; value: string };

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

/**
 * Build and sign a Farcaster message entirely in the browser.
 * Returns serialised protobuf bytes (base64) + message hash (hex).
 * Private key bytes are zeroed immediately after use.
 */
async function buildAndSignLocal(
  privateKey: Uint8Array,
  fid: number,
  action: FarcasterAction,
): Promise<{ bytes: string; hash: string }> {
  const signer = new NobleEd25519Signer(privateKey);
  const opts   = { fid, network: FarcasterNetwork.MAINNET };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any;

  if (action.type === "like") {
    result = await makeReactionAdd(
      { type: 1, targetCastId: { fid: action.castAuthorFid, hash: hexToBytes(action.castHash) } },
      opts, signer,
    );
  } else if (action.type === "unlike") {
    result = await makeReactionRemove(
      { type: 1, targetCastId: { fid: action.castAuthorFid, hash: hexToBytes(action.castHash) } },
      opts, signer,
    );
  } else if (action.type === "recast") {
    result = await makeReactionAdd(
      { type: 2, targetCastId: { fid: action.castAuthorFid, hash: hexToBytes(action.castHash) } },
      opts, signer,
    );
  } else if (action.type === "unrecast") {
    result = await makeReactionRemove(
      { type: 2, targetCastId: { fid: action.castAuthorFid, hash: hexToBytes(action.castHash) } },
      opts, signer,
    );
  } else if (action.type === "follow") {
    result = await makeLinkAdd({ type: "follow", targetFid: action.targetFid }, opts, signer);
  } else if (action.type === "unfollow") {
    result = await makeLinkRemove({ type: "follow", targetFid: action.targetFid }, opts, signer);
  } else if (action.type === "delete-cast") {
    result = await makeCastRemove({ targetHash: hexToBytes(action.castHash) }, opts, signer);
  } else if (action.type === "update-user-data") {
    const typeMap: Record<string, UserDataType> = {
      pfp: UserDataType.PFP, display: UserDataType.DISPLAY, bio: UserDataType.BIO,
    };
    result = await makeUserDataAdd({ type: typeMap[action.dataType], value: action.value }, opts, signer);
  } else {
    const cast = action as { type: "cast"; text: string; parentHash?: string; parentFid?: number; parentUrl?: string };
    result = await makeCastAdd({
      type: 1, // CastType.CAST
      text: cast.text,
      embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [],
      ...(cast.parentHash && cast.parentFid
        ? { parentCastId: { fid: cast.parentFid, hash: hexToBytes(cast.parentHash) } }
        : cast.parentUrl ? { parentUrl: cast.parentUrl } : {}),
    }, opts, signer);
  }

  privateKey.fill(0); // zero out key immediately — never lingers in memory

  if (!result || result.isErr()) {
    throw new Error(`Failed to build message: ${result?.error?.message ?? "unknown"}`);
  }

  const message = result.value as Message;
  return {
    bytes: btoa(String.fromCharCode(...Message.encode(message).finish())),
    hash:  toHex(message.hash),
  };
}

// ─── hub submission ────────────────────────────────────────────────────────────

const BROWSER_HUB_URLS = [
  "https://hoyt.farcaster.xyz:2281",
  "https://hub.farcaster.standardcrypto.vc:2281",
];

/**
 * Submit pre-signed bytes to public hubs from the browser (user's own IP).
 * Retry strategy: 429 → wait 2 s, network error → wait 1 s (once per hub).
 */
async function tryDirectHubSubmit(bytesBase64: string): Promise<boolean> {
  const bytes = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0));

  for (const url of BROWSER_HUB_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`${url}/v1/submitMessage`, {
          method:  "POST",
          headers: { "Content-Type": "application/octet-stream" },
          body:    bytes,
          signal:  AbortSignal.timeout(10_000),
        });
        if (res.ok) return true;
        const txt = await res.text().catch(() => "");
        if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) return true;
        if (res.status === 429 && attempt === 0) { await sleep(2_000); continue; }
        break;
      } catch {
        if (attempt === 0) { await sleep(1_000); continue; }
        break;
      }
    }
  }
  return false;
}

/** Full server-side sign + submit — original fallback for when all hubs reject. */
async function serverRelay(body: object): Promise<void> {
  const res = await fetch("/api/farcaster/action", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(32_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = (JSON.parse(txt) as { error?: string }).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(
      "Hub server is not available in this deployment. Run the app locally for write actions.",
    );
  }
}

/**
 * Core submission: sign locally → submit to hub → fall back to server relay.
 *
 * @param privateKey  Raw ed25519 private key bytes (from LocalSigner).
 * @param fid         Farcaster ID of the acting user.
 * @param action      What to do.
 * @param relayBody   Pre-built body for server relay fallback (includes signerPrivateKey as hex).
 */
async function submit(
  privateKey: Uint8Array,
  fid: number,
  action: FarcasterAction,
  relayBody: object,
): Promise<void> {
  // ── 1. Sign in browser, submit from browser IP ────────────────────────────
  try {
    const { bytes } = await buildAndSignLocal(new Uint8Array(privateKey), fid, action);
    const ok = await tryDirectHubSubmit(bytes);
    if (ok) return;
  } catch {
    // signing failed (shouldn't happen) → fall through to relay
  }

  // ── 2. Server relay (signs + submits server-side) ────────────────────────
  await serverRelay(relayBody);
}

// ─── public API (same signatures as before) ───────────────────────────────────

export async function hubPublishCast(
  fid: number | bigint,
  signer: LocalSigner,
  text: string,
  opts?: { embeds?: string[]; parentHash?: string; parentFid?: number; parentUrl?: string; neynarKey?: string },
): Promise<void> {
  const fidNum = normFid(fid);
  const action: FarcasterAction = {
    type: "cast",
    text,
    ...(opts?.parentHash && opts.parentFid
      ? { parentHash: opts.parentHash, parentFid: opts.parentFid }
      : opts?.parentUrl ? { parentUrl: opts.parentUrl } : {}),
  };
  await submit(signer.privateKey, fidNum, action, {
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action,
  });
}

export async function hubReact(
  fid: number | bigint,
  signer: LocalSigner,
  castHash: string,
  castFid: number,
  type: "like" | "recast",
  opts?: { remove?: boolean; neynarKey?: string },
): Promise<void> {
  const fidNum     = normFid(fid);
  const actionType = opts?.remove ? (type === "like" ? "unlike" : "unrecast") : type;
  const action: FarcasterAction = { type: actionType, castHash, castAuthorFid: castFid };
  await submit(signer.privateKey, fidNum, action, {
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action,
  });
}

export async function hubFollow(
  fid: number | bigint,
  signer: LocalSigner,
  targetFid: number,
  opts?: { unfollow?: boolean; neynarKey?: string },
): Promise<void> {
  const fidNum = normFid(fid);
  const action: FarcasterAction = { type: opts?.unfollow ? "unfollow" : "follow", targetFid };
  await submit(signer.privateKey, fidNum, action, {
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action,
  });
}

export async function hubDeleteCast(
  fid: number | bigint,
  signer: LocalSigner,
  castHash: string,
): Promise<void> {
  const fidNum = normFid(fid);
  const action: FarcasterAction = { type: "delete-cast", castHash };
  await submit(signer.privateKey, fidNum, action, {
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action,
  });
}

export async function hubUpdateUserData(
  fid: number | bigint,
  signer: LocalSigner,
  dataType: "pfp" | "display" | "bio",
  value: string,
): Promise<void> {
  const fidNum = normFid(fid);
  const action: FarcasterAction = { type: "update-user-data", dataType, value };
  await submit(signer.privateKey, fidNum, action, {
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action,
  });
}

export async function neynarAction(
  signerUuid: string,
  action: { type: string; [k: string]: unknown },
): Promise<void> {
  const res = await fetch("/api/farcaster/neynar-action", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ signerUuid, action }),
    signal:  AbortSignal.timeout(32_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = (JSON.parse(txt) as { error?: string }).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error("Hub server is not available in this deployment.");
  }
}
