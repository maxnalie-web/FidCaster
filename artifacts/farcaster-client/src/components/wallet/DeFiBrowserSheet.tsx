import React, { useState, useRef, useCallback, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  X, RefreshCw, MoreHorizontal, Wifi, WifiOff,
  Copy, ExternalLink, Shield, Check, Search, AlertTriangle, Loader2, Clock, Trash2,
} from "lucide-react";
import { useWalletStore } from "@/store/walletStore";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isHex, hexToString, isAddress, formatEther, type WalletClient } from "viem";
import { loadLastSession, saveLastSession, loadHistory, addHistoryEntry, clearHistory, type HistoryEntry } from "@/lib/browserHistory";
import { WalletAvatar } from "./WalletAvatar";

const NETWORK_CONFIG = {
  optimism: { label: "Optimism", short: "OP",   color: "#ff0420", chainId: 10 },
  base:     { label: "Base",     short: "Base", color: "#0052ff", chainId: 8453 },
  arbitrum: { label: "Arbitrum", short: "Arb",  color: "#28a0f0", chainId: 42161 },
  ethereum: { label: "Ethereum", short: "ETH",  color: "#627eea", chainId: 1 },
  polygon:  { label: "Polygon",  short: "Poly", color: "#8247e5", chainId: 137 },
} as const;

type Network = keyof typeof NETWORK_CONFIG;
const CHAIN_ID_HEX: Record<Network, string> = {
  optimism: "0xa",     // 10
  base: "0x2105",      // 8453
  arbitrum: "0xa4b1",  // 42161
  ethereum: "0x1",     // 1
  polygon: "0x89",     // 137
};
const CHAIN_ID_TO_NETWORK: Record<string, Network> = {
  "0xa": "optimism",
  "0x2105": "base",
  "0xa4b1": "arbitrum",
  "0x1": "ethereum",
  "0x89": "polygon",
};
function isNetwork(v: string): v is Network {
  return v in NETWORK_CONFIG;
}

// ── window.ethereum bridge: request/response over postMessage ──────────────
// The provider script injected server-side (server/index.ts) relays every
// account/chain/signing call the framed dApp makes into this component —
// this is the ONLY place that ever touches the real wallet client. Requests
// that just read state (chainId, accounts) resolve immediately; anything
// that connects, signs, or sends requires an explicit tap on the approval
// card rendered below.
type WalletRequestMsg = { type: "fidcaster:wallet:request"; id: string; method: string; params: unknown[] };
type WalletReadyMsg = { type: "fidcaster:wallet:ready" };
type IncomingMsg = WalletRequestMsg | WalletReadyMsg | { type: string };

const IMMEDIATE_METHODS = new Set(["eth_chainId", "net_version", "eth_accounts", "web3_clientVersion"]);
const GATED_METHODS = new Set([
  "eth_requestAccounts", "eth_sendTransaction",
  "personal_sign", "eth_sign",
  "eth_signTypedData", "eth_signTypedData_v3", "eth_signTypedData_v4",
  "wallet_switchEthereumChain", "wallet_addEthereumChain",
]);

interface PendingRequest {
  id: string;
  method: string;
  params: unknown[];
}

function extractSignMessage(params: unknown[]): { address: string | null; message: string } {
  // personal_sign / eth_sign params can arrive as [data, address] OR
  // [address, data] depending on the dApp — detect which slot is the address.
  const [p0, p1] = [params[0], params[1]];
  const isAddr0 = typeof p0 === "string" && isAddress(p0);
  const addrRaw = isAddr0 ? (p0 as string) : (typeof p1 === "string" ? p1 : null);
  const dataRaw = isAddr0 ? p1 : p0;
  let message = typeof dataRaw === "string" ? dataRaw : "";
  if (isHex(message)) {
    try { message = hexToString(message as `0x${string}`); } catch { /* keep raw hex if it isn't valid utf8 */ }
  }
  return { address: addrRaw, message };
}

