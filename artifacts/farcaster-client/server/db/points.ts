/**
 * Points calculation engine for the FidCaster airdrop.
 *
 * Weights are code constants (no DB config needed) so adjustments are
 * deploy-gated, not editable via an API endpoint.
 *
 * Only verified=true AND excluded=false rows count.
 * Daily caps prevent farming: you can earn MAX_PER_DAY[type] per calendar day.
 */

import { getPool } from "./pool.js";

// ── Weights ───────────────────────────────────────────────────────────────────

export const POINTS: Record<string, { pts: number; dailyCap: number }> = {
  cast:                    { pts: 10,  dailyCap: 50   },
  like:                    { pts: 1,   dailyCap: 50   },
  recast:                  { pts: 3,   dailyCap: 30   },
  follow:                  { pts: 2,   dailyCap: 50   },
  market_list:             { pts: 50,  dailyCap: 250  },
  market_buy:              { pts: 100, dailyCap: 300  },
  market_cancel:           { pts: 0,   dailyCap: 0    },
  unfollow:                { pts: 0,   dailyCap: 0    },
  unlike:                  { pts: 0,   dailyCap: 0    },
  unrecast:                { pts: 0,   dailyCap: 0    },
  grow_campaign_complete:  { pts: 30,  dailyCap: 150  },
  grow_campaign_start:     { pts: 0,   dailyCap: 0    },
  referral:                { pts: 200, dailyCap: 2000 },
  quest:                   { pts: 100, dailyCap: 500  },
  app_open:                { pts: 0,   dailyCap: 0    },
};

// Build the CASE expression once (avoids repeating in every query)
const CASE_EXPR = Object.entries(POINTS)
  .filter(([, v]) => v.pts > 0 && v.dailyCap > 0)
  .map(([type, { pts, dailyCap }]) =>
    `WHEN '${type}' THEN LEAST(cnt * ${pts}, ${dailyCap})`)
  .join("\n      ");

// ── Core SQL ──────────────────────────────────────────────────────────────────

const LEADERBOARD_SQL = `
WITH counted AS (
  SELECT fid, action_type, (created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*) AS cnt
  FROM user_actions
  WHERE verified = true AND excluded = false
  GROUP BY fid, action_type, d
),
scored AS (
  SELECT fid, CASE action_type
    ${CASE_EXPR}
    ELSE 0
  END AS day_pts
  FROM counted
),
totals AS (
  SELECT fid, SUM(day_pts) AS total_points
  FROM scored
  GROUP BY fid
  HAVING SUM(day_pts) > 0
)
SELECT
  fid,
  total_points,
  RANK() OVER (ORDER BY total_points DESC) AS rank
FROM totals
ORDER BY total_points DESC
LIMIT $1 OFFSET $2
`;

const SINGLE_FID_SQL = `
WITH counted AS (
  SELECT action_type, (created_at AT TIME ZONE 'UTC')::date AS d, COUNT(*) AS cnt
  FROM user_actions
  WHERE fid = $1 AND verified = true AND excluded = false
  GROUP BY action_type, d
),
scored AS (
  SELECT action_type, d, cnt, CASE action_type
    ${CASE_EXPR}
    ELSE 0
  END AS day_pts
  FROM counted
)
SELECT
  action_type,
  SUM(cnt)     AS total_actions,
  SUM(day_pts) AS points_earned
FROM scored
GROUP BY action_type
ORDER BY points_earned DESC
`;

// ── Exports ───────────────────────────────────────────────────────────────────

export interface LeaderboardRow {
  fid: number;
  total_points: number;
  rank: number;
}

export async function getLeaderboard(limit = 100, offset = 0): Promise<LeaderboardRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(LEADERBOARD_SQL, [Math.min(limit, 500), offset]);
  return rows.map(r => ({ fid: Number(r.fid), total_points: Number(r.total_points), rank: Number(r.rank) }));
}

export interface BreakdownRow {
  action_type: string;
  total_actions: number;
  points_earned: number;
}

export interface FidPoints {
  fid: number;
  total_points: number;
  breakdown: BreakdownRow[];
}

export async function getFidPoints(fid: number): Promise<FidPoints> {
  const pool = getPool();
  if (!pool) return { fid, total_points: 0, breakdown: [] };
  const { rows } = await pool.query(SINGLE_FID_SQL, [fid]);
  const breakdown = rows.map(r => ({
    action_type:   r.action_type,
    total_actions: Number(r.total_actions),
    points_earned: Number(r.points_earned),
  }));
  const total_points = breakdown.reduce((s, r) => s + r.points_earned, 0);
  return { fid, total_points, breakdown };
}

/** Full snapshot for Clanker airdrop input. Returns ALL eligible fids. */
export async function getFullSnapshot(): Promise<LeaderboardRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(LEADERBOARD_SQL, [1_000_000, 0]);
  return rows.map(r => ({ fid: Number(r.fid), total_points: Number(r.total_points), rank: Number(r.rank) }));
}

// ── Point types that actually earn something ──────────────────────────────────
const EARNING_TYPES = Object.entries(POINTS)
  .filter(([, v]) => v.pts > 0)
  .map(([k]) => k);

export interface HistoryRow {
  id: number;
  action_type: string;
  pts: number;
  created_at: string; // ISO string
}

/**
 * Returns recent earning actions for a FID, newest-first.
 * Each row reflects the per-action point value (not daily-capped).
 * The breakdown remains the source-of-truth for totals.
 */
export async function getPointsHistory(fid: number, limit = 50): Promise<HistoryRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT id, action_type, created_at
     FROM user_actions
     WHERE fid = $1
       AND verified = true
       AND excluded = false
       AND action_type = ANY($3::text[])
     ORDER BY created_at DESC
     LIMIT $2`,
    [fid, Math.min(limit, 100), EARNING_TYPES],
  );
  return rows.map(r => ({
    id:          Number(r.id),
    action_type: r.action_type,
    pts:         POINTS[r.action_type]?.pts ?? 0,
    created_at:  r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Overall ledger stats for watchers/health */
export async function getLedgerStats(): Promise<{
  total: number; verified: number; pending: number; excluded: number;
}> {
  const pool = getPool();
  if (!pool) return { total: 0, verified: 0, pending: 0, excluded: 0 };
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)                                    AS total,
      COUNT(*) FILTER (WHERE verified = true)     AS verified,
      COUNT(*) FILTER (WHERE verified = false AND excluded = false) AS pending,
      COUNT(*) FILTER (WHERE excluded = true)     AS excluded
    FROM user_actions
  `);
  const r = rows[0];
  return {
    total:    Number(r.total),
    verified: Number(r.verified),
    pending:  Number(r.pending),
    excluded: Number(r.excluded),
  };
}
