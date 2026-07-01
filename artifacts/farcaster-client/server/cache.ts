/**
 * In-memory cache with Stale-While-Revalidate (SWR) support.
 *
 * SWR pattern: when a cache entry passes its soft-expiry (80% of TTL),
 * `cacheGetSWR` triggers a background revalidation while still serving the
 * (slightly stale) cached value immediately — eliminating the latency spike
 * that occurs when hot cache keys expire under high concurrency.
 *
 * Hard-expire (cacheGet) still clears entries at full TTL, used for paths
 * that always need fresh data or that manage their own singleFlight.
 */

type Entry = { data: unknown; expiresAt: number; softExpiresAt: number };
const store = new Map<string, Entry>();
const revalidating = new Set<string>();

export function cacheGet(key: string): unknown | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) { store.delete(key); return undefined; }
  return e.data;
}

/**
 * Stale-While-Revalidate get.
 *
 * - Fresh (< softExpiresAt):     return data immediately.
 * - Soft-expired (past 80% TTL): return stale data immediately AND kick off
 *   revalidateFn in the background (once per key, not per request).
 * - Hard-expired (past 100% TTL): purge and return undefined (cache miss).
 *
 * revalidateFn must return the fresh value to store; throw to abort revalidation.
 */
export function cacheGetSWR(
  key: string,
  ttlMs: number,
  revalidateFn: () => Promise<unknown>,
): unknown | undefined {
  const e = store.get(key);
  if (!e) return undefined;

  const now = Date.now();
  if (now > e.expiresAt) { store.delete(key); return undefined; }

  // Soft-expired — serve stale data and refresh in background (once)
  if (now > e.softExpiresAt && !revalidating.has(key)) {
    revalidating.add(key);
    revalidateFn()
      .then(data => { if (data !== undefined && data !== null) cacheSet(key, data, ttlMs); })
      .catch(() => { /* ignore refresh errors — stale data keeps serving */ })
      .finally(() => revalidating.delete(key));
  }

  return e.data;
}

export function cacheSet(key: string, data: unknown, ttlMs: number): void {
  store.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
    softExpiresAt: Date.now() + Math.floor(ttlMs * 0.8),
  });
  // Evict expired entries when store grows large
  if (store.size > 20_000) {
    const now = Date.now();
    for (const [k, v] of store) if (now > v.expiresAt) store.delete(k);
  }
}

export function cacheDelete(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

export function cacheStats() {
  return { size: store.size };
}
