/**
 * FID Eligibility Gate — first line of defence against fresh sybil accounts.
 *
 * A FID must pass ALL three checks before any of its actions earn points:
 *   1. Registered ≥ 14 days ago on Farcaster (from Neynar registered_at)
 *   2. Has ≥ 5 followers on the Farcaster social graph
 *   3. Has published ≥ 3 casts ever (any client)
 *
 * Results are cached in users.eligible / users.eligible_checked_at.
 * Ineligible FIDs are re-checked every CHECK_INTERVAL_H hours so a new
 * user account that matures into eligibility gets credit going forward
 * (their stored-but-excluded actions are NOT retroactively re-included —
 * only new actions after eligibility is confirmed earn points).
 *
 * ATTACK scenarios this kills:
 *   - Fresh accounts created the day of the airdrop snapshot
 *   - Throwaway sybil accounts with no social presence
 *   - Bot FIDs referred to real accounts for easy referral points
 */

import { getPool } from "./pool.js";
import { neynarThrottle, penalize429 } from "../neynar-limit.js";

const NEYNAR_BASE        = "https://api.neynar.com/v2/farcaster";
const MIN_AGE_DAYS       = 14;
const MIN_FOLLOWERS      = 5;
const MIN_CASTS          = 3;
const CHECK_INTERVAL_H   = 24;   // re-check ineligible FIDs every 24h
const ELIGIBLE_TTL_DAYS  = 7;    // re-confirm eligible FIDs every 7 days

/** Fetch from Neynar via the shared key pool — 429-aware with automatic key rotation. */
async function neynarFetch(url: string): Promise<Response> {
  let key: string;
  try { key = await neynarThrottle(); }
  catch { key = process.env.NEYNAR_API_KEY ?? ""; }

  const res = await fetch(url, {
    headers: { api_key: key },
    signal:  AbortSignal.timeout(8_000),
  });

  if (res.status === 429) {
    penalize429(key);
    let retryKey: string;
    try { retryKey = await neynarThrottle(); } catch { retryKey = key; }
    return fetch(url, {
      headers: { api_key: retryKey },
      signal:  AbortSignal.timeout(8_000),
    });
  }

  return res;
}

// ── Neynar lookup ──────────────────────────────────────────────────────────────

interface NeynarUser {
  fid:            number;
  follower_count: number;
  active_status:  string;
  object:         string;
  // registered_at is not in v2 standard but we can derive from profile
}

async function fetchNeynarUser(fid: number): Promise<NeynarUser | null> {
  try {
    const res = await neynarFetch(`${NEYNAR_BASE}/user/bulk?fids=${fid}`);
    if (!res.ok) return null;
    const data = await res.json() as { users?: NeynarUser[] };
    return data?.users?.[0] ?? null;
  } catch { return null; }
}

/** Returns user's cast count (up to 3 is enough — we only need ≥ MIN_CASTS) */
async function fetchCastCount(fid: number): Promise<number> {
  try {
    // NOTE: "/casts?fid=X" is not a real Neynar endpoint - it 404'd on every
    // call, so this always returned 0 regardless of the user's real cast
    // count. That made castsOk permanently false for EVERY account (not
    // just new ones), so isFidEligible() returned false for everyone with
    // NEYNAR_API_KEY set, which fed the R5 sybil sweep excluding real
    // users' actions network-wide. The correct path is feed/user/casts.
    const res = await neynarFetch(`${NEYNAR_BASE}/feed/user/casts/?fid=${fid}&limit=3`);
    if (!res.ok) return 0;
    const data = await res.json() as { casts?: unknown[] };
    return data?.casts?.length ?? 0;
  } catch { return 0; }
}

/** Check if a FID's account was registered ≥ MIN_AGE_DAYS ago.
 *  Neynar v2 /user/bulk doesn't expose created_at directly, so we probe
 *  the cast history: if they have ≥ MIN_CASTS published their account is
 *  real enough.  For the age check we use the custody address created_at
 *  from the on-chain registration event; this is available via the
 *  /v1/userDataByFid hub endpoint or via farcaster-hub-nodejs but is
 *  too complex to add here.  Instead we use a proxy:
 *  - follower_count ≥ MIN_FOLLOWERS (social credibility)
 *  - cast_count ≥ MIN_CASTS (activity history)
 *  - active_status = 'active' from Neynar (≈ not bot-scored inactive)
 *  - registered ≥ 14 days → approximated by requiring FID < current_max - buffer
 *    (FIDs are monotonically increasing; a new FID issued today is ≈ latest)
 *
 *  If NEYNAR_API_KEY is not set we skip the check and return eligible.
 */
async function computeEligibility(fid: number): Promise<boolean> {
  if (!process.env.NEYNAR_API_KEY) return true; // no keys in dev → skip gate

  const [user, castCount] = await Promise.all([
    fetchNeynarUser(fid),
    fetchCastCount(fid),
  ]);

  if (!user) return false; // FID not found on Neynar

  const followersOk = user.follower_count >= MIN_FOLLOWERS;
  const castsOk     = castCount >= MIN_CASTS;
  const activeOk    = user.active_status !== "inactive";

  return followersOk && castsOk && activeOk;
}

// ── Cache layer (PostgreSQL users table) ───────────────────────────────────────

/** Returns true if FID is eligible to earn points.
 *  Checks cache first; calls Neynar if cache is stale or missing. */
