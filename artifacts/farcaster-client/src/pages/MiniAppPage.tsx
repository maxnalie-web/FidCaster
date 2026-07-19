/**
 * FidCaster Mini App — v4
 *
 * Premium dark design with branded visual language.
 * Mandatory onboarding with fixed activation flow.
 */
import {
  useEffect, useState, useCallback, useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sdk } from "@farcaster/miniapp-sdk";
import {
  ArrowRight, ArrowLeft, Copy, Check, ExternalLink,
  Loader2, HelpCircle, X, ChevronRight, BarChart2,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        "#05010F",
  surface:   "rgba(255,255,255,0.04)",
  surfaceHi: "rgba(255,255,255,0.08)",
  border:    "rgba(255,255,255,0.08)",
  borderMed: "rgba(255,255,255,0.15)",
  accent:    "#7C3AED",
  accentHi:  "#A78BFA",
  text1:     "rgba(255,255,255,0.95)",
  text2:     "rgba(255,255,255,0.55)",
  text3:     "rgba(255,255,255,0.25)",
  green:     "#10B981",
  amber:     "#F59E0B",
  rose:      "#F43F5E",
} as const;

// ── Animations ────────────────────────────────────────────────────────────────
const slideIn = {
  initial:   { opacity: 0, x: 28, scale: 0.98 },
  animate:   { opacity: 1, x: 0,  scale: 1    },
  exit:      { opacity: 0, x: -28, scale: 0.98 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};
const fadeUp = {
  initial:   { opacity: 0, y: 12 },
  animate:   { opacity: 1, y: 0  },
  exit:      { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
};

// ── Scoring reference ─────────────────────────────────────────────────────────
const SCORING = [
  { emoji: "✍️",  action: "Cast",          pts: 10,  cap: 50   },
  { emoji: "🔄",  action: "Recast",        pts: 3,   cap: 30   },
  { emoji: "💜",  action: "Like",          pts: 1,   cap: 50   },
  { emoji: "🤝",  action: "Follow",        pts: 2,   cap: 50   },
  { emoji: "💎",  action: "Buy FID",       pts: 100, cap: 300  },
  { emoji: "🏷️", action: "List FID",      pts: 50,  cap: 250  },
  { emoji: "🫂",  action: "Refer User",    pts: 200, cap: 2000 },
  { emoji: "⚔️",  action: "Quest",         pts: 100, cap: 500  },
  { emoji: "🌱",  action: "Grow Campaign", pts: 30,  cap: 150  },
];

const ACTION_LABELS: Record<string, { label: string; emoji: string }> = {
  cast:                 { label: "Cast",          emoji: "✍️"  },
  recast:               { label: "Recast",        emoji: "🔄"  },
  like:                 { label: "Like",          emoji: "💜"  },
  follow:               { label: "Follow",        emoji: "🤝"  },
  market_buy:           { label: "Buy FID",       emoji: "💎"  },
  market_list:          { label: "List FID",      emoji: "🏷️" },
  referral:             { label: "Referral",      emoji: "🫂"  },
  quest:                { label: "Quest",          emoji: "🎯" },
  grow_campaign_complete:{ label: "Grow Campaign", emoji: "🌱" },
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface MiniCtx {
  user?: {
    fid: number; username?: string; displayName?: string; pfpUrl?: string;
    verifiedAddresses?: { eth_addresses?: string[] };
  };
  client?: { added?: boolean };
}
interface LBRow   { fid: number; total_points: number; rank: number; }
interface FidPts  {
  fid: number; total_points: number;
  breakdown: { action_type: string; total_actions: number; points_earned: number }[];
}

// ── SDK hook ──────────────────────────────────────────────────────────────────
function useSDK() {
  const [fid,   setFid]   = useState<number | null>(null);
  const [ctx,   setCtx]   = useState<MiniCtx | null>(null);
  const [ready, setReady] = useState(false);
  const [inFC,  setInFC]  = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      const pFid = parseInt(new URLSearchParams(window.location.search).get("fid") ?? "0", 10);
      if (pFid > 0) {
        setFid(pFid);
        setCtx({ user: { fid: pFid, username: `fid${pFid}`, displayName: `FID ${pFid}` } });
        setInFC(true); setReady(true); setAdded(true); return;
      }
      sdk.actions.ready().catch(() => {});
      try {
        const res = await Promise.race([
          sdk.context as Promise<MiniCtx>,
          new Promise<null>(r => setTimeout(() => r(null), 2500)),
        ]);
        if (!dead && res?.user?.fid) {
          setCtx(res); setFid(res.user.fid); setInFC(true);
          setAdded(!!(res as any).client?.added);
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

// ── APIs ──────────────────────────────────────────────────────────────────────
async function apiPoints(fid: number): Promise<FidPts | null> {
  try { const r = await fetch(`/api/points/my?fid=${fid}`); return r.ok ? r.json() : null; }
  catch { return null; }
}
async function apiBoard(): Promise<LBRow[]> {
  try { const r = await fetch("/api/points/leaderboard?limit=50"); const d = await r.json(); return d.leaderboard ?? []; }
  catch { return []; }
}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ to, className }: { to: number; className?: string }) {
  const [n, setN] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, dur = 1000, t0 = performance.now();
    const f = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setN(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(f); else prev.current = to;
    };
    requestAnimationFrame(f);
  }, [to]);
  return <span className={className}>{n.toLocaleString()}</span>;
}

// ── Gradient card wrapper ─────────────────────────────────────────────────────
function Card({ children, style = {}, glow = false }: {
  children: React.ReactNode; style?: React.CSSProperties; glow?: boolean;
}) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${C.border}`,
      borderRadius: 18,
      overflow: "hidden",
      position: "relative",
      boxShadow: glow
        ? "0 0 0 1px rgba(124,58,237,0.3), 0 8px 32px rgba(124,58,237,0.12)"
        : "none",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Emoji badge ───────────────────────────────────────────────────────────────
function EmojiBadge({ emoji, size = 52, bg = "rgba(124,58,237,0.15)" }: {
  emoji: string; size?: number; bg?: string;
}) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28,
      background: bg, display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: size * 0.44,
      border: `1px solid rgba(255,255,255,0.08)`,
    }}>
      {emoji}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 36 }}>🔮</div>
      <Loader2 size={18} className="animate-spin" style={{ color: C.accentHi }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER
// ─────────────────────────────────────────────────────────────────────────────
function BrowserScreen() {
  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <motion.div {...fadeUp} style={{ maxWidth: 360, width: "100%", textAlign: "center" }}>
        <div style={{ fontSize: 56, marginBottom: 20 }}>🌐</div>
        <p style={{ color: C.text1, fontWeight: 800, fontSize: 20, marginBottom: 10 }}>Open in Warpcast</p>
        <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.7, marginBottom: 28 }}>
          This mini app runs inside Warpcast. Search for <strong style={{ color: C.accentHi }}>FidCaster</strong> to access it.
        </p>
        <a href="https://warpcast.com/~/mini-apps" target="_blank" rel="noopener noreferrer"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.accent, color: "#fff", borderRadius: 14, padding: "14px 20px", fontSize: 15, fontWeight: 700, textDecoration: "none" }}>
          Open Warpcast <ExternalLink size={15} />
        </a>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING
// ─────────────────────────────────────────────────────────────────────────────
const STEPS = [
  { emoji: "🌐", title: "Your Identity",      hint: "Step 1 of 4" },
  { emoji: "💎", title: "How Points Work",     hint: "Step 2 of 4" },
  { emoji: "⚖️", title: "The Rules",           hint: "Step 3 of 4" },
  { emoji: "🚀", title: "Activate",            hint: "Step 4 of 4" },
];

function OnboardingFlow({ fid, ctx, addApp, onComplete }: {
  fid: number; ctx: MiniCtx | null;
  addApp: () => Promise<void>; onComplete: () => void;
}) {
  const [step,   setStep]   = useState(0);
  const [adding, setAdding] = useState(false);
  const username = ctx?.user?.username ?? `fid${fid}`;
  const pfpUrl   = ctx?.user?.pfpUrl ?? null;

  async function activate() {
    setAdding(true);
    // fire-and-forget — Warpcast's addMiniApp may await user interaction
    addApp().catch(() => {});
    // always proceed after 900ms regardless
    await new Promise(r => setTimeout(r, 900));
    onComplete();
  }

  function next() { if (step < 3) setStep(s => s + 1); }
  function back() { if (step > 0) setStep(s => s - 1); }

  const stepContent = [
    // ── Step 0: Identity
    <motion.div key="s0" {...slideIn} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px", background: C.surfaceHi, borderRadius: 16, border: `1px solid ${C.borderMed}` }}>
        {pfpUrl
          ? <img src={pfpUrl} alt="" style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0 }} />
          : <div style={{ width: 48, height: 48, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, #A855F7)`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#fff" }}>
              {username.slice(0,2).toUpperCase()}
            </div>
        }
        <div style={{ flex: 1 }}>
          <p style={{ color: C.text1, fontWeight: 700, fontSize: 16 }}>@{username}</p>
          <p style={{ color: C.text3, fontSize: 13, marginTop: 2 }}>Farcaster ID · {fid}</p>
        </div>
        <span style={{ fontSize: 22 }}>✅</span>
      </div>
      <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.75 }}>
        FidCaster connects your Farcaster identity to a competitive points program. Every verified action you take earns points toward the <strong style={{ color: C.accentHi }}>$FCAST airdrop</strong>.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {[
          ["🔑", "Your FID is your account — no sign-up needed"],
          ["🔗", "Actions verified live against Farcaster Hub"],
          ["🪙", "Airdrop is proportional to your points at snapshot"],
        ].map(([e, t]) => (
          <div key={t} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 14px", background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{e}</span>
            <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.5 }}>{t}</p>
          </div>
        ))}
      </div>
    </motion.div>,

    // ── Step 1: Scoring table
    <motion.div key="s1" {...slideIn} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.65 }}>
        Each action you take in FidCaster earns points. Caps reset every day at midnight UTC.
      </p>
      <Card>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "10px 16px 6px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em" }}>Action</span>
          <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", textAlign: "right", minWidth: 52 }}>Pts</span>
          <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.09em", textAlign: "right", minWidth: 64 }}>Daily max</span>
        </div>
        {SCORING.map((row, i) => (
          <div key={row.action} style={{
            display: "grid", gridTemplateColumns: "1fr auto auto",
            padding: "9px 16px", alignItems: "center",
            borderBottom: i < SCORING.length - 1 ? `1px solid ${C.border}` : "none",
          }}>
            <span style={{ color: C.text1, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15 }}>{row.emoji}</span> {row.action}
            </span>
            <span style={{ color: C.accentHi, fontSize: 13, fontWeight: 800, textAlign: "right", minWidth: 52, fontVariantNumeric: "tabular-nums" }}>+{row.pts}</span>
            <span style={{ color: C.text3, fontSize: 12, textAlign: "right", minWidth: 64, fontVariantNumeric: "tabular-nums" }}>{row.cap.toLocaleString()}</span>
          </div>
        ))}
      </Card>
    </motion.div>,

    // ── Step 2: Rules
    <motion.div key="s2" {...slideIn} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.7 }}>
        Points are only awarded for <strong style={{ color: C.text1 }}>verified, legitimate</strong> actions. The following will affect your eligibility:
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { e: "☠️", label: "Sybil / bot detection", desc: "Accounts detected as bots are permanently excluded from the airdrop. This cannot be reversed.", color: C.rose },
          { e: "⚠️", label: "Hub verification failure", desc: "Actions that can't be confirmed on Farcaster Hub are excluded from your score.", color: C.amber },
          { e: "🔄", label: "Duplicate actions", desc: "The same action submitted more than once is only counted a single time.", color: C.text2 },
          { e: "🌱", label: "Grow Campaign threshold", desc: "A Grow Campaign must generate ≥ 5 confirmed new follows to count for points.", color: C.text2 },
        ].map(r => (
          <div key={r.label} style={{ padding: "13px 15px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
              <span style={{ fontSize: 16 }}>{r.e}</span>
              <p style={{ color: r.color, fontSize: 13, fontWeight: 700 }}>{r.label}</p>
            </div>
            <p style={{ color: C.text3, fontSize: 12, lineHeight: 1.6, paddingLeft: 24 }}>{r.desc}</p>
          </div>
        ))}
      </div>
      <p style={{ color: C.text3, fontSize: 12, lineHeight: 1.6, padding: "2px 0" }}>
        💡 Unlikes, unfollows, unrecast, app opens and cancelled orders do not affect your score in either direction.
      </p>
    </motion.div>,

    // ── Step 3: Activate
    <motion.div key="s3" {...slideIn} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ padding: "20px 18px", background: `linear-gradient(135deg, rgba(124,58,237,0.18) 0%, rgba(168,85,247,0.10) 100%)`, borderRadius: 18, border: `1px solid rgba(124,58,237,0.3)`, textAlign: "center" }}>
        <div style={{ fontSize: 42, marginBottom: 10 }}>🏆</div>
        <p style={{ color: C.text1, fontWeight: 800, fontSize: 18, marginBottom: 6 }}>Start Earning Points</p>
        <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.6 }}>
          Add FidCaster to Warpcast to activate your account and begin tracking your actions toward the $FCAST airdrop.
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", background: C.surfaceHi, borderRadius: 14, border: `1px solid ${C.borderMed}` }}>
        <img src="/icons/icon-512-dark.png" alt="" style={{ width: 44, height: 44, borderRadius: 12, flexShrink: 0 }} />
        <div>
          <p style={{ color: C.text1, fontWeight: 700, fontSize: 15 }}>FidCaster</p>
          <p style={{ color: C.text3, fontSize: 12, marginTop: 2 }}>Social · FID Market · Points · Airdrop</p>
        </div>
      </div>
      <button
        onClick={activate}
        disabled={adding}
        style={{
          width: "100%", padding: "15px", borderRadius: 14, border: "none",
          background: adding ? `rgba(124,58,237,0.45)` : `linear-gradient(135deg, ${C.accent} 0%, #A855F7 100%)`,
          color: "#fff", fontWeight: 800, fontSize: 16, cursor: adding ? "default" : "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          boxShadow: adding ? "none" : "0 4px 24px rgba(124,58,237,0.35)",
          transition: "all 0.2s",
        }}
      >
        {adding
          ? <><Loader2 size={18} className="animate-spin" /> Activating…</>
          : <>🚀 Add FidCaster</>
        }
      </button>
      <button
        onClick={onComplete}
        style={{ background: "none", border: "none", color: C.text3, fontSize: 13, cursor: "pointer", textAlign: "center", padding: "2px 0" }}
      >
        Already added — enter app →
      </button>
    </motion.div>,
  ];

  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", flexDirection: "column" }}>
      {/* Top gradient */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 220, background: "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.2) 0%, transparent 75%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: C.text1, fontWeight: 800, fontSize: 17 }}>FidCaster</span>
        <span style={{ color: C.text3, fontSize: 12 }}>{STEPS[step].hint}</span>
      </div>

      {/* Progress */}
      <div style={{ position: "relative", zIndex: 1, margin: "14px 20px 0", height: 3, background: C.border, borderRadius: 3 }}>
        <motion.div
          animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          style={{ height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${C.accent}, #A855F7)` }}
        />
      </div>

      {/* Step icon + title */}
      <div style={{ position: "relative", zIndex: 1, padding: "22px 20px 12px", display: "flex", alignItems: "center", gap: 14 }}>
        <EmojiBadge emoji={STEPS[step].emoji} size={48} />
        <p style={{ color: C.text1, fontWeight: 800, fontSize: 22, lineHeight: 1.2 }}>{STEPS[step].title}</p>
      </div>

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, flex: 1, padding: "4px 20px 20px", overflowY: "auto" }}>
        <AnimatePresence mode="wait">
          {stepContent[step]}
        </AnimatePresence>
      </div>

      {/* Footer nav */}
      {step < 3 && (
        <div style={{ position: "relative", zIndex: 1, padding: "12px 20px 32px", display: "flex", gap: 10 }}>
          {step > 0 && (
            <button onClick={back} style={{ padding: "13px 16px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.text2, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <ArrowLeft size={16} />
            </button>
          )}
          <button
            onClick={next}
            style={{
              flex: 1, padding: "14px 20px", borderRadius: 14, border: "none",
              background: C.surfaceHi, color: C.text1, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontSize: 15, fontWeight: 700,
              boxShadow: `inset 0 1px 0 ${C.borderMed}`,
            }}
          >
            Continue <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RULES SHEET
// ─────────────────────────────────────────────────────────────────────────────
function RulesSheet({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, display: "flex", alignItems: "flex-end" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
        onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxHeight: "88svh", overflowY: "auto", background: "#0E0722", borderRadius: "22px 22px 0 0", padding: "20px 20px 40px", border: `1px solid ${C.borderMed}` }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>⚡</span>
            <p style={{ color: C.text1, fontWeight: 800, fontSize: 18 }}>Scoring Rules</p>
          </div>
          <button onClick={onClose} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: "50%", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: C.text2 }}>
            <X size={16} />
          </button>
        </div>

        <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Points per action</p>
        <Card style={{ marginBottom: 20 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "8px 16px 6px", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase" }}>Action</span>
            <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase", textAlign: "right", minWidth: 52 }}>Pts</span>
            <span style={{ color: C.text3, fontSize: 10, fontWeight: 700, textTransform: "uppercase", textAlign: "right", minWidth: 64 }}>Daily max</span>
          </div>
          {SCORING.map((row, i) => (
            <div key={row.action} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", padding: "10px 16px", borderBottom: i < SCORING.length - 1 ? `1px solid ${C.border}` : "none" }}>
              <span style={{ color: C.text1, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 15 }}>{row.emoji}</span> {row.action}
              </span>
              <span style={{ color: C.accentHi, fontSize: 13, fontWeight: 800, textAlign: "right", minWidth: 52 }}>+{row.pts}</span>
              <span style={{ color: C.text3, fontSize: 12, textAlign: "right", minWidth: 64 }}>{row.cap.toLocaleString()}</span>
            </div>
          ))}
        </Card>

        <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Exclusion rules</p>
        {[
          { e: "☠️", l: "Sybil / bot detection",    c: C.rose,  d: "Permanently excluded. Irreversible." },
          { e: "⚠️", l: "Hub verification failure",  c: C.amber, d: "Action excluded from score." },
          { e: "🔄", l: "Duplicate submissions",     c: C.text2, d: "Only counted once." },
          { e: "🌱", l: "Grow Campaign < 5 follows", c: C.text2, d: "No points for insufficient campaign." },
        ].map(r => (
          <div key={r.l} style={{ display: "flex", gap: 12, padding: "11px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 6 }}>
            <span style={{ fontSize: 18, flexShrink: 0 }}>{r.e}</span>
            <div>
              <p style={{ color: r.c, fontSize: 13, fontWeight: 700, marginBottom: 2 }}>{r.l}</p>
              <p style={{ color: C.text3, fontSize: 12 }}>{r.d}</p>
            </div>
          </div>
        ))}
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NFT PASS CARD
// ─────────────────────────────────────────────────────────────────────────────
function NFTPassCard({ fid, ethAddress }: { fid: number; ethAddress?: string }) {
  const [s,          setS]          = useState<"idle"|"input"|"minting"|"done"|"error">("idle");
  const [manualAddr, setManualAddr] = useState("");
  const [txHash,     setTxHash]     = useState("");
  const [err,        setErr]        = useState("");
  const [minted,     setMinted]     = useState(false);

  // Check if already minted
  useEffect(() => {
    if (!ethAddress) return;
    fetch(`/api/nft-pass/check/${ethAddress}`)
      .then(r => r.json())
      .then(d => { if (d.hasMinted) setMinted(true); })
      .catch(() => {});
  }, [ethAddress]);

  const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

  async function doMint(address: string) {
    setS("minting");
    try {
      const r = await fetch("/api/nft-pass/mint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid, address }),
      });
      const d = await r.json();
      if (d.alreadyMinted) { setMinted(true); setS("done"); return; }
      if (!r.ok) throw new Error(d.error ?? "Mint failed");
      setTxHash(d.txHash ?? ""); setMinted(true); setS("done");
    } catch (e) { setErr(String(e)); setS("error"); }
  }

  // Has verified wallet → auto-mint, no address input needed
  function handleMint() {
    if (ethAddress) doMint(ethAddress);
    else setS("input");
  }

  if (minted || s === "done") {
    return (
      <Card style={{ padding: "14px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/nft-pass-v2.png" alt="" style={{ width: 44, height: 44, borderRadius: 11, objectFit: "contain", background: "rgba(124,58,237,0.12)" }} />
          <div style={{ flex: 1 }}>
            <p style={{ color: C.text1, fontWeight: 700, fontSize: 14 }}>💎 FidCaster Pass</p>
            <p style={{ color: C.green, fontSize: 12, marginTop: 2 }}>Minted · Full access active</p>
          </div>
          {txHash && (
            <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer" style={{ color: C.text3 }}>
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card glow>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px" }}>
        <img src="/nft-pass-v2.png" alt="" style={{ width: 44, height: 44, borderRadius: 11, objectFit: "contain", background: "rgba(124,58,237,0.12)" }} />
        <div style={{ flex: 1 }}>
          <p style={{ color: C.text1, fontWeight: 700, fontSize: 14 }}>💎 FidCaster Pass</p>
          <p style={{ color: C.text2, fontSize: 12, marginTop: 2 }}>
            {ethAddress
              ? <>Mint to <span style={{ fontFamily: "monospace", color: C.accentHi }}>{short(ethAddress)}</span> · Free on Base</>
              : "Free NFT on Base · Full app access"
            }
          </p>
        </div>
        {s === "idle" && (
          <button onClick={handleMint}
            style={{ background: `linear-gradient(135deg, ${C.accent}, #A855F7)`, color: "#fff", borderRadius: 10, padding: "7px 14px", fontSize: 12, fontWeight: 700, border: "none", cursor: "pointer", flexShrink: 0 }}>
            Mint free
          </button>
        )}
        {s === "minting" && (
          <span style={{ color: C.accentHi, fontSize: 12, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <Loader2 size={13} className="animate-spin" /> Minting…
          </span>
        )}
      </div>

      <AnimatePresence>
        {/* Only shown when user has no verified wallet */}
        {s === "input" && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
              <p style={{ color: C.text3, fontSize: 12 }}>No verified wallet found — enter your Base address manually:</p>
              <input type="text" placeholder="0x…" value={manualAddr} onChange={e => setManualAddr(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(0,0,0,0.4)", border: `1px solid ${C.borderMed}`, borderRadius: 10, color: C.text1, fontSize: 12, fontFamily: "monospace", outline: "none" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => doMint(manualAddr)} disabled={!manualAddr.trim()}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #A855F7)`, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: manualAddr.trim() ? 1 : 0.4 }}>
                  Mint
                </button>
                <button onClick={() => setS("idle")}
                  style={{ padding: "10px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, color: C.text2, fontSize: 13, cursor: "pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {s === "error" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            style={{ padding: "10px 16px", borderTop: `1px solid ${C.border}` }}>
            <p style={{ color: C.rose, fontSize: 12 }}>{err}</p>
            <button onClick={() => setS("idle")} style={{ background: "none", border: "none", color: C.text3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>Try again →</button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE TAB
// ─────────────────────────────────────────────────────────────────────────────
function ScoreTab({ fid, ethAddr, loading, pts, rank }: {
  fid: number; ethAddr?: string; loading: boolean; pts: FidPts | null; rank: number | null;
}) {
  const [copied, setCopied] = useState(false);
  const total  = pts?.total_points ?? 0;
  const refUrl = `https://fidcaster.xyz/?ref=${fid.toString(36).toUpperCase()}`;

  async function copy() {
    await navigator.clipboard.writeText(refUrl).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <motion.div key="score-tab" {...fadeUp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Hero */}
      <div style={{
        padding: "28px 20px 22px", textAlign: "center",
        background: `linear-gradient(180deg, rgba(124,58,237,0.18) 0%, rgba(124,58,237,0.04) 100%)`,
        border: `1px solid rgba(124,58,237,0.25)`, borderRadius: 20,
        position: "relative", overflow: "hidden",
      }}>
        {/* Glow orb */}
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -55%)", width: 180, height: 180, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.3) 0%, transparent 70%)", pointerEvents: "none" }} />

        <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10 }}>⚡ Total Points</p>
        {loading
          ? <div style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "center" }}><Loader2 size={20} className="animate-spin" style={{ color: C.accentHi }} /></div>
          : <div style={{
              fontSize: 58, fontWeight: 900, letterSpacing: "-0.04em", lineHeight: 1, marginBottom: 14,
              background: `linear-gradient(135deg, #C4B5FD 0%, #A78BFA 40%, #7C3AED 100%)`,
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              fontVariantNumeric: "tabular-nums",
            }}>
              <Counter to={total} />
            </div>
        }
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
          {rank && (
            <span style={{ background: "rgba(251,191,36,0.12)", border: "1px solid rgba(251,191,36,0.3)", color: C.amber, borderRadius: 10, padding: "5px 12px", fontSize: 13, fontWeight: 800 }}>
              🏆 Rank #{rank}
            </span>
          )}
          <span style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text2, borderRadius: 10, padding: "5px 12px", fontSize: 12 }}>
            FID {fid}
          </span>
        </div>
      </div>

      {/* NFT Pass */}
      <NFTPassCard fid={fid} ethAddress={ethAddr} />

      {/* Breakdown */}
      {!loading && pts?.breakdown && pts.breakdown.filter(b => b.points_earned > 0).length > 0 && (
        <Card>
          <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 16px 6px" }}>💰 Earnings Breakdown</p>
          {pts.breakdown.filter(b => b.points_earned > 0).sort((a, b) => b.points_earned - a.points_earned).map((b, i, arr) => {
            const meta = ACTION_LABELS[b.action_type] ?? { label: b.action_type, emoji: "•" };
            const pct  = total > 0 ? (b.points_earned / total) * 100 : 0;
            return (
              <div key={b.action_type}>
                <div style={{ padding: "10px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                    <span style={{ color: C.text1, fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}>
                      <span style={{ fontSize: 14 }}>{meta.emoji}</span> {meta.label}
                    </span>
                    <span style={{ color: C.accentHi, fontSize: 13, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                      {b.points_earned.toLocaleString()}
                    </span>
                  </div>
                  <div style={{ height: 4, background: C.border, borderRadius: 2 }}>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.7, delay: i * 0.05, ease: [0.4, 0, 0.2, 1] }}
                      style={{ height: "100%", borderRadius: 2, background: `linear-gradient(90deg, ${C.accent}, #A855F7)` }}
                    />
                  </div>
                </div>
                {i < arr.length - 1 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
              </div>
            );
          })}
        </Card>
      )}

      {/* Referral */}
      <Card style={{ padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <p style={{ color: C.text1, fontWeight: 700, fontSize: 14 }}>🫂 Invite Friends</p>
            <p style={{ color: C.text2, fontSize: 12, marginTop: 3 }}>Earn <strong style={{ color: C.accentHi }}>+200 pts</strong> per successful referral</p>
          </div>
        </div>
        <button onClick={copy} style={{
          width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", background: "rgba(0,0,0,0.35)", border: `1px solid ${C.borderMed}`,
          borderRadius: 12, cursor: "pointer", gap: 8,
        }}>
          <span style={{ color: C.text2, fontSize: 12, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "left" }}>
            {refUrl.replace("https://", "")}
          </span>
          <span style={{ color: copied ? C.green : C.accentHi, fontSize: 12, fontWeight: 700, flexShrink: 0, display: "flex", alignItems: "center", gap: 5 }}>
            {copied ? <><Check size={13} /> Copied!</> : <><Copy size={13} /> Copy</>}
          </span>
        </button>
      </Card>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOARD TAB
// ─────────────────────────────────────────────────────────────────────────────
function BoardTab({ fid, board, loading }: { fid: number; board: LBRow[]; loading: boolean }) {
  if (loading) return (
    <motion.div key="bl" {...fadeUp} style={{ padding: 48, display: "flex", justifyContent: "center" }}>
      <Loader2 size={20} className="animate-spin" style={{ color: C.text3 }} />
    </motion.div>
  );
  if (!board.length) return (
    <motion.div key="be" {...fadeUp} style={{ padding: "48px 20px", textAlign: "center" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🏆</div>
      <p style={{ color: C.text3, fontSize: 14 }}>No data yet — start earning points.</p>
    </motion.div>
  );

  const TOP_ICONS = ["👑", "💎", "🔥"];

  return (
    <motion.div key="board-tab" {...fadeUp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Top 3 */}
      <Card>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", padding: "12px 16px 4px" }}>🏆 Top Earners</p>
        {board.slice(0, 3).map((row, i) => {
          const isMe = row.fid === fid;
          return (
            <div key={row.fid}>
              <div style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                background: isMe ? "rgba(124,58,237,0.12)" : "transparent",
              }}>
                <span style={{ fontSize: 22, flexShrink: 0, width: 28, textAlign: "center" }}>{TOP_ICONS[i]}</span>
                <span style={{ flex: 1, color: isMe ? C.accentHi : C.text1, fontWeight: isMe ? 700 : 500, fontSize: 14 }}>
                  FID {row.fid}{isMe ? " · you" : ""}
                </span>
                <span style={{ color: isMe ? C.accentHi : C.text2, fontWeight: 800, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>
                  {row.total_points.toLocaleString()}
                </span>
              </div>
              {i < 2 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
            </div>
          );
        })}
      </Card>

      {/* Rest */}
      {board.length > 3 && (
        <Card>
          {board.slice(3).map((row, i) => {
            const isMe = row.fid === fid;
            return (
              <div key={row.fid}>
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.018 }}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: isMe ? "rgba(124,58,237,0.10)" : "transparent" }}
                >
                  <span style={{ width: 28, color: C.text3, fontSize: 12, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                    {row.rank}
                  </span>
                  <span style={{ flex: 1, color: isMe ? C.accentHi : C.text1, fontWeight: isMe ? 700 : 400, fontSize: 13 }}>
                    FID {row.fid}{isMe ? " · you" : ""}
                  </span>
                  <span style={{ color: isMe ? C.accentHi : C.text2, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
                    {row.total_points.toLocaleString()}
                  </span>
                </motion.div>
                {i < board.length - 4 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
              </div>
            );
          })}
        </Card>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE TAB
// ─────────────────────────────────────────────────────────────────────────────
function ProfileTab({ fid, ctx, pts, rank, loading, onRules }: {
  fid: number; ctx: MiniCtx | null; pts: FidPts | null; rank: number | null;
  loading: boolean; onRules: () => void;
}) {
  const username = ctx?.user?.username ?? `fid${fid}`;
  const display  = ctx?.user?.displayName ?? username;
  const pfpUrl   = ctx?.user?.pfpUrl ?? null;
  const ethAddrs = ctx?.user?.verifiedAddresses?.eth_addresses ?? [];
  const total    = pts?.total_points ?? 0;
  const actions  = pts?.breakdown.reduce((s, b) => s + b.total_actions, 0) ?? 0;

  return (
    <motion.div key="profile-tab" {...fadeUp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Identity */}
      <div style={{
        padding: "20px 18px", borderRadius: 20,
        background: `linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(168,85,247,0.08) 100%)`,
        border: `1px solid rgba(124,58,237,0.28)`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          {pfpUrl
            ? <img src={pfpUrl} alt="" style={{ width: 60, height: 60, borderRadius: "50%", border: `2px solid rgba(124,58,237,0.5)` }} />
            : <div style={{ width: 60, height: 60, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, #A855F7)`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, fontWeight: 900, color: "#fff", flexShrink: 0 }}>
                {username.slice(0,2).toUpperCase()}
              </div>
          }
          <div>
            <p style={{ color: C.text1, fontWeight: 800, fontSize: 18 }}>{display}</p>
            <p style={{ color: C.text3, fontSize: 13, marginTop: 2 }}>@{username} · FID {fid}</p>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 1 }}>
          {[
            { label: "Points",  value: loading ? "—" : total.toLocaleString(), e: "⚡" },
            { label: "Rank",    value: loading ? "—" : rank ? `#${rank}` : "—", e: "🏆" },
            { label: "Actions", value: loading ? "—" : actions.toString(), e: "🎯" },
          ].map((s, i) => (
            <div key={s.label} style={{ textAlign: "center", padding: "12px 6px", borderRight: i < 2 ? `1px solid ${C.border}` : "none" }}>
              <p style={{ fontSize: 16, marginBottom: 4 }}>{s.e}</p>
              <p style={{ color: C.text1, fontWeight: 800, fontSize: 18, fontVariantNumeric: "tabular-nums" }}>{s.value}</p>
              <p style={{ color: C.text3, fontSize: 11, marginTop: 2 }}>{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* NFT Pass */}
      <NFTPassCard fid={fid} ethAddress={ethAddrs[0]} />

      {/* Wallets */}
      {ethAddrs.length > 0 && (
        <Card>
          <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", padding: "12px 16px 4px" }}>🔐 Verified Wallets</p>
          {ethAddrs.map((addr, i) => (
            <div key={addr}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, flexShrink: 0 }} />
                <span style={{ color: C.text1, fontSize: 12, fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{addr}</span>
                <a href={`https://basescan.org/address/${addr}`} target="_blank" rel="noopener noreferrer" style={{ color: C.text3 }}>
                  <ExternalLink size={13} />
                </a>
              </div>
              {i < ethAddrs.length - 1 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
            </div>
          ))}
        </Card>
      )}

      {/* Rules */}
      <button onClick={onRules} style={{
        width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "15px 16px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, cursor: "pointer",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>⚡</span>
          <p style={{ color: C.text1, fontSize: 14, fontWeight: 700 }}>Scoring Rules & Point System</p>
        </div>
        <ChevronRight size={16} style={{ color: C.text3 }} />
      </button>

      {/* Airdrop */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 16px", background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.18)", borderRadius: 16 }}>
        <span style={{ fontSize: 22, flexShrink: 0 }}>🪙</span>
        <div>
          <p style={{ color: C.text1, fontWeight: 700, fontSize: 14 }}>Airdrop</p>
          <p style={{ color: C.text2, fontSize: 12, marginTop: 3 }}>Snapshot not announced yet. Keep earning points.</p>
        </div>
        <span style={{ marginLeft: "auto", width: 8, height: 8, borderRadius: "50%", background: C.amber, flexShrink: 0, animation: "pulse 2s ease-in-out infinite" }} />
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
type AppTab = "score" | "board" | "profile";

function MainApp({ fid, ctx, added, addApp }: {
  fid: number; ctx: MiniCtx | null; added: boolean; addApp: () => void;
}) {
  const [tab,    setTab]    = useState<AppTab>("score");
  const [pts,    setPts]    = useState<FidPts | null>(null);
  const [board,  setBoard]  = useState<LBRow[]>([]);
  const [load,   setLoad]   = useState(true);
  const [rules,  setRules]  = useState(false);

  const username = ctx?.user?.username ?? `fid${fid}`;
  const pfpUrl   = ctx?.user?.pfpUrl ?? null;
  const ethAddr  = ctx?.user?.verifiedAddresses?.eth_addresses?.[0];
  const rank     = board.find(r => r.fid === fid)?.rank ?? null;

  useEffect(() => {
    setLoad(true);
    Promise.all([apiPoints(fid), apiBoard()])
      .then(([p, b]) => { setPts(p); setBoard(b); })
      .finally(() => setLoad(false));
  }, [fid]);

  const TABS: { id: AppTab; label: string; icon: string }[] = [
    { id: "score",   label: "Score",    icon: "⚡" },
    { id: "board",   label: "Rankings", icon: "🏆" },
    { id: "profile", label: "Profile",  icon: "👤" },
  ];

  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", flexDirection: "column" }}>
      {/* Top gradient */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, height: 160, background: "radial-gradient(ellipse at 50% 0%, rgba(124,58,237,0.15) 0%, transparent 80%)", pointerEvents: "none", zIndex: 0 }} />

      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: `${C.bg}E8`, backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}`, padding: "10px 16px", display: "flex", alignItems: "center", gap: 10 }}>
        {pfpUrl
          ? <img src={pfpUrl} alt="" style={{ width: 32, height: 32, borderRadius: "50%", flexShrink: 0 }} />
          : <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, #A855F7)`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 900, color: "#fff" }}>
              {username.slice(0,2).toUpperCase()}
            </div>
        }
        <p style={{ flex: 1, color: C.text1, fontWeight: 700, fontSize: 14 }}>@{username}</p>
        {!added && (
          <button onClick={addApp} style={{ background: `rgba(124,58,237,0.2)`, border: `1px solid rgba(124,58,237,0.4)`, color: C.accentHi, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            ＋ Add
          </button>
        )}
        <button onClick={() => setRules(true)} style={{ background: "none", border: "none", color: C.text3, cursor: "pointer", padding: 4, display: "flex" }}>
          <HelpCircle size={18} />
        </button>
      </div>

      {/* Tab bar */}
      <div style={{ position: "sticky", top: 53, zIndex: 9, background: `${C.bg}E8`, backdropFilter: "blur(12px)", borderBottom: `1px solid ${C.border}`, display: "flex" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: "11px 8px", background: "none", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            fontSize: 13, fontWeight: tab === t.id ? 800 : 500,
            color: tab === t.id ? C.text1 : C.text3,
            borderBottom: tab === t.id ? `2.5px solid ${C.accentHi}` : "2.5px solid transparent",
            marginBottom: -1, transition: "color 0.15s, border-color 0.15s",
          }}>
            <span style={{ fontSize: 14 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: "14px 16px 40px", overflowY: "auto", position: "relative", zIndex: 1 }}>
        <AnimatePresence mode="wait">
          {tab === "score"   && <ScoreTab   key="s" fid={fid} ethAddr={ethAddr}  loading={load} pts={pts}  rank={rank} />}
          {tab === "board"   && <BoardTab   key="b" fid={fid} board={board} loading={load} />}
          {tab === "profile" && <ProfileTab key="p" fid={fid} ctx={ctx} pts={pts} rank={rank} loading={load} onRules={() => setRules(true)} />}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {rules && <RulesSheet key="rules" onClose={() => setRules(false)} />}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
export function MiniAppPage() {
  const { fid, ctx, ready, inFC, added, addApp } = useSDK();
  const [onboarded, setOnboarded] = useState(
    () => localStorage.getItem("fc_v1_onboarded") === "1",
  );

  let phase: "loading" | "browser" | "onboarding" | "app";
  if (!ready)            phase = "loading";
  else if (!fid || !inFC) phase = "browser";
  else if (!onboarded)   phase = "onboarding";
  else                   phase = "app";

  function complete() {
    localStorage.setItem("fc_v1_onboarded", "1");
    setOnboarded(true);
  }

  return (
    <div style={{ background: C.bg, minHeight: "100svh" }}>
      <AnimatePresence mode="wait">
        {phase === "loading"    && <LoadingScreen key="L" />}
        {phase === "browser"    && <BrowserScreen key="B" />}
        {phase === "onboarding" && fid && (
          <OnboardingFlow key="O" fid={fid} ctx={ctx} addApp={addApp} onComplete={complete} />
        )}
        {phase === "app" && fid && (
          <MainApp key="A" fid={fid} ctx={ctx} added={added} addApp={addApp} />
        )}
      </AnimatePresence>
    </div>
  );
}
