const DB_NAME = "fc_vault";
const STORE_NAME = "sessions";
const KEY_STORE_NAME = "derived_keys"; // non-extractable CryptoKey objects
const SESSION_KEY = "session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 200_000;

interface StoredSession {
  salt: number[];
  iv: number[];
  ciphertext: number[];
  expiresAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) db.createObjectStore(KEY_STORE_NAME);
      void e; // suppress unused-var lint
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── CryptoKey store — persists the non-extractable derived key across page reloads ──
// Structured clone stores the CryptoKey object natively; extractable:false means
// the raw bytes can never be read back, only used for encrypt/decrypt operations.

async function putCryptoKey(storeKey: string, key: CryptoKey): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE_NAME, "readwrite");
      tx.objectStore(KEY_STORE_NAME).put(key, storeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

async function getCryptoKey(storeKey: string): Promise<CryptoKey | null> {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(KEY_STORE_NAME, "readonly");
      const req = tx.objectStore(KEY_STORE_NAME).get(storeKey);
      req.onsuccess = () => resolve((req.result as CryptoKey) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

async function deleteCryptoKey(storeKey: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(KEY_STORE_NAME, "readwrite");
      tx.objectStore(KEY_STORE_NAME).delete(storeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

// ── Device key — a random AES-GCM key generated once per browser profile.
// Stored as non-extractable in IndexedDB. Used to encrypt signer private keys
// at rest in localStorage, protecting against localStorage-dump attacks.
const DEVICE_KEY_NAME = "fc_device_key";

async function getOrCreateDeviceKey(): Promise<CryptoKey> {
  const existing = await getCryptoKey(DEVICE_KEY_NAME);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  await putCryptoKey(DEVICE_KEY_NAME, key);
  return key;
}

export async function encryptPrivKey(hex: string): Promise<string> {
  const key = await getOrCreateDeviceKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(hex));
  return JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
  });
}

export async function decryptPrivKey(encrypted: string): Promise<string | null> {
  try {
    const { iv: ivB64, ct: ctB64 } = JSON.parse(encrypted) as { iv: string; ct: string };
    const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB64), (c) => c.charCodeAt(0));
    const key = await getOrCreateDeviceKey();
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

async function decryptWithKey(stored: StoredSession, key: CryptoKey): Promise<string | null> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(stored.iv) },
      key,
      new Uint8Array(stored.ciphertext),
    );
    return new TextDecoder().decode(plain);
  } catch { return null; }
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as unknown as ArrayBuffer, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptMnemonic(mnemonic: string, password: string): Promise<StoredSession> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const encoded = enc.encode(mnemonic);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  encoded.fill(0);
  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(ciphertext)),
    expiresAt: Date.now() + TTL_MS,
  };
}