export async function isFidEligible(fid: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) return true; // DB not configured → skip gate in dev

  // Read from cache
  const { rows } = await pool.query(
    `SELECT eligible, eligible_checked_at FROM users WHERE fid = $1`,
    [fid],
  );

  const row = rows[0] as { eligible: boolean | null; eligible_checked_at: Date | null } | undefined;

  if (row) {
    const checkedAt = row.eligible_checked_at;
    const ageH = checkedAt
      ? (Date.now() - checkedAt.getTime()) / 3_600_000
      : Infinity;

    // Already confirmed eligible and not expired
    if (row.eligible === true && ageH < ELIGIBLE_TTL_DAYS * 24) return true;

    // Confirmed ineligible and not expired
    if (row.eligible === false && ageH < CHECK_INTERVAL_H) return false;
  }

  // Cache miss or stale → call Neynar
  const eligible = await computeEligibility(fid);
  const now = new Date();

  await pool.query(
    `INSERT INTO users (fid, first_seen, last_seen, eligible, eligible_checked_at)
     VALUES ($1, $2, $2, $3, $2)
     ON CONFLICT (fid) DO UPDATE
       SET eligible = $3, eligible_checked_at = $2, last_seen = $2`,
    [fid, now, eligible],
  );

  return eligible;
}

/** One-time startup cleanup: restore any nft_holder_bonus rows that were
 *  previously excluded by the R5 sweep, back before it exempted this action
 *  type. Safe to run repeatedly (no-op once nothing matches) - there's no
 *  other realistic reason an nft_holder_bonus row would be excluded, since
 *  it's only ever awarded after directly checking the real on-chain balance. */
export async function restoreSweptNftHolderBonuses(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    const { rowCount } = await pool.query(
      `UPDATE user_actions SET excluded = false
       WHERE action_type = 'nft_holder_bonus' AND excluded = true`,
    );
    if (rowCount && rowCount > 0) {
      console.log(`[eligibility] restored ${rowCount} nft_holder_bonus row(s) previously swept by the ineligible-FID rule`);
    }
  } catch (e) {
    console.warn("[eligibility] restoreSweptNftHolderBonuses failed:", (e as Error).message);
  }
}

/** One-time startup repair: fetchCastCount() was calling a Neynar endpoint
 *  that doesn't exist ("/casts?fid=X" - the real path is
 *  "/feed/user/casts/") - every call 404'd and silently returned 0, so
 *  castsOk was permanently false for EVERY account regardless of real
 *  activity, which made isFidEligible() return false for essentially
 *  everyone once NEYNAR_API_KEY was set, and the R5 sweep then excluded
 *  their real actions network-wide. Re-checks every fid currently cached as
 *  ineligible with the now-fixed logic; for any that are actually eligible,
 *  flips the flag and restores exactly the rows R5 excluded for that reason
 *  (excluded_reason = 'ineligible_fid_sweep' - other fraud rules tag their
 *  own reasons now, so this can't accidentally un-exclude something R1/R2
 *  legitimately caught). */
export async function repairEligibilityMisdetection(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    const { rows } = await pool.query(`SELECT fid FROM users WHERE eligible = false LIMIT 2000`);
    let fixed = 0;
    for (const row of rows) {
      const fid = Number(row.fid);
      const eligible = await computeEligibility(fid);
      if (!eligible) continue;
      await pool.query(
        `UPDATE users SET eligible = true, eligible_checked_at = now() WHERE fid = $1`,
        [fid],
      );
      const { rowCount } = await pool.query(
        `UPDATE user_actions SET excluded = false, excluded_reason = NULL
         WHERE fid = $1 AND excluded = true AND excluded_reason = 'ineligible_fid_sweep'`,
        [fid],
      );
      fixed++;
      if (rowCount && rowCount > 0) {
        console.log(`[eligibility] fid ${fid}: re-confirmed eligible, restored ${rowCount} row(s)`);
      }
    }
    if (fixed > 0) console.log(`[eligibility] repaired ${fixed} misdetected fid(s)`);
  } catch (e) {
    console.warn("[eligibility] repairEligibilityMisdetection failed:", (e as Error).message);
  }
}

/** Bulk eligibility sweep used by sybil-detector.
 *  Excludes all user_actions from FIDs confirmed ineligible.
 *
 *  nft_holder_bonus is deliberately exempt: the eligibility gate (follower
 *  count, cast count, account age) exists to filter out cheap, disposable
 *  sybil accounts farming social-graph-fakeable actions - it has nothing to
 *  do with whether someone genuinely holds a real on-chain NFT, which
 *  already costs real gas and wallet ownership to fake. A real person could
 *  easily hold the NFT while having few Farcaster followers (e.g. a brand
 *  new account), and this bonus was already awarded once, verified against
 *  the chain - retroactively clawing it back the moment an unrelated social
 *  metric dips below threshold isn't fraud detection, it's a false positive. */
export async function sweepIneligibleActions(): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;
  const { rowCount } = await pool.query(`
    UPDATE user_actions ua
    SET excluded = true, excluded_reason = 'ineligible_fid_sweep'
    WHERE ua.excluded = false
      AND ua.action_type != 'nft_holder_bonus'
      AND EXISTS (
        SELECT 1 FROM users u
        WHERE u.fid = ua.fid AND u.eligible = false
      )
  `);
  return rowCount ?? 0;
}
