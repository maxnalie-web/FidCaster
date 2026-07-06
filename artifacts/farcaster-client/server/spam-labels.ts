/**
 * Farcaster's real spam label dataset · published weekly by Warpcast/Merkle at
 * github.com/warpcast/labels (moved to github.com/merkle-team/labels), stored
 * via Git LFS as a ~125MB JSONL file (one line per labelled FID):
 *   {"provider":9152,"type":{"target":"user","fid":N},"label_type":"spam","label_value":0|2|3,...}
 * Per the repo's README: 0 = likely spammy, 2 = unlikely spammy, 3 = nerfed
 * for malicious activity. The old "1" (maybe spammy) category was deprecated
 * 2025-05-22 · this is a binary label now. FIDs absent from the dataset are
 * "unknown" (not enough data / inactive), not automatically non-spam.
 *
 * Neynar's own `score` field is a *different*, proprietary quality metric ·
 * it does not carry this label, so there's no shortcut through the API we
 * already call. This file downloads the real dataset directly from GitHub's
 * LFS storage (no git/git-lfs binary needed, just the LFS HTTP batch API),
 * parses it, and caches it in SQLite for fast per-FID lookups.
 */

import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import { Readable } from "stream";
import readline from "readline";

const requireCjs = createRequire(import.meta.url);

// The dataset repo moved (warpcast/labels → merkle-team/labels). Try both raw
// pointer URLs so a 404 on the old path doesn't wipe out ALL labels · and both
// LFS batch endpoints when resolving the download href.
const POINTER_URLS = [
  "https://raw.githubusercontent.com/merkle-team/labels/main/spam.jsonl",
  "https://raw.githubusercontent.com/warpcast/labels/main/spam.jsonl",
];
const BATCH_URLS = [
  "https://github.com/merkle-team/labels.git/info/lfs/objects/batch",
  "https://github.com/warpcast/labels.git/info/lfs/objects/batch",
];
const REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60_000; // matches upstream's weekly update cadence

type Db = {
  getMany: (fids: number[]) => Map<number, number>;
  upsertMany: (rows: Array<{ fid: number; label: number }>) => void;
  getMeta: (key: string) => string | undefined;
  setMeta: (key: string, value: string) => void;
};

let _db: Db | null = null;
let _initTried = false;

function initDb(): Db | null {
  try {
    const Database = requireCjs("better-sqlite3");
    const __dir = dirname(fileURLToPath(import.meta.url));
    const dbPath = resolve(__dir, "../spam-labels-cache.sqlite");
    const sqlite = new Database(dbPath) as import("better-sqlite3").Database;

    sqlite.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS spam_labels (
        fid   INTEGER PRIMARY KEY,
        label INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS spam_labels_meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    const stmtGetMeta = sqlite.prepare<[string], { value: string }>("SELECT value FROM spam_labels_meta WHERE key = ?");
    const stmtSetMeta = sqlite.prepare<[string, string], void>("INSERT OR REPLACE INTO spam_labels_meta (key, value) VALUES (?, ?)");
    const stmtUpsert = sqlite.prepare<[number, number], void>("INSERT OR REPLACE INTO spam_labels (fid, label) VALUES (?, ?)");
    const stmtUpsertMany = sqlite.transaction((rows: Array<{ fid: number; label: number }>) => {
      for (const r of rows) stmtUpsert.run(r.fid, r.label);
    });

    return {
      getMany(fids) {
        const result = new Map<number, number>();
        if (!fids.length) return result;
        const placeholders = fids.map(() => "?").join(",");
        const rows = sqlite
          .prepare<number[], { fid: number; label: number }>(`SELECT fid, label FROM spam_labels WHERE fid IN (${placeholders})`)
          .all(...fids);
        for (const row of rows) result.set(row.fid, row.label);
        return result;
      },
      upsertMany(rows) { stmtUpsertMany(rows); },
      getMeta(key) { return stmtGetMeta.get(key)?.value; },
      setMeta(key, value) { stmtSetMeta.run(key, value); },
    };
  } catch (e) {
    console.warn("[spam-labels] SQLite unavailable:", (e as Error).message);
    return null;
  }
}

function db(): Db | null {
  if (!_initTried) { _initTried = true; _db = initDb(); }
  return _db;
}

async function resolveLatestPointer(): Promise<{ oid: string; size: number }> {
  let lastErr = "";
  for (const url of POINTER_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) { lastErr = `pointer fetch failed: ${res.status}`; continue; }
      const text = await res.text();
      const oid = /oid sha256:([a-f0-9]+)/.exec(text)?.[1];
      const size = Number(/size (\d+)/.exec(text)?.[1]);
      if (!oid || !size) { lastErr = "couldn't parse LFS pointer file"; continue; }
      return { oid, size };
    } catch (e) { lastErr = (e as Error).message; }
  }
  throw new Error(lastErr || "no pointer URL resolved");
}

