/**
 * FidCaster Mini App — v3
 *
 * Design principles:
 *  - No emojis. No particles. No decorative noise.
 *  - Typography and data carry all visual weight.
 *  - Mandatory onboarding: user must understand the system before entering.
 *  - Every animation has a reason; none exist for spectacle alone.
 *  - Information hierarchy: what the user needs, in the order they need it.
 */
import {
  useEffect, useState, useCallback, useRef, useMemo, useReducer,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sdk } from "@farcaster/miniapp-sdk";
import {
  ArrowRight, ArrowLeft, Copy, Check, ExternalLink,
  Loader2, HelpCircle, X, ShieldCheck, TrendingUp, User,
  ChevronRight, BarChart2, Award,
} from "lucide-react";

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  bg:           "#05010F",
  surface:      "rgba(255,255,255,0.04)",
  surfaceHi:    "rgba(255,255,255,0.07)",
  border:       "rgba(255,255,255,0.07)",
  borderMed:    "rgba(255,255,255,0.14)",
  accent:       "#7C3AED",
  accentBright: "#A78BFA",
  text1:        "rgba(255,255,255,0.92)",
  text2:        "rgba(255,255,255,0.50)",
  text3:        "rgba(255,255,255,0.22)",
  green:        "#10B981",
  amber:        "#F59E0B",
  rose:         "#F43F5E",
} as const;

const slide = {
  initial:   { opacity: 0, x: 20 },
  animate:   { opacity: 1, x: 0  },
  exit:      { opacity: 0, x: -20 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
};
const fade = {
  initial:   { opacity: 0 },
  animate:   { opacity: 1 },
  exit:      { opacity: 0 },
  transition: { duration: 0.18 },
};

// ─── Scoring reference ────────────────────────────────────────────────────────
const SCORING = [
  { action: "Cast",          pts: 10,  cap: 50   },
  { action: "Recast",        pts: 3,   cap: 30   },
  { action: "Like",          pts: 1,   cap: 50   },
  { action: "Follow",        pts: 2,   cap: 50   },
  { action: "Buy FID",       pts: 100, cap: 300  },
  { action: "List FID",      pts: 50,  cap: 250  },
  { action: "Refer User",    pts: 200, cap: 2000 },
  { action: "Quest",         pts: 100, cap: 500  },
  { action: "Grow Campaign", pts: 30,  cap: 150  },
];

// ─── Types ────────────────────────────────────────────────────────────────────
interface MiniCtx {
  user?: {
    fid: number; username?: string; displayName?: string; pfpUrl?: string;
    verifiedAddresses?: { eth_addresses?: string[] };
  };
  client?: { added?: boolean };
}
interface LeaderboardRow { fid: number; total_points: number; rank: number; }
interface FidPoints {
  fid: number; total_points: number;
  breakdown: { action_type: string; total_actions: number; points_earned: number }[];
}

// ─── SDK hook ─────────────────────────────────────────────────────────────────
function useFarcasterSDK() {
  const [fid,     setFid]     = useState<number | null>(null);
  const [ctx,     setCtx]     = useState<MiniCtx | null>(null);
  const [ready,   setReady]   = useState(false);
  const [inFC,    setInFC]    = useState(false);
  const [added,   setAdded]   = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      // Dev preview bypass: ?fid=XXX
      const pFid = parseInt(new URLSearchParams(window.location.search).get("fid") ?? "0", 10);
      if (pFid > 0) {
        setFid(pFid);
        setCtx({ user: { fid: pFid, username: `fid${pFid}`, displayName: `FID ${pFid}` } });
        setInFC(true); setReady(true); return;
      }
      sdk.actions.ready().catch(() => {});
      try {
        const result = await Promise.race([
          sdk.context as Promise<MiniCtx>,
          new Promise<null>(r => setTimeout(() => r(null), 2500)),
        ]);
        if (!dead && result?.user?.fid) {
          setCtx(result); setFid(result.user.fid); setInFC(true);
          setAdded(!!(result as any).client?.added);
        }
      } catch {}
      finally { if (!dead) setReady(true); }
    })();
    return () => { dead = true; };
  }, []);

  const addApp = useCallback(async () => {
    try { await (sdk.actions as any).addMiniApp(); setAdded(true); } catch {}
  }, []);

  return { fid, ctx, ready, inFC, added, addApp };
}

// ─── API ──────────────────────────────────────────────────────────────────────
async function getPoints(fid: number): Promise<FidPoints | null> {
  try { const r = await fetch(`/api/points/my?fid=${fid}`); return r.ok ? r.json() : null; }
  catch { return null; }
}
async function getLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const r = await fetch("/api/points/leaderboard?limit=50");
    const d = await r.json(); return d.leaderboard ?? [];
  } catch { return []; }
}

