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
  cast:                    { pts: 20,  dailyCap: 100  },
  like:                    { pts: 2,   dailyCap: 100  },
  recast:                  { pts: 6,   dailyCap: 60   },
  follow:                  { pts: 4,   dailyCap: 100  },
  market_list:             { pts: 100, dailyCap: 500  },
  market_buy:              { pts: 200, dailyCap: 600  },
  market_cancel:           { pts: 0,   dailyCap: 0    },
  unfollow:                { pts: 0,   dailyCap: 0    },
  unlike:                  { pts: 0,   dailyCap: 0    },
  unrecast:                { pts: 0,   dailyCap: 0    },
  grow_campaign_complete:  { pts: 60,  dailyCap: 300  },
  grow_campaign_start:     { pts: 0,   dailyCap: 0    },
  referral:                { pts: 200, dailyCap: 2000 },
  // One-time bonus for a newly-referred user (db/referrals.ts claimReferral).
  // Matches the referrer's own 200pt payout above on purpose - both sides of
  // a referral earn the same amount, so the joining friend can be told
  // exactly what they're getting up front.
  referral_welcome:        { pts: 200, dailyCap: 200  },
  quest:                   { pts: 200, dailyCap: 1000 },
  app_open:                { pts: 0,   dailyCap: 0    },
  // Awarded once per 7-day streak milestone reached (see mini-routes.ts),
  // scaled by WHICH milestone (streakBonusPts in mini-routes.ts: 750/week,
  // capped at 6000) instead of a flat 500 forever - a 500pt bonus for a full
  // week of consistent activity read as stingy, and didn't reward sticking
  // with a longer streak any more than just hitting 7 days once. The actual
  // per-occurrence amount lives in payload.amount, same pattern as
  // promotion/gift_received; `pts` here is unused for scoring (display
  // default only), dailyCap is the real ceiling, see STREAK_CASE.
  streak_bonus:            { pts: 750, dailyCap: 6000 },
  // One-time bonus for holding a FasterTask Pass NFT (ERC-1155 on Base),
  // detected server-side via the user's Farcaster custody address — see
  // server/nft-holder-job.ts. Awarded once per fid, like referral_welcome.
  // Excluded for a small set of team/test accounts (see bonus-exclusions.ts).
  nft_holder_bonus:        { pts: 10000, dailyCap: 10000 },
  // ── Allowance-gated actions ────────────────────────────────────────────────
  // promotion's award scales with the promoter's own daily allowance (see
  // db/allowance.ts processPromotionAtomic) - a bigger allowance (higher
  // follower count / account quality) earns more per promote, not the same
  // flat amount as a brand-new account. The actual amount lives in
  // payload.amount per row, same pattern as gift_received below; `pts` and
  // `dailyCap` here are unused for scoring (kept only as display defaults) -
  // the real per-day limit is the allowance category cap, see PROMO_CASE.
  promotion:               { pts: 50,  dailyCap: 5000 },
  gift:                    { pts: 0,   dailyCap: 0    }, // sender: 0 pts (allowance debited)
  // gift_received uses payload.amount (variable); dailyCap 500 enforced in SQL
  gift_received:           { pts: 0,   dailyCap: 0    }, // handled via GIFT_CASE below
  // One-time bonus per achievement unlocked (mini-routes.ts ACHIEVEMENTS) -
  // each id can only ever award once per fid (proof = `achievement:{id}:{fid}`,
  // enforced by the ledger's unique (action_type, proof) constraint), so this
  // isn't a repeatable/farmable action like the other payload-based types
  // above. The 6000 cap is just a defensive ceiling, comfortably above the
  // ~4,025 all 25 achievements sum to, so a user who unlocks all of them on
  // the same day (e.g. an early adopter backfilling history right after
  // launch) doesn't get truncated for genuinely earning every one of them.
  achievement:             { pts: 0,   dailyCap: 0    }, // handled via ACHIEVEMENT_CASE below
};

// Build the CASE expression once (avoids repeating in every query).
// Excludes gift_received/promotion/achievement/streak_bonus — all four are
// handled via payload-based variable-amount CASE branches instead of a
// fixed per-type pts.
const VARIABLE_AMOUNT_TYPES = new Set(["gift_received", "promotion", "achievement", "streak_bonus"]);
const CASE_EXPR = Object.entries(POINTS)
  .filter(([type, v]) => v.pts > 0 && v.dailyCap > 0 && !VARIABLE_AMOUNT_TYPES.has(type))
  .map(([type, { pts, dailyCap }]) =>
    `WHEN '${type}' THEN LEAST(cnt * ${pts}, ${dailyCap})`)
  .join("\n      ");

