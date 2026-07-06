import { useLocation } from "wouter";
import { Home, Search, Layers, Bell, TrendingUp, Tag, User, Wallet } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { useAdminConfig } from "@/hooks/useAdminConfig";
import { isInstalledApp } from "@/lib/miniapp-native";
import { cn } from "@/lib/utils";

/**
 * Standalone bottom nav · mirrors DashboardPage's mobile nav bar exactly, but
 * works from ANY top-level route (not just inside the dashboard tab shell).
 * Standalone pages like Grow (/follow) render their own full-screen layout,
 * which used to mean navigating there lost the bottom nav entirely · there was
 * no way back to Home/Search/etc. without hitting the page's own back arrow.
 * This renders the same bar there too, driving navigation via URL (dashboard
 * tabs are ?tab=-addressable) so active-state highlighting still works.
 */
export function BottomNav({ active }: { active?: "grow" | "market" }) {
  const [, navigate] = useLocation();
  const { fid, neynarKey, authMethod } = useWallet();
  const { unread: unreadNotifs } = useUnreadNotifications(Number(fid ?? 0), neynarKey ?? "");
  const [adminCfg] = useAdminConfig();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-30 flex h-[54px]">
      <button onClick={() => navigate("/dashboard?tab=feed")} className="flex-1 flex items-center justify-center transition-colors">
        <Home className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
      </button>
      <button onClick={() => navigate("/dashboard?tab=search")} className="flex-1 flex items-center justify-center transition-colors">
        <Search className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
      </button>
      {isInstalledApp() && adminCfg.features.miniAppsEnabled && (
        <button onClick={() => navigate("/dashboard?tab=miniapps")} className="flex-1 flex items-center justify-center transition-colors">
          <Layers className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
        </button>
      )}
      {adminCfg.features.growEnabled !== false && (
        <button onClick={() => navigate("/follow")} className="flex-1 flex items-center justify-center transition-colors">
          <TrendingUp className={cn("w-6 h-6", active === "grow" ? "text-primary" : "text-muted-foreground")} strokeWidth={active === "grow" ? 2.5 : 2} />
        </button>
      )}
      <button onClick={() => navigate("/market")} className="flex-1 flex items-center justify-center transition-colors">
        <Tag className={cn("w-6 h-6", active === "market" ? "text-primary" : "text-muted-foreground")} strokeWidth={active === "market" ? 2.5 : 2} />
      </button>
      {authMethod === "mnemonic" && (
        <button onClick={() => navigate("/dashboard?tab=wallet")} className="flex-1 flex items-center justify-center transition-colors">
          <Wallet className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
        </button>
      )}
      <button onClick={() => navigate("/dashboard?tab=notifications")} className="flex-1 flex items-center justify-center transition-colors">
        <span className="relative">
          <Bell className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
          {unreadNotifs > 0 && (
            <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none flex items-center justify-center ring-2 ring-background">
              {unreadNotifs > 9 ? "9+" : unreadNotifs}
            </span>
          )}
        </span>
      </button>
      <button onClick={() => navigate("/dashboard?tab=profile")} className="flex-1 flex items-center justify-center transition-colors">
        <User className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
      </button>
    </nav>
  );
}
