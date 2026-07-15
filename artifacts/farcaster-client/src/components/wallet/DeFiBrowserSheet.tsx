import React, { useState, useRef, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, RefreshCw, MoreHorizontal, Wifi, WifiOff,
  Copy, ExternalLink, Shield, Check, Search,
} from "lucide-react";
import { useWalletStore } from "@/store/walletStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const NETWORK_CONFIG = {
  optimism: { label: "Optimism", short: "OP", color: "#ff0420", chainId: 10 },
  base:     { label: "Base",     short: "Base", color: "#0052ff", chainId: 8453 },
} as const;

type Network = keyof typeof NETWORK_CONFIG;

function getDomain(rawUrl: string): string {
  try { return new URL(rawUrl).hostname.replace(/^www\./, ""); }
  catch { return rawUrl; }
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//.test(t)) return t;
  if (t.includes(".") && !t.includes(" ")) return "https://" + t;
  return `https://www.google.com/search?q=${encodeURIComponent(t)}`;
}

function truncAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

interface Props {
  initialUrl: string;
  onClose: () => void;
}

const QUICK_LINKS = [
  { label: "Uniswap",   url: "https://app.uniswap.org",   emoji: "🦄" },
  { label: "Aave",      url: "https://app.aave.com",      emoji: "👻" },
  { label: "OpenSea",   url: "https://opensea.io",        emoji: "🌊" },
  { label: "DexScreener", url: "https://dexscreener.com", emoji: "📊" },
];

