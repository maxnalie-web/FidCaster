/**
 * Points, leaderboard, snapshot, referral, and watcher-health endpoints.
 *
 * GET  /api/points/leaderboard          public  paginated leaderboard
 * GET  /api/points/my?fid=xxx           public  per-FID breakdown
 * GET  /api/points/snapshot             admin   full airdrop snapshot (CSV or JSON)
 * GET  /api/referral/code?fid=xxx       public  generate referral link
 * POST /api/referral/claim              public  claim a referral code
 * GET  /api/watchers/health             admin   watcher + job health
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { getLeaderboard, getFidPoints, getFullSnapshot, getPointsHistory } from "./db/points.js";
import { fidToCode, claimReferral, getReferralList } from "./db/referrals.js";
import { getHealthReport } from "./watcher.js";
import { isLedgerConfigured, touchUser } from "./db/ledger.js";
import { getAllowance, claimAndLogPending } from "./db/allowance.js";
import { fetchNeynarUsers } from "./mini-routes.js";

const FID_MAX = 1_000_000_000;
function validFid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v <= FID_MAX;
}

function fidFromQuery(q: unknown): number | null {
  const n = Number(q);
  return validFid(n) ? n : null;
}

const readLimiter  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, max:  20, standardHeaders: true, legacyHeaders: false });

// Simple admin check: X-Admin-Password header must match ADMIN_PASSWORD env var
function isAdmin(req: Request): boolean {
  const pwd = process.env.ADMIN_PASSWORD;
  if (!pwd) return false;
  return req.headers["x-admin-password"] === pwd;
}

export function registerPointsRoutes(app: Express): void {

  // ── Leaderboard ─────────────────────────────────────────────────────────────
  app.get("/api/points/leaderboard", readLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }
    const limit  = Math.min(Number(req.query.limit  ?? 100), 500);
    const offset = Math.max(Number(req.query.offset ?? 0),   0);
    if (!Number.isFinite(limit) || !Number.isFinite(offset))
      { res.status(400).json({ error: "Invalid pagination" }); return; }
    try {
      const rows = await getLeaderboard(limit, offset);
      res.json({ leaderboard: rows, limit, offset });
    } catch (e) {
      console.error("[points] leaderboard error:", e);
      res.status(500).json({ error: "Failed to fetch leaderboard" });
    }
  });

  // ── Per-FID breakdown ───────────────────────────────────────────────────────
  app.get("/api/points/my", readLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= must be a valid FID" }); return; }
    try {
      // Register the fid the moment they first check their points (i.e. the
      // moment they open the app) - without this, a brand-new user who
      // hasn't gifted/referred/minted never appears in the `users` table,
      // which means they never appear in the Neynar webhook's author/reaction
      // fid filters either (see push-routes.ts) - their casts, likes,
      // recasts, gifts and promotions would silently never be tracked at all
      // until they happened to trigger one of the few other insert paths.
      await touchUser(fid);

      // Flush pending gifted points atomically:
      // claimAndLogPending runs inside a single DB transaction — it marks
      // rows claimed AND writes ledger records together. If the ledger write
      // fails the claim is rolled back so no points are silently lost.
      const claimed = await claimAndLogPending(fid);

      const result = await getFidPoints(fid);
      res.json({ ...result, pendingClaimed: claimed });
    } catch (e) {
      console.error("[points] my error:", e);
      res.status(500).json({ error: "Failed to fetch points" });
    }
  });

  // ── Daily allowance ─────────────────────────────────────────────────────────
  app.get("/api/allowance", readLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }
    try {
      const data = await getAllowance(fid);
      res.json({ fid, ...data });
    } catch (e) {
      console.error("[allowance] error:", e);
      res.status(500).json({ error: "Failed to fetch allowance" });
    }
  });

  // ── Snapshot (admin) ────────────────────────────────────────────────────────
  app.get("/api/points/snapshot", async (req: Request, res: Response) => {
    if (!isAdmin(req)) { res.status(401).json({ error: "Unauthorized" }); return; }
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }
    try {
      const rows = await getFullSnapshot();
      const format = req.query.format ?? "json";
      if (format === "csv") {
        const csv = ["fid,total_points,rank", ...rows.map(r => `${r.fid},${r.total_points},${r.rank}`)].join("\n");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="fidcaster-airdrop-snapshot-${Date.now()}.csv"`);
        res.send(csv);
      } else {
        res.json({ snapshot: rows, generatedAt: new Date().toISOString(), totalEligible: rows.length });
      }
    } catch (e) {
      console.error("[points] snapshot error:", e);
      res.status(500).json({ error: "Failed to generate snapshot" });
    }
  });

  // ── Referral: get code ──────────────────────────────────────────────────────
  app.get("/api/referral/code", readLimiter, (req: Request, res: Response) => {
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }
    const code = fidToCode(fid);
    res.json({ fid, code, url: `https://fidcaster.xyz/mini?ref=${code}` });
  });

  // ── Points history ──────────────────────────────────────────────────────────
  app.get("/api/points/history", readLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }
    const limit = Math.min(Number(req.query.limit ?? 50), 100);
    try {
      const rows = await getPointsHistory(fid, limit);
      // Enrich gift_received rows with the sender's username - "Gift received"
      // alone in the activity feed didn't say who sent it.
      const senderFids = [...new Set(rows.map(r => r.fromFid).filter((f): f is number => !!f))];
      const senderMap = senderFids.length ? await fetchNeynarUsers(senderFids) : new Map();
      const history = rows.map(r => ({
        ...r,
        ...(r.fromFid ? { fromUsername: senderMap.get(r.fromFid)?.username ?? null } : {}),
      }));
      res.json({ fid, history });
    } catch (e) {
      console.error("[points] history error:", e);
      res.status(500).json({ error: "Failed to fetch history" });
    }
  });

  // ── Referral list ────────────────────────────────────────────────────────────
  app.get("/api/referral/list", readLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }
    const fid = fidFromQuery(req.query.fid ? Number(req.query.fid) : null);
    if (!fid) { res.status(400).json({ error: "?fid= required" }); return; }
    try {
      const data = await getReferralList(fid);
      // Enrich with real Farcaster usernames/avatars - the raw list only has
      // fids, which rendered as an unhelpful "FID 123456" in the Rewards tab.
      const userMap = await fetchNeynarUsers(data.referrals.map(r => r.fid));
      const referrals = data.referrals.map(r => {
        const u = userMap.get(r.fid);
        return { ...r, username: u?.username ?? null, pfpUrl: u?.pfpUrl ?? null };
      });
      res.json({ fid, referredBy: data.referredBy, referrals });
    } catch (e) {
      console.error("[referral] list error:", e);
      res.status(500).json({ error: "Failed to fetch referral list" });
    }
  });

  // ── Referral: claim ─────────────────────────────────────────────────────────
  app.post("/api/referral/claim", writeLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "Ledger not configured" }); return; }
    const { code, fid } = req.body as { code?: unknown; fid?: unknown };
    if (typeof code !== "string" || code.length < 1 || code.length > 20)
      { res.status(400).json({ error: "Invalid referral code" }); return; }
    if (!validFid(fid))
      { res.status(400).json({ error: "Invalid fid" }); return; }
    try {
      const result = await claimReferral(code, fid);
      if (!result.ok) { res.status(409).json({ error: result.reason }); return; }
      res.json({ ok: true, referrerFid: result.referrerFid });
    } catch (e) {
      console.error("[referral] claim error:", e);
      res.status(500).json({ error: "Failed to claim referral" });
    }
  });

  // ── Watcher health (admin) ──────────────────────────────────────────────────
  app.get("/api/watchers/health", (req: Request, res: Response) => {
    if (!isAdmin(req)) { res.status(401).json({ error: "Unauthorized" }); return; }
    res.json(getHealthReport());
  });
}
