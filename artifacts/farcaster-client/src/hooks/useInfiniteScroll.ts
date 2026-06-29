import { useCallback, useEffect, useRef, type RefObject } from "react";

/**
 * Infinite-scroll sentinel hook (robust, callback-ref based).
 *
 * Returns a ref callback to attach to a sentinel element at the end of the list.
 * The observer is (re)attached the moment the sentinel node mounts, and fires
 * `onLoadMore` whenever the sentinel is visible AND there's more AND we're not
 * already loading — all read from refs so the check is always current.
 *
 * When a page finishes loading we re-check: if the sentinel is *still* visible
 * (long lists, fast scroll), we immediately load the next page. This is what
 * makes it keep loading through thousands of items instead of stalling after a
 * page or two.
 *
 * `rootRef` — pass the scrollable container when the list lives inside an
 * `overflow-y-auto` element (modal/sheet); otherwise the viewport is used.
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

  const intersectingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const maybeFire = useCallback(() => {
    if (intersectingRef.current && hasMoreRef.current && !loadingRef.current) {
      cbRef.current();
    }
  }, []);

  // When a load finishes, the sentinel may still be on-screen → load the next page.
  useEffect(() => {
    if (loading) return;
    const id = setTimeout(maybeFire, 50);
    return () => clearTimeout(id);
  }, [loading, hasMore, maybeFire]);

  // Callback ref: (re)wire the observer whenever the sentinel node mounts/unmounts.
  const sentinelRef = useCallback(
    (node: HTMLElement | null) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      intersectingRef.current = false;
      if (!node) return;
      const obs = new IntersectionObserver(
        (entries) => {
          intersectingRef.current = entries[0].isIntersecting;
          if (entries[0].isIntersecting) maybeFire();
        },
        { root: rootRef?.current ?? null, rootMargin: "800px 0px" }
      );
      obs.observe(node);
      observerRef.current = obs;
    },
    [maybeFire, rootRef]
  );

  return sentinelRef;
}
