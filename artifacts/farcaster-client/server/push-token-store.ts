/**
 * Persistent PostgreSQL store for registered push tokens, keyed by (fid, token).
 * Uses Replit's built-in managed PostgreSQL (DATABASE_URL) so tokens survive
 * autoscale cold-starts and redeployments — unlike the old SQLite store which
 * lived on an ephemeral filesystem that was wiped between instances.
 */

import { Pool } from "pg";

let _pool: Pool | null = null;

function pool(): Pool {
  if (!_pool) {
    _pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    _pool.on("error", (err) => {
      console.warn("[push-token-store] pg pool error:", err.message);
    });
  }
  return _pool;
}

/** Ensure the table exists (idempotent — called once at startup). */
export async function initPushTokenStore(): Promise<void> {
  try {
    await pool().query(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        fid        INTEGER NOT NULL,
        token      TEXT    NOT NULL,
        platform   TEXT    NOT NULL DEFAULT 'android',
        updated_at BIGINT  NOT NULL,
        PRIMARY KEY (fid, token)
      );
      CREATE INDEX IF NOT EXISTS push_tokens_fid ON push_tokens(fid);
    `);
  } catch (e) {
    console.warn("[push-token-store] init error:", (e as Error).message);
  }
}

export async function addPushToken(fid: number, token: string, platform: string): Promise<void> {
  try {
    await pool().query(
      `INSERT INTO push_tokens (fid, token, platform, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (fid, token) DO UPDATE
         SET platform = EXCLUDED.platform, updated_at = EXCLUDED.updated_at`,
      [fid, token, platform, Date.now()],
    );
  } catch (e) {
    console.warn("[push-token-store] addPushToken error:", (e as Error).message);
  }
}

export async function removePushToken(fid: number, token: string): Promise<void> {
  try {
    await pool().query("DELETE FROM push_tokens WHERE fid = $1 AND token = $2", [fid, token]);
  } catch (e) {
    console.warn("[push-token-store] removePushToken error:", (e as Error).message);
  }
}

export async function getPushTokensForFid(fid: number): Promise<string[]> {
  try {
    const { rows } = await pool().query<{ token: string }>(
      "SELECT token FROM push_tokens WHERE fid = $1",
      [fid],
    );
    return rows.map((r) => r.token);
  } catch (e) {
    console.warn("[push-token-store] getPushTokensForFid error:", (e as Error).message);
    return [];
  }
}

export async function getAllRegisteredFids(): Promise<number[]> {
  try {
    const { rows } = await pool().query<{ fid: number }>(
      "SELECT DISTINCT fid FROM push_tokens",
    );
    return rows.map((r) => r.fid);
  } catch (e) {
    console.warn("[push-token-store] getAllRegisteredFids error:", (e as Error).message);
    return [];
  }
}

export async function pruneInvalidTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  try {
    await pool().query(
      "DELETE FROM push_tokens WHERE token = ANY($1::text[])",
      [tokens],
    );
  } catch (e) {
    console.warn("[push-token-store] pruneInvalidTokens error:", (e as Error).message);
  }
}
