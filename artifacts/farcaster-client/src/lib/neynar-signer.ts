/**
 * Neynar Managed Signer · create, approve, and persist.
 * This approach avoids on-chain registration (no ETH needed).
 * The user approves once in Warpcast; after that all writes use the JSON API.
 */

const BASE = "https://api.neynar.com/v2/farcaster";
const STORAGE_PREFIX = "fc_nsigner_";
const APPROVAL_PREFIX = "fc_nsigner_ok_";

export type NeynarSignerStatus = "generated" | "pending_approval" | "approved" | "revoked";

export type NeynarSignerInfo = {
  signer_uuid: string;
  public_key: string;
  status: NeynarSignerStatus;
  fid?: number;
  signer_approval_url?: string;
};

function storageKey(fid: number): string { return STORAGE_PREFIX + fid; }
function approvalKey(fid: number): string { return APPROVAL_PREFIX + fid; }

export function loadNeynarSigner(fid: number): NeynarSignerInfo | null {
  try {
    const raw = localStorage.getItem(storageKey(fid));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function saveNeynarSigner(fid: number, info: NeynarSignerInfo): void {
  try { localStorage.setItem(storageKey(fid), JSON.stringify(info)); } catch {}
}

export function clearNeynarSigner(fid: number): void {
  try {
    localStorage.removeItem(storageKey(fid));
    localStorage.removeItem(approvalKey(fid));
  } catch {}
}

export function isSignerApproved(fid: number): boolean {
  try { return localStorage.getItem(approvalKey(fid)) === "1"; } catch { return false; }
}

export function markSignerApproved(fid: number): void {
  try { localStorage.setItem(approvalKey(fid), "1"); } catch {}
}

/** Create a new Neynar managed signer for this user */
export async function createNeynarSigner(neynarKey: string): Promise<NeynarSignerInfo> {
  const res = await fetch(`${BASE}/signer`, {
    method: "POST",
    headers: { "api_key": neynarKey },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to create signer: HTTP ${res.status} · ${txt}`);
  }
  return res.json() as Promise<NeynarSignerInfo>;
}

/** Check current status of a managed signer */
export async function checkNeynarSigner(signerUuid: string, neynarKey: string): Promise<NeynarSignerInfo> {
  const res = await fetch(`${BASE}/signer?signer_uuid=${encodeURIComponent(signerUuid)}`, {
    headers: { "api_key": neynarKey },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Failed to check signer: HTTP ${res.status} · ${txt}`);
  }
  return res.json() as Promise<NeynarSignerInfo>;
}

/** Warpcast approval deep-link URL */
export function getWarpcastApprovalUrl(signerInfo: NeynarSignerInfo): string {
  if (signerInfo.signer_approval_url) return signerInfo.signer_approval_url;
  return `https://client.warpcast.com/deeplinks/signed-key-request?token=${signerInfo.signer_uuid}`;
}
