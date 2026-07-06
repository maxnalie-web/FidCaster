/**
 * At-rest encryption for admin-store.ts's `secrets` table (Neynar key, Imgur
 * client ID, Cloudinary account credentials). Without this, anyone who got
 * read access to admin-store.sqlite on disk — a misconfigured backup, a
 * leaked snapshot, a compromised deploy artifact — could read every API key
 * in plaintext even without ever touching the admin panel itself.
 *
 * Key derivation: scrypt over ADMIN_SESSION_SECRET (falling back to
 * ADMIN_PASSWORD, matching admin-auth.ts's own fallback) — no new required
 * env var, and the same secret that already has to stay private for session
 * signing to be meaningful. A fixed, hardcoded salt is fine here: the salt's
 * job is domain separation (so this KDF output can't be reused as some other
 * derived key), not adding entropy — all the real entropy comes from the
 * deployment's own ADMIN_SESSION_SECRET/ADMIN_PASSWORD.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const KDF_SALT = "fidcaster-admin-secrets-v1";
let _key: Buffer | null = null;

function getKey(): Buffer | null {
  if (_key) return _key;
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD;
  if (!secret) return null;
  _key = scryptSync(secret, KDF_SALT, 32);
  return _key;
}

/** Encrypts to `iv:authTag:ciphertext` (all hex). Returns the plaintext
 * unchanged (with no encryption) if no admin secret is configured yet —
 * that only happens when the admin panel itself is unusable anyway (see
 * isAdminConfigured()), so there's nothing meaningful to protect yet. */
export function encryptSecret(plaintext: string): string {
  const key = getKey();
  if (!key || !plaintext) return plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:${iv.toString("hex")}:${authTag.toString("hex")}:${ciphertext.toString("hex")}`;
}

/** Decrypts a value produced by encryptSecret(). Returns the input unchanged
 * if it isn't in encrypted form (e.g. pre-existing plaintext rows from
 * before this was added, or encryption is currently unavailable) so a
 * missing/rotated key degrades to "can't decrypt" rather than crashing the
 * whole admin panel. */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith("enc:")) return stored;
  const key = getKey();
  if (!key) return "";
  const parts = stored.split(":");
  if (parts.length !== 4) return "";
  try {
    const [, ivHex, authTagHex, cipherHex] = parts;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(cipherHex, "hex")), decipher.final()]);
    return plaintext.toString("utf8");
  } catch (e) {
    console.warn("[secret-crypto] failed to decrypt a stored secret (wrong/rotated key?):", (e as Error).message);
    return "";
  }
}
