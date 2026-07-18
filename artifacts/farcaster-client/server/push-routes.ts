/**
 * Push notifications: token registration + Neynar webhook receiver that
 * turns "someone liked/recast/mentioned you" Farcaster events into FCM
 * pushes for registered devices.
 *
 * One-time setup (Neynar Dashboard -> Webhooks -> New Webhook):
 *   - Target URL: <API_BASE_URL>/api/push/webhook
 *   - Events: reaction.created, cast.created
 *   - Copy the webhook's id -> NEYNAR_WEBHOOK_ID env var
 *   - Copy the webhook's secret -> NEYNAR_WEBHOOK_SECRET env var
 * From then on this file keeps the webhook's target_fids/mentioned_fids
 * filters in sync with whoever has a push token registered, via Neynar's
 * update-webhook API — no further dashboard edits needed as users opt in.
 *
 * Known gap: Neynar's cast.created filter only supports author_fids /
 * mentioned_fids (no "reply to this fid" filter), so a reply that does NOT
 * @-mention the original author won't trigger a push. Likes, recasts, and
 * mentions (including replies that mention) all work.
 */

import type { Express, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import rateLimit from "express-rate-limit";
import {
  addPushToken, removePushToken, getPushTokensForFid, getAllRegisteredFids, pruneInvalidTokens,
} from "./push-token-store.js";
import { sendPushToTokens } from "./fcm.js";

const registerLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const webhookLimiter = rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false });

const FID_MAX = 1_000_000_000;
const isValidFid = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0 && v < FID_MAX;

// ── Keep the Neynar webhook's fid filters in sync with our token store ──────
let syncTimer: ReturnType<typeof setTimeout> | null = null;

async function syncNeynarWebhookTargets(): Promise<void> {
  const apiKey = process.env.NEYNAR_API_KEY;
  const webhookId = process.env.NEYNAR_WEBHOOK_ID;
  const webhookUrl = process.env.PUSH_WEBHOOK_URL; // e.g. https://fidcaster.xyz/api/push/webhook
  if (!apiKey || !webhookId || !webhookUrl) return; // not configured yet — no-op

  const fids = getAllRegisteredFids();
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
          "cast.created": { mentioned_fids: fids },
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.warn(`[push] Neynar webhook sync failed: ${r.status} ${t.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn("[push] Neynar webhook sync error:", (e as Error).message);
  }
}

// Debounced — a burst of registrations shouldn't fire one PUT per request.
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

async function pushToFid(targetFid: number, payload: { title: string; body: string; data: Record<string, string> }): Promise<void> {
  const tokens = getPushTokensForFid(targetFid);
  if (tokens.length === 0) return;
  const { invalidTokens } = await sendPushToTokens(tokens, payload);
  pruneInvalidTokens(invalidTokens);
}

async function handleReactionCreated(data: { reaction_type?: string; user?: NeynarUser; cast?: NeynarCast }): Promise<void> {
  const targetFid = data.cast?.author?.fid;
  const actor = data.user;
  if (!targetFid || !actor || actor.fid === targetFid) return; // ignore self-reactions
  const isLike = data.reaction_type === "like";
  const actorName = actor.display_name || actor.username || `fid ${actor.fid}`;
  await pushToFid(targetFid, {
    title: isLike ? "لایک جدید" : "ریکست جدید",
    body: isLike ? `${actorName} کست شما را لایک کرد` : `${actorName} کست شما را ریکست کرد`,
    data: { type: isLike ? "like" : "recast", castHash: data.cast?.hash ?? "", actorFid: String(actor.fid) },
  });
}

async function handleCastCreated(data: NeynarCast & { mentioned_profiles?: NeynarUser[]; parent_author?: { fid?: number } }): Promise<void> {
  const actor = data.author;
  if (!actor) return;
  const actorName = actor.display_name || actor.username || `fid ${actor.fid}`;
  const isReply = !!data.parent_author?.fid;

  // Reply that also lands as a cast.created mention (parent_author fid is
  // in our mentioned_fids filter set) — de-dupe against the mention branch
  // below by preferring the reply framing when both apply.
  if (isReply && data.parent_author?.fid && data.parent_author.fid !== actor.fid) {
    await pushToFid(data.parent_author.fid, {
      title: "پاسخ جدید",
      body: `${actorName} به کست شما پاسخ داد`,
      data: { type: "reply", castHash: data.hash, actorFid: String(actor.fid) },
    });
  }

  for (const mentioned of data.mentioned_profiles ?? []) {
    if (mentioned.fid === actor.fid) continue;
    if (isReply && mentioned.fid === data.parent_author?.fid) continue; // already handled above
    await pushToFid(mentioned.fid, {
      title: "منشن جدید",
      body: `${actorName} شما را منشن کرد`,
      data: { type: "mention", castHash: data.hash, actorFid: String(actor.fid) },
    });
  }
}

export function registerPushRoutes(app: Express): void {
  // Bodies are already JSON-parsed by index.ts's global dispatcher
  // (smallJsonParser for these two paths, webhookJsonParser — which also
  // captures req.rawBody for signature verification — for the webhook path).
  app.post("/api/push/register-token", registerLimiter, async (req: Request, res: Response) => {
    const { fid, fcmToken, platform } = req.body as { fid?: number; fcmToken?: string; platform?: string };
    if (!isValidFid(fid)) { res.status(400).json({ error: "Invalid fid" }); return; }
    if (!fcmToken || typeof fcmToken !== "string" || fcmToken.length < 10 || fcmToken.length > 4096) {
      res.status(400).json({ error: "Invalid fcmToken" }); return;
    }
    addPushToken(fid, fcmToken, platform === "ios" ? "ios" : "android");
    scheduleWebhookSync();
    res.json({ ok: true });
  });

  app.post("/api/push/unregister-token", registerLimiter, async (req: Request, res: Response) => {
    const { fid, fcmToken } = req.body as { fid?: number; fcmToken?: string };
    if (!isValidFid(fid) || !fcmToken || typeof fcmToken !== "string") {
      res.status(400).json({ error: "Invalid fid or fcmToken" }); return;
    }
    removePushToken(fid, fcmToken);
    scheduleWebhookSync();
    res.json({ ok: true });
  });

  app.post("/api/push/webhook", webhookLimiter, async (req: Request, res: Response) => {
    if (!verifyNeynarSignature(req)) { res.status(401).json({ error: "Invalid signature" }); return; }
    // Ack immediately — Neynar retries on slow/non-2xx responses, and the
    // actual FCM fan-out below can take longer than a webhook's timeout.
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
}