async function decryptSession(stored: StoredSession, password: string): Promise<string | null> {
  try {
    const salt = new Uint8Array(stored.salt);
    const iv = new Uint8Array(stored.iv);
    const ciphertext = new Uint8Array(stored.ciphertext);
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

async function putRecord(dbKey: string, value: StoredSession): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(value, dbKey);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getRecord(dbKey: string): Promise<StoredSession | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(dbKey);
    req.onsuccess = () => resolve(req.result as StoredSession | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function deleteRecord(dbKey: string): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(dbKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {}
}

export async function encryptAndStore(mnemonic: string, password: string): Promise<void> {
  const stored = await encryptMnemonic(mnemonic, password);
  await putRecord(SESSION_KEY, stored);
  // Cache the derived key (non-extractable) so refresh works without the raw password.
  const key = await deriveKey(password, new Uint8Array(stored.salt));
  await putCryptoKey(SESSION_KEY, key);
}

export async function decryptStored(password: string): Promise<string | null> {
  const stored = await getRecord(SESSION_KEY);
  if (!stored) return null;
  if (stored.expiresAt < Date.now()) {
    await clearStoredSession();
    return null;
  }
  const mnemonic = await decryptSession(stored, password);
  if (mnemonic) {
    // Cache derived key for next restore (migration path: user had old sessionStorage password).
    const key = await deriveKey(password, new Uint8Array(stored.salt));
    await putCryptoKey(SESSION_KEY, key);
  }
  return mnemonic;
}

/** Decrypt using the cached CryptoKey — no password required. Works across page refreshes. */
export async function decryptStoredAuto(): Promise<string | null> {
  const stored = await getRecord(SESSION_KEY);
  if (!stored || stored.expiresAt < Date.now()) return null;
  const key = await getCryptoKey(SESSION_KEY);
  if (!key) return null;
  return decryptWithKey(stored, key);
}

export async function hasStoredSession(): Promise<boolean> {
  try {
    const stored = await getRecord(SESSION_KEY);
    if (stored && stored.expiresAt > Date.now()) return true;
    // Also check the per-account key used by storeAccountMnemonic (new format)
    const activeFidStr = localStorage.getItem("fc_active_fid");
    if (activeFidStr) {
      const acct = await getRecord(`account_${activeFidStr}`);
      if (acct && acct.expiresAt > Date.now()) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export async function clearStoredSession(): Promise<void> {
  await Promise.all([deleteRecord(SESSION_KEY), deleteCryptoKey(SESSION_KEY)]);
}

export async function storeAccountMnemonic(fid: number, mnemonic: string, password: string): Promise<void> {
  const stored = await encryptMnemonic(mnemonic, password);
  await putRecord(`account_${fid}`, stored);
  const key = await deriveKey(password, new Uint8Array(stored.salt));
  await putCryptoKey(`account_${fid}`, key);
}

export async function loadAccountMnemonic(fid: number, password: string): Promise<string | null> {
  const stored = await getRecord(`account_${fid}`);
  if (!stored) return null;
  if (stored.expiresAt < Date.now()) {
    await deleteRecord(`account_${fid}`);
    return null;
  }
  const mnemonic = await decryptSession(stored, password);
  if (mnemonic) {
    const key = await deriveKey(password, new Uint8Array(stored.salt));
    await putCryptoKey(`account_${fid}`, key);
  }
  return mnemonic;
}

/** Load account mnemonic using cached CryptoKey — no password required. */
export async function loadAccountMnemonicAuto(fid: number): Promise<string | null> {
  const stored = await getRecord(`account_${fid}`);
  if (!stored || stored.expiresAt < Date.now()) return null;
  const key = await getCryptoKey(`account_${fid}`);
  if (!key) return null;
  return decryptWithKey(stored, key);
}

export async function removeAccountMnemonic(fid: number): Promise<void> {
  await Promise.all([deleteRecord(`account_${fid}`), deleteCryptoKey(`account_${fid}`)]);
}

// ---------------------------------------------------------------------------
// Light session — non-sensitive persistence for wallet and SIWF logins.
// Stores only public metadata (FID, address, authMethod, profile snapshot).
// Never stores private keys or seed phrases.
// ---------------------------------------------------------------------------

export type LightSession = {
  fid: number;
  address: string | null;
  authMethod: "wallet" | "farcaster" | "mnemonic";
  username: string;
  displayName: string;
  pfpUrl: string;
  signerUuid?: string | null;
  // signerPrivKey intentionally omitted — stored separately in sessionStorage via storeSignerPrivKey()
  expiresAt: number;
};

const LIGHT_SESSION_KEY = "fc_light_session";
const LIGHT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function storeLightSession(session: Omit<LightSession, "expiresAt">): void {
  try {
    const full: LightSession = { ...session, expiresAt: Date.now() + LIGHT_SESSION_TTL_MS };
    localStorage.setItem(LIGHT_SESSION_KEY, JSON.stringify(full));
  } catch {}
}

export function loadLightSession(): LightSession | null {
  try {
    const raw = localStorage.getItem(LIGHT_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LightSession;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(LIGHT_SESSION_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearLightSession(): void {
  try { localStorage.removeItem(LIGHT_SESSION_KEY); } catch {}
}
