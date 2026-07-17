import { useState, useEffect, useCallback, useRef } from "react";
import { useIsPro, ProBadge } from "@/components/ProBadge";
import { X, Loader2, UserPlus, UserMinus, Users, ExternalLink } from "lucide-react";
import { useLocation } from "wouter";
import { useWallet } from "@/hooks/useWallet";
import { getUserByFid, getUserCasts, type NeynarUser, type NeynarCast } from "@/lib/neynar";
import { hubFollow, neynarAction } from "@/lib/hub-submit";
import { CastCard } from "./CastCard";
import { FollowListSheet } from "./FollowListSheet";
import { cn } from "@/lib/utils";

type Props = {
  user: NeynarUser | null;
  onClose: () => void;
  onViewProfile?: (user: NeynarUser) => void;
  zIndex?: string;
};

export function UserProfileSheet({ user, onClose, onViewProfile, zIndex = "z-50" }: Props) {
  const { fid, localSigner, signerUuid, signerApproved, neynarKey } = useWallet();
  const [, navigate] = useLocation();
  const viewerFid = fid ? Number(fid) : 0;

  const [profile, setProfile] = useState<NeynarUser | null>(user);
  const [casts, setCasts] = useState<NeynarCast[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(user?.viewer_context?.following ?? false);
  const [followLoading, setFollowLoading] = useState(false);
  const followReqIdRef = useRef(0);
  const [followSheet, setFollowSheet] = useState<"followers" | "following" | null>(null);

  const canWrite = signerApproved && (Boolean(localSigner) || Boolean(signerUuid)) && Boolean(fid);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [profileRes, castsRes] = await Promise.all([
        getUserByFid(user.fid, viewerFid, neynarKey),
        getUserCasts(user.fid, viewerFid, neynarKey),
      ]);
      const p = profileRes.users?.[0] ?? user;
      setProfile(p);
      setFollowing(p.viewer_context?.following ?? false);
      setCasts(castsRes.casts ?? []);
    } catch {
      setCasts([]);
    } finally {
      setLoading(false);
    }
  }, [user?.fid, viewerFid, neynarKey]);

  useEffect(() => {
    setProfile(user);
    setCasts([]);
    setFollowing(user?.viewer_context?.following ?? false);
    load();
  }, [user?.fid]);

  async function handleFollow() {
    if (!canWrite || !fid || !profile) return;
    const reqId = ++followReqIdRef.current;
    setFollowLoading(true);
    const wasFollowing = following;
    setFollowing(!wasFollowing);
    try {
      if (localSigner) {
        await hubFollow(Number(fid), localSigner, profile.fid, { unfollow: wasFollowing, neynarKey });
      } else if (signerUuid) {
        await neynarAction(signerUuid, { type: wasFollowing ? "unfollow" : "follow", targetFid: profile.fid });
      }
    } catch {
      if (followReqIdRef.current !== reqId) return;
      setFollowing(wasFollowing);
    } finally {
      if (followReqIdRef.current === reqId) setFollowLoading(false);
    }
  }

  if (!user) return null;

  const isOwnProfile = profile?.fid === viewerFid;

  return (
    <div className={`fixed inset-0 ${zIndex} flex`}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative ml-auto w-full max-w-md h-full bg-background border-l border-border flex flex-col shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border shrink-0">
          <button
            onClick={() => { onClose(); navigate(`/profile/${user.fid}`); }}
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground/80 hover:text-primary transition-colors"
          >
            Profile <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {profile && (
            <div className="p-5 border-b border-border space-y-4">
              <div className="flex items-start gap-4">
                <div className="relative w-16 h-16 shrink-0">
                  <div className="w-16 h-16 rounded-full overflow-hidden bg-primary/10 ring-2 ring-border">
                    {profile.pfp_url ? (
                      <img src={profile.pfp_url} alt={profile.display_name} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Users className="w-7 h-7 text-primary/50" />
                      </div>
                    )}
                  </div>
                  {useIsPro(profile.fid) && (
                    <span className="absolute bottom-0 right-0 drop-shadow-sm">
                      <ProBadge size={20} />
                    </span>
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-bold text-base text-foreground truncate">{profile.display_name}</p>
                  <p className="text-sm text-muted-foreground">@{profile.username}</p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">FID {profile.fid}</p>
                </div>

                {!isOwnProfile && canWrite && (
                  <button
                    onClick={handleFollow}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all shrink-0",
                      following
                        ? "bg-muted/60 text-foreground border border-border hover:text-destructive hover:border-destructive/30"
                        : "btn-luxury text-primary-foreground"
                    )}
                  >
                    {followLoading ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : following ? (
                      <><UserMinus className="w-3.5 h-3.5" />Unfollow</>
                    ) : (
                      <><UserPlus className="w-3.5 h-3.5" />Follow</>
                    )}
                  </button>
                )}
              </div>

              {profile.profile?.bio?.text && (
                <p className="text-sm text-foreground/80 leading-relaxed">{profile.profile.bio.text}</p>
              )}

              <div className="flex gap-5 text-sm">
                <button
                  onClick={() => setFollowSheet("followers")}
                  className="hover:text-primary transition-colors text-left"
                >
                  <span className="font-bold text-foreground">{profile.follower_count.toLocaleString()}</span>
                  <span className="text-muted-foreground ml-1">followers</span>
                </button>
                <button
                  onClick={() => setFollowSheet("following")}
                  className="hover:text-primary transition-colors text-left"
                >
                  <span className="font-bold text-foreground">{profile.following_count.toLocaleString()}</span>
                  <span className="text-muted-foreground ml-1">following</span>
                </button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : casts.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">No casts yet</div>
          ) : (
            <div>
              {casts.map((cast) => (
                <CastCard
                  key={cast.hash}
                  cast={cast}
                  viewerFid={viewerFid}
                  compact
                  onViewProfile={onViewProfile}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {followSheet && profile && (
        <FollowListSheet
          fid={profile.fid}
          type={followSheet}
          count={followSheet === "followers" ? profile.follower_count : profile.following_count}
          onClose={() => setFollowSheet(null)}
          zIndex="z-[60]"
        />
      )}
    </div>
  );
}
