import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getUserCasts, getUserReplies, type NeynarCast, type NeynarUser } from "@/lib/neynar";
import { CastCard } from "./CastCard";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

type Props = {
  fid: number;
  type: "posts" | "replies";
};

export function ProfilePostsPanel({ fid, type }: Props) {
  const { neynarKey } = useWallet();
  const [casts, setCasts] = useState<NeynarCast[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [, navigate] = useLocation();

  function goToProfile(user: NeynarUser) { navigate(`/profile/${user.fid}`); }

  const load = useCallback(async (cur?: string) => {
    const isFirst = !cur;
    if (isFirst) setLoading(true);
    else setLoadingMore(true);
    try {
      const fn = type === "posts" ? getUserCasts : getUserReplies;
      const res = await fn(fid, fid, neynarKey, cur);
      setCasts((prev) => (isFirst ? res.casts : [...prev, ...res.casts]));
      setCursor(res.next?.cursor);
    } catch { /* ignore */ }
    finally {
      if (isFirst) setLoading(false);
      else setLoadingMore(false);
    }
  }, [fid, type, neynarKey]);

  useEffect(() => {
    setCasts([]);
    setCursor(undefined);
    load();
  }, [load]);

  const sentinelRef = useInfiniteScroll(() => { if (cursor) load(cursor); }, !!cursor, loadingMore);

  return (
    <div>
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : casts.length === 0 ? (
        <div className="py-12 text-center text-sm text-muted-foreground">
          {type === "posts" ? "No casts yet" : "No replies yet"}
        </div>
      ) : (
        <>
          {casts.map((cast) => (
            <CastCard
              key={cast.hash}
              cast={cast}
              viewerFid={fid}
              onViewProfile={goToProfile}
            />
          ))}
          {cursor && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
