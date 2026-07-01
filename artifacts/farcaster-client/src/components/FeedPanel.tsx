import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, RefreshCw } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getFollowingFeed, getTrendingFeed, type NeynarCast, type NeynarUser } from "@/lib/neynar";
import { getCachedFeed, setCachedFeed } from "@/lib/farcaster-db";
import { CastCard } from "./CastCard";
import { cn } from "@/lib/utils";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

type FeedTab = "home" | "following";

export function FeedPanel() {
  const { fid, neynarKey } = useWallet();
  const fidNum = fid ? Number(fid) : 0;
  const [, navigate] = useLocation();

  const [feedTab, setFeedTab] = useState<FeedTab>("home");
  const [casts, setCasts] = useState<NeynarCast[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generation counter · increments on every fresh load so stale in-flight
  // responses from previous renders can be ignored before they overwrite state.
  const genRef = useRef(0);

  function goToProfile(user: NeynarUser) { navigate(`/profile/${user.fid}`); }

  const loadFeed = useCallback(async (tab: FeedTab, cur?: string) => {
    if (tab === "home") return getTrendingFeed(fidNum, neynarKey, cur);
    if (!fidNum) return;
    return getFollowingFeed(fidNum, neynarKey, cur);
  }, [fidNum, neynarKey]);

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
    if (feedTab === "following" && !fidNum) return;
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
  }, [fidNum, feedTab, refresh]);

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

  return (
    <div>
      {/* Home / Following tabs */}
      <div className="flex sticky top-0 md:top-0 bg-background/95 backdrop-blur z-10 border-b border-border/40">
        {(["home", "following"] as FeedTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFeedTab(tab)}
            className={cn("feed-tab", feedTab === tab && "active")}
          >
            {tab === "home" ? "Home" : "Following"}
          </button>
        ))}
        <button
          onClick={() => refresh(feedTab, true)}
          disabled={refreshing}
          className="px-3 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40 rounded-full my-2 mr-2"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

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
        <div className="flex flex-col items-center justify-center py-20 gap-2">
          <p className="text-sm font-medium text-foreground/60">No casts yet</p>
          <p className="text-xs text-muted-foreground">
            {feedTab === "following" ? "Follow people to see their casts here" : "Trending casts will appear here"}
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
    </div>
  );
}
