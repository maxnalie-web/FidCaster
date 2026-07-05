/**
 * Farcaster Hub Message Submission · Browser Client
 *
 * Signing is done ENTIRELY IN THE BROWSER using @farcaster/core.
 * Private key NEVER leaves the browser · not even for the server relay.
 *
 * Chain for every action:
 *  1. Build + sign locally in this browser tab (private key never leaves device).
 *  2. Submit protobuf bytes directly to a public hub (user's own IP, CORS permitting).
 *  3. If direct submission is blocked (CORS / mixed-content) →
 *     POST pre-signed bytes to /api/farcaster/submit-bytes (server CORS proxy).
 *     Server races 3 free hubs + all Neynar keys with Promise.any() · first win returned.
 *  4. Only if browser signing itself fails → full server relay (/action) as last resort.
 *
 * Exported functions are drop-in identical to the old version · callers unchanged.
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
  | { type: "update-user-data"; dataType: "pfp" | "display" | "bio" | "banner"; value: string };

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
      banner: UserDataType.BANNER,
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

  privateKey.fill(0); // zero out key immediately · never lingers in memory

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

// Cloudflare Worker URL (optional) · set VITE_HUB_WORKER_URL in your environment.
// Worker races 3 free hubs in parallel on Cloudflare's global network; each
// data-center has its own IP so hub rate limits are effectively bypassed.
// See hub-worker/index.js for the one-file Worker code to deploy.
const WORKER_URL = (import.meta.env.VITE_HUB_WORKER_URL as string | undefined)?.replace(/\/$/, "");

/**
 * Submit pre-signed bytes via Cloudflare Worker (if VITE_HUB_WORKER_URL is set).
 * The Worker handles CORS and runs on Cloudflare's global edge · each data-center
 * has its own IP, so per-IP hub rate limits are effectively bypassed for free.
 * See hub-worker/index.js for the one-file Worker code to deploy.
 */
