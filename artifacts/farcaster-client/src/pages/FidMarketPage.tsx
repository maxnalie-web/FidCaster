import { useState, useEffect, useCallback, useRef } from "react";
import { useEthPrice } from "@/hooks/useEthPrice";
import { useLocation } from "wouter";
import { useWallet } from "@/hooks/useWallet";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import {
  Tag, TrendingUp, RefreshCw, Search, X, ArrowLeft,
  ExternalLink, ChevronDown, ArrowUpDown, Copy, Check,
  Activity, ShoppingCart, ChevronRight, User, Wallet,
  HelpCircle, ShieldCheck, Zap, Lock, Loader2, Flame,
  Home, Layers, Bell,
} from "lucide-react";
import { useMarketWallet } from "@/hooks/useMarketWallet";
import { cn } from "@/lib/utils";

interface Listing {
  fid: number;
  seller: string;
  priceWei: string;
  priceEth: string;
  fromDeadline: number;
  listedAt: number;
  active: boolean;
  sigExpired: boolean;
  listingExpired: boolean;
  buyable: boolean;
}

interface Trade {
  fid: number;
  seller: string;
  buyer: string;
  priceWei: string;
  priceEth: string;
  blockNumber: number;
  transactionHash: string;
}

interface ActivityItem {
  type: "listed" | "sold" | "cancelled";
  fid: number;
  seller: string;
  buyer?: string;
  priceWei: string;
  priceEth: string;
  blockNumber: number;
  transactionHash: string;
}

interface FidInfo {
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
}

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ts: number) {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-white/30 hover:text-white/70 transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

type SortKey = "price-asc" | "price-desc" | "newest" | "fid-asc";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "price-asc",  label: "Price: Low → High" },
  { value: "price-desc", label: "Price: High → Low" },
  { value: "newest",     label: "Newest First" },
  { value: "fid-asc",   label: "FID: Low → High" },
];

const PAGE_SIZE = 15;

// Module-level cache so navigating back shows data instantly (no skeleton flash)
let _cachedListings: Listing[] = [];
let _cachedTrades: Trade[] = [];
let _cachedTotalTradedEth = "0";
let _cachedActivity: ActivityItem[] = [];
let _cachedFidInfoMap: Record<number, FidInfo> = {};

