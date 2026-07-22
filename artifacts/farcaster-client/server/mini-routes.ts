/**
 * Mini App specific routes.
 *
 * GET /api/mini/eligibility?fid=XXX   – Neynar quality gate
 * GET /api/mini/stats?fid=XXX         – streak, level/XP, missions, achievements, today pts
 * GET /api/mini/leaderboard?limit=N   – leaderboard enriched with Neynar user profiles
 */

import express from "express";
import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { neynarThrottle, penalize429, hasAnyNeynarKey } from "./neynar-limit.js";
import { getPool, isDbConfigured } from "./db/pool.js";
import { POINTS, getFidPoints, getFidTodayPoints, getFidPointsNoGate, getFidTodayPointsNoGate, getLeaderboard } from "./db/points.js";
import { upsertNotificationToken, sendFarcasterNotification } from "./db/notifications.js";
import { achievementUnlockedNotif } from "./notification-templates.js";
import { checkAndAwardNftHolderBonus } from "./nft-holder-check.js";
import { getTrustedFid } from "./auth.js";
import { logUserAction, logUserActionIfNew, touchUser } from "./db/ledger.js";
import { scheduleWebhookSync } from "./push-routes.js";

// Neynar's neynar_user_score is a 0-1 float (not a 0-100 scale).
const SCORE_THRESHOLD = 0.3;

// Only actions that actually earn points count toward the daily streak.
// Zero-value types (unlike, unrecast, unfollow, app_open, grow_campaign_start,
// gift, market_cancel) are trivially cheap to fabricate a verified row for —
// counting them would let someone maintain a streak (and collect the 500pt
// weekly streak_bonus) for free without ever doing anything real.
const STREAK_EXCLUDED_TYPES = new Set(["streak_bonus", "nft_holder_bonus", "referral_welcome", "referral"]);
const STREAK_ELIGIBLE_TYPES = Object.entries(POINTS)
  .filter(([type, v]) => v.pts > 0 && !STREAK_EXCLUDED_TYPES.has(type))
  .map(([type]) => type);

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

// Each call does two RPC reads (Optimism ID Registry + Base balanceOfBatch)
// against free public endpoints, so it gets its own tight, per-caller cap —
// generous enough for "once on app open + occasional manual re-check", not
// enough for anyone to hammer the RPC fallback pool.
const nftCheckLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,
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

// Scales with WHICH 7-day milestone is being hit (750/week, capped at 6000 -
// reached at week 8 / day 56) instead of a flat 500 forever - rewards
// sticking with a longer streak, not just crossing 7 days once. Must match
// POINTS.streak_bonus.dailyCap in db/points.ts (the real ceiling).
function streakBonusPts(streakDays: number): number {
  const week = Math.round(streakDays / 7);
  return Math.min(750 * week, 6000);
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
  { id: "cast_5",     action: "cast",         label: "Cast 5 times",           target: 5,  pts: 50  },
  { id: "like_10",    action: "like",         label: "Like 10 posts",          target: 10, pts: 10  },
  { id: "recast_3",   action: "recast",       label: "Recast 3 posts",         target: 3,  pts: 9   },
  { id: "follow_3",   action: "follow",       label: "Follow 3 users",         target: 3,  pts: 6   },
  { id: "promo_1",    action: "promotion",    label: "Promote FidCaster",      target: 1,  pts: 20  },
  { id: "gift_1",     action: "gift",         label: "Send a gift",            target: 1,  pts: 15  },
  { id: "market_1",   action: "market_list",  label: "List on FID Market",     target: 1,  pts: 20  },
  { id: "market_buy_1", action: "market_buy", label: "Buy on FID Market",      target: 1,  pts: 30  },
  { id: "grow_1",     action: "grow_campaign_complete", label: "Complete a Grow campaign", target: 1, pts: 15 },
  { id: "referral_1", action: "referral",     label: "Refer a friend",         target: 1,  pts: 40  },
];

