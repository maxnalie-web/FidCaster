import { useState, useEffect, useRef, useCallback } from "react";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useRoute, useLocation } from "wouter";
import {
  ArrowLeft, User, Loader2, UserPlus, UserCheck, UserMinus,
  MapPin, Check, MoreHorizontal, Copy, Settings,
  AlignLeft, MessageSquare, Heart, Repeat2, X, Zap,
  Camera, CheckCircle2, AlertCircle, ChevronRight,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useIsPro, ProBadge } from "@/components/ProBadge";
import { useAdminConfig } from "@/hooks/useAdminConfig";

import {
  getUserByFid, getUserCasts, getUserReplies, getUserLikes, getUserRecasts,
  hasPowerBadge, getFollowing, type NeynarUser, type NeynarCast,
} from "@/lib/neynar";
import { PowerBadgeIcon } from "@/components/PowerBadgeIcon";
import { hubFollow, neynarAction, hubUpdateUserData } from "@/lib/hub-submit";
import type { LocalSigner } from "@/lib/wallet";
import { CastCard } from "@/components/CastCard";
import { FollowListSheet } from "@/components/FollowListSheet";
import { BatchFollowSheet } from "@/components/BatchFollowSheet";
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
  onOpenSettings?: (tab?: "username" | "signer" | "profile") => void;
};

