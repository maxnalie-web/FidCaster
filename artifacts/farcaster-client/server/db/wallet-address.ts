/**
 * Airdrop wallet registration — maps FID → ETH address for Clanker airdrop.
 *
 * Rules:
 *  - One address per FID (upsert).
 *  - Address must be a valid EIP-55 mixed-case or lowercase 0x… address.
 *  - A single ETH address can only be registered by one FID (prevents one
 *    wallet from claiming multiple FID allocations).
 *  - Rows are never deleted; updates track updated_at.
 */

import { getPool } from "./pool.js";

export interface WalletRegistration {
  fid: number;
  address: string;
  registered_at: Date;
  updated_at: Date;
}

const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function isValidAddress(addr: unknown): addr is string {
  return typeof addr === "string" && HEX_ADDRESS_RE.test(addr);
}

/** Ensure the wallet_addresses table exists (called from initLedger). */
export async function initWalletAddresses(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wallet_addresses (
      fid          BIGINT      PRIMARY KEY,
      address      TEXT        NOT NULL,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uniq_wa_address ON wallet_addresses (LOWER(address));
  `);
}

/**
 * Register or update the ETH address for a FID.
 * Returns {ok:true} or {ok:false, reason}.
 */
export async function setWalletAddress(
  fid: number,
  address: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isValidAddress(address)) {
    return { ok: false, reason: "Invalid Ethereum address format" };
  }

  const pool = getPool();
  if (!pool) return { ok: false, reason: "DB not configured" };

  const normalised = address.toLowerCase();

  // Check if this address is already claimed by a DIFFERENT FID
  const { rows: clash } = await pool.query<{ fid: number }>(
    `SELECT fid FROM wallet_addresses WHERE LOWER(address) = $1`,
    [normalised],
  );
  if (clash.length > 0 && clash[0].fid !== fid) {
    return { ok: false, reason: "Address already registered to another FID" };
  }

  await pool.query(
    `INSERT INTO wallet_addresses (fid, address, registered_at, updated_at)
     VALUES ($1, $2, now(), now())
     ON CONFLICT (fid) DO UPDATE SET address = EXCLUDED.address, updated_at = now()`,
    [fid, address],
  );
  return { ok: true };
}

/** Get the registered address for a FID, or null. */
export async function getWalletAddress(fid: number): Promise<WalletRegistration | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query<WalletRegistration>(
    `SELECT fid, address, registered_at, updated_at FROM wallet_addresses WHERE fid = $1`,
    [fid],
  );
  return rows[0] ?? null;
}

/** Count how many FIDs have registered a wallet. */
export async function getRegistrationCount(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { rows } = await pool.query<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM wallet_addresses`);
  return Number(rows[0]?.cnt ?? 0);
}
