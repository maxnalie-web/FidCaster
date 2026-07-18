/**
 * Persistent SQLite store for registered push tokens, keyed by (fid, token).
 * Mirrors the WAL + better-sqlite3 pattern already used by profile-db.ts.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const requireCjs = createRequire(import.meta.url);

type Db = {
  add: (fid: number, token: string, platform: string) => void;
  remove: (fid: number, token: string) => void;
  tokensForFid: (fid: number) => string[];
  tokensForFids: (fids: number[]) => Map<number, string[]>;
  distinctFids: () => number[];
  removeTokens: (tokens: string[]) => void;
};

let _db: Db | null = null;
let _initTried = false;

function initDb(): Db | null {
  try {
    const Database = requireCjs("better-sqlite3");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../push-tokens.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS push_tokens (
        fid        INTEGER NOT NULL,
        token      TEXT    NOT NULL,
        platform   TEXT    NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (fid, token)
      );
      CREATE INDEX IF NOT EXISTS push_tokens_fid ON push_tokens(fid);
    `);

    const stmtAdd = sqlite.prepare(
      "INSERT OR REPLACE INTO push_tokens (fid, token, platform, updated_at) VALUES (?, ?, ?, ?)",
    );
    const stmtRemove = sqlite.prepare("DELETE FROM push_tokens WHERE fid = ? AND token = ?");
    const stmtByFid = sqlite.prepare<[number], { token: string }>(
      "SELECT token FROM push_tokens WHERE fid = ?",
    );
    const stmtDistinctFids = sqlite.prepare<[], { fid: number }>(
      "SELECT DISTINCT fid FROM push_tokens",
    );
    const stmtRemoveToken = sqlite.prepare("DELETE FROM push_tokens WHERE token = ?");

    return {
      add(fid, token, platform) {
        stmtAdd.run(fid, token, platform, Date.now());
      },
      remove(fid, token) {
        stmtRemove.run(fid, token);
      },
      tokensForFid(fid) {
        return stmtByFid.all(fid).map((r) => r.token);
      },
      tokensForFids(fids) {
        const out = new Map<number, string[]>();
        for (const fid of fids) out.set(fid, stmtByFid.all(fid).map((r) => r.token));
        return out;
      },
      distinctFids() {
        return stmtDistinctFids.all().map((r) => r.fid);
      },
      removeTokens(tokens) {
        const tx = sqlite.transaction((toks: string[]) => {
          for (const t of toks) stmtRemoveToken.run(t);
        });
        tx(tokens);
      },
    };
  } catch (e) {
    console.warn("[push-token-store] better-sqlite3 unavailable, push tokens will not persist:", (e as Error).message);
    return null;
  }
}

function db(): Db | null {
  if (!_initTried) {
    _initTried = true;
    _db = initDb();
  }
  return _db;
}

export function addPushToken(fid: number, token: string, platform: string): void {
  db()?.add(fid, token, platform);
}

export function removePushToken(fid: number, token: string): void {
  db()?.remove(fid, token);
}

export function getPushTokensForFid(fid: number): string[] {
  return db()?.tokensForFid(fid) ?? [];
}

export function getPushTokensForFids(fids: number[]): Map<number, string[]> {
  return db()?.tokensForFids(fids) ?? new Map();
}

export function getAllRegisteredFids(): number[] {
  return db()?.distinctFids() ?? [];
}

// Called after FCM reports a token as UNREGISTERED/NOT_FOUND - the device
// uninstalled the app or the token rotated without us hearing about it.
export function pruneInvalidTokens(tokens: string[]): void {
  if (tokens.length) db()?.removeTokens(tokens);
}
