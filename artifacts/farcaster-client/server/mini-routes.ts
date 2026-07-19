/**
 * Mini App specific routes.
 *
 * GET /api/mini/eligibility?fid=XXX   – Neynar quality gate
 * GET /api/mini/stats?fid=XXX         – streak, level/XP, missions, achievements, today pts
 * GET /api/mini/leaderboard?limit=N   – leaderboard enriched with Neynar user profiles
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { neynarThrottle, penalize429, hasAnyNeynarKey } from "./neynar-limit.js";
import { getPool, isDbConfigured } from "./db/pool.js";
import { POINTS } from "./db/points.js";

const SCORE_THRESHOLD = 30;

const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const readLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

function fidFromQuery(q: unknown): number | null {
  const n = Number(q);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n < 1_000_000_000 ? n : null;
}

// ── Level system ──────────────────────────────────────────────────────────────
// Thresholds: points required to reach each level
const LEVEL_THRESHOLDS = [0, 500, 1500, 3000, 5500, 9000, 14000, 21000, 30000, 42000, 60000];

function calcLevel(totalPoints: number): { level: number; xp: number; xpToNext: number } {
  let level = 0;
  for (let i = 1; i < LEVEL_THRESHOLDS.length; i++) {
    if (totalPoints >= LEVEL_THRESHOLDS[i]) level = i;
    else break;
  }
  const xp = totalPoints - LEVEL_THRESHOLDS[level];
  const nextThreshold = LEVEL_THRESHOLDS[level + 1] ?? LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1] + 50000;
  const xpToNext = nextThreshold - LEVEL_THRESHOLDS[level];
  return { level, xp, xpToNext };
}

// ── Streak computation ─────────────────────────────────────────────────────────
function computeStreak(dates: string[]): number {
  if (!dates.length) return 0;
  // dates are ISO date strings sorted DESC
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const yesterdayDate = new Date(today);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().slice(0, 10);

  // Check if streak starts today or yesterday
  if (dates[0] !== todayStr && dates[0] !== yesterdayStr) return 0;

  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const prev = new Date(dates[i - 1] + "T00:00:00Z");
    const curr = new Date(dates[i] + "T00:00:00Z");
    const diffDays = Math.round((prev.getTime() - curr.getTime()) / 86_400_000);
    if (diffDays === 1) streak++;
    else break;
  }
  return streak;
}

// ── Daily missions definition ─────────────────────────────────────────────────
const MISSIONS = [
  { id: "cast_5",    action: "cast",    label: "Cast 5 times",       target: 5,  pts: 50  },
  { id: "like_10",   action: "like",    label: "Like 10 posts",       target: 10, pts: 10  },
  { id: "recast_3",  action: "recast",  label: "Recast 3 posts",      target: 3,  pts: 9   },
  { id: "follow_3",  action: "follow",  label: "Follow 3 users",      target: 3,  pts: 6   },
  { id: "quest_1",   action: "quest",   label: "Complete a quest",    target: 1,  pts: 100 },
];

// ── Achievements definition ────────────────────────────────────────────────────
const ACHIEVEMENTS = [
  { id: "first_cast",    label: "First Cast",     icon: "🎙️", check: (b: Record<string,number>) => (b.cast ?? 0) >= 1 },
  { id: "cast_50",       label: "Cast Master",    icon: "⚡", check: (b: Record<string,number>) => (b.cast ?? 0) >= 50 },
  { id: "social",        label: "Social Butterfly",icon: "🦋", check: (b: Record<string,number>) => (b.follow ?? 0) >= 10 },
  { id: "pts_1k",        label: "1K Points",      icon: "🏅", check: (_: Record<string,number>, pts: number) => pts >= 1000 },
  { id: "pts_10k",       label: "10K Points",     icon: "💎", check: (_: Record<string,number>, pts: number) => pts >= 10000 },
  { id: "referral",      label: "Recruiter",      icon: "👥", check: (b: Record<string,number>) => (b.referral ?? 0) >= 1 },
  { id: "market_maker",  label: "Market Maker",   icon: "📊", check: (b: Record<string,number>) => ((b.market_buy ?? 0) + (b.market_list ?? 0)) >= 1 },
  { id: "promoter",      label: "Promoter",       icon: "📣", check: (b: Record<string,number>) => (b.promotion ?? 0) >= 1 },
  { id: "gift_giver",    label: "Gift Giver",     icon: "🎁", check: (b: Record<string,number>) => (b.gift ?? 0) >= 1 },
];

// ── Neynar bulk fetch helper ──────────────────────────────────────────────────
async function fetchNeynarUsers(fids: number[]): Promise<Map<number, { username: string; pfpUrl: string; displayName: string }>> {
  const map = new Map<number, { username: string; pfpUrl: string; displayName: string }>();
  if (!hasAnyNeynarKey() || !fids.length) return map;
  try {
    const apiKey = await neynarThrottle();
    const r = await fetch(
      `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fids.slice(0, 100).join(",")}`,
      {
        headers: { accept: "application/json", api_key: apiKey },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!r.ok) {
      if (r.status === 429) penalize429(apiKey);
      return map;
    }
    const data = await r.json() as { users?: { fid?: number; username?: string; display_name?: string; pfp_url?: string }[] };
    for (const u of data.users ?? []) {
      if (u.fid) {
        map.set(u.fid, {
          username:    u.username    ?? `fid${u.fid}`,
          displayName: u.display_name ?? u.username ?? `FID ${u.fid}`,
          pfpUrl:      u.pfp_url ?? "",
        });
      }
    }
  } catch { /* be permissive */ }
  return map;
}

