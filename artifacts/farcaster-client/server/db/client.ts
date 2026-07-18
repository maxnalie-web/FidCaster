/**
 * Points/airdrop ledger database — a separate Postgres instance (Replit's
 * built-in Postgres, or any other Postgres) reached via DATABASE_URL. This is
 * intentionally NOT the existing better-sqlite3 profile cache (profile-db.ts)
 * — that's a local read-through cache; this is the durable, append-only
 * action ledger the points/airdrop program is computed from.
 *
 * Every writer in this codebase must go through logUserAction() in
 * actions-ledger.ts, never query `pool` directly, so the append-only
 * guarantee actually holds.
 */

import { Pool } from "pg";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const connectionString = process.env.DATABASE_URL;

export const pool: Pool | null = connectionString
  ? new Pool({
      connectionString,
      // Most managed Postgres (Replit, Neon, Supabase) sit behind a proxy
      // with a cert not in Node's default trust store; require SSL but don't
      // demand chain verification against it.
      ssl: connectionString.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
      max: 10,
    })
  : null;

if (!pool) {
  console.warn("[db] DATABASE_URL not set — points/action ledger is disabled. Set DATABASE_URL to enable it.");
}

export function isDbConfigured(): boolean {
  return pool !== null;
}

let migrated = false;

/** Idempotent — safe to call on every server boot. */
export async function runMigrations(): Promise<void> {
  if (!pool || migrated) return;
  const __dir = dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(resolve(__dir, "schema.sql"), "utf-8");
  await pool.query(sql);
  migrated = true;
  console.log("[db] action ledger schema is up to date");
}
