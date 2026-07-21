/**
 * Promotion & Gift detection — processes Farcaster cast.created webhook events.
 *
 * All DB writes are delegated to transactional helpers in db/allowance.ts so
 * that allowance debit + ledger insert are always atomic. Webhook retries are
 * handled by idempotency checks inside each transaction (the proof column acts
 * as the once-only gate; allowance is never debited when the proof already exists).
 *
 * Promotion: cast contains "FidCaster" AND mentions APP_FID.
 *   → debit 50 allowance, award 50 pts (or reject if allowance exhausted).
 *
 * Gift: cast starts with "{N} FidCaster points @user" (N ≤ 500).
 *   → debit N allowance, credit/queue N pts for recipient atomically.
 */

import { getAllowance, processPromotionAtomic, processGiftAtomic } from "./db/allowance.js";
import { getPool } from "./db/pool.js";
import { getPushTokensForFid, pruneInvalidTokens } from "./push-token-store.js";
import { sendPushToTokens } from "./fcm.js";
import { sendFarcasterNotification } from "./db/notifications.js";
import {
  giftReceivedNotif, giftSentNotif, giftFailedNotif, giftInsufficientAllowanceNotif,
  promotionOkNotif, promotionFailedNotif,
} from "./notification-templates.js";
import { neynarThrottle, penalize429 } from "./neynar-limit.js";

// ── Text-based mention fallback ──────────────────────────────────────────────
// The pre-filled compose text (both Promote and Gift) embeds "@handle" as
// plain characters via a warpcast.com/~/compose?text= URL, not through
// Warpcast's own @mention-autocomplete UI - it is NOT confirmed that every
// Farcaster client reliably upgrades that into a real structured mention
// (with a resolved fid) on submit versus posting it as inert text. If it
// doesn't, cast.mentioned_profiles arrives empty and both features silently
// never detect anything, no matter how correct the rest of this file is.
// These resolve a plain "@handle" straight from the cast text via Neynar as
// a fallback whenever the structured mention isn't there, so detection
// doesn't depend on that client behavior at all.
const NEYNAR_BASE = "https://api.neynar.com/v2/farcaster";

async function neynarFetch(url: string): Promise<Response> {
  let key: string;
  try { key = await neynarThrottle(); }
  catch { key = process.env.NEYNAR_API_KEY ?? ""; }
  const res = await fetch(url, { headers: { api_key: key }, signal: AbortSignal.timeout(8_000) });
  if (res.status === 429) {
    penalize429(key);
    let retryKey: string;
    try { retryKey = await neynarThrottle(); } catch { retryKey = key; }
    return fetch(url, { headers: { api_key: retryKey }, signal: AbortSignal.timeout(8_000) });
  }
  return res;
}

async function resolveUsernameToFid(username: string): Promise<number | null> {
  try {
    const res = await neynarFetch(`${NEYNAR_BASE}/user/by_username?username=${encodeURIComponent(username)}`);
    if (!res.ok) return null;
    const data = await res.json() as { user?: { fid?: number } };
    return typeof data.user?.fid === "number" ? data.user.fid : null;
  } catch {
    return null;
  }
}

// APP_FID's own username, resolved once and cached — used to text-match
// "@<appUsername>" in a promotion cast when mentioned_profiles doesn't
// already include appFid.
let cachedAppUsername: string | null | undefined; // undefined = not yet fetched

async function getAppUsername(appFid: number): Promise<string | null> {
  if (cachedAppUsername !== undefined) return cachedAppUsername;
  try {
    const res = await neynarFetch(`${NEYNAR_BASE}/user/bulk?fids=${appFid}`);
    if (!res.ok) { cachedAppUsername = null; return null; }
    const data = await res.json() as { users?: { username?: string }[] };
    cachedAppUsername = data.users?.[0]?.username ?? null;
  } catch {
    cachedAppUsername = null;
  }
  return cachedAppUsername;
}

