/**
 * Referral tracking.
 *
 * Referral code = base-36 encoding of the referrer's FID.
 * Each user can only be referred once (unique constraint on referred_fid).
 *
 * SECURITY:
 *   - Self-referral: blocked (referrer === referred FID)
 *   - Circular referral: blocked (A→B and B→A cannot both exist)
 *   - Max eligible referrals: LIFETIME_MAX per referrer (stored referrals
 *     beyond this limit are recorded but don't pay out).
 *
 * Flow:
 *   1. Referred user calls /api/referral/claim → claimReferral() stores the
 *      row and awards BOTH sides immediately: 50 welcome pts to the new
 *      user, 200 pts to the referrer (subject to the lifetime cap). This
 *      used to defer the referrer's payout until the referred user earned
 *      ≥100 organic pts (anti-bot-farming), but that made a normal referral
 *      look broken to the referrer for hours/days with no feedback — traded
 *      deliberately for instant, unconditional payouts on both sides.
 *   2. activatePendingReferrals() (still run by the verification job every
 *      5 min) is now only a backward-compat sweep for any referral rows
 *      that were inserted before this change and are still sitting
 *      activated=false from the old deferred-activation flow.
 */

import { getPool } from "./pool.js";
import { logUserAction } from "./ledger.js";
import { getFidPoints, POINTS } from "./points.js";
import { sendFarcasterNotification } from "./notifications.js";
import { referralWelcomeNotif, referralBonusNotif } from "../notification-templates.js";

const ACTIVATION_THRESHOLD = 100; // referred user must earn 100 pts before referrer gets credit
const LIFETIME_MAX          = 20;  // max referrals that pay out per referrer (ever, not per day)

// ── Code helpers ──────────────────────────────────────────────────────────────

// "FC-" prefix is cosmetic (a bare base36 fid like "CLP" reads as an
// arbitrary 3-letter string, not obviously a referral code) - codeToFid
// strips it if present so old links shared without it still work.
const CODE_PREFIX = "FC-";

export function fidToCode(fid: number): string {
  return CODE_PREFIX + fid.toString(36).toUpperCase(); // e.g. 16333 -> "FC-CLP"
}

