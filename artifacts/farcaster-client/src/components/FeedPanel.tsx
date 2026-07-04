import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, RefreshCw, ChevronDown, Plus, Settings2, Rss } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getFollowingFeed, getTrendingFeed, getFeedByFids, searchCasts, type NeynarCast, type NeynarUser } from "@/lib/neynar";
import { getCachedFeed, setCachedFeed } from "@/lib/farcaster-db";
import { getCustomFeeds, syncCustomFeedsFromServer, matchesKeywords, matchesAuthorFilters, prefetchSpamLabels, type CustomFeed } from "@/lib/custom-feeds";
import { CastCard } from "./CastCard";
import { CustomFeedBuilderSheet } from "./CustomFeedBuilderSheet";
import { cn } from "@/lib/utils";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

type FeedTab = "home" | "following" | "custom";

// Module-level (survives unmount) so opening a cast then pressing back restores
// exactly where the reader left off, instead of DashboardPage remounting a fresh
// FeedPanel and dropping them back at the top of a freshly re-fetched feed.
// Keyed by a string (not just FeedTab) so each individual custom feed also gets
// its own independent cache slot: "home" | "following" | "custom:<feedId>".
const _feedCache: Record<string, { casts: NeynarCast[]; cursor?: string; scrollY: number }> = {};