// ── Achievements definition ────────────────────────────────────────────────────
// Tiered like a real competitive app: every achievement states exactly how
// it's earned (requirement) and how far along the user is (progress/target),
// not just a locked/unlocked icon. `metric` picks what `progress` counts
// against — a lifetime action-type count, total points, or current streak.
type AchievementMetric = "cast" | "like" | "recast" | "follow" | "points" | "referral" | "market" | "promotion" | "gift" | "streak" | "nft";
interface AchievementDef {
  id: string; label: string; icon: string; tier: "bronze" | "silver" | "gold" | "platinum";
  metric: AchievementMetric; target: number; requirement: string; pts: number;
}
const ACHIEVEMENTS: AchievementDef[] = [
  // Casts
  { id: "first_cast",  label: "First Cast",      icon: "🎙️", tier: "bronze", metric: "cast",   target: 1,   requirement: "Cast 1 time",   pts: 10  },
  { id: "cast_10",     label: "Getting Vocal",    icon: "🗣️", tier: "bronze", metric: "cast",   target: 10,  requirement: "Cast 10 times",  pts: 20  },
  { id: "cast_50",     label: "Cast Master",      icon: "⚡", tier: "silver", metric: "cast",   target: 50,  requirement: "Cast 50 times",  pts: 75  },
  { id: "cast_200",    label: "Broadcast Legend", icon: "📡", tier: "gold",   metric: "cast",   target: 200, requirement: "Cast 200 times", pts: 350 },
  // Likes
  { id: "like_25",     label: "Appreciator",      icon: "❤️", tier: "bronze", metric: "like",   target: 25,  requirement: "Like 25 posts",  pts: 15  },
  { id: "like_100",    label: "Serial Liker",     icon: "💯", tier: "silver", metric: "like",   target: 100, requirement: "Like 100 posts", pts: 50  },
  // Recasts
  { id: "recast_10",   label: "Amplifier",        icon: "🔁", tier: "bronze", metric: "recast", target: 10,  requirement: "Recast 10 posts", pts: 15 },
  { id: "recast_50",   label: "Signal Booster",   icon: "📶", tier: "silver", metric: "recast", target: 50,  requirement: "Recast 50 posts", pts: 60 },
  // Follows
  { id: "social",      label: "Social Butterfly", icon: "🦋", tier: "bronze", metric: "follow", target: 10,  requirement: "Follow 10 users", pts: 15 },
  { id: "social_50",   label: "Networker",        icon: "🌐", tier: "silver", metric: "follow", target: 50,  requirement: "Follow 50 users", pts: 60 },
  // Points
  { id: "pts_1k",      label: "1K Points",        icon: "🏅", tier: "bronze", metric: "points", target: 1_000,  requirement: "Reach 1,000 total points",  pts: 75   },
  { id: "pts_10k",     label: "10K Points",       icon: "💎", tier: "silver", metric: "points", target: 10_000, requirement: "Reach 10,000 total points", pts: 350  },
  { id: "pts_50k",     label: "Points Legend",    icon: "👑", tier: "gold",   metric: "points", target: 50_000, requirement: "Reach 50,000 total points", pts: 1000 },
  // Referrals
  { id: "referral",    label: "Recruiter",        icon: "👥", tier: "bronze", metric: "referral", target: 1,  requirement: "Refer 1 friend",                 pts: 30  },
  { id: "referral_5",  label: "Talent Scout",     icon: "🧲", tier: "silver", metric: "referral", target: 5,  requirement: "Refer 5 friends",                pts: 100 },
  { id: "referral_20", label: "Community Builder",icon: "🏛️", tier: "gold",   metric: "referral", target: 20, requirement: "Refer 20 friends (lifetime cap)", pts: 600 },
  // Market
  { id: "market_maker",label: "Market Maker",     icon: "📊", tier: "bronze", metric: "market",   target: 1,  requirement: "Complete 1 FID Market trade",  pts: 25  },
  { id: "market_pro",  label: "Market Pro",       icon: "📈", tier: "silver", metric: "market",   target: 10, requirement: "Complete 10 FID Market trades", pts: 100 },
  // Promotion / Gift (Allowance-funded)
  { id: "promoter",    label: "Promoter",         icon: "📣", tier: "bronze", metric: "promotion",target: 1,  requirement: "Post 1 Promote cast",  pts: 25  },
  { id: "promoter_10", label: "Growth Hacker",    icon: "🚀", tier: "silver", metric: "promotion",target: 10, requirement: "Post 10 Promote casts", pts: 100 },
  { id: "gift_giver",  label: "Gift Giver",       icon: "🎁", tier: "bronze", metric: "gift",     target: 1,  requirement: "Send 1 gift",   pts: 20 },
  { id: "gift_giver_10",label: "Generous Soul",   icon: "🎀", tier: "silver", metric: "gift",     target: 10, requirement: "Send 10 gifts", pts: 80 },
  // Streak
  { id: "streak_7",    label: "Week Warrior",     icon: "🔥", tier: "silver", metric: "streak",   target: 7,  requirement: "Reach a 7-day streak",  pts: 100 },
  { id: "streak_30",   label: "Unstoppable",      icon: "🌋", tier: "gold",   metric: "streak",   target: 30, requirement: "Reach a 30-day streak", pts: 600 },
  // Special
  { id: "nft_holder",  label: "Pass Holder",      icon: "🛡️", tier: "platinum", metric: "nft",    target: 1,  requirement: "Hold a FasterTask Pass NFT", pts: 150 },
];

