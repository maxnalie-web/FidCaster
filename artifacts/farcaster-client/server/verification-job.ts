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
 *   like / recast:
 *     Semi-strict — same pattern as follow: Neynar cast lookup with
 *     viewer_fid returns viewer_context.{liked,recasted} for that fid, so we
 *     can confirm the reaction actually exists on the network before it
 *     counts for points. payload.castHash is required (hub-submit.ts always
 *     includes it). Missing castHash → trust window (24h) then verify, same
 *     fallback as follow without a targetFid.
 *
 *   unlike / unrecast:
 *     Trust window = 24h. Both are worth 0 points (POINTS.unlike/unrecast),
 *     so there's nothing to gain by fabricating them — not worth a Neynar call.
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
import { neynarThrottle, penalize429 } from "./neynar-limit.js";

const VERIFY_INTERVAL_MS    = 5 * 60_000;  // every 5 min
const BATCH_SIZE            = 30;
const CAST_MAX_AGE_DAYS     = 7;           // exclude cast after 7 days unverified
const HUB_TRUST_WINDOW_H    = 24;          // like/recast → auto-verify after 24h

const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

/**
 * Fetch from Neynar using the shared key pool (round-robin + token bucket + 429 penalise).
 * Falls back to raw NEYNAR_API_KEY if the pool is empty (dev mode).
 */
async function neynarFetch(url: string, timeoutMs = 8_000): Promise<Response> {
  let key: string;
  try {
    key = await neynarThrottle();
  } catch {
    key = process.env.NEYNAR_API_KEY ?? "";
  }

  const res = await fetch(url, {
    headers: { api_key: key },
    signal:  AbortSignal.timeout(timeoutMs),
  });

  if (res.status === 429) {
    penalize429(key);
    // Retry once immediately with the next available key
    let retryKey: string;
    try { retryKey = await neynarThrottle(); } catch { retryKey = key; }
    return fetch(url, {
      headers: { api_key: retryKey },
      signal:  AbortSignal.timeout(timeoutMs),
    });
  }

  return res;
}

// ── State (exported for watcher health) ──────────────────────────────────────
export let verificationStats = {
  lastRun:       null as Date | null,
  verifiedCount: 0,
  excludedCount: 0,
  pendingCount:  0,
};

let _timer: ReturnType<typeof setInterval> | null = null;

// ── Neynar helpers ────────────────────────────────────────────────────────────

export async function verifyCastHash(hash: string, claimedFid: number): Promise<"ok" | "mismatch" | "notfound"> {
  try {
    const res = await neynarFetch(
      `${NEYNAR_BASE}/cast?identifier=${encodeURIComponent(hash)}&type=hash`,
    );
    if (res.status === 404) return "notfound";
    if (!res.ok) return "ok"; // transient error → retry next run
    const data = await res.json() as { cast?: { author?: { fid?: number } } };
    const actualFid = data?.cast?.author?.fid;
    if (!actualFid) return "notfound";
    return actualFid === claimedFid ? "ok" : "mismatch";
  } catch { return "ok"; }
}

/** Check if userFid follows targetFid using Neynar bulk user endpoint.
 *  Returns true = confirmed following, false = confirmed NOT following, null = unknown. */
export async function verifyFollow(userFid: number, targetFid: number): Promise<boolean | null> {
  try {
    const res = await neynarFetch(
      `${NEYNAR_BASE}/user/bulk?fids=${targetFid}&viewer_fid=${userFid}`,
    );
    if (!res.ok) return null;
    const data = await res.json() as { users?: Array<{ viewer_context?: { following?: boolean } }> };
    return data?.users?.[0]?.viewer_context?.following === true;
  } catch { return null; }
}

/** Check if userFid actually liked/recasted castHash, via the same cast-lookup
 *  endpoint verifyCastHash uses, with viewer_fid to get reaction context back.
 *  Returns true = confirmed reacted, false = confirmed not reacted, null = unknown. */
