/**
 * Client-facing endpoints for the points/airdrop action ledger.
 *
 * /api/actions/log — called by hub-submit.ts right after a cast/like/recast/
 * follow succeeds, carrying the real message hash as proof. This is a
 * self-reported call (the client tells us it succeeded), which is why proof
 * is mandatory here — a background verification job (not implemented yet;
 * see the airdrop plan's "Attribution" section) later spot-checks a sample
 * of these hashes against Neynar/the hub to flag fabricated rows.
 *
 * /api/grow/campaign-start + /campaign-complete — called by
 * BatchOperationContext around a Grow/Clean Up run. Grow has no single proof
 * hash (it's many individual follows), so verification for this action_type
 * works differently: a background job samples the claimed target FIDs and
 * checks the real follow graph via Neynar. Until that job exists, rows here
 * stay unverified and simply accumulate history.
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { logUserAction, isActionsLedgerConfigured, type ActionType } from "./actions-ledger-store.js";

const FID_MAX = 1_000_000_000;

const LOGGABLE_ACTION_TYPES = new Set<ActionType>([
  "cast", "like", "unlike", "recast", "unrecast", "follow", "unfollow",
]);

const logLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false });
const growLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

function validFid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= FID_MAX;
}

export function registerActionsRoutes(app: Express): void {
  app.post("/api/actions/log", logLimiter, async (req: Request, res: Response) => {
    if (!isActionsLedgerConfigured()) { res.status(503).json({ error: "Action ledger not configured" }); return; }

    const { fid, actionType, payload, proof } = req.body as {
      fid?: number;
      actionType?: string;
      payload?: Record<string, unknown>;
      proof?: string;
    };

    if (!validFid(fid)) { res.status(400).json({ error: "Invalid fid" }); return; }
    if (!actionType || !LOGGABLE_ACTION_TYPES.has(actionType as ActionType)) {
      res.status(400).json({ error: `Invalid actionType. Allowed: ${[...LOGGABLE_ACTION_TYPES].join(", ")}` });
      return;
    }
    // Proof is mandatory for these action types — this endpoint only logs
    // actions that already succeeded against the real hub, and the hash IS
    // that success result. No hash means don't log it, not log it unproven.
    if (typeof proof !== "string" || proof.length < 8 || proof.length > 200) {
      res.status(400).json({ error: "proof (message hash) is required" });
      return;
    }
    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload))) {
      res.status(400).json({ error: "payload must be an object" });
      return;
    }

    try {
      await logUserAction({ fid, actionType: actionType as ActionType, payload, proof });
      res.json({ ok: true });
    } catch (e: unknown) {
      console.error("[actions] log error:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to log action" });
    }
  });

  app.post("/api/grow/campaign-start", growLimiter, async (req: Request, res: Response) => {
    if (!isActionsLedgerConfigured()) { res.status(503).json({ error: "Action ledger not configured" }); return; }

    const { fid, campaignId, mode, targetFid, filters, targetFids } = req.body as {
      fid?: number;
      campaignId?: string;
      mode?: string;
      targetFid?: number;
      filters?: Record<string, unknown>;
      targetFids?: number[];
    };

    if (!validFid(fid)) { res.status(400).json({ error: "Invalid fid" }); return; }
    if (!campaignId || typeof campaignId !== "string" || campaignId.length > 100) {
      res.status(400).json({ error: "Invalid campaignId" }); return;
    }
    if (mode !== "follow" && mode !== "unfollow") {
      res.status(400).json({ error: "mode must be 'follow' or 'unfollow'" }); return;
    }
    if (!Array.isArray(targetFids) || targetFids.length === 0 || targetFids.length > 10_000 ||
        !targetFids.every((f) => Number.isInteger(f) && f > 0)) {
      res.status(400).json({ error: "targetFids must be a non-empty array of FIDs (max 10000)" });
      return;
    }

    try {
      await logUserAction({
        fid,
        actionType: "grow_campaign_start",
        // Only a sample of target FIDs is stored — the full list can be tens
        // of thousands of rows' worth of JSON for one campaign, and the
        // verification job only ever needs a small random sample anyway.
        payload: {
          campaignId, mode, targetFid, filters,
          targetFidCount: targetFids.length,
          targetFidsSample: targetFids.slice(0, 50),
        },
        proof: `grow:${fid}:${campaignId}:start`,
      });
      res.json({ ok: true });
    } catch (e: unknown) {
      console.error("[actions] grow campaign-start error:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to log campaign start" });
    }
  });

  app.post("/api/grow/campaign-complete", growLimiter, async (req: Request, res: Response) => {
    if (!isActionsLedgerConfigured()) { res.status(503).json({ error: "Action ledger not configured" }); return; }

    const { fid, campaignId, succeeded, failed, startedAt } = req.body as {
      fid?: number;
      campaignId?: string;
      succeeded?: number;
      failed?: number;
      startedAt?: number;
    };

    if (!validFid(fid)) { res.status(400).json({ error: "Invalid fid" }); return; }
    if (!campaignId || typeof campaignId !== "string" || campaignId.length > 100) {
      res.status(400).json({ error: "Invalid campaignId" }); return;
    }
    if (typeof succeeded !== "number" || succeeded < 0 || typeof failed !== "number" || failed < 0) {
      res.status(400).json({ error: "succeeded and failed must be non-negative numbers" });
      return;
    }

    try {
      await logUserAction({
        fid,
        actionType: "grow_campaign_complete",
        payload: {
          campaignId, succeeded, failed, startedAt,
          durationMs: typeof startedAt === "number" ? Date.now() - startedAt : null,
        },
        proof: `grow:${fid}:${campaignId}:complete`,
      });
      res.json({ ok: true });
    } catch (e: unknown) {
      console.error("[actions] grow campaign-complete error:", e);
      res.status(500).json({ error: e instanceof Error ? e.message : "Failed to log campaign complete" });
    }
  });
}
