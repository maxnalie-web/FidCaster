import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Loader2, MessageCircle, User } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getCastConversation, type NeynarCast, type NeynarUser } from "@/lib/neynar";
import { CastCard } from "@/components/CastCard";
import { CastComposer } from "@/components/CastComposer";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { cn } from "@/lib/utils";

export function ThreadPage() {
  const [, params] = useRoute("/cast/:hash");
  const [, navigate] = useLocation();
  const { fid, neynarKey, profile, signerApproved, localSigner } = useWallet();
  const viewerFid = fid ? Number(fid) : 0;
  const hash = params?.hash ?? "";

  const [cast, setCast] = useState<NeynarCast | null>(null);
  const [replies, setReplies] = useState<NeynarCast[]>([]);
  const [repliesCursor, setRepliesCursor] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showComposer, setShowComposer] = useState(false);
  const [highlightHash, setHighlightHash] = useState<string>("");
  const composerRef = useRef<HTMLDivElement>(null);

  // Extract target reply hash from URL fragment (#0xabc...)
  const targetHash = typeof window !== "undefined" ? window.location.hash.slice(1) : "";

  const canWrite = signerApproved && Boolean(localSigner) && Boolean(fid);

  useEffect(() => {
    if (!hash) return;
    setLoading(true);
    setError(null);
    getCastConversation(hash, viewerFid, neynarKey)
      .then((res) => {
        setCast(res.conversation.cast);
        // Show only direct (top-level) replies · nested replies are accessible by clicking each reply
        setReplies(res.conversation.cast.direct_replies ?? []);
        setRepliesCursor(res.next?.cursor);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load thread"))
      .finally(() => setLoading(false));
  }, [hash, viewerFid, neynarKey]);

  async function loadMoreReplies() {
    if (!repliesCursor || loadingMore || !hash) return;
    setLoadingMore(true);
    try {
      const res = await getCastConversation(hash, viewerFid, neynarKey, repliesCursor);
      const more = res.conversation.cast.direct_replies ?? [];
      setReplies((prev) => {
        const seen = new Set(prev.map((r) => r.hash));
        return [...prev, ...more.filter((r) => !seen.has(r.hash))];
      });
      setRepliesCursor(res.next?.cursor);
    } catch {}
    finally { setLoadingMore(false); }
  }

  // After replies render, scroll to and highlight the target reply
  const scrollToReply = useCallback(() => {
    if (!targetHash) return;
    const el = document.getElementById(`reply-${targetHash}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightHash(targetHash);
      // Remove highlight after 2.5s
      setTimeout(() => setHighlightHash(""), 2500);
    }
  }, [targetHash]);

  useEffect(() => {
    if (!loading && cast && targetHash) {
      const t = setTimeout(scrollToReply, 150);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [loading, cast, targetHash, scrollToReply]);

  function handlePublished(newCast: NeynarCast) {
    setReplies((prev) => [newCast, ...prev]);
    setShowComposer(false);
  }

  function goToProfile(user: NeynarUser) {
    navigate(`/profile/${user.fid}`);
  }

  const repliesSentinelRef = useInfiniteScroll(loadMoreReplies, !!repliesCursor, loadingMore);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/96 backdrop-blur-xl border-b border-border">
        <div className="max-w-[600px] mx-auto h-14 flex items-center gap-3 px-4">
          <button
            onClick={() => window.history.back()}
            className="p-2 -ml-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-base text-foreground flex-1">Conversation</span>
        </div>
      </header>

      <div className="max-w-[600px] mx-auto border-x border-border min-h-screen pb-24">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading conversation…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button onClick={() => window.history.back()} className="text-sm text-primary hover:underline">Go back</button>
          </div>
        ) : cast ? (
          <>
            {/* Main cast · expanded view */}
            <div className="border-b border-border">
              <CastCard cast={cast} viewerFid={viewerFid} onViewProfile={goToProfile} expanded />
            </div>

            {/* Reply composer · inline below main cast */}
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-center gap-3">
                {/* Viewer avatar */}
                <div className="w-9 h-9 shrink-0 rounded-full overflow-hidden bg-primary/10 flex items-center justify-center ring-1 ring-border/50">
                  {profile?.pfpUrl ? (
                    <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <User className="w-4 h-4 text-primary/60" />
                  )}
                </div>
                <button
                  onClick={() => setShowComposer(true)}
                  className="flex-1 text-left text-[0.9375rem] text-muted-foreground/60 py-2"
                >
                  {cast ? `Reply to @${cast.author.username}…` : "Cast your reply…"}
                </button>
                {canWrite && (
                  <button
                    onClick={() => setShowComposer(true)}
                    className="px-4 py-1.5 rounded-full text-sm font-semibold bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
                  >
                    Reply
                  </button>
                )}
              </div>
            </div>

            {/* Full composer overlay (when opened) */}
            {showComposer && (
              <div ref={composerRef}>
                <CastComposer
                  replyTo={cast}
                  onPublished={handlePublished}
                  onCanceled={() => setShowComposer(false)}
                  placeholder={`Reply to @${cast.author.username}…`}
                />
              </div>
            )}

            {/* Replies */}
            {replies.length > 0 ? (
              <>
                <div className="px-4 py-2.5 border-b border-border bg-muted/20">
                  <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                    {replies.length} {replies.length === 1 ? "Reply" : "Replies"}
                    {cast?.replies?.count && cast.replies.count > replies.length
                      ? ` of ${cast.replies.count}` : ""}
                  </span>
                </div>
                {replies.map((r) => (
                  <div
                    key={r.hash}
                    id={`reply-${r.hash}`}
                    className={cn(
                      "transition-colors duration-700",
                      highlightHash === r.hash && "bg-primary/8"
                    )}
                  >
                    <CastCard cast={r} viewerFid={viewerFid} onViewProfile={goToProfile} compact />
                  </div>
                ))}
                {repliesCursor && (
                  <div ref={repliesSentinelRef} className="flex justify-center py-6">
                    {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <MessageCircle className="w-8 h-8 opacity-20" />
                <p className="text-sm">No replies yet</p>
                <p className="text-xs opacity-60">Be the first to reply</p>
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
