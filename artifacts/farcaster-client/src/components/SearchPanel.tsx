import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Search, Loader2, UserPlus, UserCheck, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { searchUsers, searchCasts, hasPowerBadge, type NeynarUser, type NeynarCast } from "@/lib/neynar";
import { PowerBadgeIcon } from "@/components/PowerBadgeIcon";
import { hubFollow } from "@/lib/hub-submit";
import { CastCard } from "./CastCard";

type SearchTab = "users" | "casts";

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
        <p className="text-sm font-semibold text-foreground truncate hover:text-primary transition-colors">
          {user.display_name || user.username}
        </p>
        <div className="flex items-center gap-1">
          <p className="text-xs text-muted-foreground">@{user.username}</p>
          {hasPowerBadge(user) && (
            <span title="Power Badge" className="shrink-0 inline-flex">
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

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<SearchTab>("users");
  const [users, setUsers] = useState<NeynarUser[]>([]);
  const [casts, setCasts] = useState<NeynarCast[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, navigate] = useLocation();
  function goToProfile(user: NeynarUser) { navigate(`/profile/${user.fid}`); }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim() || query.length < 2) { setUsers([]); setCasts([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        if (tab === "users") {
          const res = await searchUsers(query, fidNum, neynarKey);
          setUsers(res.result.users);
        } else {
          const res = await searchCasts(query, fidNum, neynarKey);
          setCasts(res.result.casts);
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Search failed");
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, tab, fidNum, neynarKey]);

  function handleTabChange(t: SearchTab) { setTab(t); setUsers([]); setCasts([]); }

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
          {(["users", "casts"] as SearchTab[]).map((t) => (
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
      ) : tab === "users" ? (
        users.map((u) => <UserRow key={u.fid} user={u} viewerFid={fidNum} onViewProfile={goToProfile} />)
      ) : (
        casts.map((c) => <CastCard key={c.hash} cast={c} viewerFid={fidNum} compact onViewProfile={goToProfile} />)
      )}
    </div>
  );
}
