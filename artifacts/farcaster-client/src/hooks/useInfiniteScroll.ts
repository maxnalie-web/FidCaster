import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Infinite-scroll hook driven by a real scroll listener (not just an
 * IntersectionObserver).
 *
 * Why a scroll listener: the sentinel lives *inside* an overflow container, and
 * wiring an observer through a ref proved fragile — during commit the sentinel's
 * ref attaches before its parent container's ref, so the observer ended up with
 * the wrong root and silently stopped firing after a page or two. A scroll
 * listener attached in an effect (when all refs are guaranteed set) is reliable.
 *
 * It fires `onLoadMore` whenever the user nears the bottom AND there's more AND
 * we're not already loading. After each load it re-checks, so short content or a
 * fast flick keeps paging all the way to the end.
 *
 * `rootRef` — the scrollable container for in-sheet lists; omit it for lists that
 * scroll the page/window (notifications, thread replies).
 *
 * Returns a ref to place on a trailing sentinel element (kept for layout/compat).
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  hasMore: boolean,
  loading: boolean,
  rootRef?: RefObject<HTMLElement | null>
) {
  const cbRef = useRef(onLoadMore);
  cbRef.current = onLoadMore;
  const hasMoreRef = useRef(hasMore);
  hasMoreRef.current = hasMore;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const sentinelRef = useRef<HTMLDivElement>(null);

  const THRESHOLD = 1200; // px from bottom at which we prefetch the next page

  const check = useCallback(() => {
    if (!hasMoreRef.current || loadingRef.current) return;
    const root = rootRef?.current;
    let remaining: number;
    if (root) {
      remaining = root.scrollHeight - root.scrollTop - root.clientHeight;
    } else {
      const d = document.documentElement;
      remaining = d.scrollHeight - window.scrollY - d.clientHeight;
    }
    if (remaining < THRESHOLD) cbRef.current();
  }, [rootRef]);

  // Attach the scroll/resize listener. Re-runs when `hasMore` first flips true
  // (i.e. the first page has loaded and the container is definitely mounted), so
  // the listener always lands on the real scroll target.
  useEffect(() => {
    const target: HTMLElement | Window = rootRef?.current ?? window;
    const onScroll = () => check();
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    check(); // content may already be short enough to need another page
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [rootRef, check, hasMore]);

  // After a load finishes, re-check: the sentinel may still be in view.
  useEffect(() => {
    if (loading) return;
    const id = setTimeout(check, 60);
    return () => clearTimeout(id);
  }, [loading, hasMore, check]);

  return sentinelRef;
}