export function FeedPanel() {
  const { fid, neynarKey } = useWallet();
  const fidNum = fid ? Number(fid) : 0;
  const [, navigate] = useLocation();

  const [feedTab, setFeedTab] = useState<FeedTab>("home");
  const [customFeeds, setCustomFeeds] = useState<CustomFeed[]>([]);
  const [activeCustomFeedId, setActiveCustomFeedId] = useState<string | null>(null);
  const [showFeedMenu, setShowFeedMenu] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingFeed, setEditingFeed] = useState<CustomFeed | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeCustomFeed = customFeeds.find((f) => f.id === activeCustomFeedId) ?? null;
  const cacheKey = feedTab === "custom" ? `custom:${activeCustomFeedId ?? ""}` : feedTab;

  const initialCache = _feedCache[cacheKey];
  const [casts, setCasts] = useState<NeynarCast[]>(() => initialCache?.casts ?? []);
  const [cursor, setCursor] = useState<string | undefined>(() => initialCache?.cursor);
  const [loading, setLoading] = useState(() => !initialCache);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generation counter · increments on every fresh load so stale in-flight
  // responses from previous renders can be ignored before they overwrite state.
  const genRef = useRef(0);
  // Tracks scroll position continuously (cheap ref write, no re-render) so it can
  // be captured the instant this component unmounts (e.g. navigating to a cast).
  const scrollYRef = useRef(typeof window !== "undefined" ? window.scrollY : 0);
  const skipNextResetRef = useRef(!!initialCache); // true on the very first mount if we restored from cache

  useEffect(() => {
    if (!fidNum) return;
    // Instant paint from whatever's cached locally, then reconcile with the
    // server copy · a feed built on another browser/device under the same
    // account shows up here too instead of only ever living in this one
    // browser's localStorage.
    const localFeeds = getCustomFeeds(fidNum);
    setCustomFeeds(localFeeds);
    if (!activeCustomFeedId && localFeeds.length > 0) setActiveCustomFeedId(localFeeds[0].id);
    syncCustomFeedsFromServer(fidNum).then((feeds) => {
      setCustomFeeds(feeds);
      if (!activeCustomFeedId && feeds.length > 0) setActiveCustomFeedId(feeds[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fidNum]);

  useEffect(() => {
    if (!showFeedMenu) return;
    function onOut(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowFeedMenu(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [showFeedMenu]);

  // Restore scroll position once, right after a cache-restored mount paints.
  useEffect(() => {
    if (initialCache) window.scrollTo(0, initialCache.scrollY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a live ref of scroll position (cheap; avoids re-rendering on every scroll tick).
  useEffect(() => {
    const onScroll = () => { scrollYRef.current = window.scrollY; };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Persist state for this tab so a remount (leaving via a cast/profile link and
  // coming back) can restore it instead of starting the feed over from scratch.
  useEffect(() => {
    return () => {
      _feedCache[cacheKey] = { casts, cursor, scrollY: scrollYRef.current };
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, casts, cursor]);

  function goToProfile(user: NeynarUser) { navigate(`/profile/${user.fid}`); }

  const loadFeed = useCallback(async (tab: FeedTab, cur?: string): Promise<{ casts: NeynarCast[]; next?: { cursor: string } } | undefined> => {
    if (tab === "home") return getTrendingFeed(fidNum, neynarKey, cur);
    if (tab === "following") {
      if (!fidNum) return;
      return getFollowingFeed(fidNum, neynarKey, cur);
    }
    // Custom feed · accounts and keywords each independently pick the base pool
    // of casts to pull from; when neither is set, the account/score/follower/
    // spam-label filters apply on top of the trending pool instead of an
    // empty feed, since "just filter everyone by score" is a valid feed too.
    const feed = customFeeds.find((f) => f.id === activeCustomFeedId);
    if (!feed) return { casts: [] };
    let res: { casts: NeynarCast[]; next?: { cursor: string } };
    if (feed.accountFids.length > 0) {
      res = await getFeedByFids(feed.accountFids, fidNum, neynarKey, cur);
    } else if (feed.keywords.length > 0) {
      const r = await searchCasts(feed.keywords.join(" "), fidNum, neynarKey, cur);
      res = { casts: r.result?.casts ?? [], next: r.result?.next?.cursor ? { cursor: r.result.next.cursor } : undefined };
    } else {
      res = await getTrendingFeed(fidNum, neynarKey, cur);
    }
    if (feed.accountFids.length > 0 && feed.keywords.length > 0) {
      res = { ...res, casts: res.casts.filter((c) => matchesKeywords(c.text || "", feed.keywords)) };
    }
    if (feed.minNeynarScore > 0 || feed.minFollowers > 0 || feed.spamLabel !== "any") {
      if (feed.spamLabel !== "any") await prefetchSpamLabels(res.casts.map((c) => c.author.fid));
      res = { ...res, casts: res.casts.filter((c) => matchesAuthorFilters(c.author, feed)) };
    }
    return res;
  }, [fidNum, neynarKey, customFeeds, activeCustomFeedId]);

  const refresh = useCallback(async (tab: FeedTab, isManual = false) => {
    const gen = ++genRef.current;
    if (isManual) setRefreshing(true);
    setError(null);
    try {
      const data = await loadFeed(tab);
      if (gen !== genRef.current) return;
      if (data) {
        setCasts(data.casts);
        setCursor(data.next?.cursor);
        if (tab === "following") setCachedFeed(fidNum, data.casts, data.next?.cursor).catch(() => {});
      }
    } catch (e: unknown) {
      if (gen !== genRef.current) return;
      setError(e instanceof Error ? e.message : "Failed to load feed");
    } finally {
      if (gen !== genRef.current) return;
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadFeed, fidNum]);

  useEffect(() => {
    // Coming back from a cast/profile via the browser back button remounts this
    // whole panel (DashboardPage unmounts on route change) · if we just restored
    // its exact prior state from _feedCache, keep showing that instead of
    // wiping it and re-fetching, which used to look like "back always dumps you
    // at the top of a brand-new feed" no matter where you actually were reading.
    if (skipNextResetRef.current) {
      skipNextResetRef.current = false;
      return;
    }
    if (feedTab === "following" && !fidNum) return;
    if (feedTab === "custom" && !activeCustomFeedId) return;
    setLoading(true);
    setCasts([]);
    setCursor(undefined);
    setError(null);

    if (feedTab === "following") {
      getCachedFeed(fidNum).then((cached) => {
        if (cached && cached.casts.length > 0) {
          setCasts(cached.casts as NeynarCast[]);
          setCursor(cached.cursor);
          setLoading(false);
          refresh("following", false);
        } else {
          refresh("following", false);
        }
      }).catch(() => refresh("following", false));
    } else {
      refresh(feedTab, false);
    }
  }, [fidNum, feedTab, activeCustomFeedId, refresh]);

  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await loadFeed(feedTab, cursor);
      if (data) { setCasts((prev) => [...prev, ...data.casts]); setCursor(data.next?.cursor); }
    } catch {}
    finally { setLoadingMore(false); }
  }

  const sentinelRef = useInfiniteScroll(loadMore, !!cursor, loadingMore);

  function selectCustomFeed(id: string) {
    setActiveCustomFeedId(id);
    setFeedTab("custom");
    setShowFeedMenu(false);
  }

  function openNewFeed() {
    setEditingFeed(null);
    setShowBuilder(true);
    setShowFeedMenu(false);
  }

  function openEditFeed(feed: CustomFeed) {
    setEditingFeed(feed);
    setShowBuilder(true);
    setShowFeedMenu(false);
  }

  function handleFeedSaved(feed: CustomFeed) {
    setShowBuilder(false);
    if (fidNum) setCustomFeeds(getCustomFeeds(fidNum));
    setActiveCustomFeedId(feed.id);
    setFeedTab("custom");
  }

  function handleFeedDeleted(id: string) {
    setShowBuilder(false);
    if (!fidNum) return;
    const remaining = getCustomFeeds(fidNum);
    setCustomFeeds(remaining);
    if (activeCustomFeedId === id) {
      const next = remaining[0]?.id ?? null;
      setActiveCustomFeedId(next);
      if (!next) setFeedTab("home");
    }
  }

  return (
    <div>
      {/* Home / Following / Custom tabs */}
      <div className="flex items-center sticky top-0 md:top-0 bg-background/95 backdrop-blur z-10 border-b border-border/40">
        <button
          onClick={() => setFeedTab("home")}
          className={cn("feed-tab", feedTab === "home" && "active")}
        >
          Home
        </button>
        <button
          onClick={() => setFeedTab("following")}
          className={cn("feed-tab", feedTab === "following" && "active")}
        >
          Following
        </button>

        {/* Single custom-feed slot · additional feeds live behind the dropdown, not more tabs */}
        <div className="relative flex-1 min-w-0" ref={menuRef}>
          <button
            onClick={() => {
              if (customFeeds.length === 0) { openNewFeed(); return; }
              setShowFeedMenu((v) => !v);
            }}
            className={cn("feed-tab flex items-center gap-1 max-w-full", feedTab === "custom" && "active")}
          >
            {customFeeds.length === 0 ? (
              <><Plus className="w-3 h-3 shrink-0" /> Custom</>
            ) : (
              <>
                {activeCustomFeed?.logoUrl ? (
                  <span className="w-3.5 h-3.5 rounded-[4px] overflow-hidden shrink-0 bg-muted">
                    <img src={activeCustomFeed.logoUrl} alt="" className="w-full h-full object-cover" />
                  </span>
                ) : (
                  <Rss className="w-3 h-3 shrink-0" />
                )}
                <span className="truncate">{activeCustomFeed?.name ?? "Custom"}</span>
                <ChevronDown className="w-3 h-3 shrink-0" />
              </>
            )}
          </button>

          {showFeedMenu && customFeeds.length > 0 && (
            <div className="absolute top-full right-0 mt-1 z-30 bg-popover border border-border rounded-xl shadow-2xl w-[220px] max-w-[calc(100vw-24px)] py-1 overflow-hidden">
              {customFeeds.map((f) => (
                <div key={f.id} className="flex items-center group">
                  <button
                    onClick={() => selectCustomFeed(f.id)}
                    className={cn(
                      "flex-1 flex items-center gap-2 text-left px-3.5 py-2.5 text-sm truncate transition-colors",
                      f.id === activeCustomFeedId ? "text-primary font-semibold" : "text-foreground hover:bg-accent"
                    )}
                  >
                    {f.logoUrl ? (
                      <span className="w-5 h-5 rounded-md overflow-hidden shrink-0 bg-muted">
                        <img src={f.logoUrl} alt="" className="w-full h-full object-cover" />
                      </span>
                    ) : (
                      <Rss className="w-3.5 h-3.5 shrink-0 opacity-60" />
                    )}
                    <span className="truncate">{f.name}</span>
                  </button>
                  <button
                    onClick={() => openEditFeed(f)}
                    className="p-2 mr-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 group-hover:opacity-100"
                    title="Edit feed"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              <div className="my-1 border-t border-border" />
              <button
                onClick={openNewFeed}
                className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm font-semibold text-primary hover:bg-accent transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> New feed
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => refresh(feedTab, true)}
          disabled={refreshing}
          className="px-3 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 rounded-full my-2 mr-2 shrink-0"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {feedTab === "custom" && activeCustomFeed && (() => {
        const parts: string[] = [];
        if (activeCustomFeed.accountFids.length > 0) parts.push(`${activeCustomFeed.accountFids.length} account${activeCustomFeed.accountFids.length === 1 ? "" : "s"}`);
        if (activeCustomFeed.keywords.length > 0) parts.push(`keywords: ${activeCustomFeed.keywords.join(", ")}`);
        if (activeCustomFeed.minNeynarScore > 0) parts.push(`score ≥ ${activeCustomFeed.minNeynarScore}`);
        if (activeCustomFeed.minFollowers > 0) parts.push(`followers ≥ ${activeCustomFeed.minFollowers.toLocaleString()}`);
        if (activeCustomFeed.spamLabel !== "any") parts.push(activeCustomFeed.spamLabel === "not-spam" ? "not spam" : "spam only");
        return (
          <button
            onClick={() => openEditFeed(activeCustomFeed)}
            className="w-full flex items-center gap-1.5 px-4 py-2 text-[11px] text-muted-foreground hover:text-foreground bg-muted/10 border-b border-border/40 transition-colors"
          >
            <Settings2 className="w-3 h-3 shrink-0" />
            <span className="truncate">{parts.join(" · ") || "No filters set"}</span>
            <span className="ml-auto shrink-0 text-primary">Edit</span>
          </button>
        );
      })()}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Loading casts…</p>
          </div>
        </div>
      ) : error ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-sm text-muted-foreground">{error}</p>
          <button onClick={() => refresh(feedTab, true)} className="text-xs text-primary hover:underline">Retry</button>
        </div>
      ) : casts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-2 px-6 text-center">
          <p className="text-sm font-medium text-foreground/60">No casts yet</p>
          <p className="text-xs text-muted-foreground">
            {feedTab === "following"
              ? "Follow people to see their casts here"
              : feedTab === "custom"
                ? activeCustomFeed
                  ? "Nothing matches this feed's filters yet"
                  : "Build a custom feed from accounts, keywords, score, or followers"
                : "Trending casts will appear here"}
          </p>
        </div>
      ) : (
        <>
          {casts.map((cast) => (
            <CastCard key={cast.hash} cast={cast} viewerFid={fidNum} onViewProfile={goToProfile} />
          ))}
          {cursor && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />}
            </div>
          )}
        </>
      )}

      {showBuilder && (
        <CustomFeedBuilderSheet
          existing={editingFeed}
          onClose={() => setShowBuilder(false)}
          onSaved={handleFeedSaved}
          onDeleted={handleFeedDeleted}
        />
      )}
    </div>
  );
}
