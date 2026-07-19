/**
 * Daily allowance — tracks each user's daily budget for promotion/gifting.
 *
 * Formula: base(100) + min(follower_count * 2, 500)
 *   → min 100/day (no followers), max 600/day (≥250 followers)
 *
 * Allowance resets at midnight UTC. Rows are keyed by (fid, UTC date).
 */

import { getPool } from "./pool.js";
import { neynarThrottle, penalize429, hasAnyNeynarKey } from "../neynar-limit.js";

const BASE_ALLOWANCE = 100;
const MAX_BONUS      = 500; // cap on the follower-proportional bonus

function calculateTotal(followerCount: number): number {
  return BASE_ALLOWANCE + Math.min(followerCount * 2, MAX_BONUS);
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

async function fetchFollowerCount(fid: number): Promise<number> {
  if (!hasAnyNeynarKey()) return 0;
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
      return 0;
    }
    const data = await r.json() as { users?: { follower_count?: number }[] };
    return data.users?.[0]?.follower_count ?? 0;
  } catch {
    return 0;
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export interface AllowanceData {
  total:    number;
  used:     number;
  remaining: number;
  resetsAt: string;
}

/**
 * Return today's allowance for a FID, creating the row on first access.
 */
export async function getAllowance(fid: number): Promise<AllowanceData> {
  const pool     = getPool();
  const today    = todayUtc();
  const resetsAt = tomorrowMidnightUtc();

  if (!pool) {
    return { total: BASE_ALLOWANCE, used: 0, remaining: BASE_ALLOWANCE, resetsAt };
  }

  // Fast path: row already exists for today
  const { rows } = await pool.query(
    `SELECT base_amount, used FROM daily_allowance WHERE fid = $1 AND date = $2`,
    [fid, today],
  );

  if (rows.length > 0) {
    const total = Number(rows[0].base_amount);
    const used  = Number(rows[0].used);
    return { total, used, remaining: Math.max(0, total - used), resetsAt };
  }

  // First access today — fetch follower count and create row
  const followers = await fetchFollowerCount(fid);
  const total     = calculateTotal(followers);

  await pool.query(
    `INSERT INTO daily_allowance (fid, date, base_amount, used, refreshed_at)
     VALUES ($1, $2, $3, 0, now())
     ON CONFLICT (fid, date) DO NOTHING`,
    [fid, today, total],
  );

  // Re-read in case a concurrent request just inserted
  const { rows: rows2 } = await pool.query(
    `SELECT base_amount, used FROM daily_allowance WHERE fid = $1 AND date = $2`,
    [fid, today],
  );
  if (rows2.length > 0) {
    const t = Number(rows2[0].base_amount);
    const u = Number(rows2[0].used);
    return { total: t, used: u, remaining: Math.max(0, t - u), resetsAt };
  }

  return { total, used: 0, remaining: total, resetsAt };
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
}): Promise<{ ok: boolean; reason?: string }> {
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
    const { rowCount: debited } = await client.query(
      `UPDATE daily_allowance
       SET used = used + $3, refreshed_at = now()
       WHERE fid = $1 AND date = $2 AND (base_amount - used) >= $3`,
      [params.authorFid, today, PROMO_COST],
    );
    if ((debited ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient_allowance" };
    }

    // 3. Insert ledger row (promotion now verified and allowance confirmed)
    await client.query(
      `INSERT INTO users (fid) VALUES ($1) ON CONFLICT (fid) DO UPDATE SET last_seen = now()`,
      [params.authorFid],
    );
    await client.query(
      `INSERT INTO user_actions (fid, action_type, payload, proof, verified, verified_at)
       VALUES ($1, 'promotion', $2, $3, true, now())`,
      [
        params.authorFid,
        JSON.stringify({ castHash: params.castHash, appFid: params.appFid }),
        params.castHash,
      ],
    );

    await client.query("COMMIT");
    return { ok: true };
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

    // 2. Atomic allowance debit
    const { rowCount: debited } = await client.query(
      `UPDATE daily_allowance
       SET used = used + $3, refreshed_at = now()
       WHERE fid = $1 AND date = $2 AND (base_amount - used) >= $3`,
      [params.authorFid, today, params.amount],
    );
    if ((debited ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { ok: false, reason: "insufficient_allowance" };
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
