/**
 * Background verification job.
 *
 * Runs every 5 minutes. Verifies unverified ledger rows against Neynar.
 *
 * Strategy by action type:
 *
 *   cast:
 *     Strict — Neynar cast lookup by hash.  Mismatch → immediate exclusion.
 *     notfound → retry for up to 7 days, then exclude.
 *
 *   follow / unfollow:
 *     Semi-strict — Neynar bulk user endpoint with viewer_fid checks if the
 *     follow is actually on the social graph.  payload.targetFid is required.
 *     Missing targetFid → trust window (24h) then verify.
 *     Confirmed NOT following → exclude.
 *
 *   like / unlike / recast / unrecast:
 *     Trust window = 24h (reduced from 48h).  These have 1-3 pts and the
 *     attack surface vs verification cost is not worth a Neynar call.
 *     Format validation (hex) blocks the bulk fake-hash attack.
 *
 *   grow_campaign_complete:
 *     Server-side follow verification — check how many of the targetFidsSample
 *     (stored at campaign-start) the user ACTUALLY follows on Neynar.
 *     < 5 real new follows → exclude.
 *     ≥ 5 → verified.  Points are flat-rate so we don't need exact count.
 *     Also: record verified targetFids in grow_targets for 14-day cooldown.
 *
 *   grow_campaign_start / market_* / quest / referral:
 *     Pre-verified (server is source of truth) or handled by referral module.
 *
 *   Pending referral activation:
 *     activatePendingReferrals() is called every run; awards 200 pts to
 *     referrers whose referred users have now earned ≥ 100 organic pts.
 */

import { getPool } from "./db/pool.js";
import { activatePendingReferrals } from "./db/referrals.js";

const VERIFY_INTERVAL_MS   = 5 * 60_000;  // every 5 min
const BATCH_SIZE           = 30;
const CAST_MAX_AGE_DAYS    = 7;           // exclude cast after 7 days unverified
const HUB_TRUST_WINDOW_H   = 24;          // like/recast → auto-verify after 24h
const GROW_TRUST_WINDOW_H  = 2;           // grow_complete → verified or excluded within 2h
const MIN_GROW_REAL_FOLLOWS = 5;           // minimum real new follows for grow points

const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";
function neynarKey() { return process.env.NEYNAR_API_KEY ?? ""; }

// ── State (exported for watcher health) ──────────────────────────────────────
export let verificationStats = {
  lastRun:       null as Date | null,
  verifiedCount: 0,
  excludedCount: 0,
  pendingCount:  0,
};

let _timer: ReturnType<typeof setInterval> | null = null;

// ── Neynar helpers ────────────────────────────────────────────────────────────

async function verifyCastHash(hash: string, claimedFid: number): Promise<"ok" | "mismatch" | "notfound"> {
  const key = neynarKey();
  if (!key) return "ok";
  try {
    const res = await fetch(
      `${NEYNAR_BASE}/cast?identifier=${encodeURIComponent(hash)}&type=hash`,
      { headers: { api_key: key }, signal: AbortSignal.timeout(8_000) },
    );
    if (res.status === 404) return "notfound";
    if (!res.ok) return "ok";
    const data = await res.json() as { cast?: { author?: { fid?: number } } };
    const actualFid = data?.cast?.author?.fid;
    if (!actualFid) return "notfound";
    return actualFid === claimedFid ? "ok" : "mismatch";
  } catch { return "ok"; }
}

/** Check if userFid follows targetFid using Neynar bulk user endpoint.
 *  Returns true = confirmed following, false = confirmed NOT following, null = unknown. */
