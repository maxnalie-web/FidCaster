/**
 * FidCaster Mini App v2 — Premium Design
 *
 * Matches the landing-page aesthetic: dark aurora, glassmorphism, floating
 * particles, animated counters, podium leaderboard, NFT Pass card.
 *
 * Flow:
 *  LOADING  → spinner while SDK resolves
 *  ONBOARD  → opened in plain browser — explains how to participate
 *  MAIN APP → inside Warpcast with a valid FID
 */
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sdk } from "@farcaster/miniapp-sdk";
import {
  Trophy, Copy, Check, Loader2, Lock, Zap, ExternalLink,
  ArrowRight, Crown, Gift, Activity, Wallet, ChevronRight,
  Star, Users, TrendingUp, Medal, Sparkles,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────
interface LeaderboardRow { fid: number; total_points: number; rank: number; }
interface FidPoints {
  fid: number;
  total_points: number;
  breakdown: { action_type: string; total_actions: number; points_earned: number }[];
}
interface MiniCtx {
  user?: {
    fid: number; username?: string; displayName?: string; pfpUrl?: string;
    verifiedAddresses?: { eth_addresses?: string[] };
  };
  client?: { added?: boolean };
}

// ── Hook: Farcaster SDK context ───────────────────────────────────────────────
function useMiniAppFid() {
  const [sdkFid, setSdkFid]     = useState<number | null>(null);
  const [sdkCtx, setSdkCtx]     = useState<MiniCtx | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [isInFarcaster, setInFC] = useState(false);
  const [added, setAdded]       = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      sdk.actions.ready().catch(() => {});
      try {
        const ctx = await Promise.race([
          sdk.context as Promise<MiniCtx>,
          new Promise<null>((r) => setTimeout(() => r(null), 2500)),
        ]);
        if (!cancelled && ctx?.user?.fid) {
          setSdkCtx(ctx); setSdkFid(ctx.user.fid); setInFC(true);
          setAdded(!!(ctx as any).client?.added);
        }
      } catch { /* browser env */ }
      finally { if (!cancelled) setSdkReady(true); }
    }
    init();
    return () => { cancelled = true; };
  }, []);

  async function addMiniApp() {
    try { await (sdk.actions as any).addMiniApp(); setAdded(true); } catch {}
  }
  return { sdkFid, sdkCtx, sdkReady, isInFarcaster, added, addMiniApp };
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function fetchPoints(fid: number): Promise<FidPoints | null> {
  try { const r = await fetch(`/api/points/my?fid=${fid}`); return r.ok ? r.json() : null; }
  catch { return null; }
}
async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const r = await fetch("/api/points/leaderboard?limit=50");
    if (!r.ok) return [];
    const d = await r.json();
    return d.leaderboard ?? [];
  } catch { return []; }
}

// ── Animated counter ──────────────────────────────────────────────────────────
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const start = ref.current; const end = value; const dur = 1100;
    const t0 = performance.now();
    function step(now: number) {
      const p = Math.min((now - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 4);
      const cur = Math.round(start + (end - start) * ease);
      setDisplay(cur); ref.current = cur;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [value]);
  return <span className={className}>{display.toLocaleString()}</span>;
}

// ── Particles ─────────────────────────────────────────────────────────────────
function Particles() {
  const particles = useMemo(() =>
    Array.from({ length: 38 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: Math.random() * 2.5 + 0.5,
      duration: Math.random() * 24 + 14,
      delay: Math.random() * 20,
      color: i % 5 === 0
        ? "rgba(240,171,252,0.75)" : i % 4 === 0
        ? "rgba(129,140,248,0.65)" : i % 3 === 0
        ? "rgba(192,38,211,0.45)"
        : "rgba(139,92,246,0.4)",
    })), []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <div key={p.id} className="absolute rounded-full"
          style={{
            left: `${p.x}%`, bottom: "-6px",
            width: p.size, height: p.size,
            background: p.color,
            animation: `lp-particle-rise ${p.duration}s ${p.delay}s linear infinite`,
          }} />
      ))}
    </div>
  );
}

