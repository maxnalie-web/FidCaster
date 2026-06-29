/**
 * Neynar rate protection — guarantees the server never trips Neynar's per-key
 * rate limit, even with many concurrent users.
 *
 * Two mechanisms:
 *
 * 1. Token bucket (`neynarThrottle`) — the registered key allows ~300 req/min.
 *    We refill tokens at a safe 250/min. A request with no token available WAITS
 *    in line instead of being sent, so Neynar never returns HTTP 429 — the user
 *    sees at most a small delay, never a rate-limit error.
 *
 * 2. Single-flight (`singleFlight`) — if 1000 users request the same uncached
 *    resource at once, only ONE request goes to Neynar; the other 999 await the
 *    same in-flight promise. This collapses traffic spikes into a trickle.
 */

// ── Token bucket ──────────────────────────────────────────────────────────────
const RPM = 250;                         // safety margin under the 300 RPM key limit
const REFILL_MS = 60_000 / RPM;          // ms to regenerate one token (~240ms)
let tokens = RPM;
let lastRefill = Date.now();

function refill(): void {
  const now = Date.now();
  const gained = Math.floor((now - lastRefill) / REFILL_MS);
  if (gained > 0) {
    tokens = Math.min(RPM, tokens + gained);
    lastRefill = now;
  }
}

export function neynarThrottle(): Promise<void> {
  return new Promise((resolve) => {
    const take = (): void => {
      refill();
      if (tokens > 0) {
        tokens--;
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