function extractTypedData(params: unknown[]): { address: string | null; typedData: Record<string, unknown> | null } {
  const [p0, p1] = [params[0], params[1]];
  const isAddr0 = typeof p0 === "string" && isAddress(p0);
  const addrRaw = isAddr0 ? (p0 as string) : (typeof p1 === "string" ? p1 : null);
  const dataRaw = isAddr0 ? p1 : p0;
  try {
    const typedData = typeof dataRaw === "string" ? JSON.parse(dataRaw) : (dataRaw as Record<string, unknown>);
    return { address: addrRaw, typedData };
  } catch {
    return { address: addrRaw, typedData: null };
  }
}

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
  // The sheet fully unmounts on close, so without resuming from the last
  // saved session it always reopened to a blank "New Tab" page — even mid-
  // session, since the caller never passes a non-empty initialUrl today.
  const [resumed] = useState(() => (initialUrl ? null : loadLastSession()));
  const startUrl = initialUrl || resumed?.url || "";
  const startNetwork: Network = resumed?.network && isNetwork(resumed.network) ? resumed.network : "optimism";

  const [url, setUrl]               = useState(startUrl);
  const [inputUrl, setInputUrl]     = useState(startUrl);
  const [isEditing, setIsEditing]   = useState(false);
  const [isLoading, setIsLoading]   = useState(!!startUrl);
  const [startQuery, setStartQuery] = useState("");
  const [network, setNetwork]       = useState<Network>(startNetwork);
  const [isConnected, setIsConnected] = useState(false);
  const [showAccPicker, setShowAccPicker]   = useState(false);
  const [showNetPicker, setShowNetPicker]   = useState(false);
  const [showWalletMenu, setShowWalletMenu] = useState(false);
  const [showTopMenu, setShowTopMenu]       = useState(false);
  const [showHistory, setShowHistory]       = useState(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [iframeKey, setIframeKey]   = useState(0);
  const [pendingQueue, setPendingQueue] = useState<PendingRequest[]>([]);
  const [processing, setProcessing] = useState(false);

  const urlRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Safety valve: if the proxy or target site never fires onLoad, don't leave
  // the spinner up forever — reveal whatever the iframe managed to render.
  useEffect(() => {
    if (!isLoading) return;
    const t = setTimeout(() => setIsLoading(false), 12_000);
    return () => clearTimeout(t);
  }, [isLoading, iframeKey]);

  // Persist the current page + network so reopening the browser (or
  // reloading the app) resumes here instead of starting blank.
  useEffect(() => {
    if (!url) return;
    saveLastSession(url, network);
  }, [url, network]);

  // Record every page load into visit history.
  useEffect(() => {
    if (!url) return;
    addHistoryEntry(url);
  }, [url]);

  const wallets           = useWalletStore(s => s.wallets);
  const activeWalletId    = useWalletStore(s => s.activeWalletId);
  const activeAccIdx      = useWalletStore(s => s.activeAccountIndex);
  const setActiveWallet   = useWalletStore(s => s.setActiveWallet);
  const getActiveWallet   = useWalletStore(s => s.activeWallet);
  const getActiveWalletClientForChain = useWalletStore(s => s.getActiveWalletClientForChain);

  const activeWallet  = getActiveWallet();
  const activeAccount = activeWallet?.accounts.find(a => a.index === activeAccIdx);

  const address    = activeAccount?.address ?? "";
  const walletColor = activeWallet?.color ?? "#6366f1";
  const walletLabel = activeWallet?.label ?? "Wallet";

  // Keep the provider bridge (inside the iframe) in sync with connection
  // state — refs so the message-handling effect below always reads the
  // latest values without needing to re-subscribe on every change.
  const stateRef = useRef({ address, isConnected, network });
  useEffect(() => { stateRef.current = { address, isConnected, network }; }, [address, isConnected, network]);

  function postToFrame(msg: unknown) {
    iframeRef.current?.contentWindow?.postMessage(msg, window.location.origin);
  }

  function respond(id: string, result?: unknown, error?: { code: number; message: string }) {
    postToFrame({ type: "fidcaster:wallet:response", id, result, error });
  }

  // ── Incoming requests from the framed dApp ────────────────────────────
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== iframeRef.current?.contentWindow) return;
      if (ev.origin !== window.location.origin) return;
      const d = ev.data as IncomingMsg;
      if (!d || typeof d !== "object") return;

      if (d.type === "fidcaster:wallet:ready") {
        const { address: addr, isConnected: connected, network: net } = stateRef.current;
        postToFrame({ type: "fidcaster:wallet:event", event: "chainChanged", data: CHAIN_ID_HEX[net] });
        if (connected && addr) {
          postToFrame({ type: "fidcaster:wallet:event", event: "accountsChanged", data: [addr] });
        }
        return;
      }

      if (d.type !== "fidcaster:wallet:request") return;
      const req = d as WalletRequestMsg;
      const { address: addr, isConnected: connected, network: net } = stateRef.current;

      if (IMMEDIATE_METHODS.has(req.method)) {
        if (req.method === "eth_chainId") return respond(req.id, CHAIN_ID_HEX[net]);
        if (req.method === "net_version") return respond(req.id, String(NETWORK_CONFIG[net].chainId));
        if (req.method === "eth_accounts") return respond(req.id, connected && addr ? [addr] : []);
        if (req.method === "web3_clientVersion") return respond(req.id, "FidCasterWallet/1.0");
        return;
      }

      if (GATED_METHODS.has(req.method)) {
        // eth_requestAccounts when already connected doesn't need to
        // re-prompt — just return the account, matching how real wallets
        // behave once a site has already been granted access.
        if (req.method === "eth_requestAccounts" && connected && addr) {
          return respond(req.id, [addr]);
        }
        if (req.method !== "eth_requestAccounts" && !connected) {
          return respond(req.id, undefined, { code: 4100, message: "Unauthorized - connect the wallet first." });
        }
        setPendingQueue(q => [...q, { id: req.id, method: req.method, params: req.params }]);
        return;
      }

      respond(req.id, undefined, { code: 4200, message: `Unsupported method: ${req.method}` });
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // Broadcast chain/account changes into the iframe whenever they happen
  // locally (network switch, connect/disconnect) so the dApp's own
  // chainChanged/accountsChanged listeners fire, same as a real wallet.
  useEffect(() => {
    postToFrame({ type: "fidcaster:wallet:event", event: "chainChanged", data: CHAIN_ID_HEX[network] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [network, iframeKey]);

  useEffect(() => {
    postToFrame({ type: "fidcaster:wallet:event", event: isConnected && address ? "accountsChanged" : "disconnect", data: isConnected && address ? [address] : [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, iframeKey]);

  const currentRequest = pendingQueue[0] ?? null;

  function finishCurrentRequest() {
    setPendingQueue(q => q.slice(1));
  }

  async function approveRequest() {
    if (!currentRequest || processing) return;
    setProcessing(true);
    const { id, method, params } = currentRequest;
    try {
      if (method === "eth_requestAccounts") {
        if (!address) throw Object.assign(new Error("No wallet available"), { code: 4001 });
        setIsConnected(true);
        respond(id, [address]);
        toast.success("Site connected", { description: truncAddr(address) });
      } else if (method === "wallet_switchEthereumChain") {
        const target = (params[0] as { chainId?: string } | undefined)?.chainId?.toLowerCase();
        const targetNet = target ? CHAIN_ID_TO_NETWORK[target] : undefined;
        if (!targetNet) {
          respond(id, undefined, { code: 4902, message: "Unrecognized or unsupported chain." });
        } else {
          setNetwork(targetNet);
          respond(id, null);
        }
      } else if (method === "wallet_addEthereumChain") {
        // We only ever operate on the chains we already support (Optimism,
        // Base, Arbitrum, Ethereum) — treat this as a no-op success if it
        // matches one of them, reject otherwise rather than pretending to
        // add an arbitrary network.
        const target = (params[0] as { chainId?: string } | undefined)?.chainId?.toLowerCase();
        if (target && CHAIN_ID_TO_NETWORK[target]) respond(id, null);
        else respond(id, undefined, { code: 4200, message: "Adding custom networks isn't supported." });
      } else if (method === "eth_sendTransaction") {
        const wc = await getWalletClientForCurrentNetwork();
        const tx = params[0] as { to?: string; value?: string; data?: string; gas?: string };
        if (!tx.to || !isAddress(tx.to)) throw new Error("Invalid transaction recipient");
        const hash = await wc.sendTransaction({
          account: wc.account!,
          chain: wc.chain!,
          to: tx.to as `0x${string}`,
          value: tx.value ? BigInt(tx.value) : 0n,
          data: (tx.data as `0x${string}` | undefined) ?? undefined,
          ...(tx.gas ? { gas: BigInt(tx.gas) } : {}),
        });
        respond(id, hash);
        toast.success("Transaction sent");
      } else if (method === "personal_sign" || method === "eth_sign") {
        const wc = await getWalletClientForCurrentNetwork();
        const { message } = extractSignMessage(params);
        const sig = await wc.signMessage({ account: wc.account!, message });
        respond(id, sig);
      } else if (method === "eth_signTypedData_v4" || method === "eth_signTypedData_v3" || method === "eth_signTypedData") {
        const wc = await getWalletClientForCurrentNetwork();
        const { typedData } = extractTypedData(params);
        if (!typedData) throw new Error("Malformed typed data");
        const sig = await wc.signTypedData({
          account: wc.account!,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          domain: typedData.domain as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          types: typedData.types as any,
          primaryType: typedData.primaryType as string,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          message: typedData.message as any,
        });
        respond(id, sig);
      } else {
        respond(id, undefined, { code: 4200, message: "Unsupported method" });
      }
    } catch (e) {
      const err = e as Error & { code?: number };
      respond(id, undefined, { code: err.code ?? -32603, message: err.message ?? "Request failed" });
      toast.error(err.message?.slice(0, 140) ?? "Request failed");
    } finally {
      setProcessing(false);
      finishCurrentRequest();
    }
  }

  function rejectRequest() {
    if (!currentRequest) return;
    respond(currentRequest.id, undefined, { code: 4001, message: "User rejected the request." });
    finishCurrentRequest();
  }

  async function getWalletClientForCurrentNetwork(): Promise<WalletClient> {
    const client = await getActiveWalletClientForChain(NETWORK_CONFIG[network].chainId);
    if (!client) throw new Error("No wallet connected");
    return client;
  }

  const navigate = useCallback((raw: string) => {
    const norm = normalizeUrl(raw);
    if (!norm) return;
    setUrl(norm);
    setInputUrl(norm);
    setIsEditing(false);
    setIsLoading(true);
    setIframeKey(k => k + 1);
    setIsConnected(false);
    setPendingQueue([]); // the old page (and its pending requests) is gone
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
    setPendingQueue([]);
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

  function openHistory() {
    setHistoryEntries(loadHistory());
    setShowHistory(true);
    setShowTopMenu(false);
  }

  function visitFromHistory(entry: HistoryEntry) {
    setShowHistory(false);
    navigate(entry.url);
  }

  function clearBrowsingHistory() {
    clearHistory();
    setHistoryEntries([]);
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
                  <button onClick={openHistory} className="flex items-center gap-3 w-full px-4 py-3 text-sm hover:bg-muted/40 text-foreground border-t border-border/40">
                    <Clock size={14} className="text-muted-foreground" />History
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
                    className="w-14 h-14 rounded-3xl flex items-center justify-center border overflow-hidden"
                    style={{ background: `linear-gradient(135deg, ${walletColor}30, ${walletColor}10)`, borderColor: `${walletColor}30` }}
                  >
                    <WalletAvatar label={walletLabel} color={walletColor} seed={address} size={40} />
                  </div>
                  <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  <p className="text-xs text-muted-foreground">{domain}</p>
                </div>
              </div>
            )}
            <iframe
              ref={iframeRef}
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
              className="w-9 h-9 rounded-full flex items-center justify-center border-2 overflow-hidden"
              style={{
                borderColor: `${walletColor}60`,
              }}
            >
              <WalletAvatar label={walletLabel} color={walletColor} seed={address} size={32} />
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

            {/* Switch-network popup — small, anchored right next to the ⋯
                button (both the network badge and the ⋯ menu's "Switch
                network" item open this), not a full-screen sheet. */}
            <AnimatePresence>
              {showNetPicker && (
                <>
                  <div className="fixed inset-0 z-[81]" onClick={() => setShowNetPicker(false)} />
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95, y: 8 }}
                    transition={{ duration: 0.12 }}
                    className="absolute bottom-10 right-0 w-48 rounded-2xl bg-card border border-border shadow-2xl z-[82] overflow-hidden"
                  >
                    <div className="px-4 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                      Network
                    </div>
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
                            "flex items-center gap-2.5 w-full px-4 py-2.5 text-sm hover:bg-muted/40 text-foreground border-t border-border/40",
                            isActive && "bg-muted/25"
                          )}
                        >
                          <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: cfg.color }} />
                          <span className="flex-1 text-left font-medium">{cfg.label}</span>
                          {isActive && <Check size={13} className="shrink-0" style={{ color: cfg.color }} />}
                        </button>
                      );
                    })}
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
                            // Switching accounts while connected should behave like a
                            // real wallet's account switch — the site stays connected
                            // and just sees accountsChanged with the new address (via
                            // the effect below), not a forced disconnect that silently
                            // left the site pointed at the old account.
                            setActiveWallet(wallet.id, acc.index);
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

      {/* ── History sheet ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showHistory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-[85] flex flex-col justify-end"
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowHistory(false)}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="relative z-10 bg-card rounded-t-3xl max-h-[72vh] flex flex-col"
            >
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-9 h-1 rounded-full bg-muted-foreground/20" />
              </div>

              <div className="flex items-center justify-between px-5 py-3 shrink-0">
                <span className="text-base font-bold text-foreground">History</span>
                <div className="flex items-center gap-1">
                  {historyEntries.length > 0 && (
                    <button onClick={clearBrowsingHistory} className="p-1.5 text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 size={16} />
                    </button>
                  )}
                  <button onClick={() => setShowHistory(false)} className="p-1 text-muted-foreground hover:text-foreground">
                    <X size={20} />
                  </button>
                </div>
              </div>

              <div className="overflow-y-auto pb-10">
                {historyEntries.length === 0 ? (
                  <p className="px-5 py-8 text-center text-sm text-muted-foreground">No browsing history yet</p>
                ) : (
                  historyEntries.map(entry => (
                    <button
                      key={entry.url}
                      onClick={() => visitFromHistory(entry)}
                      className="flex items-center gap-3 w-full px-5 py-3 hover:bg-muted/40 transition-colors text-left"
                    >
                      <Clock size={14} className="text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">{getDomain(entry.url)}</p>
                        <p className="text-xs text-muted-foreground truncate">{entry.url}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── dApp request approval card ───────────────────────────────── */}
      {currentRequest && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card border border-border rounded-3xl shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-border/60">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1">{domain}</p>
              <p className="text-[15px] font-semibold text-foreground">
                {requestTitle(currentRequest.method)}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <RequestSummary request={currentRequest} address={address} network={network} />
              {currentRequest.method === "eth_sendTransaction" && (
                <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  This transaction is not simulated first - only approve if you trust this site.
                </div>
              )}
              {pendingQueue.length > 1 && (
                <p className="text-[11px] text-muted-foreground text-center">+{pendingQueue.length - 1} more request{pendingQueue.length > 2 ? "s" : ""} waiting</p>
              )}
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={rejectRequest} disabled={processing}
                className="flex-1 py-3.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50">
                Reject
              </button>
              <button onClick={approveRequest} disabled={processing}
                className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ backgroundColor: walletColor }}>
                {processing ? <><Loader2 size={14} className="animate-spin" /> Working…</> : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
    </div>
  );
}