// gift_received: each row has payload->>'amount' with the actual pts value.
// We sum those amounts per (fid, day) and cap at 500.
const GIFT_CASE = `WHEN 'gift_received' THEN LEAST(COALESCE(gift_sum, 0), 500)`;
// promotion: same pattern — payload->>'amount' holds the actual scaled award.
// No separate 500/day points cap here on purpose — processPromotionAtomic
// already bounds how much can be earned per day via the promo category's
// 70%-of-allowance debit cap (server/db/allowance.ts), so a second, lower
// fixed cap here would just clip strong accounts below what their allowance
// already limits them to. 5000 is a defensive ceiling only (the real max
// achievable in a day is 70% of MAX_ALLOWANCE = 3500), never meant to bind.
const PROMO_CASE = `WHEN 'promotion' THEN LEAST(COALESCE(promo_sum, 0), 5000)`;
// achievement: same pattern — each row is a one-time unlock worth payload->>'amount'.
const ACHIEVEMENT_CASE = `WHEN 'achievement' THEN LEAST(COALESCE(achievement_sum, 0), 6000)`;
// streak_bonus: same pattern — payload->>'amount' holds the milestone-scaled
// award (see streakBonusPts in mini-routes.ts). Only one can land per day
// (the streak check runs once/day), so POINTS.streak_bonus.dailyCap (6000)
// is really the ceiling here, not this LEAST - kept for defense in depth.
const STREAK_CASE = `WHEN 'streak_bonus' THEN LEAST(COALESCE(streak_sum, 0), 6000)`;

// ── Core SQL ──────────────────────────────────────────────────────────────────

// Only fids that have minted the FidCaster Pass NFT count toward points or
// show up on the leaderboard - real actions still get logged for everyone
// (nothing here changes what's written to user_actions), but they simply
// don't score until the fid mints. The moment they do, every already-logged,
// already-verified action they've earned counts immediately - nothing is
// lost or has to be re-earned, it was just not aggregated until now.
const MINT_GATE_SQL = `fid IN (SELECT fid FROM nft_pass_mint_log)`;

