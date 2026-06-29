import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, Heart, Repeat2, MessageCircle, UserPlus, Bell, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { getNotifications, type NeynarNotification, type NeynarUser } from "@/lib/neynar";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";

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
  | { kind: "mention"; id: string; ts: string; author: NeynarUser; text: string; castHash: string };

function flattenNotifications(notifs: NeynarNotification[]): FlatNotif[] {
  const result: FlatNotif[] = [];
  for (const n of notifs) {
    const ts = n.most_recent_timestamp ?? n.timestamp ?? "";

    if (n.type === "follows" && n.follows?.length) {
      // Group all followers from this notification batch into one row
      result.push({
        kind: "follow-group",
        id: `follows-${ts}-${n.follows[0].user.fid}`,
        ts,
        users: n.follows.map((f) => f.user),
      });
    } else if ((n.type === "likes" || n.type === "recasts") && n.reactions?.length) {
      // One notification batches many reactors of the same cast — emit a row per reactor.
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
        kind: n.type === "reply" ? "reply" : "mention",
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

function Avatar({
  user,
  size = 10,
  onClick,
}: {
  user: NeynarUser;
  size?: number;
  onClick?: () => void;
}) {
  const cls = `w-${size} h-${size} rounded-full overflow-hidden bg-primary/10 flex items-center justify-center shrink-0`;
  const inner = user.pfp_url ? (
    <img
      src={user.pfp_url}
      alt={user.display_name}
      className="w-full h-full object-cover"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  ) : (
    <User className="w-4 h-4 text-primary/50" />
  );

  if (onClick) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={cn(cls, "hover:ring-2 hover:ring-primary/40 transition-all")}
      >
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

/** Up to MAX_SHOWN avatars side by side with slight overlap */
const MAX_SHOWN = 5;

function FollowGroupRow({ n, navigate }: { n: Extract<FlatNotif, { kind: "follow-group" }>; navigate: (p: string) => void }) {
  const shown = n.users.slice(0, MAX_SHOWN);
  const extra = n.users.length - shown.length;

  // Build label text: "Alice, Bob and 3 others followed you"
  let label: string;
  if (n.users.length === 1) {
    label = `${n.users[0].display_name} followed you`;
  } else if (n.users.length === 2) {
    label = `${n.users[0].display_name} and ${n.users[1].display_name} followed you`;
  } else {
    label = `${n.users[0].display_name}, ${n.users[1].display_name}${extra > 0 ? ` and ${extra + (shown.length - 2)} others` : ` and ${shown.length - 2} others`} followed you`;
  }

  return (
    <div className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 hover:bg-accent/15 transition-colors">
      <UserPlus className="w-4 h-4 text-emerald-500 shrink-0" />

      {/* Stacked avatars */}
      <div className="flex shrink-0">
        {shown.map((u, i) => (
          <div key={u.fid} className={cn("relative", i > 0 && "-ml-2")}>
            <Avatar
              user={u}
              size={8}
              onClick={() => navigate(`/profile/${u.fid}`)}
            />
          </div>
        ))}
        {extra > 0 && (
          <div className="-ml-2 w-8 h-8 rounded-full bg-muted border-2 border-background flex items-center justify-center text-[10px] font-bold text-muted-foreground">
            +{extra}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">
          {n.users.length <= 2 ? (
            <>
              {n.users.map((u, i) => (
                <span key={u.fid}>
                  {i > 0 && " and "}
                  <button
                    onClick={() => navigate(`/profile/${u.fid}`)}
                    className="font-semibold hover:text-primary transition-colors"
                  >
                    {u.display_name}
                  </button>
                </span>
              ))}
              <span className="text-muted-foreground"> followed you</span>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate(`/profile/${n.users[0].fid}`)}
                className="font-semibold hover:text-primary transition-colors"
              >
                {n.users[0].display_name}
              </button>
              <span className="text-muted-foreground">
                {" "}and {n.users.length - 1} others followed you
              </span>
            </>
          )}
        </p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">{timeAgo(n.ts)}</span>
    </div>
  );
}

function NotifRow({ n, navigate }: { n: FlatNotif; navigate: (p: string) => void }) {
  if (n.kind === "follow-group") {
    return <FollowGroupRow n={n} navigate={navigate} />;
  }

  if (n.kind === "like" || n.kind === "recast") {
    const isLike = n.kind === "like";
    const openCast = () => { if (n.castHash) navigate(`/cast/${n.castHash}`); };
    return (
      <div
        onClick={openCast}
        className={cn(
          "flex items-center gap-3 px-5 py-3.5 border-b border-border/40 hover:bg-accent/15 transition-colors",
          n.castHash && "cursor-pointer"
        )}
      >
        {isLike
          ? <Heart className="w-4 h-4 text-rose-500 shrink-0 fill-current" />
          : <Repeat2 className="w-4 h-4 text-emerald-500 shrink-0" />}
        <Avatar user={n.reactor} onClick={() => navigate(`/profile/${n.reactor.fid}`)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/profile/${n.reactor.fid}`); }}
              className="font-semibold hover:text-primary transition-colors"
            >
              {n.reactor.display_name}
            </button>
            <span className="text-muted-foreground">{isLike ? " liked your cast" : " recasted your cast"}</span>
          </p>
          {n.castText && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{n.castText.slice(0, 80)}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{timeAgo(n.ts)}</span>
      </div>
    );
  }

  if (n.kind === "reply" || n.kind === "mention") {
    return (
      <div
        onClick={() => navigate(`/cast/${n.castHash}`)}
        className="flex items-center gap-3 px-5 py-3.5 border-b border-border/40 hover:bg-accent/15 transition-colors cursor-pointer"
      >
        <MessageCircle className="w-4 h-4 text-primary shrink-0" />
        <Avatar user={n.author} onClick={() => navigate(`/profile/${n.author.fid}`)} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground">
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/profile/${n.author.fid}`); }}
              className="font-semibold hover:text-primary transition-colors"
            >
              {n.author.display_name}
            </button>
            <span className="text-muted-foreground">
              {" "}{n.kind === "mention" ? "mentioned you" : "replied to you"}
            </span>
          </p>
          {n.text && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">{n.text.slice(0, 80)}</p>
          )}
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{timeAgo(n.ts)}</span>
      </div>
    );
  }

  return null;
}

type FilterTab = "all" | "reactions" | "replies" | "follows";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reactions", label: "Reactions" },
  { id: "replies", label: "Replies" },
  { id: "follows", label: "Follows" },
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
  // Guards against double-fetching the same cursor (StrictMode / rapid re-fires)
  const lastCursorRef = useRef<string | undefined>(undefined);
  // Cooldown: minimum 5s between calls — server caches for 60s so we won't hit Neynar directly
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
    if (now - lastFetchTimeRef.current < 5_000) return; // server caches 60s, just prevent double-tap
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
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = allFlat.filter((n) => {
    if (filter === "all") return true;
    if (filter === "reactions") return n.kind === "like" || n.kind === "recast";
    if (filter === "replies") return n.kind === "reply" || n.kind === "mention";
    if (filter === "follows") return n.kind === "follow-group";
    return true;
  });

  // Auto-load one more page when filter shows too few items — but only if cooldown allows.
  // A single auto-load attempt per filter change is enough; the sentinel handles scrolling.
  const autoLoadedForFilterRef = useRef<string>("");
  useEffect(() => {
    if (filtered.length >= 8 || loading || loadingMore || !cursor) return;
    if (autoLoadedForFilterRef.current === filter) return; // already attempted for this filter
    autoLoadedForFilterRef.current = filter;
    loadMoreFromApi();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, filtered.length, loading, loadingMore, cursor]);

  const hasMoreApi = !!cursor;
  const sentinelRef = useInfiniteScroll(loadMoreFromApi, hasMoreApi, loadingMore);

  return (
    <div>
      <div className="flex gap-1 px-4 py-3 border-b border-border/40">
        {FILTER_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setFilter(t.id)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all tab-pill",
              filter === t.id ? "active" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="w-6 h-6 animate-spin text-primary/60" />
          <p className="text-xs text-muted-foreground">Loading notifications…</p>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{error}</div>
      ) : filtered.length === 0 && !hasMoreApi ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <Bell className="w-8 h-8 mx-auto mb-3 opacity-30" />
          No notifications yet
        </div>
      ) : (
        <>
          {filtered.map((n) => (
            <NotifRow key={n.id} n={n} navigate={navigate} />
          ))}

          {hasMoreApi && (
            <div ref={sentinelRef} className="flex justify-center py-5">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
