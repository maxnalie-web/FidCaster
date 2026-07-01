import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { Loader2, Users, ArrowLeft, Zap } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { getFollowers, getFollowing, hasPowerBadge, type NeynarUser } from "@/lib/neynar";
import { PowerBadgeIcon } from "@/components/PowerBadgeIcon";
import { useIsPro, ProBadge } from "@/components/ProBadge";
import { hubFollow } from "@/lib/hub-submit";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useAdminConfig } from "@/hooks/useAdminConfig";
import { BatchFollowSheet } from "@/components/BatchFollowSheet";

function FollowRow({
  user,
  viewerFid,
  onViewProfile,
}: {
  user: NeynarUser;
  viewerFid: number;
  onViewProfile: (u: NeynarUser) => void;
}) {
  const { fid, localSigner, signerApproved, neynarKey } = useWallet();
  const [following, setFollowing] = useState(user.viewer_context?.following ?? false);
  const [loading, setLoading] = useState(false);
  const isOwn = user.fid === viewerFid;
  const canWrite = signerApproved && Boolean(localSigner) && Boolean(fid);

  async function toggle() {
    if (!canWrite || !fid || !localSigner || isOwn) return;
    setLoading(true);
    const was = following;
    setFollowing(!was);
    try {
      await hubFollow(Number(fid), localSigner, user.fid, { unfollow: was, neynarKey });
      toast.success(was ? "Unfollowed" : `Following @${user.username}`);
    } catch (e: unknown) {
      setFollowing(was);
      const msg = e instanceof Error ? e.message : was ? "Unfollow failed" : "Follow failed";
      toast.error(msg.slice(0, 120));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border hover:bg-accent/30 transition-colors">
      {/* Avatar */}
      <button
        onClick={() => onViewProfile(user)}
        className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0 hover:opacity-90 transition-opacity"
      >
        {user.pfp_url ? (
          <img src={user.pfp_url} alt={user.display_name} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="w-full h-full flex items-center justify-center text-sm font-bold text-primary bg-primary/10">
            {(user.display_name || user.username)?.[0]?.toUpperCase()}
          </span>
        )}
      </button>

      {/* Info */}
      <button className="flex-1 min-w-0 text-left" onClick={() => onViewProfile(user)}>
        <p className="text-[0.9375rem] font-semibold text-foreground truncate hover:underline flex items-center gap-1">
          <span className="truncate">{user.display_name || user.username}</span>
          {useIsPro(user.fid) && <ProBadge size={14} />}
        </p>
        <div className="flex items-center gap-1">
          <p className="text-sm text-muted-foreground truncate">@{user.username}</p>
          {hasPowerBadge(user) && (
            <span title="Power Badge" className="shrink-0 inline-flex">
              <PowerBadgeIcon size={15} />
            </span>
          )}
        </div>
        {user.profile?.bio?.text && (
          <p className="text-xs text-muted-foreground/70 truncate mt-0.5 leading-snug">{user.profile.bio.text}</p>
        )}
      </button>

      {/* Follow button · Warpcast style */}
      {!isOwn && (
        <button
          onClick={toggle}
          disabled={loading || !canWrite}
          className={cn(
            "shrink-0 flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[0.8125rem] font-semibold transition-all",
            following
              ? "bg-transparent text-foreground border border-border/70 hover:border-destructive/50 hover:text-destructive"
              : "bg-primary text-white hover:bg-primary/90",
            (loading || !canWrite) && "opacity-50 cursor-default"
          )}
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : following ? (
            "Following"
          ) : (
            "Follow"
          )}
        </button>
      )}
    </div>
  );
}

type Props = {
  fid: number;
  type: "followers" | "following";
  count: number;
  onClose: () => void;
  zIndex?: string;
};