async function resolveDownloadUrl(oid: string, size: number): Promise<string> {
  const body = JSON.stringify({ operation: "download", transfers: ["basic"], objects: [{ oid, size }] });
  const headers = { Accept: "application/vnd.git-lfs+json", "Content-Type": "application/vnd.git-lfs+json" };
  let lastErr = "";
  for (const batchUrl of BATCH_URLS) {
    try {
      let res = await fetch(batchUrl, { method: "POST", headers, body });
      let data = await res.json() as { objects?: Array<{ actions?: { download?: { href?: string } } }>; url?: string };
      // GitHub sometimes answers the LFS batch POST with a JSON redirect body
      // (a moved repo) rather than an HTTP redirect fetch would follow · retry once.
      if (!data.objects && data.url) {
        res = await fetch(data.url, { method: "POST", headers, body });
        data = await res.json();
      }
      const href = data.objects?.[0]?.actions?.download?.href;
      if (href) return href;
      lastErr = "LFS batch API returned no download href";
    } catch (e) { lastErr = (e as Error).message; }
  }
  throw new Error(lastErr || "no LFS batch URL resolved");
}

let refreshing = false;

/** Downloads + parses the full dataset only when the upstream file actually changed. */
export async function refreshSpamLabels(): Promise<void> {
  const store = db();
  if (!store || refreshing) return;
  refreshing = true;
  try {
    const { oid, size } = await resolveLatestPointer();
    if (store.getMeta("oid") === oid) return; // unchanged since last refresh
    const url = await resolveDownloadUrl(oid, size);
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`dataset download failed: ${res.status}`);

    const nodeStream = Readable.fromWeb(res.body as unknown as import("stream/web").ReadableStream);
    const rl = readline.createInterface({ input: nodeStream, crlfDelay: Infinity });
    let batch: Array<{ fid: number; label: number }> = [];
    let total = 0;
    for await (const line of rl) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as { type?: { target?: string; fid?: number }; label_type?: string; label_value?: number };
        if (row.label_type === "spam" && row.type?.target === "user" && typeof row.type.fid === "number" && typeof row.label_value === "number") {
          batch.push({ fid: row.type.fid, label: row.label_value });
        }
      } catch { /* skip malformed line */ }
      if (batch.length >= 5000) { store.upsertMany(batch); total += batch.length; batch = []; }
    }
    if (batch.length) { store.upsertMany(batch); total += batch.length; }
    store.setMeta("oid", oid);
    store.setMeta("refreshed_at", String(Date.now()));
    console.log(`[spam-labels] refreshed ${total.toLocaleString()} labels from upstream (oid ${oid.slice(0, 8)}…)`);
  } catch (e) {
    console.warn("[spam-labels] refresh failed:", (e as Error).message);
  } finally {
    refreshing = false;
  }
}

// On an ephemeral host (e.g. Replit autoscale) the SQLite cache doesn't survive
// a cold start, so every fresh instance boots with an EMPTY dataset until this
// finishes. Requests answered in that window used to get {} back (no labels
// ever showing up, since the client then permanently caches that FID as
// "unknown" · see src/lib/spam-labels.ts). Track the initial refresh so the
// route can await it instead of racing it.
let initialRefreshPromise: Promise<void> | null = null;

/** Kicks off an initial refresh (if stale/missing) and a weekly recheck timer. Non-blocking. */
export function scheduleSpamLabelRefresh(): void {
  const store = db();
  if (!store) return;
  const lastRefreshed = Number(store.getMeta("refreshed_at") ?? 0);
  if (Date.now() - lastRefreshed > REFRESH_INTERVAL_MS) initialRefreshPromise = refreshSpamLabels();
  setInterval(() => void refreshSpamLabels(), REFRESH_INTERVAL_MS);
}

/**
 * Resolves once the initial refresh finishes (or immediately if the cache was
 * already warm / refresh isn't needed). Bounded by timeoutMs so a slow/stuck
 * download can't hang requests forever · callers get whatever's in the DB
 * (possibly partial, since rows are upserted in streaming batches) at that point.
 */
export async function awaitInitialSpamLabels(timeoutMs = 12_000): Promise<void> {
  if (!initialRefreshPromise) return;
  await Promise.race([
    initialRefreshPromise,
    new Promise<void>((r) => setTimeout(r, timeoutMs)),
  ]);
}

/** Returns { fid: label } only for FIDs present in the dataset · absent = unknown. */
export function getSpamLabels(fids: number[]): Record<number, number> {
  const store = db();
  if (!store) return {};
  const result: Record<number, number> = {};
  for (const [fid, label] of store.getMany(fids)) result[fid] = label;
  return result;
}
