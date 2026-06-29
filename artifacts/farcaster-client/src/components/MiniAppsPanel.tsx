import { useState, useEffect, useRef, useCallback } from "react";
import { fetchMiniApps, type MiniApp } from "@/lib/farcaster-api";
import { useWallet } from "@/hooks/useWallet";
import { X, Loader2, RefreshCw, ExternalLink, Layers, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/* ─── Frame host protocol (Farcaster Mini App SDK) ─────────────────────────
   The frame SDK sends RPC messages to window.parent. We handle:
   - fc_requestContext → reply with user FID / profile
   - ready            → hide loader
   - close            → close the runner
   - openUrl          → open in new tab                                      */

function useFrameHost(
  iframeRef: React.RefObject<HTMLIFrameElement | null>,
  profile: { pfpUrl?: string; username?: string; displayName?: string } | null,
  fid: number,
  onClose: () => void
) {
  const fidRef = useRef(fid);
  fidRef.current = fid;
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const sendContext = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const ctx = {
      type: "frameContext",
      context: {
        fid: fidRef.current,
        username: profileRef.current?.username ?? "",
        displayName: profileRef.current?.displayName ?? profileRef.current?.username ?? "",
        pfpUrl: profileRef.current?.pfpUrl ?? "",
        verifiedAddresses: { ethAddresses: [] },
        client: { clientFid: 0, added: false },
      },
    };
    win.postMessage(ctx, "*");
    // Also send the "context" style (used by some SDK versions)
    win.postMessage({ type: "context", ...ctx.context }, "*");
  }, [iframeRef]);

  const [ready, setReady] = useState(false);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const d = e.data;
      if (!d || typeof d !== "object") return;
      const method = d.method ?? d.type ?? "";
      // frame signals ready
      if (method === "ready" || method === "fc_ready") {
        setReady(true);
        sendContext();
        return;
      }
      // frame requests context
      if (method === "fc_requestContext" || method === "requestContext") {
        sendContext();
        return;
      }
      // close
      if (method === "close" || method === "fc_close") {
        onClose();
        return;
      }
      // openUrl
      if ((method === "openUrl" || method === "fc_openUrl") && d.params?.[0]?.url) {
        window.open(d.params[0].url, "_blank", "noopener,noreferrer");
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onClose, sendContext]);

  // Also send context once on first mount (some apps don't send ready)
  const hasSentRef = useRef(false);
  const onLoad = useCallback(() => {
    if (hasSentRef.current) return;
    hasSentRef.current = true;
    setTimeout(sendContext, 300);
    setTimeout(() => setReady(true), 800);
  }, [sendContext]);

  return { ready, onLoad };
}

/* ─── MiniApp Runner (iframe modal) ────────────────────────────────────────── */
function MiniAppRunner({
  app,
  fid,
  profile,
  onClose,
}: {
  app: MiniApp;
  fid: number;
  profile: { pfpUrl?: string; username?: string; displayName?: string } | null;
  onClose: () => void;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { ready, onLoad } = useFrameHost(iframeRef, profile, fid, onClose);

  // Close on Esc
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background">
      {/* Header bar */}
      <div className="flex items-center gap-3 px-4 h-12 border-b border-border bg-background shrink-0">
        {app.iconUrl && (
          <img src={app.iconUrl} alt="" className="w-6 h-6 rounded-md object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
        )}
        <span className="flex-1 text-sm font-semibold text-foreground truncate">{app.name}</span>
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          title="Open in new tab"
        >
          <ExternalLink className="w-4 h-4" />
        </a>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Iframe */}
      <div className="flex-1 relative">
        {!ready && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background z-10">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
            <span className="text-sm text-muted-foreground">Loading {app.name}…</span>
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={app.url}
          title={app.name}
          onLoad={onLoad}
          className="w-full h-full border-0"
          allow="camera; microphone; clipboard-write; payment; fullscreen"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals"
        />
      </div>
    </div>
  );
}

/* ─── App card ──────────────────────────────────────────────────────────────── */
function AppCard({ app, onClick }: { app: MiniApp; onClick: () => void }) {
  const CATEGORY_COLORS: Record<string, string> = {
    Games: "bg-violet-500/10 text-violet-500",
    DeFi: "bg-emerald-500/10 text-emerald-500",
    Creator: "bg-amber-500/10 text-amber-600",
    App: "bg-blue-500/10 text-blue-500",
  };
  return (
    <button
      onClick={onClick}
      className="group w-full text-left p-3.5 rounded-2xl border border-border hover:border-primary/30 hover:bg-accent/50 transition-all"
    >
      <div className="flex items-start gap-3">
        {app.iconUrl ? (
          <img
            src={app.iconUrl}
            alt=""
            className="w-12 h-12 rounded-xl object-cover shrink-0 bg-muted"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
              (e.currentTarget.nextElementSibling as HTMLElement | null)?.removeAttribute("style");
            }}
          />
        ) : null}
        <div
          className="w-12 h-12 rounded-xl bg-primary/10 shrink-0 items-center justify-center hidden"
          aria-hidden="true"
        >
          <Layers className="w-6 h-6 text-primary/50" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{app.name}</p>
          {app.description && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{app.description}</p>
          )}
          <span className={cn("inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded-md mt-1.5",
            CATEGORY_COLORS[app.category] ?? CATEGORY_COLORS.App)}>
            {app.category}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ─── MiniAppsPanel ──────────────────────────────────────────────────────────── */
export function MiniAppsPanel() {
  const { fid, profile } = useWallet();
  const [apps, setApps] = useState<MiniApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeApp, setActiveApp] = useState<MiniApp | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await fetchMiniApps();
      setApps(result);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = apps.filter((a) =>
    !search || a.name.toLowerCase().includes(search.toLowerCase()) ||
    a.category.toLowerCase().includes(search.toLowerCase())
  );

  const CATEGORIES = ["All", ...Array.from(new Set(apps.map((a) => a.category)))];
  const [activeCategory, setActiveCategory] = useState("All");
  const displayed = activeCategory === "All"
    ? filtered
    : filtered.filter((a) => a.category === activeCategory);

  const fidNum = Number(fid);

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
          <div className="flex gap-1 overflow-x-auto pb-0.5 no-scrollbar">
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors",
                  activeCategory === cat
                    ? "bg-primary text-white"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {cat}
              </button>
            ))}
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
            <div className="grid grid-cols-1 gap-2 p-4">
              {displayed.map((app) => (
                <AppCard key={app.id} app={app} onClick={() => setActiveApp(app)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Full-screen iframe runner */}
      {activeApp && (
        <MiniAppRunner
          app={activeApp}
          fid={fidNum}
          profile={profile}
          onClose={() => setActiveApp(null)}
        />
      )}
    </>
  );
}