// ─── Animated counter ─────────────────────────────────────────────────────────
function Counter({ value, className }: { value: number; className?: string }) {
  const [n, setN] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, to = value, dur = 900, t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      const cur = Math.round(from + (to - from) * e);
      setN(cur); if (p < 1) requestAnimationFrame(tick);
      else prev.current = to;
    };
    requestAnimationFrame(tick);
  }, [value]);
  return <span className={className}>{n.toLocaleString()}</span>;
}

// ─── Tiny divider ─────────────────────────────────────────────────────────────
const HR = () => <div style={{ height: 1, background: C.border, margin: "0 0" }} />;

// ─────────────────────────────────────────────────────────────────────────────
// SCREENS
// ─────────────────────────────────────────────────────────────────────────────

// ─── Loading ──────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <Loader2 size={20} style={{ color: C.accentBright }} className="animate-spin" />
      <span style={{ color: C.text3, fontSize: 12 }}>Connecting…</span>
    </div>
  );
}

// ─── Browser (non-Warpcast) ───────────────────────────────────────────────────
function BrowserScreen() {
  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <motion.div {...fade} style={{ maxWidth: 360, width: "100%", border: `1px solid ${C.borderMed}`, borderRadius: 20, padding: 32, textAlign: "center" }}>
        <img src="/icons/icon-512-dark.png" alt="" style={{ width: 56, height: 56, borderRadius: 14, marginBottom: 20, display: "block", margin: "0 auto 20px" }} />
        <p style={{ color: C.text1, fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Open in Warpcast</p>
        <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.6, marginBottom: 28 }}>
          This mini app runs inside Warpcast. Open Warpcast and search for <strong style={{ color: C.accentBright }}>FidCaster</strong> to access it.
        </p>
        <a
          href="https://warpcast.com/~/mini-apps"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            background: C.accent, color: "#fff", borderRadius: 12, padding: "12px 20px",
            fontSize: 14, fontWeight: 600, textDecoration: "none",
          }}
        >
          Open Warpcast <ExternalLink size={14} />
        </a>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING WIZARD
// ─────────────────────────────────────────────────────────────────────────────
interface OnboardingProps {
  fid: number; ctx: MiniCtx | null;
  added: boolean; addApp: () => Promise<void>;
  onComplete: () => void;
}