// User-facing feedback for a fire-and-forget system: the user has no other way to
// learn whether their promotion/gift cast actually earned points or silently failed
// (e.g. ran out of allowance), since detection happens async via webhook.
//
// Fires on BOTH channels: the FCM/web push path (needs the user to have granted
// browser push permission) AND Farcaster's own native mini-app notification
// (delivered to everyone who tapped "Add App", no extra permission needed).
// Previously only the FCM path existed here, so anyone who hadn't separately
// opted into web push got nothing at all for gift/promotion events.
async function notifyFid(targetFid: number, payload: { title: string; body: string; data: Record<string, string> }): Promise<void> {
  await Promise.allSettled([
    (async () => {
      const tokens = await getPushTokensForFid(targetFid);
      if (tokens.length === 0) return;
      const { invalidTokens } = await sendPushToTokens(tokens, payload);
      await pruneInvalidTokens(invalidTokens);
    })(),
    sendFarcasterNotification({
      title: payload.title,
      body: payload.body,
      targetFids: [targetFid],
      targetUrl: "https://fidcaster.xyz/mini",
    }),
  ]).then(([pushResult, nativeResult]) => {
    if (pushResult.status === "rejected") console.warn("[promotion-watcher] push notify failed:", pushResult.reason);
    if (nativeResult.status === "rejected") console.warn("[promotion-watcher] native notify failed:", nativeResult.reason);
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_GIFT_PTS = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

interface NeynarUser {
  fid: number;
  username?: string;
}

export interface NeynarCastForPromotion {
  hash: string;
  text?: string;
  author?: NeynarUser;
  mentioned_profiles?: NeynarUser[];
}

// ── Regex patterns ────────────────────────────────────────────────────────────

const PROMO_REGEX = /fidcaster/i;
const GIFT_REGEX  = /^(\d+)\s+fidcaster\s+points/i;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getAppFid(): number | null {
  const n = Number(process.env.APP_FID);
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function isFidRegistered(fid: number): Promise<boolean> {
  const pool = getPool();
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM user_actions WHERE fid = $1 LIMIT 1`,
    [fid],
  );
  return rows.length > 0;
}

// ── Promotion detection ────────────────────────────────────────────────────────

export async function handlePromotionCast(cast: NeynarCastForPromotion): Promise<boolean> {
  const appFid = getAppFid();
  if (!appFid) return false;

  const text      = cast.text ?? "";
  const authorFid = cast.author?.fid;
  if (!authorFid) return false;

  if (!PROMO_REGEX.test(text)) return false;
  let mentionsApp = (cast.mentioned_profiles ?? []).some(p => p.fid === appFid);
  if (!mentionsApp) {
    // Structured mention missing (see the fallback block's comment above) -
    // fall back to a plain text match against the app's own username.
    const appUsername = await getAppUsername(appFid);
    if (appUsername) mentionsApp = new RegExp(`@${appUsername}\\b`, "i").test(text);
  }
  if (!mentionsApp) return false;

  try {
    // Ensure today's allowance row exists (requires HTTP to Neynar; must run outside transaction)
    await getAllowance(authorFid);

    const result = await processPromotionAtomic({ authorFid, castHash: cast.hash, appFid });

    if (!result.ok) {
      console.log(`[promotion] fid ${authorFid} cast ${cast.hash}: ${result.reason}`);
      if (result.reason === "insufficient_allowance" || result.reason === "promo_category_cap_reached") {
        const tmpl = promotionFailedNotif(result.reason === "promo_category_cap_reached" ? "cap" : "allowance");
        await notifyFid(authorFid, { ...tmpl, data: { type: "promotion_failed", castHash: cast.hash } });
      }
      return result.reason === "already_processed"; // true = was already handled, not an error
    }

    const promoPoints = result.promoPoints ?? 50;
    console.log(`[promotion] fid ${authorFid} cast ${cast.hash}: +${promoPoints} pts, allowance debited`);
    await notifyFid(authorFid, {
      ...promotionOkNotif(promoPoints),
      data: { type: "promotion_ok", castHash: cast.hash },
    });
    return true;
  } catch (e) {
    console.warn(`[promotion] DB error for cast ${cast.hash}:`, (e as Error).message);
    return false;
  }
}

// ── Gift detection ─────────────────────────────────────────────────────────────

export async function handleGiftCast(cast: NeynarCastForPromotion): Promise<boolean> {
  const text      = (cast.text ?? "").trim();
  const authorFid = cast.author?.fid;
  if (!authorFid) return false;

  const match = GIFT_REGEX.exec(text);
  if (!match) return false;

  const amount = parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_GIFT_PTS) return false;

  let recipientFid = (cast.mentioned_profiles ?? []).find(p => p.fid !== authorFid)?.fid ?? null;
  if (!recipientFid) {
    // Structured mention missing (see the fallback block's comment above) -
    // fall back to resolving the "@handle" straight out of the cast text.
    const handleMatch = /^\d+\s+fidcaster\s+points\s+@([a-z0-9_.-]+)/i.exec(text);
    if (handleMatch) recipientFid = await resolveUsernameToFid(handleMatch[1]);
  }
  if (!recipientFid || recipientFid === authorFid) {
    // Text matched the gift pattern but no real recipient resolved — e.g. the
    // user edited the pre-filled Warpcast text, mistyped the handle, or the
    // mentioned account doesn't exist. Without this the cast just silently
    // never earns anything, contradicting the in-app promise that a
    // promotion/gift attempt always gets a notification either way.
    await notifyFid(authorFid, { ...giftFailedNotif(), data: { type: "gift_failed", castHash: cast.hash } });
    return false;
  }

  try {
    // Ensure today's allowance row exists before entering the transaction
    await getAllowance(authorFid);

    const recipientIsRegistered = await isFidRegistered(recipientFid);

    const result = await processGiftAtomic({
      authorFid,
      recipientFid,
      amount,
      castHash: cast.hash,
      recipientIsRegistered,
    });

    if (!result.ok) {
      console.log(
        `[gift] fid ${authorFid} → fid ${recipientFid} (${amount} pts): ${result.reason}`,
      );
      if (result.reason === "insufficient_allowance") {
        await notifyFid(authorFid, { ...giftInsufficientAllowanceNotif(amount), data: { type: "gift_failed", castHash: cast.hash } });
      }
      return result.reason === "already_processed";
    }

    console.log(
      `[gift] fid ${authorFid} → fid ${recipientFid}: ${amount} pts ` +
      (recipientIsRegistered ? "credited directly" : "queued (unregistered)"),
    );
    await notifyFid(authorFid, { ...giftSentNotif(amount), data: { type: "gift_ok", castHash: cast.hash } });
    if (recipientIsRegistered) {
      await notifyFid(recipientFid, { ...giftReceivedNotif(amount), data: { type: "gift_received", castHash: cast.hash } });
    }
    return true;
  } catch (e) {
    console.warn(`[gift] DB error for cast ${cast.hash}:`, (e as Error).message);
    return false;
  }
}

// ── Unified entry point ────────────────────────────────────────────────────────

export async function processCastForAllowance(cast: NeynarCastForPromotion): Promise<void> {
  try {
    // Gift text ("{N} FidCaster points @user") always also matches
    // PROMO_REGEX (it contains the word "fidcaster"), so a gift whose
    // recipient mention happens to overlap with mentioning the app account
    // would get misclassified as a flat 50pt promotion instead of an N-pt
    // gift if promotion were checked first. GIFT_REGEX is the more specific,
    // anchored pattern, so it gets first refusal.
    //
    // Fall through to promotion ONLY when the text isn't gift-shaped at
    // all (GIFT_REGEX doesn't match) — NOT just whenever handleGiftCast()
    // returns false. A gift-shaped cast that fails for another reason
    // (bad amount, no resolvable recipient, out of allowance, gift
    // category cap reached) would otherwise get silently re-processed as
    // a completely different action (a flat 50pt promotion) instead of
    // just failing as the gift it actually was — crediting the wrong
    // amount and bypassing the gift category's own cap.
    if (GIFT_REGEX.test((cast.text ?? "").trim())) {
      await handleGiftCast(cast);
    } else {
      await handlePromotionCast(cast);
    }
  } catch (e) {
    console.warn("[promotion-watcher] unexpected error:", (e as Error).message);
  }
}
