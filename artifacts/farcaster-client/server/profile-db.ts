/**
 * Persistent SQLite profile cache.
 *
 * Why:  The server in-memory cache (cache.ts) resets on every restart/deploy.
 *       With 1 000 users each having a unique FID, per-user lookups produce zero
 *       cross-user cache sharing.  Profiles change rarely (pfp, bio, display name);
 *       a 12-hour SQLite-backed cache survives restarts and is shared across all
 *       users — one lookup populates the DB for everyone who visits that FID next.
 *
 * TTL:  12 hours.  Profile data (pfp, bio, follower counts) is stale-safe at this
 *       window because Farcaster social graphs change slowly and any write action
 *       (follow, update-profile) bypasses cache entirely.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const TTL_MS = 12 * 60 * 60_000; // 12 hours

// ── Lazy-init so import never crashes if SQLite is unavailable ──────────────
type Db = {
  get: (fid: number) => { data: string; cached_at: number } | undefined;
  set: (fid: number, data: unknown) => void;
  getMany: (fids: number[]) => Map<number, unknown>;
  setMany: (users: Array<{ fid: number; [k: string]: unknown }>) => void;
};

let _db: Db | null = null;

function initDb(): Db | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../profile-cache.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        fid       INTEGER PRIMARY KEY,
        data      TEXT    NOT NULL,
        cached_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS profiles_cached_at ON profiles(cached_at);
    `);

    // Evict expired rows on startup (keep DB small)
    sqlite.prepare("DELETE FROM profiles WHERE cached_at < ?").run(Date.now() - TTL_MS);

    const stmtGet   = sqlite.prepare<[number], { data: string; cached_at: number }>(
      "SELECT data, cached_at FROM profiles WHERE fid = ?"
    );
    const stmtUpsert = sqlite.prepare<[number, string, number], void>(
      "INSERT OR REPLACE INTO profiles (fid, data, cached_at) VALUES (?, ?, ?)"
    );
    const stmtBatchUpsert = sqlite.transaction(
      (rows: Array<{ fid: number; data: string; now: number }>) => {
        for (const r of rows) stmtUpsert.run(r.fid, r.data, r.now);
      }
    );

    return {
      get(fid) {
        return stmtGet.get(fid);
      },
      set(fid, data) {
        stmtUpsert.run(fid, JSON.stringify(data), Date.now());
      },
      getMany(fids) {
        const result = new Map<number, unknown>();
        if (!fids.length) return result;
        const now = Date.now();
        const placeholders = fids.map(() => "?").join(",");
        const rows = sqlite
          .prepare<number[], { fid: number; data: string; cached_at: number }>(
            `SELECT fid, data, cached_at FROM profiles WHERE fid IN (${placeholders})`
          )
          .all(...fids);
        for (const row of rows) {
          if (now - row.cached_at <= TTL_MS) result.set(row.fid, JSON.parse(row.data));
        }
        return result;
      },
      setMany(users) {
        const now = Date.now();
        stmtBatchUpsert(users.map(u => ({ fid: u.fid, data: JSON.stringify(u), now })));
      },
    };
  } catch (e) {
    console.warn("[profile-db] SQLite unavailable, falling back to in-memory only:", (e as Error).message);
    return null;
  }
}

function db(): Db | null {
  if (_db === null) _db = initDb();
  return _db;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getCachedProfile(fid: number): unknown | null {
  const d = db();
  if (!d) return null;
  const row = d.get(fid);
  if (!row) return null;
  if (Date.now() - row.cached_at > TTL_MS) return null;
  try { return JSON.parse(row.data); } catch { return null; }
}

export function setCachedProfile(fid: number, data: unknown): void {
  db()?.set(fid, data);
}

/**
 * Bulk lookup: returns {hits, misses}.
 * hits  = Map<fid, profileData> for FIDs found in SQLite within TTL
 * misses = FIDs that must be fetched from Neynar
 */
export function getCachedProfiles(fids: number[]): { hits: Map<number, unknown>; misses: number[] } {
  const d = db();
  if (!d) return { hits: new Map(), misses: fids };
  const hits = d.getMany(fids);
  const misses = fids.filter(f => !hits.has(f));
  return { hits, misses };
}

export function setCachedProfiles(users: Array<{ fid: number; [k: string]: unknown }>): void {
  db()?.setMany(users);
}
