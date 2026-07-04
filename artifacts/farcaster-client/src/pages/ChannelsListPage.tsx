import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { ArrowLeft, Search, Loader2, Hash, ChevronRight, Users } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { searchChannels, type NeynarChannel } from "@/lib/neynar";
import { getFollowedChannels, type FollowedChannel } from "@/lib/channel-follows";
import { formatCompactCount } from "@/lib/utils";

function Row({ id, name, image_url, follower_count, onOpen }: {
  id: string; name: string; image_url?: string; follower_count: number; onOpen: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onOpen(id)}
      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors text-left"
    >
      <div className="w-10 h-10 rounded-xl overflow-hidden bg-primary/10 shrink-0 ring-1 ring-border">
        {image_url ? <img src={image_url} alt="" className="w-full h-full object-cover" />
          : <span className="w-full h-full flex items-center justify-center text-sm font-bold text-primary">{name?.[0]?.toUpperCase()}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{name}</p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Hash className="w-2.5 h-2.5" />{id} · <Users className="w-2.5 h-2.5" />{formatCompactCount(follower_count)}
        </p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

export function ChannelsListPage() {
  const [, navigate] = useLocation();
  const { fid, neynarKey } = useWallet();
  const myFid = fid ? Number(fid) : 0;

  const [followed, setFollowed] = useState<FollowedChannel[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NeynarChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (myFid) setFollowed(getFollowedChannels(myFid)); }, [myFid]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchChannels(query, neynarKey ?? "");
        setResults(res.channels);
      } catch { setResults([]); }
      finally { setLoading(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, neynarKey]);

  function goToChannel(id: string) { navigate(`/channel/${id}`); }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-background/96 backdrop-blur-xl border-b border-border">
        <div className="max-w-[600px] mx-auto h-14 flex items-center gap-3 px-4">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-2 -ml-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="font-bold text-[15px] text-foreground flex-1">Channels</h1>
        </div>
        <div className="max-w-[600px] mx-auto px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Discover channels…"
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-border bg-muted/20 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 transition-all"
            />
          </div>
        </div>
      </header>

      <div className="max-w-[600px] mx-auto border-x border-border min-h-screen pb-24">
        {query.trim() ? (
          loading ? (
            <div className="flex justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : results.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">No channels found</div>
          ) : (
            results.map((c) => <Row key={c.id} id={c.id} name={c.name} image_url={c.image_url} follower_count={c.follower_count} onOpen={goToChannel} />)
          )
        ) : (
          <>
            <div className="px-4 py-2.5 border-b border-border bg-muted/10">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                My channels ({followed.length})
              </span>
            </div>
            {followed.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground px-6 text-center">
                <Hash className="w-10 h-10 opacity-15" />
                <p className="text-sm">You haven't followed any channels yet.</p>
                <p className="text-[12px] text-muted-foreground/70">Search above to discover and follow channels.</p>
              </div>
            ) : (
              followed.map((c) => <Row key={c.id} id={c.id} name={c.name} image_url={c.image_url} follower_count={c.follower_count} onOpen={goToChannel} />)
            )}
          </>
        )}
      </div>
    </div>
  );
}
