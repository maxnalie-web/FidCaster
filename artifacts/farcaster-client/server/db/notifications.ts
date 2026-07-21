/**
 * Farcaster Mini App notification token store.
 *
 * Tokens arrive via:
 *   1. The /.well-known/farcaster.json webhookUrl endpoint (JWS from Farcaster servers)
 *   2. Directly from the client after sdk.on("frameAdded") fires
 *
 * Sending goes through https://api.farcaster.xyz/v1/frame-notifications
 */

import { getPool } from "./pool.js";

export interface NotifToken {
  fid: number;
  token: string;
  url: string;
  enabled: boolean;
}

// ── Upsert: store or refresh a token for a given FID ─────────────────────────
export async function upsertNotificationToken(
  fid: number,
  token: string,
  url: string,
): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `INSERT INTO notification_tokens (fid, token, url, enabled, updated_at)
     VALUES ($1, $2, $3, true, now())
     ON CONFLICT (fid) DO UPDATE
       SET token = EXCLUDED.token,
           url   = EXCLUDED.url,
           enabled = true,
           updated_at = now()`,
    [fid, token, url],
  );
}

// ── Disable: user removed the app or disabled notifications ─────────────────
export async function disableNotificationToken(fid: number): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(
    `UPDATE notification_tokens SET enabled = false, updated_at = now() WHERE fid = $1`,
    [fid],
  );
}

// ── Delete: remove token entirely ───────────────────────────────────────────
export async function deleteNotificationToken(fid: number): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  await pool.query(`DELETE FROM notification_tokens WHERE fid = $1`, [fid]);
}

// ── Fetch active tokens (optionally filtered by FID list) ────────────────────
export async function getActiveTokens(
  fids?: number[],
): Promise<NotifToken[]> {
  const pool = getPool();
  if (!pool) return [];
  if (fids && fids.length === 0) return [];
  const { rows } = fids
    ? await pool.query(
        `SELECT fid, token, url, enabled FROM notification_tokens
         WHERE enabled = true AND fid = ANY($1::bigint[])`,
        [fids],
      )
    : await pool.query(
        `SELECT fid, token, url, enabled FROM notification_tokens WHERE enabled = true`,
      );
  return rows as NotifToken[];
}

// ── Send a Farcaster notification ────────────────────────────────────────────
export interface SendNotifOptions {
  title: string;
  body: string;
  targetUrl?: string;
  /** If omitted → send to ALL users with tokens */
  targetFids?: number[];
  notificationId?: string;
}

export async function sendFarcasterNotification(
  opts: SendNotifOptions,
): Promise<{ sent: number; failed: number }> {
  const { title, body, targetUrl = "https://fidcaster.xyz/mini", notificationId } = opts;
  const tokens = await getActiveTokens(opts.targetFids);
  if (tokens.length === 0) return { sent: 0, failed: 0 };

  // Group by notification URL (all Farcaster tokens share one URL but keep it generic)
  const byUrl: Record<string, { url: string; tokens: string[] }> = {};
  for (const t of tokens) {
    if (!byUrl[t.url]) byUrl[t.url] = { url: t.url, tokens: [] };
    byUrl[t.url].tokens.push(t.token);
  }

  let sent = 0;
  let failed = 0;

  for (const group of Object.values(byUrl)) {
    // Farcaster API allows max 100 tokens per request
    const chunks = chunkArray(group.tokens, 100);
    for (const chunk of chunks) {
      const id = notificationId ?? `fidcaster-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        const resp = await fetch(group.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notificationId: id,
            title: title.slice(0, 32),
            body: body.slice(0, 128),
            targetUrl,
            tokens: chunk,
          }),
        });
        const data: any = await resp.json().catch(() => ({}));
        sent   += data.result?.successfulTokens?.length  ?? 0;
        failed += data.result?.invalidTokens?.length     ?? 0;
        failed += data.result?.rateLimitedTokens?.length ?? 0;
        // Invalidate bad tokens so we don't send to them again
        if (data.result?.invalidTokens?.length) {
          const pool = getPool();
          if (pool) {
            await pool.query(
              `DELETE FROM notification_tokens WHERE token = ANY($1::text[])`,
              [data.result.invalidTokens],
            );
          }
        }
      } catch (e) {
        console.warn("[notif] send error:", (e as Error).message);
        failed += chunk.length;
      }
    }
  }
  return { sent, failed };
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
