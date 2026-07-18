/**
 * Referral tracking.
 *
 * Referral code = base-36 encoding of the referrer's FID.
 * Each user can only be referred once (unique constraint on referred_fid).
 * Claiming a referral logs two ledger rows:
 *   - referrer gets a "referral" action (200 pts)
 *   - referred user gets a "quest" action (50 pts welcome bonus)
 */

import { getPool } from "./pool.js";
import { logUserAction } from "./ledger.js";

// ── Code helpers ──────────────────────────────────────────────────────────────

export function fidToCode(fid: number): string {
  return fid.toString(36).toUpperCase(); // e.g. 16333 -> "CJXP"
}

export function codeToFid(code: string): number | null {
  const n = parseInt(code.trim().toLowerCase(), 36);
  return Number.isFinite(n) && n > 0 && n < 1_000_000_000 ? n : null;
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/** Returns null if already referred or referrer === referred. */
export async function claimReferral(
  code: string,
  newFid: number,
): Promise<{ ok: true; referrerFid: number } | { ok: false; reason: string }> {
  const referrerFid = codeToFid(code);
  if (!referrerFid) return { ok: false, reason: "Invalid referral code" };
  if (referrerFid === newFid) return { ok: false, reason: "Cannot refer yourself" };

  const pool = getPool();
  if (!pool) return { ok: false, reason: "DB not configured" };

  // Idempotent insert
  const { rowCount } = await pool.query(
    `INSERT INTO referrals (referrer_fid, referred_fid, code)
     VALUES ($1, $2, $3)
     ON CONFLICT (referred_fid) DO NOTHING`,
    [referrerFid, newFid, code.toUpperCase()],
  );

  if (!rowCount || rowCount === 0) return { ok: false, reason: "Already referred by someone" };

  // Log points for referrer (verified immediately — server is source of truth)
  await logUserAction({
    fid: referrerFid,
    actionType: "referral",
    payload: { referred_fid: newFid },
    proof: `referral:${referrerFid}:${newFid}`,
    verified: true,
  });

  // Welcome bonus for new user
  await logUserAction({
    fid: newFid,
    actionType: "quest",
    payload: { quest: "referral_welcome", referred_by: referrerFid },
    proof: `referral_welcome:${newFid}`,
    verified: true,
  });

  return { ok: true, referrerFid };
}

export async function getReferralCount(fid: number): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { rows } = await pool.query(
    "SELECT COUNT(*) AS n FROM referrals WHERE referrer_fid = $1",
    [fid],
  );
  return Number(rows[0]?.n ?? 0);
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
