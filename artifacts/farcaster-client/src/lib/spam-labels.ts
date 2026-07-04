/**
 * Real Farcaster spam labels (github.com/merkle-team/labels), fetched from
 * our own server (server/spam-labels.ts caches the ~1M-row dataset in
 * SQLite) · NOT derived from Neynar's `score` field, which is a different,
 * proprietary metric. Per the dataset's README: 0 = likely spammy,
 * 2 = unlikely spammy, 3 = nerfed for malicious activity. A FID absent from
 * the response is "unknown" (not enough data), not automatically clean.
 */

export type SpamLabelValue = 0 | 2 | 3;

const cache = new Map<number, SpamLabelValue | null>();

export async function getSpamLabelsFor(fids: number[]): Promise<Record<number, SpamLabelValue>> {
  const result: Record<number, SpamLabelValue> = {};
  const misses: number[] = [];
  for (const fid of fids) {
    const hit = cache.get(fid);
    if (hit !== undefined) { if (hit !== null) result[fid] = hit; continue; }
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
        if (label !== undefined) result[fid] = label;
      }
    }
  } catch { /* leave misses unresolved this round · treated as unknown */ }
  return result;
}

/** Synchronous read of whatever's already cached, for render-time filtering after a prefetch. */
export function getCachedSpamLabel(fid: number): SpamLabelValue | undefined {
  return cache.get(fid) ?? undefined;
}
