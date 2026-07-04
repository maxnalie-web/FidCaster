import { useState, useEffect, useRef } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Loader2, Hash, Users, Check, Plus, ShieldCheck, ExternalLink, PenSquare } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getChannel, getChannelFeed, type NeynarChannel, type NeynarCast, type NeynarUser } from "@/lib/neynar";
import { CastCard } from "@/components/CastCard";
import { CastComposer } from "@/components/CastComposer";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { isChannelFollowed, followChannel, unfollowChannel } from "@/lib/channel-follows";
import { cn } from "@/lib/utils";

export function ChannelPage() {
  const [, params] = useRoute("/channel/:id");
  const [, navigate] = useLocation();
  const { fid, neynarKey } = useWallet();
  const viewerFid = fid ? Number(fid) : 0;
  const id = params?.id ?? "";

  const [channel, setChannel] = useState<NeynarChannel | null>(null);
  const [casts, setCasts] = useState<NeynarCast[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const loadedIdRef = useRef<string>("");

  useEffect(() => {
    // Wait for the wallet's own fid to be ready · fetching with viewer_fid=0
    // before the session finishes restoring is rejected by the API outright.
    if (!id || !viewerFid || loadedIdRef.current === id) return;
    loadedIdRef.current = id;
    setLoading(true);
    setError(null);
    Promise.all([
      getChannel(id, neynarKey),
      getChannelFeed(id, viewerFid, neynarKey),
    ])
      .then(([chRes, feedRes]) => {
        setChannel(chRes.channel);
        setCasts(feedRes.casts);
        setCursor(feedRes.next?.cursor);
        if (viewerFid) setFollowing(isChannelFollowed(viewerFid, chRes.channel.id));
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load channel"))
      .finally(() => setLoading(false));
  }, [id, viewerFid, neynarKey]);

  function toggleFollow() {
    if (!channel || !viewerFid) return;
    if (following) { unfollowChannel(viewerFid, channel.id); setFollowing(false); }
    else { followChannel(viewerFid, channel); setFollowing(true); }
  }

  const isOwner = viewerFid > 0 && channel?.lead?.fid === viewerFid;

  async function loadMore() {
    if (!cursor || loadingMore || !id) return;
    setLoadingMore(true);
    try {
      const res = await getChannelFeed(id, viewerFid, neynarKey, cursor);
      setCasts((prev) => {
        const seen = new Set(prev.map((c) => c.hash));
        return [...prev, ...res.casts.filter((c) => !seen.has(c.hash))];
      });
      setCursor(res.next?.cursor);
    } catch {}
    finally { setLoadingMore(false); }
  }

  function goToProfile(user: NeynarUser) { navigate(`/profile/${user.fid}`); }

  const sentinelRef = useInfiniteScroll(loadMore, !!cursor, loadingMore);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 bg-background/96 backdrop-blur-xl border-b border-border">
        <div className="max-w-[600px] mx-auto h-14 flex items-center gap-3 px-4">
          <button
            onClick={() => window.history.back()}
            className="p-2 -ml-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-base text-foreground flex-1 truncate">
            {channel ? channel.name : "Channel"}
          </span>
        </div>
      </header>

      <div className="max-w-[600px] mx-auto border-x border-border min-h-screen pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading channel…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button onClick={() => window.history.back()} className="text-sm text-primary hover:underline">Go back</button>
          </div>
        ) : channel ? (
          <>
            {channel.header_image_url && (
              <div className="h-32 w-full overflow-hidden bg-primary/10">
                <img src={channel.header_image_url} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="px-4 py-4 border-b border-border">
              <div className="flex items-start gap-3">
                <div className="w-14 h-14 rounded-2xl overflow-hidden bg-primary/10 shrink-0 -mt-8 ring-4 ring-background">
                  {channel.image_url ? (
                    <img src={channel.image_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-lg font-bold text-primary">
                      {channel.name?.[0]?.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-base font-bold text-foreground truncate">{channel.name}</p>
                    {isOwner && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-primary/10 text-primary border border-primary/20">
                        <ShieldCheck className="w-2.5 h-2.5" /> Owner
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Hash className="w-3 h-3" />{channel.id}
                  </p>
                </div>
                <button
                  onClick={toggleFollow}
                  className={cn(
                    "shrink-0 flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold transition-all",
                    following
                      ? "border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40"
                      : "btn-luxury text-primary-foreground"
                  )}
                >
                  {following ? <><Check className="w-3.5 h-3.5" /> Following</> : <><Plus className="w-3.5 h-3.5" /> Follow</>}
                </button>
              </div>
              {channel.description && (
                <p className="text-sm text-foreground/80 mt-3">{channel.description}</p>
              )}
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Users className="w-3.5 h-3.5" />
                  <span>{channel.follower_count.toLocaleString()} followers</span>
                </div>
                <button
                  onClick={() => setShowComposer((v) => !v)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                >
                  <PenSquare className="w-3.5 h-3.5" /> Cast here
                </button>
              </div>
              {isOwner && (
                <a
                  href={`https://farcaster.xyz/~/channel/${channel.id}`}
                  target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 mt-3 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ExternalLink className="w-3 h-3" /> Manage channel settings on Farcaster
                </a>
              )}
            </div>

            {showComposer && (
              <div className="border-b border-border">
                <CastComposer
                  defaultChannel={{ id: channel.id, name: channel.name, image_url: channel.image_url, follower_count: channel.follower_count, url: channel.url }}
                  onPublished={(c) => { setCasts((prev) => [c, ...prev]); setShowComposer(false); }}
                  onCanceled={() => setShowComposer(false)}
                  placeholder={`Cast in /${channel.id}…`}
                />
              </div>
            )}

            {casts.length > 0 ? (
              <>
                {casts.map((c) => (
                  <CastCard key={c.hash} cast={c} viewerFid={viewerFid} onViewProfile={goToProfile} compact />
                ))}
                {cursor && (
                  <div ref={sentinelRef} className="flex justify-center py-6">
                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <Hash className="w-8 h-8 opacity-20" />
                <p className="text-sm">No casts yet</p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
