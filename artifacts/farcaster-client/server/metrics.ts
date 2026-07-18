/**
 * Lightweight in-memory metrics.
 * Exposed at GET /internal/metrics (server-side only, not proxied).
 * All counters are simple integers - no external dependency.
 */

const startedAt = Date.now();

const c = {
  cacheHits: 0,
  cacheMisses: 0,
  swrRefreshes: 0,
  hubDirect: 0,   // browser submitted directly to public hub (success)
  hubRelay: 0,    // server relay used (fallback)
  hubFail: 0,     // all paths failed
  sqliteQueuePeak: 0,
};

export const metrics = {
  incCacheHit()           { c.cacheHits++; },
  incCacheMiss()          { c.cacheMisses++; },
  incSwrRefresh()         { c.swrRefreshes++; },
  incHubDirect()          { c.hubDirect++; },
  incHubRelay()           { c.hubRelay++; },
  incHubFail()            { c.hubFail++; },
  updateSqliteQueue(n: number) { if (n > c.sqliteQueuePeak) c.sqliteQueuePeak = n; },

  snapshot() {
    const total = c.cacheHits + c.cacheMisses;
    return {
      uptime_s: Math.floor((Date.now() - startedAt) / 1000),
      cache: {
        hits: c.cacheHits,
        misses: c.cacheMisses,
        hit_ratio: total === 0 ? "n/a" : (c.cacheHits / total).toFixed(3),
        swr_refreshes: c.swrRefreshes,
      },
      hub: {
        direct_success: c.hubDirect,
        relay_fallback: c.hubRelay,
        fail: c.hubFail,
        total: c.hubDirect + c.hubRelay + c.hubFail,
      },
      sqlite: {
        queue_peak: c.sqliteQueuePeak,
      },
    };
  },
};
