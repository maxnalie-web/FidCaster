import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search, Loader2, UserPlus, UserCheck, Check, ChevronRight, Users as UsersIcon } from "lucide-react";
import { cn, formatCompactCount } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { searchUsers, searchCasts, searchChannels, hasPowerBadge, type NeynarUser, type NeynarCast, type NeynarChannel } from "@/lib/neynar";
import { PowerBadgeIcon } from "@/components/PowerBadgeIcon";
import { useIsPro, ProBadge } from "@/components/ProBadge";
import { hubFollow } from "@/lib/hub-submit";
import { CastCard } from "./CastCard";

type SearchTab = "users" | "casts" | "channels";

// Module-level (survives unmount) · opening a result's profile unmounts the
// whole dashboard, so without this the query + results vanish when the user
// presses back. Keyed by the viewer so switching accounts starts fresh.
interface SearchCache {
  viewerFid: number;
  query: string;
  tab: SearchTab;
  users: NeynarUser[];
  casts: NeynarCast[];
  channels: NeynarChannel[];
  scrollY: number;
}
let _searchCache: SearchCache | null = null;

function ChannelRow({ channel, onOpen }: { channel: NeynarChannel; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(channel.id)}
      className="w-full flex items-center gap-3 px-5 py-4 border-b border-border/40 hover:bg-accent/20 transition-colors text-left"
    >
      <div className="w-10 h-10 rounded-xl overflow-hidden bg-primary/10 shrink-0 ring-1 ring-border">
        {channel.image_url ? (
          <img src={channel.image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="w-full h-full flex items-center justify-center text-sm font-bold text-primary">
            {channel.name?.[0]?.toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground truncate">{channel.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[11px] text-muted-foreground truncate">/{channel.id}</p>
          <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <UsersIcon className="w-2.5 h-2.5" /> {formatCompactCount(channel.follower_count)}
          </span>
        </div>
        {channel.description && (
          <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-1">{channel.description}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

function FollowButton({ user, viewerFid }: { user: NeynarUser; viewerFid: number }) {
  const { fid, localSigner, signerApproved, neynarKey } = useWallet();
  const [following, setFollowing] = useState(user.viewer_context?.following ?? false);
  const [loading, setLoading] = useState(false);

  const canWrite = signerApproved && Boolean(localSigner) && Boolean(fid);

  if (user.fid === viewerFid) return null;

  async function toggle() {
    if (!canWrite || !localSigner || !fid) return;
    setLoading(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    try {
      await hubFollow(Number(fid), localSigner, user.fid, {
        unfollow: wasFollowing, neynarKey,
      });
    } catch {
      setFollowing(wasFollowing);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={toggle}
      disabled={loading || !canWrite}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border",
        following
          ? "border-border/60 text-muted-foreground hover:text-destructive hover:border-destructive/40"
          : "btn-luxury text-primary-foreground border-transparent",
        (!canWrite || loading) && "opacity-50 cursor-default"
      )}
    >
      {loading ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : following ? (
        <UserCheck className="w-3 h-3" />
      ) : (
        <UserPlus className="w-3 h-3" />
      )}
      {following ? "Following" : "Follow"}
    </button>
  );
}

function UserRow({ user, viewerFid, onViewProfile }: {
  user: NeynarUser; viewerFid: number; onViewProfile: (u: NeynarUser) => void;
})  {
  return (
    <div className="flex items-center gap-3 px-5 py-4 border-b border-border/40 hover:bg-accent/20 transition-colors">
      <button
        className="w-10 h-10 rounded-full overflow-hidden bg-primary/10 shrink-0 hover:ring-2 hover:ring-primary/40 transition-all"
        onClick={() => onViewProfile(user)}
      >
        {user.pfp_url ? (
          <img src={user.pfp_url} alt={user.display_name} className="w-full h-full object-cover" />
        ) : (
          <span className="w-full h-full flex items-center justify-center text-sm font-bold text-primary">
            {user.display_name?.[0]}
          </span>
        )}
      </button>
      <button className="flex-1 min-w-0 text-left" onClick={() => onViewProfile(user)}>
        <p className="text-sm font-semibold text-foreground truncate hover:text-primary transition-colors flex items-center gap-1">
          <span className="truncate">@{user.username}</span>
          {useIsPro(user.fid) && <ProBadge size={14} />}
        </p>
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground truncate">{user.display_name || user.username}</p>
          {hasPowerBadge(user) && (
            <span title="Purple badge" className="shrink-0 inline-flex">
              <PowerBadgeIcon size={15} />
            </span>
          )}
        </div>
        {user.profile?.bio?.text && (
          <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-1">{user.profile.bio.text}</p>
        )}
        <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
          <span><span className="text-foreground/70 font-medium">{user.follower_count.toLocaleString()}</span> followers</span>
          <span><span className="text-foreground/70 font-medium">{user.following_count.toLocaleString()}</span> following</span>
        </div>
      </button>
      <FollowButton user={user} viewerFid={viewerFid} />
    </div>
  );
}

export function SearchPanel() {
  const { fid, neynarKey } = useWallet();
  const fidNum = fid ? Number(fid) : 0;

  // Restore previous search (query + results) when the cache belongs to this viewer.
  const restored = _searchCache && _searchCache.viewerFid === fidNum ? _searchCache : null;
  const [query, setQuery] = useState(restored?.query ?? "");
  const [tab, setTab] = useState<SearchTab>(restored?.tab ?? "users");
  const [users, setUsers] = useState<NeynarUser[]>(restored?.users ?? []);
  const [casts, setCasts] = useState<NeynarCast[]>(restored?.casts ?? []);
  const [channels, setChannels] = useState<NeynarChannel[]>(restored?.channels ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Skip the very first debounced search when results were restored from cache,
  // so returning to search doesn't re-fetch (and briefly blank) the list.
  const skipNextSearch = useRef<boolean>(!!restored && !!restored.query.trim());
  const [, navigate] = useLocation();
  function goToProfile(user: NeynarUser) { navigate(`/profile/${user.fid}`); }
  function goToChannel(id: string) { navigate(`/channel/${id}`); }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persist the current search to the module cache whenever it changes, and
  // restore scroll on mount when coming back to a cached search.
  useEffect(() => {
    _searchCache = { viewerFid: fidNum, query, tab, users, casts, channels, scrollY: window.scrollY };
  }, [fidNum, query, tab, users, casts, channels]);
  useEffect(() => {
    if (restored?.scrollY) requestAnimationFrame(() => window.scrollTo(0, restored.scrollY));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setUsers([]); setCasts([]); setChannels([]); return; }
    if (skipNextSearch.current) { skipNextSearch.current = false; return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        if (tab === "users") {
          const res = await searchUsers(query, fidNum, neynarKey);
          setUsers(res.result.users);
        } else if (tab === "casts") {
          const res = await searchCasts(query, fidNum, neynarKey);
          setCasts(res.result.casts);
        } else {
          const res = await searchChannels(query, neynarKey);
          setChannels(res.channels);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, tab, fidNum, neynarKey]);

  function handleTabChange(t: SearchTab) { setTab(t); setUsers([]); setCasts([]); setChannels([]); }

  return (
    <div>
      <div className="px-4 py-3 border-b border-border/40 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search people or casts..."
            className="input-luxury w-full py-2.5 pl-9 pr-4 text-sm"
            autoFocus
          />
        </div>
        <div className="flex gap-1">
          {(["users", "casts", "channels"] as SearchTab[]).map((t) => (
            <button key={t} onClick={() => handleTabChange(t)}
              className={cn("px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all tab-pill",
                tab === t ? "active" : "text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <div className="text-center py-12 text-sm text-muted-foreground">{error}</div>
      ) : !query.trim() ? (
        <div className="text-center py-12 text-sm text-muted-foreground">Type to search</div>
      ) : tab === "users" && users.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No users found</div>
      ) : tab === "casts" && casts.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No casts found</div>
      ) : tab === "channels" && channels.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">No channels found</div>
      ) : tab === "users" ? (
        users.map((u) => <UserRow key={u.fid} user={u} viewerFid={fidNum} onViewProfile={goToProfile} />)
      ) : tab === "casts" ? (
        casts.map((c) => <CastCard key={c.hash} cast={c} viewerFid={fidNum} compact onViewProfile={goToProfile} />)
      ) : (
        channels.map((c) => <ChannelRow key={c.id} channel={c} onOpen={goToChannel} />)
      )}
    </div>
  );
}
