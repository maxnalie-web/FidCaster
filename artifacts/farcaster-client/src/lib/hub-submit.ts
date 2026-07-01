/**
 * Farcaster Hub Message Submission — Browser Client
 *
 * Submission chain (in order):
 *  1. Browser-direct:  sign via server → submit from browser to public hub (own IP).
 *     Each hub is tried with one automatic retry on transient errors.
 *     429 from a hub → exponential backoff before retry.
 *  2. Server relay:    full server-side sign + submit (/action).
 *     Used when direct submission fails (CORS, network, all hubs down).
 *
 * No silent failures: every path throws on final failure so callers see the error.
 */

import type { LocalSigner } from "./wallet";

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function normFid(fid: number | bigint): number {
  const n = Number(fid);
  if (!n || n <= 0) throw new Error(`FID is invalid: ${fid}`);
  return n;
}

// Public Farcaster hubs — free, no Neynar credits.
// Browser fetches from each user's own IP — distributes traffic, no server IP bottleneck.
const BROWSER_HUB_URLS = [
  "https://hoyt.farcaster.xyz:2281",
  "https://hub.farcaster.standardcrypto.vc:2281",
];

/** Sleep helper */
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Try to POST pre-signed protobuf bytes directly from the browser to a public hub.
 *
 * Retry strategy per hub:
 *  - attempt 0: send immediately
 *  - on 429:    wait 2 s, retry once
 *  - on network/CORS error: wait 1 s, retry once
 *  - any other failure: skip to next hub immediately
 *
 * Returns true on first success, false if all hubs exhaust all attempts.
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

        if (res.status === 429 && attempt === 0) {
          await sleep(2_000); // exponential back-off: 2 s before one retry
          continue;
        }
        break; // non-retryable error → next hub
      } catch {
        // CORS or network error
        if (attempt === 0) { await sleep(1_000); continue; }
        break; // gave up on this hub
      }
    }
  }
  return false;
}

/** Full server-side sign + submit relay — original fallback behavior. */
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
 * Main submission entry point — hybrid with full fallback chain:
 *
 *  Step 1: POST /sign-message → server signs, returns bytes.
 *  Step 2: Browser submits bytes directly to public hub (own IP per user).
 *          One automatic retry per hub with exponential back-off.
 *  Step 3: If direct submission fails → server relay (/action) as last resort.
 */
async function callServer(body: object): Promise<void> {
  // ── Step 1 + 2: browser-direct path ──────────────────────────────────────
  try {
    const signRes = await fetch("/api/farcaster/sign-message", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(15_000),
    });

    if (signRes.ok && (signRes.headers.get("content-type") ?? "").includes("application/json")) {
      const payload = await signRes.json() as { bytes?: string };
      if (payload.bytes) {
        const submitted = await tryDirectHubSubmit(payload.bytes);
        if (submitted) return; // ✓ success — no server hub call needed
      }
    }
    // sign-message OK but direct hub failed → fall through to relay
  } catch {
    // sign-message unavailable (static deploy, network) → fall through
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
  const actionType = opts?.remove ? (type === "like" ? "unlike" : "unrecast") : type;
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
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: fidNum,
    action: { type: opts?.unfollow ? "unfollow" : "follow", targetFid },
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

export async function hubDeleteCast(
  fid: number | bigint,
  signer: LocalSigner,
  castHash: string,
): Promise<void> {
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: normFid(fid),
    action: { type: "delete-cast", castHash },
  });
}

export async function hubUpdateUserData(
  fid: number | bigint,
  signer: LocalSigner,
  dataType: "pfp" | "display" | "bio",
  value: string,
): Promise<void> {
  await callServer({
    signerPrivateKey: toHex(signer.privateKey),
    fid: normFid(fid),
    action: { type: "update-user-data", dataType, value },
  });
}