/* ─── Inline Edit Sheet ──────────────────────────────────────────────────── */
function EditSheet({
  profile,
  fid,
  localSigner,
  signerApproved,
  onClose,
  onChangeUsername,
}: {
  profile: { pfpUrl?: string; displayName?: string; bio?: string; username?: string } | null;
  fid: bigint | null;
  localSigner: LocalSigner | null;
  signerApproved: boolean;
  onClose: () => void;
  onChangeUsername: () => void;
}) {
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [pfpUrl, setPfpUrl] = useState(profile?.pfpUrl || "");
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveField(field: "pfp" | "display" | "bio", value: string) {
    if (!fid || !localSigner || !signerApproved) return;
    if (!value.trim()) { toast.error("Cannot be empty"); return; }
    setSaving(field);
    setError(null);
    setSuccess(null);
    try {
      await hubUpdateUserData(Number(fid), localSigner, field, value.trim());
      setSuccess(field === "pfp" ? "Profile picture updated!" : field === "display" ? "Display name updated!" : "Bio updated!");
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(null);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving("pfp-upload");
    setError(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/farcaster/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, type: file.type }),
      });
      if (!res.ok) throw new Error("Upload failed");
      const { url } = await res.json() as { url: string };
      setPfpUrl(url);
      await saveField("pfp", url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setSaving(null);
    }
  }

  const isSaving = !!saving;

  return (
    <div className="fixed inset-0 z-[80] bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
        <button
          onClick={onClose}
          className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-base font-bold">Edit profile</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!signerApproved || !localSigner ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center px-6">
            <AlertCircle className="w-8 h-8 text-amber-500 opacity-60" />
            <p className="text-sm text-muted-foreground">Signer must be active to edit your profile.</p>
          </div>
        ) : (
          <div className="p-5 space-y-6 max-w-lg mx-auto">
            <div className="space-y-3">
              <label className="text-[10px] font-bold uppercase tracking-widest text-foreground">Profile Picture</label>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full overflow-hidden bg-muted border border-border shrink-0">
                  {pfpUrl ? (
                    <img src={pfpUrl} alt="pfp" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-7 h-7 text-muted-foreground/40" />
                    </div>
                  )}
                </div>
                <div className="flex-1 space-y-2">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={handleFileUpload} />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={isSaving}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-40"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    {saving === "pfp-upload" ? "Uploading…" : "Upload Photo"}
                  </button>
                  <div className="flex gap-2">
                    <input
                      value={pfpUrl}
                      onChange={e => setPfpUrl(e.target.value)}
                      placeholder="Or paste image URL…"
                      className="flex-1 px-3 py-2 text-xs rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    <button
                      onClick={() => saveField("pfp", pfpUrl)}
                      disabled={isSaving || !pfpUrl.startsWith("https://")}
                      className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-40 hover:bg-primary/90 shrink-0"
                    >
                      {saving === "pfp" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-foreground">Display Name</label>
              <div className="flex gap-2">
                <input
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  maxLength={32}
                  placeholder="Your display name…"
                  className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
                <button
                  onClick={() => saveField("display", displayName)}
                  disabled={isSaving || !displayName.trim()}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-40 hover:bg-primary/90 shrink-0"
                >
                  {saving === "display" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">{displayName.length}/32</p>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-foreground">Bio</label>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                maxLength={256}
                rows={3}
                placeholder="Tell the world about yourself…"
                className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none leading-relaxed"
              />
              <div className="flex justify-between items-center">
                <p className="text-[10px] text-muted-foreground">{bio.length}/256</p>
                <button
                  onClick={() => saveField("bio", bio)}
                  disabled={isSaving || !bio.trim()}
                  className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold disabled:opacity-40 hover:bg-primary/90"
                >
                  {saving === "bio" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Bio"}
                </button>
              </div>
            </div>

            <button
              onClick={onChangeUsername}
              className="w-full flex items-center justify-between py-3.5 px-4 rounded-xl bg-muted/40 border border-border/60 hover:bg-accent transition-colors group"
            >
              <div className="text-left">
                <p className="text-xs font-bold text-foreground uppercase tracking-wide">Username</p>
                <p className="text-sm text-muted-foreground mt-0.5">@{profile?.username || "—"}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </button>

            {success && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20 text-emerald-600 text-xs font-semibold">
                <CheckCircle2 className="w-4 h-4 shrink-0" /> {success}
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/8 border border-red-500/20 text-red-500 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" /> {error}
              </div>
            )}

            <p className="text-[10px] text-muted-foreground/60 text-center pb-4">
              Profile changes are submitted to the Farcaster hub and may take a few minutes to appear.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function ProfilePage({ fid: fidProp, embedded = false, onOpenSettings }: ProfilePageProps = {}) {
  const [, params] = useRoute("/profile/:fid");
  const [, navigate] = useLocation();
  const { fid: myFid, localSigner, signerUuid, signerApproved, neynarKey, profile: myProfile } = useWallet();
  const targetFid = fidProp ?? (params?.fid ? parseInt(params.fid, 10) : 0);
  const myFidNum = myFid ? Number(myFid) : 0;
  const isOwnProfile = targetFid === myFidNum;
  const isPro = useIsPro(targetFid);
  const [adminCfg] = useAdminConfig();
  const canBatchOps = isOwnProfile && signerApproved && Boolean(localSigner) &&
    (adminCfg.privilegedUsers.some(u => u.toLowerCase() === myProfile?.username?.toLowerCase()) ||
     adminCfg.privilegedUsers.some(u => u === String(myFidNum)));

  const [user, setUser] = useState<NeynarUser | null>(null);
  const [showAvatarLightbox, setShowAvatarLightbox] = useState(false);
  const [showBatchSheet, setShowBatchSheet] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [following, setFollowing] = useState(false);
  const [followLoading, setFollowLoading] = useState(false);
  const [followSheet, setFollowSheet] = useState<"followers" | "following" | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showEditSheet, setShowEditSheet] = useState(false);
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

      if (gen !== profileGenRef.current) return; // stale · profile was reset during this request
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
              setProfileError((e2 instanceof Error ? e2.message : msg) + " · try refreshing.");
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
        toast.error("Signer not registered · go to Profile → Settings → Signer tab to register your key.");
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
            {/* ── Banner ── */}
            <div className="relative w-full h-32 overflow-hidden bg-gradient-to-br from-primary/20 via-violet-400/10 to-indigo-400/15">
              {user.pfp_url && (
                <img
                  src={user.pfp_url}
                  aria-hidden
                  className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-50"
                />
              )}
              <div className="absolute inset-0 bg-background/25" />
            </div>

            {/* ── Profile card ── */}
            <div className="px-4">
              {/* Avatar + actions row */}
              <div className="flex items-end justify-between -mt-3 mb-3">
                {/* Avatar */}
                <div className="relative w-[82px] h-[82px] shrink-0">
                  <button
                    onClick={() => user.pfp_url && setShowAvatarLightbox(true)}
                    className={cn(
                      "w-full h-full rounded-full avatar-ring p-[3px] shadow-xl bg-background",
                      user.pfp_url && "cursor-pointer hover:opacity-90 active:scale-95 transition-all"
                    )}
                  >
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
                  </button>
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

                {/* Action buttons */}
                <div className="flex items-center gap-2 pb-1">
                  {isOwnProfile ? (
                    <>
                      <button
                        onClick={() => setShowEditSheet(true)}
                        className="px-4 py-2 rounded-full text-sm font-semibold bg-muted text-foreground border border-border/60 hover:bg-accent transition-colors"
                      >
                        Edit profile
                      </button>
                      <div className="relative" ref={moreMenuRef}>
                        <button
                          onClick={() => setShowMoreMenu(v => !v)}
                          className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border border-border/60"
                        >
                          <MoreHorizontal className="w-5 h-5" />
                        </button>
                        {showMoreMenu && (
                          <div className="absolute right-0 top-full mt-1 bg-popover border border-border rounded-2xl shadow-2xl z-50 min-w-[200px] py-1 overflow-hidden">
                            <button
                              onClick={() => { navigator.clipboard.writeText(String(targetFid)).then(() => toast.success("FID copied")); setShowMoreMenu(false); }}
                              className="w-full flex items-center justify-between gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                            >
                              <span className="text-muted-foreground">FID</span>
                              <span className="font-mono font-semibold">{targetFid}</span>
                            </button>
                            <div className="my-1 border-t border-border" />
                            <button
                              onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/profile/${targetFid}`).then(() => toast.success("Link copied")); setShowMoreMenu(false); }}
                              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground hover:bg-accent transition-colors"
                            >
                              <Copy className="w-4 h-4 text-muted-foreground" />
                              Copy link
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      {canWrite && (
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
                          </div>
                        )}
                      </div>
                    </>
                  )}
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

            {canBatchOps && (
              <div className="px-4 mt-3">
                <button
                  onClick={() => setShowBatchSheet(true)}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Zap className="w-4 h-4 text-primary" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-foreground">Batch Unfollow</p>
                      <p className="text-xs text-muted-foreground">Smart cleanup tools</p>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            )}

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

      {/* ── Edit Profile Sheet ── */}
      {showEditSheet && (
        <EditSheet
          profile={myProfile}
          fid={myFid}
          localSigner={localSigner}
          signerApproved={signerApproved}
          onClose={() => setShowEditSheet(false)}
          onChangeUsername={() => {
            setShowEditSheet(false);
            if (onOpenSettings) onOpenSettings("username");
            else navigate("/dashboard?tab=profile");
          }}
        />
      )}

      {/* ── Avatar Lightbox (popup) ── */}
      {showAvatarLightbox && user?.pfp_url && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowAvatarLightbox(false)}
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={user.pfp_url}
              alt={user.display_name || user.username}
              className="w-[min(320px,80vw)] h-[min(320px,80vw)] rounded-full object-cover shadow-2xl ring-4 ring-white/20"
            />
            <button
              onClick={() => setShowAvatarLightbox(false)}
              className="absolute -top-2 -right-2 p-1.5 rounded-full bg-background border border-border text-foreground hover:bg-muted shadow-lg transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showBatchSheet && localSigner && (
        <BatchFollowSheet
          mode="unfollow"
          sourceFid={myFidNum}
          myFid={myFidNum}
          localSigner={localSigner}
          neynarKey={neynarKey ?? ""}
          onClose={() => setShowBatchSheet(false)}
          zIndex="z-[200]"
        />
      )}

    </div>
  );
}
