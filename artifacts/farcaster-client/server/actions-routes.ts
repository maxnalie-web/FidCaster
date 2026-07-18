/**
 * REST endpoints for the points/airdrop action ledger.
 *
 * POST /api/actions/log
 *   Called by hub-submit.ts immediately after a cast/like/recast/follow
 *   succeeds in the browser. The real Farcaster message hash is the proof -
 *   it is cryptographically bound to the user's ed25519 signer key, so it
 *   can't be fabricated for another FID without stealing their private key.
 *   A background verification job (future work) spot-checks a random sample
 *   of these hashes against Neynar/hub to catch any attempted forgery.
 *
 * POST /api/grow/campaign-start
 * POST /api/grow/campaign-complete
 *   Called by BatchOperationContext.tsx around a Grow/Clean Up run.
 *   Grow has no single proof hash (it's many individual follows), so
 *   verification works differently: a background job samples claimed target
 *   FIDs against the real follow graph. Rows start unverified.
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { logUserAction, isLedgerConfigured, type ActionType } from "./db/ledger.js";

const FID_MAX = 1_000_000_000;
function validFid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= FID_MAX;
}

// Only hub-originating actions are accepted here (they have a real message hash as proof).
// Market events are logged server-side by fid-market-routes.ts (stronger - on-chain).
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

    // Proof is mandatory: no hash = action didn't really happen through FidCaster
    if (typeof proof !== "string" || proof.length < 8 || proof.length > 200)
      { res.status(400).json({ error: "proof (message hash) required and must be 8-200 chars" }); return; }

    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload)))
      { res.status(400).json({ error: "payload must be a plain object" }); return; }

    try {
      await logUserAction({
        fid,
        actionType: actionType as ActionType,
        payload: payload as Record<string, unknown> | undefined,
        proof,
        verified: false, // background job verifies later
      });
      res.json({ ok: true });
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

    try {
      await logUserAction({
        fid,
        actionType: "grow_campaign_start",
        payload: {
          campaignId, mode,
          filters: typeof filters === "object" && filters !== null ? filters : {},
          targetFidCount: (targetFids as number[]).length,
          // Store a sample only - full list can be huge and verification job only needs a sample
          targetFidsSample: (targetFids as number[]).slice(0, 100),
        },
        // Synthetic proof scoped to (fid, campaignId) - not a hub hash, but unique per run
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

    try {
      await logUserAction({
        fid,
        actionType: "grow_campaign_complete",
        payload: {
          campaignId, succeeded, failed,
          durationMs: typeof startedAt === "number" ? Date.now() - startedAt : null,
        },
        proof: `grow:${fid}:${campaignId}:complete`,
        verified: false,
      });
      res.json({ ok: true });
    } catch (e) {
      console.error("[actions] grow campaign-complete error:", e);
      res.status(500).json({ error: "Failed to log campaign complete" });
    }
  });
}
