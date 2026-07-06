import { useState, useEffect, useRef } from "react";
import { X, Search, Loader2 } from "lucide-react";
import { searchCasts, type NeynarCast, type NeynarUser } from "@/lib/neynar";
import { CastCard } from "@/components/CastCard";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

/** Full-screen search over one profile's own casts (search results are scoped
 *  to author_fid · this is NOT a general cast search). */
export function ProfileCastSearchSheet({
  authorFid, viewerFid, neynarKey, onClose, onViewProfile,
}: {
  authorFid: number;
  viewerFid: number;
  neynarKey: string;
  onClose: () => void;
  onViewProfile: (u: NeynarUser) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NeynarCast[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); setCursor(undefined); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchCasts(query, viewerFid, neynarKey, undefined, authorFid);
        setResults(res.result.casts);
        setCursor(res.result.next?.cursor);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
        setSearched(true);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, viewerFid, neynarKey, authorFid]);

  async function loadMore() {
    if (!cursor || loadingMore || !query.trim()) return;
    setLoadingMore(true);
    try {
      const res = await searchCasts(query, viewerFid, neynarKey, cursor, authorFid);
      setResults((prev) => {
        const seen = new Set(prev.map((c) => c.hash));
        return [...prev, ...res.result.casts.filter((c) => !seen.has(c.hash))];
      });
      setCursor(res.result.next?.cursor);
    } catch { /* keep showing what we have */ }
    finally { setLoadingMore(false); }
  }

  const sentinelRef = useInfiniteScroll(loadMore, !!cursor, loadingMore);

  return (
    <div className="fixed inset-0 z-[80] bg-background flex flex-col">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border bg-background/95 backdrop-blur-sm">
        <button onClick={onClose} className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0">
          <X className="w-5 h-5" />
        </button>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={authorFid === viewerFid ? "Search your casts…" : "Search this profile's casts…"}
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-border bg-muted/20 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 transition-all"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto pb-24">
        {!query.trim() ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
            <Search className="w-8 h-8 opacity-20" />
            <p className="text-sm">Search {authorFid === viewerFid ? "your" : "their"} casts</p>
          </div>
        ) : loading && results.length === 0 ? (
          <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
        ) : results.length === 0 && searched ? (
          <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
            <Search className="w-8 h-8 opacity-20" />
            <p className="text-sm">No matching casts</p>
          </div>
        ) : (
          <>
            {results.map((c) => (
              <CastCard key={c.hash} cast={c} viewerFid={viewerFid} onViewProfile={onViewProfile} compact />
            ))}
            {cursor && (
              <div ref={sentinelRef} className="flex justify-center py-6">
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
