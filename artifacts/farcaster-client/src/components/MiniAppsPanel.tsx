import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { fetchMiniApps, type MiniApp } from "@/lib/farcaster-api";
import { isNativeRuntime, openNativeMiniApp } from "@/lib/miniapp-native";
import { openWebMiniApp } from "@/lib/miniapp-web-state";
import {
  getAddedMiniApps, subscribeAddedMiniApps, removeMiniAppFromStore, type AddedMiniApp,
} from "@/lib/miniapp-added-store";
import { useWallet } from "@/hooks/useWallet";
import { useMarketWallet } from "@/hooks/useMarketWallet";
import { Loader2, RefreshCw, Layers, Search, UserCircle, X, Wallet, Link2 } from "lucide-react";
import { cn } from "@/lib/utils";

function addedAppToMiniApp(a: AddedMiniApp): MiniApp {
  return { id: a.origin, name: a.name, description: "", iconUrl: a.iconUrl ?? "", url: a.origin, category: "Added" };
}

/* ─── Your Apps row · apps added via sdk.actions.addMiniApp() ────────────── */
function YourAppsRow({ apps, onOpen }: { apps: AddedMiniApp[]; onOpen: (app: MiniApp) => void }) {
  if (apps.length === 0) return null;
  return (
    <div className="px-4 py-3 border-b border-border">
      <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Your Apps</p>
      <div className="flex gap-3 overflow-x-auto no-scrollbar">
        {apps.map((a) => (
          <div key={a.origin} className="relative shrink-0 w-14 group">
            <button
              onClick={() => onOpen(addedAppToMiniApp(a))}
              className="w-14 h-14 rounded-2xl overflow-hidden bg-muted shadow-sm ring-1 ring-border/40"
            >
              {a.iconUrl ? (
                <img src={a.iconUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-primary/10">
                  <Layers className="w-5 h-5 text-primary/40" />
                </div>
              )}
            </button>
            <button
              onClick={() => removeMiniAppFromStore(a.origin)}
              aria-label={`Remove ${a.name}`}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-background border border-border shadow flex items-center justify-center text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
            <p className="text-[10px] text-center text-muted-foreground mt-1 truncate">{a.name}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Connect-wallet banner ─────────────────────────────────────────────────
 * Shown when there's no wallet address to hand mini apps at all — e.g. a
 * "Sign In With Farcaster" (Warpcast QR) login, which is read-only and never
 * links an EVM wallet. Per Farcaster's own mini-app spec, the HOST is
 * responsible for getting the user connected before a mini app even asks
 * (mini apps aren't supposed to show their own wallet-selector dialog) — so
 * rather than silently handing mini apps a null address and letting every
 * wallet-dependent feature in them quietly fail, this offers the same
 * ad-hoc "connect a wallet without changing your Farcaster login" flow FID
 * Market's buy button already uses (useMarketWallet), independent of
 * whatever authMethod actually signed the user in. Dismissible per session
 * (not persisted) since plenty of mini apps don't need a wallet at all. */
function ConnectWalletBanner({
  onConnect, onConnectWalletConnect, hasInjected, connecting, error, onDismiss,
}: {
  /** Auto-picks MetaMask if available, else WalletConnect (useMarketWallet's connect()). */
  onConnect: () => void;
  onConnectWalletConnect: () => void;
  hasInjected: boolean;
  connecting: boolean;
  error: string | null;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-4 mt-3 p-3 rounded-2xl border border-primary/20 bg-primary/[0.04]">
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <Wallet className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-foreground">No wallet connected</p>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            Some mini apps need a wallet to detect your account or complete an action.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={onConnect}
              disabled={connecting}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold btn-luxury text-primary-foreground disabled:opacity-60"
            >
              {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
              {hasInjected ? "MetaMask" : "Connect"}
            </button>
            {hasInjected && (
              <button
                onClick={onConnectWalletConnect}
                disabled={connecting}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-border text-foreground hover:bg-accent transition-colors disabled:opacity-60"
              >
                <Link2 className="w-3.5 h-3.5" />
                WalletConnect
              </button>
            )}
          </div>
          {error && <p className="text-[11px] text-red-500 mt-1.5">{error}</p>}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="p-1 text-muted-foreground hover:text-foreground shrink-0">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ─── App card ──────────────────────────────────────────────────────────────── */
function AppCard({ app, index, opening, onClick }: { app: MiniApp; index: number; opening: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className="group w-full flex items-center gap-3 p-3 rounded-2xl border border-transparent hover:border-border/60 hover:bg-accent/30 transition-colors cursor-pointer"
    >
      {/* Rank */}
      <span className="w-5 shrink-0 text-xs text-muted-foreground/40 font-mono text-right">
        {index + 1}
      </span>

      {/* Icon */}
      <div className="w-12 h-12 rounded-2xl overflow-hidden bg-muted shrink-0 shadow-sm ring-1 ring-border/40">
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
        disabled={opening}
        className="shrink-0 w-[68px] flex items-center justify-center px-4 py-1.5 rounded-full text-xs font-semibold btn-luxury text-primary-foreground shadow-sm disabled:opacity-60"
      >
        {opening ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Open"}
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
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [addedApps, setAddedApps] = useState<AddedMiniApp[]>(getAddedMiniApps);
  const { profile, address, walletClient } = useWallet();
  const {
    wallet: extWallet, connect: connectWallet, connectWalletConnect, connecting: extConnecting,
    hasInjected, error: extWalletError,
  } = useMarketWallet();
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [, navigate] = useLocation();

  // Falls back to an ad-hoc-connected wallet (useMarketWallet) when the
  // user's actual login has none — see ConnectWalletBanner above for why.
  const effectiveAddress = address ?? extWallet?.address ?? null;
  const effectiveWalletClient = walletClient ?? extWallet?.walletClient ?? null;

  useEffect(() => subscribeAddedMiniApps(setAddedApps), []);

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

  // Native (Capacitor APK/iOS) opens the app in a native WebView with a real
  // SDK bridge. On web/PWA, opens it in an in-app iframe modal with the same
  // real Farcaster context + wallet exposed (see miniapp-iframe-host.ts) —
  // previously a bare window.open() with nothing injected, indistinguishable
  // from just visiting the site.
  const openApp = useCallback(async (app: MiniApp) => {
    // Guards against a slow-loading remote mini-app site making a repeated tap
    // stack a second openWebView() call (and a second SDK bridge/listener) on
    // top of the first one before it's finished opening.
    if (openingId) return;
    setOpeningId(app.id);
    try {
      if (isNativeRuntime()) {
        try {
          if (await openNativeMiniApp(app, { profile, address: effectiveAddress, walletClient: effectiveWalletClient, navigate })) return;
        } catch { /* fall back below */ }
      }
      openWebMiniApp(app);
    } finally {
      setOpeningId(null);
    }
  }, [profile, effectiveAddress, effectiveWalletClient, navigate, openingId]);

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-border bg-gradient-to-b from-primary/[0.04] to-transparent">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-foreground flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-primary" />
            Mini Apps
          </h2>
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
            className="w-full pl-8 pr-3 py-2.5 text-sm bg-muted/40 border border-border rounded-2xl text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 transition-colors"
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
                    ? "btn-luxury text-primary-foreground shadow-sm shadow-primary/30"
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

      {!effectiveAddress && !bannerDismissed && (
        <ConnectWalletBanner
          onConnect={() => void connectWallet()}
          onConnectWalletConnect={() => void connectWalletConnect()}
          hasInjected={hasInjected}
          connecting={extConnecting}
          error={extWalletError}
          onDismiss={() => setBannerDismissed(true)}
        />
      )}

      <YourAppsRow apps={addedApps} onOpen={(app) => void openApp(app)} />

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
          <div className="px-2 py-1.5">
            {displayed.map((app, i) => (
              <AppCard key={app.id} app={app} index={i} opening={openingId === app.id} onClick={() => void openApp(app)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
