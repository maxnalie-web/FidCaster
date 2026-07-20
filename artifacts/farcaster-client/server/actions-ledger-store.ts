/**
 * Persistent PostgreSQL ledger of every action worth points for the
 * upcoming airdrop program (cast/like/recast/follow, FID Market trades,
 * Grow/Clean Up campaigns, referrals, mini-app engagement). Append-only:
 * rows are inserted once and never mutated except to flip `verified`/
 * `verified_at` once a background job confirms a row's `proof` against the
 * real hub/chain state.
 *
 * Uses Replit's built-in managed PostgreSQL (DATABASE_URL), same pattern as
 * push-token-store.ts — fails soft everywhere (never throws into a caller,
 * just warns and no-ops) so a missing/unreachable database disables the
 * points program without affecting any other feature.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

function pool(): Pool | null {
  if (!process.env.DATABASE_URL) return null;
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    _pool.on("error", (err) => {
      console.warn("[actions-ledger] pg pool error:", err.message);
    });
  }
  return _pool;
}

export function isActionsLedgerConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Ensure the tables exist (idempotent — called once at startup). */
export async function initActionsLedgerStore(): Promise<void> {
  const p = pool();
  if (!p) {
    console.warn("[actions-ledger] DATABASE_URL not set — points/action ledger is disabled.");
    return;
  }
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS users (
        fid        BIGINT PRIMARY KEY,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen  TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS user_actions (
        id           BIGSERIAL PRIMARY KEY,
        fid          BIGINT NOT NULL REFERENCES users(fid),
        action_type  TEXT NOT NULL,
        payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
        -- message hash (cast/like/recast/follow) or tx hash (market events);
        -- NULL for first-party events (app_open, quest, referral) where the
        -- row itself, written by our own server, is the proof.
        proof        TEXT,
        verified     BOOLEAN NOT NULL DEFAULT false,
        verified_at  TIMESTAMPTZ,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_user_actions_fid_type_created
        ON user_actions (fid, action_type, created_at);

      -- Idempotent inserts: the market-event indexer re-scans overlapping
      -- block ranges every poll, and a client could retry a log call after a
      -- network blip — both must be no-ops on repeat, not duplicate points.
      CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_actions_type_proof
        ON user_actions (action_type, proof) WHERE proof IS NOT NULL;
    `);
    console.log("[actions-ledger] schema is up to date");
  } catch (e) {
    console.warn("[actions-ledger] init error:", (e as Error).message);
  }
}

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
  /** Message hash (protocol actions) or tx hash (market events); omit for first-party events. */
  proof?: string | null;
  /** Set true only when the caller itself IS the source of truth (e.g. the on-chain market indexer). */
  verified?: boolean;
}

/**
 * Insert one ledger row. Safe to call repeatedly with the same
 * (actionType, proof) pair — duplicates are silently ignored, so callers
 * never need to de-dupe themselves. No-ops quietly if DATABASE_URL isn't
 * configured, so this can be called unconditionally from every action path.
 */
export async function logUserAction(params: LogActionParams): Promise<void> {
  const p = pool();
  if (!p) return;
  try {
    await p.query(
      `INSERT INTO users (fid) VALUES ($1) ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
      [params.fid],
    );
    await p.query(
      `INSERT INTO user_actions (fid, action_type, payload, proof, verified, verified_at)
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
    console.warn(`[actions-ledger] logUserAction error (${params.actionType}):`, (e as Error).message);
  }
}
