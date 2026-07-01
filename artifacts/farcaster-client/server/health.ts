/**
 * System Health Guard
 *
 * Derives a "degraded" signal from live metrics so the /internal/metrics
 * endpoint can surface it and operators can act before users notice.
 *
 * Thresholds (from ChatGPT review — practical values for 10K-user load):
 *   hub fail rate  > 20%   →  hubs unreachable or severely throttled
 *   cache hit ratio < 70%  →  cache is cold/evicting too fast
 *   sqlite queue peak > 400 → approaching MAX_QUEUE (500), flush pressure high
 */

import { metrics } from "./metrics.js";
import { poolStats } from "./sign-pool.js";

export interface HealthSnapshot {
  degraded: boolean;
  reasons: string[];
  signing_pool: { workers: number; pending: number; available: boolean };
}

export function healthSnapshot(): HealthSnapshot {
  const snap = metrics.snapshot();
  const reasons: string[] = [];

  // Hub failure rate
  const hubTotal = snap.hub.direct_success + snap.hub.relay_fallback + snap.hub.fail;
  const failRate  = hubTotal > 10 ? snap.hub.fail / hubTotal : 0;
  if (failRate > 0.2) reasons.push(`hub_fail_rate=${(failRate * 100).toFixed(1)}%`);

  // Cache hit ratio (only meaningful after warm-up)
  const cacheTotal = snap.cache.hits + snap.cache.misses;
  const hitRatio   = cacheTotal > 50 ? snap.cache.hits / cacheTotal : 1;
  if (hitRatio < 0.7) reasons.push(`cache_hit_ratio=${(hitRatio * 100).toFixed(1)}%`);

  // SQLite write queue pressure
  if (snap.sqlite.queue_peak > 400) reasons.push(`sqlite_queue_peak=${snap.sqlite.queue_peak}`);

  return {
    degraded: reasons.length > 0,
    reasons,
    signing_pool: poolStats(),
  };
}
