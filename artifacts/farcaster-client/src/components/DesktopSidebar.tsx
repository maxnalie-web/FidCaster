import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Home, Bell, Search, Wallet, User, TrendingUp, Tag, Hash, Sun, Moon,
  MoreHorizontal, UserCircle, PenSquare, Layers, Settings, ShieldCheck, Trophy,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useTheme } from "@/App";
import { isInstalledApp } from "@/lib/miniapp-native";
import { AddAccountModal, AccountDropdownPanel } from "@/components/AccountModals";
import { cn } from "@/lib/utils";

export type DesktopSidebarActive =
  | "feed" | "notifications" | "search" | "miniapps" | "wallet" | "profile"
  | "grow" | "market" | "channels" | "settings" | "points" | "admin";

/**
 * Persistent left nav for md+ viewports, shared by every top-level page.
 * DashboardPage.tsx has its own inline copy of this exact sidebar (with the
 * prominent "Cast" button) since it needs to drive its own tab state
 * directly rather than navigate by URL - but every OTHER top-level route
 * (Channels, Channel detail, FID Market, FID detail, Grow, Thread, the
 * standalone Profile route) rendered NO desktop sidebar at all, just a
 * centered content column with empty space on both sides and no way to
 * reach Cast/Home/Wallet/etc. without the mobile-only bottom nav - on a
 * wide viewport that's effectively "no navigation, no Cast button." This
 * mirrors DashboardPage's sidebar (reusing its AddAccountModal /
 * AccountDropdownPanel) but navigates via URL like BottomNav.tsx does.
 */
