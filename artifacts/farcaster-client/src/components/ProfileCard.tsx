import { useState, useRef, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import { LogOut, User, Globe, RefreshCw, MoreHorizontal, Copy, Check } from "lucide-react";
import { FollowListSheet } from "./FollowListSheet";

export function ProfileCard() {
  const { profile, address, fid, logout, refreshProfile } = useWallet();
  const [followSheet, setFollowSheet] = useState<"followers" | "following" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState<"fid" | "address" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const hasProfile = profile && !profile.username.startsWith("!") && !/^\d+$/.test(profile.username);
  const fidNum = fid ? Number(fid) : 0;

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshProfile(); } finally { setRefreshing(false); }
  };

  const handleCopy = async (type: "fid" | "address", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(type);
    setTimeout(() => setCopied(null), 1500);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  return (
    <>
      <div className="relative">
        <div
          className="absolute -inset-6 rounded-3xl opacity-30 blur-3xl pointer-events-none"
          style={{
            background: "radial-gradient(ellipse at 25% 35%, hsl(263 78% 62% / 0.4) 0%, transparent 60%), radial-gradient(ellipse at 80% 65%, hsl(280 65% 60% / 0.25) 0%, transparent 55%)",
          }}
        />

        <div className="relative">
          {/* Top row: Avatar + actions */}
          <div className="flex items-start justify-between mb-4">
            <div className="relative">
              <div className="w-[72px] h-[72px] rounded-full avatar-ring p-[3px] shadow-xl">
                <div className="w-full h-full rounded-full overflow-hidden bg-gradient-to-br from-primary/20 to-violet-500/20">
                  {profile?.pfpUrl ? (
                    <img
                      src={profile.pfpUrl}
                      alt={profile.displayName || "Profile"}
                      className="w-full h-full object-cover"
                      loading="eager"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-7 h-7 text-primary/60" />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1 pt-1">
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                title="Refresh profile"
                className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors disabled:opacity-40"
              >
                <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
              </button>

              {/* More menu */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  title="More info"
                  className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-52 bg-popover border border-border rounded-xl shadow-xl z-50 py-1.5 overflow-hidden">
                    {/* FID row */}
                    <button
                      onClick={() => fid && handleCopy("fid", String(fid))}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-accent/50 transition-colors group"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-[10px] font-bold text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded-md">FID</span>
                        <span className="text-sm font-mono font-semibold text-foreground">{fid?.toString()}</span>
                      </div>
                      <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                        {copied === "fid" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </span>
                    </button>

                    {/* Address row */}
                    {address && (
                      <button
                        onClick={() => handleCopy("address", address)}
                        className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-accent/50 transition-colors group"
                      >
                        <div className="flex items-center gap-2.5">
                          <Globe className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                          <span className="text-sm font-mono text-foreground">
                            {address.slice(0, 6)}…{address.slice(-4)}
                          </span>
                        </div>
                        <span className="text-muted-foreground group-hover:text-foreground transition-colors">
                          {copied === "address" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </span>
                      </button>
                    )}

                    <div className="h-px bg-border/50 mx-2 my-1" />

                    <button
                      onClick={() => { logout(); setMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-destructive hover:bg-destructive/8 transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Name & handle */}
          <div className="mb-2">
            <h2 className="text-[19px] font-bold text-foreground leading-tight tracking-tight">
              {hasProfile ? profile.displayName : `FID ${fid?.toString()}`}
            </h2>
            <p className="text-sm font-medium text-primary mt-0.5">
              {hasProfile ? `@${profile.username}` : `@fid${fid?.toString()}`}
            </p>
          </div>

          {/* Bio */}
          {profile?.bio && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2 mb-3">
              {profile.bio}
            </p>
          )}

          {/* Stats */}
          {hasProfile && (profile.followerCount > 0 || profile.followingCount > 0) && (
            <div className="flex items-center gap-1 pt-3 border-t border-border/40">
              <button
                onClick={() => setFollowSheet("followers")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-accent/50 transition-colors group"
              >
                <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                  {profile.followerCount.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">followers</span>
              </button>
              <button
                onClick={() => setFollowSheet("following")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg hover:bg-accent/50 transition-colors group"
              >
                <span className="font-bold text-sm text-foreground group-hover:text-primary transition-colors">
                  {profile.followingCount.toLocaleString()}
                </span>
                <span className="text-xs text-muted-foreground">following</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {followSheet && fid && (
        <FollowListSheet
          fid={fidNum}
          type={followSheet}
          count={followSheet === "followers" ? (profile?.followerCount ?? 0) : (profile?.followingCount ?? 0)}
          onClose={() => setFollowSheet(null)}
          zIndex="z-50"
        />
      )}
    </>
  );
}
