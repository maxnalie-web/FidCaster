import { useState, useEffect, useRef, useCallback } from "react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft, User, Loader2, UserPlus, UserCheck,
  MapPin, Check, MoreHorizontal, Copy, Settings,
  AlignLeft, MessageSquare, Heart, Repeat2,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useIsPro, ProBadge } from "@/components/ProBadge";
import {
  getUserByFid, getUserCasts, getUserReplies, getUserLikes, getUserRecasts,
  hasPowerBadge, type NeynarUser, type NeynarCast,
} from "@/lib/neynar";
import { PowerBadgeIcon } from "@/components/PowerBadgeIcon";
import { hubFollow, neynarAction } from "@/lib/hub-submit";
import { CastCard } from "@/components/CastCard";
import { FollowListSheet } from "@/components/FollowListSheet";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type ProfileTab = "casts" | "replies" | "likes" | "recasts";

type TabData = {
  items: NeynarCast[];
  cursor?: string;
  loaded: boolean;
  loading: boolean;
};

const BLANK_TAB: TabData = { items: [], cursor: undefined, loaded: false, loading: false };

const TAB_META: { id: ProfileTab; label: string; icon: React.ReactNode }[] = [
  { id: "casts",   label: "Casts",   icon: <AlignLeft    className="w-3.5 h-3.5" /> },
  { id: "replies", label: "Replies", icon: <MessageSquare className="w-3.5 h-3.5" /> },
  { id: "recasts", label: "Recasts", icon: <Repeat2       className="w-3.5 h-3.5" /> },
  { id: "likes",   label: "Likes",   icon: <Heart         className="w-3.5 h-3.5" /> },
];

type ProfilePageProps = {
  fid?: number;
  embedded?: boolean;
  onOpenSettings?: () => void;
};

