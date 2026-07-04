/**
 * Neynar rate protection — multi-key round-robin + token bucket + single-flight.
 *
 * Supply extra keys via env vars:
 *   NEYNAR_API_KEY        — primary key (always used if set)
 *   NEYNAR_API_KEY_2 … NEYNAR_API_KEY_N — additional keys
 *   NEYNAR_API_KEYS       — comma-separated list (alternative / additive)
 *
 * Three mechanisms:
 * 1. Token bucket per key — each key refills at 250 req/min (safe under 300 RPM).
 *    `neynarThrottle()` picks the key with the most tokens → natural load balancing.
 * 2. 429 backoff (`penalize429`) — drains that key's bucket + blocks it 5 s.
 * 3. Single-flight — N concurrent cache-miss requests share ONE upstream fetch.
 */

// ── Collect all configured API keys ──────────────────────────────────────────
function collectKeys(): string[] {
  const keys: string[] = [];
  const primary = process.env.NEYNAR_API_KEY;
  if (primary) keys.push(primary);

  // Both formats are supported:
  //   NEYNAR_API_KEY_2, NEYNAR_API_KEY_3  (with underscore before number)
  //   NEYNAR_API_KEY2,  NEYNAR_API_KEY3   (no underscore — common mistake)
  // Scan the whole range WITHOUT breaking on a gap — keys are often numbered with
  // holes (e.g. _16 missing but _17…_20 present); an early break would silently
  // drop every key after the first gap.
  for (let i = 2; i <= 55; i++) {
    const k = process.env[`NEYNAR_API_KEY_${i}`] ?? process.env[`NEYNAR_API_KEY${i}`];
    if (k && !keys.includes(k)) keys.push(k);
  }

  // NEYNAR_API_KEYS=key1,key2,key3
  const csv = process.env.NEYNAR_API_KEYS;
  if (csv) {
    for (const k of csv.split(",").map(s => s.trim()).filter(Boolean)) {
      if (!keys.includes(k)) keys.push(k);
    }
  }

  return keys.length > 0 ? keys : [];
}

// ── Token bucket per key ──────────────────────────────────────────────────────
const RPM = 250;
const REFILL_MS = 60_000 / RPM;   // ~240 ms per token
const MAX_QUEUE = 400;

interface Bucket {
  key: string;
  tokens: number;
  lastRefill: number;
  penaltyUntil: number;
}

let buckets: Bucket[] = [];

function initBuckets(): void {
  const keys = collectKeys();
  buckets = keys.map(key => ({ key, tokens: RPM, lastRefill: Date.now(), penaltyUntil: 0 }));
  if (buckets.length > 1) {
    console.log(`[neynar] ${buckets.length} API keys loaded — effective RPM: ${buckets.length * RPM}`);
  }
}

initBuckets();

function refillBucket(b: Bucket): void {
  const now = Date.now();
  const gained = Math.floor((now - b.lastRefill) / REFILL_MS);
  if (gained > 0) {
    b.tokens = Math.min(RPM, b.tokens + gained);
    b.lastRefill = now;
  }
}

// Round-robin cursor. The old "pick the bucket with the most tokens" strategy
// broke ties by array order, so whenever traffic was light enough for tokens to
// refill between requests (i.e. almost always) EVERY request went to buckets[0]
// — the first key carried the entire load while the rest sat idle. A rotating
// cursor spreads consecutive requests evenly across all keys regardless of token
// levels, which is what actually distributes the Neynar quota.
let _rrCursor = 0;

/** Next non-penalised bucket that has a token available, round-robin. */
function nextBucket(): Bucket | null {
  const now = Date.now();
  const n = buckets.length;
  if (n === 0) return null;
  for (let i = 0; i < n; i++) {
    const idx = (_rrCursor + i) % n;
    const b = buckets[idx];
    if (b.penaltyUntil > now) continue;
    refillBucket(b);
    if (b.tokens > 0) {
      _rrCursor = (idx + 1) % n; // advance so the next call starts after this key
      return b;
    }
  }
  return null; // every key is penalised or out of tokens right now
}

/** Call with the key that got HTTP 429 to back it off for 5 s. */
export function penalize429(key?: string): void {
  const target = key ? buckets.find(b => b.key === key) : buckets[0];
  if (!target) return;
  target.tokens = 0;
  target.penaltyUntil = Date.now() + 5_000;
}

let queueDepth = 0;

/**
 * Waits until a token is available on the best key, then returns that key string.
 * Callers must use the returned key for their Neynar request so 429s can be
 * attributed back to the right bucket via `penalize429(key)`.
 */
export function neynarThrottle(): Promise<string> {
  if (buckets.length === 0) return Promise.resolve(process.env.NEYNAR_API_KEY ?? "");
  if (queueDepth >= MAX_QUEUE) {
    return Promise.reject(new Error("Rate limit queue full · try again shortly"));
  }
  queueDepth++;
  return new Promise((resolve) => {
    const take = (): void => {
      const b = nextBucket();
      if (!b) { setTimeout(take, REFILL_MS); return; } // all keys busy → wait for a refill
      b.tokens--;
      queueDepth = Math.max(0, queueDepth - 1);
      resolve(b.key);
    };
    take();
  });
}

// ── Single-flight ─────────────────────────────────────────────────────────────
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) {
    console.log("[sf] join ", key);
    return existing as Promise<T>;
  }
  console.log("[sf] fetch", key);
  const p = fn().finally(() => {
    console.log("[sf] done ", key);
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}
