import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

/**
 * Farcaster "Pro" detection ($10/mo subscription) WITHOUT Neynar.
 * Resolved via the server's /api/pro-status, which reads
 * `profile.accountLevel === "pro"` from api.farcaster.xyz and caches it.
 *
 * A module-level cache dedupes lookups across every component on the page so a
 * feed full of casts only ever asks for each fid once.
 */
const proCache = new Map<number, boolean>();
const pending = new Set<number>();
const waiters = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

// Coalesce every lookup requested within 50ms into a single batched request,
// so a whole feed resolves Pro status in one round-trip instead of one per card.
function flush() {
  flushTimer = null;
  const fids = Array.from(pending);
  pending.clear();
  if (fids.length === 0) return;
  void (async () => {
    for (let i = 0; i < fids.length; i += 100) {
      const chunk = fids.slice(i, i + 100);
      try {
        const r = await fetch(`/api/pro-status?fids=${chunk.join(",")}`, { headers: { accept: "application/json" } });
        const map: Record<string, boolean> = r.ok ? await r.json() : {};
        for (const f of chunk) proCache.set(f, !!map[f]);
      } catch {
        for (const f of chunk) if (!proCache.has(f)) proCache.set(f, false);
      }
    }
    waiters.forEach((w) => w());
  })();
}

export function useProStatus(fids: number[]): Record<number, boolean> {
  const [, force] = useState(0);
  const key = Array.from(new Set(fids.filter((f) => f > 0))).sort((a, b) => a - b).join(",");

  useEffect(() => {
    const rerender = () => force((n) => n + 1);
    waiters.add(rerender);
    const need = (key ? key.split(",").map(Number) : []).filter((f) => !proCache.has(f));
    if (need.length) {
      need.forEach((f) => pending.add(f));
      if (!flushTimer) flushTimer = setTimeout(flush, 50);
    }
    return () => { waiters.delete(rerender); };
  }, [key]);

  const out: Record<number, boolean> = {};
  for (const f of fids) if (f > 0) out[f] = proCache.get(f) ?? false;
  return out;
}

export function useIsPro(fid: number | undefined): boolean {
  const map = useProStatus(fid ? [fid] : []);
  return fid ? !!map[fid] : false;
}

/**
 * The official Farcaster Pro badge — a violet scalloped "seal" with a white
 * check, matching the badge shown in the Farcaster client exactly.
 */
export function ProBadge({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={cn("inline-block shrink-0 align-middle", className)}
      role="img"
      aria-label="Farcaster Pro"
    >
      <title>Farcaster Pro</title>
      {/* Scalloped verified seal */}
      <path
        fill="#7c5cff"
        d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81c-.66-1.31-1.91-2.19-3.34-2.19s-2.68.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91c-1.31.66-2.19 1.91-2.19 3.34s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.66 1.31 1.91 2.19 3.34 2.19s2.68-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.66 2.19-1.91 2.19-3.34z"
      />
      {/* White check */}
      <path
        d="M8 12.2l2.7 2.7L16 9.4"
        fill="none"
        stroke="#fff"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
