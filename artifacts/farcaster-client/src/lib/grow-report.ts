/**
 * Fire-and-forget reporting of Grow/Clean Up campaigns to the action ledger.
 *
 * A Grow campaign has no single proof hash (it's many individual follows),
 * so the server logs a start+complete pair and verifies it later by sampling
 * the claimed target FIDs against the real follow graph via Neynar.
 *
 * These calls never block or throw into the batch UI.
 */

export function reportGrowCampaignStart(params: {
  fid: number;
  campaignId: string;
  mode: "follow" | "unfollow";
  targetFid?: number;
  filters?: Record<string, unknown>;
  targetFids: number[];
}): void {
  fetch("/api/grow/campaign-start", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
    signal:  AbortSignal.timeout(8_000),
  }).catch(() => { /* best-effort */ });
}

export function reportGrowCampaignComplete(params: {
  fid: number;
  campaignId: string;
  succeeded: number;
  failed: number;
  total: number;
  startedAt: number;
}): void {
  fetch("/api/grow/campaign-complete", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
    signal:  AbortSignal.timeout(8_000),
  }).catch(() => { /* best-effort */ });
}

// Durable per-fid campaign history for the Grow → Activity tab (Live /
// Completed / Cancelled / History). Separate from the points-scoring
// start/complete calls above: this tracks every campaign's lifecycle
// regardless of whether it earned points, and survives reloads/devices.
export type GrowHistoryKind = "follow" | "unfollow" | "purge" | "casts" | "replies" | "unlike" | "unrecast";

export function reportGrowHistory(params: {
  fid: number;
  campaignId: string;
  kind: GrowHistoryKind;
  status: "live" | "completed" | "cancelled";
  label?: string;
  accountLabel?: string;
  total?: number;
  succeeded?: number;
  failed?: number;
  skipped?: number;
}): void {
  fetch("/api/grow/history", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
    signal:  AbortSignal.timeout(8_000),
  }).catch(() => { /* best-effort */ });
}

export interface GrowHistoryEntry {
  campaignId: string;
  kind: GrowHistoryKind;
  status: "live" | "completed" | "cancelled";
  label: string | null;
  accountLabel: string | null;
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt: string;
  updatedAt: string;
}

export async function fetchGrowHistory(fid: number): Promise<GrowHistoryEntry[]> {
  try {
    const r = await fetch(`/api/grow/history?fid=${fid}`, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return [];
    const d = await r.json() as { history?: GrowHistoryEntry[] };
    return Array.isArray(d.history) ? d.history : [];
  } catch {
    return [];
  }
}