export function registerMiniRoutes(app: Express): void {

  // ── GET /api/mini/user?fid=XXX — lightweight Neynar profile for preview mode ─
  app.get("/api/mini/user", limiter, async (req: Request, res: Response) => {
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }
    const map = await fetchNeynarUsers([fid]);
    const u = map.get(fid);
    if (!u) { res.status(404).json({ error: "not found" }); return; }
    res.json(u);
  });

  // ── GET /api/mini/eligibility?fid=XXX ────────────────────────────────────────
  app.get("/api/mini/eligibility", limiter, async (req: Request, res: Response) => {
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }

    if (!hasAnyNeynarKey()) {
      res.json({ eligible: true, score: -1, threshold: SCORE_THRESHOLD, reason: "no_key" });
      return;
    }

    try {
      const apiKey = await neynarThrottle();
      const r = await fetch(
        `https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`,
        {
          headers: { accept: "application/json", api_key: apiKey },
          signal: AbortSignal.timeout(8_000),
        },
      );

      if (!r.ok) {
        if (r.status === 429) penalize429(apiKey);
        res.json({ eligible: true, score: -1, threshold: SCORE_THRESHOLD, reason: "neynar_error" });
        return;
      }

      const data = await r.json() as {
        users?: {
          fid?: number;
          follower_count?: number;
          experimental?: { neynar_user_score?: number };
        }[];
      };

      const user = data.users?.[0];
      const score = typeof user?.experimental?.neynar_user_score === "number"
        ? user.experimental.neynar_user_score
        : -1;

      const eligible = score < 0 || score >= SCORE_THRESHOLD;
      res.json({ eligible, score, threshold: SCORE_THRESHOLD });
    } catch {
      res.json({ eligible: true, score: -1, threshold: SCORE_THRESHOLD, reason: "timeout" });
    }
  });

  // ── GET /api/mini/stats?fid=XXX ───────────────────────────────────────────────
  app.get("/api/mini/stats", readLimiter, async (req: Request, res: Response) => {
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }

    if (!isDbConfigured()) {
      // Return sensible defaults when DB isn't configured
      res.json({
        streak: 0, level: 0, xp: 0, xpToNext: 500,
        totalPoints: 0, todayPoints: 0, missions: MISSIONS.map(m => ({ ...m, count: 0 })),
        achievements: ACHIEVEMENTS.map(a => ({ id: a.id, label: a.label, icon: a.icon, unlocked: false })),
        seasonEnd: "2025-12-31",
      });
      return;
    }

    const pool = getPool();
    if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

    try {
      // Fetch active dates for streak
      const { rows: dateRows } = await pool.query<{ d: string }>(
        `SELECT DISTINCT (created_at AT TIME ZONE 'UTC')::date::text AS d
         FROM user_actions
         WHERE fid = $1 AND verified = true AND excluded = false
         ORDER BY d DESC LIMIT 365`,
        [fid],
      );
      const streak = computeStreak(dateRows.map(r => r.d));

      // Build the CASE expr for total/today points
      const caseExpr = Object.entries(POINTS)
        .filter(([type, v]) => v.pts > 0 && v.dailyCap > 0 && type !== "gift_received")
        .map(([type, { pts, dailyCap }]) =>
          `WHEN '${type}' THEN LEAST(cnt * ${pts}, ${dailyCap})`)
        .join("\n");
      const giftCase = `WHEN 'gift_received' THEN LEAST(COALESCE(gift_sum, 0), 500)`;

      // Total points
      const { rows: totalRows } = await pool.query<{ total_points: string }>(
        `WITH counted AS (
           SELECT action_type, (created_at AT TIME ZONE 'UTC')::date AS d,
                  COUNT(*) AS cnt,
                  SUM(CASE WHEN action_type='gift_received' THEN COALESCE((payload->>'amount')::int,0) ELSE 0 END) AS gift_sum
           FROM user_actions
           WHERE fid=$1 AND verified=true AND excluded=false
           GROUP BY action_type, d
         ),
         scored AS (
           SELECT CASE action_type ${giftCase} ${caseExpr} ELSE 0 END AS day_pts FROM counted
         )
         SELECT COALESCE(SUM(day_pts), 0) AS total_points FROM scored`,
        [fid],
      );
      const totalPoints = Number(totalRows[0]?.total_points ?? 0);

      // Today's points
      const { rows: todayRows } = await pool.query<{ today_points: string }>(
        `WITH counted AS (
           SELECT action_type, COUNT(*) AS cnt,
                  SUM(CASE WHEN action_type='gift_received' THEN COALESCE((payload->>'amount')::int,0) ELSE 0 END) AS gift_sum
           FROM user_actions
           WHERE fid=$1 AND verified=true AND excluded=false
             AND (created_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
           GROUP BY action_type
         ),
         scored AS (
           SELECT CASE action_type ${giftCase} ${caseExpr} ELSE 0 END AS day_pts FROM counted
         )
         SELECT COALESCE(SUM(day_pts), 0) AS today_points FROM scored`,
        [fid],
      );
      const todayPoints = Number(todayRows[0]?.today_points ?? 0);

      // Today's action counts per type (for missions)
      const { rows: todayActionRows } = await pool.query<{ action_type: string; cnt: string }>(
        `SELECT action_type, COUNT(*) AS cnt
         FROM user_actions
         WHERE fid=$1 AND verified=true AND excluded=false
           AND (created_at AT TIME ZONE 'UTC')::date = CURRENT_DATE
         GROUP BY action_type`,
        [fid],
      );
      const todayCounts: Record<string, number> = {};
      for (const r of todayActionRows) todayCounts[r.action_type] = Number(r.cnt);

      // Total action counts per type (for achievements)
      const { rows: totalActionRows } = await pool.query<{ action_type: string; cnt: string }>(
        `SELECT action_type, COUNT(*) AS cnt
         FROM user_actions
         WHERE fid=$1 AND verified=true AND excluded=false
         GROUP BY action_type`,
        [fid],
      );
      const totalCounts: Record<string, number> = {};
      for (const r of totalActionRows) totalCounts[r.action_type] = Number(r.cnt);

      const { level, xp, xpToNext } = calcLevel(totalPoints);

      const missions = MISSIONS.map(m => ({
        ...m,
        count: Math.min(todayCounts[m.action] ?? 0, m.target),
        done: (todayCounts[m.action] ?? 0) >= m.target,
      }));

      const achievements = ACHIEVEMENTS.map(a => ({
        id: a.id, label: a.label, icon: a.icon,
        unlocked: a.check(totalCounts, totalPoints),
      }));

      res.json({
        streak, level, xp, xpToNext, totalPoints, todayPoints,
        missions, achievements,
        seasonEnd: "2025-12-31",
      });
    } catch (e) {
      console.error("[mini/stats] error:", e);
      res.status(500).json({ error: "Failed to compute stats" });
    }
  });

  // ── GET /api/mini/leaderboard?limit=N ─────────────────────────────────────────
  app.get("/api/mini/leaderboard", readLimiter, async (req: Request, res: Response) => {
    if (!isDbConfigured()) {
      res.json({ leaderboard: [] });
      return;
    }

    const pool = getPool();
    if (!pool) { res.status(503).json({ error: "DB not available" }); return; }

    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    try {
      // Build leaderboard SQL inline
      const caseExpr = Object.entries(POINTS)
        .filter(([type, v]) => v.pts > 0 && v.dailyCap > 0 && type !== "gift_received")
        .map(([type, { pts, dailyCap }]) =>
          `WHEN '${type}' THEN LEAST(cnt * ${pts}, ${dailyCap})`)
        .join("\n");
      const giftCase = `WHEN 'gift_received' THEN LEAST(COALESCE(gift_sum, 0), 500)`;

      const { rows } = await pool.query<{ fid: string; total_points: string; rank: string }>(
        `WITH counted AS (
           SELECT fid, action_type, (created_at AT TIME ZONE 'UTC')::date AS d,
                  COUNT(*) AS cnt,
                  SUM(CASE WHEN action_type='gift_received' THEN COALESCE((payload->>'amount')::int,0) ELSE 0 END) AS gift_sum
           FROM user_actions WHERE verified=true AND excluded=false
           GROUP BY fid, action_type, d
         ),
         scored AS (
           SELECT fid, CASE action_type ${giftCase} ${caseExpr} ELSE 0 END AS day_pts FROM counted
         ),
         totals AS (
           SELECT fid, SUM(day_pts) AS total_points FROM scored GROUP BY fid HAVING SUM(day_pts) > 0
         )
         SELECT fid, total_points, RANK() OVER (ORDER BY total_points DESC) AS rank
         FROM totals ORDER BY total_points DESC LIMIT $1`,
        [limit],
      );

      const fids = rows.map(r => Number(r.fid));
      const userMap = await fetchNeynarUsers(fids);

      const leaderboard = rows.map(r => {
        const f = Number(r.fid);
        const u = userMap.get(f);
        return {
          fid: f,
          total_points: Number(r.total_points),
          rank: Number(r.rank),
          username: u?.username ?? `fid${f}`,
          displayName: u?.displayName ?? `FID ${f}`,
          pfpUrl: u?.pfpUrl ?? "",
        };
      });

      res.json({ leaderboard });
    } catch (e) {
      console.error("[mini/leaderboard] error:", e);
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });
}
