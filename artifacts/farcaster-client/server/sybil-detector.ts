/**
 * Sybil / fraud detection.
 *
 * Rules are SQL-based (no external API calls). They mark suspicious rows
 * as excluded=true without deleting them, so the audit trail stays intact.
 *
 * Rule set (v1):
 *   R1  Follow-churn: same FID followed+unfollowed the same target within 24h
 *       → exclude both the follow and unfollow row (payload.targetFid match)
 *   R2  Action velocity: >500 hub actions (cast/like/recast/follow) in any
 *       rolling 1-hour window → exclude all from that window
 *   R3  Grow-campaign integrity: campaign_complete with succeeded=0 AND
 *       campaign ran for >5 min → exclude the complete row (earned nothing)
 *   R4  Duplicate proof: already enforced by DB unique index (ON CONFLICT DO NOTHING)
 */

import { getPool } from "./db/pool.js";

const SYBIL_INTERVAL_MS = 60 * 60_000; // run hourly

// ── State ─────────────────────────────────────────────────────────────────────
export let sybilStats = {
  lastRun:      null as Date | null,
  excludedR1:   0,
  excludedR2:   0,
  excludedR3:   0,
};

// ── Rules ─────────────────────────────────────────────────────────────────────

/** R1: follow-unfollow churn on same target within 24h */
async function ruleFollowChurn(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  // Find follow rows whose payload.targetFid also appears in an unfollow
  // row by the same fid within 24h
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
          AND ABS(EXTRACT(EPOCH FROM (ua2.created_at - ua.created_at))) < 86400
      )
  `);
  return rowCount ?? 0;
}

/** R2: velocity cap — >500 hub actions in a rolling 1-hour window */
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
          AND ua2.created_at BETWEEN ua.created_at - INTERVAL '1 hour' AND ua.created_at + INTERVAL '1 hour'
      ) > 500
  `);
  return rowCount ?? 0;
}

/** R3: grow_campaign_complete with 0 succeeded after >5 min */
async function ruleGrowEmpty(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { rowCount } = await pool.query(`
    UPDATE user_actions
    SET excluded = true
    WHERE excluded = false
      AND action_type = 'grow_campaign_complete'
      AND (payload->>'succeeded')::int = 0
      AND (payload->>'durationMs')::bigint > 300000
  `);
  return rowCount ?? 0;
}

// ── Runner ────────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

async function runSybilDetection(): Promise<void> {
  try {
    const [r1, r2, r3] = await Promise.all([
      ruleFollowChurn(),
      ruleVelocityCap(),
      ruleGrowEmpty(),
    ]);
    sybilStats.excludedR1 += r1;
    sybilStats.excludedR2 += r2;
    sybilStats.excludedR3 += r3;
    sybilStats.lastRun = new Date();
    if (r1 + r2 + r3 > 0) {
      console.log(`[sybil] excluded R1=${r1} R2=${r2} R3=${r3}`);
    }
  } catch (e) {
    console.warn("[sybil] detection error:", (e as Error).message);
  }
}

export function startSybilDetector(): void {
  if (_timer) return;
  runSybilDetection(); // run immediately
  _timer = setInterval(runSybilDetection, SYBIL_INTERVAL_MS);
  console.log("[sybil] detector started (hourly)");
}

export function stopSybilDetector(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
