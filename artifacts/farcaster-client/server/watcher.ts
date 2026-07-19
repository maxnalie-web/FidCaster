/**
 * Watchers — proactive guards that ensure data is flowing into the DB correctly.
 *
 * Philosophy: watchers do NOT just read stats. Each watcher has a specific
 * invariant it enforces. If the invariant is broken, the watcher:
 *   1. Logs a structured alert with full context
 *   2. Sets its status to "warning" or "error"
 *   3. Attempts a self-heal where safe to do so
 *
 * Watchers:
 *   DBWriteWatcher   — canary write every cycle to prove DB accepts writes
 *   IngestionWatcher — detects if action capture pipeline has gone silent
 *   GrowWatcher      — detects orphaned campaigns and re-queues verification
 *   MarketWatcher    — detects if market indexer has stopped writing
 *   IntegrityWatcher — detects duplicate proofs, impossible timestamps, missing proofs
 *   MasterWatcher    — runs all watchers, aggregates health
 *
 * Health endpoint: GET /api/watchers/health (admin-only)
 */

import { getPool } from "./db/pool.js";
import { getLedgerStats } from "./db/points.js";
import { verificationStats } from "./verification-job.js";
import { sybilStats } from "./sybil-detector.js";

// ── Types ──────────────────────────────────────────────────────────────────────

type HealthStatus = "ok" | "warning" | "error" | "unknown";

interface WatcherSnapshot {
  status:  HealthStatus;
  lastRun: Date | null;
  detail:  Record<string, unknown>;
  alerts:  string[];
}

function makeSnapshot(): WatcherSnapshot {
  return { status: "unknown", lastRun: null, detail: {}, alerts: [] };
}

function alert(snap: WatcherSnapshot, level: "warning" | "error", msg: string): void {
  snap.status = level === "error" ? "error"
    : snap.status === "error" ? "error" : "warning";
  snap.alerts.push(`[${level.toUpperCase()}] ${msg}`);
  console.warn(`[watcher] ${msg}`);
}

// ── 1. DBWriteWatcher ─────────────────────────────────────────────────────────
// Does a real INSERT + DELETE each cycle to prove the DB is accepting writes.
// If this fails, ALL other watchers are meaningless — DB is broken.

const dbWrite = makeSnapshot();

async function runDBWriteWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) {
    dbWrite.status = "error";
    dbWrite.alerts = ["DB pool not initialised — no database connection"];
    return;
  }
  dbWrite.alerts = [];

  const canaryKey = `watcher_canary_${Date.now()}`;
  try {
    const start = Date.now();

    // Canary: insert a row into a dedicated canary table (create if not exists first)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS watcher_canary (
        key TEXT PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await pool.query(`INSERT INTO watcher_canary (key) VALUES ($1)`, [canaryKey]);
    await pool.query(`DELETE FROM watcher_canary WHERE key = $1`, [canaryKey]);

    const latencyMs = Date.now() - start;
    dbWrite.status  = latencyMs < 2000 ? "ok" : "warning";
    dbWrite.detail  = { latencyMs };
    if (latencyMs >= 2000) {
      alert(dbWrite, "warning", `DB write latency high: ${latencyMs}ms`);
    }
    dbWrite.lastRun = new Date();
  } catch (e) {
    // Try to clean up if insert succeeded but delete failed
    try { await pool.query(`DELETE FROM watcher_canary WHERE key = $1`, [canaryKey]); } catch {}
    dbWrite.status  = "error";
    dbWrite.detail  = { error: (e as Error).message };
    dbWrite.alerts  = [`[ERROR] DB write FAILED: ${(e as Error).message}`];
    console.error("[watcher/db-write] CRITICAL — DB is rejecting writes:", (e as Error).message);
  }
}

// ── 2. IngestionWatcher ───────────────────────────────────────────────────────
// Checks that hub actions (cast/like/follow) are still flowing into the DB.
// If the submission pipeline breaks, new actions stop arriving — we catch it.
//
// Thresholds: warn if no new hub action in 30 min, error if none in 60 min.
// Exception: if total users < 10 (dev mode), thresholds are relaxed to 6h/24h.

const ingestion = makeSnapshot();

