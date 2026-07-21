/**
 * Request authentication — binds a request to a real fid instead of
 * trusting a client-supplied `fid` field.
 *
 * Two surfaces, two mechanisms, one shared result (a trusted fid):
 *
 *  1. Mini app: Farcaster Quick Auth. The client calls
 *     sdk.quickAuth.getToken() (no user action — the host client, which
 *     the user is already signed into, issues it silently) and sends it
 *     as `Authorization: Bearer <jwt>`. Verified against Farcaster's own
 *     Quick Auth server via @farcaster/quick-auth.
 *
 *  2. Main site (all three login flows — Sign in with Farcaster, Sign in
 *     with Wallet, Sign in with Seed — converge on the same local Ed25519
 *     signer): right after login the client signs a server-issued nonce
 *     with that signer and exchanges it for a session token here. We
 *     verify the signature, then independently confirm the signing key is
 *     a currently-active signer for that fid by reading Farcaster's
 *     on-chain Key Registry (Optimism) — so a client can't just claim an
 *     arbitrary keypair belongs to a given fid.
 *
 * Rollout note: routes call `getTrustedFid(req)` and treat a null result
 * as "no token" rather than failing the request outright, UNLESS a token
 * WAS present and its fid doesn't match the caller's claimed fid — that
 * mismatch is rejected unconditionally. This lets the auth requirement
 * tighten to "token required" later, once real-client testing confirms
 * every surface reliably sends one, without breaking existing traffic
 * from clients that haven't picked up the change yet.
 */
import type { Request } from "express";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { createClient as createQuickAuthClient } from "@farcaster/quick-auth";
import { createPublicClient, http, fallback } from "viem";
import { optimism } from "viem/chains";

const APP_DOMAIN = process.env.APP_DOMAIN || "fidcaster.xyz";
const quickAuthClient = createQuickAuthClient();

// ── Session secret ──────────────────────────────────────────────────────────
// Generated at boot if unset. Sessions won't survive a restart in that case
// (fine — the client silently re-establishes one), but nothing crashes.
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
if (!process.env.SESSION_SECRET) {
  console.warn("[auth] SESSION_SECRET not set — using a random per-boot secret (sessions reset on restart)");
}
const SESSION_TTL_MS = 24 * 3_600_000; // 24h

// ── Nonce store (short-lived, single-use, in-memory) ─────────────────────────
const NONCE_TTL_MS = 5 * 60_000;
const _nonces = new Map<string, { fid: number; expiresAt: number }>();

function cleanupNonces(): void {
  const now = Date.now();
  for (const [n, v] of _nonces) if (v.expiresAt < now) _nonces.delete(n);
}

export function generateAuthNonce(fid: number): string {
  cleanupNonces();
  const nonce = randomBytes(16).toString("hex");
  _nonces.set(nonce, { fid, expiresAt: Date.now() + NONCE_TTL_MS });
  return nonce;
}

// ── Key Registry (Optimism) — confirms a pubkey is really registered to a fid
const KEY_REGISTRY_ADDRESS = "0x00000000Fc1237824fb747aBDE0FF18990E59b7e" as const;
const optimismClient = createPublicClient({
  chain: optimism,
  transport: fallback(
    ["https://mainnet.optimism.io", "https://optimism.llamarpc.com", "https://optimism.drpc.org"]
      .map((url) => http(url, { timeout: 12_000, retryCount: 1 })),
    { rank: true },
  ),
});
const keyDataOfAbi = [{
  name: "keyDataOf", type: "function", stateMutability: "view",
  inputs: [{ name: "fid", type: "uint256" }, { name: "key", type: "bytes" }],
  outputs: [{
    name: "", type: "tuple", components: [
      { name: "state", type: "uint8" }, { name: "keyType", type: "uint32" },
    ],
  }],
}] as const;

const KEY_STATE_ADDED = 1;

