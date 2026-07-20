/**
 * Main-site session token.
 *
 * All three login flows (Sign in with Farcaster, Sign in with Wallet,
 * Sign in with Seed) converge on the same primitive: a local Ed25519
 * signer approved for the user's fid. Right after login, we sign a
 * server-issued nonce with that signer (no extra user action — it's not
 * a new prompt, it's automatic) and exchange it for a short-lived session
 * token. Callers that need to prove "this request is really from fid X"
 * (hub-submit.ts's ledger reporting) attach this token as a bearer header
 * instead of letting the server trust a client-supplied fid.
 *
 * Best-effort: if establishing a session fails for any reason (offline,
 * server hiccup, non-approved signer yet), we silently stay without a
 * token. The server treats a missing token as "unauthenticated" rather
 * than rejecting the request outright, so this can never block a login
 * or a cast/like/follow from working.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import type { LocalSigner } from "./wallet";

let _token: string | null = null;
let _tokenFid: number | null = null;

export function getSessionToken(fid: number): string | null {
  return _tokenFid === fid ? _token : null;
}

export function clearSession(): void {
  _token = null;
  _tokenFid = null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function establishSession(fid: number, signer: LocalSigner): Promise<void> {
  try {
    const nonceRes = await fetch(`/api/auth/nonce?fid=${fid}`, { signal: AbortSignal.timeout(8_000) });
    if (!nonceRes.ok) return;
    const { nonce } = await nonceRes.json() as { nonce?: string };
    if (!nonce) return;

    const signature = ed25519.sign(new TextEncoder().encode(nonce), signer.privateKey);

    const sessionRes = await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fid,
        publicKeyHex: signer.publicKeyHex,
        nonce,
        signatureHex: toHex(signature),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!sessionRes.ok) return;
    const { token } = await sessionRes.json() as { token?: string };
    if (!token) return;

    _token = token;
    _tokenFid = fid;
  } catch (e) {
    console.warn("[session] establishSession failed (non-fatal):", e);
  }
}