export function ProfilePage({ fid: fidProp, embedded = false, onOpenSettings }: ProfilePageProps = {}) {
  const [, params] = useRoute("/profile/:fid");
  const [, navigate] = useLocation();
  const { fid: myFid, localSigner, signerUuid, signerApproved, neynarKey } = useWallet();
  const targetFid = fidProp ?? (params?.fid ? parseInt(params.fid, 10) : 0);
  const myFidNum = myFid ? Number(myFid) : 0;
  const isOwnProfile = targetFid === myFidNum;
  const isPro = useIsPro(targetFid);

  const [user, setUser] = useState<NeynarUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followSheet, setFollowSheet] = useState<"followers" | "following" | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<ProfileTab>("casts");
  const [tabs, setTabs] = useState<Record<ProfileTab, TabData>>({
    casts: BLANK_TAB, replies: BLANK_TAB, likes: BLANK_TAB, recasts: BLANK_TAB,
  });

  // Incremented every time the profile resets so stale in-flight responses are ignored.
  const profileGenRef = useRef(0);

  useEffect(() => {
    if (!showMoreMenu) return;
    function onOut(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node))
        setShowMoreMenu(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, [showMoreMenu]);

  const canWrite = signerApproved && (Boolean(localSigner) || Boolean(signerUuid)) && Boolean(myFid);

  const loadTab = useCallback(async (tab: ProfileTab, cursor?: string) => {
    const gen = profileGenRef.current;
    setTabs(prev => ({ ...prev, [tab]: { ...prev[tab], loading: true } }));
    try {
      let items: NeynarCast[] = [];
      let next: string | undefined;
      const vFid = myFidNum || targetFid;

      if (tab === "casts") {
        const r = await getUserCasts(targetFid, vFid, neynarKey, cursor);
        items = r.casts; next = r.next?.cursor;
      } else if (tab === "replies") {
        const r = await getUserReplies(targetFid, vFid, neynarKey, cursor);
        items = r.casts; next = r.next?.cursor;
      } else if (tab === "likes") {
        const r = await getUserLikes(targetFid, vFid, neynarKey, cursor);
        items = r.reactions.map(x => x.cast); next = r.next?.cursor;
      } else {
        const r = await getUserRecasts(targetFid, vFid, neynarKey, cursor);
        items = r.reactions.map(x => x.cast); next = r.next?.cursor;
      }

      if (gen !== profileGenRef.current) return; // stale — profile was reset during this request
      setTabs(prev => ({
        ...prev,
        [tab]: {
          items: cursor ? [...prev[tab].items, ...items] : items,
          cursor: next,
          loaded: true,
          loading: false,
        },
      }));
    } catch {
      if (gen !== profileGenRef.current) return;
      setTabs(prev => ({ ...prev, [tab]: { ...prev[tab], loading: false } }));
    }
  }, [targetFid, myFidNum, neynarKey]);

  useEffect(() => {
    if (!targetFid) return;
    profileGenRef.current += 1; // cancel any in-flight tab loads from previous profile
    setLoading(true);
    setUser(null);
    setProfileError(null);
    setFollowing(false);
    setActiveTab("casts");
    setTabs({ casts: BLANK_TAB, replies: BLANK_TAB, likes: BLANK_TAB, recasts: BLANK_TAB });

    getUserByFid(targetFid, myFidNum || targetFid, neynarKey)
      .then(res => {
        const u = res.users?.[0] ?? null;
        if (!u) setProfileError("User not found on Farcaster.");
        setUser(u);
        setFollowing(u?.viewer_context?.following ?? false);
        setLoading(false);
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : "Failed to load profile";
        // Auto-retry once after 1.5s (handles transient rate-limit errors)
        setTimeout(() => {
          getUserByFid(targetFid, myFidNum || targetFid, neynarKey)
            .then(res => {
              const u = res.users?.[0] ?? null;
              if (!u) setProfileError("User not found on Farcaster.");
              setUser(u);
              setFollowing(u?.viewer_context?.following ?? false);
            })
            .catch((e2: unknown) => {
              setProfileError((e2 instanceof Error ? e2.message : msg) + " — try refreshing.");
            })
            .finally(() => setLoading(false));
        }, 1500);
      });

    loadTab("casts");
  }, [targetFid, neynarKey, myFidNum]);

  useEffect(() => {
    if (!targetFid) return;
    if (tabs[activeTab].loaded || tabs[activeTab].loading) return;
    loadTab(activeTab);
  }, [activeTab, targetFid]);

  async function handleFollow() {
    if (!canWrite || !myFid) return;
    setFollowLoading(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    try {
      if (localSigner) {
        await hubFollow(Number(myFid), localSigner, targetFid, { unfollow: wasFollowing, neynarKey });
      } else if (signerUuid) {
        await neynarAction(signerUuid, { type: wasFollowing ? "unfollow" : "follow", targetFid });
      } else {
        throw new Error("Signer not ready");
      }
      toast.success(wasFollowing ? "Unfollowed" : "Now following");
    } catch (e: unknown) {
      setFollowing(wasFollowing);
      const msg = e instanceof Error ? e.message : wasFollowing ? "Unfollow failed" : "Follow failed";
      if (msg.includes("SIGNER_NOT_REGISTERED")) {
        toast.error("Signer not registered — go to Profile → Settings → Signer tab to register your key.");
      } else {
        toast.error(msg.slice(0, 120));
      }
    } finally {
      setFollowLoading(false);
    }
  }

  const extUser = user as NeynarUser & {
    profile?: { location?: { description?: string }; bio?: { text?: string } };
    verified_addresses?: { eth_addresses?: string[] };
  };

  const currentTab = tabs[activeTab];

  const sentinelRef = useInfiniteScroll(
    () => { if (currentTab.cursor) loadTab(activeTab, currentTab.cursor); },
    !!currentTab.cursor,
    currentTab.loading
  );

  return (
    <div className={embedded ? "" : "min-h-screen bg-background"}>

      {/* ── Sticky Header ── */}
      {!embedded && (
        <header className="sticky top-0 z-40 glass border-b border-border/50">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center">
            <button
              onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/"); }}
              className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            {user && (
              <span className="ml-2 font-semibold text-foreground text-[15px] truncate">
                {user.display_name || user.username}
              </span>
            )}
          </div>
        </header>
      )}

      <div className={embedded ? "" : "max-w-2xl mx-auto pb-24"}>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-28 gap-3">
            <div className="relative">
              <div className="w-14 h-14 rounded-full bg-primary/10 animate-pulse" />
              <Loader2 className="w-5 h-5 animate-spin text-primary absolute inset-0 m-auto" />
            </div>
            <p className="text-sm text-muted-foreground">Loading profile…</p>
          </div>
        ) : !user ? (
          <div className="flex flex-col items-center justify-center py-28 gap-3 text-muted-foreground px-6 text-center">
            <div className="w-16 h-16 rounded-full bg-muted/50 flex items-center justify-center">
              <User className="w-8 h-8 opacity-30" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {profileError ?? "User not found"}
            </p>
            <button
              onClick={() => {
                setLoading(true);
                setProfileError(null);
                getUserByFid(targetFid, myFidNum || targetFid, neynarKey)
                  .then(res => {
                    const u = res.users?.[0] ?? null;
                    if (!u) setProfileError("User not found on Farcaster.");
                    setUser(u);
                    setFollowing(u?.viewer_context?.following ?? false);
                  })
                  .catch((e: unknown) => setProfileError(e instanceof Error ? e.message : "Failed to load profile"))
                  .finally(() => setLoading(false));
              }}
              className="px-4 py-2 rounded-full text-sm font-medium text-primary border border-primary/25 hover:bg-primary/8 transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <>
            {/* ── Profile card ── */}
            <div className="px-5 pt-4">
              {/* Avatar + actions row */}
              <div className="flex items-start justify-between mb-3">
                {/* Avatar */}
                <div className="relative w-[82px] h-[82px] shrink-0">
                  <div className="w-full h-full rounded-full avatar-ring p-[3px] shadow-xl bg-background">
                    <div className="w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-primary/20 to-violet-500/20">
                      {user.pfp_url ? (
                        <img
                          src={user.pfp_url}
                          alt={user.display_name}
                          className="w-full h-full object-cover"
                          loading="eager"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <User className="w-8 h-8 text-primary/60" />
                        </div>
                      )}
                    </div>
                  </div>
                  {isPro && (
                    <span className="absolute bottom-0.5 right-0.5 drop-shadow-sm">
                      <ProBadge size={24} />
                    </span>
                  )}
                  {!isPro && hasPowerBadge(user) && (
                    <span className="absolute bottom-0.5 right-0.5 drop-shadow-sm">
                      <PowerBadgeIcon size={22} />
                    </span>
                  )}
                </div>

                {/* Follow + more menu */}
                <div className="flex items-center gap-2 mt-1">
                  {!isOwnProfile && canWrite && (
                    <button
                      onClick={handleFollow}
                      disabled={followLoading}
                      className={cn(
                        "flex items-center gap-1.5 px-5 py-2 rounded-full text-sm font-semibold transition-all border",
                        following
                          ? "bg-muted text-foreground border-border/60 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30"
                          : "btn-luxury text-white border-transparent"
                      )}
                    >
                      {followLoading
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : following
                          ? <><UserCheck className="w-4 h-4" />Following</>
                          : <><UserPlus className="w-4 h-4" />Follow</>
                      }
                    </button>
                  )}
                  <div className="relative" ref={moreMenuRef}>
                    <button
                      onClick={() => setShowMoreMenu(v => !v)}
                      className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border/60"
                    >
                      <MoreHorizontal className="w-5 h-5" />
                    </button>
                    {showMoreMenu && (
                      <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-2xl shadow-2xl z-50 min-w-[220px] py-1 overflow-hidden">
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(String(targetFid)).then(() => toast.success("FID copied"));
                            setShowMoreMenu(false);
                          }}
                          className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                        >
                          <span className="text-muted-foreground">FID</span>
                          <span className="font-mono font-semibold">{targetFid}</span>
                        </button>
                        {extUser.verified_addresses?.eth_addresses?.[0] && (
                          <button
                            onClick={() => {
                              const addr = extUser.verified_addresses!.eth_addresses![0];
                              navigator.clipboard.writeText(addr).then(() => toast.success("Address copied"));
                              setShowMoreMenu(false);
                            }}
                            className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                          >
                            <span className="font-mono text-xs text-muted-foreground">
                              {extUser.verified_addresses.eth_addresses[0].slice(0, 6)}…{extUser.verified_addresses.eth_addresses[0].slice(-4)}
                            </span>
                            <Copy className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                          </button>
                        )}
                        <div className="my-1 border-t border-border" />
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(`${window.location.origin}/profile/${targetFid}`).then(() => toast.success("Link copied"));
                            setShowMoreMenu(false);
                          }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                        >
                          <Copy className="w-4 h-4 text-muted-foreground" />
                          Copy link
                        </button>
                        {embedded && isOwnProfile && onOpenSettings && (
                          <>
                            <div className="my-1 border-t border-border" />
                            <button
                              onClick={() => { setShowMoreMenu(false); onOpenSettings(); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                            >
                              <Settings className="w-4 h-4 text-muted-foreground" />
                              Settings
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Name & handle */}
              <div className="space-y-0.5 mb-2">
                <h1 className="text-[21px] font-bold text-foreground leading-tight tracking-tight">
                  {user.display_name || user.username}
                </h1>
                <p className="text-sm font-medium text-primary">@{user.username}</p>
              </div>

              {/* Bio */}
              {extUser.profile?.bio?.text && (
                <p className="text-sm text-foreground/80 leading-relaxed mb-2.5">
                  {extUser.profile.bio.text}
                </p>
              )}

              {/* Meta */}
              {extUser.profile?.location?.description && (
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="w-3.5 h-3.5 text-primary/50" />
                    {extUser.profile.location.description}
                  </span>
                </div>
              )}

              {/* Stats bar */}
              <div className="flex items-center gap-1 pb-3 border-b border-border/40">
                <button
                  onClick={() => setFollowSheet("followers")}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors group text-left"
                >
                  <span className="font-bold text-foreground text-[15px] group-hover:text-primary transition-colors">
                    {user.follower_count.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground text-xs">followers</span>
                </button>
                <button
                  onClick={() => setFollowSheet("following")}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-accent/50 transition-colors group text-left"
                >
                  <span className="font-bold text-foreground text-[15px] group-hover:text-primary transition-colors">
                    {user.following_count.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground text-xs">following</span>
                </button>
              </div>
            </div>

            {/* ── Tabs ── */}
            <div className="flex border-b border-border/40 sticky top-14 z-30 bg-background/95 backdrop-blur-sm">
              {TAB_META.map(t => (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-1.5 py-3 text-xs font-semibold transition-colors relative",
                    activeTab === t.id
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.icon}
                  {t.label}
                  {activeTab === t.id && (
                    <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />
                  )}
                </button>
              ))}
            </div>

            {/* ── Tab content ── */}
            {currentTab.loading && currentTab.items.length === 0 ? (
              <div className="flex items-center justify-center py-14">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : currentTab.items.length === 0 && currentTab.loaded ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
                <p className="text-sm">Nothing here yet</p>
              </div>
            ) : (
              <>
                {currentTab.items.map((cast, i) => (
                  <CastCard key={`${cast.hash}-${i}`} cast={cast} viewerFid={myFidNum} />
                ))}
                {currentTab.cursor && (
                  <div ref={sentinelRef} className="flex justify-center py-6">
                    {currentTab.loading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {followSheet && user && (
        <FollowListSheet
          fid={targetFid}
          type={followSheet}
          count={followSheet === "followers" ? user.follower_count : user.following_count}
          onClose={() => setFollowSheet(null)}
          zIndex="z-50"
        />
      )}
    </div>
  );
}