// ── Background ────────────────────────────────────────────────────────────────
function Background() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background: "#06011A", zIndex: 0 }}>
      <div className="absolute inset-0 lp-grid-bg opacity-25" />
      <div className="lp-orb-1 absolute" style={{
        width: 500, height: 500,
        background: "radial-gradient(circle, rgba(124,58,237,0.32) 0%, rgba(109,40,217,0.12) 50%, transparent 70%)",
        top: "-12%", left: "-10%", borderRadius: "50%", filter: "blur(65px)",
      }} />
      <div className="lp-orb-2 absolute" style={{
        width: 420, height: 420,
        background: "radial-gradient(circle, rgba(99,102,241,0.26) 0%, rgba(139,92,246,0.10) 50%, transparent 70%)",
        bottom: "0%", right: "-12%", borderRadius: "50%", filter: "blur(72px)",
      }} />
      <div className="lp-orb-3 absolute" style={{
        width: 280, height: 280,
        background: "radial-gradient(circle, rgba(192,38,211,0.18) 0%, transparent 70%)",
        top: "38%", right: "12%", borderRadius: "50%", filter: "blur(55px)",
      }} />
      <Particles />
    </div>
  );
}

// ── Loading screen ────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
        className="lp-border-glow w-20 h-20 rounded-[22px] flex items-center justify-center relative"
        style={{ background: "rgba(124,58,237,0.18)", border: "1px solid rgba(139,92,246,0.5)" }}
      >
        <div className="lp-shimmer" />
        <img src="/icons/icon-512-dark.png" alt="FidCaster" className="w-12 h-12 rounded-xl lp-float" />
      </motion.div>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex flex-col items-center gap-2"
      >
        <Loader2 className="w-4 h-4 animate-spin" style={{ color: "rgba(167,139,250,0.7)" }} />
        <p className="text-xs" style={{ color: "rgba(167,139,250,0.5)" }}>Connecting to Farcaster…</p>
      </motion.div>
    </div>
  );
}