export default function FidMarketPage() {
  const [, navigate] = useLocation();
  const [listings,       setListings]       = useState<Listing[]>(_cachedListings);
  const [trades,         setTrades]         = useState<Trade[]>(_cachedTrades);
  const [totalTradedEth, setTotalTradedEth] = useState(_cachedTotalTradedEth);
  const [activity,       setActivity]       = useState<ActivityItem[]>(_cachedActivity);
  const [fidInfoMap,     setFidInfoMap]     = useState<Record<number, FidInfo>>(_cachedFidInfoMap);
  const [loading,        setLoading]        = useState(_cachedListings.length === 0);
  const [tab,            setTab]            = useState<"listings" | "activity">("listings");
  const [search,         setSearch]         = useState("");
  const [sortBy,         setSortBy]         = useState<SortKey>("price-asc");
  // sort is now inline chips, no dropdown state needed
  const ethUsd = useEthPrice();
  const [listingsVisible, setListingsVisible] = useState(PAGE_SIZE);
  const [activityVisible, setActivityVisible] = useState(PAGE_SIZE);
  const [showHowTo,      setShowHowTo]      = useState(false);

  const { address: myAddress, fid: myFid, profile, authMethod } = useWallet();
  const myFidNum = myFid ? Number(myFid) : null;
  const {
    wallet: extWallet,
    connect: connectExt,
    connecting: connectingExt,
    disconnect: disconnectExt,
  } = useMarketWallet();

  const [myFidListing,       setMyFidListing]       = useState<Listing | null>(null);
  const [myFidListingLoaded, setMyFidListingLoaded] = useState(false);
  const [detectedExtFid,    setDetectedExtFid]    = useState<number | null>(null);

  // When an external wallet connects, detect its FID from IdRegistry
  useEffect(() => {
    if (!extWallet?.address) { setDetectedExtFid(null); return; }
    fetch(`/api/fid-market/wallet-fid?address=${extWallet.address}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setDetectedExtFid(d?.fid && d.fid > 0 ? d.fid : null))
      .catch(() => setDetectedExtFid(null));
  }, [extWallet?.address]);

  useEffect(() => {
    if (!myFidNum) { setMyFidListingLoaded(true); return; }
    fetch(`/api/fid-market/fid-data/${myFidNum}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.listing?.active) {
          setMyFidListing({
            fid: d.fid, seller: d.listing.seller,
            priceWei: d.listing.priceWei, priceEth: d.listing.priceEth || "0",
            fromDeadline: d.listing.fromDeadline, listedAt: d.listing.listedAt || 0,
            active: true, sigExpired: d.sigExpired,
            listingExpired: d.listingExpired, buyable: d.buyable,
          });
        } else { setMyFidListing(null); }
        setMyFidListingLoaded(true);
      })
      .catch(() => setMyFidListingLoaded(true));
  }, [myFidNum]);

  const load = useCallback(async () => {
    if (_cachedListings.length === 0) setLoading(true);
    try {
      const [listRes, tradeRes, activityRes] = await Promise.all([
        fetch("/api/fid-market/cached-listings"),
        fetch("/api/fid-market/cached-trades"),
        fetch("/api/fid-market/activity"),
      ]);
      const listData     = await listRes.json();
      const tradeData    = await tradeRes.json();
      const activityData = activityRes.ok ? await activityRes.json() : { activity: [] };
      _cachedListings = listData.listings || [];
      _cachedTrades = tradeData.trades || [];
      _cachedTotalTradedEth = tradeData.totalTradedEth || "0";
      _cachedActivity = activityData.activity || [];
      setListings(_cachedListings);
      setTrades(_cachedTrades);
      setTotalTradedEth(_cachedTotalTradedEth);
      setActivity(_cachedActivity);

      const allFids = Array.from(new Set([
        ...(listData.listings     || []).map((l: Listing)       => l.fid),
        ...(activityData.activity || []).slice(0, 30).map((a: ActivityItem) => a.fid),
      ]));
      if (allFids.length > 0) {
        const infoRes = await fetch(`/api/fid-market/fid-info-bulk?fids=${allFids.join(",")}`);
        if (infoRes.ok) { _cachedFidInfoMap = await infoRes.json(); setFidInfoMap(_cachedFidInfoMap); }
      }
    } catch (e) { console.error("[Market] load error", e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);


  const filteredListings = listings
    .filter(l => {
      if (!search) return true;
      const q    = search.toLowerCase();
      const info = fidInfoMap[l.fid];
      return (
        String(l.fid).includes(q) ||
        (info?.username?.toLowerCase().includes(q)) ||
        (info?.displayName?.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      let primary = 0;
      if (sortBy === "price-asc") {
        const da = BigInt(a.priceWei), db = BigInt(b.priceWei);
        primary = da < db ? -1 : da > db ? 1 : 0;
      } else if (sortBy === "price-desc") {
        const da = BigInt(a.priceWei), db = BigInt(b.priceWei);
        primary = db < da ? -1 : db > da ? 1 : 0;
      } else if (sortBy === "newest") {
        primary = b.listedAt - a.listedAt;
      } else if (sortBy === "fid-asc") {
        primary = a.fid - b.fid;
      }
      return primary !== 0 ? primary : a.fid - b.fid; // stable tiebreaker
    });

  const buyableListings = filteredListings.filter(l => l.buyable);

  useEffect(() => { setListingsVisible(PAGE_SIZE); }, [search, sortBy]);
  useEffect(() => { setActivityVisible(PAGE_SIZE); }, [tab]);

  const listingsSentinelRef = useInfiniteScroll(
    () => setListingsVisible(v => v + PAGE_SIZE),
    filteredListings.length > listingsVisible, false
  );
  const activitySentinelRef = useInfiniteScroll(
    () => setActivityVisible(v => v + PAGE_SIZE),
    activity.length > activityVisible, false
  );

  const buyableCount = listings.filter(l => l.buyable).length;

  const ACTIVITY_CONFIG: Record<ActivityItem["type"], { label: string; dot: string; price: string }> = {
    listed:    { label: "Listed",    dot: "bg-violet-400",  price: "text-foreground" },
    sold:      { label: "Sold",      dot: "bg-emerald-400", price: "text-emerald-500" },
    cancelled: { label: "Cancelled", dot: "bg-rose-400",    price: "text-muted-foreground" },
  };

  return (
    <div className="min-h-screen bg-background pb-28 md:pb-8">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto h-14 flex items-center gap-3 px-4">
          <button
            onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/"); }}
            className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm shadow-violet-500/40">
              <Tag className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold text-foreground">FID Market</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/10 text-violet-500 border border-violet-500/20 font-semibold">v1</span>
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setShowHowTo(true)}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors disabled:opacity-40"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </header>

      {/* ── How-to modal ── */}
      {showHowTo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowHowTo(false)} />
          <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl flex flex-col max-h-[82vh]">
            <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm shadow-violet-500/30">
                  <Tag className="w-4 h-4 text-white" />
                </div>
                <span className="font-bold text-foreground text-sm">How to use FID Market</span>
              </div>
              <button onClick={() => setShowHowTo(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto overscroll-contain px-5 pb-3 space-y-3 flex-1">
              {[
                { icon: <Tag className="w-3.5 h-3.5 text-violet-500" />,    color: "bg-violet-500/10",  title: "Sell your current FID",       desc: "Sign in to FidCaster → tap the left card → set a price → List. Your FID goes on-chain." },
                { icon: <ShoppingCart className="w-3.5 h-3.5 text-emerald-500" />, color: "bg-emerald-500/10", title: "Buy any listed FID", desc: "Connect a browser wallet (MetaMask, Rainbow…) → browse listings → tap a FID → confirm." },
                { icon: <Wallet className="w-3.5 h-3.5 text-indigo-400" />, color: "bg-indigo-500/10",  title: "Sell a FID from another wallet", desc: "Connect that wallet → find the FID page → list it for sale." },
                { icon: <Zap className="w-3.5 h-3.5 text-amber-500" />,    color: "bg-amber-500/10",   title: "9% platform fee",              desc: "Buyers pay 9% on top. Sellers receive the full listed amount." },
                { icon: <ShieldCheck className="w-3.5 h-3.5 text-blue-500" />, color: "bg-blue-500/10", title: "Non-custodial & on-chain",     desc: "All trades settle on Optimism. No intermediary holds your FID or funds." },
              ].map((s, i) => (
                <div key={i} className="flex gap-3 items-start">
                  <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5", s.color)}>
                    {s.icon}
                  </div>
                  <div>
                    <p className="text-[0.8125rem] font-semibold text-foreground leading-snug">{s.title}</p>
                    <p className="text-xs text-muted-foreground leading-snug mt-0.5">{s.desc}</p>
                  </div>
                </div>
              ))}
              <a
                href="https://optimistic.etherscan.io/address/0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3"
                target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-violet-500 hover:text-violet-400 transition-colors pt-1"
              >
                <ExternalLink className="w-3 h-3" /> View smart contract
              </a>
            </div>
            <div className="shrink-0 px-5 pt-3 pb-5 border-t border-border/40">
              <button
                onClick={() => setShowHowTo(false)}
                className="w-full py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-semibold hover:opacity-90 transition-opacity shadow-md shadow-violet-500/20"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="max-w-2xl mx-auto px-4 pt-4 space-y-4">

        {/* ── Hero banner ── */}
        <div className="relative overflow-hidden rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/8 via-indigo-500/5 to-background p-5">
          {/* Glow orbs */}
          <div className="pointer-events-none absolute -top-16 -right-16 w-48 h-48 rounded-full bg-violet-600/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-8 -left-8 w-32 h-32 rounded-full bg-indigo-600/10 blur-2xl" />

          <div className="relative">
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/60" />
              Live · Optimism
            </p>

            {/* Stats grid */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: "Listed",   value: listings.length,                              icon: Tag,         color: "text-violet-500",  glow: "shadow-violet-500/20" },
                { label: "Buyable",  value: buyableCount,                                  icon: ShoppingCart, color: "text-emerald-500", glow: "shadow-emerald-500/20" },
                { label: "Trades",   value: trades.length,                                icon: Flame,       color: "text-amber-500",   glow: "shadow-amber-500/20" },
                { label: "Vol. ETH", value: parseFloat(totalTradedEth).toFixed(3),        icon: TrendingUp,  color: "text-indigo-400",  glow: "shadow-indigo-500/20" },
              ].map(s => {
                const Icon = s.icon;
                return (
                  <div key={s.label} className="flex flex-col gap-1">
                    <Icon className={cn("w-3.5 h-3.5", s.color)} />
                    <p className={cn("text-lg font-bold font-mono tracking-tight text-foreground leading-none")}>
                      {loading ? <span className="inline-block w-8 h-4 bg-muted/50 rounded animate-pulse" /> : s.value}
                    </p>
                    <p className="text-[10px] text-muted-foreground">{s.label}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Gateway cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          {/* Left: Sell / Manage */}
          {authMethod === "farcaster" ? (
            /* SIWF read-only: can browse but cannot list (no custody wallet) */
            <div className="flex items-start gap-3 p-4 rounded-2xl border border-violet-500/15 bg-violet-500/5">
              <div className="w-9 h-9 rounded-full bg-violet-500/12 flex items-center justify-center shrink-0 mt-0.5">
                <ShieldCheck className="w-4 h-4 text-violet-400" />
              </div>
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-sm font-bold text-foreground">
                  {profile?.displayName || profile?.username || `FID ${Number(myFidNum)}`}
                  {myFidNum && (
                    <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-400 border border-violet-500/20">
                      #{Number(myFidNum)}
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Signed in via Farcaster. To list or manage your FID, sign in with your recovery phrase or connect a wallet.
                </p>
                <button
                  onClick={() => navigate("/login")}
                  className="text-xs font-semibold text-violet-500 hover:text-violet-400 transition-colors flex items-center gap-1 mt-0.5"
                >
                  Switch sign-in method <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          ) : myFidNum && myAddress ? (
            <button
              onClick={() => navigate(`/market/${myFidNum}`)}
              className="group relative overflow-hidden flex flex-col gap-3.5 p-4 rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/8 to-background hover:border-violet-500/40 hover:from-violet-500/12 transition-all text-left"
            >
              <div className="pointer-events-none absolute top-0 right-0 w-24 h-24 rounded-full bg-violet-500/10 blur-2xl" />
              <div className="relative flex items-center gap-3">
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-full overflow-hidden ring-2 ring-violet-500/30">
                    {profile?.pfpUrl
                      ? <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full bg-gradient-to-br from-violet-500/30 to-indigo-600/30 flex items-center justify-center"><User className="w-5 h-5 text-violet-400" /></div>
                    }
                  </div>
                  {myFidListing && <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-background shadow-sm shadow-emerald-400/60" />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground truncate leading-tight">
                    {profile?.displayName || profile?.username || `FID ${myFidNum}`}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-500 border border-violet-500/25">#{myFidNum}</span>
                    {myFidListingLoaded && myFidListing && (
                      <span className="text-[10px] text-emerald-500 font-medium">{parseFloat(myFidListing.priceEth).toFixed(4)} ETH</span>
                    )}
                  </div>
                </div>
              </div>
              <p className="relative text-xs text-muted-foreground leading-relaxed">
                {myFidListing ? "Manage or delist your active listing." : "List your FID for sale on Optimism."}
              </p>
              <div className="relative flex items-center gap-1.5 text-xs font-semibold text-violet-500">
                <Tag className="w-3.5 h-3.5" />
                {myFidListing ? "Manage listing" : "List for sale"}
                <ChevronRight className="w-3.5 h-3.5 ml-auto group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          ) : extWallet && detectedExtFid ? (
            /* Not logged into FidCaster, but market wallet connected + FID detected */
            <button
              onClick={() => navigate(`/market/${detectedExtFid}`)}
              className="group relative overflow-hidden flex flex-col gap-3.5 p-4 rounded-2xl border border-violet-500/20 bg-gradient-to-br from-violet-500/8 to-background hover:border-violet-500/40 hover:from-violet-500/12 transition-all text-left"
            >
              <div className="pointer-events-none absolute top-0 right-0 w-24 h-24 rounded-full bg-violet-500/10 blur-2xl" />
              <div className="relative flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500/30 to-indigo-600/30 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-violet-400 font-mono">#{detectedExtFid}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground truncate leading-tight">Your FID</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-500 border border-violet-500/25">#{detectedExtFid}</span>
                    <span className="text-[10px] text-emerald-500 font-medium">Detected via wallet</span>
                  </div>
                </div>
              </div>
              <p className="relative text-xs text-muted-foreground leading-relaxed">
                Your connected wallet owns this FID. Tap to list it for sale on Optimism.
              </p>
              <div className="relative flex items-center gap-1.5 text-xs font-semibold text-violet-500">
                <Tag className="w-3.5 h-3.5" />
                List for sale
                <ChevronRight className="w-3.5 h-3.5 ml-auto group-hover:translate-x-0.5 transition-transform" />
              </div>
            </button>
          ) : (
            <div className="flex flex-col gap-3.5 p-4 rounded-2xl border border-border/40 bg-muted/20">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-full bg-muted/50 flex items-center justify-center shrink-0">
                  <Lock className="w-5 h-5 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-bold text-foreground">Sell my FID</p>
                  <p className="text-xs text-muted-foreground">Sign in to list your FID for sale.</p>
                </div>
              </div>
              <button
                onClick={() => navigate("/")}
                className="text-xs font-semibold text-violet-500 hover:text-violet-400 transition-colors text-left flex items-center gap-1"
              >
                Sign in to FidCaster
                <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* Right: Buy / Trade */}
          <div className={cn(
            "relative overflow-hidden flex flex-col gap-3.5 p-4 rounded-2xl border transition-all",
            extWallet
              ? "border-emerald-500/30 bg-gradient-to-br from-emerald-500/8 to-background"
              : "border-border/40 bg-muted/20"
          )}>
            {extWallet && <div className="pointer-events-none absolute top-0 right-0 w-24 h-24 rounded-full bg-emerald-500/10 blur-2xl" />}
            <div className="relative flex items-center gap-3">
              <div className={cn(
                "w-11 h-11 rounded-full flex items-center justify-center shrink-0 transition-all",
                extWallet ? "bg-emerald-500/15 ring-2 ring-emerald-500/30" : "bg-muted/50"
              )}>
                <Wallet className={cn("w-5 h-5", extWallet ? "text-emerald-500" : "text-muted-foreground/40")} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">Buy / Trade FIDs</p>
                {extWallet ? (
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm shadow-emerald-400/60" />
                    <span className="text-[10px] font-mono text-emerald-500 font-semibold">{shortAddr(extWallet.address)}</span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">Connect an external wallet</p>
                )}
              </div>
            </div>
            <p className="relative text-xs text-muted-foreground leading-relaxed">
              {extWallet
                ? "Ready to buy. Browse listings below and tap any FID."
                : "MetaMask, Rainbow, or any WalletConnect wallet."}
            </p>
            {extWallet && detectedExtFid && (
              <button
                onClick={() => navigate(`/market/${detectedExtFid}`)}
                className="relative flex items-center gap-2 py-2 px-3.5 rounded-xl text-xs font-bold transition-all w-fit"
                style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", color: "rgb(167,139,250)" }}
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-400" />
                FID #{detectedExtFid} detected — List for sale →
              </button>
            )}
            {extWallet ? (
              <button
                onClick={disconnectExt}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-rose-400 transition-colors w-fit font-medium"
              >
                <X className="w-3 h-3" /> Disconnect
              </button>
            ) : (
              <button
                onClick={connectExt}
                disabled={connectingExt}
                className="flex items-center gap-2 py-2 px-4 rounded-xl bg-foreground text-background text-xs font-bold hover:opacity-85 transition-opacity disabled:opacity-40 w-fit shadow-sm"
              >
                {connectingExt
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Wallet className="w-3.5 h-3.5" />}
                {connectingExt ? "Connecting…" : "Connect Wallet"}
              </button>
            )}
          </div>
        </div>

        {/* ── Tabs row ── */}
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 p-1 rounded-xl bg-muted/40 border border-border/40">
            {(["listings", "activity"] as const).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                  tab === t
                    ? "bg-background text-foreground shadow-sm border border-border/40"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t === "listings"
                  ? `Listings${!loading ? ` (${filteredListings.length})` : ""}`
                  : `Activity${!loading ? ` (${activity.length})` : ""}`}
              </button>
            ))}
          </div>

          {tab === "listings" && (
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search FID, username…"
                className="w-full pl-9 pr-8 py-2 text-xs rounded-xl border border-border/60 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500/40 transition-all"
              />
              {search && (
                <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Sort chips (listings only) ── */}
        {tab === "listings" && (
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mt-1">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border whitespace-nowrap",
                  sortBy === opt.value
                    ? "bg-violet-500 text-white border-violet-500 shadow-sm shadow-violet-500/25"
                    : "bg-card text-muted-foreground border-border/60 hover:border-violet-400/40 hover:text-foreground hover:bg-violet-500/5"
                )}
              >
                {sortBy === opt.value && <Check className="w-3 h-3" />}
                {opt.label}
              </button>
            ))}
          </div>
        )}

        {/* ── Listings ── */}
        {tab === "listings" && (
          <>
            {loading ? (
              <div className="space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-[72px] rounded-2xl bg-muted/30 animate-pulse border border-border/30" />
                ))}
              </div>
            ) : filteredListings.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                  <Tag className="w-5 h-5 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">{search ? "No listings match your search." : "No active listings yet."}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredListings.slice(0, listingsVisible).map(listing => {
                  const info      = fidInfoMap[listing.fid];
                  const priceEth  = parseFloat(listing.priceEth);
                  const totalEth  = priceEth * 1.09;
                  const priceDisp = totalEth >= 0.001 ? totalEth.toFixed(4) : totalEth.toFixed(6);
                  const usdVal    = ethUsd ? (totalEth * ethUsd).toFixed(0) : null;
                  const now       = Math.floor(Date.now() / 1000);
                  const deadlineDiff = listing.fromDeadline ? listing.fromDeadline - now : 0;
                  const daysLeft  = deadlineDiff > 0 ? Math.floor(deadlineDiff / 86400) : 0;
                  const hoursLeft = deadlineDiff > 0 && daysLeft === 0 ? Math.floor(deadlineDiff / 3600) : 0;
                  const expiresLabel = !listing.fromDeadline ? null
                    : deadlineDiff <= 0 ? "Expired"
                    : daysLeft > 0 ? `${daysLeft}d left` : `${hoursLeft}h left`;
                  const nearExpiry = deadlineDiff > 0 && deadlineDiff < 86400;

                  return (
                    <button
                      key={listing.fid}
                      onClick={() => navigate(`/market/${listing.fid}`)}
                      className="group w-full flex items-center gap-3.5 p-4 rounded-2xl border border-border/50 bg-card hover:border-violet-500/25 hover:bg-accent/20 hover:shadow-lg hover:shadow-violet-500/5 hover:-translate-y-px transition-all text-left"
                    >
                      {/* Avatar */}
                      <div className="shrink-0 relative">
                        {info?.pfpUrl ? (
                          <img src={info.pfpUrl} alt="" className="w-11 h-11 rounded-full object-cover ring-2 ring-border/50 group-hover:ring-violet-500/20 transition-all" />
                        ) : (
                          <div className="w-11 h-11 rounded-full bg-gradient-to-br from-violet-500/25 to-indigo-600/25 border border-violet-500/20 flex items-center justify-center">
                            <span className="text-xs font-bold text-violet-400 font-mono">{listing.fid}</span>
                          </div>
                        )}
                        <div className={cn(
                          "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
                          listing.buyable ? "bg-emerald-400 shadow-sm shadow-emerald-400/60" : "bg-muted-foreground/30"
                        )} />
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold text-sm text-foreground truncate leading-tight">
                            {info?.displayName || `FID ${listing.fid}`}
                          </span>
                          {!listing.buyable && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20 font-semibold shrink-0">
                              {listing.sigExpired ? "Sig exp." : "Expired"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {info?.username && (
                            <span className="text-xs text-violet-500 font-medium">@{info.username}</span>
                          )}
                          <span className="text-[10px] text-muted-foreground/60 font-mono">#{listing.fid}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1">
                          {listing.listedAt > 0 && (
                            <span className="text-[10px] text-muted-foreground/50">{timeAgo(listing.listedAt)}</span>
                          )}
                          {listing.listedAt > 0 && expiresLabel && <span className="text-[10px] text-muted-foreground/30">·</span>}
                          {expiresLabel && (
                            <span className={cn(
                              "text-[10px] font-medium",
                              deadlineDiff <= 0 ? "text-rose-400" : nearExpiry ? "text-amber-400" : "text-muted-foreground/50"
                            )}>
                              {deadlineDiff <= 0 ? "Sig expired" : `Sig ${expiresLabel}`}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Price */}
                      <div className="text-right shrink-0">
                        <p className="font-bold text-sm text-foreground font-mono tabular-nums leading-tight">
                          {priceDisp}
                          <span className="text-muted-foreground font-normal text-xs ml-0.5">ETH</span>
                        </p>
                        {usdVal && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">${usdVal}</p>
                        )}
                      </div>

                      <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </button>
                  );
                })}
                {filteredListings.length > listingsVisible && (
                  <div ref={listingsSentinelRef} className="flex justify-center py-4" />
                )}
              </div>
            )}
          </>
        )}

        {/* ── Activity ── */}
        {tab === "activity" && (
          <div className="space-y-2">
            {loading ? (
              [...Array(4)].map((_, i) => (
                <div key={i} className="h-16 rounded-2xl bg-muted/30 animate-pulse border border-border/30" />
              ))
            ) : activity.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-12 h-12 rounded-2xl bg-muted/40 flex items-center justify-center">
                  <Activity className="w-5 h-5 text-muted-foreground/40" />
                </div>
                <p className="text-sm text-muted-foreground">No activity yet.</p>
              </div>
            ) : activity.slice(0, activityVisible).map((ev, i) => {
              const info   = fidInfoMap[ev.fid];
              const cfg    = ACTIVITY_CONFIG[ev.type];
              const hasPrice = ev.type !== "cancelled" && parseFloat(ev.priceEth) > 0;

              return (
                <div key={`${ev.transactionHash}-${i}`} className="relative flex items-center gap-3.5 p-4 pl-5 rounded-2xl border border-border/50 bg-card overflow-hidden">
                  <div className={cn(
                    "absolute left-0 top-0 bottom-0 w-[3px]",
                    ev.type === "listed" ? "bg-violet-500" : ev.type === "sold" ? "bg-emerald-500" : "bg-rose-400"
                  )} />
                  <div className="relative shrink-0">
                    {info?.pfpUrl ? (
                      <img src={info.pfpUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500/20 to-indigo-600/20 border border-violet-500/15 flex items-center justify-center">
                        <span className="text-xs font-bold text-violet-400 font-mono">{ev.fid}</span>
                      </div>
                    )}
                    <div className={cn("absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background", cfg.dot)} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground truncate">
                        {info?.displayName || `FID ${ev.fid}`}
                      </span>
                      {info?.username && (
                        <span className="text-xs text-violet-500 font-medium shrink-0">@{info.username}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                        ev.type === "listed"    ? "bg-violet-500/10 text-violet-500" :
                        ev.type === "sold"      ? "bg-emerald-500/10 text-emerald-500" :
                                                  "bg-rose-500/10 text-rose-400"
                      )}>
                        {cfg.label}
                      </span>
                      <span className="text-[10px] text-muted-foreground/60 font-mono">
                        {ev.type === "sold" && ev.buyer
                          ? `${shortAddr(ev.seller)} → ${shortAddr(ev.buyer)}`
                          : shortAddr(ev.seller)}
                      </span>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    {hasPrice && (
                      <p className={cn("font-bold text-sm font-mono", cfg.price)}>
                        {parseFloat(ev.priceEth).toFixed(4)}
                        <span className="text-muted-foreground font-normal text-xs ml-0.5">ETH</span>
                      </p>
                    )}
                    <a
                      href={`https://optimistic.etherscan.io/tx/${ev.transactionHash}`}
                      target="_blank" rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      className="text-[10px] text-muted-foreground/40 hover:text-violet-400 transition-colors flex items-center gap-0.5 justify-end mt-0.5"
                    >
                      <ExternalLink className="w-2.5 h-2.5" /> Tx
                    </a>
                  </div>
                </div>
              );
            })}
            {activity.length > activityVisible && (
              <div ref={activitySentinelRef} className="flex justify-center py-4" />
            )}
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground/40 pt-2 pb-4">
          <a
            href="https://optimistic.etherscan.io/address/0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3"
            target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 hover:text-muted-foreground transition-colors"
          >
            <ExternalLink className="w-2.5 h-2.5" /> Contract
          </a>
          <span>·</span>
          <span>9% fee</span>
          <span>·</span>
          <span>Optimism</span>
          <span>·</span>
          <span>FidMarket v1</span>
        </div>

      </div>

      {/* ── Mobile bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-xl flex items-center" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
        <button onClick={() => navigate("/dashboard")} className="flex-1 flex items-center justify-center py-3.5 transition-colors">
          <Home className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
        </button>
        <button onClick={() => navigate("/dashboard")} className="flex-1 flex items-center justify-center py-3.5 transition-colors">
          <Search className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
        </button>
        <button onClick={() => navigate("/dashboard")} className="flex-1 flex items-center justify-center py-3.5 transition-colors">
          <Layers className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
        </button>
        <button onClick={() => navigate("/dashboard")} className="flex-1 flex items-center justify-center py-3.5 transition-colors">
          <Bell className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
        </button>
        <button className="flex-1 flex items-center justify-center py-3.5 transition-colors">
          <Tag className="w-6 h-6 text-primary" strokeWidth={2.5} />
        </button>
        <button
          onClick={() => { if (myFid) navigate(`/profile/${myFid}`); else navigate("/dashboard"); }}
          className="flex-1 flex items-center justify-center py-3.5 transition-colors"
        >
          <User className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
        </button>
      </nav>
    </div>
  );
}
