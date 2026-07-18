/**
 * Reports Grow/Clean Up campaign lifecycle to the points/airdrop action
 * ledger. Unlike hub-submit.ts's per-action reporting, a Grow campaign has
 * no single proof hash — it's many individual follows — so the server logs
 * a start/complete pair here and verifies it later by sampling the claimed
 * target FIDs against the real follow graph (see the airdrop plan's
 * "Attribution" section). Fire-and-forget: never blocks or throws into the
 * batch-follow UI.
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
  startedAt: number;
}): void {
  fetch("/api/grow/campaign-complete", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(params),
    signal:  AbortSignal.timeout(8_000),
  }).catch(() => { /* best-effort */ });
}
