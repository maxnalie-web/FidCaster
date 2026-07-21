/**
 * Push notifications: token registration + Neynar webhook receiver that
 * turns "someone liked/recast/mentioned you" Farcaster events into FCM
 * pushes for registered devices.
 *
 * Token store is backed by Replit PostgreSQL (persists across autoscale
 * cold-starts and redeployments - unlike the old SQLite store).
 */

import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import {
  addPushToken, removePushToken, getPushTokensForFid, getAllRegisteredFids, pruneInvalidTokens,
} from "./push-token-store.js";
import { sendPushToTokens, isFcmConfigured } from "./fcm.js";
import { processCastForAllowance } from "./promotion-watcher.js";

const registerLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const webhookLimiter  = rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false });

const FID_MAX    = 1_000_000_000;
const isValidFid = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v < FID_MAX;

// ── Keep the Neynar webhook's fid filters in sync with our token store ───────
let syncTimer: ReturnType<typeof setTimeout> | null = null;

// Neynar returns the webhook's signing secret in the PUT update response.
// We cache it here so signature verification uses the live, authoritative
// value — even when NEYNAR_WEBHOOK_SECRET in the environment is stale
// (e.g. the webhook was recreated/rotated after the env var was last set).
// On every server boot, the first sync (kicked off by startWebhookTargetSync)
// populates this within 5 seconds, so all subsequent webhook deliveries
// pass verification correctly.
let runtimeWebhookSecret: string | null = null;

/** Return all FIDs that have ever opened the app (from the ledger users table). */
async function getAllAppFids(): Promise<number[]> {
  try {
    const { getPool } = await import("./db/pool.js");
    const pool = getPool();
    if (!pool) return [];
    const { rows } = await pool.query(`SELECT fid FROM users`);
    return rows.map((r: { fid: string | number }) => Number(r.fid));
  } catch {
    return [];
  }
}

async function syncNeynarWebhookTargets(): Promise<void> {
  const apiKey     = process.env.NEYNAR_API_KEY;
  const webhookId  = process.env.NEYNAR_WEBHOOK_ID;
  const webhookUrl = process.env.PUSH_WEBHOOK_URL;
  if (!apiKey || !webhookId || !webhookUrl) return;

  // Push-notification targets (push token holders)
  const pushFids = await getAllRegisteredFids();

  // All FIDs that have ever used the app — used as author_fids so that gift casts
  // FROM any registered user are delivered even when the mentioned recipient has
  // no push token (and therefore wouldn't appear in mentioned_fids).
  const allAppFids = await getAllAppFids();

  // Always include APP_FID in mentioned_fids so promotion casts (which must
  // mention the app account) are delivered regardless of who the sender is.
  const appFid = Number(process.env.APP_FID);
  const mentionFids = appFid > 0
    ? Array.from(new Set([appFid, ...pushFids]))
    : pushFids;

  // Deduplicate and union allAppFids + pushFids for author_fids
  const authorFids = Array.from(new Set([...allAppFids, ...pushFids]));

  try {
    const r = await fetch("https://api.neynar.com/v2/farcaster/webhook/", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        webhook_id: webhookId,
        name: "fidcaster-push",
        url: webhookUrl,
        subscription: {
          "reaction.created": { target_fids: pushFids },
          // mentioned_fids: captures promotions (sender mentions APP_FID) + push-mention notifications
          // author_fids:    captures gift casts FROM any registered user to any recipient
          // Points for plain casts/likes/recasts are intentionally NOT earned via this
          // webhook - action points only count when done through FidCaster's own UI
          // (see actions-routes.ts). Farcaster/Warpcast activity only earns via the
          // allowance system (Promote/Gift), handled below by processCastForAllowance.
          "cast.created": {
            mentioned_fids: mentionFids,
            ...(authorFids.length > 0 ? { author_fids: authorFids } : {}),
          },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.warn(`[push] Neynar webhook sync failed: ${r.status} ${t.slice(0, 200)}`);
    } else {
      // Parse the response and capture the live webhook secret.
      // Neynar returns { webhook: { secret: "...", ... } } on PUT.
      // This self-heals the common "signature mismatch" failure mode where
      // NEYNAR_WEBHOOK_SECRET in the environment is stale (set when the
      // webhook was first created but never updated after a rotation/recreate).
      try {
        const body = await r.json() as { webhook?: { secret?: string } };
        const freshSecret = body.webhook?.secret;
        if (freshSecret && typeof freshSecret === "string") {
          if (freshSecret !== runtimeWebhookSecret) {
            runtimeWebhookSecret = freshSecret;
            console.log("[push] webhook secret refreshed from Neynar API response");
          }
        }
      } catch { /* non-critical — keep going */ }

      console.log(
        `[push] Neynar webhook synced — ${pushFids.length} push fid(s), ` +
        `${mentionFids.length} mention fid(s), ${authorFids.length} author fid(s)`,
      );
    }
  } catch (e) {
    console.warn("[push] Neynar webhook sync error:", (e as Error).message);
  }
}

export function scheduleWebhookSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNeynarWebhookTargets(); }, 5_000);
}

