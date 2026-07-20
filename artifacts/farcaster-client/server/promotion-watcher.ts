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

// User-facing feedback for a fire-and-forget system: the user has no other way to
// learn whether their promotion/gift cast actually earned points or silently failed
// (e.g. ran out of allowance), since detection happens async via webhook.
async function notifyFid(targetFid: number, payload: { title: string; body: string; data: Record<string, string> }): Promise<void> {
  try {
    const tokens = await getPushTokensForFid(targetFid);
    if (tokens.length === 0) return;
    const { invalidTokens } = await sendPushToTokens(tokens, payload);
    await pruneInvalidTokens(invalidTokens);
  } catch (e) {
    console.warn("[promotion-watcher] push notify failed:", (e as Error).message);
  }
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
  const mentionsApp = (cast.mentioned_profiles ?? []).some(p => p.fid === appFid);
  if (!mentionsApp) return false;

  try {
    // Ensure today's allowance row exists (requires HTTP to Neynar; must run outside transaction)
    await getAllowance(authorFid);

    const result = await processPromotionAtomic({ authorFid, castHash: cast.hash, appFid });

    if (!result.ok) {
      console.log(`[promotion] fid ${authorFid} cast ${cast.hash}: ${result.reason}`);
      if (result.reason === "insufficient_allowance") {
        await notifyFid(authorFid, {
          title: "Promotion not counted",
          body:  "Your promotion cast didn't earn points — you're out of daily allowance.",
          data:  { type: "promotion_failed", castHash: cast.hash },
        });
      }
      return result.reason === "already_processed"; // true = was already handled, not an error
    }

    console.log(`[promotion] fid ${authorFid} cast ${cast.hash}: +50 pts, allowance debited`);
    await notifyFid(authorFid, {
      title: "Promotion counted! +50 pts",
      body:  "Your FidCaster promotion cast just earned you 50 points.",
      data:  { type: "promotion_ok", castHash: cast.hash },
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

  const recipients = (cast.mentioned_profiles ?? []).filter(p => p.fid !== authorFid);
  if (recipients.length === 0) {
    // Text matched the gift pattern but no real mention resolved — e.g. the
    // user edited the pre-filled Warpcast text, mistyped the handle, or the
    // mentioned account doesn't exist. Without this the cast just silently
    // never earns anything, contradicting the in-app promise that a
    // promotion/gift attempt always gets a notification either way.
    await notifyFid(authorFid, {
      title: "Gift not sent",
      body:  "Your gift cast didn't tag a valid recipient, so no points moved.",
      data:  { type: "gift_failed", castHash: cast.hash },
    });
    return false;
  }
  const recipientFid = recipients[0].fid;

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
        await notifyFid(authorFid, {
          title: "Gift not sent",
          body:  `You didn't have enough daily allowance to gift ${amount} pts.`,
          data:  { type: "gift_failed", castHash: cast.hash },
        });
      }
      return result.reason === "already_processed";
    }

    console.log(
      `[gift] fid ${authorFid} → fid ${recipientFid}: ${amount} pts ` +
      (recipientIsRegistered ? "credited directly" : "queued (unregistered)"),
    );
    await notifyFid(authorFid, {
      title: "Gift sent!",
      body:  `Your gift of ${amount} pts was delivered.`,
      data:  { type: "gift_ok", castHash: cast.hash },
    });
    if (recipientIsRegistered) {
      await notifyFid(recipientFid, {
        title: "You received a gift!",
        body:  `+${amount} FidCaster points from a fellow user.`,
        data:  { type: "gift_received", castHash: cast.hash },
      });
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
