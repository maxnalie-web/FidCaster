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

const registerLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const webhookLimiter  = rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false });

const FID_MAX    = 1_000_000_000;
const isValidFid = (v: unknown): v is number =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v < FID_MAX;

// ── Keep the Neynar webhook's fid filters in sync with our token store ───────
let syncTimer: ReturnType<typeof setTimeout> | null = null;

async function syncNeynarWebhookTargets(): Promise<void> {
  const apiKey     = process.env.NEYNAR_API_KEY;
  const webhookId  = process.env.NEYNAR_WEBHOOK_ID;
  const webhookUrl = process.env.PUSH_WEBHOOK_URL;
  if (!apiKey || !webhookId || !webhookUrl) return;

  const fids = await getAllRegisteredFids();
  try {
    const r = await fetch("https://api.neynar.com/v2/farcaster/webhook/", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({
        webhook_id: webhookId,
        name: "fidcaster-push",
        url: webhookUrl,
        subscription: {
          "reaction.created": { target_fids: fids },
          "cast.created":     { mentioned_fids: fids },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.warn(`[push] Neynar webhook sync failed: ${r.status} ${t.slice(0, 200)}`);
    } else {
      console.log(`[push] Neynar webhook synced — ${fids.length} fid(s) registered`);
    }
  } catch (e) {
    console.warn("[push] Neynar webhook sync error:", (e as Error).message);
  }
}

function scheduleWebhookSync(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNeynarWebhookTargets(); }, 5_000);
}

function verifyNeynarSignature(req: Request): boolean {
  const secret = process.env.NEYNAR_WEBHOOK_SECRET;
  if (!secret) return false;
  const sig = req.header("X-Neynar-Signature");
  if (!sig) return false;
  const raw = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!raw) return false;
  const expected = createHmac("sha512", secret).update(raw).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
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

async function handleReactionCreated(
  data: { reaction_type?: string; user?: NeynarUser; cast?: NeynarCast },
): Promise<void> {
  const targetFid = data.cast?.author?.fid;
  const actor     = data.user;
  if (!targetFid || !actor || actor.fid === targetFid) return;
  const isLike    = data.reaction_type === "like";
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
    if (!verifyNeynarSignature(req)) { res.status(401).json({ error: "Invalid signature" }); return; }
    res.status(200).json({ ok: true });
    try {
      const body = req.body as { type?: string; data?: unknown };
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
        totalRegisteredFids:      fids.length,
        tokenCountForFid:         Number.isFinite(fid) && fid > 0 ? (await getPushTokensForFid(fid)).length : null,
        store:                    "postgresql",
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