export function DesktopSidebar({ active, onCast }: { active: DesktopSidebarActive; onCast: () => void }) {
  const [, navigate] = useLocation();
  const {
    fid, profile, accounts, switchAccount, logout, removeAccount, addAccount,
    autoSignerLoading, signerApproved,
  } = useWallet();
  const [theme, setTheme] = useTheme();
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const fidNum = fid !== null ? Number(fid) : 0;
  const miniAppsAllowed = false;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const NAV_ITEMS: { id: DesktopSidebarActive; label: string; icon: typeof Home; onClick: () => void }[] = [
    { id: "feed", label: "Home", icon: Home, onClick: () => navigate("/dashboard?tab=feed") },
    { id: "notifications", label: "Notifications", icon: Bell, onClick: () => navigate("/dashboard?tab=notifications") },
    { id: "search", label: "Search", icon: Search, onClick: () => navigate("/dashboard?tab=search") },
    ...(miniAppsAllowed ? [{ id: "miniapps" as const, label: "Mini Apps", icon: Layers, onClick: () => navigate("/dashboard?tab=miniapps") }] : []),
    { id: "wallet" as const, label: "Wallet", icon: Wallet, onClick: () => navigate("/dashboard?tab=wallet") },
    { id: "profile", label: "Profile", icon: User, onClick: () => navigate("/dashboard?tab=profile") },
  ];

  return (
    <>
      <aside className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-[240px] border-r border-border bg-background z-40">
        {/* Logo */}
        <div className="px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <img
              src="/fidcaster-logo-v2.png"
              alt="FidCaster"
              className="w-11 h-11 object-contain logo-animated shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="fidcaster-brand font-extrabold text-[1.4rem]">FidCaster</span>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = active === item.id;
            return (
              <button
                key={item.id}
                onClick={item.onClick}
                className={cn("sidebar-item", isActive && "active")}
              >
                <Icon
                  className={cn("w-[22px] h-[22px] shrink-0", isActive ? "text-foreground" : "text-foreground/75")}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className={cn("text-[0.9375rem]", isActive ? "text-foreground" : "text-foreground/85")}>
                  {item.label}
                </span>
              </button>
            );
          })}

          <button onClick={() => navigate("/follow")} className={cn("sidebar-item", active === "grow" && "active")}>
            <TrendingUp className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
            <span className="text-[0.9375rem] text-foreground/85">Grow</span>
          </button>

          <button onClick={() => navigate("/market")} className={cn("sidebar-item", active === "market" && "active")}>
            <Tag className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
            <span className="text-[0.9375rem] text-foreground/85">FID Market</span>
          </button>

          <button onClick={() => navigate("/channels")} className={cn("sidebar-item", active === "channels" && "active")}>
            <Hash className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
            <span className="text-[0.9375rem] text-foreground/85">Channels</span>
          </button>

          <button onClick={() => navigate("/mini")} className={cn("sidebar-item", active === "points" && "active")}>
            <Trophy className={cn("w-[22px] h-[22px] shrink-0", active === "points" ? "text-foreground" : "text-foreground/75")} strokeWidth={active === "points" ? 2.5 : 2} />
            <span className={cn("text-[0.9375rem]", active === "points" ? "text-foreground" : "text-foreground/85")}>Points</span>
          </button>

          {fidNum === 16333 && (
            <button onClick={() => navigate("/admin")} className={cn("sidebar-item", active === "admin" && "active")}>
              <ShieldCheck className={cn("w-[22px] h-[22px] shrink-0", active === "admin" ? "text-foreground" : "text-foreground/75")} strokeWidth={active === "admin" ? 2.5 : 2} />
              <span className={cn("text-[0.9375rem]", active === "admin" ? "text-foreground" : "text-foreground/85")}>Admin</span>
            </button>
          )}

          <button onClick={() => navigate("/dashboard?tab=profile&section=settings")} className={cn("sidebar-item", active === "settings" && "active")}>
            <Settings className={cn("w-[22px] h-[22px] shrink-0", active === "settings" ? "text-foreground" : "text-foreground/75")} strokeWidth={active === "settings" ? 2.5 : 2} />
            <span className={cn("text-[0.9375rem]", active === "settings" ? "text-foreground" : "text-foreground/85")}>Settings</span>
          </button>

          <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")} className="sidebar-item">
            {theme === "dark"
              ? <Sun className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
              : <Moon className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />}
            <span className="text-[0.9375rem] text-foreground/85">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </nav>

        {/* Cast button */}
        <div className="px-4 pb-3">
          <button
            onClick={onCast}
            className="w-full py-3.5 rounded-full bg-primary text-white font-bold text-[0.9375rem] hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <PenSquare className="w-5 h-5" />
            Cast
          </button>
        </div>

        {/* Profile row (bottom) */}
        <div className="px-3 pb-4 relative" ref={accountMenuRef}>
          <div className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-full hover:bg-accent transition-colors">
            <button
              onClick={() => fidNum ? navigate(`/profile/${fidNum}`) : undefined}
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
            >
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-muted ring-1 ring-border">
                  {profile?.pfpUrl ? (
                    <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-primary/10">
                      <UserCircle className="w-5 h-5 text-primary/50" />
                    </div>
                  )}
                </div>
                <div title={autoSignerLoading ? "Registering signer…" : signerApproved ? "Signer active" : "Signer not registered · click Profile → Settings → Signer"} className={cn(
                  "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
                  autoSignerLoading ? "bg-amber-400 animate-pulse" : signerApproved ? "bg-emerald-500" : "bg-red-500"
                )} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate leading-tight">
                  {profile?.displayName || profile?.username || `FID ${fidNum}`}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  @{profile?.username || `fid${fidNum}`}
                </p>
              </div>
            </button>
            <button
              onClick={() => setShowAccountMenu((v) => !v)}
              className="shrink-0 p-1 rounded-full hover:bg-muted/60 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {showAccountMenu && (
            <AccountDropdownPanel
              accounts={accounts}
              currentFid={fidNum}
              onSwitch={(f) => { switchAccount(f); setShowAccountMenu(false); }}
              onAddAccount={() => { setShowAddAccount(true); setShowAccountMenu(false); }}
              onLogout={() => { logout(); setShowAccountMenu(false); }}
              onRemoveAccount={(f) => { void removeAccount(f); }}
            />
          )}
        </div>
      </aside>

      {showAddAccount && (
        <AddAccountModal onClose={() => setShowAddAccount(false)} onAdd={addAccount} />
      )}
    </>
  );
}
