/**
 * Real server-side admin authentication — replaces the old client-only PIN
 * (a SHA-256 hash compared entirely in the browser, against a value also
 * stored in the browser's own localStorage: trivially bypassable by anyone
 * who opens devtools, since there was nothing on the server to actually
 * check against).
 *
 * Model: a single admin password (ADMIN_PASSWORD env var, required — this
 * module fails closed if it's unset, never falls back to an open door).
 * A successful login gets a signed, time-limited session token in an
 * httpOnly cookie; every other /api/admin/* route verifies that signature
 * server-side before doing anything. The token itself carries no secret
 * data (just an expiry), so there's nothing sensitive to leak if it were
 * ever read — its only job is proving it was issued by this server.
 */
import { createHmac, timingSafeEqual, randomBytes } from "crypto";
import type { Request, Response, NextFunction } from "express";

const SESSION_TTL_MS = 12 * 60 * 60_000; // 12 hours
const COOKIE_NAME = "fc_admin_session";

function getSecret(): string | null {
  // Falls back to ADMIN_PASSWORD so a deployment doesn't need a second
  // secret just to sign sessions, but a dedicated ADMIN_SESSION_SECRET is
  // preferred if set (lets the password be rotated without invalidating —
  // or being derivable from — the signing key).
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || null;
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isAdminConfigured(): boolean {
  return !!process.env.ADMIN_PASSWORD;
}

export function checkAdminPassword(password: string): boolean {
  const real = process.env.ADMIN_PASSWORD;
  if (!real || !password) return false;
  // Constant-time compare, but only once lengths are known equal (padding
  // both to the same length first avoids leaking length via timingSafeEqual
  // throwing on mismatched buffer sizes).
  const a = Buffer.from(password.padEnd(128, "\0"));
  const b = Buffer.from(real.padEnd(128, "\0"));
  return timingSafeEqual(a, b) && password.length === real.length;
}

export function issueSessionToken(): string | null {
  const secret = getSecret();
  if (!secret) return null;
  const expires = Date.now() + SESSION_TTL_MS;
  const nonce = randomBytes(8).toString("hex");
  const payload = `${expires}.${nonce}`;
  const sig = sign(payload, secret);
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const secret = getSecret();
  if (!secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [expiresStr, nonce, sig] = parts;
  const expires = Number(expiresStr);
  if (!Number.isFinite(expires) || Date.now() > expires) return false;
  const expected = sign(`${expiresStr}.${nonce}`, secret);
  return safeEqual(sig, expected);
}

/** No cookie-parser dependency in this project — a signed single cookie is
 * simple enough to read straight off the raw header. */
function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function hasValidAdminSession(req: Request): boolean {
  return verifySessionToken(getCookie(req, COOKIE_NAME));
}

/** Express middleware — 401s any /api/admin/* route without a valid session. */
export function requireAdminSession(req: Request, res: Response, next: NextFunction): void {
  if (!hasValidAdminSession(req)) {
    res.status(401).json({ error: "Admin session required" });
    return;
  }
  next();
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}
