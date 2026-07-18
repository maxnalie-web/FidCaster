/**
 * In-memory cache with Stale-While-Revalidate (SWR) support.
 *
 * SWR guarantees:
 *  1. Only ONE background refresh per key at any time - `revalidating` Map holds
 *     the in-flight Promise so concurrent requests share it, never duplicate it.
 *  2. Hard-expired entries are served as stale while a refresh is in flight -
 *     this prevents a stampede on the singleFlight below when the entry crosses
 *     the hard TTL boundary mid-refresh.
 *  3. Fresh hits (<80% TTL) are served immediately with no side effects.
 */

import { metrics } from "./metrics.js";

type Entry = { data: unknown; expiresAt: number; softExpiresAt: number };
const store = new Map<string, Entry>();

// Maps key → in-flight revalidation Promise.
// A Map (not Set) lets us share the same Promise across concurrent callers.
const revalidating = new Map<string, Promise<void>>();

export function cacheGet(key: string): unknown | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) {
    // Don't evict if a background refresh is already running -
    // serve stale data to avoid a singleFlight stampede.
    if (revalidating.has(key)) return e.data;
    store.delete(key);
    return undefined;
  }
  return e.data;
}

/**
 * Stale-While-Revalidate get.
 *
 * - Fresh  (< softExpiresAt):     return data immediately, no background work.
 * - Stale  (>= softExpiresAt):    return data immediately AND start/join one
 *                                  shared background refresh Promise per key.
 * - Absent or hard-expired with
 *   no refresh in flight:          return undefined → caller does singleFlight.
 */
export function cacheGetSWR(
  key: string,
  ttlMs: number,
  revalidateFn: () => Promise<unknown>,
): unknown | undefined {
  const e = store.get(key);
  if (!e) return undefined;

  const now = Date.now();
  const inFlight = revalidating.has(key);

  // Hard-expired: serve stale ONLY while refresh is in flight (prevents stampede)
  if (now > e.expiresAt) {
    if (inFlight) return e.data;
    store.delete(key);
    return undefined;
  }

  // Soft-expired: kick off a single shared refresh if none is running.
  // Wrapped in a 10s race-timeout so a hung Neynar call never holds the
  // revalidating lock indefinitely - the key simply stays stale until
  // the next SWR window fires a fresh attempt.
  if (now > e.softExpiresAt && !inFlight) {
    metrics.incSwrRefresh();
    const SWR_TIMEOUT_MS = 10_000;
    const raceResult = Promise.race([
      revalidateFn(),
      new Promise<undefined>((_, reject) =>
        setTimeout(() => reject(new Error("SWR timeout")), SWR_TIMEOUT_MS),
      ),
    ]);
    const p: Promise<void> = raceResult
      .then(data => { if (data !== undefined && data !== null) cacheSet(key, data, ttlMs); })
      .catch(() => { /* stale data continues serving until next success */ })
      .finally(() => revalidating.delete(key));
    revalidating.set(key, p);
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
    for (const [k, v] of store) if (now > v.expiresAt && !revalidating.has(k)) store.delete(k);
  }
}

export function cacheDelete(prefix: string): void {
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

export function cacheStats() {
  return { size: store.size, revalidating: revalidating.size };
}