async function isActiveSignerForFid(fid: number, publicKeyHex: string): Promise<boolean> {
  try {
    const key = (publicKeyHex.startsWith("0x") ? publicKeyHex : `0x${publicKeyHex}`) as `0x${string}`;
    const data = await optimismClient.readContract({
      address: KEY_REGISTRY_ADDRESS, abi: keyDataOfAbi, functionName: "keyDataOf",
      args: [BigInt(fid), key],
    }) as { state: number; keyType: number };
    return data.state === KEY_STATE_ADDED;
  } catch (e) {
    console.warn(`[auth] KeyRegistry check failed for fid ${fid}:`, (e as Error).message);
    return false;
  }
}

// ── Session token: HMAC-signed, not a full JWT (no external verifier needs
//    to read it — it's only ever checked by this same server). ────────────
function signSessionToken(fid: number, expiresAt: number): string {
  const payload = `${fid}.${expiresAt}`;
  const sig = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(`${payload}.${sig}`).toString("base64url");
}

function verifySessionToken(token: string): number | null {
  try {
    const decoded = Buffer.from(token, "base64url").toString("utf-8");
    const parts = decoded.split(".");
    if (parts.length !== 3) return null;
    const [fidStr, expStr, sig] = parts;
    const payload = `${fidStr}.${expStr}`;
    const expected = createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
    const expiresAt = Number(expStr);
    if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
    const fid = Number(fidStr);
    return Number.isFinite(fid) && fid > 0 ? fid : null;
  } catch {
    return null;
  }
}

/**
 * Handles POST /api/auth/session. Verifies the nonce + signature, then
 * confirms the signing key is really an active signer for the claimed fid
 * before issuing a token.
 */
export async function createSession(params: {
  fid: number; publicKeyHex: string; nonce: string; signatureHex: string;
}): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const { fid, publicKeyHex, nonce, signatureHex } = params;

  cleanupNonces();
  const entry = _nonces.get(nonce);
  if (!entry || entry.fid !== fid) return { ok: false, reason: "invalid_or_expired_nonce" };
  _nonces.delete(nonce); // one-time use

  try {
    const pubKeyBytes = Uint8Array.from(Buffer.from(publicKeyHex.replace(/^0x/, ""), "hex"));
    const sigBytes = Uint8Array.from(Buffer.from(signatureHex.replace(/^0x/, ""), "hex"));
    const msgBytes = new TextEncoder().encode(nonce);
    if (!ed25519.verify(sigBytes, msgBytes, pubKeyBytes)) {
      return { ok: false, reason: "bad_signature" };
    }
  } catch {
    return { ok: false, reason: "bad_signature" };
  }

  const isActive = await isActiveSignerForFid(fid, publicKeyHex);
  if (!isActive) return { ok: false, reason: "key_not_registered_to_fid" };

  const expiresAt = Date.now() + SESSION_TTL_MS;
  return { ok: true, token: signSessionToken(fid, expiresAt) };
}

// ── Combined resolver used by routes ─────────────────────────────────────────
export interface TrustedFidResult {
  /** fid proven by a verified token, or null if no valid token was present. */
  fid: number | null;
  /** true if a token WAS present but failed verification or didn't match — caller should reject. */
  invalidToken: boolean;
}

export async function getTrustedFid(req: Request): Promise<TrustedFidResult> {
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Bearer ")) return { fid: null, invalidToken: false };
  const token = auth.slice("Bearer ".length).trim();
  if (!token) return { fid: null, invalidToken: false };

  // Try our own session token first (cheap, local, no network call).
  const sessionFid = verifySessionToken(token);
  if (sessionFid !== null) return { fid: sessionFid, invalidToken: false };

  // Fall back to Quick Auth (mini app).
  try {
    const payload = await quickAuthClient.verifyJwt({ token, domain: APP_DOMAIN });
    return { fid: payload.sub, invalidToken: false };
  } catch {
    // Token present but neither verifier accepted it — this is a real
    // mismatch/forgery attempt, not "no auth provided".
    return { fid: null, invalidToken: true };
  }
}
