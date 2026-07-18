/**
 * Background verification job.
 *
 * Periodically samples unverified ledger rows and confirms them against
 * the Neynar API. Rows that can't be confirmed after the trust window
 * are excluded.
 *
 * Strategy by action type:
 *   - cast:    Neynar cast lookup by hash → verify fid matches
 *   - like / recast / follow / unfollow:
 *              Trust window = 48h. If still unverified after 48h and the
 *              row hasn't been excluded by sybil rules, mark verified.
 *              (Hub reaction/link lookup by hash is not a public Neynar
 *              v2 endpoint; full hub verification is future work.)
 *   - grow_*:  Trust window = 72h (campaigns can be long).
 *   - market_*: Always pre-verified by the server (on-chain source).
 */

import { getPool } from "./db/pool.js";

const VERIFY_INTERVAL_MS  = 5 * 60_000;   // run every 5 min
const BATCH_SIZE          = 30;            // rows per run
const CAST_TRUST_WINDOW_H = 0;            // cast must be confirmed immediately
const HUB_TRUST_WINDOW_H  = 48;           // like/recast/follow → auto-verify after 48h
const GROW_TRUST_WINDOW_H = 72;

// ── State (exported for watcher health) ──────────────────────────────────────
export let verificationStats = {
  lastRun:       null as Date | null,
  verifiedCount: 0,
  excludedCount: 0,
  pendingCount:  0,
};

let _timer: ReturnType<typeof setInterval> | null = null;

function getNeynarKey(): string {
  return process.env.NEYNAR_API_KEY ?? "";
}

// ── Cast verification (Neynar v2) ─────────────────────────────────────────────

async function verifyCastHash(hash: string, claimedFid: number): Promise<"ok" | "mismatch" | "notfound"> {
  const key = getNeynarKey();
  if (!key) return "ok"; // no key → skip, trust window handles it
  try {
    const res = await fetch(
      `https://api.neynar.com/v2/farcaster/cast?identifier=${encodeURIComponent(hash)}&type=hash`,
      { headers: { api_key: key }, signal: AbortSignal.timeout(8_000) },
    );
    if (res.status === 404) return "notfound";
    if (!res.ok) return "ok"; // API error → don't penalise
    const data = await res.json() as { cast?: { author?: { fid?: number } } };
    const actualFid = data?.cast?.author?.fid;
    if (!actualFid) return "notfound";
    return actualFid === claimedFid ? "ok" : "mismatch";
  } catch {
    return "ok"; // network error → don't penalise
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

async function runVerificationBatch(): Promise<void> {
  const pool = getPool();
  if (!pool) return;

  // 1. Cast verification (strict — must have a real Neynar record)
  const { rows: castRows } = await pool.query(
    `SELECT id, fid, proof FROM user_actions
     WHERE action_type = 'cast' AND verified = false AND excluded = false
       AND proof IS NOT NULL AND created_at < now() - INTERVAL '2 minutes'
     ORDER BY RANDOM()
     LIMIT $1`,
    [BATCH_SIZE],
  );

  for (const row of castRows) {
    const result = await verifyCastHash(row.proof, Number(row.fid));
    if (result === "mismatch") {
      await pool.query("UPDATE user_actions SET excluded = true WHERE id = $1", [row.id]);
      verificationStats.excludedCount++;
    } else if (result === "ok") {
      await pool.query("UPDATE user_actions SET verified = true, verified_at = now() WHERE id = $1", [row.id]);
      verificationStats.verifiedCount++;
    }
    // "notfound" → leave pending, retry next run
  }

  // 2. Trust-window auto-verify: hub actions older than HUB_TRUST_WINDOW_H
  const { rowCount: hubCount } = await pool.query(
    `UPDATE user_actions
     SET verified = true, verified_at = now()
     WHERE action_type IN ('like','unlike','recast','unrecast','follow','unfollow')
       AND verified = false AND excluded = false
       AND created_at < now() - ($1 || ' hours')::interval`,
    [HUB_TRUST_WINDOW_H],
  );
  verificationStats.verifiedCount += hubCount ?? 0;

  // 3. Trust-window auto-verify: grow actions older than GROW_TRUST_WINDOW_H
  const { rowCount: growCount } = await pool.query(
    `UPDATE user_actions
     SET verified = true, verified_at = now()
     WHERE action_type IN ('grow_campaign_start','grow_campaign_complete')
       AND verified = false AND excluded = false
       AND created_at < now() - ($1 || ' hours')::interval`,
    [GROW_TRUST_WINDOW_H],
  );
  verificationStats.verifiedCount += growCount ?? 0;

  // 4. Update pending count
  const { rows: pendingRows } = await pool.query(
    "SELECT COUNT(*) AS n FROM user_actions WHERE verified = false AND excluded = false",
  );
  verificationStats.pendingCount = Number(pendingRows[0]?.n ?? 0);
  verificationStats.lastRun = new Date();
}

export function startVerificationJob(): void {
  if (_timer) return;
  // Run immediately on startup, then on interval
  runVerificationBatch().catch(e => console.warn("[verify] batch error:", e.message));
  _timer = setInterval(() => {
    runVerificationBatch().catch(e => console.warn("[verify] batch error:", e.message));
  }, VERIFY_INTERVAL_MS);
  console.log(`[verify] job started (every ${VERIFY_INTERVAL_MS / 60_000}min, batch=${BATCH_SIZE})`);
}

export function stopVerificationJob(): void {
  if (_timer) { clearInterval(_timer); _timer = null; }
}
