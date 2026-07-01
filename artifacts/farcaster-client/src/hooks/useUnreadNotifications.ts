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
      setUnread(count);
    } catch { /* keep last known count */ }
  }, [fid, neynarKey]);

  useEffect(() => {
    if (!fid) return;
    void refresh();
    const id = setInterval(() => void refresh(), 60_000);
    const onVis = () => { if (document.visibilityState === "visible") void refresh(); };
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
