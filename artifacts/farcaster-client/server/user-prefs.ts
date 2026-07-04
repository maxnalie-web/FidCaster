/**
 * Small per-FID key-value store, backed by SQLite, so per-account UI data
 * (currently: Custom Feeds) survives a browser switch or a cleared cache
 * instead of living only in that one browser's localStorage.
 *
 * Trust model: there's no server-side session/auth layer in this app (writes
 * to Farcaster itself are authenticated by the user's own signer, entirely
 * client-side) · a request here is trusted to say which FID it's acting for,
 * the same way /api/pro-status and other read endpoints already work. This
 * is fine for what's stored here (feed preferences, not funds or identity)
 * · each PUT fully replaces that FID's value for the given key, so the last
 * device to save wins.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);

type Db = {
  get: (fid: number, key: string) => string | undefined;
  set: (fid: number, key: string, value: string) => void;
};

let _db: Db | null = null;
let _initTried = false;

function initDb(): Db | null {
  try {
    const Database = requireCjs("better-sqlite3");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../user-prefs.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS user_prefs (
        fid        INTEGER NOT NULL,
        key        TEXT    NOT NULL,
        value      TEXT    NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (fid, key)
      );
    `);

    const stmtGet = sqlite.prepare<[number, string], { value: string }>(
      "SELECT value FROM user_prefs WHERE fid = ? AND key = ?",
    );
    const stmtSet = sqlite.prepare<[number, string, string, number], void>(
      "INSERT OR REPLACE INTO user_prefs (fid, key, value, updated_at) VALUES (?, ?, ?, ?)",
    );

    return {
      get(fid, key) { return stmtGet.get(fid, key)?.value; },
      set(fid, key, value) { stmtSet.run(fid, key, value, Date.now()); },
    };
  } catch (e) {
    console.warn("[user-prefs] SQLite unavailable:", (e as Error).message);
    return null;
  }
}

function db(): Db | null {
  if (!_initTried) { _initTried = true; _db = initDb(); }
  return _db;
}

const MAX_VALUE_BYTES = 3_000_000; // headroom for several custom feeds, each with a ~1MB logo data-URL
const ALLOWED_KEYS = new Set(["custom_feeds"]);

export function getUserPref(fid: number, key: string): string | undefined {
  return db()?.get(fid, key);
}

export function setUserPref(fid: number, key: string, value: string): { ok: true } | { ok: false; error: string } {
  if (!ALLOWED_KEYS.has(key)) return { ok: false, error: "Unknown key" };
  if (value.length > MAX_VALUE_BYTES) return { ok: false, error: "Value too large" };
  const store = db();
  if (!store) return { ok: false, error: "Storage unavailable" };
  store.set(fid, key, value);
  return { ok: true };
}