export async function verifyReaction(castHash: string, userFid: number, type: "like" | "recast"): Promise<boolean | null> {
  try {
    const res = await neynarFetch(
      `${NEYNAR_BASE}/cast?identifier=${encodeURIComponent(castHash)}&type=hash&viewer_fid=${userFid}`,
    );
    if (!res.ok) return null;
    const data = await res.json() as { cast?: { viewer_context?: { liked?: boolean; recasted?: boolean } } };
    const vc = data?.cast?.viewer_context;
    if (!vc) return null;
    return (type === "like" ? vc.liked : vc.recasted) === true;
  } catch { return null; }
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
      // An already-established follow can otherwise be re-submitted with a
      // fresh proof hash every day and re-verified indefinitely (the graph
      // check alone can't tell "still following" from "just followed") —
      // only the first credited row for a given (fid, targetFid) counts.
      const { rows: dupRows } = await pool.query(
        `SELECT 1 FROM user_actions
         WHERE fid = $1 AND action_type = 'follow' AND excluded = false AND id != $2
           AND payload->>'targetFid' = $3
         LIMIT 1`,
        [userFid, row.id, String(targetFid)],
      );
      if (dupRows.length > 0) {
        await pool.query(
          "UPDATE user_actions SET excluded = true, excluded_reason = 'duplicate_follow_target' WHERE id = $1",
          [row.id],
        );
        verificationStats.excludedCount++;
      } else {
        await pool.query("UPDATE user_actions SET verified = true, verified_at = now() WHERE id = $1", [row.id]);
        verificationStats.verifiedCount++;
      }
    } else if (ageH > HUB_TRUST_WINDOW_H) {
      // Not following after trust window → exclude (user unfollowed or action was fake)
      await pool.query("UPDATE user_actions SET excluded = true, excluded_reason = 'follow_not_confirmed' WHERE id = $1", [row.id]);
      verificationStats.excludedCount++;
    }
    // Still within trust window and not following yet → retry next run
  }

  // ── 3. Reaction verification (like/recast, semi-strict — real Neynar check) ──
  const { rows: reactionRows } = await pool.query(
    `SELECT id, fid, action_type, payload, created_at FROM user_actions
     WHERE action_type IN ('like','recast')
       AND verified = false AND excluded = false
       AND created_at < now() - INTERVAL '10 minutes'
     ORDER BY RANDOM() LIMIT $1`,
    [BATCH_SIZE],
  );

  for (const row of reactionRows) {
    const userFid  = Number(row.fid);
    const castHash = (row.payload as Record<string, string> | null)?.castHash;
    const ageH     = (Date.now() - new Date(row.created_at).getTime()) / 3_600_000;

    if (!castHash) {
      // No target reference to check against, so there is nothing to verify
      // against Neynar. This USED to blind-auto-verify after the trust
      // window, which was a real bypass: /api/actions/log is a public
      // endpoint, and any caller could earn like/recast points for free by
      // simply omitting payload.castHash from the request — the "real
      // Neynar check" added earlier only fires when the field is present.
      // A row with no castHash can never be confirmed real, so it's excluded
      // instead of trusted.
      if (ageH > HUB_TRUST_WINDOW_H) {
        await pool.query(
          "UPDATE user_actions SET excluded = true, excluded_reason = 'missing_cast_reference' WHERE id = $1",
          [row.id],
        );
        verificationStats.excludedCount++;
      }
      continue;
    }

    const reacted = await verifyReaction(castHash, userFid, row.action_type as "like" | "recast");
    if (reacted === null) continue; // API error → retry next run

    if (reacted === true) {
      await pool.query("UPDATE user_actions SET verified = true, verified_at = now() WHERE id = $1", [row.id]);
      verificationStats.verifiedCount++;
    } else if (ageH > HUB_TRUST_WINDOW_H) {
      await pool.query("UPDATE user_actions SET excluded = true, excluded_reason = 'reaction_not_confirmed' WHERE id = $1", [row.id]);
      verificationStats.excludedCount++;
    }
    // still within the trust window and not confirmed yet → retry next run
  }

  // ── 3b. Trust-window auto-verify: unlike/unrecast (0 pts — not worth a Neynar call) ──
  const { rowCount: hubCount } = await pool.query(
    `UPDATE user_actions SET verified = true, verified_at = now()
     WHERE action_type IN ('unlike','unrecast')
       AND verified = false AND excluded = false
       AND created_at < now() - ($1 || ' hours')::interval`,
    [HUB_TRUST_WINDOW_H],
  );
  verificationStats.verifiedCount += hubCount ?? 0;

  // ── 4. Follow rows missing targetFid ──
  // Same reasoning as the reaction fallback above: this used to blind-verify
  // 'follow' after the trust window with no Neynar check at all whenever the
  // caller omitted payload.targetFid — a free, unlimited way to fabricate
  // follow points via the public /api/actions/log endpoint. 'follow' earns
  // real points, so a row with nothing to verify against gets excluded, not
  // trusted. 'unfollow' is worth 0 points either way, so it's harmless to
  // keep auto-verifying it (it just marks the row as processed).
  const { rowCount: followFallbackExcluded } = await pool.query(
    `UPDATE user_actions SET excluded = true, excluded_reason = 'missing_target_fid'
     WHERE action_type = 'follow'
       AND verified = false AND excluded = false
       AND payload->>'targetFid' IS NULL
       AND created_at < now() - ($1 || ' hours')::interval`,
    [HUB_TRUST_WINDOW_H],
  );
  verificationStats.excludedCount += followFallbackExcluded ?? 0;

  const { rowCount: unfollowFallback } = await pool.query(
    `UPDATE user_actions SET verified = true, verified_at = now()
     WHERE action_type = 'unfollow'
       AND verified = false AND excluded = false
       AND payload->>'targetFid' IS NULL
       AND created_at < now() - ($1 || ' hours')::interval`,
    [HUB_TRUST_WINDOW_H],
  );
  verificationStats.verifiedCount += unfollowFallback ?? 0;

  // ── 5. Grow campaign completions ──
  // Grow points are now credited instantly on the campaign-complete endpoint
  // (verified=true on insert), just like every other action — no trust window,
  // no Neynar follow-graph sampling, no minimum-real-follows gate, no 14-day
  // per-target cooldown. This sweep only trusts any legacy rows that were
  // written verified=false by the old flow before that change, so they don't
  // sit unverified forever.
  const { rowCount: growLegacyCount } = await pool.query(
    `UPDATE user_actions SET verified = true, verified_at = now()
     WHERE action_type = 'grow_campaign_complete'
       AND verified = false AND excluded = false`,
  );
  verificationStats.verifiedCount += growLegacyCount ?? 0;

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
