/**
 * REST endpoints for the points/airdrop action ledger.
 *
 * POST /api/actions/log
 *   Called by hub-submit.ts immediately after a cast/like/recast/follow
 *   succeeds in the browser.  The Farcaster message hash is the proof —
 *   it is a 20-byte (40 hex char) value that can be verified against
 *   Neynar/hub in the background.
 *
 * POST /api/grow/campaign-start
 * POST /api/grow/campaign-complete
 *   Called by BatchOperationContext.tsx around a Grow/Clean Up run.
 *   campaign-complete stores the FULL target FID list (up to 2 000) so
 *   the background verification job can confirm real follows via Neynar.
 *
 * Security layers applied at this layer:
 *   L0 — Request auth (auth.ts): if the caller sends a verified session/Quick
 *        Auth token, its fid MUST match the claimed fid or the request is
 *        rejected outright. A request with NO token is still accepted (fail-
 *        open) during rollout — see auth.ts's header comment for why.
 *   L1 — Rate limiting (per-IP)
 *   L2 — FID eligibility gate (age/followers/cast count via Neynar; cached)
 *   L3 — Proof hex-format validation (rejects obviously fake hashes)
 *   L4 — Grow: full target-FID list stored for server-side verification
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { logUserAction, isLedgerConfigured, type ActionType } from "./db/ledger.js";
import { isFidEligible } from "./db/eligibility.js";
import { getPool } from "./db/pool.js";
import { getTrustedFid } from "./auth.js";

const FID_MAX = 1_000_000_000;
function validFid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= FID_MAX;
}

// Farcaster message hashes are Blake3/BLAKE2b 20-byte values = 40 hex chars.
// We accept 40-64 hex chars to cover any future hash length changes.
const HEX_PROOF_RE = /^[0-9a-fA-F]{40,64}$/;

function validProof(p: unknown): p is string {
  if (typeof p !== "string") return false;
  // Strip optional 0x prefix for the check
  const raw = p.startsWith("0x") ? p.slice(2) : p;
  return HEX_PROOF_RE.test(raw);
}

// Only hub-originating actions are accepted here (they must have a real message hash).
// Market events are logged server-side by fid-market-routes.ts (on-chain source of truth).
// Grow campaigns use the campaign-start/complete endpoints below.
const HUB_ACTION_TYPES = new Set<ActionType>([
  "cast", "like", "unlike", "recast", "unrecast", "follow", "unfollow",
]);

const logLimiter  = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const growLimiter = rateLimit({ windowMs: 60_000, max:  60, standardHeaders: true, legacyHeaders: false });

export function registerActionsRoutes(app: Express): void {

  // ── Hub action log ──────────────────────────────────────────────────────────
  app.post("/api/actions/log", logLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }

    const { fid, actionType, payload, proof } = req.body as {
      fid?: unknown; actionType?: unknown; payload?: unknown; proof?: unknown;
    };

    if (!validFid(fid))
      { res.status(400).json({ error: "Invalid fid" }); return; }

    if (typeof actionType !== "string" || !HUB_ACTION_TYPES.has(actionType as ActionType))
      { res.status(400).json({ error: `Invalid actionType. Allowed: ${[...HUB_ACTION_TYPES].join(", ")}` }); return; }

    // L3: Hex format validation — rejects obviously fabricated proof strings.
    // A real Farcaster message hash is always a 20-byte hex value.
    if (!validProof(proof))
      { res.status(400).json({ error: "proof must be a 40-64 char hex string (Farcaster message hash)" }); return; }

    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload)))
      { res.status(400).json({ error: "payload must be a plain object" }); return; }

    // L0: if a verified token was sent, it must agree with the claimed fid.
    const trusted = await getTrustedFid(req);
    if (trusted.invalidToken || (trusted.fid !== null && trusted.fid !== fid)) {
      res.status(401).json({ error: "Token does not match claimed fid" }); return;
    }

    // L2: FID eligibility gate — fire-and-forget style: if Neynar is down we
    // still accept the action (fail-open) but log it as unverified as usual.
    // The sybil-detector's R5 sweep will retroactively exclude ineligible FIDs.
    let eligible = true;
    try { eligible = await isFidEligible(fid); } catch { /* fail open */ }

    try {
      await logUserAction({
        fid,
        actionType: actionType as ActionType,
        payload: {
          ...(payload as Record<string, unknown> | undefined ?? {}),
          // Mark ineligible actions immediately — sybil sweep will catch them
          // but this gives instant feedback in the ledger.
          ...(eligible ? {} : { _ineligible: true }),
        },
        proof: proof.startsWith("0x") ? proof.slice(2) : proof,
        verified: false, // background verification job confirms later
        // Ineligible actions are excluded at write time — no points ever.
        ...(eligible ? {} : { _excludeNow: true }),
      });

      // For ineligible FIDs, immediately exclude the row we just inserted.
      // logUserAction doesn't support a direct excluded=true param, so we
      // do a follow-up update keyed on the unique (action_type, proof) pair.
      if (!eligible) {
        const pool = getPool();
        if (pool) {
          const cleanProof = proof.startsWith("0x") ? proof.slice(2) : proof;
          await pool.query(
            `UPDATE user_actions SET excluded = true, excluded_reason = 'ineligible_fid'
             WHERE proof = $1 AND action_type = $2 AND excluded = false`,
            [cleanProof, actionType],
          );
        }
      }

      res.json({ ok: true, eligible });
    } catch (e) {
      console.error("[actions] log error:", e);
      res.status(500).json({ error: "Failed to log action" });
    }
  });

  // ── Grow campaign start ─────────────────────────────────────────────────────
  app.post("/api/grow/campaign-start", growLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }

    const { fid, campaignId, mode, filters, targetFids } = req.body as {
      fid?: unknown; campaignId?: unknown; mode?: unknown;
      filters?: unknown; targetFids?: unknown;
    };

    if (!validFid(fid)) { res.status(400).json({ error: "Invalid fid" }); return; }
    if (typeof campaignId !== "string" || campaignId.length < 4 || campaignId.length > 120)
      { res.status(400).json({ error: "Invalid campaignId" }); return; }
    if (mode !== "follow" && mode !== "unfollow")
      { res.status(400).json({ error: "mode must be 'follow' or 'unfollow'" }); return; }
    if (!Array.isArray(targetFids) || targetFids.length === 0 || targetFids.length > 20_000)
      { res.status(400).json({ error: "targetFids must be a non-empty array (max 20000)" }); return; }

    // Store up to 2 000 target FIDs (verification job needs them to confirm real follows)
    const targetFidsSample = (targetFids as number[]).slice(0, 2_000);

    try {
      await logUserAction({
        fid,
        actionType: "grow_campaign_start",
        payload: {
          campaignId,
          mode,
          filters: typeof filters === "object" && filters !== null ? filters : {},
          targetFidCount:   (targetFids as number[]).length,
          targetFidsSample, // verification job uses these to check Neynar
          startedAt:        Date.now(),
        },
        proof: `grow:${fid}:${campaignId}:start`,
        verified: false,
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("[actions] grow campaign-start error:", e);
      res.status(500).json({ error: "Failed to log campaign start" });
    }
  });

  // ── Grow campaign complete ──────────────────────────────────────────────────
  app.post("/api/grow/campaign-complete", growLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }

    const { fid, campaignId, succeeded, failed, startedAt } = req.body as {
      fid?: unknown; campaignId?: unknown; succeeded?: unknown; failed?: unknown; startedAt?: unknown;
    };

    if (!validFid(fid)) { res.status(400).json({ error: "Invalid fid" }); return; }
    if (typeof campaignId !== "string" || campaignId.length < 4 || campaignId.length > 120)
      { res.status(400).json({ error: "Invalid campaignId" }); return; }
    if (typeof succeeded !== "number" || succeeded < 0 || typeof failed !== "number" || failed < 0)
      { res.status(400).json({ error: "succeeded and failed must be non-negative numbers" }); return; }

    // Client-reported `succeeded` is NOT trusted for points calculation.
    // The verification job will call Neynar to count real new follows from
    // the targetFidsSample stored at campaign-start, and set verified=true
    // only if ≥ 5 real new follows are confirmed (or exclude if fewer).
    try {
      await logUserAction({
        fid,
        actionType: "grow_campaign_complete",
        payload: {
          campaignId,
          clientReportedSucceeded: succeeded, // stored for audit but not used for points
          failed,
          durationMs: typeof startedAt === "number" ? Date.now() - startedAt : null,
        },
        proof: `grow:${fid}:${campaignId}:complete`,
        verified: false, // background job verifies via Neynar following check
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("[actions] grow campaign-complete error:", e);
      res.status(500).json({ error: "Failed to log campaign complete" });
    }
  });
}
