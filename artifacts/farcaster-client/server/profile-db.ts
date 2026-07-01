/**
 * Persistent SQLite profile cache.
 *
 * Perf guarantees:
 *  1. WAL journal mode — concurrent reads never block writers; writers never block readers.
 *  2. Write batching — requests queue writes for up to 100 ms, then flush in ONE transaction.
 *  3. Bounded queue — Map<FID, …> deduplicates by FID (later write wins per key);
 *     if queue reaches MAX_QUEUE_SIZE, an immediate flush is triggered to cap memory use.
 *  4. Single-flush guard — `isFlushing` prevents overlapping transactions even if an
 *     early-flush and a timer-flush race (better-sqlite3 is sync, so this is belt-and-suspenders).
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { metrics } from "./metrics.js";

const TTL_MS       = 12 * 60 * 60_000; // 12 hours
const MAX_QUEUE    = 500;               // flush early if this many unique FIDs are pending

// ── Lazy-init ────────────────────────────────────────────────────────────────
type Db = {
  get    : (fid: number) => { data: string; cached_at: number } | undefined;
  set    : (fid: number, data: unknown) => void;
  getMany: (fids: number[]) => Map<number, unknown>;
  setMany: (users: Array<{ fid: number; [k: string]: unknown }>) => void;
};

let _db: Db | null = null;

function initDb(): Db | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    const __dir  = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../profile-cache.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS profiles (
        fid       INTEGER PRIMARY KEY,
        data      TEXT    NOT NULL,
        cached_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS profiles_cached_at ON profiles(cached_at);
    `);

    sqlite.prepare("DELETE FROM profiles WHERE cached_at < ?").run(Date.now() - TTL_MS);

    const stmtGet = sqlite.prepare<[number], { data: string; cached_at: number }>(
      "SELECT data, cached_at FROM profiles WHERE fid = ?",
    );
    const stmtUpsert = sqlite.prepare<[number, string, number], void>(
      "INSERT OR REPLACE INTO profiles (fid, data, cached_at) VALUES (?, ?, ?)",
    );
    const stmtBatchUpsert = sqlite.transaction(
      (rows: Array<{ fid: number; data: string; now: number }>) => {
        for (const r of rows) stmtUpsert.run(r.fid, r.data, r.now);
      },
    );

    // ── Bounded write queue ───────────────────────────────────────────────────
    // Map<FID, …> provides free deduplication: if the same FID is written multiple
    // times within the 100 ms window, only the latest value reaches SQLite.
    const pending   = new Map<number, { data: string; now: number }>();
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let isFlushing  = false;

    function doFlush(): void {
      if (isFlushing || pending.size === 0) return;
      isFlushing = true;
      const batch = [...pending.entries()].map(([fid, { data, now }]) => ({ fid, data, now }));
      pending.clear();
      try {
        stmtBatchUpsert(batch);
      } catch (e) {
        console.warn("[profile-db] batch write failed:", (e as Error).message);
      } finally {
        isFlushing = false;
      }
    }

    function scheduleFlush(urgent = false): void {
      metrics.updateSqliteQueue(pending.size);
      if (urgent) {
        // Cancel any pending timer and flush immediately
        if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
        doFlush();
        return;
      }
      if (flushTimer !== null) return;
      flushTimer = setTimeout(() => { flushTimer = null; doFlush(); }, 100);
    }

    return {
      get(fid) { return stmtGet.get(fid); },

      getMany(fids) {
        const result = new Map<number, unknown>();
        if (!fids.length) return result;
        const now = Date.now();
        const placeholders = fids.map(() => "?").join(",");
        const rows = sqlite
          .prepare<number[], { fid: number; data: string; cached_at: number }>(
            `SELECT fid, data, cached_at FROM profiles WHERE fid IN (${placeholders})`,
          )
          .all(...fids);
        for (const row of rows) {
          if (now - row.cached_at <= TTL_MS) result.set(row.fid, JSON.parse(row.data));
        }
        return result;
      },

      set(fid, data) {
        pending.set(fid, { data: JSON.stringify(data), now: Date.now() });
        scheduleFlush(pending.size >= MAX_QUEUE);
      },

      setMany(users) {
        const now = Date.now();
        for (const u of users) pending.set(u.fid, { data: JSON.stringify(u), now });
        scheduleFlush(pending.size >= MAX_QUEUE);
      },
    };
  } catch (e) {
    console.warn("[profile-db] SQLite unavailable:", (e as Error).message);
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

export function getCachedProfiles(fids: number[]): { hits: Map<number, unknown>; misses: number[] } {
  const d = db();
  if (!d) return { hits: new Map(), misses: fids };
  const hits   = d.getMany(fids);
  const misses = fids.filter(f => !hits.has(f));
  return { hits, misses };
}

export function setCachedProfiles(users: Array<{ fid: number; [k: string]: unknown }>): void {
  db()?.setMany(users);
}
