// Neynar API key pool · up to 80 keys stored in localStorage and round-robined
// for bulk scan operations (cast cleanup, purge) so each sequential page fetch
// uses a different key, effectively eliminating rate-limit bottlenecks.
//
// GET requests through the normal neynar() path go through the server proxy
// and don't use client keys. Pool keys are only used by directNeynarGet() for
// high-volume cleanup scans where raw throughput matters.

const POOL_STORAGE = "fc_neynar_pool_v1";

let _pool: string[] = [];
let _idx = 0;
let _ready = false;

function ensureLoaded() {
  if (_ready) return;
  _ready = true;
  try {
    const raw = localStorage.getItem(POOL_STORAGE);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      _pool = parsed.filter((k): k is string => typeof k === "string" && k.trim().length > 8).map(k => k.trim());
    }
  } catch { /* storage unavailable */ }
}

/** Read the current pool from localStorage (sorted deduped). */
export function loadPool(): string[] {
  ensureLoaded();
  return [..._pool];
}

/** Persist a new pool (replaces old one). Empty strings and short tokens are filtered. */
export function savePool(keys: string[]) {
  const clean = [...new Set(keys.map(k => k.trim()).filter(k => k.length > 8))];
  _pool = clean;
  _idx = 0;
  _ready = true;
  try { localStorage.setItem(POOL_STORAGE, JSON.stringify(clean)); } catch { /* quota */ }
}

/** Return the next key in round-robin order. Falls back to `primary` when pool is empty. */
export function nextKey(primary: string): string {
  ensureLoaded();
  if (_pool.length === 0) return primary;
  const key = _pool[_idx % _pool.length];
  _idx = (_idx + 1) % _pool.length;
  return key;
}

/** How many keys are in the pool (0 = pool not configured). */
export function poolSize(): number {
  ensureLoaded();
  return _pool.length;
}
