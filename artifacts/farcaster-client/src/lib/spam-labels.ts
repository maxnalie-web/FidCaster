/**
 * Real Farcaster spam labels (github.com/merkle-team/labels), fetched from
 * our own server (server/spam-labels.ts caches the ~1M-row dataset in
 * SQLite) · NOT derived from Neynar's `score` field, which is a different,
 * proprietary metric. Per the dataset's README: 0 = likely spammy,
 * 2 = unlikely spammy, 3 = nerfed for malicious activity. A FID absent from
 * the response is "unknown" (not enough data), not automatically clean.
 */

export type SpamLabelValue = 0 | 2 | 3;

/** UI-facing tri-state for "filter by this label" controls (Grow, Custom Feeds). */
export type SpamLabelFilter = "any" | "not-spam" | "spam-only";

export function matchesSpamLabelFilter(filter: SpamLabelFilter, label: SpamLabelValue | undefined): boolean {
  if (filter === "any") return true;
  // Unlabelled FIDs are "unknown" in the real dataset, not evidence either way · kept.
  if (label === undefined) return true;
  if (filter === "not-spam") return label === 2;
  return label === 0;
}

const cache = new Map<number, SpamLabelValue | null>();
// "Unknown" results (fid absent from the dataset, or the server's cache was
// still cold when we asked) get a short expiry instead of being cached
// forever · the server can take a while to finish its initial dataset
// download after a cold start, and without this a FID looked up during that
// window would show as "no label" for the rest of the session even after the
// server catches up.
const missExpiresAt = new Map<number, number>();
const MISS_TTL_MS = 45_000;

export async function getSpamLabelsFor(fids: number[]): Promise<Record<number, SpamLabelValue>> {
  const result: Record<number, SpamLabelValue> = {};
  const misses: number[] = [];
  const now = Date.now();
  for (const fid of fids) {
    const hit = cache.get(fid);
    if (hit !== undefined) {
      if (hit !== null) { result[fid] = hit; continue; }
      const expiresAt = missExpiresAt.get(fid);
      if (expiresAt !== undefined && now < expiresAt) continue;
    }
    misses.push(fid);
  }
  if (misses.length === 0) return result;
  try {
    const res = await fetch(`/api/spam-labels?fids=${misses.join(",")}`);
    if (res.ok) {
      const data = await res.json() as Record<string, SpamLabelValue>;
      for (const fid of misses) {
        const label = data[String(fid)];
        cache.set(fid, label ?? null);
        if (label !== undefined) { missExpiresAt.delete(fid); result[fid] = label; }
        else missExpiresAt.set(fid, now + MISS_TTL_MS);
      }
    }
  } catch { /* leave misses unresolved this round · treated as unknown */ }
  return result;
}

/** Synchronous read of whatever's already cached, for render-time filtering after a prefetch. */
export function getCachedSpamLabel(fid: number): SpamLabelValue | undefined {
  return cache.get(fid) ?? undefined;
}
