import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { fetchMiniApps, type MiniApp } from "@/lib/farcaster-api";
import { isNativeRuntime, openNativeMiniApp } from "@/lib/miniapp-native";
import { useWallet } from "@/hooks/useWallet";
import { Loader2, RefreshCw, Layers, Search, UserCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── App card ──────────────────────────────────────────────────────────────── */
function AppCard({ app, index, onClick }: { app: MiniApp; index: number; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className="group w-full flex items-center gap-3 px-3 py-3.5 border-b border-border last:border-0 hover:bg-accent/40 transition-colors cursor-pointer"
    >
      {/* Rank */}
      <span className="w-6 shrink-0 text-xs text-muted-foreground/50 font-mono text-right">
        #{index + 1}
      </span>

      {/* Icon */}
      <div className="w-11 h-11 rounded-xl overflow-hidden bg-muted shrink-0">
        {app.iconUrl ? (
          <img
            src={app.iconUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-primary/10">
            <Layers className="w-5 h-5 text-primary/40" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 text-left">
        <p className="text-sm font-semibold text-foreground truncate">{app.name}</p>
        {app.description && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{app.description}</p>
        )}
        {app.author && (
          <div className="flex items-center gap-1 mt-0.5">
            {app.authorPfp ? (
              <img src={app.authorPfp} alt="" className="w-3.5 h-3.5 rounded-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
            ) : (
              <UserCircle className="w-3.5 h-3.5 text-muted-foreground/40" />
            )}
            <span className="text-[10px] text-primary truncate">by {app.author}</span>
          </div>
        )}
      </div>

      {/* Open button · explicit affordance instead of relying on the whole row being tappable */}
      <button
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        className="shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold bg-muted text-foreground hover:bg-accent-foreground/10 border border-border/60 transition-colors"
      >
        Open
      </button>
    </div>
  );
}

/* ─── MiniAppsPanel ──────────────────────────────────────────────────────────── */
export function MiniAppsPanel() {
  const [apps, setApps] = useState<MiniApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const { profile, address } = useWallet();
  const [, navigate] = useLocation();

  const load = useCallback(async () => {
    setLoading(true);
    setApps([]); // clear stale results
    try {
      const result = await fetchMiniApps();
      setApps(result);
    } finally {
      setLoading(false);
    }
  }, []);

  // Native (Capacitor APK/iOS) opens the app in a native WebView. On web there is
  // no in-app mini-app browser · apps run only in the native/PWA build · so a tap
  // just opens the app in a new tab.
  const openApp = useCallback(async (app: MiniApp) => {
    if (isNativeRuntime()) {
      try { if (await openNativeMiniApp(app, { profile, address, navigate })) return; } catch { /* fall back to new tab */ }
    }
    window.open(app.url, "_blank", "noopener,noreferrer");
  }, [profile, address, navigate]);

  useEffect(() => { void load(); }, [load]);

  const filtered = apps.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.category.toLowerCase().includes(search.toLowerCase())
  );

  const CATEGORIES = ["All", ...Array.from(new Set(apps.map((a) => a.category)))];
  const displayed = activeCategory === "All"
    ? filtered
    : filtered.filter((a) => a.category === activeCategory);

  return (
    <>
      {/* Panel */}
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold text-foreground">Mini Apps</h2>
            <button
              onClick={() => void load()}
              disabled={loading}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
          {/* Search */}
          <div className="relative mb-2.5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search apps…"
              className="w-full pl-8 pr-3 py-2 text-sm bg-muted/40 border border-border rounded-xl text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
            />
          </div>
          {/* Category tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {CATEGORIES.map((cat) => {
              const count = cat === "All" ? apps.length : apps.filter(a => a.category === cat).length;
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={cn(
                    "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap",
                    isActive
                      ? "bg-primary text-white shadow-sm shadow-primary/30"
                      : "text-muted-foreground border border-border/60 hover:border-primary/30 hover:text-foreground hover:bg-primary/5"
                  )}
                >
                  {cat}
                  {count > 0 && (
                    <span className={cn(
                      "text-[10px] font-bold leading-none px-1.5 py-0.5 rounded-full min-w-[18px] text-center",
                      isActive ? "bg-white/25 text-white" : "bg-muted text-muted-foreground"
                    )}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* App list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
          ) : displayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 gap-2 text-muted-foreground">
              <Layers className="w-8 h-8 opacity-30" />
              <p className="text-sm">No apps found</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {displayed.map((app, i) => (
                <AppCard key={app.id} app={app} index={i} onClick={() => void openApp(app)} />
              ))}
            </div>
          )}
        </div>
      </div>

    </>
  );
}
