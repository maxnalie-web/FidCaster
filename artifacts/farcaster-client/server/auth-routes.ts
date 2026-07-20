/**
 * GET  /api/auth/nonce?fid=XXX   – issue a short-lived, single-use nonce
 * POST /api/auth/session         – exchange a signed nonce for a session token
 *
 * See auth.ts for the verification details.
 */
import type { Express, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { generateAuthNonce, createSession } from "./auth.js";

const limiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });

function validFid(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 && v < 1_000_000_000;
}

const HEX_KEY_RE = /^(0x)?[0-9a-fA-F]{64}$/;      // 32-byte pubkey
const HEX_SIG_RE = /^(0x)?[0-9a-fA-F]{128}$/;      // 64-byte ed25519 signature
const NONCE_RE   = /^[0-9a-fA-F]{32}$/;            // 16 random bytes, hex

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/nonce", limiter, (req: Request, res: Response) => {
    const fid = Number(req.query.fid);
    if (!validFid(fid)) { res.status(400).json({ error: "?fid= required" }); return; }
    res.json({ nonce: generateAuthNonce(fid) });
  });

  app.post("/api/auth/session", limiter, async (req: Request, res: Response) => {
    const { fid, publicKeyHex, nonce, signatureHex } = req.body as {
      fid?: unknown; publicKeyHex?: unknown; nonce?: unknown; signatureHex?: unknown;
    };
    if (!validFid(fid)) { res.status(400).json({ error: "invalid fid" }); return; }
    if (typeof publicKeyHex !== "string" || !HEX_KEY_RE.test(publicKeyHex))
      { res.status(400).json({ error: "invalid publicKeyHex" }); return; }
    if (typeof nonce !== "string" || !NONCE_RE.test(nonce))
      { res.status(400).json({ error: "invalid nonce" }); return; }
    if (typeof signatureHex !== "string" || !HEX_SIG_RE.test(signatureHex))
      { res.status(400).json({ error: "invalid signatureHex" }); return; }

    const result = await createSession({ fid, publicKeyHex, nonce, signatureHex });
    if (!result.ok) { res.status(401).json({ error: result.reason }); return; }
    res.json({ token: result.token });
  });
}