const LEADERBOARD_SQL = `
WITH counted AS (
  SELECT fid, action_type,
         (created_at AT TIME ZONE 'UTC')::date AS d,
         COUNT(*) AS cnt,
         SUM(CASE WHEN action_type = 'gift_received'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS gift_sum,
         SUM(CASE WHEN action_type = 'promotion'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS promo_sum,
         SUM(CASE WHEN action_type = 'achievement'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS achievement_sum,
         SUM(CASE WHEN action_type = 'streak_bonus'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS streak_sum
  FROM user_actions
  WHERE verified = true AND excluded = false AND ${MINT_GATE_SQL}
  GROUP BY fid, action_type, d
),
scored AS (
  SELECT fid, CASE action_type
    ${GIFT_CASE}
    ${PROMO_CASE}
    ${ACHIEVEMENT_CASE}
    ${STREAK_CASE}
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
  SELECT action_type,
         (created_at AT TIME ZONE 'UTC')::date AS d,
         COUNT(*) AS cnt,
         SUM(CASE WHEN action_type = 'gift_received'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS gift_sum,
         SUM(CASE WHEN action_type = 'promotion'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS promo_sum,
         SUM(CASE WHEN action_type = 'achievement'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS achievement_sum,
         SUM(CASE WHEN action_type = 'streak_bonus'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS streak_sum
  FROM user_actions
  WHERE fid = $1 AND verified = true AND excluded = false
  GROUP BY action_type, d
),
scored AS (
  SELECT action_type, d, cnt, gift_sum, promo_sum, achievement_sum, streak_sum, CASE action_type
    ${GIFT_CASE}
    ${PROMO_CASE}
    ${ACHIEVEMENT_CASE}
    ${STREAK_CASE}
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

// Cheap, indexed existence check - used to short-circuit the heavier
// aggregate queries below entirely for a fid that hasn't minted, rather
// than running them and then zeroing the result.
export async function hasMintedPass(fid: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const { rows } = await pool.query(`SELECT 1 FROM nft_pass_mint_log WHERE fid = $1 LIMIT 1`, [fid]);
  return rows.length > 0;
}

export async function getFidPoints(fid: number): Promise<FidPoints> {
  const pool = getPool();
  if (!pool) return { fid, total_points: 0, breakdown: [] };
  if (!(await hasMintedPass(fid))) return { fid, total_points: 0, breakdown: [] };
  const { rows } = await pool.query(SINGLE_FID_SQL, [fid]);
  const breakdown = rows.map(r => ({
    action_type:   r.action_type,
    total_actions: Number(r.total_actions),
    points_earned: Number(r.points_earned),
  }));
  const total_points = breakdown.reduce((s, r) => s + r.points_earned, 0);
  return { fid, total_points, breakdown };
}

// Same CASE logic as SINGLE_FID_SQL/LEADERBOARD_SQL, just filtered to today
// (UTC) and summed instead of grouped by action_type. Built from the exact
// same GIFT_CASE/PROMO_CASE/ACHIEVEMENT_CASE/CASE_EXPR fragments those use -
// mini-routes.ts used to hand-roll its own separate copy of this for
// "today's points", which had drifted to be missing the promotion and
// achievement branches entirely (so anyone who earned either was scored low
// for level/XP and the points-based achievement tiers). One definition, no
// second copy to drift again.
const TODAY_POINTS_SQL = `
WITH counted AS (
  SELECT action_type,
         COUNT(*) AS cnt,
         SUM(CASE WHEN action_type = 'gift_received'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS gift_sum,
         SUM(CASE WHEN action_type = 'promotion'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS promo_sum,
         SUM(CASE WHEN action_type = 'achievement'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS achievement_sum,
         SUM(CASE WHEN action_type = 'streak_bonus'
                  THEN COALESCE((payload->>'amount')::integer, 0)
                  ELSE 0 END) AS streak_sum
  FROM user_actions
  WHERE fid = $1 AND verified = true AND excluded = false
    AND (created_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
  GROUP BY action_type
),
scored AS (
  SELECT CASE action_type
    ${GIFT_CASE}
    ${PROMO_CASE}
    ${ACHIEVEMENT_CASE}
    ${STREAK_CASE}
    ${CASE_EXPR}
    ELSE 0
  END AS day_pts
  FROM counted
)
SELECT COALESCE(SUM(day_pts), 0) AS today_points FROM scored
`;

export async function getFidTodayPoints(fid: number): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  if (!(await hasMintedPass(fid))) return 0;
  const { rows } = await pool.query(TODAY_POINTS_SQL, [fid]);
  return Number(rows[0]?.today_points ?? 0);
}

/**
 * Same as getFidPoints but WITHOUT the hasMintedPass gate.
 * Used when a user views their OWN stats in the mini app — every point they
 * legitimately earned should be visible regardless of NFT mint status.
 * The gate protects the public leaderboard / airdrop snapshot only, not the
 * user's personal view of their own points.
 */
export async function getFidPointsNoGate(fid: number): Promise<FidPoints> {
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

export async function getFidTodayPointsNoGate(fid: number): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { rows } = await pool.query(TODAY_POINTS_SQL, [fid]);
  return Number(rows[0]?.today_points ?? 0);
}

/** Full snapshot for Clanker airdrop input. Returns ALL eligible fids. */
export async function getFullSnapshot(): Promise<LeaderboardRow[]> {
  const pool = getPool();
  if (!pool) return [];
  const { rows } = await pool.query(LEADERBOARD_SQL, [1_000_000, 0]);
  return rows.map(r => ({ fid: Number(r.fid), total_points: Number(r.total_points), rank: Number(r.rank) }));
}

// ── Point types that actually earn something ──────────────────────────────────
// Payload-based variable-amount types (gift_received/promotion/achievement)
// all have a 0/unused `pts` in POINTS, so the plain `v.pts > 0` filter below
// would silently drop every one of them from the activity feed — gift_received
// was special-cased back in, but promotion and achievement were not, so
// neither ever showed up in "Recent Activity" no matter how many of either
// a user had earned.
const EARNING_TYPES = [
  ...Object.entries(POINTS).filter(([, v]) => v.pts > 0).map(([k]) => k),
  "gift_received", "promotion", "achievement",
];

export interface HistoryRow {
  id: number;
  action_type: string;
  pts: number;
  created_at: string; // ISO string
  fromFid?: number; // gift_received only - the sender's fid, for username enrichment
}

/**
 * Returns recent earning actions for a FID, newest-first.
 * Each row reflects the per-action point value (not daily-capped).
 * The breakdown remains the source-of-truth for totals.
 */
export async function getPointsHistory(fid: number, limit = 50): Promise<HistoryRow[]> {
  const pool = getPool();
  if (!pool) return [];
  if (!(await hasMintedPass(fid))) return [];
  const { rows } = await pool.query(
    `SELECT id, action_type, payload, created_at
     FROM user_actions
     WHERE fid = $1
       AND verified = true
       AND excluded = false
       AND action_type = ANY($3::text[])
     ORDER BY created_at DESC
     LIMIT $2`,
    [fid, Math.min(limit, 100), EARNING_TYPES],
  );
  // gift_received/promotion/achievement carry their real, variable amount in
  // payload.amount — POINTS[type].pts for those is either 0 or an unused
  // display default, and showing it instead of the real amount misrepresented
  // exactly how many points that row actually earned (e.g. every promotion
  // row read "+50" regardless of its real scaled award, which can be up to 500).
  const VARIABLE_TYPES = new Set(["gift_received", "promotion", "achievement", "streak_bonus"]);
  return rows.map(r => ({
    id:          Number(r.id),
    action_type: r.action_type,
    pts:         VARIABLE_TYPES.has(r.action_type)
      ? Number(r.payload?.amount ?? 0)
      : (POINTS[r.action_type]?.pts ?? 0),
    created_at:  r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    ...(r.action_type === "gift_received" && r.payload?.fromFid
      ? { fromFid: Number(r.payload.fromFid) } : {}),
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