function requestTitle(method: string): string {
  if (method === "eth_requestAccounts") return "wants to connect to your wallet";
  if (method === "wallet_switchEthereumChain") return "wants to switch network";
  if (method === "wallet_addEthereumChain") return "wants to add a network";
  if (method === "eth_sendTransaction") return "wants to send a transaction";
  if (method === "personal_sign" || method === "eth_sign") return "wants you to sign a message";
  if (method.startsWith("eth_signTypedData")) return "wants you to sign typed data";
  return `wants to call ${method}`;
}

function RequestSummary({ request, address, network }: { request: PendingRequest; address: string; network: Network }) {
  const { method, params } = request;

  if (method === "eth_requestAccounts") {
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-sm">
        <p className="text-muted-foreground text-xs mb-0.5">Account</p>
        <p className="font-mono text-foreground">{address || "No account"}</p>
      </div>
    );
  }

  if (method === "wallet_switchEthereumChain" || method === "wallet_addEthereumChain") {
    const target = (params[0] as { chainId?: string } | undefined)?.chainId?.toLowerCase();
    const targetNet = target ? CHAIN_ID_TO_NETWORK[target] : undefined;
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3 text-sm flex items-center justify-between">
        <span className="text-muted-foreground">Network</span>
        <span className="font-semibold text-foreground">
          {targetNet ? NETWORK_CONFIG[targetNet].label : `Unsupported (${target ?? "?"})`}
        </span>
      </div>
    );
  }

  if (method === "eth_sendTransaction") {
    const tx = (params[0] as { to?: string; value?: string; data?: string }) ?? {};
    const valueEth = tx.value ? formatEther(BigInt(tx.value)) : "0";
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 divide-y divide-border/40 text-sm">
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-muted-foreground">To</span>
          <span className="font-mono text-xs text-foreground">{tx.to ? truncAddr(tx.to) : "-"}</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-muted-foreground">Value</span>
          <span className="font-mono text-xs text-foreground">{valueEth} ETH</span>
        </div>
        <div className="flex items-center justify-between px-4 py-2.5">
          <span className="text-muted-foreground">Network</span>
          <span className="text-foreground">{NETWORK_CONFIG[network].label}</span>
        </div>
        {tx.data && tx.data !== "0x" && (
          <div className="px-4 py-2.5">
            <p className="text-muted-foreground mb-1">Data</p>
            <p className="font-mono text-[10px] text-foreground break-all leading-relaxed max-h-16 overflow-y-auto">{tx.data}</p>
          </div>
        )}
      </div>
    );
  }

  if (method === "personal_sign" || method === "eth_sign") {
    const { message } = extractSignMessage(params);
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
        <p className="text-muted-foreground text-xs mb-1">Message</p>
        <p className="text-xs text-foreground break-all whitespace-pre-wrap max-h-32 overflow-y-auto">{message || "(empty)"}</p>
      </div>
    );
  }

  if (method.startsWith("eth_signTypedData")) {
    const { typedData } = extractTypedData(params);
    return (
      <div className="rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
        <p className="text-muted-foreground text-xs mb-1">Typed data{typedData?.primaryType ? ` · ${String(typedData.primaryType)}` : ""}</p>
        <pre className="text-[10px] text-foreground break-all whitespace-pre-wrap max-h-32 overflow-y-auto font-mono">
          {typedData ? JSON.stringify(typedData.message ?? typedData, null, 2).slice(0, 800) : "(unparseable)"}
        </pre>
      </div>
    );
  }

  return null;
}
