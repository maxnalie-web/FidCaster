/**
 * Lazy profile hydration for the Grow fast path.
 *
 * The hub fast-scan returns bare FIDs (no usernames/pfps/counts). This module
 * fills profiles in on demand through /api/fc/farcaster/user/bulk · which is
 * SQLite-cached server-side (12h, shared across all users) · so a list of
 * 5,000 stub rows costs zero Neynar calls until rows actually become visible,
 * and repeat lookups are served from the DB.
 *
 * Two entry points:
 *  - hydrateProfiles(fids): imperative, awaits all chunks. Used by smart-sort,
 *    which needs follower counts before it can rank candidates.
 *  - useHydratedUser(fid, enabled): per-row hook, coalesces every request made
 *    within 50ms into one bulk call (same pattern as useProStatus).
 *
 * NOTE: profiles served from the shared SQLite cache carry no viewer_context —
 * callers must preserve the viewer_context they computed from the hub link sets.
 */
import { useState, useEffect } from "react";
import type { NeynarUser } from "./neynar";

const cache = new Map<number, NeynarUser>();
const pending = new Set<number>();
const waiters = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function fetchChunk(fids: number[]): Promise<void> {
  try {
    const q = new URLSearchParams({ fids: fids.join(",") });
    const r = await fetch(`/api/fc/farcaster/user/bulk?${q}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const ct = r.headers.get("content-type") ?? "";
    if (!r.ok || !ct.includes("application/json")) return;
    const data = await r.json() as { users?: NeynarUser[] };
    for (const u of data.users ?? []) {
      if (u?.fid) cache.set(u.fid, u);
    }
  } catch { /* leave uncached · rows keep their stub placeholder */ }
}

async function flush(): Promise<void> {
  flushTimer = null;
  const fids = Array.from(pending);
  pending.clear();
  for (let i = 0; i < fids.length; i += 100) {
    await fetchChunk(fids.slice(i, i + 100));
  }
  waiters.forEach(w => w());
}

/** Await profiles for all given FIDs (chunked ×100). Returns the cache map. */
export async function hydrateProfiles(fids: number[]): Promise<Map<number, NeynarUser>> {
  const missing = fids.filter(f => f > 0 && !cache.has(f));
  for (let i = 0; i < missing.length; i += 100) {
    await fetchChunk(missing.slice(i, i + 100));
  }
  return cache;
}

/** Synchronous cache read · for callers that already ran hydrateProfiles. */
export function getHydrated(fid: number): NeynarUser | undefined {
  return cache.get(fid);
}

/** Per-row hook: batched hydration for a single FID, re-renders when resolved. */
export function useHydratedUser(fid: number, enabled: boolean): NeynarUser | undefined {
  const [, force] = useState(0);

  useEffect(() => {
    if (!enabled || fid <= 0 || cache.has(fid)) return;
    const rerender = () => force(n => n + 1);
    waiters.add(rerender);
    pending.add(fid);
    if (!flushTimer) flushTimer = setTimeout(() => { void flush(); }, 50);
    return () => { waiters.delete(rerender); };
  }, [fid, enabled]);

  return enabled ? cache.get(fid) : undefined;
}
