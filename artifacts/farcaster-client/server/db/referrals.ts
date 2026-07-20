/**
 * Referral tracking.
 *
 * Referral code = base-36 encoding of the referrer's FID.
 * Each user can only be referred once (unique constraint on referred_fid).
 *
 * SECURITY:
 *   - Self-referral: blocked (referrer === referred FID)
 *   - Circular referral: blocked (A→B and B→A cannot both exist)
 *   - Bot referrals: referrer earns 200 pts ONLY after referred user
 *     accumulates ≥ ACTIVATION_THRESHOLD pts from organic non-referral
 *     actions.  Until then the referral row sits with activated=false and
 *     the referral action row in user_actions has verified=false (0 pts).
 *   - Max eligible referrals: LIFETIME_MAX per referrer (stored referrals
 *     beyond this limit are recorded but the activation check bails early).
 *
 * Flow:
 *   1. Referred user calls /api/referral/claim  → claimReferral() stores the
 *      row (activated=false) and gives referred user 50 welcome pts immediately
 *      (they're a real user signing up, so welcome bonus is unconditional).
 *   2. Verification job calls activatePendingReferrals() every 5 min.
 *      For each unactivated referral, it checks if the referred user has
 *      ≥ ACTIVATION_THRESHOLD pts.  If yes → activate, award 200 pts to referrer.
 */

import { getPool } from "./pool.js";
import { logUserAction } from "./ledger.js";
import { getFidPoints } from "./points.js";

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
 *  Points for REFERRER are deferred until referred user hits 100 pts.
 *  Welcome bonus (50 pts) for NEW USER is immediate. */
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

  // Idempotent insert — activated=false, points deferred
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

  // Referrer's 200 pts are NOT awarded here — deferred to activatePendingReferrals()
  return { ok: true, referrerFid };
}

/** Called by the verification job every 5 min.
 *  Activates referrals where the referred user has earned ≥ ACTIVATION_THRESHOLD pts. */
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