async function runIngestionWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) { ingestion.status = "unknown"; return; }
  ingestion.alerts = [];

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '10 minutes')  AS last_10m,
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '30 minutes')  AS last_30m,
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '1 hour')      AS last_1h,
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '24 hours')    AS last_24h,
        MAX(created_at)                                                       AS last_action_at,
        (SELECT COUNT(DISTINCT fid) FROM user_actions)                        AS distinct_users
      FROM user_actions
      WHERE action_type IN ('cast','like','unlike','recast','unrecast','follow','unfollow')
    `);

    const r = rows[0];
    const last10m   = Number(r?.last_10m   ?? 0);
    const last30m   = Number(r?.last_30m   ?? 0);
    const last1h    = Number(r?.last_1h    ?? 0);
    const last24h   = Number(r?.last_24h   ?? 0);
    const users     = Number(r?.distinct_users ?? 0);
    const lastAt    = r?.last_action_at ? new Date(r.last_action_at) : null;
    const silenceMs = lastAt ? Date.now() - lastAt.getTime() : Infinity;
    const silenceMin = Math.round(silenceMs / 60_000);

    // Dev mode (very few users): use lenient thresholds
    const warnMin  = users < 10 ? 360  : 30;   // 30min prod / 6h dev
    const errorMin = users < 10 ? 1440 : 60;   // 60min prod / 24h dev

    ingestion.detail = { last10m, last30m, last1h, last24h, distinctUsers: users,
                         lastActionAt: lastAt?.toISOString() ?? null, silenceMin };
    ingestion.status = "ok";

    if (silenceMin >= errorMin) {
      alert(ingestion, "error",
        `Hub ingestion SILENT for ${silenceMin}min — submission pipeline may be broken`);
    } else if (silenceMin >= warnMin) {
      alert(ingestion, "warning",
        `No new hub actions for ${silenceMin}min (threshold: warn=${warnMin}m, error=${errorMin}m)`);
    }

    ingestion.lastRun = new Date();
  } catch (e) {
    ingestion.status = "error";
    ingestion.detail = { error: (e as Error).message };
    ingestion.alerts = [`[ERROR] ${(e as Error).message}`];
  }
}

// ── 3. GrowWatcher ────────────────────────────────────────────────────────────
// Orphaned campaigns: start reported but no complete after 2h.
// Self-heal: mark them as excluded so they don't inflate orphan counts forever.

const grow = makeSnapshot();

async function runGrowWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) { grow.status = "unknown"; return; }
  grow.alerts = [];

  try {
    // Count orphans older than 2h
    const { rows: orphanRows } = await pool.query(`
      SELECT COUNT(*) AS orphans,
             MIN(created_at) AS oldest_orphan_at
      FROM user_actions s
      WHERE s.action_type = 'grow_campaign_start'
        AND s.excluded = false
        AND s.created_at < now() - INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM user_actions
          WHERE action_type = 'grow_campaign_complete'
            AND excluded = false
            AND payload->>'campaignId' = s.payload->>'campaignId'
        )
    `);
    const orphans = Number(orphanRows[0]?.orphans ?? 0);
    const oldestOrphan = orphanRows[0]?.oldest_orphan_at
      ? new Date(orphanRows[0].oldest_orphan_at) : null;

    // Count completions in last 24h (verify pipeline is working)
    const { rows: recentRows } = await pool.query(`
      SELECT COUNT(*) AS recent_completes,
             AVG((payload->>'realFollowCount')::int) FILTER
               (WHERE payload->>'realFollowCount' IS NOT NULL) AS avg_real_follows
      FROM user_actions
      WHERE action_type = 'grow_campaign_complete'
        AND excluded = false
        AND created_at > now() - INTERVAL '24 hours'
    `);
    const recentCompletes = Number(recentRows[0]?.recent_completes ?? 0);
    const avgRealFollows  = recentRows[0]?.avg_real_follows
      ? Number(recentRows[0].avg_real_follows).toFixed(1) : null;

    grow.detail = { orphanedCampaigns: orphans,
                    oldestOrphanAt: oldestOrphan?.toISOString() ?? null,
                    completionsLast24h: recentCompletes,
                    avgRealFollowsVerified: avgRealFollows };
    grow.status  = "ok";

    if (orphans >= 50) {
      alert(grow, "error",
        `${orphans} orphaned grow campaigns — possible client-side crash or submission failure`);
      // Self-heal: exclude stale orphans (>24h old) to keep counts clean
      const { rowCount } = await pool.query(`
        UPDATE user_actions
        SET excluded = true, excluded_reason = 'watcher_orphan_ttl'
        WHERE action_type = 'grow_campaign_start'
          AND excluded = false
          AND created_at < now() - INTERVAL '24 hours'
          AND NOT EXISTS (
            SELECT 1 FROM user_actions
            WHERE action_type = 'grow_campaign_complete'
              AND excluded = false
              AND payload->>'campaignId' = user_actions.payload->>'campaignId'
          )
      `);
      if (rowCount && rowCount > 0) {
        grow.alerts.push(`[AUTO-FIX] Excluded ${rowCount} orphaned campaigns (>24h old)`);
        console.log(`[watcher/grow] auto-excluded ${rowCount} stale orphan campaigns`);
      }
    } else if (orphans >= 10) {
      alert(grow, "warning",
        `${orphans} orphaned grow campaigns detected (oldest: ${oldestOrphan?.toISOString()})`);
    }

    grow.lastRun = new Date();
  } catch (e) {
    grow.status = "error";
    grow.detail = { error: (e as Error).message };
    grow.alerts = [`[ERROR] ${(e as Error).message}`];
  }
}

// ── 4. MarketWatcher ──────────────────────────────────────────────────────────
// Checks the on-chain market indexer is still writing events.
// Error if nothing has been indexed in the last 7 days AND there are any rows at all.

const market = makeSnapshot();

async function runMarketWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) { market.status = "unknown"; return; }
  market.alerts = [];

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                                        AS total,
        COUNT(*) FILTER (WHERE verified = true)                         AS verified,
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '1 hour') AS last_1h,
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '24 hours') AS last_24h,
        MAX(created_at)                                                  AS last_event_at,
        COUNT(*) FILTER (WHERE proof IS NULL OR proof = '')             AS missing_proof
      FROM user_actions
      WHERE action_type IN ('market_list','market_buy','market_cancel')
    `);

    const r = rows[0];
    const total        = Number(r?.total       ?? 0);
    const verified     = Number(r?.verified    ?? 0);
    const last24h      = Number(r?.last_24h    ?? 0);
    const missingProof = Number(r?.missing_proof ?? 0);
    const lastAt       = r?.last_event_at ? new Date(r.last_event_at) : null;
    const ageH         = lastAt ? (Date.now() - lastAt.getTime()) / 3_600_000 : Infinity;

    market.status = "ok";
    market.detail = { total, verified, last24h,
                      missingProof, lastEventAt: lastAt?.toISOString() ?? null,
                      lastEventAgeHours: Math.round(ageH) };

    // Missing tx-hash proofs on market events → data integrity issue
    if (missingProof > 0) {
      alert(market, "warning",
        `${missingProof} market events stored without a tx-hash proof`);
    }

    // Indexer silence (only warn if we have historical data — means indexer was running)
    if (total > 0 && ageH > 168) { // 7 days
      alert(market, "error",
        `Market indexer appears DOWN — no events in ${Math.round(ageH)}h`);
    }

    // Low verification rate
    const verifiedRatio = total > 0 ? verified / total : 1;
    if (total > 10 && verifiedRatio < 0.9) {
      alert(market, "warning",
        `Market event verification rate low: ${(verifiedRatio * 100).toFixed(1)}%`);
    }

    market.lastRun = new Date();
  } catch (e) {
    market.status = "error";
    market.detail = { error: (e as Error).message };
    market.alerts = [`[ERROR] ${(e as Error).message}`];
  }
}