async function tryWorkerHubSubmit(bytesBase64: string): Promise<boolean> {
  if (!WORKER_URL) return false;
  const bytes = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0));
  try {
    const res = await fetch(`${WORKER_URL}/v1/submitMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body:    bytes,
      signal:  AbortSignal.timeout(10_000),
    });
    if (res.ok) return true;
    const txt = await res.text().catch(() => "");
    if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) return true;
    return false;
  } catch {
    return false;
  }
}

// ─── Browser-direct Neynar submission (per-IP scaling) ────────────────────────
// Each USER submits straight from their OWN browser/IP so Neynar's per-IP hub
// limits stop applying and this origin stays off the write hot-path · that's what
// lets follow/unfollow scale on the free tier.
//
// SECURITY: the origin ONLY ever hands out a *dedicated, capped* throwaway key
// (server env NEYNAR_HUB_KEYS), never the main read keys. Any key sent to a
// browser is readable in devtools and cannot be "encrypted" away (the browser
// would need the decrypt key too), so the mitigation is blast-radius, not
// secrecy: give this key a strict spending cap in the Neynar dashboard. If
// NEYNAR_HUB_KEYS is unset the endpoint returns 503 and we fall back to the
// server relay (main keys stay server-side). See /api/farcaster/hub-token.
interface HubToken { key: string; hub: string; at: number; }
let _hubToken: HubToken | null = null;
let _hubTokenInflight: Promise<HubToken | null> | null = null;
const HUB_TOKEN_TTL_MS = 60_000;

async function getHubToken(force = false): Promise<HubToken | null> {
  if (!force && _hubToken && Date.now() - _hubToken.at < HUB_TOKEN_TTL_MS) return _hubToken;
  if (_hubTokenInflight) return _hubTokenInflight;
  _hubTokenInflight = (async () => {
    try {
      const res = await fetch("/api/farcaster/hub-token", { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null; // 503 → no dedicated key configured → use server relay
      const d = await res.json() as { key?: string; hub?: string };
      if (!d.key || !d.hub) return null;
      _hubToken = { key: d.key, hub: d.hub, at: Date.now() };
      return _hubToken;
    } catch {
      return null;
    } finally {
      _hubTokenInflight = null;
    }
  })();
  return _hubTokenInflight;
}

/**
 * Submit signed bytes straight to Neynar's hub from the browser using the
 * dedicated rotating key.
 *  "ok"   → accepted (or duplicate, i.e. already applied)
 *  "skip" → permanent validation failure (deleted/invalid target FID) · don't retry
 *  "fail" → retryable (rotate key / fall back to the server relay)
 */
async function tryNeynarBrowserSubmit(bytesBase64: string): Promise<"ok" | "skip" | "fail"> {
  const bytes = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0));
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await getHubToken(attempt > 0);
    if (!tok) return "fail"; // no dedicated key (endpoint 503/down) → use server relay
    try {
      const res = await fetch(`${tok.hub}/v1/submitMessage`, {
        method:  "POST",
        headers: { "Content-Type": "application/octet-stream", api_key: tok.key },
        body:    bytes,
        signal:  AbortSignal.timeout(12_000),
      });
      if (res.ok) return "ok";
      const txt = await res.text().catch(() => "");
      if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) return "ok";
      // Key exhausted / rate-limited / cap-gated → rotate to a fresh key, retry once.
      if (res.status === 401 || res.status === 402 || res.status === 403 || res.status === 429) {
        _hubToken = null;
        continue;
      }
      // Permanent validation failure for a bad target FID · but NOT a signer error
      // (a freshly-registered signer the hub hasn't synced yet must be retried, not skipped).
      if (res.status === 400 && /validation_failure|invalid/i.test(txt) && !/signer/i.test(txt)) {
        return "skip";
      }
      return "fail";
    } catch {
      return "fail";
    }
  }
  return "fail";
}

/**
 * Send pre-signed bytes to the server CORS proxy.
 * Server races 3 free hubs + all Neynar keys with Promise.any() · first win returned.
 * Private key is NEVER transmitted · only already-signed bytes.
 */
async function submitBytesRelay(bytesBase64: string): Promise<void> {
  const res = await fetch("/api/farcaster/submit-bytes", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ bytes: bytesBase64 }),
    signal:  AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error(`HTTP 429 · server relayed a hub rate limit`);
    if (res.status >= 500) throw new Error(`signal · server temporarily unavailable (${res.status}), will retry`);
    // 422 = validation_failure · target FID deleted/invalid, skip permanently
    if (res.status === 422) throw new Error(`PERMANENT_SKIP · target FID is invalid or deleted`);
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = (JSON.parse(txt) as { error?: string }).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(`signal · hub relay returned unexpected response (server may be restarting)`);
  }
}

/** Last-resort full relay · used only when browser-side signing itself fails. */
async function serverRelay(body: object): Promise<void> {
  const res = await fetch("/api/farcaster/action", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(32_000),
  });
  if (!res.ok) {
    if (res.status === 429) throw new Error(`HTTP 429 · server relayed a hub rate limit`);
    if (res.status >= 500) throw new Error(`signal · server temporarily unavailable (${res.status}), will retry`);
    // 422 = validation_failure · target FID is deleted/invalid, permanent → signal skip
    if (res.status === 422) throw new Error(`PERMANENT_SKIP · target FID is invalid or deleted`);
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = (JSON.parse(txt) as { error?: string }).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(`signal · hub relay returned unexpected response (server may be restarting)`);
  }
}

/**
 * Core submission: sign locally → direct hub → server bytes proxy → last-resort relay.
 *
 * @param privateKey  Raw ed25519 private key bytes (from LocalSigner).
 * @param fid         Farcaster ID of the acting user.
 * @param action      What to do.
 * @param relayBody   Pre-built body for the last-resort /action relay (only used if signing fails).
 */
async function submit(
  privateKey: Uint8Array,
  fid: number,
  action: FarcasterAction,
  relayBody: object,
): Promise<void> {
  // ── 1. Sign locally (private key never leaves the browser) ──────────────────
  let signedBytes: string | null = null;
  try {
    const { bytes } = await buildAndSignLocal(new Uint8Array(privateKey), fid, action);
    signedBytes = bytes;

    // 1a. Cloudflare Worker (if configured) · the api_key lives as a Worker secret,
    //     never in the browser. CORS handled, edge IPs, free. No-op if unset.
    if (await tryWorkerHubSubmit(bytes)) return;

    // 1b. PRIMARY: submit straight to Neynar from THIS browser using the dedicated
    //     capped key (per-IP scaling). No-op → falls through to the server relay.
    const direct = await tryNeynarBrowserSubmit(bytes);
    if (direct === "ok") return;
    if (direct === "skip") throw new Error("PERMANENT_SKIP · target FID is invalid or deleted");
    // direct === "fail" → fall through to the server relay below.
  } catch (err) {
    // A permanent-skip is a real result the caller must see, not a transient failure.
    if (err instanceof Error && err.message.startsWith("PERMANENT_SKIP")) throw err;
    console.warn("[hub-submit] browser sign/submit failed · falling back to server relay:", err);
  }

  // ── 2. Fallback: server relay (races free hubs + all Neynar keys server-side).
  //     Signed bytes only · the private key stays in the browser.
  if (signedBytes) {
    await submitBytesRelay(signedBytes);
    return;
  }

  // ── 3. Absolute last resort: full relay with re-signing (signing-failure path) ─
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
  dataType: "pfp" | "display" | "bio" | "banner",
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
