/**
 * Single write path for the points/airdrop action ledger (user_actions).
 * Every action type FidCaster ever rewards points for — cast/like/recast/
 * follow, FID Market trades, Grow campaigns, referrals, mini-app engagement —
 * is logged here, at the moment it happens, from FidCaster's own code. See
 * the airdrop plan doc's "Attribution" section for why this table exists and
 * what `proof` means for each action_type.
 */

import { pool, isDbConfigured } from "./client.js";

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
  /** Message hash (protocol actions) or tx hash (market events); null for first-party events. */
  proof?: string | null;
  /** Set true only when the caller itself IS the source of truth (e.g. the on-chain market indexer). */
  verified?: boolean;
}

export async function upsertUser(fid: number): Promise<void> {
  if (!pool) return;
  await pool.query(
    `INSERT INTO users (fid) VALUES ($1)
     ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
    [fid],
  );
}

/**
 * Insert one ledger row. Safe to call multiple times with the same
 * (actionType, proof) pair — duplicates are silently ignored (see the
 * unique index in schema.sql), so callers never need to de-dupe themselves.
 * No-ops quietly if DATABASE_URL isn't configured, so this can be called
 * unconditionally from every action path without an availability check at
 * every call site.
 */
export async function logUserAction(params: LogActionParams): Promise<void> {
  if (!isDbConfigured() || !pool) return;
  await upsertUser(params.fid);
  await pool.query(
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
}