export function DeFiBrowserSheet({ initialUrl, onClose }: Props) {
  const [url, setUrl]               = useState(initialUrl);
  const [inputUrl, setInputUrl]     = useState(initialUrl);
  const [isEditing, setIsEditing]   = useState(false);
  const [isLoading, setIsLoading]   = useState(!!initialUrl);
  const [startQuery, setStartQuery] = useState("");
  const [network, setNetwork]       = useState<Network>("optimism");
  const [isConnected, setIsConnected] = useState(false);
  const [showAccPicker, setShowAccPicker]   = useState(false);
  const [showNetPicker, setShowNetPicker]   = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showTopMenu, setShowTopMenu]       = useState(false);
  const [iframeKey, setIframeKey]   = useState(0);

  const urlRef = useRef<HTMLInputElement>(null);

  // Safety valve: if the proxy or target site never fires onLoad, don't leave
  // the spinner up forever — reveal whatever the iframe managed to render.
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setIsLoading(false), 12_000);
    return () => clearTimeout(t);
  }, [isLoading, iframeKey]);

  const wallets           = useWalletStore(s => s.wallets);
  const activeWalletId    = useWalletStore(s => s.activeWalletId);
  const activeAccIdx      = useWalletStore(s => s.activeAccountIndex);
  const setActiveWallet   = useWalletStore(s => s.setActiveWallet);
  const getActiveWallet   = useWalletStore(s => s.activeWallet);

  const activeWallet  = getActiveWallet();
  const activeAccount = activeWallet?.accounts.find(a => a.index === activeAccIdx);

  const address    = activeAccount?.address ?? "";
  const walletColor = activeWallet?.color ?? "#6366f1";
  const walletEmoji = activeWallet?.emoji ?? "💼";
  const walletLabel = activeWallet?.label ?? "Wallet";

  const navigate = useCallback((raw: string) => {
    const norm = normalizeUrl(raw);
    if (!norm) return;
    setUrl(norm);
    setInputUrl(norm);
    setIsEditing(false);
    setIsLoading(true);
    setIframeKey(k => k + 1);
    setIsConnected(false);
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    navigate(inputUrl);
  }

  function focusUrl() {
    setIsEditing(true);
    setInputUrl(url);
    setTimeout(() => urlRef.current?.select(), 60);
  }

  function blurUrl() {
    setIsEditing(false);
    setInputUrl(url);
  }

  function reload() {
    setIsLoading(true);
    setIframeKey(k => k + 1);
    setShowTopMenu(false);
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    toast.success("Address copied");
    setShowWalletMenu(false);
  }

  function openExternal() {
    window.open(url, "_blank", "noreferrer");
    setShowWalletMenu(false);
    setShowTopMenu(false);
  }

  function copyLink() {
    navigator.clipboard.writeText(url);
    toast.success("Link copied");
    setShowTopMenu(false);
  }

  function connect() {
    if (!address) { toast.error("No wallet connected"); return; }
    setIsConnected(true);
    toast.success("Wallet connected", { description: truncAddr(address) });
    setShowWalletMenu(false);
  }

  function disconnect() {
    setIsConnected(false);
    toast.info("Wallet disconnected");
    setShowWalletMenu(false);
  }

  const domain = url ? getDomain(url) : "New Tab";
  const net    = NETWORK_CONFIG[network];

  return (
    <div className="fixed inset-0 z-[70] flex flex-col lg:items-center lg:justify-center lg:p-8 lg:bg-black/60 lg:backdrop-blur-sm">
    {/* Desktop close backdrop */}
    <div className="hidden lg:block absolute inset-0" onClick={onClose} />
    <div className="relative flex flex-col bg-background w-full h-full lg:rounded-2xl lg:shadow-2xl lg:max-w-4xl lg:max-h-[85vh] lg:overflow-hidden">

      {/* ── Top bar ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 h-12 shrink-0 border-b border-border/60 bg-background">

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1.5 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/50 shrink-0"
        >
          <X size={18} />
        </button>

        {/* URL bar */}
        <form onSubmit={handleSubmit} className="flex-1 min-w-0">
          {isEditing ? (
            <input
              ref={urlRef}
              value={inputUrl}
              onChange={e => setInputUrl(e.target.value)}
              onBlur={blurUrl}
              autoFocus
              className="w-full h-8 px-3 rounded-xl bg-muted/60 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 font-mono"
              placeholder="Search or enter URL…"
            />
          ) : (
            <button
              type="button"
              onClick={focusUrl}
              className="w-full h-8 px-3 rounded-xl bg-muted/40 flex items-center gap-1.5 hover:bg-muted/60 transition-colors"
            >
              <Shield size={11} className="text-emerald-500 shrink-0" />
              <span className="text-sm font-medium text-foreground/90 truncate">{domain}</span>
            </button>
          )}
        </form>

        {/* Refresh */}
        <button
          onClick={reload}
          className={cn("p-1.5 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/50 shrink-0", isLoading && "animate-spin")}
        >
          <RefreshCw size={16} />
        </button>

        {/* Top three-dot */}
        <div className="relative shrink-0">
          <button
            onClick={() => setShowTopMenu(v => !v)}
            className="p-1.5 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/50"
          >
            <MoreHorizontal size={18} />
          </button>

          <AnimatePresence>
            {showTopMenu && (
              <>
                <div className="fixed inset-0 z-[81]" onClick={() => setShowTopMenu(false)} />
                <motion.div
                  initial={{ opacity: 0, scale: 0.95, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -6 }}
                  transition={{ duration: 0.12 }}
                  className="absolute right-0 top-9 w-48 rounded-2xl bg-card border border-border shadow-2xl z-[82] overflow-hidden"
                >
                  <button onClick={reload} className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-foreground">
                    <RefreshCw size={14} className="text-muted-foreground" />Reload page
                  </button>
                  <button onClick={openExternal} className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-foreground border-t border-border/40">
                    <ExternalLink size={14} className="text-muted-foreground" />Open in browser
                  </button>
                  <button onClick={copyLink} className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-foreground border-t border-border/40">
                    <Copy size={14} className="text-muted-foreground" />Copy link
                  </button>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── content: blank start page (new tab) or proxied iframe ── */}
      <div className="flex-1 relative overflow-hidden">
        {!url ? (
          /* New-tab page: empty, with a Google search box + quick links */
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 bg-background">
            <p className="text-lg font-black text-foreground/80 tracking-tight">Search or enter address</p>
            <form
              className="w-full max-w-sm"
              onSubmit={e => { e.preventDefault(); if (startQuery.trim()) navigate(startQuery); }}
            >
              <div className="flex items-center gap-2.5 px-4 py-3.5 rounded-full bg-muted/60 border border-border/60 focus-within:ring-2 focus-within:ring-primary/40">
                <Search size={16} className="text-muted-foreground shrink-0" />
                <input
                  autoFocus
                  value={startQuery}
                  onChange={e => setStartQuery(e.target.value)}
                  placeholder="Search Google or type a URL"
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>
            </form>
            <div className="flex gap-3">
              {QUICK_LINKS.map(l => (
                <button
                  key={l.label}
                  onClick={() => navigate(l.url)}
                  className="flex flex-col items-center gap-1.5 w-16"
                >
                  <div className="w-12 h-12 rounded-2xl bg-muted/60 border border-border/50 flex items-center justify-center text-xl active:scale-95 transition-transform">
                    {l.emoji}
                  </div>
                  <span className="text-[10px] font-semibold text-muted-foreground">{l.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {isLoading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/80 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3">
                  <div
                    className="w-14 h-14 rounded-3xl flex items-center justify-center border"
                    style={{ background: `linear-gradient(135deg, ${walletColor}30, ${walletColor}10)`, borderColor: `${walletColor}30` }}
                  >
                    <span className="text-xl font-black leading-none" style={{ color: walletColor }}>
                      {address ? address.slice(2, 4).toUpperCase() : walletLabel.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-muted-foreground">{domain}</p>
                </div>
              </div>
            )}
            <iframe
              key={iframeKey}
              src={`/api/browser-proxy?url=${encodeURIComponent(url)}`}
              title="Browser"
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-pointer-lock allow-downloads allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
              referrerPolicy="no-referrer"
              allow="fullscreen; autoplay; clipboard-write; payment"
              onLoad={() => setIsLoading(false)}
            />
          </>
        )}
      </div>

      {/* ── Bottom wallet bar (Rainbow-style) ───────────────────── */}
      <div className="shrink-0 border-t border-border/60 bg-background/95 backdrop-blur-lg safe-area-bottom">
        <div className="flex items-center gap-2 px-3 h-[56px]">

          {/* Wallet avatar — tap to switch account */}
          <button
            onClick={() => { setShowAccPicker(true); setShowWalletMenu(false); }}
            className="relative shrink-0 active:scale-95 transition-transform"
          >
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center border-2"
              style={{
                background: `linear-gradient(135deg, ${walletColor}ee, ${walletColor}77)`,
                borderColor: `${walletColor}60`,
              }}
            >
              <span className="text-[13px] font-black text-white leading-none select-none">
                {address ? address.slice(2, 4).toUpperCase() : walletLabel.slice(0, 2).toUpperCase()}
              </span>
            </div>
            {isConnected && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-500 border-2 border-background" />
            )}
          </button>

          {/* Wallet name + address + status */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-[13px] font-semibold text-foreground truncate max-w-[80px]">{walletLabel}</span>
              {address && (
                <span className="text-[11px] text-muted-foreground font-mono leading-none">{truncAddr(address)}</span>
              )}
            </div>
            <div className="mt-0.5">
              {isConnected ? (
                <span className="flex items-center gap-1 text-[11px] text-emerald-500 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Connected
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground/50">Not connected</span>
              )}
            </div>
          </div>

          {/* Network badge — tap to switch */}
          <button
            onClick={() => { setShowNetPicker(true); setShowWalletMenu(false); }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-xs font-bold shrink-0 transition-opacity hover:opacity-80"
            style={{
              borderColor: `${net.color}50`,
              color: net.color,
              background: `${net.color}18`,
            }}
          >
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: net.color }} />
            {net.short}
          </button>

          {/* Three-dot wallet menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setShowWalletMenu(v => !v)}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-xl hover:bg-muted/50"
            >
              <MoreHorizontal size={18} />
            </button>

            <AnimatePresence>
              {showWalletMenu && (
                <>
                  <div className="fixed inset-0 z-[81]" onClick={() => setShowWalletMenu(false)} />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 8 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-10 right-0 w-52 rounded-2xl bg-card border border-border shadow-2xl z-[82] overflow-hidden"
                  >
                    {/* Connect / Disconnect */}
                    {!isConnected ? (
                      <button onClick={connect} className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-emerald-600 dark:text-emerald-400">
                        <Wifi size={14} />Connect wallet
                      </button>
                    ) : (
                      <button onClick={disconnect} className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-rose-500">
                        <WifiOff size={14} />Disconnect
                      </button>
                    )}

                    {/* Switch network */}
                    <button
                      onClick={() => { setShowNetPicker(true); setShowWalletMenu(false); }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-foreground border-t border-border/40"
                    >
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: net.color }}
                      >
                        <span className="text-[8px] text-white font-black leading-none">{net.short[0]}</span>
                      </div>
                      Switch network
                    </button>

                    {/* Switch wallet */}
                    <button
                      onClick={() => { setShowAccPicker(true); setShowWalletMenu(false); }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-foreground border-t border-border/40"
                    >
                      <div
                        className="w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ background: `linear-gradient(135deg, ${walletColor}dd, ${walletColor}88)` }}
                      >
                        <span className="leading-none text-[7px] font-black text-white">
                          {address ? address.slice(2, 4).toUpperCase() : "WL"}
                        </span>
                      </div>
                      Switch wallet
                    </button>

                    {/* Copy address */}
                    <button
                      onClick={copyAddress}
                      className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-foreground border-t border-border/40"
                    >
                      <Copy size={14} className="text-muted-foreground" />Copy address
                    </button>

                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Account picker sheet ─────────────────────────────────── */}
      <AnimatePresence>
        {showAccPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[85] flex flex-col justify-end"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowAccPicker(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="relative z-10 bg-card rounded-t-3xl max-h-[72vh] flex flex-col"
            >
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-9 h-1 rounded-full bg-muted-foreground/20" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 shrink-0">
                <span className="text-base font-bold text-foreground">Switch Account</span>
                <button onClick={() => setShowAccPicker(false)} className="p-1 text-muted-foreground hover:text-foreground">
                  <X size={20} />
                </button>
              </div>

              <div className="overflow-y-auto pb-10">
                {wallets.length === 0 && (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">No wallets added yet</p>
                )}
                {wallets.map(wallet => (
                  <div key={wallet.id}>
                    <div className="px-5 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                      {wallet.label}
                    </div>
                    {wallet.accounts.map(acc => {
                      const isActive = wallet.id === activeWalletId && acc.index === activeAccIdx;
                      return (
                        <button
                          key={acc.index}
                          onClick={() => {
                            setActiveWallet(wallet.id, acc.index);
                            setIsConnected(false);
                            setShowAccPicker(false);
                          }}
                          className={cn(
                            "flex items-center gap-3 w-full px-5 py-3 hover:bg-muted/40 transition-colors",
                            isActive && "bg-muted/25"
                          )}
                        >
                          <div
                            className="w-9 h-9 rounded-full flex items-center justify-center text-base border-2 shrink-0"
                            style={{
                              background: `linear-gradient(135deg, ${wallet.color}dd, ${wallet.color}77)`,
                              borderColor: isActive ? wallet.color : `${wallet.color}35`,
                            }}
                          >
                            <span className="leading-none select-none text-xs font-black text-white">
                              {acc.address ? acc.address.slice(2, 4).toUpperCase() : wallet.label.slice(0, 2).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 text-left min-w-0">
                            <p className="text-sm font-semibold text-foreground">
                              {acc.label || `Account ${acc.index + 1}`}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">{truncAddr(acc.address)}</p>
                          </div>
                          {isActive && (
                            <div
                              className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                              style={{ background: wallet.color }}
                            >
                              <Check size={11} className="text-white" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Network picker sheet ─────────────────────────────────── */}
      <AnimatePresence>
        {showNetPicker && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[85] flex flex-col justify-end"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowNetPicker(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="relative z-10 bg-card rounded-t-3xl"
            >
              <div className="flex justify-center pt-3 pb-1">
                <div className="w-9 h-1 rounded-full bg-muted-foreground/20" />
              </div>

              <div className="flex items-center justify-between px-5 py-3">
                <span className="text-base font-bold text-foreground">Select Network</span>
                <button onClick={() => setShowNetPicker(false)} className="p-1 text-muted-foreground hover:text-foreground">
                  <X size={20} />
                </button>
              </div>

              <div className="px-4 pb-10 flex flex-col gap-2.5">
                {(Object.entries(NETWORK_CONFIG) as [Network, typeof NETWORK_CONFIG[Network]][]).map(([key, cfg]) => {
                  const isActive = network === key;
                  return (
                    <button
                      key={key}
                      onClick={() => {
                        setNetwork(key);
                        setShowNetPicker(false);
                        if (isConnected) toast.info(`Switched to ${cfg.label}`);
                      }}
                      className={cn(
                        "flex items-center gap-4 w-full p-4 rounded-2xl border-2 transition-all",
                        isActive ? "" : "border-border/50 hover:border-border"
                      )}
                      style={isActive ? { borderColor: cfg.color, background: `${cfg.color}12` } : {}}
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: cfg.color }}
                      >
                        <span className="text-white font-black text-sm leading-none">{cfg.short[0]}</span>
                      </div>
                      <div className="flex-1 text-left">
                        <p className="text-sm font-bold text-foreground">{cfg.label}</p>
                        <p className="text-xs text-muted-foreground">Chain ID {cfg.chainId}</p>
                      </div>
                      {isActive && (
                        <div
                          className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: cfg.color }}
                        >
                          <Check size={11} className="text-white" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </div>
  );
}