export function codeToFid(code: string): number | null {
  let c = code.trim().toLowerCase();
  if (c.startsWith(CODE_PREFIX.toLowerCase())) c = c.slice(CODE_PREFIX.length);
  const n = parseInt(c, 36);
  return Number.isFinite(n) && n > 0 && n < 1_000_000_000 ? n : null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Returns null if already referred or referrer === referred.
 *
 *  Both sides are paid immediately: the new user gets a 50pt welcome bonus,
 *  and the referrer gets 200pts right away too, as long as they're still
 *  under their lifetime referral cap. */
export async function claimReferral(
  code: string,
  newFid: number,
): Promise<{ ok: true; referrerFid: number } | { ok: false; reason: string }> {
  const referrerFid = codeToFid(code);
  if (!referrerFid) return { ok: false, reason: "Invalid referral code" };
  if (referrerFid === newFid) return { ok: false, reason: "Cannot refer yourself" };

  const pool = getPool();
  if (!pool) return { ok: false, reason: "DB not configured" };

  // Anti-circular: block if the new user has already referred the referrer
  const { rows: circularCheck } = await pool.query(
    `SELECT 1 FROM referrals WHERE referrer_fid = $1 AND referred_fid = $2 LIMIT 1`,
    [newFid, referrerFid],
  );
  if (circularCheck.length > 0) {
    return { ok: false, reason: "Circular referral not allowed" };
  }

  // Idempotent insert — activated=false until the payout below (if any) flips it
  const { rowCount } = await pool.query(
    `INSERT INTO referrals (referrer_fid, referred_fid, code, activated)
     VALUES ($1, $2, $3, false)
     ON CONFLICT (referred_fid) DO NOTHING`,
    [referrerFid, newFid, code.toUpperCase()],
  );

  if (!rowCount || rowCount === 0) return { ok: false, reason: "Already referred by someone" };

  // Welcome bonus for new user (immediate — they're a real person signing up)
  await logUserAction({
    fid: newFid,
    actionType: "referral_welcome",
    payload: { referred_by: referrerFid },
    proof: `referral_welcome:${newFid}`,
    verified: true,
  });
  void sendFarcasterNotification({
    ...referralWelcomeNotif(),
    targetFids: [newFid],
    targetUrl: "https://fidcaster.xyz/mini",
  });

  // Referrer's bonus — immediate too, still subject to the lifetime cap so a
  // single account can't be re-used indefinitely to farm 200pts a pop.
  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*) AS n FROM referrals WHERE referrer_fid = $1 AND activated = true`,
    [referrerFid],
  );
  if (Number(countRows[0]?.n ?? 0) < LIFETIME_MAX) {
    await pool.query(
      `UPDATE referrals SET activated = true, activated_at = now() WHERE referrer_fid = $1 AND referred_fid = $2`,
      [referrerFid, newFid],
    );
    await logUserAction({
      fid: referrerFid,
      actionType: "referral",
      payload: { referred_fid: newFid },
      proof: `referral:${referrerFid}:${newFid}`,
      verified: true,
    });
    void sendFarcasterNotification({
      ...referralBonusNotif(POINTS.referral.pts),
      targetFids: [referrerFid],
      targetUrl: "https://fidcaster.xyz/mini",
    });
  }

  return { ok: true, referrerFid };
}

/** Called by the verification job every 5 min. Legacy backward-compat sweep:
 *  claimReferral() now pays the referrer immediately, so this only matters
 *  for rows inserted before that change that are still activated=false. */
export async function activatePendingReferrals(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;

  // Find unactivated referrals
  const { rows: pending } = await pool.query(`
    SELECT r.id, r.referrer_fid, r.referred_fid
    FROM referrals r
    WHERE r.activated = false
    ORDER BY r.created_at ASC
    LIMIT 100
  `);

  let activated = 0;

  for (const row of pending) {
    const referrerFid = Number(row.referrer_fid);
    const referredFid = Number(row.referred_fid);

    // Check lifetime cap for referrer
    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS n FROM referrals WHERE referrer_fid = $1 AND activated = true`,
      [referrerFid],
    );
    if (Number(countRows[0]?.n ?? 0) >= LIFETIME_MAX) {
      // Cap reached — mark activated=true so we stop rechecking, but don't award pts
      await pool.query(
        `UPDATE referrals SET activated = true, activated_at = now() WHERE id = $1`,
        [row.id],
      );
      continue;
    }

    // Check if referred user has earned enough organic points
    const pts = await getFidPoints(referredFid);
    // Exclude referral/quest/welcome-bonus pts from the threshold check to prevent circular gaming
    const organicPts = pts.breakdown
      .filter(b => b.action_type !== "referral" && b.action_type !== "quest" && b.action_type !== "referral_welcome")
      .reduce((sum, b) => sum + b.points_earned, 0);

    if (organicPts < ACTIVATION_THRESHOLD) continue; // not ready yet

    // Activate — award 200 pts to referrer
    await pool.query(
      `UPDATE referrals SET activated = true, activated_at = now() WHERE id = $1`,
      [row.id],
    );

    await logUserAction({
      fid: referrerFid,
      actionType: "referral",
      payload: { referred_fid: referredFid, activated_at: new Date().toISOString() },
      proof: `referral:${referrerFid}:${referredFid}`,
      verified: true, // server is source of truth for referral payouts
    });

    activated++;
    console.log(`[referral] activated: referrer=${referrerFid} referred=${referredFid}`);
  }

  return activated;
}

export interface ReferralRow {
  fid: number;
  activated: boolean;
  activated_at: string | null;
  created_at: string;
}

export interface ReferralListData {
  referredBy: number | null;
  referrals: ReferralRow[];
}

export async function getReferralList(referrerFid: number): Promise<ReferralListData> {
  const pool = getPool();
  if (!pool) return { referredBy: null, referrals: [] };

  const [byResult, listResult] = await Promise.all([
    pool.query(
      "SELECT referrer_fid FROM referrals WHERE referred_fid = $1 LIMIT 1",
      [referrerFid],
    ),
    pool.query(
      `SELECT referred_fid, activated, activated_at, created_at
       FROM referrals
       WHERE referrer_fid = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [referrerFid],
    ),
  ]);

  const toIso = (v: unknown): string | null => {
    if (!v) return null;
    return v instanceof Date ? v.toISOString() : String(v);
  };

  return {
    referredBy: byResult.rows[0] ? Number(byResult.rows[0].referrer_fid) : null,
    referrals: listResult.rows.map(r => ({
      fid:          Number(r.referred_fid),
      activated:    Boolean(r.activated),
      activated_at: toIso(r.activated_at),
      created_at:   toIso(r.created_at) ?? new Date().toISOString(),
    })),
  };
}

export async function getReferralCount(fid: number): Promise<{ total: number; activated: number }> {
  const pool = getPool();
  if (!pool) return { total: 0, activated: 0 };
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE true)      AS total,
       COUNT(*) FILTER (WHERE activated) AS activated
     FROM referrals WHERE referrer_fid = $1`,
    [fid],
  );
  return {
    total:     Number(rows[0]?.total ?? 0),
    activated: Number(rows[0]?.activated ?? 0),
  };
}

/** Returns the FID that referred this user, or null */
export async function getReferredBy(fid: number): Promise<number | null> {
  const pool = getPool();
  if (!pool) return null;
  const { rows } = await pool.query(
    "SELECT referrer_fid FROM referrals WHERE referred_fid = $1",
    [fid],
  );
  return rows[0] ? Number(rows[0].referrer_fid) : null;
}
