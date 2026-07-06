import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, Heart, Repeat2, MessageCircle, UserPlus, Bell, User, Quote, AtSign, Settings2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { getNotifications, type NeynarNotification, type NeynarUser } from "@/lib/neynar";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useProStatus, ProBadge } from "./ProBadge";
import { setRecentProfile } from "@/lib/recent-profile-cache";
import { getMutedNotifKinds, setNotifKindMuted, type NotifKind } from "@/lib/app-settings";

function notifKindOf(n: FlatNotif): NotifKind {
  if (n.kind === "follow-group") return "follows";
  if (n.kind === "like-group" || n.kind === "recast-group") return "reactions";
  return "replies";
}

function notifPrimaryFid(n: FlatNotif): number {
  if (n.kind === "follow-group" || n.kind === "like-group" || n.kind === "recast-group") return n.users[0]?.fid ?? 0;
  return n.author.fid;
}

function timeAgo(ts: string): string {
  const diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

type FlatNotif =
  | { kind: "follow-group"; id: string; ts: string; users: NeynarUser[] }
  | { kind: "like-group"; id: string; ts: string; users: NeynarUser[]; castText: string; castHash?: string }
  | { kind: "recast-group"; id: string; ts: string; users: NeynarUser[]; castText: string; castHash?: string }
  | { kind: "reply"; id: string; ts: string; author: NeynarUser; text: string; castHash: string }
  | { kind: "mention"; id: string; ts: string; author: NeynarUser; text: string; castHash: string }
  | { kind: "quote"; id: string; ts: string; author: NeynarUser; text: string; castHash: string };

function flattenNotifications(notifs: NeynarNotification[]): FlatNotif[] {
  const result: FlatNotif[] = [];
  for (const n of notifs) {
    // For reply/mention/quote: n.cast IS the event · use its timestamp (most accurate).
    // For likes/recasts/follows: n.cast is the TARGET cast (not the event); use
    // most_recent_timestamp which Neynar sets to the time of the most recent reaction.
    const ts =
      (n.type === "reply" || n.type === "mention" || n.type === "quote")
        ? (n.cast?.timestamp ?? n.timestamp ?? n.most_recent_timestamp ?? "")
        : (n.timestamp ?? n.most_recent_timestamp ?? "");
    if (n.type === "follows" && n.follows?.length) {
      result.push({
        kind: "follow-group",
        id: `follows-${ts}-${n.follows[0].user.fid}`,
        ts,
        users: n.follows.map((f) => f.user),
      });
    } else if ((n.type === "likes" || n.type === "recasts") && n.reactions?.length) {
      // Neynar groups every reaction on one cast into a single notification and gives
      // only ONE group timestamp (most_recent_timestamp) · there are NO per-reactor
      // times. Expanding into one row per reactor (the old behaviour) stamped them all
      // with that single time, so dozens showed the same "10m ago", and every time a
      // new reaction arrived the whole group's timestamp bumped and the days-old ones
      // resurfaced as "new". Collapse to ONE grouped row (like follows) with a stable
      // per-cast id so it updates in place instead of re-flooding the feed.
      const isLike = n.type === "likes";
      const castObj = n.reactions[0]?.cast ?? n.cast;
      const castHash = castObj?.hash;
      result.push({
        kind: isLike ? "like-group" : "recast-group",
        id: `${n.type}-${castHash ?? ts}`,
        ts,
        users: n.reactions.map((r) => r.user),
        castText: castObj?.text ?? "",
        castHash,
      });
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

function Avatar({
  user,
  size = 9,
  onClick,
}: {
  user: NeynarUser;
  size?: number;
  onClick?: () => void;
}) {
  // Tailwind's JIT scanner needs literal class strings in source — a
  // template-built class like `w-${size}` only works by coincidence if that
  // exact string happens to appear literally elsewhere in the codebase.
  // A static lookup keeps this correct regardless of what else exists.
  const SIZE_CLASSES: Record<number, string> = { 8: "w-8 h-8", 9: "w-9 h-9" };
  const sizeClass = SIZE_CLASSES[size] ?? "w-9 h-9";
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
    <User className="w-4 h-4 text-primary/40" />
  );

  const base = cn(
    sizeClass,
    "rounded-full overflow-hidden bg-muted flex items-center justify-center shrink-0"
  );

  if (onClick) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          setRecentProfile(user);
          onClick();
        }}
        className={cn(base, "hover:ring-2 hover:ring-primary/30 transition-all")}
      >
        {inner}
      </button>
    );
  }
  return <div className={base}>{inner}</div>;
}