function OnboardingFlow({ fid, ctx, added, addApp, onComplete }: OnboardingProps) {
  const [step, setStep]       = useState(0);
  const [adding, setAdding]   = useState(false);
  const TOTAL                 = 4;
  const username              = ctx?.user?.username ?? `fid${fid}`;
  const pfpUrl                = ctx?.user?.pfpUrl ?? null;

  async function handleActivate() {
    setAdding(true);
    try { await addApp(); } catch {}
    finally { setAdding(false); onComplete(); }
  }

  function next() {
    if (step < TOTAL - 1) setStep(s => s + 1);
  }
  function back() {
    if (step > 0) setStep(s => s - 1);
  }

  const steps = [
    // Step 0 — Who you are
    <motion.div key="s0" {...slide} className="flex flex-col gap-5">
      <div>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>Your Identity</p>
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px", background: C.surfaceHi, borderRadius: 14, border: `1px solid ${C.borderMed}` }}>
          {pfpUrl
            ? <img src={pfpUrl} alt="" style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0 }} />
            : <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.accent, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "#fff" }}>{username.slice(0,2).toUpperCase()}</div>
          }
          <div>
            <p style={{ color: C.text1, fontWeight: 700, fontSize: 15 }}>@{username}</p>
            <p style={{ color: C.text3, fontSize: 12, marginTop: 2 }}>FID {fid}</p>
          </div>
          <ShieldCheck size={16} style={{ color: C.green, marginLeft: "auto", flexShrink: 0 }} />
        </div>
      </div>
      <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.7 }}>
        FidCaster links your Farcaster identity to a points program. Every verified action you take inside the FidCaster app earns points toward the <strong style={{ color: C.text1 }}>$FCAST airdrop</strong>.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          "Your FID is your account — no registration needed",
          "Points accumulate on-chain, verified against Farcaster Hub",
          "Airdrop allocation is proportional to your points at snapshot",
        ].map((txt, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: C.accentBright, marginTop: 6, flexShrink: 0 }} />
            <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.6 }}>{txt}</p>
          </div>
        ))}
      </div>
    </motion.div>,

    // Step 1 — Scoring table
    <motion.div key="s1" {...slide} className="flex flex-col gap-4">
      <div>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Point System</p>
        <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.6 }}>
          These are all the ways to earn points. Each action has a <strong style={{ color: C.text1 }}>daily cap</strong> to prevent abuse.
        </p>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase" }}>Action</span>
          <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "right", marginRight: 24 }}>Pts</span>
          <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", textAlign: "right" }}>Daily max</span>
        </div>
        {SCORING.map((row, i) => (
          <div
            key={row.action}
            style={{
              display: "grid", gridTemplateColumns: "1fr auto auto",
              padding: "9px 14px",
              borderBottom: i < SCORING.length - 1 ? `1px solid ${C.border}` : "none",
              background: i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.01)",
            }}
          >
            <span style={{ color: C.text1, fontSize: 13 }}>{row.action}</span>
            <span style={{ color: C.accentBright, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums", marginRight: 24, textAlign: "right" }}>+{row.pts}</span>
            <span style={{ color: C.text3, fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>{row.cap.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </motion.div>,

    // Step 2 — Rules
    <motion.div key="s2" {...slide} className="flex flex-col gap-5">
      <div>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Rules</p>
        <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.6 }}>
          Points are only awarded for <strong style={{ color: C.text1 }}>verified, legitimate</strong> actions. The following will cost you points or your eligibility:
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {[
          { label: "Sybil / bot detection", desc: "Accounts identified as bots are permanently excluded from the airdrop. This is irreversible.", color: C.rose },
          { label: "Failed hub verification", desc: "Actions that cannot be confirmed against Farcaster Hub data are excluded from scoring.", color: C.amber },
          { label: "Duplicate actions", desc: "The same action submitted twice is only counted once.", color: C.amber },
          { label: "Failed Grow Campaign", desc: "A Grow Campaign must generate ≥ 5 real, confirmed new follows to earn points.", color: C.text2 },
        ].map((r, i) => (
          <div key={i} style={{ padding: "12px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 2 }}>
            <p style={{ color: r.color, fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{r.label}</p>
            <p style={{ color: C.text2, fontSize: 12, lineHeight: 1.6 }}>{r.desc}</p>
          </div>
        ))}
      </div>
      <p style={{ color: C.text3, fontSize: 12, lineHeight: 1.6 }}>
        Unlikes, unfollows, unrecast, app opens, and cancelled orders do not affect your score in either direction.
      </p>
    </motion.div>,

    // Step 3 — Activate
    <motion.div key="s3" {...slide} className="flex flex-col gap-6">
      <div>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6 }}>Activate</p>
        <p style={{ color: C.text1, fontSize: 20, fontWeight: 800, lineHeight: 1.3, marginBottom: 10 }}>
          Add FidCaster to start earning
        </p>
        <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.7 }}>
          Adding FidCaster to Warpcast registers your FID and enables point tracking. You'll receive notifications when you earn rewards.
        </p>
      </div>
      <div style={{ background: C.surface, border: `1px solid ${C.borderMed}`, borderRadius: 14, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/icons/icon-512-dark.png" alt="" style={{ width: 40, height: 40, borderRadius: 10 }} />
          <div>
            <p style={{ color: C.text1, fontWeight: 700, fontSize: 14 }}>FidCaster</p>
            <p style={{ color: C.text3, fontSize: 12 }}>Farcaster client + FID marketplace + points</p>
          </div>
        </div>
      </div>
      <button
        onClick={handleActivate}
        disabled={adding}
        style={{
          width: "100%", padding: "15px 20px", borderRadius: 14,
          background: adding ? "rgba(124,58,237,0.4)" : C.accent,
          color: "#fff", fontWeight: 700, fontSize: 15, border: "none",
          cursor: adding ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          transition: "background 0.15s",
        }}
      >
        {adding
          ? <><Loader2 size={16} className="animate-spin" /> Adding…</>
          : <>Add FidCaster <ArrowRight size={16} /></>
        }
      </button>
      {added && (
        <button
          onClick={onComplete}
          style={{ background: "none", border: "none", color: C.text2, fontSize: 13, cursor: "pointer", textAlign: "center", width: "100%", padding: "4px 0" }}
        >
          Already added — enter app →
        </button>
      )}
    </motion.div>,
  ];

  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: C.text1, fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em" }}>FidCaster</span>
        <span style={{ color: C.text3, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>{step + 1} / {TOTAL}</span>
      </div>

      {/* Progress bar */}
      <div style={{ margin: "12px 20px 0", height: 2, background: C.border, borderRadius: 2 }}>
        <motion.div
          animate={{ width: `${((step + 1) / TOTAL) * 100}%` }}
          transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
          style={{ height: "100%", background: C.accent, borderRadius: 2 }}
        />
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "24px 20px 20px", overflowY: "auto" }}>
        <AnimatePresence mode="wait">
          {steps[step]}
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      {step < TOTAL - 1 && (
        <div style={{ padding: "12px 20px 28px", display: "flex", gap: 10 }}>
          {step > 0 && (
            <button
              onClick={back}
              style={{
                padding: "13px 18px", borderRadius: 12, background: C.surface,
                border: `1px solid ${C.border}`, color: C.text2, cursor: "pointer",
                display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600,
              }}
            >
              <ArrowLeft size={15} />
            </button>
          )}
          <button
            onClick={next}
            style={{
              flex: 1, padding: "13px 20px", borderRadius: 12,
              background: C.surfaceHi, border: `1px solid ${C.borderMed}`,
              color: C.text1, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontSize: 14, fontWeight: 600,
            }}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
type AppTab = "score" | "board" | "profile";

const ACTION_LABELS: Record<string, string> = {
  cast: "Cast", like: "Like", recast: "Recast", follow: "Follow",
  market_buy: "Buy FID", market_list: "List FID",
  referral: "Referral", quest: "Quest",
  grow_campaign_complete: "Grow Campaign",
};

// ─── Rules Sheet ──────────────────────────────────────────────────────────────
function RulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ duration: 0.28, ease: [0.4, 0, 0.2, 1] }}
        onClick={e => e.stopPropagation()}
        style={{
          width: "100%", maxHeight: "85svh", overflow: "auto",
          background: "#0D0720", borderRadius: "20px 20px 0 0",
          padding: "20px 20px 40px", border: `1px solid ${C.borderMed}`,
          borderBottom: "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <p style={{ color: C.text1, fontWeight: 800, fontSize: 17 }}>Scoring Rules</p>
          <button onClick={onClose} style={{ background: "none", border: "none", color: C.text2, cursor: "pointer", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Points per action</p>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Action</span>
            <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase", textAlign: "right", marginRight: 20 }}>Pts</span>
            <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase", textAlign: "right" }}>Daily max</span>
          </div>
          {SCORING.map((row, i) => (
            <div key={row.action} style={{
              display: "grid", gridTemplateColumns: "1fr auto auto", padding: "10px 14px",
              borderBottom: i < SCORING.length - 1 ? `1px solid ${C.border}` : "none",
            }}>
              <span style={{ color: C.text1, fontSize: 13 }}>{row.action}</span>
              <span style={{ color: C.accentBright, fontSize: 13, fontWeight: 700, marginRight: 20, textAlign: "right" }}>+{row.pts}</span>
              <span style={{ color: C.text3, fontSize: 12, textAlign: "right" }}>{row.cap.toLocaleString()}</span>
            </div>
          ))}
        </div>

        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>Exclusion rules</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {[
            { label: "Sybil / bot detection", color: C.rose, desc: "Permanently excluded. Irreversible." },
            { label: "Hub verification failure", color: C.amber, desc: "Action excluded from score." },
            { label: "Duplicate actions", color: C.amber, desc: "Only counted once." },
            { label: "Grow Campaign < 5 follows", color: C.text2, desc: "No points awarded." },
          ].map((r, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 2, gap: 10 }}>
              <div>
                <p style={{ color: r.color, fontSize: 13, fontWeight: 600 }}>{r.label}</p>
                <p style={{ color: C.text3, fontSize: 12, marginTop: 2 }}>{r.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p style={{ color: C.text3, fontSize: 12, marginTop: 14, lineHeight: 1.6 }}>
          Unlikes, unfollows, unrecast, app opens, and cancelled orders have zero point value in either direction.
        </p>
      </motion.div>
    </motion.div>
  );
}

// ─── NFT Pass mini-card ───────────────────────────────────────────────────────
function NFTPassCard({ fid, ethAddress }: { fid: number; ethAddress?: string }) {
  const [status, setStatus] = useState<"idle"|"input"|"minting"|"done"|"error">("idle");
  const [addr,   setAddr]   = useState(ethAddress ?? "");
  const [txHash, setTxHash] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [minted, setMinted] = useState(false);

  useEffect(() => {
    if (!ethAddress) return;
    fetch(`/api/nft-pass/check/${ethAddress}`)
      .then(r => r.json())
      .then(d => { if (d.hasMinted) setMinted(true); })
      .catch(() => {});
  }, [ethAddress]);

  async function doMint() {
    const a = addr.trim(); if (!a) return;
    setStatus("minting");
    try {
      const r = await fetch("/api/nft-pass/mint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid, address: a }),
      });
      const d = await r.json();
      if (d.alreadyMinted) { setMinted(true); setStatus("done"); return; }
      if (!r.ok) throw new Error(d.error ?? "failed");
      setTxHash(d.txHash ?? ""); setMinted(true); setStatus("done");
    } catch (e) { setErrMsg(String(e)); setStatus("error"); }
  }

  if (minted || status === "done") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
        <img src="/nft-pass-v2.png" alt="FidCaster Pass" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "contain", background: "rgba(124,58,237,0.1)" }} />
        <div style={{ flex: 1 }}>
          <p style={{ color: C.text1, fontWeight: 600, fontSize: 13 }}>FidCaster Pass</p>
          <p style={{ color: C.green, fontSize: 12, marginTop: 2 }}>Minted — access granted</p>
        </div>
        {txHash && (
          <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: C.text3 }}>
            <ExternalLink size={14} />
          </a>
        )}
      </div>
    );
  }

  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <img src="/nft-pass-v2.png" alt="FidCaster Pass" style={{ width: 40, height: 40, borderRadius: 10, objectFit: "contain", background: "rgba(124,58,237,0.1)" }} />
        <div style={{ flex: 1 }}>
          <p style={{ color: C.text1, fontWeight: 600, fontSize: 13 }}>FidCaster Pass</p>
          <p style={{ color: C.text2, fontSize: 12, marginTop: 2 }}>Free NFT on Base · Grants full app access</p>
        </div>
        {status === "idle" && (
          <button
            onClick={() => setStatus("input")}
            style={{ background: C.surfaceHi, border: `1px solid ${C.borderMed}`, color: C.accentBright, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}
          >
            Mint free
          </button>
        )}
      </div>
      <AnimatePresence>
        {status === "input" && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", gap: 8, flexDirection: "column" }}>
              <input
                type="text" placeholder="0x… your Base wallet address"
                value={addr} onChange={e => setAddr(e.target.value)}
                style={{
                  width: "100%", padding: "10px 12px", background: "#0D0720",
                  border: `1px solid ${C.borderMed}`, borderRadius: 10, color: C.text1,
                  fontSize: 12, fontFamily: "monospace", outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={doMint}
                  disabled={status === "minting" || !addr.trim()}
                  style={{
                    flex: 1, padding: "10px 14px", borderRadius: 10,
                    background: C.accent, color: "#fff", border: "none",
                    fontSize: 13, fontWeight: 600, cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                    opacity: addr.trim() ? 1 : 0.4,
                  }}
                >
                  {status === "minting" ? <><Loader2 size={14} className="animate-spin" /> Minting…</> : "Mint"}
                </button>
                <button
                  onClick={() => setStatus("idle")}
                  style={{ padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text2, fontSize: 13, cursor: "pointer" }}
                >
                  Cancel
                </button>
              </div>
              {status === "error" && <p style={{ color: C.rose, fontSize: 12 }}>{errMsg}</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Score tab ────────────────────────────────────────────────────────────────
function ScoreTab({ fid, ethAddress, loading, points, rank }: {
  fid: number; ethAddress?: string; loading: boolean;
  points: FidPoints | null; rank: number | null;
}) {
  const [copied, setCopied] = useState(false);
  const refUrl = `https://fidcaster.xyz/?ref=${fid.toString(36).toUpperCase()}`;
  const total  = points?.total_points ?? 0;

  async function copy() {
    await navigator.clipboard.writeText(refUrl).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <motion.div key="score" {...fade} className="flex flex-col gap-3">
      {/* Hero */}
      <div style={{ padding: "24px 20px", textAlign: "center", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16 }}>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 10 }}>Total Points</p>
        {loading
          ? <div style={{ height: 60, display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 size={18} className="animate-spin" style={{ color: C.text3 }} /></div>
          : <p style={{ fontSize: 56, fontWeight: 900, color: C.text1, letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 12, fontVariantNumeric: "tabular-nums" }}>
              <Counter value={total} />
            </p>
        }
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          {rank && (
            <span style={{ background: "rgba(251,191,36,0.10)", border: "1px solid rgba(251,191,36,0.25)", color: "#F59E0B", borderRadius: 8, padding: "4px 10px", fontSize: 12, fontWeight: 700 }}>
              Rank #{rank}
            </span>
          )}
          <span style={{ background: C.surfaceHi, border: `1px solid ${C.border}`, color: C.text2, borderRadius: 8, padding: "4px 10px", fontSize: 12 }}>
            FID {fid}
          </span>
        </div>
      </div>

      {/* NFT Pass */}
      <NFTPassCard fid={fid} ethAddress={ethAddress} />

      {/* Breakdown */}
      {!loading && points?.breakdown && points.breakdown.filter(b => b.points_earned > 0).length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 16px 8px" }}>Earnings Breakdown</p>
          {points.breakdown
            .filter(b => b.points_earned > 0)
            .sort((a, b) => b.points_earned - a.points_earned)
            .map((b, i, arr) => {
              const label = ACTION_LABELS[b.action_type] ?? b.action_type;
              const pct   = total > 0 ? (b.points_earned / total) * 100 : 0;
              return (
                <div key={b.action_type}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: 10, padding: "10px 16px" }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                        <span style={{ color: C.text1, fontSize: 13 }}>{label}</span>
                        <span style={{ color: C.accentBright, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {b.points_earned.toLocaleString()}
                        </span>
                      </div>
                      <div style={{ height: 3, background: C.border, borderRadius: 2 }}>
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, delay: i * 0.04, ease: [0.4, 0, 0.2, 1] }}
                          style={{ height: "100%", background: C.accentBright, borderRadius: 2 }}
                        />
                      </div>
                    </div>
                  </div>
                  {i < arr.length - 1 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
                </div>
              );
            })}
        </div>
      )}

      {/* Referral */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <div>
            <p style={{ color: C.text1, fontWeight: 600, fontSize: 13 }}>Refer a friend</p>
            <p style={{ color: C.text2, fontSize: 12, marginTop: 2 }}>+200 pts per successful referral</p>
          </div>
        </div>
        <button
          onClick={copy}
          style={{
            width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
            padding: "10px 12px", background: "#0D0720", border: `1px solid ${C.borderMed}`,
            borderRadius: 10, cursor: "pointer", gap: 8,
          }}
        >
          <span style={{ color: C.text2, fontSize: 12, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
            {refUrl.replace("https://", "")}
          </span>
          <span style={{ color: copied ? C.green : C.accentBright, fontSize: 12, fontWeight: 600, flexShrink: 0, display: "flex", alignItems: "center", gap: 4 }}>
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
          </span>
        </button>
      </div>
    </motion.div>
  );
}

// ─── Board tab ────────────────────────────────────────────────────────────────
function BoardTab({ fid, board, loading }: { fid: number; board: LeaderboardRow[]; loading: boolean }) {
  if (loading) return (
    <motion.div key="board-load" {...fade} style={{ padding: 40, display: "flex", justifyContent: "center" }}>
      <Loader2 size={18} className="animate-spin" style={{ color: C.text3 }} />
    </motion.div>
  );
  if (!board.length) return (
    <motion.div key="board-empty" {...fade} style={{ padding: 40, textAlign: "center", color: C.text3, fontSize: 13 }}>
      No data yet — start earning points.
    </motion.div>
  );

  const MEDAL_COLORS = ["#F59E0B", "#94A3B8", "#A16207"] as const;

  return (
    <motion.div key="board" {...fade} className="flex flex-col gap-3">
      {/* Top 3 */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 16px 4px" }}>Top Earners</p>
        {board.slice(0, 3).map((row, i) => {
          const isMe = row.fid === fid;
          return (
            <div key={row.fid}>
              <div style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                background: isMe ? "rgba(124,58,237,0.10)" : "transparent",
              }}>
                <span style={{ width: 20, color: MEDAL_COLORS[i], fontWeight: 900, fontSize: 15, textAlign: "center", flexShrink: 0 }}>
                  {i === 0 ? "①" : i === 1 ? "②" : "③"}
                </span>
                <span style={{ flex: 1, color: isMe ? C.accentBright : C.text1, fontSize: 13, fontWeight: isMe ? 700 : 400 }}>
                  FID {row.fid}{isMe ? " (you)" : ""}
                </span>
                <span style={{ color: isMe ? C.accentBright : C.text2, fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                  {row.total_points.toLocaleString()}
                </span>
              </div>
              {i < 2 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
            </div>
          );
        })}
      </div>

      {/* Rest */}
      {board.length > 3 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          {board.slice(3).map((row, i) => {
            const isMe = row.fid === fid;
            return (
              <div key={row.fid}>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  style={{
                    display: "flex", alignItems: "center", gap: 12, padding: "11px 16px",
                    background: isMe ? "rgba(124,58,237,0.10)" : "transparent",
                  }}
                >
                  <span style={{ width: 28, color: C.text3, fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "right", flexShrink: 0 }}>
                    {row.rank}
                  </span>
                  <span style={{ flex: 1, color: isMe ? C.accentBright : C.text1, fontSize: 13, fontWeight: isMe ? 700 : 400 }}>
                    FID {row.fid}{isMe ? " (you)" : ""}
                  </span>
                  <span style={{ color: isMe ? C.accentBright : C.text2, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                    {row.total_points.toLocaleString()}
                  </span>
                </motion.div>
                {i < board.length - 4 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
              </div>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}

// ─── Profile tab ──────────────────────────────────────────────────────────────
function ProfileTab({ fid, ctx, points, rank, loading, onOpenRules }: {
  fid: number; ctx: MiniCtx | null;
  points: FidPoints | null; rank: number | null;
  loading: boolean; onOpenRules: () => void;
}) {
  const username  = ctx?.user?.username ?? `fid${fid}`;
  const display   = ctx?.user?.displayName ?? username;
  const pfpUrl    = ctx?.user?.pfpUrl ?? null;
  const ethAddrs  = ctx?.user?.verifiedAddresses?.eth_addresses ?? [];
  const total     = points?.total_points ?? 0;

  return (
    <motion.div key="profile" {...fade} className="flex flex-col gap-3">
      {/* Identity card */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: "20px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          {pfpUrl
            ? <img src={pfpUrl} alt="" style={{ width: 56, height: 56, borderRadius: "50%", border: `2px solid ${C.borderMed}` }} />
            : <div style={{ width: 56, height: 56, borderRadius: "50%", background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: "#fff", flexShrink: 0 }}>
                {username.slice(0,2).toUpperCase()}
              </div>
          }
          <div>
            <p style={{ color: C.text1, fontWeight: 800, fontSize: 17 }}>{display}</p>
            <p style={{ color: C.text3, fontSize: 13, marginTop: 2 }}>@{username} · FID {fid}</p>
          </div>
        </div>
        <HR />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1, marginTop: 16 }}>
          {[
            { label: "Points", value: loading ? "—" : total.toLocaleString() },
            { label: "Rank",   value: loading ? "—" : rank ? `#${rank}` : "—" },
            { label: "Actions", value: loading ? "—" : (points?.breakdown.reduce((s, b) => s + b.total_actions, 0) ?? 0).toString() },
          ].map((s, i) => (
            <div key={s.label} style={{ textAlign: "center", padding: "10px 6px", borderRight: i < 2 ? `1px solid ${C.border}` : "none" }}>
              <p style={{ color: C.text1, fontWeight: 800, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
              <p style={{ color: C.text3, fontSize: 11, marginTop: 3 }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* NFT Pass */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 16px 8px" }}>FidCaster Pass</p>
        <div style={{ padding: "0 16px 14px" }}>
          <NFTPassCard fid={fid} ethAddress={ethAddrs[0]} />
        </div>
      </div>

      {/* Verified wallets */}
      {ethAddrs.length > 0 && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden" }}>
          <p style={{ color: C.text3, fontSize: 11, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 16px 4px" }}>
            Verified Wallets
          </p>
          {ethAddrs.map((addr, i) => (
            <div key={addr}>
              <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, flexShrink: 0 }} />
                <span style={{ color: C.text1, fontSize: 12, fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {addr}
                </span>
                <a href={`https://basescan.org/address/${addr}`} target="_blank" rel="noopener noreferrer" style={{ color: C.text3 }}>
                  <ExternalLink size={13} />
                </a>
              </div>
              {i < ethAddrs.length - 1 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
            </div>
          ))}
        </div>
      )}

      {/* Rules reference */}
      <button
        onClick={onOpenRules}
        style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 14, cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <BarChart2 size={15} style={{ color: C.accentBright }} />
          <p style={{ color: C.text1, fontSize: 13, fontWeight: 600 }}>Scoring Rules & Point System</p>
        </div>
        <ChevronRight size={15} style={{ color: C.text3 }} />
      </button>

      {/* Airdrop status */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, flexShrink: 0, animation: "pulse 2s ease-in-out infinite" }} />
        <div>
          <p style={{ color: C.text1, fontSize: 13, fontWeight: 600 }}>Airdrop</p>
          <p style={{ color: C.text2, fontSize: 12, marginTop: 2 }}>Snapshot date not yet announced. Keep earning.</p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Main App shell ───────────────────────────────────────────────────────────
function MainApp({ fid, ctx, added, addApp }: {
  fid: number; ctx: MiniCtx | null; added: boolean; addApp: () => void;
}) {
  const [tab,         setTab]     = useState<AppTab>("score");
  const [points,      setPoints]  = useState<FidPoints | null>(null);
  const [board,       setBoard]   = useState<LeaderboardRow[]>([]);
  const [loading,     setLoading] = useState(true);
  const [rulesOpen,   setRules]   = useState(false);

  const username = ctx?.user?.username ?? `fid${fid}`;
  const pfpUrl   = ctx?.user?.pfpUrl ?? null;
  const ethAddr  = ctx?.user?.verifiedAddresses?.eth_addresses?.[0];
  const rank     = board.find(r => r.fid === fid)?.rank ?? null;

  useEffect(() => {
    setLoading(true);
    Promise.all([getPoints(fid), getLeaderboard()])
      .then(([pts, lb]) => { setPoints(pts); setBoard(lb); })
      .finally(() => setLoading(false));
  }, [fid]);

  const TABS: { id: AppTab; label: string; icon: React.ReactNode }[] = [
    { id: "score",   label: "Score",    icon: <TrendingUp size={14} /> },
    { id: "board",   label: "Rankings", icon: <Award size={14} />      },
    { id: "profile", label: "Profile",  icon: <User size={14} />       },
  ];

  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", flexDirection: "column" }}>
      {/* App header */}
      <div style={{
        position: "sticky", top: 0, zIndex: 10,
        background: C.bg, borderBottom: `1px solid ${C.border}`,
        padding: "12px 16px",
        display: "flex", alignItems: "center", gap: 10,
      }}>
        {pfpUrl
          ? <img src={pfpUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }} />
          : <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: "#fff", flexShrink: 0 }}>
              {username.slice(0,2).toUpperCase()}
            </div>
        }
        <p style={{ flex: 1, color: C.text1, fontWeight: 700, fontSize: 14 }}>@{username}</p>
        {!added && (
          <button
            onClick={addApp}
            style={{ background: C.surfaceHi, border: `1px solid ${C.borderMed}`, color: C.accentBright, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            Add app
          </button>
        )}
        <button
          onClick={() => setRules(true)}
          style={{ background: "none", border: "none", color: C.text3, cursor: "pointer", padding: 4, display: "flex", alignItems: "center" }}
          title="Scoring rules"
        >
          <HelpCircle size={18} />
        </button>
      </div>

      {/* Tab bar */}
      <div style={{
        display: "flex", padding: "0 16px",
        borderBottom: `1px solid ${C.border}`,
        background: C.bg,
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              flex: 1, padding: "11px 8px", background: "none", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? C.accentBright : C.text3,
              borderBottom: tab === t.id ? `2px solid ${C.accent}` : "2px solid transparent",
              marginBottom: -1, transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "16px 16px 32px", overflowY: "auto" }}>
        <AnimatePresence mode="wait">
          {tab === "score" && (
            <ScoreTab fid={fid} ethAddress={ethAddr} loading={loading} points={points} rank={rank} />
          )}
          {tab === "board" && (
            <BoardTab fid={fid} board={board} loading={loading} />
          )}
          {tab === "profile" && (
            <ProfileTab fid={fid} ctx={ctx} points={points} rank={rank} loading={loading} onOpenRules={() => setRules(true)} />
          )}
        </AnimatePresence>
      </div>

      {/* Rules sheet */}
      <AnimatePresence>
        {rulesOpen && <RulesSheet onClose={() => setRules(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export function MiniAppPage() {
  const { fid, ctx, ready, inFC, added, addApp } = useFarcasterSDK();
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem("fc_v1_onboarded") === "1",
  );

  let phase: "loading" | "browser" | "onboarding" | "app";
  if (!ready)                         phase = "loading";
  else if (!fid || !inFC)             phase = "browser";
  else if (!onboarded)                phase = "onboarding";
  else                                phase = "app";

  function completeOnboarding() {
    localStorage.setItem("fc_v1_onboarded", "1");
    setOnboarded(true);
  }

  return (
    <div style={{ background: C.bg, minHeight: "100svh" }}>
      <AnimatePresence mode="wait">
        {phase === "loading"    && <LoadingScreen key="loading" />}
        {phase === "browser"    && <BrowserScreen key="browser" />}
        {phase === "onboarding" && fid && (
          <OnboardingFlow key="onboard" fid={fid} ctx={ctx} added={added} addApp={addApp} onComplete={completeOnboarding} />
        )}
        {phase === "app" && fid && (
          <MainApp key="app" fid={fid} ctx={ctx} added={added} addApp={addApp} />
        )}
      </AnimatePresence>
    </div>
  );
}