function achievementProgress(a: AchievementDef, totalCounts: Record<string, number>, totalPoints: number, streak: number): number {
  switch (a.metric) {
    case "cast": return totalCounts.cast ?? 0;
    case "like": return totalCounts.like ?? 0;
    case "recast": return totalCounts.recast ?? 0;
    case "follow": return totalCounts.follow ?? 0;
    case "points": return totalPoints;
    case "referral": return totalCounts.referral ?? 0;
    case "market": return (totalCounts.market_buy ?? 0) + (totalCounts.market_list ?? 0);
    case "promotion": return totalCounts.promotion ?? 0;
    case "gift": return totalCounts.gift ?? 0;
    case "streak": return streak;
    case "nft": return (totalCounts.nft_holder_bonus ?? 0) >= 1 ? 1 : 0;
  }
}

// ── Neynar bulk fetch helper ──────────────────────────────────────────────────
export async function fetchNeynarUsers(fids: number[]): Promise<Map<number, { username: string; pfpUrl: string; displayName: string }>> {
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

  // ── GET /api/mini/check-follow?fid=XXX — does this fid follow @fidcaster? ───
  // Used by the mandatory "Follow @fidcaster" onboarding step. Reads Neynar's
  // viewer_context.following on the app's own account, viewed as this fid -
  // no separate "list followers and search" call needed.
  app.get("/api/mini/check-follow", limiter, async (req: Request, res: Response) => {
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }
    const appFid = Number(process.env.APP_FID);
    if (!Number.isFinite(appFid) || appFid <= 0) { res.status(503).json({ error: "APP_FID not configured" }); return; }
    if (!hasAnyNeynarKey()) { res.status(503).json({ error: "Neynar not configured" }); return; }
    try {
      const apiKey = await neynarThrottle();
      const r = await fetch(
        `https://api.neynar.com/v2/farcaster/user/bulk?fids=${appFid}&viewer_fid=${fid}`,
        { headers: { accept: "application/json", api_key: apiKey }, signal: AbortSignal.timeout(8_000) },
      );
      if (!r.ok) {
        if (r.status === 429) penalize429(apiKey);
        res.status(502).json({ error: "Neynar lookup failed" });
        return;
      }
      const data = await r.json() as { users?: { viewer_context?: { following?: boolean } }[] };
      const following = data.users?.[0]?.viewer_context?.following === true;
      res.json({ following });
    } catch (e) {
      console.error("[mini] check-follow error:", (e as Error).message);
      res.status(500).json({ error: "check failed" });
    }
  });

  // ── POST /api/mini/nft-holder-check — on demand, no background polling ──────
  // Called once automatically on first app open, and again on manual re-check.
  app.post("/api/mini/nft-holder-check", nftCheckLimiter, async (req: Request, res: Response) => {
    const body = req.body as { fid?: unknown };
    const fid = fidFromQuery(body.fid);
    if (!fid) { res.status(400).json({ error: "fid required" }); return; }
    const trusted = await getTrustedFid(req);
    if (trusted.invalidToken || (trusted.fid !== null && trusted.fid !== fid))
      { res.status(401).json({ error: "Token does not match claimed fid" }); return; }
    try {
      const result = await checkAndAwardNftHolderBonus(fid);
      res.json(result);
    } catch (e) {
      console.error("[mini] nft-holder-check error:", (e as Error).message);
      res.status(500).json({ error: "check failed" });
    }
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

    // Register this FID as an app user so the Neynar webhook sync includes
    // them in author_fids immediately — without this, a brand-new user who
    // opens the app and tries to gift/promote before the next periodic sync
    // (was 10 min, now 2 min) would have their casts silently ignored.
    // touchUser + scheduleWebhookSync is idempotent and debounced (5s timer).
    void touchUser(fid).then(() => scheduleWebhookSync()).catch(() => {});

    if (!isDbConfigured()) {
      // Return sensible defaults when DB isn't configured
      res.json({
        streak: 0, level: 0, xp: 0, xpToNext: 500,
        totalPoints: 0, todayPoints: 0, missions: MISSIONS.map(m => ({ ...m, count: 0 })),
        achievements: ACHIEVEMENTS.map(a => ({
          id: a.id, label: a.label, icon: a.icon, tier: a.tier, requirement: a.requirement,
          target: a.target, progress: 0, unlocked: false, pts: a.pts,
        })),
        breakdown: [],
        nextStreakBonusPts: streakBonusPts(7),
        streakBonusAwarded: false,
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
           AND action_type = ANY($2::text[])
         ORDER BY d DESC LIMIT 365`,
        [fid, STREAK_ELIGIBLE_TYPES],
      );
      const activeDates = dateRows.map(r => r.d);
      const streak = computeStreak(activeDates);

      // Award a one-time, milestone-scaled bonus each time the streak
      // crosses a 7-day mark, on the day it's actually reached (idempotent
      // on proof). See streakBonusPts above for the scaling.
      let streakBonusAwarded = false;
      const todayStr = new Date().toISOString().slice(0, 10);
      if (streak > 0 && streak % 7 === 0 && activeDates[0] === todayStr) {
        // Routed through the single write path (db/ledger.ts explicitly
        // documents logUserAction/logUserActionIfNew as the only place
        // user_actions should be inserted) instead of a raw INSERT here.
        streakBonusAwarded = await logUserActionIfNew({
          fid, actionType: "streak_bonus",
          payload: { streak, amount: streakBonusPts(streak) }, proof: `streak_bonus:${fid}:${todayStr}`,
          verified: true,
        }).catch(() => false);
      }

      // Total + today's points — both come from db/points.ts's single
      // maintained scoring definition (getFidPoints/getFidTodayPoints), not
      // a second hand-rolled copy of the CASE logic here. That copy used to
      // exist and had drifted to omit the promotion/achievement branches
      // entirely, silently under-scoring level/XP and the points-tier
      // achievements for anyone who'd earned either.
      // Use the no-gate versions for a user's own stats: every point they earned
      // should be visible to them regardless of NFT mint status. The gate exists
      // for the public leaderboard/airdrop snapshot, not the personal dashboard.
      // breakdown is included in the response below - the Home tab derives
      // per-type tiles (Referrals, Completed) from it, and used to read the
      // GATED /api/points/my breakdown instead, which returns empty for any
      // fid that hasn't minted the Pass yet - so a non-minter's Total Points
      // could show their real (ungated) total while Referrals/Completed sat
      // stuck at 0, looking like referral/gift points "didn't count".
      const { total_points: totalPoints, breakdown } = await getFidPointsNoGate(fid);
      const todayPoints = await getFidTodayPointsNoGate(fid);

      // Today's action counts per type (for missions)
      const { rows: todayActionRows } = await pool.query<{ action_type: string; cnt: string }>(
        `SELECT action_type, COUNT(*) AS cnt
         FROM user_actions
         WHERE fid=$1 AND verified=true AND excluded=false
           AND (created_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date
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

      const missions = MISSIONS.map(m => ({
        ...m,
        count: Math.min(todayCounts[m.action] ?? 0, m.target),
        done: (todayCounts[m.action] ?? 0) >= m.target,
      }));

      // Achievements are permanent once earned. Progress can DROP after an
      // unlock — a streak breaks (streak_7's progress is the CURRENT streak),
      // totalPoints shrinks when fraud detection excludes rows — and deriving
      // unlocked from live progress alone would visually re-lock an
      // achievement whose one-time points were already (correctly, and
      // permanently) awarded. The awarded ledger rows are the durable record
      // of "earned", so anything with a row stays unlocked forever.
      const { rows: awardedRows } = await pool.query<{ id: string }>(
        `SELECT payload->>'id' AS id FROM user_actions
         WHERE fid=$1 AND action_type='achievement'`,
        [fid],
      );
      const awardedIds = new Set(awardedRows.map(r => r.id));

      // runningTotal tracks points awarded by THIS call as achievements unlock,
      // so the response (level/xp/totalPoints) reflects its own awards instead
      // of the pre-award snapshot read above. Without this, a request that
      // unlocks an achievement would return level/xp/totalPoints exactly as if
      // it hadn't - correct only on the NEXT fetch - and since the mini app no
      // longer polls every 20s (only on visibility change), that staleness was
      // very visible (e.g. "+150 achievement just now" but the total up top
      // still reads what it was before). Also lets a "points" tier achievement
      // cascade-unlock within the same request if this round's awards cross
      // its threshold, instead of waiting one more round trip.
      let runningTotal = totalPoints;
      let awardedThisCall = 0;

      const achievements = ACHIEVEMENTS.map(a => {
        const progress = achievementProgress(a, totalCounts, runningTotal, streak);
        const unlocked = progress >= a.target || awardedIds.has(a.id);
        // Fire-and-forget the actual DB write (idempotent on (action_type, proof),
        // so calling it every stats fetch after the first unlock is harmless) -
        // but runningTotal/awardedThisCall update synchronously so this response
        // is correct even though the insert itself hasn't landed yet.
        if (unlocked && a.pts > 0 && !awardedIds.has(a.id)) {
          void logUserAction({
            fid, actionType: "achievement",
            payload: { id: a.id, amount: a.pts },
            proof: `achievement:${a.id}:${fid}`,
            verified: true,
          });
          void sendFarcasterNotification({
            ...achievementUnlockedNotif(a.label, a.pts),
            targetFids: [fid],
            targetUrl: "https://fidcaster.xyz/mini",
          });
          runningTotal += a.pts;
          awardedThisCall += a.pts;
        }
        return {
          id: a.id, label: a.label, icon: a.icon, tier: a.tier, requirement: a.requirement,
          // An unlocked achievement is done — show it full even if the live
          // metric has since dipped back under the target.
          target: a.target, progress: unlocked ? a.target : Math.min(progress, a.target),
          unlocked, pts: a.pts,
        };
      });

      const finalTotalPoints = runningTotal;
      const finalTodayPoints = todayPoints + awardedThisCall;
      const { level, xp, xpToNext } = calcLevel(finalTotalPoints);

      res.json({
        streak, level, xp, xpToNext, totalPoints: finalTotalPoints, todayPoints: finalTodayPoints,
        missions, achievements, todayCounts, breakdown,
        nextStreakBonusPts: streakBonusPts(streak - (streak % 7) + 7),
        streakBonusAwarded,
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
      // Was a hand-rolled duplicate of db/points.ts's leaderboard SQL that had
      // drifted the exact same way mini/stats's totalPoints once had: it
      // completely omitted achievement points (so anyone who'd earned any
      // showed correctly in their own total/profile but never had it counted
      // here) and scored promotion at a flat cnt*50 instead of each cast's
      // real variable payload amount. Reusing getLeaderboard() means there's
      // only one leaderboard SQL to keep correct, not two.
      const rows = await getLeaderboard(limit);
      const fids = rows.map(r => r.fid);
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

  // ── POST /api/mini/notification-token ───────────────────────────────────────
  // Client posts after sdk.on("frameAdded") or sdk.actions.addFrame() resolves.
  app.post("/api/mini/notification-token", express.json(), async (req: Request, res: Response) => {
    const { fid, token, url } = req.body ?? {};
    if (!fid || !token || !url) {
      return res.status(400).json({ error: "fid, token, url required" });
    }
    try {
      await upsertNotificationToken(Number(fid), String(token), String(url));
      res.json({ ok: true });
    } catch (e) {
      console.error("[mini/notification-token] error:", e);
      res.status(500).json({ error: "Failed to save token" });
    }
  });
}
