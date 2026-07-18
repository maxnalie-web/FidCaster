/**
 * Shared PostgreSQL pool for all action-ledger modules.
 * push-token-store.ts has its own pool (legacy) — all NEW db modules use this one.
 */
import { Pool } from "pg";

let _pool: Pool | null = null;

export function getPool(): Pool | null {
  if (_pool) return _pool;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  _pool = new Pool({
    connectionString: url,
    ssl: url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
    max: 10,
  });
  _pool.on("error", (e) => console.warn("[db/pool] idle client error:", e.message));
  return _pool;
}

export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}
