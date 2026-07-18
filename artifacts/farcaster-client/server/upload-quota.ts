/**
 * Per-FID daily upload quota - SQLite-backed, same lightweight pattern as
 * user-prefs.ts. Protects the Cloudinary account from a single account (or
 * script) burning through the monthly credit allowance; real cast/profile
 * usage never comes close to this number.
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);

export const DAILY_UPLOAD_LIMIT = 200;

type Db = {
  getCount: (fid: number, day: string) => number;
  increment: (fid: number, day: string) => number;
};

let _db: Db | null = null;
let _initTried = false;

function initDb(): Db | null {
  try {
    const Database = requireCjs("better-sqlite3");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../upload-quota.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS upload_quota (
        fid   INTEGER NOT NULL,
        day   TEXT    NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (fid, day)
      );
    `);
    // Old days accumulate forever otherwise · trim anything not from today/yesterday.
    const today = new Date().toISOString().slice(0, 10);
    sqlite.prepare("DELETE FROM upload_quota WHERE day < ?").run(today);

    const stmtGet = sqlite.prepare<[number, string], { count: number }>(
      "SELECT count FROM upload_quota WHERE fid = ? AND day = ?",
    );
    const stmtUpsert = sqlite.prepare<[number, string], void>(
      "INSERT INTO upload_quota (fid, day, count) VALUES (?, ?, 1) ON CONFLICT(fid, day) DO UPDATE SET count = count + 1",
    );

    return {
      getCount(fid, day) {
        return stmtGet.get(fid, day)?.count ?? 0;
      },
      increment(fid, day) {
        stmtUpsert.run(fid, day);
        return (stmtGet.get(fid, day)?.count ?? 1);
      },
    };
  } catch (e) {
    console.warn("[upload-quota] disabled (better-sqlite3 unavailable):", (e as Error).message);
    return null;
  }
}

function db(): Db | null {
  if (!_initTried) { _db = initDb(); _initTried = true; }
  return _db;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns true if this FID is still under its daily upload quota. Fails
 * open (allows the upload) if the quota store is unavailable - a missing
 * SQLite dependency shouldn't take uploads down entirely, the per-IP rate
 * limiter on the route is still in effect either way. */
export function isUnderUploadQuota(fid: number): boolean {
  const store = db();
  if (!store) return true;
  return store.getCount(fid, todayStamp()) < DAILY_UPLOAD_LIMIT;
}

export function recordUpload(fid: number): void {
  db()?.increment(fid, todayStamp());
}