/* ─── Follow group row ─── */
function FollowGroupRow({
  n,
  navigate,
  proMap,
}: {
  n: Extract<FlatNotif, { kind: "follow-group" }>;
  navigate: (p: string) => void;
  proMap: Record<number, boolean>;
}) {
  const shown = n.users.slice(0, 5);
  const extra = n.users.length - shown.length;
  const first = n.users[0];

  return (
    <div className="flex items-start gap-3 mx-3 my-1.5 px-3.5 py-3 rounded-2xl border border-border/40 bg-card/40 hover:bg-accent/10 hover:border-border/70 transition-all">
      {/* Icon */}
      <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 bg-sky-500/10 mt-0.5">
        <UserPlus className="w-4 h-4 text-sky-500" strokeWidth={2} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Stacked avatars */}
        <div className="flex items-center gap-0 mb-2 flex-wrap">
          {shown.map((u, i) => (
            <div key={u.fid} className={cn("relative", i > 0 && "-ml-2")}>
              <div className="ring-2 ring-background rounded-full">
                <Avatar user={u} size={8} onClick={() => navigate(`/profile/${u.fid}`)} />
              </div>
            </div>
          ))}
          {extra > 0 && (
            <div className="-ml-2 relative z-0 w-8 h-8 rounded-full bg-muted ring-2 ring-background flex items-center justify-center text-[10px] font-bold text-muted-foreground">
              +{extra}
            </div>
          )}
        </div>

        {/* Text */}
        <p className="text-sm leading-snug text-foreground">
          <button
            onClick={() => { setRecentProfile(first); navigate(`/profile/${first.fid}`); }}
            className="font-semibold hover:text-primary transition-colors"
          >
            @{first.username}
          </button>
          {proMap[first.fid] && <ProBadge size={11} className="ml-0.5 inline-block align-middle" />}
          {n.users.length === 1 ? (
            <span className="text-muted-foreground"> followed you</span>
          ) : n.users.length === 2 ? (
            <>
              <span className="text-muted-foreground"> and </span>
              <button
                onClick={() => { setRecentProfile(n.users[1]); navigate(`/profile/${n.users[1].fid}`); }}
                className="font-semibold hover:text-primary transition-colors"
              >
                @{n.users[1].username}
              </button>
              {proMap[n.users[1].fid] && (
                <ProBadge size={11} className="ml-0.5 inline-block align-middle" />
              )}
              <span className="text-muted-foreground"> followed you</span>
            </>
          ) : (
            <span className="text-muted-foreground"> and {n.users.length - 1} others followed you</span>
          )}
        </p>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">{timeAgo(n.ts)}</p>
      </div>
    </div>
  );
}

