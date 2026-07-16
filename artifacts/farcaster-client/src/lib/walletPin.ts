/**
 * A local PIN gate for sensitive wallet actions (revealing a seed phrase or
 * private key, exporting a key to the clipboard).
 *
 * Previously NOTHING gated those actions — a single tap on "Reveal Recovery
 * Phrase" followed by "Tap to reveal" showed the raw secret, no password, PIN,
 * or biometric prompt anywhere. Anyone with a few seconds of access to an
 * unlocked device (or any XSS elsewhere in the app) had immediate custody of
 * every wallet. This closes that gap: revealing a secret now requires a PIN
 * the user sets the first time they try.
 *
 * Honest limitation: this PIN gates the *UI action*, not the encryption at
 * rest — the underlying mnemonic/private key is still encrypted with the
 * device-bound key in walletSecureStore.ts/session-crypto.ts, not with a key
 * derived from this PIN. That means someone with full arbitrary JS execution
 * in this origin (e.g. a serious XSS bug) could in principle call the wallet
 * store's reveal functions directly and bypass this gate — a client-side
 * check can't fully defend against that. What it DOES stop is the much more
 * common case: casual/opportunistic access to an unlocked device, or a
 * screen-recording/shoulder-surf, where the attacker only has the normal UI
 * to work with. For a native app, prefer wrapping the actual secret
 * encryption key behind the OS keychain + biometric prompt (Keychain/
 * Secure Enclave on iOS, Keystore/BiometricPrompt on Android) so the
 * protection holds even under full app-process compromise — see the
 * handoff notes for details.
 */

const PIN_RECORD_KEY = "wallet_pin_v1";
const PIN_ITERATIONS = 150_000;

interface PinRecord {
  salt: number[];
  hash: number[];
}

async function derivePinHash(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: PIN_ITERATIONS, hash: "SHA-256" },
    base,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function hasWalletPin(): boolean {
  try { return localStorage.getItem(PIN_RECORD_KEY) !== null; } catch { return false; }
}

export async function setWalletPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt);
  const record: PinRecord = { salt: Array.from(salt), hash: Array.from(hash) };
  try { localStorage.setItem(PIN_RECORD_KEY, JSON.stringify(record)); } catch { /* quota */ }
}

export async function verifyWalletPin(pin: string): Promise<boolean> {
  try {
    const raw = localStorage.getItem(PIN_RECORD_KEY);
    if (!raw) return false;
    const record = JSON.parse(raw) as PinRecord;
    const salt = new Uint8Array(record.salt);
    const expected = new Uint8Array(record.hash);
    const actual = await derivePinHash(pin, salt);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function clearWalletPin(): void {
  try { localStorage.removeItem(PIN_RECORD_KEY); } catch { /* ignore */ }
}

// ── lockout after repeated failed attempts ─────────────────────────────────
// In-memory only (resets on reload) — a lightweight brake against rapid
// automated guessing within a single session, not a substitute for the PIN's
// own entropy.

const FAILURE_LIMIT = 5;
const LOCKOUT_MS = 30_000;
let failureCount = 0;
let lockedUntil = 0;

export function pinLockRemainingMs(): number {
  return Math.max(0, lockedUntil - Date.now());
}

export function recordPinFailure(): void {
  failureCount++;
  if (failureCount >= FAILURE_LIMIT) {
    lockedUntil = Date.now() + LOCKOUT_MS;
    failureCount = 0;
  }
}

export function recordPinSuccess(): void {
  failureCount = 0;
  lockedUntil = 0;
}
