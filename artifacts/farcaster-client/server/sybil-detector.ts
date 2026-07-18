/**
 * Sybil / fraud detection — runs hourly.
 *
 * Rules mark suspicious rows as excluded=true (never deleted — audit trail).
 *
 * Rule set (v2):
 *
 *   R1  Follow-churn:  same FID followed+unfollowed the same target within
 *       14 DAYS (extended from 24h to close the slow-cycling loophole).
 *       → exclude both the follow and unfollow row.
 *
 *   R2  Action velocity: > 500 hub actions in any rolling 1-hour window.
 *       → exclude all actions in that window.
 *
 *   R3  Grow-integrity: grow_campaign_complete with clientReportedSucceeded=0
 *       AND campaign ran for > 5 min (clearly idle, not real).
 *       → exclude the complete row.
 *
 *   R4  Grow target recycling: grow_campaign_complete where ≥ 80% of
 *       targetFidsSample were already used by the same FID in the last 14 days
 *       (grow_targets table).  Server-side grow verification already catches
 *       this, but this rule gives a fast SQL-only path.
 *       → exclude the complete row.
 *
 *   R5  Ineligible FID sweep: exclude all actions from FIDs marked
 *       eligible=false in the users table.  Eligibility check runs in
 *       eligibility.ts; this rule applies the consequences.
 */

import { getPool } from "./db/pool.js";
import { sweepIneligibleActions } from "./db/eligibility.js";

const SYBIL_INTERVAL_MS      = 60 * 60_000; // hourly
const CHURN_WINDOW_DAYS      = 14;           // extended from 24h
const GROW_RECYCLE_THRESHOLD = 0.8;          // 80% recycled targets = exclude

// ── State ─────────────────────────────────────────────────────────────────────
export let sybilStats = {
  lastRun:   null as Date | null,
  excludedR1: 0,
  excludedR2: 0,
  excludedR3: 0,
  excludedR4: 0,
  excludedR5: 0,
};

// ── R1: follow-unfollow churn on same target within 14 days ──────────────────

async function ruleFollowChurn(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const windowSecs = CHURN_WINDOW_DAYS * 86_400;
  const { rowCount } = await pool.query(`
    UPDATE user_actions ua
    SET excluded = true
    WHERE ua.excluded = false
      AND ua.action_type IN ('follow', 'unfollow')
      AND EXISTS (
        SELECT 1 FROM user_actions ua2
        WHERE ua2.fid = ua.fid
          AND ua2.excluded = false
          AND ua2.action_type = CASE WHEN ua.action_type = 'follow' THEN 'unfollow' ELSE 'follow' END
          AND ua2.payload->>'targetFid' = ua.payload->>'targetFid'
          AND ABS(EXTRACT(EPOCH FROM (ua2.created_at - ua.created_at))) < $1
      )
  `, [windowSecs]);
  return rowCount ?? 0;
}

// ── R2: velocity cap — > 500 hub actions in a rolling 1-hour window ──────────

async function ruleVelocityCap(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { rowCount } = await pool.query(`
    UPDATE user_actions ua
    SET excluded = true
    WHERE ua.excluded = false
      AND ua.action_type IN ('cast','like','unlike','recast','unrecast','follow','unfollow')
      AND (
        SELECT COUNT(*) FROM user_actions ua2
        WHERE ua2.fid = ua.fid
          AND ua2.action_type IN ('cast','like','unlike','recast','unrecast','follow','unfollow')
          AND ua2.excluded = false
          AND ua2.created_at BETWEEN ua.created_at - INTERVAL '1 hour'
                                 AND ua.created_at + INTERVAL '1 hour'
      ) > 500
  `);
  return rowCount ?? 0;
}

// ── R3: grow_campaign_complete with 0 succeeded after > 5 min ────────────────

async function ruleGrowEmpty(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { rowCount } = await pool.query(`
    UPDATE user_actions
    SET excluded = true
    WHERE excluded = false
      AND action_type = 'grow_campaign_complete'
      AND (payload->>'clientReportedSucceeded')::int = 0
      AND (payload->>'durationMs')::bigint > 300000
  `);
  return rowCount ?? 0;
}

// ── R4: grow target recycling (80% of targets used in last 14 days) ──────────

async function ruleGrowTargetRecycling(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;

  // Find unverified grow_complete rows that have a start row with targetFidsSample
  const { rows } = await pool.query(`
    SELECT uc.id, uc.fid, us.payload->>'targetFidsSample' AS sample_json
    FROM user_actions uc
    JOIN user_actions us
      ON us.fid = uc.fid
     AND us.action_type = 'grow_campaign_start'
     AND us.payload->>'campaignId' = uc.payload->>'campaignId'
    WHERE uc.action_type = 'grow_campaign_complete'
      AND uc.verified = false AND uc.excluded = false
      AND us.payload->>'targetFidsSample' IS NOT NULL
    LIMIT 100
  `);

  let excluded = 0;
  for (const row of rows) {
    let sample: number[] = [];
    try { sample = JSON.parse(row.sample_json ?? "[]") as number[]; } catch { continue; }
    if (sample.length === 0) continue;

    // Count how many of these targets were used by this FID in last 14 days
    const { rows: usedRows } = await pool.query(
      `SELECT COUNT(*) AS n FROM grow_targets
       WHERE fid = $1 AND used_at > now() - INTERVAL '14 days'
         AND target_fid = ANY($2::bigint[])`,
      [row.fid, sample],
    );
    const usedCount = Number(usedRows[0]?.n ?? 0);
    const recycleRatio = sample.length > 0 ? usedCount / sample.length : 0;

    if (recycleRatio >= GROW_RECYCLE_THRESHOLD) {
      await pool.query(
        "UPDATE user_actions SET excluded = true WHERE id = $1",
        [row.id],
      );
      excluded++;
    }
  }
  return excluded;
}

// ── R5: ineligible FID sweep ──────────────────────────────────────────────────

async function ruleIneligibleSweep(): Promise<number> {
  return sweepIneligibleActions();
}

// ── Runner ────────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

async function runSybilDetection(): Promise<void> {
  try {
    const [r1, r2, r3, r4, r5] = await Promise.all([
      ruleFollowChurn(),
      ruleVelocityCap(),
      ruleGrowEmpty(),
      ruleGrowTargetRecycling(),
      ruleIneligibleSweep(),
    ]);
    sybilStats.excludedR1 += r1;
    sybilStats.excludedR2 += r2;
    sybilStats.excludedR3 += r3;
    sybilStats.excludedR4 += r4;
    sybilStats.excludedR5 += r5;
    sybilStats.lastRun = new Date();
    if (r1 + r2 + r3 + r4 + r5 > 0) {
      console.log(`[sybil] excluded R1=${r1} R2=${r2} R3=${r3} R4=${r4} R5=${r5}`);
    }
  } catch (e) {
    console.warn("[sybil] detection error:", (e as Error).message);
  }
}

export function startSybilDetector(): void {
  if (_timer) return;
  runSybilDetection();
  _timer = setInterval(runSybilDetection, SYBIL_INTERVAL_MS);
  console.log("[sybil] detector started (hourly, 5 rules)");
}

export function stopSybilDetector(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