async function verifyFollow(userFid: number, targetFid: number): Promise<boolean | null> {
  const key = neynarKey();
  if (!key) return null;
  try {
    const res = await fetch(
      `${NEYNAR_BASE}/user/bulk?fids=${targetFid}&viewer_fid=${userFid}`,
      { headers: { api_key: key }, signal: AbortSignal.timeout(8_000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { users?: Array<{ viewer_context?: { following?: boolean } }> };
    const user = data?.users?.[0];
    if (!user) return null;
    return user.viewer_context?.following === true;
  } catch { return null; }
}

/** For a grow campaign: count how many of targetFids are actually followed by userFid.
 *  Uses batched Neynar bulk requests (max 100 fids each). */
async function countRealFollows(userFid: number, targetFids: number[]): Promise<number> {
  const key = neynarKey();
  if (!key) return targetFids.length; // no key → assume all real (dev)

  const BATCH = 100;
  let realCount = 0;

  for (let i = 0; i < targetFids.length && i < 500; i += BATCH) {
    const chunk = targetFids.slice(i, i + BATCH);
    try {
      const res = await fetch(
        `${NEYNAR_BASE}/user/bulk?fids=${chunk.join(",")}&viewer_fid=${userFid}`,
        { headers: { api_key: key }, signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) break;
      const data = await res.json() as { users?: Array<{ viewer_context?: { following?: boolean } }> };
      realCount += (data?.users ?? []).filter(u => u.viewer_context?.following).length;
    } catch { break; }
  }

  return realCount;
}

/** Record verified grow targets for 14-day cooldown tracking. */
async function recordGrowTargets(fid: number, targetFids: number[]): Promise<void> {
  const pool = getPool();
  if (!pool || targetFids.length === 0) return;
  // Bulk insert with ON CONFLICT DO NOTHING
  const values = targetFids.map((_, i) => `($1, $${i + 2})`).join(", ");
  await pool.query(
    `INSERT INTO grow_targets (fid, target_fid) VALUES ${values} ON CONFLICT DO NOTHING`,
    [fid, ...targetFids],
  ).catch(() => {}); // non-fatal
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function runVerificationBatch(): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  // ── 1. Cast verification (strict) ──
  const { rows: castRows } = await pool.query(
    `SELECT id, fid, proof, created_at FROM user_actions
     WHERE action_type = 'cast' AND verified = false AND excluded = false
       AND proof IS NOT NULL AND created_at < now() - INTERVAL '2 minutes'
     ORDER BY RANDOM() LIMIT $1`,
    [BATCH_SIZE],
  );

  for (const row of castRows) {
    const ageH = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;
    const result = await verifyCastHash(row.proof, Number(row.fid));

    if (result === "mismatch") {
      await pool.query("UPDATE user_actions SET excluded = true WHERE id = $1", [row.id]);
      verificationStats.excludedCount++;
    } else if (result === "ok") {
      await pool.query("UPDATE user_actions SET verified = true, verified_at = now() WHERE id = $1", [row.id]);
      verificationStats.verifiedCount++;
    } else if (ageH > CAST_MAX_AGE_DAYS * 24) {
      // Not found after 7 days → exclude (the cast doesn't exist on the network)
      await pool.query("UPDATE user_actions SET excluded = true WHERE id = $1", [row.id]);
      verificationStats.excludedCount++;
    }
    // "notfound" within 7 days → leave pending
  }

  // ── 2. Follow verification (semi-strict) ──
  const { rows: followRows } = await pool.query(
    `SELECT id, fid, payload, created_at FROM user_actions
     WHERE action_type IN ('follow','unfollow')
       AND verified = false AND excluded = false
       AND payload->>'targetFid' IS NOT NULL
       AND created_at < now() - INTERVAL '10 minutes'
     ORDER BY RANDOM() LIMIT $1`,
    [BATCH_SIZE],
  );

  for (const row of followRows) {
    const userFid    = Number(row.fid);
    const targetFid  = Number((row.payload as Record<string, string>).targetFid);
    if (!targetFid || targetFid <= 0) {
      // No targetFid → fall through to trust window below
      continue;
    }

    const isFollowing = await verifyFollow(userFid, targetFid);
    if (isFollowing === null) continue; // API error → retry next run

    const ageH = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;

    if (isFollowing === true) {
      // User IS following the target → valid follow action, verified
      await pool.query("UPDATE user_actions SET verified = true, verified_at = now() WHERE id = $1", [row.id]);
      verificationStats.verifiedCount++;
    } else if (ageH > HUB_TRUST_WINDOW_H) {
      // Not following after trust window → exclude (user unfollowed or action was fake)
      await pool.query("UPDATE user_actions SET excluded = true, excluded_reason = 'follow_not_confirmed' WHERE id = $1", [row.id]);
      verificationStats.excludedCount++;
    }
    // Still within trust window and not following yet → retry next run
  }

  // ── 3. Trust-window auto-verify: like/recast (low value, short window) ──
  const { rowCount: hubCount } = await pool.query(
    `UPDATE user_actions SET verified = true, verified_at = now()
     WHERE action_type IN ('like','unlike','recast','unrecast')
       AND verified = false AND excluded = false
       AND created_at < now() - ($1 || ' hours')::interval`,
    [HUB_TRUST_WINDOW_H],
  );
  verificationStats.verifiedCount += hubCount ?? 0;

  // ── 4. Follow trust-window fallback (no targetFid in payload) ──
  const { rowCount: followFallback } = await pool.query(
    `UPDATE user_actions SET verified = true, verified_at = now()
     WHERE action_type IN ('follow','unfollow')
       AND verified = false AND excluded = false
       AND payload->>'targetFid' IS NULL
       AND created_at < now() - ($1 || ' hours')::interval`,
    [HUB_TRUST_WINDOW_H],
  );
  verificationStats.verifiedCount += followFallback ?? 0;

  // ── 5. Grow campaign verification (server-side Neynar check) ──
  const { rows: growRows } = await pool.query(
    `SELECT uc.id   AS complete_id,
            uc.fid,
            uc.payload AS complete_payload,
            us.payload AS start_payload
     FROM user_actions uc
     LEFT JOIN user_actions us
       ON us.fid = uc.fid
      AND us.action_type = 'grow_campaign_start'
      AND us.payload->>'campaignId' = uc.payload->>'campaignId'
     WHERE uc.action_type = 'grow_campaign_complete'
       AND uc.verified = false AND uc.excluded = false
       AND uc.created_at < now() - ($1 || ' hours')::interval
     ORDER BY uc.created_at ASC
     LIMIT 20`,
    [GROW_TRUST_WINDOW_H],
  );

  for (const row of growRows) {
    const fid = Number(row.fid);
    const startPayload  = (row.start_payload  ?? {}) as Record<string, unknown>;
    const targetFidsSample = (startPayload.targetFidsSample as number[] | undefined) ?? [];

    if (targetFidsSample.length === 0) {
      // No start record found → can't verify, trust it
      await pool.query(
        "UPDATE user_actions SET verified = true, verified_at = now() WHERE id = $1",
        [row.complete_id],
      );
      verificationStats.verifiedCount++;
      continue;
    }

    // --- 14-day target cooldown: remove already-used targets ---
    const { rows: usedRows } = await pool.query(
      `SELECT target_fid FROM grow_targets
       WHERE fid = $1 AND used_at > now() - INTERVAL '14 days'`,
      [fid],
    );
    const usedSet = new Set(usedRows.map((r: { target_fid: number }) => Number(r.target_fid)));
    const freshTargets = targetFidsSample.filter(t => !usedSet.has(t));

    if (freshTargets.length < MIN_GROW_REAL_FOLLOWS) {
      // All targets were recently used → gaming → exclude
      await pool.query(
        "UPDATE user_actions SET excluded = true WHERE id = $1",
        [row.complete_id],
      );
      verificationStats.excludedCount++;
      continue;
    }

    // Count how many fresh targets are actually followed now
    const realFollows = await countRealFollows(fid, freshTargets);

    if (realFollows < MIN_GROW_REAL_FOLLOWS) {
      // Didn't actually follow enough real accounts → exclude
      await pool.query(
        "UPDATE user_actions SET excluded = true WHERE id = $1",
        [row.complete_id],
      );
      verificationStats.excludedCount++;
    } else {
      // Verified: user genuinely followed new people
      await pool.query(
        `UPDATE user_actions SET verified = true, verified_at = now(),
          payload = payload || $2::jsonb
         WHERE id = $1`,
        [row.complete_id, JSON.stringify({ realFollows })],
      );
      verificationStats.verifiedCount++;
      // Record targets in grow_targets for future cooldown checks
      await recordGrowTargets(fid, freshTargets.slice(0, 200));
    }
  }

  // ── 6. Grow start trust-window ──
  const { rowCount: growStartCount } = await pool.query(
    `UPDATE user_actions SET verified = true, verified_at = now()
     WHERE action_type = 'grow_campaign_start'
       AND verified = false AND excluded = false
       AND created_at < now() - INTERVAL '1 hour'`,
  );
  verificationStats.verifiedCount += growStartCount ?? 0;

  // ── 7. Activate pending referrals ──
  try {
    await activatePendingReferrals();
  } catch (e) {
    console.warn("[verify] referral activation error:", (e as Error).message);
  }

  // ── 8. Update pending count ──
  const { rows: pendingRows } = await pool.query(
    "SELECT COUNT(*) AS n FROM user_actions WHERE verified = false AND excluded = false",
  );
  verificationStats.pendingCount = Number(pendingRows[0]?.n ?? 0);
  verificationStats.lastRun = new Date();
}

export function startVerificationJob(): void {
  if (_timer) return;
  runVerificationBatch().catch(e => console.warn("[verify] batch error:", e.message));
  _timer = setInterval(() => {
    runVerificationBatch().catch(e => console.warn("[verify] batch error:", e.message));
  }, VERIFY_INTERVAL_MS);
  console.log(`[verify] job started (every ${VERIFY_INTERVAL_MS / 60_000}min, batch=${BATCH_SIZE})`);
}

export function stopVerificationJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
