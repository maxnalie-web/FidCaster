/**
 * Farcaster Hub Message Submission — Browser Client
 *
 * Hybrid architecture (in priority order):
 *
 * 1. Browser-direct path (preferred):
 *    a. POST /api/farcaster/sign-message → server signs, returns protobuf bytes
 *    b. Browser submits those bytes directly to public hub (each user's own IP)
 *    → Distributes hub traffic across all users' IPs; no single-server-IP bottleneck.
 *
 * 2. Server relay fallback (when direct hub submission fails):
 *    POST /api/farcaster/action → server signs AND submits to hub.
 *    Used when public hubs don't support browser CORS, or direct fetch fails.
 *
 * Security: signerPrivateKey is sent to our own server over HTTPS (same as before).
 * The key is never stored on the server — it is used for one signing operation then discarded.
 */

import type { LocalSigner } from "./wallet";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normFid(fid: number | bigint): number {
  const n = typeof fid === "bigint" ? Number(fid) : Number(fid);
  if (!n || n <= 0) throw new Error(`FID is invalid: ${fid}`);
  return n;
}

// Public Farcaster hubs that accept protobuf submissions from browsers.
// Each user's browser connects from their own IP — no server IP bottleneck.
const BROWSER_HUB_URLS = [
  "https://hoyt.farcaster.xyz:2281",
  "https://hub.farcaster.standardcrypto.vc:2281",
];

/**
 * Try to POST pre-signed protobuf bytes directly from the browser to a public hub.
 * Returns true on success, false if all hubs fail (CORS, network, rate-limit).
 * Failures are silent — caller falls back to server relay.
 */
async function tryDirectHubSubmit(bytesBase64: string): Promise<boolean> {
  // atob is available in all modern browsers
  const bytes = Uint8Array.from(atob(bytesBase64), c => c.charCodeAt(0));
  for (const url of BROWSER_HUB_URLS) {
    try {
      const res = await fetch(`${url}/v1/submitMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;
      const txt = await res.text().catch(() => "");
      // Duplicate is fine — treat as success
      if (txt.includes("already exists") || txt.includes("DUPLICATE_MESSAGE")) return true;
      // 429 / other error from this hub → try next
    } catch {
      // CORS error or network failure → try next hub
    }
  }
  return false;
}

/**
 * Server relay: sign + submit entirely on the server.
 * Used as fallback when browser-direct hub submission fails.
 */
async function serverRelay(body: object): Promise<void> {
  const res = await fetch("/api/farcaster/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(32_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = JSON.parse(txt).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error(
      "Hub server is not available in this deployment. Run the app locally for write actions (cast, like, follow).",
    );
  }
}

/**
 * Main submission entry point.
 *
 * Step 1: POST /sign-message → get signed protobuf bytes from server.
 * Step 2: Browser submits bytes directly to public hub (own IP, no server bottleneck).
 * Step 3: If direct submission fails → fall back to full server relay (/action).
 */
async function callServer(body: object): Promise<void> {
  // ── Step 1 + 2: browser-direct path ──────────────────────────────────────
  try {
    const signRes = await fetch("/api/farcaster/sign-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (signRes.ok) {
      const ct = signRes.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) {
        const payload = await signRes.json() as { bytes?: string };
        if (payload.bytes) {
          const submitted = await tryDirectHubSubmit(payload.bytes);
          if (submitted) return; // success — done, no server hub call needed
        }
      }
    }
    // sign-message succeeded but direct hub submission failed → fall through
  } catch {
    // sign-message unavailable (static deploy, network issue) → fall through
  }

  // ── Step 3: server relay fallback ─────────────────────────────────────────
  await serverRelay(body);
}

export async function hubPublishCast(
  fid: number | bigint,
  signer: LocalSigner,
  text: string,
  opts?: {
    embeds?: string[];
    parentHash?: string;
    parentFid?: number;
    parentUrl?: string;
    neynarKey?: string;
  },
): Promise<void> {
  const fidNum = normFid(fid);
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action: {
      type: "cast",
      text,
      ...(opts?.parentHash && opts.parentFid
        ? { parentHash: opts.parentHash, parentFid: opts.parentFid }
        : opts?.parentUrl
          ? { parentUrl: opts.parentUrl }
          : {}),
    },
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
  const fidNum = normFid(fid);
  const actionType = opts?.remove
    ? (type === "like" ? "unlike" : "unrecast")
    : type;
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action: { type: actionType, castHash, castAuthorFid: castFid },
  });
}

export async function hubFollow(
  fid: number | bigint,
  signer: LocalSigner,
  targetFid: number,
  opts?: { unfollow?: boolean; neynarKey?: string },
): Promise<void> {
  const fidNum = normFid(fid);
  const actionType = opts?.unfollow ? "unfollow" : "follow";
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action: { type: actionType, targetFid },
  });
}

export async function neynarAction(signerUuid: string, action: { type: string; [k: string]: unknown }): Promise<void> {
  const res = await fetch("/api/farcaster/neynar-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signerUuid, action }),
    signal: AbortSignal.timeout(32_000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = JSON.parse(txt).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) {
    throw new Error("Hub server is not available in this deployment. Run the app locally for write actions.");
  }
}

export async function hubDeleteCast(
  fid: number | bigint,
  signer: LocalSigner,
  castHash: string,
): Promise<void> {
  const fidNum = normFid(fid);
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action: { type: "delete-cast", castHash },
  });
}

export async function hubUpdateUserData(
  fid: number | bigint,
  signer: LocalSigner,
  dataType: "pfp" | "display" | "bio",
  value: string,
): Promise<void> {
  const fidNum = normFid(fid);
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action: { type: "update-user-data", dataType, value },
  });
}