// Neynar's cast.created subscription only fires for author_fids/mentioned_fids
// present in the LAST synced filter list. Before this, that list was only
// ever refreshed reactively (on push-token register/unregister), so any fid
// that gifted/promoted without ever registering a push token — or any fid
// added after the last sync/restart — silently never had their cast.created
// events delivered at all: the gift/promote cast could post successfully and
// still never get detected, allowance never debited, no points, nothing.
const PERIODIC_WEBHOOK_SYNC_MS = 2 * 60_000; // every 2 min (was 10) — keeps new users in author_fids quickly
let periodicSyncTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Fetch the live webhook secret from Neynar on startup via GET — in addition to
 * the PUT response path. This populates runtimeWebhookSecret before any
 * webhook delivery can arrive, so even casts delivered within the first few
 * seconds of server boot pass HMAC verification without relying on the env var.
 */
async function fetchWebhookSecretOnStartup(): Promise<void> {
  const apiKey    = process.env.NEYNAR_API_KEY;
  const webhookId = process.env.NEYNAR_WEBHOOK_ID;
  if (!apiKey || !webhookId) return;
  try {
    const r = await fetch(`https://api.neynar.com/v2/farcaster/webhook/${webhookId}`, {
      headers: { "x-api-key": apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      console.warn(`[push] startup webhook secret GET: ${r.status} — will retry via PUT sync`);
      return;
    }
    const body = await r.json() as { webhook?: { secret?: string } };
    const secret = body.webhook?.secret;
    if (secret && typeof secret === "string") {
      runtimeWebhookSecret = secret;
      console.log("[push] webhook secret loaded from Neynar GET on startup");
    }
  } catch (e) {
    console.warn("[push] startup webhook secret fetch failed:", (e as Error).message);
  }
}

export function startWebhookTargetSync(): void {
  // Fetch the live secret immediately via GET so HMAC verification is ready
  // before the first webhook delivery, not only after the first PUT response.
  void fetchWebhookSecretOnStartup();
  scheduleWebhookSync(); // pick up everyone immediately on boot, not just on the next push-token event
  if (periodicSyncTimer) return;
  periodicSyncTimer = setInterval(() => { syncNeynarWebhookTargets(); }, PERIODIC_WEBHOOK_SYNC_MS);
}

// ── Recent webhook event log (in-memory, last 30) ─────────────────────────
// Gift/promotion failures were completely invisible before this - the only
// way to tell "Neynar never sent the event" apart from "it was sent and
// silently rejected/skipped somewhere in the pipeline" was to have shell
// access to production logs at the exact moment it happened. This exposes
// the last few webhook deliveries (accepted or rejected, and why) through
// the debug-status endpoint instead.
interface WebhookLogEntry {
  at: string;
  type: string | null;
  authorFid: number | null;
  castHash: string | null;
  textPreview: string | null;
  signatureOk: boolean;
  rejectReason: string | null;
}
const recentWebhookEvents: WebhookLogEntry[] = [];
function logWebhookEvent(entry: WebhookLogEntry): void {
  recentWebhookEvents.push(entry);
  if (recentWebhookEvents.length > 30) recentWebhookEvents.shift();
}

// Returns a reason string on failure instead of just false - this used to
// fail 100% silently (no log line at all), so a missing/wrong
// NEYNAR_WEBHOOK_SECRET meant every single webhook call was rejected with a
// 401 and there was no trace of it anywhere - impossible to tell apart from
// "Neynar never sent anything" without shell access to check env vars.
function verifyNeynarSignature(req: Request): { ok: true } | { ok: false; reason: string } {
  // Prefer the live secret refreshed from the Neynar PUT response (populated
  // within 5s of server boot by startWebhookTargetSync). Fall back to the
  // environment variable so cold-start events still verify if the env var
  // is correct, or as a bootstrap value before the first sync completes.
  const secret = runtimeWebhookSecret ?? process.env.NEYNAR_WEBHOOK_SECRET;
  if (!secret) return { ok: false, reason: "NEYNAR_WEBHOOK_SECRET not set" };
  const sig = req.header("X-Neynar-Signature");
  if (!sig) return { ok: false, reason: "missing X-Neynar-Signature header" };
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) return { ok: false, reason: "no rawBody captured" };
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  const match = a.length === b.length && timingSafeEqual(a, b);
  return match ? { ok: true } : { ok: false, reason: "signature mismatch" };
}

type NeynarUser = { fid: number; username?: string; display_name?: string };
type NeynarCast = { hash: string; text?: string; author?: NeynarUser };

async function pushToFid(
  targetFid: number,
  payload: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
  const tokens = await getPushTokensForFid(targetFid);
  if (tokens.length === 0) return;
  const { invalidTokens } = await sendPushToTokens(tokens, payload);
  await pruneInvalidTokens(invalidTokens);
}

// Push notifications only - deliberately does NOT award points. Points
// only count when the action happens through FidCaster's own UI (see
// actions-routes.ts) so users have a clear reason to use FidCaster over
// posting directly on Farcaster. Farcaster activity earns via the
// allowance system (Promote/Gift) instead - see processCastForAllowance.
async function handleReactionCreated(
  data: { reaction_type?: string; user?: NeynarUser; cast?: NeynarCast },
): Promise<void> {
  const actor = data.user;
  const isLike = data.reaction_type === "like";
  const targetFid = data.cast?.author?.fid;
  if (!targetFid || !actor || actor.fid === targetFid) return;
  const actorName = actor.display_name || actor.username || `fid ${actor.fid}`;
  await pushToFid(targetFid, {
    title: isLike ? "New like" : "New recast",
    body:  isLike ? `${actorName} liked your cast` : `${actorName} recasted your cast`,
    data:  { type: isLike ? "like" : "recast", castHash: data.cast?.hash ?? "", actorFid: String(actor.fid) },
  });
}

async function handleCastCreated(
  data: NeynarCast & { mentioned_profiles?: NeynarUser[]; parent_author?: { fid?: number } },
): Promise<void> {
  const actor = data.author;
  if (!actor) return;
  const actorName = actor.display_name || actor.username || `fid ${actor.fid}`;
  const isReply   = !!data.parent_author?.fid;

  // Push notifications for replies and mentions
  if (isReply && data.parent_author?.fid && data.parent_author.fid !== actor.fid) {
    await pushToFid(data.parent_author.fid, {
      title: "New reply",
      body:  `${actorName} replied to your cast`,
      data:  { type: "reply", castHash: data.hash, actorFid: String(actor.fid) },
    });
  }

  for (const mentioned of data.mentioned_profiles ?? []) {
    if (mentioned.fid === actor.fid) continue;
    if (isReply && mentioned.fid === data.parent_author?.fid) continue;
    await pushToFid(mentioned.fid, {
      title: "New mention",
      body:  `${actorName} mentioned you`,
      data:  { type: "mention", castHash: data.hash, actorFid: String(actor.fid) },
    });
  }

  // Check cast for promotion / gift patterns (allowance system)
  await processCastForAllowance({
    hash:               data.hash,
    text:               data.text,
    author:             actor,
    mentioned_profiles: data.mentioned_profiles,
  });
  // No generic cast points here on purpose - a plain cast posted directly on
  // Farcaster doesn't earn action points, only through FidCaster's own UI.
}

export function registerPushRoutes(app: Express): void {
  app.post("/api/push/register-token", registerLimiter, async (req: Request, res: Response) => {
    try {
      const { fid, fcmToken, platform } = req.body as { fid?: number; fcmToken?: string; platform?: string };
      if (!isValidFid(fid))                                    { res.status(400).json({ error: "Invalid fid" }); return; }
      if (!fcmToken || typeof fcmToken !== "string" || fcmToken.length < 10 || fcmToken.length > 4096) {
        res.status(400).json({ error: "Invalid fcmToken" }); return;
      }
      await addPushToken(fid, fcmToken, platform === "ios" ? "ios" : "android");
      scheduleWebhookSync();
      res.json({ ok: true });
    } catch (e) {
      console.error("[push] register-token error:", (e as Error).message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/push/unregister-token", registerLimiter, async (req: Request, res: Response) => {
    try {
      const { fid, fcmToken } = req.body as { fid?: number; fcmToken?: string };
      if (!isValidFid(fid) || !fcmToken || typeof fcmToken !== "string") {
        res.status(400).json({ error: "Invalid fid or fcmToken" }); return;
      }
      await removePushToken(fid, fcmToken);
      scheduleWebhookSync();
      res.json({ ok: true });
    } catch (e) {
      console.error("[push] unregister-token error:", (e as Error).message);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/api/push/webhook", webhookLimiter, async (req: Request, res: Response) => {
    const body = req.body as { type?: string; data?: { hash?: string; text?: string; author?: NeynarUser } };
    const sigCheck = verifyNeynarSignature(req);
    if (!sigCheck.ok) {
      console.warn(`[push] webhook rejected: ${sigCheck.reason}`);
      logWebhookEvent({
        at: new Date().toISOString(), type: body?.type ?? null,
        authorFid: body?.data?.author?.fid ?? null, castHash: body?.data?.hash ?? null,
        textPreview: body?.data?.text?.slice(0, 60) ?? null,
        signatureOk: false, rejectReason: sigCheck.reason,
      });
      res.status(401).json({ error: "Invalid signature" }); return;
    }
    res.status(200).json({ ok: true });
    logWebhookEvent({
      at: new Date().toISOString(), type: body.type ?? null,
      authorFid: body.data?.author?.fid ?? null, castHash: body.data?.hash ?? null,
      textPreview: body.data?.text?.slice(0, 60) ?? null,
      signatureOk: true, rejectReason: null,
    });
    try {
      if (body.type === "reaction.created") {
        await handleReactionCreated(body.data as { reaction_type?: string; user?: NeynarUser; cast?: NeynarCast });
      } else if (body.type === "cast.created") {
        await handleCastCreated(body.data as NeynarCast & { mentioned_profiles?: NeynarUser[]; parent_author?: { fid?: number } });
      }
    } catch (e) {
      console.warn("[push] webhook handling error:", (e as Error).message);
    }
  });

  // Diagnostic endpoint - no secrets exposed.
  app.get("/api/push/debug-status", async (req: Request, res: Response) => {
    try {
      const fid  = Number(req.query.fid);
      const fids = await getAllRegisteredFids();
      res.json({
        fcmConfigured:            isFcmConfigured(),
        neynarWebhookConfigured:  !!(process.env.NEYNAR_API_KEY && process.env.NEYNAR_WEBHOOK_ID && process.env.PUSH_WEBHOOK_URL),
        // Separate from neynarWebhookConfigured on purpose: this is a 4th,
        // easy-to-miss env var that gates every single incoming webhook call
        // with zero prior visibility - the other 3 vars only control OUTGOING
        // registration with Neynar, this one gates whether we accept what
        // Neynar sends back at all.
        neynarWebhookSecretConfigured: !!process.env.NEYNAR_WEBHOOK_SECRET,
        totalRegisteredFids:      fids.length,
        tokenCountForFid:         Number.isFinite(fid) && fid > 0 ? (await getPushTokensForFid(fid)).length : null,
        store:                    "postgresql",
        recentWebhookEvents,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
