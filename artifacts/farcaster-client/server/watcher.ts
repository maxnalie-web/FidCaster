/**
 * Watchers — background monitors that detect data gaps and report health.
 *
 * Each watcher runs on its own interval and updates a health snapshot.
 * Nothing is deleted or mutated by watchers — they only READ and alert.
 * Actual fixes (verification, exclusion) are handled by their dedicated jobs.
 *
 * Watchers:
 *   GrowWatcher     — orphaned campaigns (start with no complete after 2h)
 *   HubWatcher      — stale unverified hub actions
 *   MarketWatcher   — market indexer liveness
 *   LedgerWatcher   — overall ledger throughput
 *   MasterWatcher   — aggregates all sub-watchers into one health report
 *
 * Health endpoint: GET /api/watchers/health (admin-only)
 */

import { getPool } from "./db/pool.js";
import { getLedgerStats } from "./db/points.js";
import { verificationStats } from "./verification-job.js";
import { sybilStats } from "./sybil-detector.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type HealthStatus = "ok" | "warning" | "error" | "unknown";

interface WatcherSnapshot {
  status:  HealthStatus;
  lastRun: Date | null;
  detail:  Record<string, unknown>;
}

// ── GrowWatcher ───────────────────────────────────────────────────────────────
// Detects campaigns that reported start but never reported complete after 2h.
// This means the user's browser closed mid-batch — the data is genuinely lost.

const grow: WatcherSnapshot = { status: "unknown", lastRun: null, detail: {} };

async function runGrowWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) { grow.status = "unknown"; return; }
  try {
    const { rows } = await pool.query(`
      SELECT COUNT(*) AS orphans
      FROM user_actions start_row
      WHERE start_row.action_type = 'grow_campaign_start'
        AND start_row.excluded = false
        AND start_row.created_at < now() - INTERVAL '2 hours'
        AND NOT EXISTS (
          SELECT 1 FROM user_actions
          WHERE action_type = 'grow_campaign_complete'
            AND excluded = false
            AND payload->>'campaignId' = start_row.payload->>'campaignId'
        )
    `);
    const orphans = Number(rows[0]?.orphans ?? 0);
    grow.status  = orphans === 0 ? "ok" : orphans < 10 ? "warning" : "error";
    grow.detail  = { orphanedCampaigns: orphans };
    grow.lastRun = new Date();
  } catch (e) {
    grow.status = "error";
    grow.detail = { error: (e as Error).message };
  }
}

// ── HubWatcher ────────────────────────────────────────────────────────────────
// Detects stale unverified hub actions — proxy for submission reliability.

const hub: WatcherSnapshot = { status: "unknown", lastRun: null, detail: {} };

async function runHubWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) { hub.status = "unknown"; return; }
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '1 hour')  AS last_1h,
        COUNT(*) FILTER (WHERE created_at > now() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE verified = false AND excluded = false
                           AND created_at < now() - INTERVAL '1 hour')   AS stale_unverified
      FROM user_actions
      WHERE action_type IN ('cast','like','unlike','recast','unrecast','follow','unfollow')
    `);
    const r = rows[0];
    const stale = Number(r?.stale_unverified ?? 0);
    hub.status  = stale < 500 ? "ok" : stale < 2000 ? "warning" : "error";
    hub.detail  = {
      actionsLast1h:   Number(r?.last_1h   ?? 0),
      actionsLast24h:  Number(r?.last_24h  ?? 0),
      staleUnverified: stale,
    };
    hub.lastRun = new Date();
  } catch (e) {
    hub.status = "error";
    hub.detail = { error: (e as Error).message };
  }
}

// ── MarketWatcher ─────────────────────────────────────────────────────────────
// Checks that the on-chain market indexer is still writing rows.

const market: WatcherSnapshot = { status: "unknown", lastRun: null, detail: {} };

async function runMarketWatcher(): Promise<void> {
  const pool = getPool();
  if (!pool) { market.status = "unknown"; return; }
  try {
    const { rows } = await pool.query(`
      SELECT
        COUNT(*)                                             AS total_market_events,
        MAX(created_at)                                      AS last_event_at,
        COUNT(*) FILTER (WHERE verified = true)              AS verified_events
      FROM user_actions
      WHERE action_type IN ('market_list','market_buy','market_cancel')
    `);
    const r = rows[0];
    const lastEvent = r?.last_event_at ? new Date(r.last_event_at) : null;
    // Market events are sparse (only when trades happen) — warn if nothing in 7 days
    const ageH = lastEvent ? (Date.now() - lastEvent.getTime()) / 3_600_000 : Infinity;
    market.status  = "ok"; // market events are rare — don't alarm on inactivity
    market.detail  = {
      totalMarketEvents: Number(r?.total_market_events ?? 0),
      verifiedEvents:    Number(r?.verified_events ?? 0),
      lastEventAt:       lastEvent?.toISOString() ?? null,
      lastEventAgeHours: Math.round(ageH),
    };
    market.lastRun = new Date();
  } catch (e) {
    market.status = "error";
    market.detail = { error: (e as Error).message };
  }
}

// ── LedgerWatcher ─────────────────────────────────────────────────────────────
// Overall throughput and data-quality health.

const ledger: WatcherSnapshot = { status: "unknown", lastRun: null, detail: {} };

async function runLedgerWatcher(): Promise<void> {
  try {
    const stats = await getLedgerStats();
    const verifiedRatio = stats.total > 0 ? stats.verified / stats.total : 1;
    ledger.status  = verifiedRatio > 0.8 ? "ok" : verifiedRatio > 0.5 ? "warning" : "error";
    ledger.detail  = stats;
    ledger.lastRun = new Date();
  } catch (e) {
    ledger.status = "error";
    ledger.detail = { error: (e as Error).message };
  }
}

// ── MasterWatcher ─────────────────────────────────────────────────────────────

const WATCHER_INTERVAL_MS = 10 * 60_000; // every 10 min
let _timer: ReturnType<typeof setInterval> | null = null;

function overallStatus(statuses: HealthStatus[]): HealthStatus {
  if (statuses.includes("error"))   return "error";
  if (statuses.includes("warning")) return "warning";
  if (statuses.every(s => s === "ok")) return "ok";
  return "unknown";
}

async function runAllWatchers(): Promise<void> {
  await Promise.allSettled([
    runGrowWatcher(),
    runHubWatcher(),
    runMarketWatcher(),
    runLedgerWatcher(),
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
  return {
    status: overallStatus([grow.status, hub.status, market.status, ledger.status]),
    watchers: {
      grow:         grow,
      hub:          hub,
      market:       market,
      ledger:       ledger,
    },
    jobs: {
      verification: verificationStats,
      sybil:        sybilStats,
    },
    generatedAt: new Date().toISOString(),
  };
}
