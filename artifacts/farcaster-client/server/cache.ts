type Entry = { data: unknown; expiresAt: number };
const store = new Map<string, Entry>();

export function cacheGet(key: string): unknown | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expiresAt) { store.delete(key); return undefined; }
  return e.data;
}

export function cacheSet(key: string, data: unknown, ttlMs: number): void {
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
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
