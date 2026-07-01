import { useState, useEffect, useCallback, useRef } from "react";
import { getNotifications } from "@/lib/neynar";

/**
 * Tracks the number of notifications newer than the last time the user opened
 * the Notifications tab. Drives the red badge on the bell.
 *
 * Cost-free w.r.t. Neynar: it reuses `/api/farcaster/notifications`, which is
 * cached server-side for 60s, and only polls once a minute (plus on tab focus).
 */
const SEEN_KEY = (fid: number) => `fc:notif-seen:${fid}`;

export function useUnreadNotifications(fid: number, neynarKey: string) {
  const [unread, setUnread] = useState(0);
  const seenRef = useRef<number>(0);
  // Newest notification timestamp seen from the server on the last refresh.
  // Marking "seen" pins to THIS (server time) instead of the client clock, so
  // clock skew can't leave the badge stuck after a reload.
  const latestTsRef = useRef<number>(0);

  // Load the persisted "last seen" timestamp for this account.
  useEffect(() => {
    if (!fid) { setUnread(0); return; }
    const raw = localStorage.getItem(SEEN_KEY(fid));
    seenRef.current = raw ? Number(raw) || 0 : 0;
  }, [fid]);

  const refresh = useCallback(async () => {
    if (!fid) return;
    try {
      const data = await getNotifications(fid, neynarKey);
      let latest = 0;
      let count = 0;
      for (const n of data.notifications ?? []) {
        const t = Date.parse(n.most_recent_timestamp ?? n.timestamp ?? "") || 0;
        if (t > latest) latest = t;
        if (t > seenRef.current) count++;
      }
      latestTsRef.current = latest;

      // First-ever load on this device (no stored cursor) — auto-catch-up so
      // notifications already seen on another device don't light up the badge.
      // Only NEW notifications that arrive after this first load will count.
      if (seenRef.current === 0 && latest > 0) {
        seenRef.current = latest;
        try { localStorage.setItem(SEEN_KEY(fid), String(latest)); } catch { /* ignore */ }
        setUnread(0);
      } else {
        setUnread(count);
      }
    } catch { /* keep last known count */ }
  }, [fid, neynarKey]);

  // Track last successful fetch time to avoid hammering the API on tab switches.
  const lastFetchAt = useRef<number>(0);

  useEffect(() => {
    if (!fid) return;
    void refresh();
    lastFetchAt.current = Date.now();
    // Poll every 5 min — matches the 5-min server-side cache TTL.
    // No point polling faster than the cache expires.
    const id = setInterval(() => {
      void refresh();
      lastFetchAt.current = Date.now();
    }, 300_000);
    // On tab focus: only re-fetch if the last fetch was > 4 min ago.
    const onVis = () => {
      if (document.visibilityState === "visible" && Date.now() - lastFetchAt.current > 240_000) {
        void refresh();
        lastFetchAt.current = Date.now();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [fid, refresh]);

  // Call when the user opens the Notifications tab — clears the badge.
  // Pin to the newest notification's server timestamp (fallback: client clock),
  // so the badge stays cleared across reloads and account switches.
  const markSeen = useCallback(() => {
    if (!fid) return;
    const mark = latestTsRef.current || Date.now();
    seenRef.current = mark;
    try { localStorage.setItem(SEEN_KEY(fid), String(mark)); } catch { /* ignore */ }
    setUnread(0);
  }, [fid]);

  return { unread, markSeen };
}
