/**
 * Neynar rate protection — guarantees the server never trips Neynar's per-key
 * rate limit, even with many concurrent users.
 *
 * Three mechanisms:
 *
 * 1. Token bucket (`neynarThrottle`) — the registered key allows ~300 req/min.
 *    We refill at a safe 250/min. A request with no token WAITS in line instead
 *    of being sent, so Neynar never returns HTTP 429. Queue is capped so excess
 *    requests are shed fast rather than piling up memory indefinitely.
 *
 * 2. 429 backoff (`penalize429`) — if Neynar somehow returns 429, drain the
 *    token bucket and block all outgoing requests for 5 seconds. Prevents
 *    cascading retries from making the situation worse.
 *
 * 3. Single-flight (`singleFlight`) — if 1000 users request the same uncached
 *    resource at once, only ONE request goes to Neynar; the other 999 await the
 *    same in-flight promise. This collapses traffic spikes into a burst of 1.
 */

// ── Token bucket ──────────────────────────────────────────────────────────────
const RPM = 250;                       // safety margin under the 300 RPM key limit
const REFILL_MS = 60_000 / RPM;        // ms to regenerate one token (~240ms)
const MAX_QUEUE = 150;                 // drop requests rather than queue unboundedly
let tokens = RPM;
let lastRefill = Date.now();
let penaltyUntil = 0;                  // epoch ms — all requests block until this
let queueDepth = 0;

function refill(): void {
  const now = Date.now();
  const gained = Math.floor((now - lastRefill) / REFILL_MS);
  if (gained > 0) {
    tokens = Math.min(RPM, tokens + gained);
    lastRefill = now;
  }
}

/** Call whenever Neynar returns HTTP 429 to impose a back-off. */
export function penalize429(): void {
  tokens = 0;
  penaltyUntil = Date.now() + 5_000;
}

export function neynarThrottle(): Promise<void> {
  if (queueDepth >= MAX_QUEUE) {
    return Promise.reject(new Error("Rate limit queue full — try again shortly"));
  }
  queueDepth++;
  return new Promise((resolve) => {
    const take = (): void => {
      const now = Date.now();
      if (now < penaltyUntil) {
        setTimeout(take, penaltyUntil - now + 50);
        return;
      }
      refill();
      if (tokens > 0) {
        tokens--;
        queueDepth = Math.max(0, queueDepth - 1);
        resolve();
      } else {
        setTimeout(take, REFILL_MS);
      }
    };
    take();
  });
}

// ── Single-flight ─────────────────────────────────────────────────────────────
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
