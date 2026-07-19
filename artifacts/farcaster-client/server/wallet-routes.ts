/**
 * Airdrop wallet registration routes.
 *
 * GET  /api/airdrop/wallet?fid=xxx   — get registered address for a FID
 * POST /api/airdrop/wallet           — register/update address  { fid, address }
 * GET  /api/airdrop/stats            — registration count (public)
 */

import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { setWalletAddress, getWalletAddress, getRegistrationCount, isValidAddress } from "./db/wallet-address.js";
import { isLedgerConfigured } from "./db/ledger.js";

const readLimiter  = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const writeLimiter = rateLimit({ windowMs: 60_000, max:  10, standardHeaders: true, legacyHeaders: false });

const FID_MAX = 1_000_000_000;
function validFid(v: unknown): v is number {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n <= FID_MAX;
}

export function registerWalletRoutes(app: Express): void {

  // ── GET wallet for a FID ────────────────────────────────────────────────────
  app.get("/api/airdrop/wallet", readLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "DB not configured" }); return; }
    const fid = Number(req.query.fid);
    if (!validFid(fid)) { res.status(400).json({ error: "?fid= must be a valid FID" }); return; }
    try {
      const reg = await getWalletAddress(fid);
      if (!reg) { res.json({ fid, address: null }); return; }
      res.json({ fid: reg.fid, address: reg.address, registered_at: reg.registered_at, updated_at: reg.updated_at });
    } catch (e) {
      console.error("[wallet-routes] GET error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ── POST — register/update address ─────────────────────────────────────────
  app.post("/api/airdrop/wallet", writeLimiter, async (req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.status(503).json({ error: "DB not configured" }); return; }

    const { fid, address } = req.body as { fid?: unknown; address?: unknown };

    if (!validFid(fid)) {
      res.status(400).json({ error: "fid must be a valid positive integer" });
      return;
    }
    if (!isValidAddress(address)) {
      res.status(400).json({ error: "address must be a valid Ethereum address (0x…)" });
      return;
    }

    try {
      const result = await setWalletAddress(Number(fid), address as string);
      if (!result.ok) {
        res.status(409).json({ error: result.reason });
        return;
      }
      res.json({ ok: true, fid, address });
    } catch (e) {
      console.error("[wallet-routes] POST error:", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  // ── GET stats ───────────────────────────────────────────────────────────────
  app.get("/api/airdrop/stats", readLimiter, async (_req: Request, res: Response) => {
    if (!isLedgerConfigured()) { res.json({ registered: 0 }); return; }
    try {
      const registered = await getRegistrationCount();
      res.json({ registered });
    } catch {
      res.json({ registered: 0 });
    }
  });
}