/* ─── Reaction group row (likes / recasts on one cast) ─── */
function ReactionGroupRow({
  n,
  navigate,
  proMap,
}: {
  n: Extract<FlatNotif, { kind: "like-group" | "recast-group" }>;
  navigate: (p: string) => void;
  proMap: Record<number, boolean>;
}) {
  const isLike = n.kind === "like-group";
  const shown = n.users.slice(0, 5);
  const extra = n.users.length - shown.length;
  const first = n.users[0];
  if (!first) return null;

  return (
    <div
      onClick={() => { if (n.castHash) navigate(`/cast/${n.castHash}`); }}
      className={cn(
        "flex items-start gap-3 mx-3 my-1.5 px-3.5 py-3 rounded-2xl border border-border/40 bg-card/40 hover:bg-accent/10 hover:border-border/70 transition-all",
        n.castHash && "cursor-pointer"
      )}
    >
      {/* Icon */}
      <div className={cn(
        "w-9 h-9 rounded-full flex items-center justify-center shrink-0 mt-0.5",
        isLike ? "bg-rose-500/10" : "bg-emerald-500/10"
      )}>
        {isLike
          ? <Heart className="w-4 h-4 text-rose-500 fill-current" />
          : <Repeat2 className="w-4 h-4 text-emerald-500" strokeWidth={2} />}
      </div>

      <div className="flex-1 min-w-0">
        {/* Stacked avatars */}
        <div className="flex items-center gap-0 mb-2 flex-wrap">
          {shown.map((u, i) => (
            <div key={u.fid} className={cn("relative", i > 0 && "-ml-2")}>
              <div className="ring-2 ring-background rounded-full">
                <Avatar user={u} size={8} onClick={() => navigate(`/profile/${u.fid}`)} />
              </div>
            </div>
          ))}
          {extra > 0 && (
            <div className="-ml-2 relative z-0 w-8 h-8 rounded-full bg-muted ring-2 ring-background flex items-center justify-center text-[10px] font-bold text-muted-foreground">
              +{extra}
            </div>
          )}
        </div>

        <div className="flex items-start justify-between gap-2">
          <p className="text-sm leading-snug text-foreground">
            <button
              onClick={(e) => { e.stopPropagation(); setRecentProfile(first); navigate(`/profile/${first.fid}`); }}
              className="font-semibold hover:text-primary transition-colors"
            >
              @{first.username}
            </button>
            {proMap[first.fid] && <ProBadge size={11} className="ml-0.5 inline-block align-middle" />}
            {n.users.length > 1 && (
              <span className="text-muted-foreground"> and {n.users.length - 1} other{n.users.length - 1 > 1 ? "s" : ""}</span>
            )}
            <span className="text-muted-foreground">{isLike ? " liked your cast" : " recasted your cast"}</span>
          </p>
          <span className="text-[11px] text-muted-foreground/60 shrink-0 mt-0.5">{timeAgo(n.ts)}</span>
        </div>

        {n.castText && (
          <p className="mt-1.5 text-xs text-muted-foreground/80 leading-relaxed line-clamp-2 bg-muted/30 rounded-md px-2.5 py-1.5 border-l-2 border-border/60">
            {n.castText}
          </p>
        )}
      </div>
    </div>
  );
}

/* ─── Conversation row (reply / mention / quote) ─── */
function ConversationRow({
  n,
  navigate,
  proMap,
}: {
  n: Extract<FlatNotif, { kind: "reply" | "mention" | "quote" }>;
  navigate: (p: string) => void;
  proMap: Record<number, boolean>;
}) {
  const cfg =
    n.kind === "quote"
      ? { Icon: Quote, color: "text-violet-500", bg: "bg-violet-500/10", label: "quoted your cast" }
      : n.kind === "mention"
      ? { Icon: AtSign, color: "text-amber-500", bg: "bg-amber-500/10", label: "mentioned you" }
      : { Icon: MessageCircle, color: "text-primary", bg: "bg-primary/10", label: "replied to you" };

  return (
    <div
      onClick={() => navigate(`/cast/${n.castHash}`)}
      className="flex items-start gap-3 mx-3 my-1.5 px-3.5 py-3 rounded-2xl border border-border/40 bg-card/40 hover:bg-accent/10 hover:border-border/70 transition-all cursor-pointer"
    >
      <div className="relative shrink-0">
        <Avatar user={n.author} size={9} onClick={() => navigate(`/profile/${n.author.fid}`)} />
        <div
          className={cn(
            "absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center ring-2 ring-background",
            cfg.bg
          )}
        >
          <cfg.Icon className={cn("w-2.5 h-2.5", cfg.color)} strokeWidth={2.5} />
        </div>
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm leading-snug text-foreground">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRecentProfile(n.author);
                navigate(`/profile/${n.author.fid}`);
              }}
              className="font-semibold hover:text-primary transition-colors"
            >
              @{n.author.username}
            </button>
            {proMap[n.author.fid] && (
              <ProBadge size={11} className="ml-0.5 inline-block align-middle" />
            )}
            <span className="text-muted-foreground"> {cfg.label}</span>
          </p>
          <span className="text-[11px] text-muted-foreground/60 shrink-0 mt-0.5">{timeAgo(n.ts)}</span>
        </div>

        {n.text && (
          <p className="mt-1.5 text-xs text-muted-foreground/80 leading-relaxed line-clamp-2 bg-muted/30 rounded-md px-2.5 py-1.5 border-l-2 border-border/60">
            {n.text}
          </p>
        )}
      </div>
    </div>
  );
}

