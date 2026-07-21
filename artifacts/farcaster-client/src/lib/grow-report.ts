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
