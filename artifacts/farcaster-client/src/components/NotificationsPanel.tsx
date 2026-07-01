import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, Heart, Repeat2, MessageCircle, UserPlus, Bell, User, Quote } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { getNotifications, type NeynarNotification, type NeynarUser } from "@/lib/neynar";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useProStatus, ProBadge } from "./ProBadge";

type SortMode = "newest" | "oldest" | "pro";

function notifPrimaryFid(n: FlatNotif): number {
  if (n.kind === "follow-group") return n.users[0]?.fid ?? 0;
  if (n.kind === "like" || n.kind === "recast") return n.reactor.fid;
  return n.author.fid;
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

type FlatNotif =
  | { kind: "follow-group"; id: string; ts: string; users: NeynarUser[] }
  | { kind: "like"; id: string; ts: string; reactor: NeynarUser; castText: string; castHash?: string }
  | { kind: "recast"; id: string; ts: string; reactor: NeynarUser; castText: string; castHash?: string }
  | { kind: "reply"; id: string; ts: string; author: NeynarUser; text: string; castHash: string }
  | { kind: "mention"; id: string; ts: string; author: NeynarUser; text: string; castHash: string }
  | { kind: "quote"; id: string; ts: string; author: NeynarUser; text: string; castHash: string };

function flattenNotifications(notifs: NeynarNotification[]): FlatNotif[] {
  const result: FlatNotif[] = [];
  for (const n of notifs) {
    const ts = n.most_recent_timestamp ?? n.timestamp ?? "";
    if (n.type === "follows" && n.follows?.length) {
      result.push({ kind: "follow-group", id: `follows-${ts}-${n.follows[0].user.fid}`, ts, users: n.follows.map((f) => f.user) });
    } else if ((n.type === "likes" || n.type === "recasts") && n.reactions?.length) {
      const isLike = n.type === "likes";
      for (const r of n.reactions) {
        const castObj = r.cast ?? n.cast;
        result.push({
          kind: isLike ? "like" : "recast",
          id: `${n.type}-${castObj?.hash ?? ts}-${r.user.fid}`,
          ts,
          reactor: r.user,
          castText: castObj?.text ?? "",
          castHash: castObj?.hash,
        });
      }
    } else if ((n.type === "reply" || n.type === "mention" || n.type === "quote") && n.cast) {
      result.push({
        kind: n.type === "reply" ? "reply" : n.type === "quote" ? "quote" : "mention",
        id: `${n.type}-${n.cast.hash}`,
        ts,
        author: n.cast.author,
        text: n.cast.text ?? "",
        castHash: n.cast.hash,
      });
    }
  }
  return result;
}

function Avatar({ user, size = 10, onClick }: { user: NeynarUser; size?: number; onClick?: () => void }) {
  const cls = `w-${size} h-${size} rounded-full overflow-hidden bg-primary/10 flex items-center justify-center shrink-0`;
  const inner = user.pfp_url ? (
    <img src={user.pfp_url} alt={user.display_name} className="w-full h-full object-cover"
      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
  ) : (
    <User className="w-4 h-4 text-primary/50" />
  );
  if (onClick) {
    return (
      <button onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={cn(cls, "hover:ring-2 hover:ring-primary/30 transition-all")}>
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

const MAX_SHOWN = 5;

function FollowGroupRow({ n, navigate, proMap }: { n: Extract<FlatNotif, { kind: "follow-group" }>; navigate: (p: string) => void; proMap: Record<number, boolean> }) {
  const shown = n.users.slice(0, MAX_SHOWN);
  const extra = n.users.length - shown.length;
  return (
    <div className="flex items-start gap-3 px-4 py-4 hover:bg-accent/20 transition-colors cursor-default">
      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-sky-500/12 mt-0.5">
        <UserPlus className="w-4.5 h-4.5 text-sky-500" strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex gap-1 flex-wrap mb-2">
          {shown.map((u, i) => (
            <div key={u.fid} className={cn("relative", i > 0 && "")}>
              <Avatar user={u} size={9} onClick={() => navigate(`/profile/${u.fid}`)} />
            </div>
          ))}
          {extra > 0 && (
            <div className="w-9 h-9 rounded-full bg-muted border border-border flex items-center justify-center text-[10px] font-bold text-muted-foreground">
              +{extra}
            </div>
          )}
        </div>
        <p className="text-sm text-foreground leading-snug">
          {n.users.length === 1 ? (
            <>
              <button onClick={() => navigate(`/profile/${n.users[0].fid}`)} className="font-semibold hover:text-primary transition-colors">{n.users[0].display_name}</button>
              {proMap[n.users[0].fid] && <ProBadge size={12} className="ml-0.5 inline-block" />}
              <span className="text-muted-foreground"> followed you</span>
            </>
          ) : n.users.length === 2 ? (
            <>
              <button onClick={() => navigate(`/profile/${n.users[0].fid}`)} className="font-semibold hover:text-primary transition-colors">{n.users[0].display_name}</button>
              {proMap[n.users[0].fid] && <ProBadge size={12} className="ml-0.5 inline-block" />}
              <span className="text-muted-foreground"> and </span>
              <button onClick={() => navigate(`/profile/${n.users[1].fid}`)} className="font-semibold hover:text-primary transition-colors">{n.users[1].display_name}</button>
              {proMap[n.users[1].fid] && <ProBadge size={12} className="ml-0.5 inline-block" />}
              <span className="text-muted-foreground"> followed you</span>
            </>
          ) : (
            <>
              <button onClick={() => navigate(`/profile/${n.users[0].fid}`)} className="font-semibold hover:text-primary transition-colors">{n.users[0].display_name}</button>
              {proMap[n.users[0].fid] && <ProBadge size={12} className="ml-0.5 inline-block" />}
              <span className="text-muted-foreground"> and {n.users.length - 1} others followed you</span>
            </>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground/70 mt-0.5">{timeAgo(n.ts)}</p>
      </div>
    </div>
  );
}

function ReactionRow({ n, navigate, proMap }: { n: Extract<FlatNotif, { kind: "like" | "recast" }>; navigate: (p: string) => void; proMap: Record<number, boolean> }) {
  const isLike = n.kind === "like";
  return (
    <div
      onClick={() => { if (n.castHash) navigate(`/cast/${n.castHash}`); }}
      className={cn("flex items-start gap-3 px-4 py-4 hover:bg-accent/20 transition-colors", n.castHash && "cursor-pointer")}
    >
      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-0.5", isLike ? "bg-rose-500/10" : "bg-emerald-500/10")}>
        {isLike
          ? <Heart className="w-4.5 h-4.5 text-rose-500 fill-current" />
          : <Repeat2 className="w-4.5 h-4.5 text-emerald-500" strokeWidth={2} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Avatar user={n.reactor} size={8} onClick={() => navigate(`/profile/${n.reactor.fid}`)} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground leading-snug">
              <button onClick={(e) => { e.stopPropagation(); navigate(`/profile/${n.reactor.fid}`); }} className="font-semibold hover:text-primary transition-colors">
                {n.reactor.display_name}
              </button>
              {proMap[n.reactor.fid] && <ProBadge size={13} className="ml-0.5 inline-block" />}
              <span className="text-muted-foreground">{isLike ? " liked your cast" : " recasted your cast"}</span>
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground/70 shrink-0">{timeAgo(n.ts)}</span>
        </div>
        {n.castText && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 leading-relaxed border-l-2 border-border">
            {n.castText.slice(0, 100)}{n.castText.length > 100 ? "…" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function ConversationRow({ n, navigate, proMap }: { n: Extract<FlatNotif, { kind: "reply" | "mention" | "quote" }>; navigate: (p: string) => void; proMap: Record<number, boolean> }) {
  const isQuote = n.kind === "quote";
  const isMention = n.kind === "mention";
  const Icon = isQuote ? Quote : MessageCircle;
  const label = n.kind === "reply" ? "replied to you" : isQuote ? "quoted your cast" : "mentioned you";
  const iconColor = isQuote ? "text-violet-500" : isMention ? "text-amber-500" : "text-primary";
  const iconBg = isQuote ? "bg-violet-500/10" : isMention ? "bg-amber-500/10" : "bg-primary/10";

  return (
    <div onClick={() => navigate(`/cast/${n.castHash}`)}
      className="flex items-start gap-3 px-4 py-4 hover:bg-accent/20 transition-colors cursor-pointer">
      <div className={cn("w-10 h-10 rounded-full flex items-center justify-center shrink-0 mt-0.5", iconBg)}>
        <Icon className={cn("w-4.5 h-4.5", iconColor)} strokeWidth={2} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Avatar user={n.author} size={8} onClick={() => navigate(`/profile/${n.author.fid}`)} />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground leading-snug">
              <button onClick={(e) => { e.stopPropagation(); navigate(`/profile/${n.author.fid}`); }} className="font-semibold hover:text-primary transition-colors">
                {n.author.display_name}
              </button>
              {proMap[n.author.fid] && <ProBadge size={13} className="ml-0.5 inline-block" />}
              <span className="text-muted-foreground"> {label}</span>
            </p>
          </div>
          <span className="text-[11px] text-muted-foreground/70 shrink-0">{timeAgo(n.ts)}</span>
        </div>
        {n.text && (
          <p className="text-xs text-muted-foreground bg-muted/40 rounded-lg px-3 py-2 leading-relaxed border-l-2 border-border">
            {n.text.slice(0, 120)}{n.text.length > 120 ? "…" : ""}
          </p>
        )}
      </div>
    </div>
  );
}

function NotifRow({ n, navigate, proMap }: { n: FlatNotif; navigate: (p: string) => void; proMap: Record<number, boolean> }) {
  if (n.kind === "follow-group") return <FollowGroupRow n={n} navigate={navigate} proMap={proMap} />;
  if (n.kind === "like" || n.kind === "recast") return <ReactionRow n={n} navigate={navigate} proMap={proMap} />;
  if (n.kind === "reply" || n.kind === "mention" || n.kind === "quote") return <ConversationRow n={n} navigate={navigate} proMap={proMap} />;
  return null;
}

type FilterTab = "all" | "reactions" | "replies" | "follows";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reactions", label: "Reactions" },
  { id: "replies", label: "Replies" },
  { id: "follows", label: "Follows" },
];

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: "newest", label: "New" },
  { id: "oldest", label: "Old" },
  { id: "pro", label: "Pro" },
];

export function NotificationsPanel() {
  const { fid, neynarKey } = useWallet();
  const [, navigate] = useLocation();
  const fidNum = fid ? Number(fid) : 0;

  const [allFlat, setAllFlat] = useState<FlatNotif[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [sort, setSort] = useState<SortMode>("newest");
  const lastCursorRef = useRef<string | undefined>(undefined);
  const lastFetchTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!fidNum) return;
    setLoading(true);
    setError(null);
    setAllFlat([]);
    setCursor(undefined);
    lastCursorRef.current = undefined;
    lastFetchTimeRef.current = Date.now();
    getNotifications(fidNum, neynarKey)
      .then((data) => {
        setAllFlat(flattenNotifications(data.notifications));
        setCursor(data.next?.cursor);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [fidNum, neynarKey]);

  async function loadMoreFromApi() {
    if (!cursor || loadingMore || !fidNum) return;
    if (lastCursorRef.current === cursor) return;
    const now = Date.now();
    if (now - lastFetchTimeRef.current < 5_000) return;
    lastCursorRef.current = cursor;
    lastFetchTimeRef.current = now;
    setLoadingMore(true);
    try {
      const data = await getNotifications(fidNum, neynarKey, cursor);
      setAllFlat((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...flattenNotifications(data.notifications).filter((p) => !seen.has(p.id))];
      });
      setCursor(data.next?.cursor);
    } catch { /* ignore */ } finally {
      setLoadingMore(false);
    }
  }

  const filtered = allFlat.filter((n) => {
    if (filter === "reactions") return n.kind === "like" || n.kind === "recast";
    if (filter === "replies") return n.kind === "reply" || n.kind === "mention" || n.kind === "quote";
    if (filter === "follows") return n.kind === "follow-group";
    return true;
  });

  const proMap = useProStatus(filtered.map(notifPrimaryFid));

  const sorted = [...filtered].sort((a, b) => {
    if (sort === "pro") {
      const ap = proMap[notifPrimaryFid(a)] ? 1 : 0;
      const bp = proMap[notifPrimaryFid(b)] ? 1 : 0;
      if (ap !== bp) return bp - ap;
    }
    const at = Date.parse(a.ts) || 0;
    const bt = Date.parse(b.ts) || 0;
    return sort === "oldest" ? at - bt : bt - at;
  });

  const autoLoadedForFilterRef = useRef<string>("");
  useEffect(() => {
    if (filtered.length >= 8 || loading || loadingMore || !cursor) return;
    if (autoLoadedForFilterRef.current === filter) return;
    autoLoadedForFilterRef.current = filter;
    loadMoreFromApi();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, filtered.length, loading, loadingMore, cursor]);

  const hasMoreApi = !!cursor;
  const sentinelRef = useInfiniteScroll(loadMoreFromApi, hasMoreApi, loadingMore);

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40">
        <div className="flex gap-1 overflow-x-auto no-scrollbar flex-1">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold transition-all tab-pill shrink-0",
                filter === t.id ? "active" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-0.5 shrink-0 bg-muted/50 rounded-full p-0.5">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s.id}
              onClick={() => setSort(s.id)}
              className={cn(
                "px-3 py-1.5 rounded-full text-xs font-semibold transition-all",
                sort === s.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary/50" />
          <p className="text-xs text-muted-foreground">Loading notifications…</p>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-sm text-muted-foreground px-6">{error}</div>
      ) : filtered.length === 0 && !hasMoreApi ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <div className="w-14 h-14 rounded-full bg-muted/50 flex items-center justify-center">
            <Bell className="w-6 h-6 opacity-30" />
          </div>
          <p className="text-sm">No notifications yet</p>
        </div>
      ) : (
        <div className="divide-y divide-border/30">
          {sorted.map((n) => (
            <NotifRow key={n.id} n={n} navigate={navigate} proMap={proMap} />
          ))}
          {hasMoreApi && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
