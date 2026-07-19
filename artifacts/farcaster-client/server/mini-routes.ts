/**
 * Mini App specific routes.
 *
 * GET /api/mini/eligibility?fid=XXX
 *   Checks whether a FID is eligible to use the mini app.
 *   Criteria: Neynar user score ≥ 30.
 *   On Neynar error, defaults to eligible=true so users aren't blocked.
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { neynarThrottle, penalize429, hasAnyNeynarKey } from "./neynar-limit.js";

const SCORE_THRESHOLD = 30;

const limiter = rateLimit({
  windowMs: 60_000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

function fidFromQuery(q: unknown): number | null {
  const n = Number(q);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n < 1_000_000_000 ? n : null;
}

export function registerMiniRoutes(app: Express): void {

  // ── GET /api/mini/eligibility?fid=XXX ────────────────────────────────────────
  app.get("/api/mini/eligibility", limiter, async (req: Request, res: Response) => {
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }

    if (!hasAnyNeynarKey()) {
      // No Neynar key configured — be permissive
      res.json({ eligible: true, score: -1, threshold: SCORE_THRESHOLD, reason: "no_key" });
      return;
    }

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
        // On Neynar error, be permissive — don't block real users
        res.json({ eligible: true, score: -1, threshold: SCORE_THRESHOLD, reason: "neynar_error" });
        return;
      }

      const data = await r.json() as {
        users?: {
          fid?: number;
          follower_count?: number;
          experimental?: { neynar_user_score?: number };
        }[];
      };

      const user = data.users?.[0];
      const score = typeof user?.experimental?.neynar_user_score === "number"
        ? user.experimental.neynar_user_score
        : -1;

      // score === -1 means Neynar didn't return it — be permissive
      const eligible = score < 0 || score >= SCORE_THRESHOLD;

      res.json({ eligible, score, threshold: SCORE_THRESHOLD });
    } catch {
      // Network / timeout — be permissive
      res.json({ eligible: true, score: -1, threshold: SCORE_THRESHOLD, reason: "timeout" });
    }
  });
}
