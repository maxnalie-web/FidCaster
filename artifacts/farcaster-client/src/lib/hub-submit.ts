/**
 * Farcaster Hub Message Submission — Browser Client
 *
 * Sends actions to our local Express server (/api/farcaster/action).
 * The server uses @farcaster/hub-nodejs to build and sign messages correctly,
 * then submits them to the hub via HTTP.
 *
 * The private key is sent to localhost only (self-hosted app).
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

async function callServer(body: object): Promise<void> {
  const res = await fetch("/api/farcaster/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = JSON.parse(txt).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
  }
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
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    let msg = txt;
    try { msg = JSON.parse(txt).error ?? txt; } catch { /* ok */ }
    throw new Error(msg || `HTTP ${res.status}`);
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
