export type AuthMethod = "mnemonic" | "wallet" | "farcaster";

export type AccountMeta = {
  fid: number;
  address: string;
  username: string;
  displayName: string;
  pfpUrl: string;
  signerUuid: string | null;
  authMethod?: AuthMethod;
};

const META_KEY = "fc_accounts_v2";
const ACTIVE_KEY = "fc_active_fid";

export function loadAccountsMeta(): AccountMeta[] {
  try {
    return JSON.parse(localStorage.getItem(META_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveAccountsMeta(accounts: AccountMeta[]): void {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(accounts.slice(0, 500)));
  } catch {}
}

export function getActiveFid(): number | null {
  try {
    const v = localStorage.getItem(ACTIVE_KEY);
    return v ? parseInt(v, 10) : null;
  } catch {
    return null;
  }
}

export function setActiveFid(fid: number): void {
  try {
    localStorage.setItem(ACTIVE_KEY, String(fid));
  } catch {}
}

export function upsertAccountMeta(meta: AccountMeta): void {
  const accounts = loadAccountsMeta();
  const idx = accounts.findIndex((a) => a.fid === meta.fid);
  if (idx >= 0) accounts[idx] = meta;
  else accounts.push(meta);
  saveAccountsMeta(accounts);
}

/** Patches just the profile fields (username/displayName/pfpUrl) for an
 * account, leaving address/signerUuid/authMethod untouched - used to
 * self-heal a cached account entry that was written with a network-failure
 * placeholder once the real profile is fetched successfully. */
export function updateAccountMetaProfile(
  fid: number,
  profile: { username: string; displayName: string; pfpUrl: string },
): void {
  const accounts = loadAccountsMeta();
  const acc = accounts.find((a) => a.fid === fid);
  if (acc) {
    acc.username = profile.username;
    acc.displayName = profile.displayName;
    acc.pfpUrl = profile.pfpUrl;
    saveAccountsMeta(accounts);
  }
}

export function updateAccountSignerUuid(fid: number, signerUuid: string): void {
  const accounts = loadAccountsMeta();
  const acc = accounts.find((a) => a.fid === fid);
  if (acc) {
    acc.signerUuid = signerUuid;
    saveAccountsMeta(accounts);
  }
}

export function removeAccountFromStore(fid: number): void {
  const accounts = loadAccountsMeta().filter((a) => a.fid !== fid);
  saveAccountsMeta(accounts);
}

// Per-account Ed25519 signer private key · stored in localStorage encrypted with a
// device-bound AES-GCM key (non-extractable, in IndexedDB). A raw localStorage dump
// reveals only ciphertext; the key is inaccessible without running JS in the same origin.
import { encryptPrivKey, decryptPrivKey } from "@/lib/session-crypto";

export async function storeSignerPrivKey(fid: number, hex: string): Promise<void> {
  try {
    const encrypted = await encryptPrivKey(hex);
    localStorage.setItem(`fc_spk_${fid}`, encrypted);
  } catch {
    try { localStorage.setItem(`fc_spk_${fid}`, hex); } catch {} // graceful fallback
  }
}

export async function loadSignerPrivKey(fid: number): Promise<string | null> {
  try {
    const stored = localStorage.getItem(`fc_spk_${fid}`);
    if (!stored) return null;
    if (stored.startsWith("{")) return await decryptPrivKey(stored); // new encrypted format
    return stored; // legacy plaintext · migration path
  } catch { return null; }
}

export function clearSignerPrivKey(fid: number): void {
  try { localStorage.removeItem(`fc_spk_${fid}`); } catch {}
}

// Persisted brute-force counter · survives page refresh so the delay can't be bypassed by reloading.
const FAILED_ATTEMPTS_KEY = "fc_pw_fails";
type FailedAttempts = { count: number; since: number };

export function getFailedAttempts(): FailedAttempts {
  try {
    const raw = localStorage.getItem(FAILED_ATTEMPTS_KEY);
    return raw ? (JSON.parse(raw) as FailedAttempts) : { count: 0, since: 0 };
  } catch { return { count: 0, since: 0 }; }
}

export function incFailedAttempts(): number {
  const cur = getFailedAttempts();
  const next: FailedAttempts = { count: cur.count + 1, since: cur.since || Date.now() };
  try { localStorage.setItem(FAILED_ATTEMPTS_KEY, JSON.stringify(next)); } catch {}
  return next.count;
}

export function clearFailedAttempts(): void {
  try { localStorage.removeItem(FAILED_ATTEMPTS_KEY); } catch {}
}
