/**
 * Per-account monthly upload counters (SQLite, same lightweight pattern as
 * upload-quota.ts) plus an in-memory failure cooldown, used together to pick
 * the "best" Cloudinary account for the next upload:
 *   1. Skip any account still in its post-failure cooldown window.
 *   2. Among the rest, pick the one with the fewest uploads this month.
 * This is a simple even-load proxy (assumes roughly similar file sizes
 * across uploads rather than tracking real bytes/credits, which would need
 * extra calls to Cloudinary's Admin API) - good enough to keep N accounts
 * roughly balanced without adding latency to the upload path.
 */
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);

const COOLDOWN_MS = 10 * 60_000; // 10 min · long enough to ride out a transient quota/outage blip

type Db = {
  getMonthlyCount: (accountId: number, month: string) => number;
  increment: (accountId: number, month: string) => void;
};

let _db: Db | null = null;
let _initTried = false;

function initDb(): Db | null {
  try {
    const Database = requireCjs("better-sqlite3");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../cloudinary-usage.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS account_usage (
        account_id INTEGER NOT NULL,
        month      TEXT    NOT NULL,
        count      INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, month)
      );
    `);
    const thisMonth = new Date().toISOString().slice(0, 7);
    sqlite.prepare("DELETE FROM account_usage WHERE month < ?").run(thisMonth);

    const stmtGet = sqlite.prepare<[number, string], { count: number }>(
      "SELECT count FROM account_usage WHERE account_id = ? AND month = ?",
    );
    const stmtUpsert = sqlite.prepare<[number, string], void>(
      "INSERT INTO account_usage (account_id, month, count) VALUES (?, ?, 1) ON CONFLICT(account_id, month) DO UPDATE SET count = count + 1",
    );

    return {
      getMonthlyCount(accountId, month) {
        return stmtGet.get(accountId, month)?.count ?? 0;
      },
      increment(accountId, month) {
        stmtUpsert.run(accountId, month);
      },
    };
  } catch (e) {
    console.warn("[cloudinary-usage] disabled (better-sqlite3 unavailable):", (e as Error).message);
    return null;
  }
}

function db(): Db | null {
  if (!_initTried) { _db = initDb(); _initTried = true; }
  return _db;
}

function thisMonthStamp(): string {
  return new Date().toISOString().slice(0, 7);
}

export function monthlyUploadCount(accountId: number): number {
  return db()?.getMonthlyCount(accountId, thisMonthStamp()) ?? 0;
}

export function recordAccountUpload(accountId: number): void {
  db()?.increment(accountId, thisMonthStamp());
}

// ── Failure cooldown (in-memory, per-process - resets on restart, which is
// fine: a fresh process deserves a clean shot at every account) ────────────
const cooldownUntil = new Map<number, number>();

export function markAccountFailure(accountId: number): void {
  cooldownUntil.set(accountId, Date.now() + COOLDOWN_MS);
}

export function isAccountInCooldown(accountId: number): boolean {
  const until = cooldownUntil.get(accountId);
  return until !== undefined && Date.now() < until;
}