// ── 5. IntegrityWatcher ───────────────────────────────────────────────────────
// Checks ledger data quality: proof uniqueness, timestamp sanity, exclusion ratio.

const integrity = makeSnapshot();

async function runIntegrityWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) { integrity.status = "unknown"; return; }
  integrity.alerts = [];

  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                               AS total_actions,
        COUNT(*) FILTER (WHERE excluded = true)                AS excluded_count,
        COUNT(*) FILTER (WHERE proof IS NULL OR proof = '')    AS empty_proof,
        COUNT(*) FILTER (WHERE created_at > now())             AS future_timestamps,
        COUNT(*) FILTER (WHERE created_at < '2024-01-01')      AS ancient_timestamps,
        COUNT(*) FILTER (WHERE verified = true)                AS verified_count,
        COUNT(*) FILTER (WHERE verified = false AND excluded = false
                           AND created_at < now() - INTERVAL '24 hours'
                           AND action_type IN ('cast','like','recast','follow')) AS stale_unverified
      FROM user_actions
    `);

    // Duplicate proof check (proof should be unique per action_type)
    const { rows: dupRows } = await pool.query(`
      SELECT COUNT(*) AS dup_proofs
      FROM (
        SELECT proof, action_type, COUNT(*) AS c
        FROM user_actions
        WHERE proof IS NOT NULL AND proof != '' AND excluded = false
        GROUP BY proof, action_type
        HAVING COUNT(*) > 1
      ) sub
    `);

    const r = rows[0];
    const total          = Number(r?.total_actions    ?? 0);
    const excluded       = Number(r?.excluded_count   ?? 0);
    const emptyProof     = Number(r?.empty_proof      ?? 0);
    const futureTs       = Number(r?.future_timestamps ?? 0);
    const ancientTs      = Number(r?.ancient_timestamps ?? 0);
    const verified       = Number(r?.verified_count   ?? 0);
    const staleUnverified = Number(r?.stale_unverified ?? 0);
    const dupProofs      = Number(dupRows[0]?.dup_proofs ?? 0);

    const verifiedRatio  = total > 0 ? verified / total : 1;
    const excludedRatio  = total > 0 ? excluded / total : 0;

    integrity.status = "ok";
    integrity.detail = { total, excluded, excludedRatio: (excludedRatio * 100).toFixed(1) + "%",
                         verified, verifiedRatio: (verifiedRatio * 100).toFixed(1) + "%",
                         emptyProof, dupProofs, futureTimestamps: futureTs,
                         ancientTimestamps: ancientTs, staleUnverified };

    if (dupProofs > 0) {
      alert(integrity, "error",
        `${dupProofs} duplicate proof-action_type pairs — dedup index may be broken`);
    }
    if (futureTs > 0) {
      alert(integrity, "warning",
        `${futureTs} actions have future timestamps — possible clock skew or replay attack`);
    }
    if (ancientTs > 0) {
      alert(integrity, "warning",
        `${ancientTs} actions with timestamps before 2024 — possible data injection`);
    }
    if (emptyProof > 100) {
      alert(integrity, "warning",
        `${emptyProof} actions stored with empty proof field`);
    }
    if (total > 100 && verifiedRatio < 0.7) {
      alert(integrity, "warning",
        `Overall verification rate low: ${(verifiedRatio * 100).toFixed(1)}%`);
    }
    if (total > 100 && excludedRatio > 0.5) {
      alert(integrity, "warning",
        `Exclusion rate high: ${(excludedRatio * 100).toFixed(1)}% — possible sybil wave or bad data`);
    }
    if (staleUnverified > 2000) {
      alert(integrity, "warning",
        `${staleUnverified} actions unverified for >24h — verification job may be backlogged`);
    }

    integrity.lastRun = new Date();
  } catch (e) {
    integrity.status = "error";
    integrity.detail = { error: (e as Error).message };
    integrity.alerts = [`[ERROR] ${(e as Error).message}`];
  }
}

// ── MasterWatcher ─────────────────────────────────────────────────────────────

const WATCHER_INTERVAL_MS = 10 * 60_000; // every 10 min
let _timer: ReturnType<typeof setInterval> | null = null;

function overallStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("error"))                return "error";
  if (statuses.includes("warning"))              return "warning";
  if (statuses.every(s => s === "ok"))           return "ok";
  return "unknown";
}

async function runAllWatchers(): Promise<void> {
  // DB write watcher MUST run first — if it fails, the others are unreliable
  await runDBWriteWatcher();
  if (dbWrite.status === "error") {
    console.error("[watcher] DB write check FAILED — skipping other watchers");
    return;
  }
  await Promise.allSettled([
    runIngestionWatcher(),
    runGrowWatcher(),
    runMarketWatcher(),
    runIntegrityWatcher(),
  ]);
}

export function startWatchers(): void {
  if (_timer) return;
  runAllWatchers(); // immediate first run
  _timer = setInterval(runAllWatchers, WATCHER_INTERVAL_MS);
  console.log(`[watchers] started (every ${WATCHER_INTERVAL_MS / 60_000}min)`);
}

export function stopWatchers(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

export function getHealthReport() {
  const allStatuses: HealthStatus[] = [
    dbWrite.status, ingestion.status, grow.status, market.status, integrity.status,
  ];
  return {
    status: overallStatus(allStatuses),
    watchers: {
      dbWrite:    { ...dbWrite },
      ingestion:  { ...ingestion },
      grow:       { ...grow },
      market:     { ...market },
      integrity:  { ...integrity },
    },
    jobs: {
      verification: verificationStats,
      sybil:        sybilStats,
    },
    generatedAt: new Date().toISOString(),
  };
}