export function FollowListSheet({ fid, type, count, onClose, zIndex = "z-[60]" }: Props) {
  const { fid: myFid, neynarKey, profile, localSigner, signerApproved } = useWallet();
  const [adminCfg] = useAdminConfig();
  const [, navigate] = useLocation();
  const viewerFid = myFid ? Number(myFid) : 0;
  const canBatch = signerApproved && Boolean(localSigner) && Boolean(myFid) &&
    (adminCfg.privilegedUsers.some(u => u.toLowerCase() === profile?.username?.toLowerCase()) ||
     adminCfg.privilegedUsers.some(u => u === String(myFid)));
  const [activeTab, setActiveTab] = useState<"followers" | "following">(type);
  const [users, setUsers] = useState<NeynarUser[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [showBatchSheet, setShowBatchSheet] = useState(false);

  function goToProfile(user: NeynarUser) {
    onClose();
    navigate(`/profile/${user.fid}`);
  }

  // Guards against overlapping loads (observer + tab-change firing at once),
  // which would stall the list or insert duplicate rows.
  const inFlightRef = useRef(false);
  const load = useCallback(
    async (tab: "followers" | "following", cur?: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      const isFirst = !cur;
      if (isFirst) { setLoading(true); setUsers([]); setCursor(undefined); }
      else setLoadingMore(true);
      try {
        const fn = tab === "followers" ? getFollowers : getFollowing;
        const res = await fn(fid, viewerFid, neynarKey, cur);
        const newUsers = res.users.map((u: { user: NeynarUser }) => u.user).filter(Boolean);
        setUsers((prev) => {
          if (isFirst) return newUsers;
          const seen = new Set(prev.map((u) => u.fid));
          return [...prev, ...newUsers.filter((u) => !seen.has(u.fid))];
        });
        setCursor(res.next?.cursor);
      } catch { /* ignore */ }
      finally {
        if (isFirst) setLoading(false);
        else setLoadingMore(false);
        inFlightRef.current = false;
      }
    },
    [fid, viewerFid, neynarKey]
  );

  useEffect(() => { load(activeTab); }, [activeTab, load]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useInfiniteScroll(() => { if (cursor) load(activeTab, cursor); }, !!cursor, loadingMore, scrollContainerRef);

  return (
    <div className={`fixed inset-0 ${zIndex}`}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-[480px] bg-background shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0">
          <button onClick={onClose} className="p-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <span className="font-bold text-base text-foreground">{count.toLocaleString()} {activeTab === "followers" ? "Followers" : "Following"}</span>
        </div>

        {/* Tabs + batch follow button */}
        <div className="flex items-center border-b border-border shrink-0">
          {(["followers", "following"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn("feed-tab capitalize", activeTab === tab && "active")}
            >
              {tab === "followers" ? "Followers" : "Following"}
            </button>
          ))}
          {canBatch && (
            <button
              onClick={() => setShowBatchSheet(true)}
              className="ml-auto mr-3 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-semibold bg-primary/8 text-primary border border-primary/20 hover:bg-primary/15 transition-colors shrink-0"
            >
              <Zap className="w-3 h-3" />
              {activeTab === "followers" ? "Batch Follow" : "Batch Unfollow"}
            </button>
          )}
        </div>

        {/* List */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <Users className="w-8 h-8 opacity-20" />
              <p className="text-sm">No {activeTab} yet</p>
            </div>
          ) : (
            <>
              {users.map((u) => (
                <FollowRow key={u.fid} user={u} viewerFid={viewerFid} onViewProfile={goToProfile} />
              ))}
              {cursor && (
                <div ref={sentinelRef} className="flex justify-center py-4">
                  {loadingMore && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* BatchFollowSheet */}
      {showBatchSheet && myFid && localSigner && (
        <BatchFollowSheet
          mode="follow"
          fetchList={activeTab === "followers" ? "followers" : "following"}
          sourceFid={fid}
          myFid={Number(myFid)}
          localSigner={localSigner}
          neynarKey={neynarKey}
          onClose={() => setShowBatchSheet(false)}
          zIndex="z-[80]"
        />
      )}
    </div>
  );
}