function NotifRow({
  n,
  navigate,
  proMap,
}: {
  n: FlatNotif;
  navigate: (p: string) => void;
  proMap: Record<number, boolean>;
}) {
  if (n.kind === "follow-group") return <FollowGroupRow n={n} navigate={navigate} proMap={proMap} />;
  if (n.kind === "like-group" || n.kind === "recast-group") return <ReactionGroupRow n={n} navigate={navigate} proMap={proMap} />;
  if (n.kind === "reply" || n.kind === "mention" || n.kind === "quote")
    return <ConversationRow n={n} navigate={navigate} proMap={proMap} />;
  return null;
}

// ─── Module-level notification cache ─────────────────────────────────────────
// Survives component re-mounts so timestamps don't reset every time the user
// navigates away and back. New notifications are prepended; old ones keep their
// original timestamps. Cache is keyed by FID.
const _notifCache = new Map<number, {
  notifs: FlatNotif[];
  cursor: string | undefined;
  fetchedAt: number;
}>();
const NOTIF_CACHE_TTL = 4 * 60 * 1000; // 4 minutes · don't re-fetch more often

/* ─── Filter tabs ─── */
type FilterTab = "all" | "reactions" | "replies" | "follows";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "All" },
  { id: "reactions", label: "Reactions" },
  { id: "replies", label: "Replies" },
  { id: "follows", label: "Follows" },
];

const MUTE_OPTIONS: { id: NotifKind; label: string; desc: string }[] = [
  { id: "reactions", label: "Likes & recasts", desc: "Hide reaction notifications from the list and unread count" },
  { id: "replies", label: "Replies & mentions", desc: "Hide replies, mentions, and quote casts" },
  { id: "follows", label: "New followers", desc: "Hide follow notifications" },
];

