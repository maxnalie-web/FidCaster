import { useEffect, useRef, type RefObject } from "react";

/**
 * Infinite-scroll sentinel hook.
 *
 * Re-creates the IntersectionObserver whenever `hasMore`/`loading` change, so
 * that when a page finishes loading and the sentinel is *still* in view, the
 * observer fires again and the next page loads — i.e. it keeps loading until
 * the list is exhausted, not just for one page.
 *
 * An in-flight ref guards against the callback firing twice before the parent's
 * `loading` state has had a chance to flip, which previously caused two pages to
 * load at once and the scroll position to jump.
 *
 * `rootRef` — pass the scrollable container element when the list scrolls inside
 * an `overflow-y-auto` div (e.g. a modal/sheet) rather than the page itself.
 * Without it the observer watches the viewport and stops firing once the
 * sentinel is clipped inside the container.
 */
export function useInfiniteScroll(
  onLoadMore: () => void,
  hasMore: boolean,
  loading: boolean,
  rootRef?: RefObject<HTMLElement | null>
) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onLoadMore);
  callbackRef.current = onLoadMore;
  const inFlightRef = useRef(false);

  // Reset the in-flight guard once the parent reports it's no longer loading.
  useEffect(() => {
    if (!loading) inFlightRef.current = false;
  }, [loading]);

  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        if (inFlightRef.current) return;
        inFlightRef.current = true;
        callbackRef.current();
      },
      { root: rootRef?.current ?? null, rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
    // rootRef.current is read inside; re-run when it becomes available via hasMore/loading churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading]);

  return sentinelRef;
}
