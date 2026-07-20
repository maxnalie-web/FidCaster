/**
 * Daily allowance — tracks each user's daily budget for promotion/gifting.
 *
 * Formula: (base(300) + min(follower_count * 4, 3000)) * (0.5 + neynar_score)
 *   neynar_score is Neynar's 0-1 account-quality score (0 for unscored, which
 *   maps to a 0.5x multiplier - a neutral middle, not a penalty for an
 *   unscored account).
 *   → range: ~150/day (no followers, score 0) up to a hard cap of 5000/day.
 *   Two variables combined multiplicatively means users rarely land on the
 *   same number even with similar follower counts.
 *
 * Allowance resets at midnight UTC. Rows are keyed by (fid, UTC date).
 */

import { getPool } from "./pool.js";
import { neynarThrottle, penalize429, hasAnyNeynarKey } from "../neynar-limit.js";

export const BASE_ALLOWANCE   = 300;
export const MIN_ALLOWANCE    = 150; // floor: BASE * the 0.5x minimum multiplier
export const MAX_ALLOWANCE    = 5000; // hard cap
const MAX_FOLLOWER_BONUS      = 3000; // cap on the follower-proportional bonus

function calculateTotal(followerCount: number, neynarScore: number): number {
  const followerBonus = Math.min(followerCount * 4, MAX_FOLLOWER_BONUS);
  const qualityMultiplier = 0.5 + Math.max(0, Math.min(neynarScore, 1)); // 0.5x .. 1.5x
  return Math.min(MAX_ALLOWANCE, Math.round((BASE_ALLOWANCE + followerBonus) * qualityMultiplier));
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

function tomorrowMidnightUtc(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

async function fetchAllowanceInputs(fid: number): Promise<{ followerCount: number; neynarScore: number }> {
  if (!hasAnyNeynarKey()) return { followerCount: 0, neynarScore: 0 };
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
      return { followerCount: 0, neynarScore: 0 };
    }
    const data = await r.json() as {
      users?: { follower_count?: number; experimental?: { neynar_user_score?: number } }[];
    };
    const user = data.users?.[0];
    return {
      followerCount: user?.follower_count ?? 0,
      neynarScore:   typeof user?.experimental?.neynar_user_score === "number" ? user.experimental.neynar_user_score : 0,
    };
  } catch {
    return { followerCount: 0, neynarScore: 0 };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface AllowanceData {
  total:    number;
  used:     number;
  remaining: number;
  resetsAt: string;
  promoUsed: number;
  promoRemaining: number;
  giftUsed: number;
  giftRemaining: number;
}

function categoryRemaining(total: number, categoryUsed: number): number {
  return Math.max(0, Math.round(total * CATEGORY_CAP_FRACTION) - categoryUsed);
}

function toAllowanceData(total: number, used: number, promoUsed: number, giftUsed: number, resetsAt: string): AllowanceData {
  return {
    total, used, remaining: Math.max(0, total - used), resetsAt,
    promoUsed, promoRemaining: categoryRemaining(total, promoUsed),
    giftUsed,  giftRemaining:  categoryRemaining(total, giftUsed),
  };
}

/**
 * Return today's allowance for a FID, creating the row on first access.
 */
export async function getAllowance(fid: number): Promise<AllowanceData> {
  const pool     = getPool();
  const today    = todayUtc();
  const resetsAt = tomorrowMidnightUtc();

  if (!pool) {
    return toAllowanceData(BASE_ALLOWANCE, 0, 0, 0, resetsAt);
  }

  // Fast path: row already exists for today
  const { rows } = await pool.query(
    `SELECT base_amount, used, promo_used, gift_used FROM daily_allowance WHERE fid = $1 AND date = $2`,
    [fid, today],
  );

  if (rows.length > 0) {
    return toAllowanceData(
      Number(rows[0].base_amount), Number(rows[0].used),
      Number(rows[0].promo_used), Number(rows[0].gift_used), resetsAt,
    );
  }

  // First access today — fetch follower count + quality score and create row
  const { followerCount, neynarScore } = await fetchAllowanceInputs(fid);
  const total = calculateTotal(followerCount, neynarScore);

  await pool.query(
    `INSERT INTO daily_allowance (fid, date, base_amount, used, promo_used, gift_used, refreshed_at)
     VALUES ($1, $2, $3, 0, 0, 0, now())
     ON CONFLICT (fid, date) DO NOTHING`,
    [fid, today, total],
  );

  // Re-read in case a concurrent request just inserted
  const { rows: rows2 } = await pool.query(
    `SELECT base_amount, used, promo_used, gift_used FROM daily_allowance WHERE fid = $1 AND date = $2`,
    [fid, today],
  );
  if (rows2.length > 0) {
    return toAllowanceData(
      Number(rows2[0].base_amount), Number(rows2[0].used),
      Number(rows2[0].promo_used), Number(rows2[0].gift_used), resetsAt,
    );
  }

  return toAllowanceData(total, 0, 0, 0, resetsAt);
}

/**
 * Atomically spend `amount` from a FID's today's allowance.
 * Returns ok=true on success, ok=false if there is not enough remaining.
 */
export async function spendAllowance(
  fid: number,
  amount: number,
): Promise<{ ok: true; remaining: number } | { ok: false; reason: string }> {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_not_configured" };

  const today = todayUtc();

  // Ensure the row exists for today
  await getAllowance(fid);

  const { rows } = await pool.query(
    `UPDATE daily_allowance
     SET used         = used + $3,
         refreshed_at = now()
     WHERE fid = $1
       AND date = $2
       AND (base_amount - used) >= $3
     RETURNING base_amount, used`,
    [fid, today, amount],
  );

  if (rows.length === 0) {
    // No row matched — insufficient allowance
    const current = await getAllowance(fid);
    return { ok: false, reason: `insufficient_allowance (${current.remaining} remaining, need ${amount})` };
  }

  const remaining = Number(rows[0].base_amount) - Number(rows[0].used);
  return { ok: true, remaining };
}

/**
 * Atomically claim all unclaimed pending points for a FID AND write the
 * corresponding gift_received ledger rows — all inside one transaction.
 *
 * If any ledger write fails the entire transaction is rolled back so no
 * points are marked claimed without a matching ledger record.
 *
 * Returns the total number of points claimed (0 if nothing was pending).
 */
export async function claimAndLogPending(fid: number): Promise<number> {
  const pool = getPool();
  if (!pool) return 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Lock and claim unclaimed rows for this FID
    const { rows } = await client.query(
      `UPDATE pending_points
       SET claimed    = true,
           claimed_at = now()
       WHERE recipient_fid = $1
         AND claimed = false
       RETURNING amount, from_fid, cast_hash`,
      [fid],
    );

    if (rows.length === 0) {
      await client.query("ROLLBACK");
      return 0;
    }

    // 2. Write ledger records inside the same transaction
    for (const row of rows) {
      const amount:   number = Number(row.amount);
      const fromFid:  number = Number(row.from_fid);
      const castHash: string = String(row.cast_hash);

      // Upsert user row
      await client.query(
        `INSERT INTO users (fid) VALUES ($1) ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
        [fid],
      );

      // Insert ledger record (idempotent on proof)
      await client.query(
        `INSERT INTO user_actions
           (fid, action_type, payload, proof, verified, verified_at)
         VALUES ($1, 'gift_received', $2, $3, true, now())
         ON CONFLICT (action_type, proof) WHERE proof IS NOT NULL DO NOTHING`,
        [
          fid,
          JSON.stringify({ amount, fromFid, castHash }),
          `${castHash}:gift:${fid}`,
        ],
      );
    }

    await client.query("COMMIT");

    const total = rows.reduce((s: number, r: { amount: string | number }) => s + Number(r.amount), 0);
    console.log(`[allowance] fid ${fid}: claimed ${total} pts from ${rows.length} pending gift(s)`);
    return total;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e; // propagate so caller returns 500
  } finally {
    client.release();
  }
}

/**
 * Queue pending points for a not-yet-registered recipient.
 * Idempotent on cast_hash (silently ignores duplicates).
 */
export async function queuePendingPoints(params: {
  recipientFid: number;
  amount: number;
  fromFid: number;
  castHash: string;
}): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  await pool.query(
    `INSERT INTO pending_points (recipient_fid, amount, from_fid, cast_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (cast_hash) DO NOTHING`,
    [params.recipientFid, params.amount, params.fromFid, params.castHash],
  );
}

// ── Transactional helpers for promotion/gift ───────────────────────────────────

const PROMO_COST = 50;

// A promote's point award scales with the promoter's own daily allowance
// (a proxy for account quality/reach already computed in calculateTotal) -
// a brand-new account still gets the original flat 50, a big account with
// the max 5000/day allowance gets up to 500 (the daily cap for this action
// type - one big promote CAN exhaust it, that's intentional, it's meant to
// feel proportionate to their reach).
const MIN_PROMO_PTS = 50;
const MAX_PROMO_PTS = 500;

function scalePromoPoints(dailyAllowanceTotal: number): number {
  const t = Math.max(0, Math.min(1, (dailyAllowanceTotal - MIN_ALLOWANCE) / (MAX_ALLOWANCE - MIN_ALLOWANCE)));
  return Math.round(MIN_PROMO_PTS + (MAX_PROMO_PTS - MIN_PROMO_PTS) * t);
}

// Neither promotion nor gifting can consume more than this fraction of a
// day's total allowance on its own - each is capped independently, on top
// of the overall `used <= base_amount` bound already in place, so a user
// can't dump their entire daily allowance into a single promo spree or a
// single gift.
const CATEGORY_CAP_FRACTION = 0.7;

/**
 * Process a promotion cast fully inside one DB transaction:
 *   1. Idempotency check (proof already in ledger → skip, no double-debit)
 *   2. Atomic allowance debit (abort if insufficient)
 *   3. Ledger insert
 *
 * The caller must call getAllowance(authorFid) BEFORE this to initialise
 * today's allowance row (requires an HTTP call — can't run inside a transaction).
 *
 * Returns { ok: true } on success, { ok: false, reason } otherwise.
 */
export async function processPromotionAtomic(params: {
  authorFid: number;
  castHash:  string;
  appFid:    number;
}): Promise<{ ok: boolean; reason?: string; promoPoints?: number }> {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_not_configured" };

  const today  = todayUtc();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Idempotency — bail early if proof already exists
    const { rows: dup } = await client.query(
      `SELECT 1 FROM user_actions WHERE action_type = 'promotion' AND proof = $1 LIMIT 1`,
      [params.castHash],
    );
    if (dup.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "already_processed" };
    }

    // 2. Atomic allowance debit — only succeeds if remaining >= PROMO_COST
    //    AND today's promo spending stays within its own category cap.
    const { rowCount: debited, rows: debitedRows } = await client.query(
      `UPDATE daily_allowance
       SET used = used + $3, promo_used = promo_used + $3, refreshed_at = now()
       WHERE fid = $1 AND date = $2
         AND (base_amount - used) >= $3
         AND (base_amount * ${CATEGORY_CAP_FRACTION} - promo_used) >= $3
       RETURNING base_amount`,
      [params.authorFid, today, PROMO_COST],
    );
    if ((debited ?? 0) === 0) {
      await client.query("ROLLBACK");
      const { rows: cur } = await client.query(
        `SELECT base_amount, used, promo_used FROM daily_allowance WHERE fid = $1 AND date = $2`,
        [params.authorFid, today],
      );
      const row = cur[0];
      const reason = row && (Number(row.base_amount) * CATEGORY_CAP_FRACTION - Number(row.promo_used)) < PROMO_COST
        ? "promo_category_cap_reached" : "insufficient_allowance";
      return { ok: false, reason };
    }

    // 3. Insert ledger row (promotion now verified and allowance confirmed)
    const promoPoints = scalePromoPoints(Number(debitedRows[0]?.base_amount ?? MIN_ALLOWANCE));
    await client.query(
      `INSERT INTO users (fid) VALUES ($1) ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
      [params.authorFid],
    );
    await client.query(
      `INSERT INTO user_actions (fid, action_type, payload, proof, verified, verified_at)
       VALUES ($1, 'promotion', $2, $3, true, now())`,
      [
        params.authorFid,
        JSON.stringify({ castHash: params.castHash, appFid: params.appFid, amount: promoPoints }),
        params.castHash,
      ],
    );

    await client.query("COMMIT");
    return { ok: true, promoPoints };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Process a gift cast fully inside one DB transaction:
 *   1. Idempotency check (gift_sent proof already exists → skip)
 *   2. Atomic allowance debit
 *   3. Insert sender's audit row
 *   4a. For registered recipients: insert gift_received ledger row
 *   4b. For unregistered recipients: insert pending_points row
 *
 * All steps are atomic — if recipient credit fails, allowance is not spent.
 * The caller must call getAllowance(authorFid) BEFORE this.
 */
export async function processGiftAtomic(params: {
  authorFid:    number;
  recipientFid: number;
  amount:       number;
  castHash:     string;
  recipientIsRegistered: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const pool = getPool();
  if (!pool) return { ok: false, reason: "db_not_configured" };

  const today   = todayUtc();
  const client  = await pool.connect();
  const giftSentProof      = `${params.castHash}:gift_sent`;
  const giftReceivedProof  = `${params.castHash}:gift:${params.recipientFid}`;

  try {
    await client.query("BEGIN");

    // 1. Idempotency — bail if gift_sent proof already exists
    const { rows: dup } = await client.query(
      `SELECT 1 FROM user_actions WHERE action_type = 'gift' AND proof = $1 LIMIT 1`,
      [giftSentProof],
    );
    if (dup.length > 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "already_processed" };
    }

    // 2. Atomic allowance debit — bounded by both the overall remaining
    //    allowance and the gift category's own cap.
    const { rowCount: debited } = await client.query(
      `UPDATE daily_allowance
       SET used = used + $3, gift_used = gift_used + $3, refreshed_at = now()
       WHERE fid = $1 AND date = $2
         AND (base_amount - used) >= $3
         AND (base_amount * ${CATEGORY_CAP_FRACTION} - gift_used) >= $3`,
      [params.authorFid, today, params.amount],
    );
    if ((debited ?? 0) === 0) {
      await client.query("ROLLBACK");
      const { rows: cur } = await client.query(
        `SELECT base_amount, used, gift_used FROM daily_allowance WHERE fid = $1 AND date = $2`,
        [params.authorFid, today],
      );
      const row = cur[0];
      const reason = row && (Number(row.base_amount) * CATEGORY_CAP_FRACTION - Number(row.gift_used)) < params.amount
        ? "gift_category_cap_reached" : "insufficient_allowance";
      return { ok: false, reason };
    }

    // 3. Upsert sender user row + insert gift audit record
    await client.query(
      `INSERT INTO users (fid) VALUES ($1) ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
      [params.authorFid],
    );
    await client.query(
      `INSERT INTO user_actions (fid, action_type, payload, proof, verified, verified_at)
       VALUES ($1, 'gift', $2, $3, true, now())`,
      [
        params.authorFid,
        JSON.stringify({ castHash: params.castHash, recipientFid: params.recipientFid, amount: params.amount }),
        giftSentProof,
      ],
    );

    // 4. Credit recipient inside the same transaction
    if (params.recipientIsRegistered) {
      // Direct credit — throws on error, rolls back everything
      await client.query(
        `INSERT INTO users (fid) VALUES ($1) ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
        [params.recipientFid],
      );
      await client.query(
        `INSERT INTO user_actions (fid, action_type, payload, proof, verified, verified_at)
         VALUES ($1, 'gift_received', $2, $3, true, now())
         ON CONFLICT (action_type, proof) WHERE proof IS NOT NULL DO NOTHING`,
        [
          params.recipientFid,
          JSON.stringify({ amount: params.amount, fromFid: params.authorFid, castHash: params.castHash }),
          giftReceivedProof,
        ],
      );
    } else {
      // Queue pending points inside the same transaction so debit + queue are atomic
      await client.query(
        `INSERT INTO pending_points (recipient_fid, amount, from_fid, cast_hash)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (cast_hash) DO NOTHING`,
        [params.recipientFid, params.amount, params.authorFid, params.castHash],
      );
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