// ── Onboarding screen (browser / non-Farcaster) ───────────────────────────────
function OnboardingScreen() {
  const steps = [
    {
      icon: <TrendingUp className="w-5 h-5" style={{ color: "#a78bfa" }} />,
      title: "Visit fidcaster.xyz",
      desc: "Open the full FidCaster app in any browser",
      color: "#7c3aed",
    },
    {
      icon: <Zap className="w-5 h-5" style={{ color: "#fbbf24" }} />,
      title: "Sign in with Farcaster",
      desc: "Connect your identity — no email, no password needed",
      color: "#d97706",
    },
    {
      icon: <Activity className="w-5 h-5" style={{ color: "#34d399" }} />,
      title: "Cast, follow & trade FIDs",
      desc: "Every action on FidCaster earns you points automatically",
      color: "#059669",
    },
    {
      icon: <Gift className="w-5 h-5" style={{ color: "#f472b6" }} />,
      title: "Earn your airdrop",
      desc: "Your points determine your share of the token distribution",
      color: "#db2777",
    },
  ];

  return (
    <div className="relative z-10 min-h-screen flex flex-col items-center px-5 pt-12 pb-10 max-w-lg mx-auto">
      {/* Logo */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-col items-center mb-8"
      >
        <div className="lp-border-glow w-20 h-20 rounded-[22px] flex items-center justify-center mb-4 lp-float relative overflow-hidden"
          style={{ background: "rgba(124,58,237,0.18)", border: "1px solid rgba(139,92,246,0.45)" }}>
          <div className="lp-shimmer" />
          <img src="/icons/icon-512-dark.png" alt="" style={{ width: 52, height: 52 }} className="rounded-xl" />
        </div>
        <h1 className="text-3xl font-black tracking-tight mb-1">
          <span className="fidcaster-brand">FidCaster</span>
        </h1>
        <p className="text-center text-sm" style={{ color: "rgba(167,139,250,0.7)" }}>
          Points · Leaderboard · Airdrop
        </p>
      </motion.div>

      {/* How it works */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15 }}
        className="lp-glass-card w-full p-5 mb-4"
      >
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-4"
          style={{ color: "rgba(167,139,250,0.55)" }}>
          How to participate
        </p>
        <div className="space-y-4">
          {steps.map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, x: -14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4, delay: 0.25 + i * 0.08 }}
              className="flex items-start gap-3.5"
            >
              <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center"
                style={{
                  background: `${s.color}20`,
                  border: `1px solid ${s.color}35`,
                }}>
                {s.icon}
              </div>
              <div>
                <p className="text-sm font-bold text-white">{s.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.6)" }}>{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* NFT Pass preview */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.5 }}
        className="lp-glass-card w-full p-4 mb-4 flex items-center gap-4"
      >
        <div className="relative w-16 h-16 shrink-0">
          <div className="absolute inset-0 rounded-2xl lp-glow-breathe"
            style={{ background: "radial-gradient(circle, rgba(124,58,237,0.4) 0%, transparent 70%)", filter: "blur(8px)" }} />
          <img src="/nft-pass-v2.png" alt="FidCaster Pass"
            className="relative w-16 h-16 rounded-2xl object-contain lp-float"
            style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(139,92,246,0.3)" }} />
        </div>
        <div>
          <p className="text-sm font-bold text-white">FidCaster Pass</p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.65)" }}>
            Free NFT pass · Mint yours for app access
          </p>
          <span className="inline-block mt-1.5 text-[10px] px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(124,58,237,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.35)" }}>
            Open inside Warpcast to mint
          </span>
        </div>
      </motion.div>

      {/* CTA */}
      <motion.a
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        href="https://fidcaster.xyz"
        className="lp-cta-btn w-full text-center flex items-center justify-center gap-2"
      >
        Open FidCaster App
        <ArrowRight className="w-4 h-4" />
      </motion.a>
      <p className="mt-3 text-xs text-center" style={{ color: "rgba(167,139,250,0.35)" }}>
        Then open this mini app inside Warpcast to track your points
      </p>
    </div>
  );
}

