/**
 * Durable Grow campaign history, keyed by fid.
 *
 * The Grow → Activity tab used to show only the current browser tab's
 * in-memory ops (lost on reload, invisible on other devices). This persists
 * every campaign's lifecycle (live → completed/cancelled) so the Activity
 * tab's Live / Completed / Cancelled / History sub-tabs work across sessions.
 *
 * Upserts are keyed on (fid, campaign_id): campaign-start writes a `live`
 * row, and completion/cancellation flips it to `completed`/`cancelled` with
 * the final counts. All writes fail soft — Grow itself must never break
 * because history logging hiccuped.
 */

import { getPool } from "./pool.js";

export type GrowKind = "follow" | "unfollow" | "purge" | "casts" | "replies" | "unlike" | "unrecast";
export type GrowStatus = "live" | "completed" | "cancelled";

export interface GrowHistoryUpsert {
  fid: number;
  campaignId: string;
  kind: GrowKind;
  status: GrowStatus;
  label?: string;
  accountLabel?: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
}

export async function upsertGrowHistory(u: GrowHistoryUpsert): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO grow_history
         (fid, campaign_id, kind, status, label, account_label, total, succeeded, failed, skipped, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (fid, campaign_id) DO UPDATE SET
         status        = EXCLUDED.status,
         label         = COALESCE(EXCLUDED.label, grow_history.label),
         account_label = COALESCE(EXCLUDED.account_label, grow_history.account_label),
         total         = GREATEST(EXCLUDED.total, grow_history.total),
         succeeded     = GREATEST(EXCLUDED.succeeded, grow_history.succeeded),
         failed        = GREATEST(EXCLUDED.failed, grow_history.failed),
         skipped       = GREATEST(EXCLUDED.skipped, grow_history.skipped),
         updated_at    = now()`,
      [
        u.fid, u.campaignId, u.kind, u.status,
        u.label ?? null, u.accountLabel ?? null,
        u.total ?? 0, u.succeeded ?? 0, u.failed ?? 0, u.skipped ?? 0,
      ],
    );
  } catch (e) {
    console.warn("[grow-history] upsert failed:", (e as Error).message);
  }
}

export interface GrowHistoryRow {
  campaignId: string;
  kind: GrowKind;
  status: GrowStatus;
  label: string | null;
  accountLabel: string | null;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt: string;
  updatedAt: string;
}

export async function getGrowHistory(fid: number, limit = 100): Promise<GrowHistoryRow[]> {
  const pool = getPool();
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `SELECT campaign_id, kind, status, label, account_label,
              total, succeeded, failed, skipped, started_at, updated_at
       FROM grow_history
       WHERE fid = $1
       ORDER BY updated_at DESC
       LIMIT $2`,
      [fid, Math.min(limit, 200)],
    );
    return rows.map(r => ({
      campaignId:   r.campaign_id,
      kind:         r.kind,
      status:       r.status,
      label:        r.label,
      accountLabel: r.account_label,
      total:        Number(r.total),
      succeeded:    Number(r.succeeded),
      failed:       Number(r.failed),
      skipped:      Number(r.skipped),
      startedAt:    r.started_at,
      updatedAt:    r.updated_at,
    }));
  } catch (e) {
    console.warn("[grow-history] list failed:", (e as Error).message);
    return [];
  }
}
