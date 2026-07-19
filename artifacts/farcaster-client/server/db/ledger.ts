/**
 * Points/airdrop action ledger.
 *
 * Backed by Replit's managed PostgreSQL (DATABASE_URL). Every action type
 * that earns points - cast, like, recast, follow, FID Market trades, Grow
 * campaigns, referrals - is written here at the moment it happens, from
 * FidCaster's own code, so attribution is first-hand and not reconstructed.
 *
 * Rules:
 *   - logUserAction() is the ONLY write path. Never INSERT directly.
 *   - Rows are never deleted. Set excluded=true to flag fraud.
 *   - proof is mandatory for hub/chain actions; null only for server-origin events.
 *   - Inserts are idempotent: same (action_type, proof) is silently ignored.
 *   - All functions no-op quietly if DATABASE_URL is not set.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "url";
import type { Pool } from "pg";
import { getPool, isDbConfigured } from "./pool.js";

export function isLedgerConfigured(): boolean {
  return isDbConfigured();
}

// ── Migration (idempotent) ────────────────────────────────────────────────────

let _migrated = false;

export async function initLedger(): Promise<void> {
  const pool = getPool();
  if (!pool || _migrated) return;
  try {
    const __dir = dirname(fileURLToPath(import.meta.url));
    const sql = readFileSync(resolve(__dir, "schema.sql"), "utf-8");
    await pool.query(sql);
    _migrated = true;
    console.log("[ledger] schema is up to date");
  } catch (e) {
    console.warn("[ledger] migration failed:", (e as Error).message);
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type ActionType =
  | "cast" | "like" | "unlike" | "recast" | "unrecast"
  | "follow" | "unfollow"
  | "market_list" | "market_buy" | "market_cancel"
  | "grow_campaign_start" | "grow_campaign_complete"
  | "referral" | "quest" | "app_open";

export interface LogActionParams {
  fid: number;
  actionType: ActionType;
  payload?: Record<string, unknown>;
  /** Message hash (hub actions) or tx hash (market). Null for server-origin events. */
  proof?: string | null;
  /**
   * Set true when this server IS the authoritative source (e.g. on-chain market
   * indexer confirmed the tx). Client-reported actions start false and are
   * verified later by the background job.
   */
  verified?: boolean;
}

// ── Writer ────────────────────────────────────────────────────────────────────

async function upsertUser(pool: Pool, fid: number): Promise<void> {
  await pool.query(
    `INSERT INTO users (fid) VALUES ($1)
     ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
    [fid],
  );
}

/**
 * Insert one ledger row. Safe to call multiple times with the same
 * (actionType, proof) - duplicates are silently ignored.
 */
export async function logUserAction(params: LogActionParams): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await upsertUser(pool, params.fid);
    await pool.query(
      `INSERT INTO user_actions
         (fid, action_type, payload, proof, verified, verified_at)
       VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 THEN now() ELSE NULL END)
       ON CONFLICT (action_type, proof) WHERE proof IS NOT NULL DO NOTHING`,
      [
        params.fid,
        params.actionType,
        JSON.stringify(params.payload ?? {}),
        params.proof ?? null,
        params.verified ?? false,
      ],
    );
  } catch (e) {
    console.warn("[ledger] write failed:", (e as Error).message);
  }
}