// ── NFT Pass Card ─────────────────────────────────────────────────────────────
function NFTPassCard({ fid, ethAddress }: { fid: number; ethAddress?: string }) {
  const [status, setStatus]   = useState<"idle" | "input" | "minting" | "done" | "error">("idle");
  const [address, setAddress] = useState(ethAddress ?? "");
  const [txHash, setTxHash]   = useState("");
  const [errMsg, setErrMsg]   = useState("");
  const [hasMinted, setHasMinted] = useState(false);

  // Check on mount if address already has the pass
  useEffect(() => {
    if (!ethAddress) return;
    fetch(`/api/nft-pass/check/${ethAddress}`)
      .then((r) => r.json())
      .then((d) => { if (d.hasMinted) setHasMinted(true); })
      .catch(() => {});
  }, [ethAddress]);

  async function handleMint() {
    const addr = address.trim();
    if (!addr) return;
    setStatus("minting");
    try {
      const r = await fetch("/api/nft-pass/mint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid, address: addr }),
      });
      const d = await r.json();
      if (d.alreadyMinted) { setHasMinted(true); setStatus("done"); return; }
      if (!r.ok) throw new Error(d.error ?? "mint failed");
      setTxHash(d.txHash ?? "");
      setStatus("done");
      setHasMinted(true);
    } catch (e) {
      setErrMsg(String(e));
      setStatus("error");
    }
  }

  if (hasMinted || status === "done") {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="lp-glass-card p-4 relative overflow-hidden"
      >
        <div className="lp-shimmer" style={{ "--shimmer-delay": "1s" } as React.CSSProperties} />
        <div className="flex items-center gap-4">
          <div className="relative w-14 h-14 shrink-0">
            <div className="absolute inset-0 rounded-xl lp-glow-breathe"
              style={{ background: "radial-gradient(circle, rgba(52,211,153,0.4) 0%, transparent 70%)", filter: "blur(8px)" }} />
            <img src="/nft-pass.png" alt="FidCaster Pass"
              className="relative w-14 h-14 rounded-xl object-contain"
              style={{ background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.35)" }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-sm font-bold text-white">FidCaster Pass</p>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                style={{ background: "rgba(52,211,153,0.15)", color: "#34d399", border: "1px solid rgba(52,211,153,0.3)" }}>
                ✓ Minted
              </span>
            </div>
            <p className="text-xs" style={{ color: "rgba(167,139,250,0.6)" }}>App access unlocked</p>
            {txHash && (
              <a href={`https://optimistic.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1 text-[10px]"
                style={{ color: "rgba(139,92,246,0.8)" }}>
                View tx <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="lp-glass-card p-4 relative overflow-hidden"
    >
      <div className="lp-shimmer" style={{ "--shimmer-delay": "2s" } as React.CSSProperties} />

      <div className="flex items-center gap-4 mb-3">
        <div className="relative w-14 h-14 shrink-0">
          <div className="absolute inset-0 rounded-xl lp-glow-breathe"
            style={{ background: "radial-gradient(circle, rgba(124,58,237,0.45) 0%, transparent 70%)", filter: "blur(10px)" }} />
          <img src="/nft-pass.png" alt="FidCaster Pass"
            className="relative w-14 h-14 rounded-xl object-contain lp-float"
            style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(139,92,246,0.4)" }} />
        </div>
        <div>
          <p className="text-sm font-bold text-white">FidCaster Pass</p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.6)" }}>
            Free NFT · Grants app access
          </p>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.35)" }}>Unlimited · Free to mint</span>
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {status !== "input" ? (
          <motion.button
            key="btn"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setStatus("input")}
            className="lp-cta-btn w-full text-sm flex items-center justify-center gap-2"
            style={{ padding: "0.6rem 1rem" }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Mint Free Pass
          </motion.button>
        ) : (
          <motion.div
            key="form"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-2"
          >
            <input
              type="text"
              placeholder="0x… your ETH address on Optimism"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full text-xs px-3 py-2.5 rounded-xl outline-none font-mono"
              style={{
                background: "rgba(15,8,40,0.9)",
                border: "1px solid rgba(139,92,246,0.35)",
                color: "rgba(255,255,255,0.85)",
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={handleMint}
                disabled={status === "minting" || !address.trim()}
                className="lp-cta-btn flex-1 text-xs flex items-center justify-center gap-1.5 disabled:opacity-50"
                style={{ padding: "0.55rem 0.75rem" }}
              >
                {status === "minting"
                  ? <><Loader2 className="w-3 h-3 animate-spin" /> Minting…</>
                  : <><Sparkles className="w-3 h-3" /> Mint</>}
              </button>
              <button
                onClick={() => setStatus("idle")}
                className="px-3 py-2 rounded-xl text-xs"
                style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}
              >
                Cancel
              </button>
            </div>
            {status === "error" && (
              <p className="text-[10px] text-rose-400 px-1">{errMsg}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Tab component ─────────────────────────────────────────────────────────────
type Tab = "points" | "leaderboard" | "airdrop";

// ── Points breakdown bar ──────────────────────────────────────────────────────
const ACTION_LABELS: Record<string, string> = {
  cast: "Casts", like: "Likes", recast: "Recasts",
  follow: "Follows", market_buy: "Market Buys", market_list: "Listings",
  grow_campaign_start: "Grow Campaigns", referral: "Referrals", app_open: "App Opens",
};
const ACTION_COLORS: Record<string, string> = {
  cast: "#a78bfa", like: "#f472b6", recast: "#60a5fa",
  follow: "#34d399", market_buy: "#fbbf24", market_list: "#fb923c",
  grow_campaign_start: "#c084fc", referral: "#22d3ee", app_open: "#a3e635",
};

// ── Main App ──────────────────────────────────────────────────────────────────
function MainApp({ sdkFid, sdkCtx, added, addMiniApp }: {
  sdkFid: number; sdkCtx: MiniCtx | null; added: boolean; addMiniApp: () => void;
}) {
  const [tab, setTab]         = useState<Tab>("points");
  const [points, setPoints]   = useState<FidPoints | null>(null);
  const [leaderboard, setLB]  = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied]   = useState(false);
  const [visible, setVisible] = useState(false);

  const username  = sdkCtx?.user?.username ?? `fid${sdkFid}`;
  const pfpUrl    = sdkCtx?.user?.pfpUrl   ?? null;
  const ethAddr   = sdkCtx?.user?.verifiedAddresses?.eth_addresses?.[0];
  const referralUrl = `https://fidcaster.xyz/?ref=${sdkFid.toString(36).toUpperCase()}`;

  useEffect(() => {
    setTimeout(() => setVisible(true), 60);
    setLoading(true);
    Promise.all([fetchPoints(sdkFid), fetchLeaderboard()])
      .then(([pts, lb]) => { setPoints(pts); setLB(lb); })
      .finally(() => setLoading(false));
  }, [sdkFid]);

  const totalPts = points?.total_points ?? 0;
  const rank = leaderboard.find((r) => r.fid === sdkFid)?.rank ?? null;
  const top3 = leaderboard.slice(0, 3);
  const rest = leaderboard.slice(3);

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(referralUrl).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [referralUrl]);

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "points",      label: "Points",      icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: "leaderboard", label: "Board",        icon: <Trophy className="w-3.5 h-3.5" /> },
    { id: "airdrop",     label: "Airdrop",      icon: <Gift className="w-3.5 h-3.5" /> },
  ];

  return (
    <div
      className="relative z-10 flex flex-col max-w-lg mx-auto min-h-screen pb-8"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 0.4s ease" }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-10 pb-3">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="lp-glass-card p-4 flex items-center gap-3 relative overflow-hidden"
        >
          <div className="lp-shimmer" />
          {/* Avatar */}
          <div className="relative shrink-0">
            {pfpUrl ? (
              <img src={pfpUrl} alt="" className="w-11 h-11 rounded-full object-cover"
                style={{ border: "2px solid rgba(139,92,246,0.55)" }} />
            ) : (
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-black"
                style={{ background: "linear-gradient(135deg,#7c3aed,#a855f7)", border: "2px solid rgba(139,92,246,0.5)", color: "white" }}>
                {String(username).slice(0, 2).toUpperCase()}
              </div>
            )}
            <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-400 border-2"
              style={{ borderColor: "#0f0828" }} />
          </div>

          {/* Name */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-white truncate">@{username}</p>
            <p className="text-[11px]" style={{ color: "rgba(167,139,250,0.6)" }}>FID {sdkFid}</p>
          </div>

          {/* Points badge */}
          {totalPts > 0 && (
            <div className="shrink-0 px-2.5 py-1 rounded-full text-[11px] font-bold"
              style={{ background: "rgba(124,58,237,0.25)", border: "1px solid rgba(139,92,246,0.4)", color: "#c4b5fd" }}>
              {totalPts.toLocaleString()} pts
            </div>
          )}

          {/* Add button */}
          {!added && (
            <button onClick={addMiniApp}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105"
              style={{ background: "rgba(124,58,237,0.22)", border: "1px solid rgba(139,92,246,0.4)", color: "#c4b5fd" }}>
              <Zap className="w-3 h-3" /> Add
            </button>
          )}
        </motion.div>
      </div>

      {/* ── Tab bar ─────────────────────────────────────────────────────────── */}
      <div className="px-4 mb-4">
        <div className="flex gap-1 p-1 rounded-2xl"
          style={{ background: "rgba(15,8,40,0.7)", border: "1px solid rgba(139,92,246,0.12)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200"
              style={tab === t.id ? {
                background: "rgba(124,58,237,0.3)",
                border: "1px solid rgba(139,92,246,0.45)",
                color: "#c4b5fd",
                boxShadow: "0 0 16px rgba(124,58,237,0.25)",
              } : {
                color: "rgba(167,139,250,0.4)",
                border: "1px solid transparent",
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────────── */}
      <div className="px-4 flex flex-col gap-3">
        <AnimatePresence mode="wait">

          {/* ── POINTS TAB ─────────────────────────────────────────── */}
          {tab === "points" && (
            <motion.div
              key="points"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-3"
            >
              {/* NFT Pass */}
              <NFTPassCard fid={sdkFid} ethAddress={ethAddr} />

              {/* Hero points card */}
              <div className="lp-glass-card p-6 text-center relative overflow-hidden">
                <div className="lp-shimmer" style={{ "--shimmer-delay": "0.5s" } as React.CSSProperties} />
                {/* Glow behind number */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div style={{
                    width: 160, height: 160, borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(124,58,237,0.25) 0%, transparent 70%)",
                    filter: "blur(32px)",
                  }} />
                </div>
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] mb-2" style={{ color: "rgba(167,139,250,0.5)" }}>
                  Total Points
                </p>
                {loading ? (
                  <div className="flex items-center justify-center gap-2 h-16">
                    <Loader2 className="w-5 h-5 animate-spin" style={{ color: "rgba(139,92,246,0.6)" }} />
                  </div>
                ) : (
                  <div className="lp-gradient-text text-6xl font-black mb-1" style={{
                    letterSpacing: "-0.04em",
                    textShadow: "0 0 48px rgba(139,92,246,0.55)",
                  }}>
                    <AnimatedNumber value={totalPts} />
                  </div>
                )}
                <div className="flex items-center justify-center gap-3 mt-3">
                  {rank && (
                    <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold"
                      style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", color: "#fbbf24" }}>
                      <Trophy className="w-3 h-3" /> Rank #{rank}
                    </span>
                  )}
                  <span className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                    style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(139,92,246,0.3)", color: "#a78bfa" }}>
                    FID {sdkFid}
                  </span>
                </div>
              </div>

              {/* Activity breakdown */}
              {!loading && points?.breakdown && points.breakdown.length > 0 && (
                <div className="lp-glass-card p-4 relative overflow-hidden">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-3"
                    style={{ color: "rgba(167,139,250,0.5)" }}>Activity Breakdown</p>
                  <div className="space-y-2.5">
                    {points.breakdown
                      .filter((b) => b.points_earned > 0)
                      .sort((a, b) => b.points_earned - a.points_earned)
                      .slice(0, 7)
                      .map((b) => {
                        const label = ACTION_LABELS[b.action_type] ?? b.action_type;
                        const color = ACTION_COLORS[b.action_type] ?? "#a78bfa";
                        const pct   = totalPts > 0 ? Math.min((b.points_earned / totalPts) * 100, 100) : 0;
                        return (
                          <div key={b.action_type}>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.7)" }}>
                                {label}
                              </span>
                              <span className="text-[11px] font-bold" style={{ color }}>
                                {b.points_earned.toLocaleString()}
                              </span>
                            </div>
                            <div className="h-1.5 rounded-full overflow-hidden"
                              style={{ background: "rgba(255,255,255,0.05)" }}>
                              <motion.div
                                initial={{ width: 0 }}
                                animate={{ width: `${pct}%` }}
                                transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                                className="h-full rounded-full"
                                style={{ background: `linear-gradient(90deg, ${color}99, ${color})` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Referral card */}
              <div className="lp-glass-card p-4 relative overflow-hidden">
                <div className="lp-shimmer" style={{ "--shimmer-delay": "3s" } as React.CSSProperties} />
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-bold text-white">Invite Friends</p>
                    <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.6)" }}>
                      Earn bonus points for every referral
                    </p>
                  </div>
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.3)" }}>
                    <Users className="w-4 h-4" style={{ color: "#a78bfa" }} />
                  </div>
                </div>
                <button
                  onClick={copy}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl transition-all"
                  style={{
                    background: "rgba(15,8,40,0.8)",
                    border: "1px solid rgba(139,92,246,0.25)",
                    color: "rgba(167,139,250,0.7)",
                  }}
                >
                  <span className="text-xs font-mono truncate flex-1 text-left">
                    {referralUrl.replace("https://", "")}
                  </span>
                  <span className="shrink-0 flex items-center gap-1 text-xs font-semibold"
                    style={{ color: copied ? "#34d399" : "#a78bfa" }}>
                    {copied ? <><Check className="w-3 h-3" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy</>}
                  </span>
                </button>
              </div>
            </motion.div>
          )}

          {/* ── LEADERBOARD TAB ────────────────────────────────────── */}
          {tab === "leaderboard" && (
            <motion.div
              key="leaderboard"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col gap-3"
            >
              {loading ? (
                <div className="lp-glass-card p-8 flex items-center justify-center">
                  <Loader2 className="w-5 h-5 animate-spin" style={{ color: "rgba(139,92,246,0.6)" }} />
                </div>
              ) : leaderboard.length === 0 ? (
                <div className="lp-glass-card p-8 text-center">
                  <Trophy className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(139,92,246,0.4)" }} />
                  <p className="text-sm text-white/50">No data yet — start earning points!</p>
                </div>
              ) : (
                <>
                  {/* Podium top 3 */}
                  {top3.length >= 1 && (
                    <div className="lp-glass-card p-5 relative overflow-hidden">
                      <div className="lp-shimmer" />
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] mb-4 text-center"
                        style={{ color: "rgba(167,139,250,0.5)" }}>Top Earners</p>

                      <div className="flex items-end justify-center gap-3">
                        {/* Silver — 2nd */}
                        {top3[1] && (
                          <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.15 }}
                            className="flex flex-col items-center gap-2 flex-1"
                          >
                            <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-sm"
                              style={{ background: "rgba(148,163,184,0.2)", border: "2px solid rgba(148,163,184,0.5)", color: "#94a3b8" }}>
                              {top3[1].fid === sdkFid ? "YOU" : `#${top3[1].fid}`.slice(0, 4)}
                            </div>
                            <div className="w-full rounded-t-xl py-3 text-center"
                              style={{ background: "rgba(148,163,184,0.12)", border: "1px solid rgba(148,163,184,0.25)", height: 64 }}>
                              <Medal className="w-4 h-4 mx-auto mb-1" style={{ color: "#94a3b8" }} />
                              <p className="text-[10px] font-bold" style={{ color: "#94a3b8" }}>
                                {top3[1].total_points.toLocaleString()}
                              </p>
                            </div>
                          </motion.div>
                        )}

                        {/* Gold — 1st */}
                        {top3[0] && (
                          <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.05 }}
                            className="flex flex-col items-center gap-2 flex-1"
                          >
                            <Crown className="w-5 h-5" style={{ color: "#fbbf24" }} />
                            <div className="w-12 h-12 rounded-full flex items-center justify-center font-black text-sm"
                              style={{
                                background: "rgba(251,191,36,0.2)",
                                border: "2px solid rgba(251,191,36,0.7)",
                                color: "#fbbf24",
                                boxShadow: "0 0 20px rgba(251,191,36,0.3)",
                              }}>
                              {top3[0].fid === sdkFid ? "YOU" : `#${top3[0].fid}`.slice(0, 4)}
                            </div>
                            <div className="w-full rounded-t-xl py-3 text-center"
                              style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.35)", height: 80 }}>
                              <Trophy className="w-4 h-4 mx-auto mb-1" style={{ color: "#fbbf24" }} />
                              <p className="text-[10px] font-bold" style={{ color: "#fbbf24" }}>
                                {top3[0].total_points.toLocaleString()}
                              </p>
                            </div>
                          </motion.div>
                        )}

                        {/* Bronze — 3rd */}
                        {top3[2] && (
                          <motion.div
                            initial={{ opacity: 0, y: 16 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.22 }}
                            className="flex flex-col items-center gap-2 flex-1"
                          >
                            <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-sm"
                              style={{ background: "rgba(161,98,7,0.25)", border: "2px solid rgba(161,98,7,0.55)", color: "#a16207" }}>
                              {top3[2].fid === sdkFid ? "YOU" : `#${top3[2].fid}`.slice(0, 4)}
                            </div>
                            <div className="w-full rounded-t-xl py-3 text-center"
                              style={{ background: "rgba(161,98,7,0.12)", border: "1px solid rgba(161,98,7,0.3)", height: 52 }}>
                              <Medal className="w-4 h-4 mx-auto mb-1" style={{ color: "#a16207" }} />
                              <p className="text-[10px] font-bold" style={{ color: "#a16207" }}>
                                {top3[2].total_points.toLocaleString()}
                              </p>
                            </div>
                          </motion.div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Rest of the list */}
                  {rest.length > 0 && (
                    <div className="lp-glass-card overflow-hidden">
                      {rest.map((row, i) => {
                        const isMe = row.fid === sdkFid;
                        return (
                          <motion.div
                            key={row.fid}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ duration: 0.25, delay: i * 0.02 }}
                            className="flex items-center gap-3 px-4 py-3 border-b"
                            style={{
                              borderColor: "rgba(139,92,246,0.07)",
                              background: isMe ? "rgba(124,58,237,0.14)" : "transparent",
                            }}
                          >
                            <span className="w-7 text-xs font-black shrink-0"
                              style={{ color: isMe ? "#c4b5fd" : "rgba(167,139,250,0.4)" }}>
                              #{row.rank}
                            </span>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold truncate"
                                style={{ color: isMe ? "#c4b5fd" : "rgba(255,255,255,0.8)" }}>
                                FID {row.fid}
                                {isMe && <span className="ml-1.5 text-[10px]" style={{ color: "rgba(167,139,250,0.5)" }}>(you)</span>}
                              </p>
                            </div>
                            <span className="text-sm font-bold shrink-0"
                              style={{ color: isMe ? "#a78bfa" : "rgba(167,139,250,0.65)" }}>
                              {row.total_points.toLocaleString()}
                            </span>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {/* ── AIRDROP TAB ─────────────────────────────────────────── */}
          {tab === "airdrop" && (
            <motion.div
              key="airdrop"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              <div className="lp-glass-card p-8 text-center relative overflow-hidden">
                <div className="lp-shimmer" style={{ "--shimmer-delay": "1s" } as React.CSSProperties} />
                {/* Glow */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div style={{
                    width: 200, height: 200, borderRadius: "50%",
                    background: "radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)",
                    filter: "blur(40px)",
                  }} />
                </div>
                <div className="w-16 h-16 rounded-2xl mx-auto mb-5 flex items-center justify-center lp-glow-breathe"
                  style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.45)" }}>
                  <Lock className="w-8 h-8" style={{ color: "#a78bfa" }} />
                </div>
                <h3 className="text-2xl font-black text-white mb-2" style={{ letterSpacing: "-0.025em" }}>
                  Snapshot Pending
                </h3>
                <p className="text-sm max-w-xs mx-auto" style={{ color: "rgba(167,139,250,0.6)", lineHeight: 1.6 }}>
                  The airdrop snapshot hasn't been taken yet.
                  Keep earning points — your allocation will be
                  proportional to your score at snapshot time.
                </p>
                <div className="mt-6 flex items-center justify-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-xs font-semibold" style={{ color: "rgba(251,191,36,0.7)" }}>
                    Date TBA
                  </span>
                </div>
              </div>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
export function MiniAppPage() {
  const { sdkFid, sdkCtx, sdkReady, isInFarcaster, added, addMiniApp } = useMiniAppFid();

  return (
    <div className="relative" style={{ minHeight: "100svh" }}>
      <Background />
      {!sdkReady
        ? <LoadingScreen />
        : (!sdkFid || !isInFarcaster)
          ? <OnboardingScreen />
          : <MainApp sdkFid={sdkFid} sdkCtx={sdkCtx} added={added} addMiniApp={addMiniApp} />
      }
    </div>
  );
}