/* ─── Notification management popover ─── */
function NotifSettingsMenu({ muted, setMuted }: { muted: Set<NotifKind>; setMuted: (s: Set<NotifKind>) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onOut = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Manage notifications"
        className={cn(
          "p-1.5 rounded-lg transition-colors",
          open ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-foreground hover:bg-accent"
        )}
      >
        <Settings2 className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1.5 z-20 w-64 bg-popover border border-border rounded-2xl shadow-xl overflow-hidden py-1.5">
          <p className="px-3.5 pt-1.5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            Notification types
          </p>
          {MUTE_OPTIONS.map((opt) => {
            const isMuted = muted.has(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => setMuted(setNotifKindMuted(opt.id, !isMuted))}
                className="w-full flex items-center justify-between gap-3 px-3.5 py-2.5 hover:bg-accent transition-colors text-left"
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">{opt.label}</p>
                  <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug">{opt.desc}</p>
                </div>
                <span className={cn(
                  "shrink-0 w-8 h-[18px] rounded-full relative transition-colors",
                  !isMuted ? "bg-primary" : "bg-muted-foreground/25"
                )}>
                  <span className={cn(
                    "absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform",
                    !isMuted ? "translate-x-[18px]" : "translate-x-[2px]"
                  )} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Main panel ─── */
export function NotificationsPanel() {
  const { fid, neynarKey } = useWallet();
  const [, navigate] = useLocation();
  const fidNum = fid ? Number(fid) : 0;

  const [allFlat, setAllFlat] = useState<FlatNotif[]>([]);
  const [muted, setMuted] = useState<Set<NotifKind>>(() => getMutedNotifKinds());
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const lastCursorRef = useRef<string | undefined>(undefined);
  const lastFetchTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!fidNum) return;
    lastCursorRef.current = undefined;
    lastFetchTimeRef.current = Date.now();

    // ── Cache hit: restore previous data immediately, preserving original timestamps ──
    const hit = _notifCache.get(fidNum);
    if (hit && Date.now() - hit.fetchedAt < NOTIF_CACHE_TTL) {
      setAllFlat(hit.notifs);
      setCursor(hit.cursor);
      setLoading(false);
      return;
    }

    // ── Cache stale or miss: fetch fresh but DON'T wipe existing data first ──
    // Keeping old data visible prevents the "flicker to wrong timestamps" issue.
    if (hit) {
      // Restore stale cache immediately so the UI shows something while refreshing
      setAllFlat(hit.notifs);
      setCursor(hit.cursor);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);

    getNotifications(fidNum, neynarKey)
      .then((data) => {
        const fresh = flattenNotifications(data.notifications);
        setAllFlat(prev => {
          // Follow-group ids embed most_recent_timestamp, which changes whenever a
          // new follower arrives · so the "same" group re-appears under a new id.
          // Drop stale prev follow-groups that share any user with a fresh group,
          // otherwise the user sees duplicated "X followed you" rows after refresh.
          const freshFollowFids = new Set(
            fresh.flatMap(n => (n.kind === "follow-group" ? n.users.map(u => u.fid) : []))
          );
          // Reaction groups use a STABLE per-cast id, so a fresh version is the current
          // state of that group · let it REPLACE the previous one (updated count +
          // timestamp) instead of both coexisting. This is what stops days-old
          // reactions from resurfacing as a flood of "new" rows: one group row simply
          // moves up in place when (and only when) genuinely new activity arrives.
          const freshIds = new Set(fresh.map(n => n.id));
          const prevKept = prev.filter(p => {
            if (p.kind === "follow-group") return !p.users.some(u => freshFollowFids.has(u.fid));
            if (p.kind === "like-group" || p.kind === "recast-group") return !freshIds.has(p.id);
            return true;
          });
          // Prepend genuinely new notifications; keep existing ones with their timestamps
          const seen = new Set(prevKept.map(p => p.id));
          const merged = [
            ...fresh.filter(n => !seen.has(n.id)),
            ...prevKept,
          ];
          _notifCache.set(fidNum, { notifs: merged, cursor: data.next?.cursor, fetchedAt: Date.now() });
          return merged;
        });
        setCursor(data.next?.cursor);
      })
      .catch((e: unknown) => {
        // Only show error if we have no cached data to fall back on
        if (!hit) setError(e instanceof Error ? e.message : "Failed to load");
      })
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
      const newNotifs = flattenNotifications(data.notifications);
      const newCursor = data.next?.cursor;
      setAllFlat((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        const merged = [
          ...prev,
          ...newNotifs.filter((p) => !seen.has(p.id)),
        ];
        // Keep cache up-to-date with paginated results
        _notifCache.set(fidNum, { notifs: merged, cursor: newCursor, fetchedAt: Date.now() });
        return merged;
      });
      setCursor(newCursor);
    } catch {
      // Allow retrying this cursor · otherwise the `lastCursorRef === cursor`
      // guard permanently blocks pagination after one failed fetch.
      lastCursorRef.current = undefined;
    } finally {
      setLoadingMore(false);
    }
  }

  const filtered = allFlat.filter((n) => {
    if (muted.has(notifKindOf(n))) return false;
    if (filter === "reactions") return n.kind === "like-group" || n.kind === "recast-group";
    if (filter === "replies") return n.kind === "reply" || n.kind === "mention" || n.kind === "quote";
    if (filter === "follows") return n.kind === "follow-group";
    return true;
  });

  // Always sort newest first · no sort toggle needed
  const sorted = [...filtered].sort((a, b) => {
    const at = Date.parse(a.ts) || 0;
    const bt = Date.parse(b.ts) || 0;
    return bt - at;
  });

  const proMap = useProStatus(sorted.map(notifPrimaryFid));

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
      <div className="px-4 pt-3.5 pb-2.5 border-b border-border/40 bg-gradient-to-b from-primary/[0.04] to-transparent">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-base font-bold text-foreground flex items-center gap-1.5">
            <Bell className="w-4 h-4 text-primary" />
            Notifications
          </h2>
          <NotifSettingsMenu muted={muted} setMuted={setMuted} />
        </div>
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {FILTER_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setFilter(t.id)}
              className={cn(
                "px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all tab-pill shrink-0",
                filter === t.id ? "active" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-primary/40" />
          <p className="text-xs text-muted-foreground">Loading notifications…</p>
        </div>
      ) : error ? (
        <div className="text-center py-12 text-sm text-muted-foreground px-6">{error}</div>
      ) : sorted.length === 0 && !hasMoreApi ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-muted-foreground">
          <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center">
            <Bell className="w-5 h-5 opacity-25" />
          </div>
          <p className="text-sm">No notifications</p>
        </div>
      ) : (
        <div className="py-1">
          {sorted.map((n) => (
            <NotifRow key={n.id} n={n} navigate={navigate} proMap={proMap} />
          ))}

          {/* load-more sentinel */}
          {hasMoreApi && (
            <div ref={sentinelRef} className="flex justify-center py-5">
              {loadingMore ? (
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
              ) : (
                <div className="h-4" />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
