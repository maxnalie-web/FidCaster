/**
 * FidCaster Mini App — v6 Visual Overhaul
 *
 * Dark purple, gamified, glassy design with real-time animations.
 * 5-tab bottom nav: Home | Leaderboard | Earn | Rewards | Profile
 * Fire ring particle canvas around streak number.
 */
import {
  useEffect, useState, useCallback, useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sdk } from "@farcaster/miniapp-sdk";
import {
  ArrowRight, ArrowLeft, Copy, Check, ExternalLink,
  Loader2, X,
  Zap, Trophy, Users, ShoppingBag, Tag, Share2,
  Sword, Sprout, Heart, RefreshCw, Edit3,
  Wallet, Shield, Globe, Star, Gift,
  Home, LayoutList, Award, Bell,
  ChevronRight, Lock,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        "#0B0910",
  card:      "rgba(255,255,255,0.05)",
  cardHi:    "rgba(255,255,255,0.09)",
  border:    "rgba(255,255,255,0.08)",
  borderMed: "rgba(255,255,255,0.15)",
  accent:    "#8B5CF6",
  accentHi:  "#C4B5FD",
  accent2:   "#7C3AED",
  glow:      "rgba(139,92,246,0.35)",
  text1:     "#FFFFFF",
  text2:     "rgba(255,255,255,0.60)",
  text3:     "rgba(255,255,255,0.30)",
  green:     "#10B981",
  amber:     "#F59E0B",
  rose:      "#F43F5E",
  fire1:     "#FF4500",
  fire2:     "#FF8C00",
  fire3:     "#FFD700",
} as const;

// ── Animations ────────────────────────────────────────────────────────────────
const slideUp = {
  initial:   { opacity: 0, y: 20 },
  animate:   { opacity: 1, y: 0  },
  exit:      { opacity: 0, y: -10 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};
const fadeUp = {
  initial:   { opacity: 0, y: 12 },
  animate:   { opacity: 1, y: 0  },
  exit:      { opacity: 0, y: -6 },
  transition: { duration: 0.22, ease: [0.4, 0, 0.2, 1] },
};
const slideIn = {
  initial:   { opacity: 0, x: 28, scale: 0.98 },
  animate:   { opacity: 1, x: 0,  scale: 1    },
  exit:      { opacity: 0, x: -28, scale: 0.98 },
  transition: { duration: 0.25, ease: [0.4, 0, 0.2, 1] },
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface MiniCtx {
  user?: {
    fid: number; username?: string; displayName?: string; pfpUrl?: string;
    verifiedAddresses?: { eth_addresses?: string[] };
  };
  client?: { added?: boolean };
}
interface LBRow {
  fid: number; total_points: number; rank: number;
  username: string; displayName: string; pfpUrl: string;
}
interface FidPts {
  fid: number; total_points: number; pendingClaimed?: number;
  breakdown: { action_type: string; total_actions: number; points_earned: number }[];
}
interface HistoryRow { id: number; action_type: string; pts: number; created_at: string; }
interface ReferralRow { fid: number; activated: boolean; activated_at: string | null; created_at: string; }
interface ReferralListData { referredBy: number | null; referrals: ReferralRow[]; }
interface EligibilityData { eligible: boolean; score: number; threshold: number; reason?: string; }
interface AllowanceData { total: number; used: number; remaining: number; resetsAt: string; }
interface MissionItem { id: string; action: string; label: string; target: number; pts: number; count: number; done: boolean; }
interface Achievement { id: string; label: string; icon: string; unlocked: boolean; }
interface StatsData {
  streak: number; level: number; xp: number; xpToNext: number;
  totalPoints: number; todayPoints: number;
  missions: MissionItem[]; achievements: Achievement[];
  nextStreakBonusPts: number; streakBonusAwarded: boolean;
  seasonEnd: string;
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
      const params = new URLSearchParams(window.location.search);
      const pFid = parseInt(params.get("fid") ?? "0", 10);
      const pEth = params.get("eth") ?? undefined;
      if (pFid > 0) {
        setFid(pFid);
        // Placeholder while we fetch real Neynar profile
        setCtx({
          user: {
            fid: pFid, username: `fid${pFid}`, displayName: `FID ${pFid}`,
            ...(pEth ? { verifiedAddresses: { eth_addresses: [pEth] } } : {}),
          },
        });
        setInFC(true); setReady(true); setAdded(true);
        // Enrich with real Neynar user data
        fetch(`/api/mini/user?fid=${pFid}`)
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d) return;
            setCtx({
              user: {
                fid: pFid,
                username: d.username ?? `fid${pFid}`,
                displayName: d.display_name ?? d.displayName ?? `FID ${pFid}`,
                pfpUrl: d.pfp_url ?? d.pfpUrl ?? undefined,
                ...(pEth ? { verifiedAddresses: { eth_addresses: [pEth] } } :
                  d.verified_addresses?.eth_addresses?.length
                    ? { verifiedAddresses: { eth_addresses: d.verified_addresses.eth_addresses } }
                    : {}),
              },
            });
          })
          .catch(() => {});
        return;
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
      } catch {} finally { if (!dead) setReady(true); }
    })();
    return () => { dead = true; };
  }, []);

  const addApp = useCallback(async () => {
    try { await (sdk.actions as any).addMiniApp(); setAdded(true); } catch {}
  }, []);

  return { fid, ctx, ready, inFC, added, addApp };
}

// ── Utility ───────────────────────────────────────────────────────────────────
function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function useCountdown(targetMs: number) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const tick = () => {
      const ms = targetMs - Date.now();
      if (ms <= 0) { setLabel("00:00:00"); return; }
      const h = Math.floor(ms / 3_600_000);
      const m = Math.floor((ms % 3_600_000) / 60_000);
      const s = Math.floor((ms % 60_000) / 1_000);
      setLabel(`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`);
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [targetMs]);
  return label;
}

// ── APIs ──────────────────────────────────────────────────────────────────────
async function apiPoints(fid: number): Promise<FidPts | null> {
  try { const r = await fetch(`/api/points/my?fid=${fid}`); return r.ok ? r.json() : null; }
  catch { return null; }
}
async function apiMiniBoard(limit = 50): Promise<LBRow[]> {
  try {
    const r = await fetch(`/api/mini/leaderboard?limit=${limit}`);
    const d = await r.json();
    return d.leaderboard ?? [];
  } catch { return []; }
}
async function apiHistory(fid: number): Promise<HistoryRow[] | null> {
  try {
    const r = await fetch(`/api/points/history?fid=${fid}&limit=50`);
    if (!r.ok) return null;
    const d = await r.json();
    return Array.isArray(d.history) ? d.history : [];
  } catch { return null; }
}
async function apiReferralList(fid: number): Promise<ReferralListData> {
  try {
    const r = await fetch(`/api/referral/list?fid=${fid}`);
    const d = await r.json();
    return { referredBy: d.referredBy ?? null, referrals: Array.isArray(d.referrals) ? d.referrals : [] };
  } catch { return { referredBy: null, referrals: [] }; }
}
async function apiEligibility(fid: number): Promise<EligibilityData> {
  try {
    const r = await fetch(`/api/mini/eligibility?fid=${fid}`);
    return r.ok ? r.json() : { eligible: true, score: -1, threshold: 30 };
  } catch { return { eligible: true, score: -1, threshold: 30 }; }
}
async function apiAllowance(fid: number): Promise<AllowanceData | null> {
  try {
    const r = await fetch(`/api/allowance?fid=${fid}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}
async function apiStats(fid: number): Promise<StatsData | null> {
  try {
    const r = await fetch(`/api/mini/stats?fid=${fid}`);
    return r.ok ? r.json() : null;
  } catch { return null; }
}

// ── Animated counter ──────────────────────────────────────────────────────────
function Counter({ to, className, style }: { to: number; className?: string; style?: React.CSSProperties }) {
  const [n, setN] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current, dur = 1200, t0 = performance.now();
    let raf = 0;
    const f = (now: number) => {
      const p = Math.min((now - t0) / dur, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setN(Math.round(from + (to - from) * e));
      if (p < 1) raf = requestAnimationFrame(f); else prev.current = to;
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [to]);
  return <span className={className} style={style}>{n.toLocaleString()}</span>;
}

// ── Background orbs ───────────────────────────────────────────────────────────
function BgOrbs() {
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      <motion.div animate={{ x: [0,40,-20,0], y: [0,-30,20,0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
        style={{ position:"absolute", top:"-8%", left:"-5%", width:360, height:360, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)", filter:"blur(50px)" }} />
      <motion.div animate={{ x: [0,-30,15,0], y: [0,25,-15,0] }}
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut", delay: 5 }}
        style={{ position:"absolute", bottom:"5%", right:"-10%", width:300, height:300, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)", filter:"blur(55px)" }} />
      <motion.div animate={{ x: [0,20,-10,0], y: [0,-20,30,0] }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut", delay: 10 }}
        style={{ position:"absolute", top:"45%", left:"25%", width:220, height:220, borderRadius:"50%",
          background:"radial-gradient(circle, rgba(168,85,247,0.14) 0%, transparent 70%)", filter:"blur(65px)" }} />
    </div>
  );
}

// ── Glass card ────────────────────────────────────────────────────────────────
function Card({ children, style = {}, glow = false, className }: {
  children: React.ReactNode; style?: React.CSSProperties; glow?: boolean; className?: string;
}) {
  return (
    <div className={className} style={{
      background: C.card, border: `1px solid ${glow ? "rgba(139,92,246,0.35)" : C.border}`,
      borderRadius: 20, overflow: "hidden", position: "relative", backdropFilter: "blur(14px)",
      boxShadow: glow ? `0 0 0 1px rgba(139,92,246,0.18), 0 8px 32px rgba(139,92,246,0.12)` : "none",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ color: C.text3, fontSize: 10, fontWeight: 800, letterSpacing: "0.15em",
      textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>
      {children}
    </p>
  );
}

// ── Progress ring (used for the daily allowance) ────────────────────────────────
function ProgressRing({ pct, size = 56, stroke = 6, color }: {
  pct: number; size?: number; stroke?: number; color: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform:"rotate(-90deg)", flexShrink:0 }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.border} strokeWidth={stroke} />
      <motion.circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={c}
        initial={{ strokeDashoffset: c }}
        animate={{ strokeDashoffset: c - (c * Math.max(0, Math.min(pct, 100))) / 100 }}
        transition={{ duration: 0.8 }}
        style={{ filter: `drop-shadow(0 0 4px ${color})` }} />
    </svg>
  );
}

// ── Pill chip ─────────────────────────────────────────────────────────────────
function Chip({ children, color = C.accentHi, bg = "rgba(139,92,246,0.15)", border = "rgba(139,92,246,0.3)" }: {
  children: React.ReactNode; color?: string; bg?: string; border?: string;
}) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:bg,
      border:`1px solid ${border}`, borderRadius:999, padding:"3px 10px",
      color, fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
      {children}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FIRE RING CANVAS
// ─────────────────────────────────────────────────────────────────────────────
interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; angle: number;
}

function FireRing({ radius = 68, size = 200, active = true }: {
  radius?: number; size?: number; active?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number>(0);
  const visible = useRef(active);

  useEffect(() => { visible.current = active; }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cx = size / 2, cy = size / 2;
    const SPAWN_RATE = 4;

    function spawnParticle() {
      const angle = Math.random() * Math.PI * 2;
      const r = radius + (Math.random() - 0.5) * 10;
      const x = cx + Math.cos(angle) * r;
      const y = cy + Math.sin(angle) * r;
      // Velocity mostly upward along the circle tangent + inward
      const tangentX = -Math.sin(angle);
      const tangentY =  Math.cos(angle);
      const inwardX  = -Math.cos(angle);
      const inwardY  = -Math.sin(angle);
      const speed = 0.5 + Math.random() * 1.2;
      const inward = 0.2 + Math.random() * 0.4;
      // Add upward bias
      const upBias = -0.6 - Math.random() * 0.8;
      particlesRef.current.push({
        x, y,
        vx: tangentX * speed * 0.3 + inwardX * inward + (Math.random() - 0.5) * 0.3,
        vy: tangentY * speed * 0.3 + inwardY * inward + upBias,
        life: 0, maxLife: 40 + Math.random() * 30,
        size: 3 + Math.random() * 4,
        angle,
      });
    }

    function drawFrame() {
      if (!visible.current) { rafRef.current = requestAnimationFrame(drawFrame); return; }
      ctx!.clearRect(0, 0, size, size);

      // Spawn new particles
      for (let i = 0; i < SPAWN_RATE; i++) spawnParticle();

      // Draw glow ring base
      const glowGrad = ctx!.createRadialGradient(cx, cy, radius - 12, cx, cy, radius + 12);
      glowGrad.addColorStop(0, "rgba(255,69,0,0.0)");
      glowGrad.addColorStop(0.5, "rgba(255,100,0,0.25)");
      glowGrad.addColorStop(1, "rgba(255,69,0,0.0)");
      ctx!.fillStyle = glowGrad;
      ctx!.beginPath();
      ctx!.arc(cx, cy, radius + 12, 0, Math.PI * 2);
      ctx!.arc(cx, cy, radius - 12, 0, Math.PI * 2, true);
      ctx!.fill();

      // Update & draw particles
      particlesRef.current = particlesRef.current.filter(p => p.life < p.maxLife);
      for (const p of particlesRef.current) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy -= 0.02; // upward acceleration
        p.vx += (Math.random() - 0.5) * 0.08; // drift
        p.life++;

        const t = p.life / p.maxLife;
        const alpha = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
        const shrink = 1 - t * 0.7;

        // Color: white → yellow → orange → red
        let r = 255, g = 255, b = 255;
        if (t < 0.15) { g = Math.round(255 * (1 - t/0.15 * 0.2)); b = Math.round(255 * (1 - t/0.15)); }
        else if (t < 0.5) { g = Math.round(200 - (t - 0.15) / 0.35 * 80); b = 0; }
        else { r = 255; g = Math.max(0, Math.round(120 - (t - 0.5) / 0.5 * 120)); b = 0; }

        const grad = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * shrink * 1.5);
        grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
        grad.addColorStop(1, `rgba(${r},${g},0,0)`);
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size * shrink * 1.5, 0, Math.PI * 2);
        ctx!.fillStyle = grad;
        ctx!.fill();
      }

      rafRef.current = requestAnimationFrame(drawFrame);
    }

    rafRef.current = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafRef.current);
  }, [radius, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HERO LOGO ORB — floating F logo with a halo ring, crystals, and a soft glow.
// Pure CSS/framer-motion (no canvas) so it's cheap to mount on the hero card.
// ─────────────────────────────────────────────────────────────────────────────
function Crystal({ size, style }: { size: number; style: React.CSSProperties }) {
  return (
    <motion.div
      animate={{ y: [0, -5, 0], rotate: [0, 4, 0] }}
      transition={{ duration: 4 + Math.random() * 2, repeat: Infinity, ease: "easeInOut" }}
      style={{
        position: "absolute", width: size, height: size * 1.15, ...style,
        background: "linear-gradient(160deg,#E9D5FF 0%,#A855F7 45%,#5B21B6 100%)",
        clipPath: "polygon(50% 0%, 88% 20%, 68% 100%, 32% 100%, 12% 20%)",
        filter: "drop-shadow(0 0 6px rgba(168,85,247,0.85))",
      }}
    />
  );
}

function HeroLogoOrb({ size = 110 }: { size?: number }) {
  const logoSize = size * 0.66;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      {/* soft ambient glow */}
      <motion.div animate={{ scale: [1, 1.15, 1], opacity: [0.55, 0.85, 0.55] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        style={{ position: "absolute", inset: -size * 0.25, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(139,92,246,0.45) 0%, transparent 70%)" }} />
      {/* tilted halo ring, slow rotation */}
      <motion.div initial={{ rotateX: 72 }} animate={{ rotateX: 72, rotate: 360 }}
        transition={{ duration: 26, repeat: Infinity, ease: "linear" }}
        style={{ position: "absolute", inset: -size * 0.16, borderRadius: "50%",
          border: "1.5px solid rgba(233,213,255,0.55)",
          boxShadow: "0 0 14px rgba(168,85,247,0.6)" }} />
      <motion.div initial={{ rotateX: 72 }} animate={{ rotateX: 72, rotate: -360 }}
        transition={{ duration: 40, repeat: Infinity, ease: "linear" }}
        style={{ position: "absolute", inset: -size * 0.3, borderRadius: "50%",
          border: "1px dashed rgba(168,85,247,0.28)" }} />
      {/* scattered crystal shards */}
      <Crystal size={size * 0.16} style={{ top: -size * 0.12, right: -size * 0.14 }} />
      <Crystal size={size * 0.11} style={{ bottom: -size * 0.08, left: -size * 0.16 }} />
      {/* floating logo */}
      <motion.div animate={{ y: [-5, 5, -5] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <img src="/mini-logo.png" alt="" style={{ width: logoSize, height: logoSize, objectFit: "contain",
          filter: "drop-shadow(0 0 16px rgba(168,85,247,0.8)) drop-shadow(0 6px 12px rgba(0,0,0,0.4))" }} />
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ minHeight:"100svh", background:C.bg, display:"flex", alignItems:"center",
      justifyContent:"center", flexDirection:"column", gap:16 }}>
      <BgOrbs />
      <div style={{ position:"relative", zIndex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:16 }}>
        <motion.div animate={{ rotate:360 }} transition={{ duration:2, repeat:Infinity, ease:"linear" }}
          style={{ width:48, height:48, borderRadius:"50%",
            border:"2px solid transparent",
            background:`linear-gradient(${C.bg},${C.bg}) padding-box, linear-gradient(135deg,${C.accent},${C.accentHi}) border-box` }} />
        <p style={{ color:C.text3, fontSize:13 }}>Loading FidCaster…</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER GATE
// ─────────────────────────────────────────────────────────────────────────────
function BrowserScreen() {
  return (
    <div style={{ minHeight:"100svh", background:C.bg, display:"flex", alignItems:"center",
      justifyContent:"center", padding:24 }}>
      <BgOrbs />
      <motion.div {...fadeUp} style={{ position:"relative", zIndex:1, maxWidth:360, width:"100%", textAlign:"center" }}>
        <div style={{ width:64, height:64, borderRadius:20, margin:"0 auto 20px",
          background:"linear-gradient(135deg,rgba(139,92,246,0.3),rgba(168,85,247,0.15))",
          border:`1px solid rgba(139,92,246,0.4)`,
          display:"flex", alignItems:"center", justifyContent:"center" }}>
          <Globe size={28} color={C.accentHi} />
        </div>
        <p style={{ color:C.text1, fontWeight:800, fontSize:20, marginBottom:10 }}>Open in Warpcast</p>
        <p style={{ color:C.text2, fontSize:14, lineHeight:1.7, marginBottom:28 }}>
          This mini app runs inside Warpcast. Search for{" "}
          <strong style={{ color:C.accentHi }}>FidCaster</strong> or tap the link below.
        </p>
        <a href="https://warpcast.com/~/mini-apps" target="_blank" rel="noopener noreferrer"
          style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8,
            background:`linear-gradient(135deg,${C.accent},#A855F7)`, color:"#fff",
            borderRadius:14, padding:"14px 20px", fontSize:15, fontWeight:700, textDecoration:"none",
            boxShadow:`0 8px 24px rgba(139,92,246,0.4)` }}>
          Open Warpcast <ExternalLink size={15} />
        </a>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// NFT PASS CARD
// ─────────────────────────────────────────────────────────────────────────────
function NFTPassCard({ fid, ethAddress, onMinted }: { fid: number; ethAddress?: string; onMinted?: () => void }) {
  const [s, setS]             = useState<"checking"|"idle"|"connecting"|"input"|"minting"|"done"|"error">("checking");
  const [activeAddr, setAddr]  = useState(ethAddress ?? "");
  const [manualAddr, setManual] = useState("");
  const [txHash, setTx]        = useState("");
  const [err, setErr]          = useState("");

  useEffect(() => {
    if (!ethAddress) { setS("idle"); return; }
    setAddr(ethAddress);
    fetch(`/api/nft-pass/check/${ethAddress}`)
      .then(r => r.json()).then(d => { if (d.hasMinted) { setS("done"); onMinted?.(); } else setS("idle"); })
      .catch(() => setS("idle"));
  }, [ethAddress]);

  const short = (a: string) => `${a.slice(0,6)}…${a.slice(-4)}`;
  const hasWallet = !!(typeof window !== "undefined" && (window as any).ethereum);

  async function doMint(address: string) {
    setAddr(address);
    setS("minting");
    try {
      const r = await fetch("/api/nft-pass/mint", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ fid, address }),
      });
      const d = await r.json();
      if (d.alreadyMinted || r.ok) { setTx(d.txHash ?? ""); setS("done"); onMinted?.(); }
      else throw new Error(d.error ?? "Mint failed");
    } catch (e) { setErr(String(e)); setS("error"); }
  }

  async function connectWallet() {
    setS("connecting");
    try {
      const eth = (window as any).ethereum;
      try { await eth.request({ method:"wallet_switchEthereumChain", params:[{ chainId:"0x2105" }] }); } catch {}
      const accounts: string[] = await eth.request({ method:"eth_requestAccounts" });
      const addr = accounts[0];
      if (!addr) { setS("idle"); return; }
      setAddr(addr);
      const check = await fetch(`/api/nft-pass/check/${addr}`).then(r => r.json()).catch(() => ({}));
      if (check.hasMinted) { setS("done"); onMinted?.(); return; }
      doMint(addr);
    } catch (e) { setErr(String(e)); setS("error"); }
  }

  if (s === "checking") return (
    <Card style={{ padding:"16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <Loader2 size={16} className="animate-spin" style={{ color:C.accentHi }} />
        <p style={{ color:C.text2, fontSize:13 }}>Checking wallet…</p>
      </div>
    </Card>
  );

  if (s === "done") return (
    <Card glow style={{ padding:"14px 16px" }}>
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <img src="/nft-pass-v2.png" alt="" style={{ width:44, height:44, borderRadius:12, objectFit:"contain", background:"rgba(139,92,246,0.1)" }} />
        <div style={{ flex:1 }}>
          <p style={{ color:C.text1, fontWeight:700, fontSize:14 }}>FidCaster Pass</p>
          <p style={{ color:C.green, fontSize:12, marginTop:2, display:"flex", alignItems:"center", gap:4 }}>
            <Check size={12} /> Minted · Full access active
          </p>
          {activeAddr && <p style={{ color:C.text3, fontSize:11, fontFamily:"monospace", marginTop:2 }}>{short(activeAddr)}</p>}
        </div>
        {txHash && (
          <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
            style={{ color:C.text3, display:"flex" }}>
            <ExternalLink size={13} />
          </a>
        )}
      </div>
    </Card>
  );

  return (
    <Card glow>
      <div style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px" }}>
        <img src="/nft-pass-v2.png" alt="" style={{ width:44, height:44, borderRadius:12, objectFit:"contain", background:"rgba(139,92,246,0.1)" }} />
        <div style={{ flex:1 }}>
          <p style={{ color:C.text1, fontWeight:700, fontSize:14 }}>FidCaster Pass</p>
          <p style={{ color:C.text2, fontSize:12, marginTop:2 }}>
            {activeAddr ? <>Base NFT · <span style={{ fontFamily:"monospace", color:C.accentHi }}>{short(activeAddr)}</span></>
              : hasWallet ? "Connect wallet to mint free" : "Free NFT on Base"}
          </p>
        </div>
        {s === "idle" && !ethAddress && hasWallet && (
          <button onClick={connectWallet} style={{ background:`linear-gradient(135deg,${C.accent},#A855F7)`, color:"#fff",
            borderRadius:10, padding:"8px 14px", fontSize:12, fontWeight:700, border:"none", cursor:"pointer",
            boxShadow:`0 4px 16px rgba(139,92,246,0.35)`, display:"flex", alignItems:"center", gap:5 }}>
            <Wallet size={12} /> Connect
          </button>
        )}
        {s === "idle" && (ethAddress || !hasWallet) && (
          <button onClick={() => ethAddress ? doMint(ethAddress) : setS("input")}
            style={{ background:`linear-gradient(135deg,${C.accent},#A855F7)`, color:"#fff",
              borderRadius:10, padding:"8px 16px", fontSize:13, fontWeight:700, border:"none", cursor:"pointer",
              boxShadow:`0 4px 16px rgba(139,92,246,0.35)` }}>
            Mint free
          </button>
        )}
        {(s === "minting" || s === "connecting") && (
          <span style={{ color:C.accentHi, fontSize:13, display:"flex", alignItems:"center", gap:5 }}>
            <Loader2 size={14} className="animate-spin" />
            {s === "connecting" ? "Connecting…" : "Minting…"}
          </span>
        )}
      </div>
      <AnimatePresence>
        {s === "input" && (
          <motion.div initial={{ height:0, opacity:0 }} animate={{ height:"auto", opacity:1 }}
            exit={{ height:0, opacity:0 }} transition={{ duration:0.2 }} style={{ overflow:"hidden" }}>
            <div style={{ borderTop:`1px solid ${C.border}`, padding:"12px 16px", display:"flex", flexDirection:"column", gap:8 }}>
              <input type="text" placeholder="0x…" value={manualAddr} onChange={e => setManual(e.target.value)}
                style={{ width:"100%", padding:"10px 12px", background:"rgba(0,0,0,0.4)", border:`1px solid ${C.borderMed}`,
                  borderRadius:10, color:C.text1, fontSize:13, fontFamily:"monospace", outline:"none", boxSizing:"border-box" }} />
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={() => doMint(manualAddr)} disabled={!manualAddr.trim()}
                  style={{ flex:1, padding:"10px", borderRadius:10, background:`linear-gradient(135deg,${C.accent},#A855F7)`,
                    color:"#fff", border:"none", fontSize:13, fontWeight:700, cursor:"pointer", opacity:manualAddr.trim()?1:0.45 }}>
                  Mint
                </button>
                <button onClick={() => setS("idle")}
                  style={{ padding:"10px 14px", background:C.card, border:`1px solid ${C.border}`,
                    borderRadius:10, color:C.text2, fontSize:13, cursor:"pointer" }}>
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {s === "error" && (
          <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            style={{ padding:"10px 16px", borderTop:`1px solid ${C.border}` }}>
            <p style={{ color:C.rose, fontSize:12 }}>{err}</p>
            <button onClick={() => setS("idle")} style={{ background:"none", border:"none", color:C.text3, fontSize:12, cursor:"pointer", marginTop:4 }}>
              Try again
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING (unchanged flow, restyled)
// ─────────────────────────────────────────────────────────────────────────────
const OB_STEPS = [
  { Icon: Star,   title: "Welcome to FidCaster", hint: "Step 1 of 3" },
  { Icon: Shield, title: "Mint Your Pass",        hint: "Step 2 of 3" },
  { Icon: Globe,  title: "Join fidcaster.xyz",    hint: "Step 3 of 3" },
];

function OnboardingFlow({ fid, ctx, onComplete }: { fid: number; ctx: MiniCtx | null; onComplete: () => void }) {
  const [step,    setStep]    = useState(0);
  const [minted,  setMinted]  = useState(false);
  const [eligData, setEligData] = useState<EligibilityData | null>(null);
  const [eligLoad, setEligLoad] = useState(false);

  const username = ctx?.user?.username ?? `fid${fid}`;
  const pfpUrl   = ctx?.user?.pfpUrl ?? null;
  const ethAddr  = ctx?.user?.verifiedAddresses?.eth_addresses?.[0];

  useEffect(() => {
    if (step === 1 && !eligData && !eligLoad) {
      setEligLoad(true);
      apiEligibility(fid).then(d => { setEligData(d); setEligLoad(false); });
    }
  }, [step, fid, eligData, eligLoad]);

  const canContinue = step === 0 || (step === 1 && minted && eligData?.eligible !== false);

  const stepContent = [
    <motion.div key="s0" {...slideIn} style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", gap:14, padding:"16px",
        background:C.cardHi, borderRadius:16, border:`1px solid ${C.borderMed}` }}>
        {pfpUrl
          ? <img src={pfpUrl} alt="" style={{ width:48, height:48, borderRadius:"50%" }} />
          : <div style={{ width:48, height:48, borderRadius:"50%", background:`linear-gradient(135deg,${C.accent},#A855F7)`,
              display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:900, color:"#fff" }}>
              {username.slice(0,2).toUpperCase()}
            </div>
        }
        <div>
          <p style={{ color:C.text1, fontWeight:700, fontSize:16 }}>@{username}</p>
          <p style={{ color:C.text3, fontSize:13, marginTop:2 }}>Farcaster ID {fid}</p>
        </div>
        <Check size={18} color={C.green} style={{ marginLeft:"auto" }} />
      </div>
      <p style={{ color:C.text2, fontSize:14, lineHeight:1.75 }}>
        <strong style={{ color:C.text1 }}>FidCaster</strong> is a Farcaster client that rewards every verified action with points — counting toward the airdrop.
      </p>
      {[
        { Icon:Zap,    color:C.accentHi, text:"Earn points for every verified Farcaster action" },
        { Icon:Trophy, color:C.amber,    text:"Climb the leaderboard and secure a larger airdrop share" },
        { Icon:Shield, color:C.green,    text:"Your FID is your account. Fully on-chain, no sign-up" },
      ].map(({ Icon, color, text }) => (
        <div key={text} style={{ display:"flex", alignItems:"flex-start", gap:12, padding:"11px 14px",
          background:C.card, borderRadius:12, border:`1px solid ${C.border}` }}>
          <Icon size={16} color={color} style={{ flexShrink:0, marginTop:1 }} />
          <p style={{ color:C.text2, fontSize:13, lineHeight:1.5 }}>{text}</p>
        </div>
      ))}
    </motion.div>,

    <motion.div key="s1" {...slideIn} style={{ display:"flex", flexDirection:"column", gap:14 }}>
      {eligLoad || !eligData ? (
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"20px 0" }}>
          <Loader2 size={18} className="animate-spin" style={{ color:C.accentHi }} />
          <p style={{ color:C.text2, fontSize:14 }}>Checking eligibility…</p>
        </div>
      ) : !eligData.eligible ? (
        <div style={{ padding:"20px", background:"rgba(244,63,94,0.07)", border:"1px solid rgba(244,63,94,0.22)", borderRadius:18 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:10 }}>
            <Shield size={20} color={C.rose} />
            <p style={{ color:C.rose, fontWeight:700, fontSize:16 }}>Score Too Low</p>
          </div>
          <p style={{ color:C.text2, fontSize:13, lineHeight:1.7 }}>
            Your Neynar score is <strong style={{ color:C.rose }}>{eligData.score >= 0 ? eligData.score.toFixed(0) : "unknown"}</strong>.
            You need at least <strong style={{ color:C.text1 }}>{eligData.threshold}</strong> to use FidCaster.
          </p>
          <button onClick={() => setEligData(null)} style={{ marginTop:12, background:"rgba(244,63,94,0.14)",
            border:"1px solid rgba(244,63,94,0.3)", color:C.rose, fontSize:12.5, fontWeight:700,
            borderRadius:10, padding:"8px 14px", cursor:"pointer" }}>
            Check again
          </button>
        </div>
      ) : (
        <>
          <p style={{ color:C.text2, fontSize:14, lineHeight:1.7 }}>
            The <strong style={{ color:C.text1 }}>FidCaster Pass</strong> is a free NFT on Base that unlocks full access.
          </p>
          {eligData.score >= 0 && (
            <div style={{ display:"flex", alignItems:"center", gap:8, padding:"8px 12px",
              background:"rgba(16,185,129,0.07)", border:"1px solid rgba(16,185,129,0.18)", borderRadius:10 }}>
              <Check size={13} color={C.green} />
              <p style={{ color:C.green, fontSize:12 }}>Neynar score: <strong>{eligData.score.toFixed(0)}</strong> — eligible ✓</p>
            </div>
          )}
          <NFTPassCard fid={fid} ethAddress={ethAddr} onMinted={() => setMinted(true)} />
          {minted
            ? <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px",
                background:"rgba(16,185,129,0.08)", border:"1px solid rgba(16,185,129,0.22)", borderRadius:14 }}>
                <Check size={16} color={C.green} />
                <p style={{ color:C.green, fontSize:13, fontWeight:600 }}>Pass minted! Tap Continue to proceed.</p>
              </div>
            : <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 14px",
                background:"rgba(245,158,11,0.07)", border:"1px solid rgba(245,158,11,0.20)", borderRadius:14 }}>
                <Shield size={15} color={C.amber} />
                <p style={{ color:C.amber, fontSize:13 }}>You must mint the pass to unlock the app.</p>
              </div>
          }
        </>
      )}
    </motion.div>,

    <motion.div key="s2" {...slideIn} style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <p style={{ color:C.text2, fontSize:14, lineHeight:1.7 }}>
        All earning activities happen on <strong style={{ color:C.amber }}>fidcaster.xyz</strong>. Create your account there.
      </p>
      <Card style={{ padding:"4px 0" }}>
        {[
          { n:1, Icon:Globe,       text:"Go to fidcaster.xyz" },
          { n:2, Icon:Users,       text:"Sign in with your Farcaster account" },
          { n:3, Icon:Edit3,       text:"Cast, recast, and like to earn points" },
          { n:4, Icon:ShoppingBag, text:"Buy or list FIDs on the marketplace" },
          { n:5, Icon:Share2,      text:"Refer friends for 200 pts each" },
          { n:6, Icon:Zap,         text:"Check this mini app daily to track your score" },
        ].map(({ n, Icon, text }, i, arr) => (
          <div key={n}>
            <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 16px" }}>
              <div style={{ width:26, height:26, borderRadius:"50%", background:"rgba(139,92,246,0.15)",
                border:"1px solid rgba(139,92,246,0.25)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>
                <span style={{ color:C.accentHi, fontSize:11, fontWeight:800 }}>{n}</span>
              </div>
              <Icon size={14} color={C.text3} style={{ flexShrink:0 }} />
              <p style={{ color:C.text2, fontSize:13, lineHeight:1.4 }}>{text}</p>
            </div>
            {i < arr.length - 1 && <div style={{ height:1, background:C.border, margin:"0 16px" }} />}
          </div>
        ))}
      </Card>
      <a href="https://fidcaster.xyz" target="_blank" rel="noopener noreferrer"
        style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8,
          padding:"15px 20px", borderRadius:14,
          background:`linear-gradient(135deg,${C.accent} 0%,#A855F7 100%)`,
          color:"#fff", fontWeight:800, fontSize:15, textDecoration:"none",
          boxShadow:`0 4px 24px rgba(139,92,246,0.35)` }}>
        Open fidcaster.xyz <ExternalLink size={15} />
      </a>
      <button onClick={onComplete}
        style={{ width:"100%", background:"none", border:`1px solid ${C.border}`,
          borderRadius:14, padding:"13px 20px", color:C.text2, fontSize:14, fontWeight:600, cursor:"pointer",
          display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}>
        I have registered <ArrowRight size={15} />
      </button>
    </motion.div>,
  ];

  return (
    <div style={{ minHeight:"100svh", background:C.bg, display:"flex", flexDirection:"column" }}>
      <BgOrbs />
      <div style={{ position:"relative", zIndex:1, padding:"20px 20px 0", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <span style={{ color:C.text1, fontWeight:800, fontSize:17 }}>FidCaster</span>
        <span style={{ color:C.text3, fontSize:12 }}>{OB_STEPS[step].hint}</span>
      </div>
      <div style={{ position:"relative", zIndex:1, margin:"12px 20px 0", height:3, background:C.border, borderRadius:3 }}>
        <motion.div animate={{ width:`${((step+1)/OB_STEPS.length)*100}%` }}
          transition={{ duration:0.35 }}
          style={{ height:"100%", borderRadius:3, background:`linear-gradient(90deg,${C.accent},#A855F7)` }} />
      </div>
      <div style={{ position:"relative", zIndex:1, padding:"20px 20px 10px", display:"flex", alignItems:"center", gap:14 }}>
        <div style={{ width:44, height:44, borderRadius:14, background:"rgba(139,92,246,0.15)",
          border:"1px solid rgba(139,92,246,0.3)", display:"flex", alignItems:"center", justifyContent:"center" }}>
          {(() => { const I = OB_STEPS[step].Icon; return <I size={20} color={C.accentHi} />; })()}
        </div>
        <p style={{ color:C.text1, fontWeight:800, fontSize:22, lineHeight:1.2 }}>{OB_STEPS[step].title}</p>
      </div>
      <div style={{ position:"relative", zIndex:1, flex:1, padding:"4px 20px 20px", overflowY:"auto" }}>
        <AnimatePresence mode="wait">{stepContent[step]}</AnimatePresence>
      </div>
      {step < 2 && (
        <div style={{ position:"relative", zIndex:1, padding:"12px 20px 32px", display:"flex", gap:10 }}>
          {step > 0 && (
            <button onClick={() => setStep(s => s-1)}
              style={{ padding:"13px 16px", borderRadius:12, background:C.card, border:`1px solid ${C.border}`, color:C.text2, cursor:"pointer", display:"flex", alignItems:"center" }}>
              <ArrowLeft size={16} />
            </button>
          )}
          <button onClick={() => step < 2 ? setStep(s => s+1) : undefined}
            disabled={!canContinue}
            style={{ flex:1, padding:"14px 20px", borderRadius:14, border:"none",
              background: canContinue ? `linear-gradient(135deg,${C.accent} 0%,#A855F7 100%)` : C.cardHi,
              color: canContinue ? "#fff" : C.text3,
              cursor: canContinue ? "pointer" : "not-allowed",
              display:"flex", alignItems:"center", justifyContent:"center", gap:8,
              fontSize:15, fontWeight:700,
              boxShadow: canContinue ? `0 4px 20px rgba(139,92,246,0.35)` : "none" }}>
            Continue <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ACTION MAP
// ─────────────────────────────────────────────────────────────────────────────
const ACTION_MAP: Record<string, { label: string; Icon: React.ElementType }> = {
  cast:                  { label:"Cast",          Icon:Edit3       },
  recast:                { label:"Recast",        Icon:RefreshCw   },
  like:                  { label:"Like",          Icon:Heart       },
  follow:                { label:"Follow",        Icon:Users       },
  market_buy:            { label:"Buy FID",       Icon:ShoppingBag },
  market_list:           { label:"List FID",      Icon:Tag         },
  referral:              { label:"Referral",      Icon:Share2      },
  referral_welcome:      { label:"Welcome bonus", Icon:Share2      },
  quest:                 { label:"Quest",         Icon:Sword       },
  grow_campaign_complete:{ label:"Grow Campaign", Icon:Sprout      },
  promotion:             { label:"Promotion",     Icon:Zap         },
  gift_received:         { label:"Gift received", Icon:Gift        },
  gift:                  { label:"Gift sent",     Icon:Gift        },
  streak_bonus:          { label:"Streak bonus",  Icon:Star        },
};

// ─────────────────────────────────────────────────────────────────────────────
// HOME TAB
// ─────────────────────────────────────────────────────────────────────────────
function HomeTab({ fid, ctx, pts, stats, rank, board, statsLoading, ptsLoading, allowance, allowanceLoading }: {
  fid: number; ctx: MiniCtx | null;
  pts: FidPts | null; stats: StatsData | null;
  rank: number | null; board: LBRow[]; statsLoading: boolean; ptsLoading: boolean;
  allowance: AllowanceData | null; allowanceLoading: boolean;
}) {
  const username    = ctx?.user?.username ?? `fid${fid}`;
  const displayName = ctx?.user?.displayName ?? username;
  const pfpUrl      = ctx?.user?.pfpUrl ?? null;
  const totalPoints = pts?.total_points ?? 0;
  const todayPts    = stats?.todayPoints ?? 0;
  const streak      = stats?.streak ?? 0;
  const level       = stats?.level ?? 0;
  const xp          = stats?.xp ?? 0;
  const xpToNext    = stats?.xpToNext ?? 500;
  const missions    = stats?.missions ?? [];
  const referrals   = pts?.breakdown.find(b => b.action_type === "referral")?.total_actions ?? 0;
  const completed   = pts?.breakdown.reduce((s,b) => s + b.total_actions, 0) ?? 0;
  const achievements= stats?.achievements ?? [];
  const unlockedCount = achievements.filter(a => a.unlocked).length;

  // Midnight UTC countdown
  const midnightMs = (() => {
    const d = new Date(); d.setUTCDate(d.getUTCDate()+1); d.setUTCHours(0,0,0,0); return d.getTime();
  })();
  const resetCountdown = useCountdown(midnightMs);

  // XP percent
  const xpPct = xpToNext > 0 ? Math.min((xp / xpToNext) * 100, 100) : 100;

  // Streak day-chain: up to 3 recent check-ins, today (highlighted), then 2 upcoming
  const nextBonusPts = stats?.nextStreakBonusPts ?? 500;
  const doneCount = Math.max(0, Math.min(streak - 1, 3));
  const chainDays: { kind: "done" | "now" | "future" }[] = [
    ...Array.from({ length: 3 }, (_, i) => ({ kind: (i >= 3 - doneCount ? "done" : "future") as "done" | "future" })),
    { kind: "now" as const },
    { kind: "future" as const }, { kind: "future" as const },
  ];

  return (
    <motion.div key="home-tab" {...slideUp} style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* ── Profile row ── */}
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{ position:"relative", flexShrink:0 }}>
          {pfpUrl
            ? <img src={pfpUrl} alt="" style={{ width:48, height:48, borderRadius:"50%",
                border:`2px solid rgba(139,92,246,0.6)` }} />
            : <div style={{ width:48, height:48, borderRadius:"50%",
                background:`linear-gradient(135deg,${C.accent},#A855F7)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:18, fontWeight:900, color:"#fff", border:`2px solid rgba(139,92,246,0.5)` }}>
                {username.slice(0,2).toUpperCase()}
              </div>
          }
          {/* Level badge */}
          <div style={{ position:"absolute", bottom:-4, right:-4, width:20, height:20, borderRadius:"50%",
            background:`linear-gradient(135deg,${C.accent},#A855F7)`,
            border:`2px solid ${C.bg}`, display:"flex", alignItems:"center", justifyContent:"center",
            fontSize:9, fontWeight:900, color:"#fff" }}>
            {level}
          </div>
        </div>

        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
            <p style={{ color:C.text1, fontWeight:700, fontSize:15, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{displayName}</p>
            {rank && (
              <Chip color={C.amber} bg="rgba(245,158,11,0.15)" border="rgba(245,158,11,0.35)">
                <Trophy size={10} /> #{rank}
              </Chip>
            )}
          </div>
          {/* XP bar */}
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <p style={{ color:C.text3, fontSize:10, whiteSpace:"nowrap" }}>Lv{level}</p>
            <div style={{ flex:1, height:5, background:C.border, borderRadius:3 }}>
              <motion.div initial={{ width:0 }} animate={{ width:`${xpPct}%` }}
                transition={{ duration:0.8, delay:0.2 }}
                style={{ height:"100%", borderRadius:3, background:`linear-gradient(90deg,${C.accent},#A855F7)` }} />
            </div>
            <p style={{ color:C.text3, fontSize:10, whiteSpace:"nowrap" }}>{xp}/{xpToNext}</p>
          </div>
        </div>
      </div>

      {/* ── Total Points hero card ── */}
      <Card glow style={{ padding:"20px 20px 18px", overflow:"visible" }}>
        {/* Deep purple radial glow background */}
        <div style={{ position:"absolute", inset:0, borderRadius:20, pointerEvents:"none",
          background:"radial-gradient(ellipse at 70% 50%, rgba(139,92,246,0.35) 0%, rgba(109,40,217,0.15) 40%, transparent 70%)" }} />
        {/* Bottom glow pulse */}
        <motion.div animate={{ opacity:[0.4,0.8,0.4] }} transition={{ duration:3, repeat:Infinity }}
          style={{ position:"absolute", bottom:-20, left:"30%", right:"10%", height:60, pointerEvents:"none",
            background:"radial-gradient(ellipse, rgba(139,92,246,0.5) 0%, transparent 70%)", filter:"blur(18px)" }} />

        <div style={{ position:"relative", display:"flex", alignItems:"center", gap:8 }}>
          {/* Points info — left side */}
          <div style={{ flex:1, minWidth:0 }}>
            <p style={{ color:"rgba(196,181,253,0.7)", fontSize:11, fontWeight:700,
              letterSpacing:"0.14em", textTransform:"uppercase", marginBottom:6 }}>Total Points</p>
            {ptsLoading
              ? <Loader2 size={28} className="animate-spin" style={{ color:C.accentHi, margin:"10px 0" }} />
              : <div style={{ fontSize:52, fontWeight:900, letterSpacing:"-0.03em", lineHeight:1,
                  background:"linear-gradient(135deg,#FFFFFF 0%,#DDD6FE 40%,#A78BFA 100%)",
                  WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", marginBottom:10 }}>
                  <Counter to={totalPoints} />
                </div>
            }
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              {todayPts > 0 && (
                <Chip color={C.green} bg="rgba(16,185,129,0.15)" border="rgba(16,185,129,0.35)">
                  ✓ +{todayPts} today
                </Chip>
              )}
              {rank && (
                <Chip color={C.amber} bg="rgba(245,158,11,0.15)" border="rgba(245,158,11,0.35)">
                  <Trophy size={10} /> Global #{rank}
                </Chip>
              )}
            </div>
          </div>

          {/* Floating logo orb — right side, big */}
          <div style={{ position:"relative", width:110, height:110, flexShrink:0 }}>
            <HeroLogoOrb size={110} />
          </div>
        </div>
      </Card>

      {/* ── Stats row ── */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr", gap:8 }}>
        {[
          { label:"Day Streak", sub: streak > 0 ? "Keep it up!" : "Start now", value:streak, icon:"🔥", color:C.fire2, glowing: streak > 0 },
          { label:"Completed", sub:"Tasks", value:completed, icon:"⚡", color:C.accentHi, glowing:false },
          { label:"Achvmts", sub:`${unlockedCount} Unlocked`, value:unlockedCount, icon:"🏅", color:C.amber, glowing:false },
          { label:"Referrals", sub:"Friends", value:referrals, icon:"👥", color:C.green, glowing:false },
        ].map(s => (
          <div key={s.label} style={{
            background: s.glowing ? "rgba(255,100,0,0.08)" : C.card,
            border: `1px solid ${s.glowing ? "rgba(255,100,0,0.3)" : C.border}`,
            borderRadius:14, padding:"10px 6px 8px", textAlign:"center",
            boxShadow: s.glowing ? "0 0 16px rgba(255,100,0,0.15)" : "none",
          }}>
            <div style={{ fontSize:16, marginBottom:3 }}>{s.icon}</div>
            <div style={{ color:s.color, fontWeight:900, fontSize:18, lineHeight:1 }}>{s.value}</div>
            <div style={{ color:C.text3, fontSize:9, marginTop:3, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.04em" }}>{s.label}</div>
            <div style={{ color:"rgba(255,255,255,0.2)", fontSize:9, marginTop:1 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Streak card (with fire ring) ── */}
      {streak > 0 && (
        <Card style={{ padding:"20px", background:"rgba(255,69,0,0.06)", border:"1px solid rgba(255,100,0,0.25)" }}>
          <div style={{ display:"flex", alignItems:"center", gap:16 }}>
            {/* Fire ring around streak number */}
            <div style={{ position:"relative", width:140, height:140, flexShrink:0 }}>
              <FireRing radius={60} size={140} active={true} />
              {/* Streak number in center */}
              <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column",
                alignItems:"center", justifyContent:"center" }}>
                <span style={{ fontSize:38, fontWeight:900, lineHeight:1,
                  background:`linear-gradient(135deg,${C.fire3},${C.fire2})`,
                  WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent" }}>
                  {streak}
                </span>
                <span style={{ color:"rgba(255,150,0,0.8)", fontSize:11, fontWeight:700 }}>days</span>
              </div>
            </div>

            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8 }}>
                <div>
                  <p style={{ color:"#FF8C00", fontWeight:800, fontSize:16, marginBottom:4 }}>You're on fire! 🔥</p>
                  <p style={{ color:C.text2, fontSize:12, lineHeight:1.5 }}>
                    Keep your streak alive and earn bigger bonuses.
                  </p>
                </div>
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <p style={{ color:"rgba(255,150,0,0.75)", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.06em" }}>Next Bonus</p>
                  <p style={{ color:"#FFD700", fontWeight:900, fontSize:16, marginTop:2 }}>+{nextBonusPts}</p>
                </div>
              </div>
              {/* Day chain: recent check-ins → today (highlighted) → upcoming */}
              <div style={{ display:"flex", alignItems:"center", gap:4, marginTop:12, marginBottom:10 }}>
                {chainDays.map((d, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", flex: d.kind === "now" ? "0 0 auto" : 1 }}>
                    {i > 0 && (
                      <div style={{ flex:1, height:2, minWidth:4,
                        background: d.kind === "future" && chainDays[i-1].kind === "future"
                          ? "rgba(255,255,255,0.08)" : "linear-gradient(90deg,#7C3AED,#FF8C00)" }} />
                    )}
                    {d.kind === "now" ? (
                      <div style={{ width:34, height:34, borderRadius:"50%", flexShrink:0,
                        background:"radial-gradient(circle at 50% 60%,#2A1420,#190D22 70%)",
                        border:"2px solid #FB923C", color:"#fff", fontSize:12, fontWeight:800,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        boxShadow:"0 0 14px rgba(251,146,60,0.75)" }}>
                        {streak}
                      </div>
                    ) : (
                      <div style={{ width:20, height:20, borderRadius:"50%", flexShrink:0,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        background: d.kind === "done" ? `linear-gradient(135deg,${C.fire2},${C.fire1})` : "rgba(255,255,255,0.06)",
                        border: `1px solid ${d.kind === "done" ? "rgba(255,100,0,0.5)" : C.border}` }}>
                        {d.kind === "done" && <Check size={10} color="#fff" />}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {stats?.streakBonusAwarded && (
                <Chip color="#FFD700" bg="rgba(255,215,0,0.12)" border="rgba(255,215,0,0.35)">
                  🎉 +{nextBonusPts} streak bonus credited!
                </Chip>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ── Top Players podium ── */}
      {board.length >= 3 && (
        <div>
          <SectionLabel>Top Players</SectionLabel>
          <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
            {[board[1], board[0], board[2]].map((r, i) => {
              const isFirst = i === 1;
              const medal = isFirst ? "🥇" : i === 0 ? "🥈" : "🥉";
              const ringColor = isFirst ? C.amber : i === 0 ? "#94A3B8" : "#F87171";
              return (
                <div key={r.fid} style={{ flex:1, textAlign:"center",
                  background: isFirst ? "rgba(245,158,11,0.08)" : C.card,
                  border:`1px solid ${isFirst ? "rgba(245,158,11,0.3)" : C.border}`,
                  borderRadius:16, padding: isFirst ? "18px 8px 12px" : "14px 8px 10px",
                  position:"relative", marginBottom: isFirst ? 0 : 8 }}>
                  <div style={{ position:"absolute", top:-12, left:"50%", transform:"translateX(-50%)", fontSize:18 }}>{medal}</div>
                  {r.pfpUrl
                    ? <img src={r.pfpUrl} alt="" style={{ width: isFirst?52:42, height: isFirst?52:42, borderRadius:"50%",
                        border:`2px solid ${ringColor}`, margin:"6px auto 8px", display:"block" }} />
                    : <div style={{ width: isFirst?52:42, height: isFirst?52:42, borderRadius:"50%", margin:"6px auto 8px",
                        background:`linear-gradient(135deg,${C.accent},#A855F7)`, border:`2px solid ${ringColor}`,
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:14, fontWeight:800, color:"#fff" }}>
                        {r.username.slice(0,2).toUpperCase()}
                      </div>
                  }
                  <p style={{ color:C.text1, fontSize:12.5, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{r.username}</p>
                  <p style={{ color: isFirst ? C.amber : C.text3, fontSize:11, fontWeight:600, marginTop:2 }}>{r.total_points.toLocaleString()} pts</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Daily Missions ── */}
      {missions.length > 0 && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <SectionLabel>Daily Missions</SectionLabel>
            <span style={{ color:C.text3, fontSize:11 }}>Resets {resetCountdown}</span>
          </div>
          <Card>
            {missions.map((m, i) => {
              const pct = m.target > 0 ? Math.min((m.count / m.target) * 100, 100) : 0;
              return (
                <div key={m.id}>
                  <div style={{ padding:"12px 14px" }}>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {m.done
                          ? <div style={{ width:18, height:18, borderRadius:"50%", background:C.green, display:"flex", alignItems:"center", justifyContent:"center" }}>
                              <Check size={11} color="#fff" />
                            </div>
                          : <div style={{ width:18, height:18, borderRadius:"50%", border:`2px solid ${C.border}` }} />
                        }
                        <span style={{ color: m.done ? C.text2 : C.text1, fontSize:13, textDecoration: m.done ? "line-through" : "none" }}>
                          {m.label}
                        </span>
                      </div>
                      <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                        <span style={{ color:C.text3, fontSize:11 }}>{m.count}/{m.target}</span>
                        <Chip>+{m.pts} pts</Chip>
                      </div>
                    </div>
                    <div style={{ height:4, background:C.border, borderRadius:2 }}>
                      <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }}
                        transition={{ duration:0.6, delay:i*0.08 }}
                        style={{ height:"100%", borderRadius:2,
                          background: m.done ? `linear-gradient(90deg,${C.green},#34D399)` : `linear-gradient(90deg,${C.accent},#A855F7)` }} />
                    </div>
                  </div>
                  {i < missions.length - 1 && <div style={{ height:1, background:C.border, margin:"0 14px" }} />}
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* ── Daily Allowance ── */}
      <div>
        <SectionLabel>Daily Cap</SectionLabel>
        {allowanceLoading
          ? <Card style={{ padding:"14px 16px" }}><Loader2 size={14} className="animate-spin" style={{ color:C.text3 }} /></Card>
          : allowance
            ? (() => {
                const pct = allowance.total > 0 ? Math.max(0, (allowance.remaining / allowance.total) * 100) : 0;
                const barColor = pct > 30
                  ? `linear-gradient(90deg,${C.accent},#A855F7)`
                  : pct > 10
                  ? `linear-gradient(90deg,${C.amber},#F97316)`
                  : `linear-gradient(90deg,${C.rose},#FB7185)`;
                const ringColor = pct > 30 ? C.accentHi : pct > 10 ? C.amber : C.rose;
                return (
                  <Card glow style={{ padding:"14px 16px", display:"flex", alignItems:"center", gap:14 }}>
                    <div style={{ width:44, height:44, borderRadius:14, flexShrink:0,
                      background:"linear-gradient(145deg,rgba(139,92,246,0.35),rgba(88,28,135,0.3))",
                      border:"1.5px solid rgba(168,85,247,0.6)",
                      display:"flex", alignItems:"center", justifyContent:"center" }}>
                      <Zap size={20} color={C.accentHi} />
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <p style={{ color:C.text1, fontSize:13, fontWeight:700 }}>Daily Allowance</p>
                      <p style={{ color:C.text1, fontSize:20, fontWeight:900, marginTop:2 }}>
                        {allowance.remaining.toLocaleString()} <span style={{ fontSize:12, fontWeight:600, color:C.text3 }}>/ {allowance.total.toLocaleString()}</span>
                      </p>
                      <p style={{ color:C.text3, fontSize:11, marginTop:2 }}>
                        {allowance.used > 0 ? `${allowance.used.toLocaleString()} pts used today` : "Available to earn today"}
                      </p>
                    </div>
                    <div style={{ position:"relative", width:56, height:56, flexShrink:0 }}>
                      <ProgressRing pct={pct} size={56} stroke={6} color={ringColor} />
                      <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <span style={{ color:ringColor, fontSize:12, fontWeight:800 }}>{Math.round(pct)}%</span>
                      </div>
                    </div>
                  </Card>
                );
              })()
            : null
        }
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LEADERBOARD TAB
// ─────────────────────────────────────────────────────────────────────────────
function LeaderboardTab({ fid, board, loading }: { fid: number; board: LBRow[]; loading: boolean }) {
  const [tab, setTab] = useState<"global"|"nearby">("global");

  // Season end countdown (configurable)
  const seasonEnd = new Date("2025-12-31T00:00:00Z").getTime();
  const seasonCountdown = useCountdown(seasonEnd);

  if (loading) return (
    <motion.div key="lb-load" {...slideUp} style={{ padding:48, display:"flex", justifyContent:"center" }}>
      <Loader2 size={20} className="animate-spin" style={{ color:C.text3 }} />
    </motion.div>
  );
  if (!board.length) return (
    <motion.div key="lb-empty" {...slideUp} style={{ padding:"48px 20px", textAlign:"center" }}>
      <Trophy size={40} color={C.text3} style={{ marginBottom:12 }} />
      <p style={{ color:C.text3, fontSize:14 }}>No data yet. Start earning on fidcaster.xyz</p>
    </motion.div>
  );

  const top3 = board.slice(0, 3);
  const rest  = board.slice(3);
  const myRow = board.find(r => r.fid === fid);

  const podiumOrder = [top3[1], top3[0], top3[2]].filter(Boolean); // 2nd, 1st, 3rd
  const podiumHeights = [90, 120, 72];
  const podiumRanks   = [2, 1, 3];
  const CROWN_COLOR   = ["#C0C0C0", "#FFD700", "#CD7F32"];

  return (
    <motion.div key="lb-tab" {...slideUp} style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* Season countdown */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"10px 14px", background:C.card, borderRadius:14, border:`1px solid ${C.border}` }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <Award size={16} color={C.amber} />
          <span style={{ color:C.text2, fontSize:13, fontWeight:600 }}>Season ends</span>
        </div>
        <span style={{ color:C.amber, fontWeight:700, fontSize:13, fontFamily:"monospace" }}>
          {seasonCountdown}
        </span>
      </div>

      {/* Global / Nearby tabs */}
      <div style={{ display:"flex", background:C.card, borderRadius:12, padding:3, border:`1px solid ${C.border}` }}>
        {(["global","nearby"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ flex:1, padding:"8px", borderRadius:10, border:"none", cursor:"pointer",
              background: tab===t ? `linear-gradient(135deg,${C.accent},#A855F7)` : "transparent",
              color: tab===t ? "#fff" : C.text3,
              fontSize:13, fontWeight:700, transition:"all 0.2s",
              boxShadow: tab===t ? `0 4px 12px rgba(139,92,246,0.4)` : "none" }}>
            {t === "global" ? "🌍 Global" : "👥 Nearby"}
          </button>
        ))}
      </div>

      {/* Top 3 Podium */}
      <Card style={{ padding:"20px 16px 16px" }}>
        <p style={{ color:C.text3, fontSize:10, fontWeight:800, letterSpacing:"0.12em",
          textTransform:"uppercase", marginBottom:16, textAlign:"center" }}>Top Earners</p>
        <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"center", gap:12 }}>
          {podiumOrder.map((row, podiumIdx) => {
            if (!row) return <div key={podiumIdx} style={{ width:90 }} />;
            const rank   = podiumRanks[podiumIdx];
            const height = podiumHeights[podiumIdx];
            const isMe   = row.fid === fid;
            const isFirst = rank === 1;
            return (
              <motion.div key={row.fid}
                initial={{ opacity:0, y:30 }} animate={{ opacity:1, y:0 }}
                transition={{ delay: podiumIdx * 0.12, duration:0.4 }}
                style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:6 }}>
                {/* Crown for #1 */}
                {isFirst && <div style={{ fontSize:22 }}>👑</div>}
                {/* Avatar */}
                <div style={{ position:"relative" }}>
                  {row.pfpUrl
                    ? <img src={row.pfpUrl} alt="" style={{ width:isFirst?52:44, height:isFirst?52:44,
                        borderRadius:"50%", border:`2.5px solid ${isFirst?C.amber:isMe?C.accentHi:C.border}`,
                        boxShadow: isFirst ? `0 0 20px rgba(255,215,0,0.5)` : isMe ? `0 0 14px rgba(139,92,246,0.5)` : "none" }} />
                    : <div style={{ width:isFirst?52:44, height:isFirst?52:44, borderRadius:"50%",
                        background:`linear-gradient(135deg,${C.accent},#A855F7)`,
                        border:`2.5px solid ${isFirst?C.amber:isMe?C.accentHi:C.border}`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:isFirst?18:14, fontWeight:900, color:"#fff",
                        boxShadow: isFirst ? `0 0 20px rgba(255,215,0,0.5)` : "none" }}>
                        {(row.username||"").slice(0,2).toUpperCase() || "??"}
                      </div>
                  }
                  {/* Rank badge */}
                  <div style={{ position:"absolute", bottom:-4, left:"50%", transform:"translateX(-50%)",
                    background:`linear-gradient(135deg,${CROWN_COLOR[rank-1]},${rank===1?"#FFA500":"rgba(0,0,0,0.5)"})`,
                    borderRadius:999, padding:"1px 7px", fontSize:10, fontWeight:800, color: rank===1?"#000":"#fff",
                    border:`1px solid ${C.bg}`, whiteSpace:"nowrap" }}>
                    #{rank}
                  </div>
                </div>
                {/* Podium block */}
                <div style={{ width:80, height, borderRadius:"10px 10px 0 0",
                  background: isFirst
                    ? "linear-gradient(180deg,rgba(255,215,0,0.25),rgba(255,165,0,0.1))"
                    : rank===2
                    ? "linear-gradient(180deg,rgba(192,192,192,0.2),rgba(150,150,150,0.08))"
                    : "linear-gradient(180deg,rgba(205,127,50,0.18),rgba(160,100,40,0.07))",
                  border: `1px solid ${isFirst?"rgba(255,215,0,0.3)":rank===2?"rgba(192,192,192,0.25)":"rgba(205,127,50,0.2)"}`,
                  display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end", padding:"0 0 8px" }}>
                  <p style={{ color:C.text1, fontSize:11, fontWeight:700, textAlign:"center",
                    overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:72 }}>
                    {row.username || `fid${row.fid}`}
                  </p>
                  <p style={{ color: isFirst?C.amber:C.text3, fontSize:10, fontWeight:800 }}>
                    {row.total_points.toLocaleString()}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </Card>

      {/* My rank highlight */}
      {myRow && myRow.rank > 3 && (
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"12px 14px",
          background:"rgba(139,92,246,0.12)", border:"1px solid rgba(139,92,246,0.3)", borderRadius:14 }}>
          <span style={{ color:C.accentHi, fontWeight:800, fontSize:14, minWidth:28 }}>#{myRow.rank}</span>
          {myRow.pfpUrl
            ? <img src={myRow.pfpUrl} alt="" style={{ width:32, height:32, borderRadius:"50%" }} />
            : <div style={{ width:32, height:32, borderRadius:"50%", background:`linear-gradient(135deg,${C.accent},#A855F7)`,
                display:"flex", alignItems:"center", justifyContent:"center", fontSize:12, fontWeight:800, color:"#fff" }}>
                {(myRow.username||"").slice(0,2).toUpperCase()||"??"}
              </div>
          }
          <div style={{ flex:1 }}>
            <p style={{ color:C.accentHi, fontSize:13, fontWeight:700 }}>@{myRow.username} (you)</p>
            <p style={{ color:C.text3, fontSize:11 }}>{myRow.total_points.toLocaleString()} pts</p>
          </div>
        </div>
      )}

      {/* Ranked list */}
      {rest.length > 0 && (
        <Card>
          {rest.map((row, i) => {
            const isMe = row.fid === fid;
            return (
              <div key={row.fid}>
                <motion.div initial={{ opacity:0, x:-10 }} animate={{ opacity:1, x:0 }}
                  transition={{ delay:i*0.02 }}
                  style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                    background: isMe ? "rgba(139,92,246,0.10)" : "transparent" }}>
                  <span style={{ width:28, color:C.text3, fontSize:12, textAlign:"right",
                    fontVariantNumeric:"tabular-nums", flexShrink:0 }}>{row.rank}</span>
                  {row.pfpUrl
                    ? <img src={row.pfpUrl} alt="" style={{ width:30, height:30, borderRadius:"50%", flexShrink:0 }} />
                    : <div style={{ width:30, height:30, borderRadius:"50%", flexShrink:0,
                        background:`linear-gradient(135deg,rgba(139,92,246,0.3),rgba(168,85,247,0.2))`,
                        display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:C.accentHi }}>
                        {(row.username||"").slice(0,2).toUpperCase()||"??"}
                      </div>
                  }
                  <span style={{ flex:1, color:isMe?C.accentHi:C.text1, fontWeight:isMe?700:400,
                    fontSize:13, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                    @{row.username || `fid${row.fid}`}{isMe?" (you)":""}
                  </span>
                  <span style={{ color:isMe?C.accentHi:C.text2, fontSize:13,
                    fontVariantNumeric:"tabular-nums", fontWeight:isMe?700:400 }}>
                    {row.total_points.toLocaleString()}
                  </span>
                </motion.div>
                {i < rest.length - 1 && <div style={{ height:1, background:C.border, margin:"0 14px" }} />}
              </div>
            );
          })}
        </Card>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EARN TAB (Quests + Allowance)
// ─────────────────────────────────────────────────────────────────────────────
const SCORING_ROWS = [
  { Icon:Edit3,       action:"Cast",          pts:10,  cap:50   },
  { Icon:RefreshCw,   action:"Recast",        pts:3,   cap:30   },
  { Icon:Heart,       action:"Like",          pts:1,   cap:50   },
  { Icon:Users,       action:"Follow",        pts:2,   cap:50   },
  { Icon:ShoppingBag, action:"Buy FID",       pts:100, cap:300  },
  { Icon:Tag,         action:"List FID",      pts:50,  cap:250  },
  { Icon:Share2,      action:"Refer User",    pts:200, cap:2000 },
  { Icon:Sword,       action:"Quest",         pts:100, cap:500  },
  { Icon:Sprout,      action:"Grow Campaign", pts:30,  cap:150  },
  { Icon:Zap,         action:"Promote",       pts:50,  cap:500  },
  { Icon:Gift,        action:"Gift received", pts:"varies" as unknown as number, cap:500 },
];

function AllowanceBarV2({ fid }: { fid: number }) {
  const [data,    setData]    = useState<AllowanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const midnightMs = (() => { const d=new Date(); d.setUTCDate(d.getUTCDate()+1); d.setUTCHours(0,0,0,0); return d.getTime(); })();
  const countdown = useCountdown(midnightMs);

  useEffect(() => { apiAllowance(fid).then(d => { setData(d); setLoading(false); }); }, [fid]);

  if (loading) return <Card style={{ padding:"14px 16px" }}><Loader2 size={15} className="animate-spin" style={{ color:C.text3 }} /></Card>;
  if (!data) return null;

  const pct = data.total > 0 ? Math.max(0, (data.remaining / data.total) * 100) : 0;

  return (
    <Card glow>
      <div style={{ padding:"14px 16px 10px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <p style={{ color:C.text1, fontWeight:700, fontSize:14, display:"flex", alignItems:"center", gap:6 }}>
            <Zap size={14} color={C.accentHi} /> Daily Allowance
          </p>
          <span style={{ color:C.text3, fontSize:12 }}>Resets {countdown}</span>
        </div>
        <div style={{ display:"flex", alignItems:"baseline", gap:4, marginBottom:8 }}>
          <span style={{ color:C.accentHi, fontWeight:900, fontSize:22 }}>{data.remaining.toLocaleString()}</span>
          <span style={{ color:C.text3, fontSize:13 }}>/ {data.total.toLocaleString()} remaining</span>
        </div>
        <div style={{ height:6, background:C.border, borderRadius:3 }}>
          <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }} transition={{ duration:0.7 }}
            style={{ height:"100%", borderRadius:3,
              background: pct > 30 ? `linear-gradient(90deg,${C.accent},#A855F7)` : pct > 10 ? `linear-gradient(90deg,${C.amber},#F97316)` : `linear-gradient(90deg,${C.rose},#FB7185)` }} />
        </div>
        <p style={{ color:C.text3, fontSize:11, marginTop:5 }}>{data.used > 0 ? `${data.used.toLocaleString()} used` : "No allowance used today"}</p>
      </div>
      <div style={{ borderTop:`1px solid ${C.border}`, display:"grid", gridTemplateColumns:"1fr 1fr" }}>
        <a href={`https://warpcast.com/~/compose?text=${encodeURIComponent("I'm using FidCaster to earn points for every Farcaster action 🚀 @fidcaster")}`}
          target="_blank" rel="noopener noreferrer"
          style={{ display:"flex", flexDirection:"column", gap:4, padding:"12px 14px",
            textDecoration:"none", borderRight:`1px solid ${C.border}` }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <Zap size={14} color={C.accentHi} />
            <span style={{ color:C.text1, fontSize:13, fontWeight:700 }}>Promote</span>
          </div>
          <p style={{ color:C.text3, fontSize:11, lineHeight:1.5 }}>
            Earn <strong style={{ color:C.accentHi }}>+50 pts</strong> per cast
          </p>
          <span style={{ color:C.amber, fontSize:11 }}>−50 allowance</span>
        </a>
        <div style={{ display:"flex", flexDirection:"column", gap:4, padding:"12px 14px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:6 }}>
            <Gift size={14} color={C.green} />
            <span style={{ color:C.text1, fontSize:13, fontWeight:700 }}>Gift Points</span>
          </div>
          <p style={{ color:C.text3, fontSize:11, lineHeight:1.5 }}>
            Cast: <span style={{ color:C.accentHi, fontFamily:"monospace", fontSize:10 }}>"{"{N}"} FidCaster points @user"</span>
          </p>
          <span style={{ color:C.amber, fontSize:11 }}>−N allowance</span>
        </div>
      </div>
    </Card>
  );
}

function EarnTab({ fid, pts, loading }: { fid: number; pts: FidPts | null; loading: boolean }) {
  const [filter, setFilter] = useState<"all"|"social"|"market"|"referral">("all");
  const total = pts?.total_points ?? 0;

  const filters = [
    { id:"all", label:"All" }, { id:"social", label:"Social" },
    { id:"market", label:"Market" }, { id:"referral", label:"Referral" },
  ] as const;

  const filtered = SCORING_ROWS.filter(r => {
    if (filter === "all") return true;
    if (filter === "social") return ["Cast","Recast","Like","Follow"].includes(r.action);
    if (filter === "market") return ["Buy FID","List FID"].includes(r.action);
    if (filter === "referral") return ["Refer User","Quest","Grow Campaign","Promote"].includes(r.action);
    return true;
  });

  return (
    <motion.div key="earn-tab" {...slideUp} style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <AllowanceBarV2 fid={fid} />

      <div>
        <SectionLabel>Quests & Actions</SectionLabel>
        {/* Filter tabs */}
        <div style={{ display:"flex", gap:6, marginBottom:12, overflowX:"auto", paddingBottom:2 }}>
          {filters.map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              style={{ padding:"6px 14px", borderRadius:999, border:`1px solid ${filter===f.id?C.accent:C.border}`,
                background: filter===f.id ? `rgba(139,92,246,0.2)` : "transparent",
                color: filter===f.id ? C.accentHi : C.text3,
                fontSize:12, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap",
                transition:"all 0.15s" }}>
              {f.label}
            </button>
          ))}
        </div>

        <Card>
          {filtered.map((row, i) => {
            const earnedRow = pts?.breakdown.find(b => b.action_type === row.action.toLowerCase().replace(/ /g,"_"));
            const earned = earnedRow?.points_earned ?? 0;
            const pct = row.cap > 0 ? Math.min((earned / row.cap) * 100, 100) : 0;
            return (
              <div key={row.action}>
                <div style={{ padding:"11px 14px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                      <div style={{ width:32, height:32, borderRadius:10, background:"rgba(139,92,246,0.12)",
                        border:`1px solid rgba(139,92,246,0.2)`, display:"flex", alignItems:"center", justifyContent:"center" }}>
                        <row.Icon size={14} color={C.accentHi} />
                      </div>
                      <span style={{ color:C.text1, fontSize:13 }}>{row.action}</span>
                    </div>
                    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                      <Chip>+{row.pts} pts</Chip>
                      <span style={{ color:C.text3, fontSize:10 }}>/{row.cap}</span>
                    </div>
                  </div>
                  {!loading && earned > 0 && (
                    <div style={{ height:3, background:C.border, borderRadius:2 }}>
                      <motion.div initial={{ width:0 }} animate={{ width:`${pct}%` }}
                        transition={{ duration:0.6, delay:i*0.04 }}
                        style={{ height:"100%", borderRadius:2, background:`linear-gradient(90deg,${C.accent},#A855F7)` }} />
                    </div>
                  )}
                </div>
                {i < filtered.length - 1 && <div style={{ height:1, background:C.border, margin:"0 14px" }} />}
              </div>
            );
          })}
        </Card>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// REWARDS TAB
// ─────────────────────────────────────────────────────────────────────────────
function RewardsTab({ fid }: { fid: number }) {
  const [copied, setCopied] = useState(false);
  const [refData, setRefData] = useState<ReferralListData>({ referredBy: null, referrals: [] });
  const [refLoad, setRefLoad] = useState(true);
  const refUrl = `https://fidcaster.xyz/?ref=${fid.toString(36).toUpperCase()}`;

  useEffect(() => {
    apiReferralList(fid).then(d => { setRefData(d); setRefLoad(false); });
  }, [fid]);

  async function copy() {
    await navigator.clipboard.writeText(refUrl).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }

  return (
    <motion.div key="rewards-tab" {...slideUp} style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* Airdrop card with floating parachute */}
      <div style={{
        padding:"28px 20px", borderRadius:20,
        background:"linear-gradient(135deg,rgba(245,158,11,0.12) 0%,rgba(124,58,237,0.08) 100%)",
        border:"1px solid rgba(245,158,11,0.25)", textAlign:"center", position:"relative", overflow:"hidden",
      }}>
        <div style={{ position:"absolute", inset:0, pointerEvents:"none",
          background:"radial-gradient(ellipse at 50% 60%,rgba(245,158,11,0.15) 0%,transparent 70%)" }} />
        {/* Floating parachute */}
        <motion.div animate={{ y:[-8,8,-8] }} transition={{ duration:3.5, repeat:Infinity, ease:"easeInOut" }}
          style={{ fontSize:56, marginBottom:14, display:"inline-block" }}>
          🪂
        </motion.div>
        <p style={{ color:C.amber, fontWeight:800, fontSize:20, marginBottom:6 }}>Airdrop Coming Soon</p>
        <p style={{ color:C.text2, fontSize:13, lineHeight:1.6, marginBottom:16 }}>
          Snapshot date not announced yet. Keep earning points now to maximize your allocation.
        </p>
        <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"center" }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:C.amber,
            animation:"pulse 2s ease-in-out infinite" }} />
          <span style={{ color:C.amber, fontSize:12, fontWeight:700 }}>Season Active</span>
        </div>
      </div>

      {/* Referral Invite card */}
      <div>
        <SectionLabel>Invite &amp; Earn</SectionLabel>
        <Card glow>
          <div style={{ padding:"16px 16px 12px" }}>
            <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
              <div style={{ fontSize:32 }}>🎁</div>
              <div>
                <p style={{ color:C.text1, fontWeight:700, fontSize:15 }}>Refer Friends</p>
                <p style={{ color:C.text2, fontSize:12, marginTop:2 }}>
                  Earn <strong style={{ color:C.amber }}>+200 pts</strong> per activated referral
                </p>
              </div>
              {!refLoad && refData.referrals.filter(r=>r.activated).length > 0 && (
                <div style={{ marginLeft:"auto", textAlign:"center" }}>
                  <p style={{ color:C.accentHi, fontSize:18, fontWeight:900 }}>{refData.referrals.filter(r=>r.activated).length}</p>
                  <p style={{ color:C.text3, fontSize:10 }}>referred</p>
                </div>
              )}
            </div>

            {/* Referral code */}
            <motion.button onClick={copy} whileTap={{ scale:0.97 }}
              style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between",
                padding:"11px 14px", background:"rgba(0,0,0,0.35)", border:`1px solid ${C.borderMed}`,
                borderRadius:12, cursor:"pointer", gap:8, marginBottom:10 }}>
              <span style={{ color:C.text2, fontSize:12, fontFamily:"monospace", overflow:"hidden",
                textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1, textAlign:"left" }}>
                {refUrl.replace("https://","")}
              </span>
              <span style={{ color:copied?C.green:C.accentHi, fontSize:12, fontWeight:700, flexShrink:0,
                display:"flex", alignItems:"center", gap:4 }}>
                {copied ? <><Check size={12} /> Copied!</> : <><Copy size={12} /> Copy</>}
              </span>
            </motion.button>

            {/* Referral list */}
            {!refLoad && refData.referrals.length > 0 && (
              <div style={{ maxHeight:180, overflowY:"auto" }}>
                <p style={{ color:C.text3, fontSize:10, fontWeight:700, textTransform:"uppercase",
                  letterSpacing:"0.08em", marginBottom:6 }}>
                  Your referrals ({refData.referrals.length})
                </p>
                {refData.referrals.map((r, i) => (
                  <div key={r.fid}>
                    <div style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 0" }}>
                      <div style={{ width:28, height:28, borderRadius:"50%",
                        background:`linear-gradient(135deg,${C.accent},#A855F7)`,
                        display:"flex", alignItems:"center", justifyContent:"center",
                        fontSize:11, fontWeight:800, color:"#fff" }}>
                        {r.fid.toString().slice(-2)}
                      </div>
                      <div style={{ flex:1 }}>
                        <p style={{ color:C.text1, fontSize:13 }}>FID {r.fid}</p>
                        <p style={{ color:C.text3, fontSize:11 }}>{timeAgo(r.created_at)}</p>
                      </div>
                      <span style={{ fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:6,
                        background: r.activated?"rgba(16,185,129,0.12)":"rgba(245,158,11,0.10)",
                        border:`1px solid ${r.activated?"rgba(16,185,129,0.25)":"rgba(245,158,11,0.22)"}`,
                        color: r.activated?C.green:C.amber }}>
                        {r.activated ? "✓ Active" : "Pending"}
                      </span>
                    </div>
                    {i < refData.referrals.length - 1 && <div style={{ height:1, background:C.border }} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Ways to earn more */}
      <div>
        <SectionLabel>Ways to Earn More</SectionLabel>
        <Card>
          {[
            { icon:"⚡", label:"Cast on Farcaster", desc:"Earn 10 pts per cast (up to 50/day)", href:"https://warpcast.com" },
            { icon:"🛒", label:"Trade FIDs", desc:"100 pts per buy, 50 pts per listing", href:"https://fidcaster.xyz/market" },
            { icon:"🚀", label:"Complete Quests", desc:"100 pts per quest action", href:"https://fidcaster.xyz" },
          ].map((row, i, arr) => (
            <div key={row.label}>
              <a href={row.href} target="_blank" rel="noopener noreferrer"
                style={{ display:"flex", alignItems:"center", gap:12, padding:"13px 14px", textDecoration:"none" }}>
                <div style={{ fontSize:24, flexShrink:0 }}>{row.icon}</div>
                <div style={{ flex:1 }}>
                  <p style={{ color:C.text1, fontSize:13, fontWeight:600 }}>{row.label}</p>
                  <p style={{ color:C.text3, fontSize:12, marginTop:2 }}>{row.desc}</p>
                </div>
                <ChevronRight size={16} color={C.text3} />
              </a>
              {i < arr.length - 1 && <div style={{ height:1, background:C.border, margin:"0 14px" }} />}
            </div>
          ))}
        </Card>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE TAB
// ─────────────────────────────────────────────────────────────────────────────
function ProfileTab({ fid, ctx, pts, stats, rank, loading }: {
  fid: number; ctx: MiniCtx | null; pts: FidPts | null;
  stats: StatsData | null; rank: number | null; loading: boolean;
}) {
  const username    = ctx?.user?.username ?? `fid${fid}`;
  const displayName = ctx?.user?.displayName ?? username;
  const pfpUrl      = ctx?.user?.pfpUrl ?? null;
  const ethAddrs    = ctx?.user?.verifiedAddresses?.eth_addresses ?? [];
  const totalPoints = pts?.total_points ?? 0;
  const level       = stats?.level ?? 0;
  const xp          = stats?.xp ?? 0;
  const xpToNext    = stats?.xpToNext ?? 500;
  const xpPct       = xpToNext > 0 ? Math.min((xp / xpToNext) * 100, 100) : 100;
  const achievements = stats?.achievements ?? [];
  const referrals   = pts?.breakdown.find(b=>b.action_type==="referral")?.total_actions ?? 0;

  return (
    <motion.div key="profile-tab" {...slideUp} style={{ display:"flex", flexDirection:"column", gap:14 }}>

      {/* Avatar + Identity */}
      <div style={{ textAlign:"center", paddingTop:8 }}>
        <div style={{ position:"relative", display:"inline-block", marginBottom:14 }}>
          {/* Pulsing glow rings */}
          <motion.div animate={{ scale:[1,1.15,1], opacity:[0.5,0.15,0.5] }}
            transition={{ duration:2.5, repeat:Infinity }}
            style={{ position:"absolute", inset:-12, borderRadius:"50%",
              background:"radial-gradient(circle,rgba(139,92,246,0.5) 0%,transparent 70%)" }} />
          <motion.div animate={{ scale:[1,1.25,1], opacity:[0.3,0.08,0.3] }}
            transition={{ duration:3.5, repeat:Infinity, delay:0.5 }}
            style={{ position:"absolute", inset:-24, borderRadius:"50%",
              background:"radial-gradient(circle,rgba(139,92,246,0.3) 0%,transparent 70%)" }} />
          {pfpUrl
            ? <img src={pfpUrl} alt="" style={{ width:80, height:80, borderRadius:"50%",
                border:`3px solid rgba(139,92,246,0.7)`, position:"relative", zIndex:1 }} />
            : <div style={{ width:80, height:80, borderRadius:"50%", position:"relative", zIndex:1,
                background:`linear-gradient(135deg,${C.accent},#A855F7)`,
                border:`3px solid rgba(139,92,246,0.7)`,
                display:"flex", alignItems:"center", justifyContent:"center",
                fontSize:28, fontWeight:900, color:"#fff" }}>
                {username.slice(0,2).toUpperCase()}
              </div>
          }
        </div>
        <p style={{ color:C.text1, fontWeight:800, fontSize:20, marginBottom:4 }}>{displayName}</p>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:8, flexWrap:"wrap" }}>
          <Chip>@{username}</Chip>
          <Chip color={C.text3} bg="transparent" border={C.border}>FID {fid}</Chip>
          <Chip color={C.amber} bg="rgba(245,158,11,0.1)" border="rgba(245,158,11,0.3)">
            Lv {level}
          </Chip>
        </div>
      </div>

      {/* Level progress */}
      <Card style={{ padding:"14px 16px" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
          <p style={{ color:C.text1, fontWeight:700, fontSize:13 }}>Level {level} → {level+1}</p>
          <span style={{ color:C.text3, fontSize:12 }}>{xp.toLocaleString()} / {xpToNext.toLocaleString()} XP</span>
        </div>
        <div style={{ height:8, background:C.border, borderRadius:4 }}>
          <motion.div initial={{ width:0 }} animate={{ width:`${xpPct}%` }} transition={{ duration:0.9 }}
            style={{ height:"100%", borderRadius:4, background:`linear-gradient(90deg,${C.accent},#A855F7)`,
              boxShadow:`0 0 10px rgba(139,92,246,0.5)` }} />
        </div>
      </Card>

      {/* Stats trio */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
        {[
          { label:"Points",    value:loading?"…":totalPoints.toLocaleString(), Icon:Zap,    color:C.accentHi },
          { label:"Rank",      value:loading?"…":rank?`#${rank}`:"N/A",        Icon:Trophy, color:C.amber    },
          { label:"Referrals", value:loading?"…":referrals.toString(),          Icon:Users,  color:C.green    },
        ].map(s => (
          <div key={s.label} style={{ background:C.card, border:`1px solid ${C.border}`,
            borderRadius:14, padding:"14px 8px", textAlign:"center" }}>
            <s.Icon size={16} color={s.color} style={{ marginBottom:6 }} />
            <p style={{ color:C.text1, fontWeight:900, fontSize:18 }}>{s.value}</p>
            <p style={{ color:C.text3, fontSize:11, marginTop:2 }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* NFT Pass */}
      <NFTPassCard fid={fid} ethAddress={ethAddrs[0]} />

      {/* Achievements */}
      {achievements.length > 0 && (
        <div>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:8 }}>
            <SectionLabel>Achievements</SectionLabel>
            <span style={{ color:C.text3, fontSize:11 }}>
              {achievements.filter(a=>a.unlocked).length} / {achievements.length}
            </span>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:8 }}>
            {achievements.map((a, i) => (
              <motion.div key={a.id}
                initial={{ opacity:0, scale:0.85 }} animate={{ opacity:1, scale:1 }}
                transition={{ delay:i*0.06 }}
                style={{
                  background: a.unlocked ? "rgba(139,92,246,0.15)" : C.card,
                  border: `1px solid ${a.unlocked ? "rgba(139,92,246,0.4)" : C.border}`,
                  borderRadius:14, padding:"14px 8px", textAlign:"center",
                  opacity: a.unlocked ? 1 : 0.45,
                  boxShadow: a.unlocked ? `0 0 16px rgba(139,92,246,0.2)` : "none",
                }}>
                <div style={{ fontSize:24, marginBottom:6, filter: a.unlocked?"none":"grayscale(1)" }}>
                  {a.unlocked ? a.icon : <Lock size={20} color={C.text3} />}
                </div>
                <p style={{ color: a.unlocked ? C.text1 : C.text3, fontSize:11, fontWeight:600, lineHeight:1.3 }}>
                  {a.label}
                </p>
                {a.unlocked && (
                  <div style={{ marginTop:4 }}>
                    <Check size={10} color={C.green} />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Wallet addresses */}
      {ethAddrs.length > 0 && (
        <Card>
          <p style={{ color:C.text3, fontSize:10, fontWeight:800, textTransform:"uppercase",
            letterSpacing:"0.1em", padding:"12px 14px 4px", display:"flex", alignItems:"center", gap:5 }}>
            <Wallet size={10} /> Verified Wallets
          </p>
          {ethAddrs.map((addr, i) => (
            <div key={addr}>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px" }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:C.green }} />
                <span style={{ color:C.text1, fontSize:12, fontFamily:"monospace", flex:1,
                  overflow:"hidden", textOverflow:"ellipsis" }}>{addr}</span>
                <a href={`https://basescan.org/address/${addr}`} target="_blank" rel="noopener noreferrer"
                  style={{ color:C.text3, display:"flex" }}><ExternalLink size={12} /></a>
              </div>
              {i < ethAddrs.length - 1 && <div style={{ height:1, background:C.border, margin:"0 14px" }} />}
            </div>
          ))}
        </Card>
      )}

      {/* Airdrop eligibility */}
      <motion.div animate={{ y:[-2,2,-2] }} transition={{ duration:4, repeat:Infinity, ease:"easeInOut" }}>
        <div style={{ display:"flex", alignItems:"center", gap:12, padding:"16px",
          background:"linear-gradient(135deg,rgba(245,158,11,0.08),rgba(124,58,237,0.06))",
          border:"1px solid rgba(245,158,11,0.22)", borderRadius:16 }}>
          <div style={{ fontSize:32, flexShrink:0 }}>🪂</div>
          <div>
            <p style={{ color:C.text1, fontWeight:700, fontSize:14 }}>Airdrop Eligibility</p>
            <p style={{ color:C.text2, fontSize:12, marginTop:3, lineHeight:1.5 }}>
              Snapshot not announced yet. You're accumulating points — keep going!
            </p>
          </div>
          <div style={{ marginLeft:"auto", width:8, height:8, borderRadius:"50%", background:C.amber, flexShrink:0 }} />
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER DROPDOWNS — bell (real recent activity) + menu (real navigation)
// ─────────────────────────────────────────────────────────────────────────────
function useOutsideClose<T extends HTMLElement>(open: boolean, close: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) close(); }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, close]);
  return ref;
}

const dropdownWrap: React.CSSProperties = {
  position:"absolute", right:0, top:42, zIndex:60,
  background:"linear-gradient(170deg,rgba(34,21,64,0.97),rgba(15,8,30,0.98))",
  border:"1px solid rgba(168,85,247,0.35)", borderRadius:16,
  boxShadow:"0 18px 44px rgba(0,0,0,0.6)", padding:8,
};
const headerIconBtn = (open: boolean): React.CSSProperties => ({
  background: open ? "rgba(139,92,246,0.18)" : "none",
  border:`1px solid ${open ? "rgba(139,92,246,0.4)" : "transparent"}`,
  borderRadius:"50%", width:34, height:34, color:C.text3, cursor:"pointer",
  padding:0, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0,
});

function NotifBell({ fid }: { fid: number }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose<HTMLDivElement>(open, close);

  function load() {
    setFailed(false);
    apiHistory(fid).then(h => {
      if (h === null) setFailed(true); else setHistory(h);
    });
  }

  function toggle() {
    setOpen(o => {
      const next = !o;
      if (next && history === null && !failed) load();
      return next;
    });
  }

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={toggle} style={headerIconBtn(open)}><Bell size={17} /></button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity:0, y:-8, scale:0.96 }} animate={{ opacity:1, y:0, scale:1 }}
            exit={{ opacity:0, y:-8, scale:0.96 }} transition={{ duration:0.16 }}
            style={{ ...dropdownWrap, width:280, maxHeight:340, overflowY:"auto" }}>
            <p style={{ color:C.text1, fontWeight:800, fontSize:13, padding:"6px 8px 10px" }}>Recent Activity</p>
            {failed ? (
              <div style={{ padding:"10px 8px", display:"flex", flexDirection:"column", gap:8, alignItems:"flex-start" }}>
                <span style={{ color:C.text3, fontSize:12 }}>Couldn't load activity.</span>
                <button onClick={load} style={{ background:"rgba(139,92,246,0.14)", border:"1px solid rgba(139,92,246,0.28)",
                  color:C.accentHi, fontSize:11.5, fontWeight:700, borderRadius:8, padding:"5px 10px", cursor:"pointer" }}>
                  Retry
                </button>
              </div>
            ) : history === null ? (
              <div style={{ padding:"14px 8px", display:"flex", alignItems:"center", gap:8 }}>
                <Loader2 size={14} className="animate-spin" style={{ color:C.text3 }} />
                <span style={{ color:C.text3, fontSize:12 }}>Loading…</span>
              </div>
            ) : history.length === 0 ? (
              <p style={{ color:C.text3, fontSize:12, padding:"10px 8px" }}>No activity yet — go earn some points!</p>
            ) : history.slice(0, 8).map(h => {
              const meta = ACTION_MAP[h.action_type] ?? { label: h.action_type, Icon: Zap };
              return (
                <div key={h.id} style={{ display:"flex", alignItems:"center", gap:10, padding:8, borderRadius:10 }}>
                  <div style={{ width:30, height:30, borderRadius:10, background:"rgba(139,92,246,0.14)",
                    border:"1px solid rgba(139,92,246,0.28)", display:"flex", alignItems:"center",
                    justifyContent:"center", flexShrink:0 }}>
                    <meta.Icon size={13} color={C.accentHi} />
                  </div>
                  <div style={{ flex:1, minWidth:0 }}>
                    <p style={{ color:C.text1, fontSize:12.5 }}>{meta.label} <span style={{ color:C.green, fontWeight:700 }}>+{h.pts}</span></p>
                    <p style={{ color:C.text3, fontSize:10.5 }}>{timeAgo(h.created_at)}</p>
                  </div>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuButton({ onNav }: { onNav: (t: AppTab) => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutsideClose<HTMLDivElement>(open, close);

  const items: { label: string; Icon: React.ElementType; onClick?: () => void; href?: string }[] = [
    { label:"Quests & Actions", Icon:Zap, onClick: () => { onNav("earn"); setOpen(false); } },
    { label:"FID Market", Icon:ShoppingBag, href:"https://fidcaster.xyz/market" },
    { label:"Docs", Icon:LayoutList, href:"https://fidcaster.xyz/docs" },
  ];

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(o => !o)} style={headerIconBtn(open)}><LayoutList size={16} /></button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity:0, y:-8, scale:0.96 }} animate={{ opacity:1, y:0, scale:1 }}
            exit={{ opacity:0, y:-8, scale:0.96 }} transition={{ duration:0.16 }}
            style={{ ...dropdownWrap, width:210 }}>
            {items.map(it => it.href ? (
              <a key={it.label} href={it.href} target="_blank" rel="noopener noreferrer"
                style={{ display:"flex", alignItems:"center", gap:10, padding:10, borderRadius:10,
                  textDecoration:"none", color:C.text1, fontSize:13, fontWeight:600 }}>
                <it.Icon size={15} color={C.accentHi} /> {it.label}
              </a>
            ) : (
              <button key={it.label} onClick={it.onClick}
                style={{ display:"flex", alignItems:"center", gap:10, padding:10, borderRadius:10,
                  background:"none", border:"none", width:"100%", textAlign:"left", cursor:"pointer",
                  color:C.text1, fontSize:13, fontWeight:600 }}>
                <it.Icon size={15} color={C.accentHi} /> {it.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOTTOM NAV
// ─────────────────────────────────────────────────────────────────────────────
type AppTab = "home" | "leaderboard" | "earn" | "rewards" | "profile";

function BottomNav({ tab, onTab }: { tab: AppTab; onTab: (t: AppTab) => void }) {
  const tabs: { id: AppTab; label: string; Icon: React.ElementType }[] = [
    { id:"home",        label:"Home",       Icon:Home      },
    { id:"leaderboard", label:"Rankings",   Icon:Trophy    },
    { id:"earn",        label:"Earn",       Icon:Zap       },
    { id:"rewards",     label:"Rewards",    Icon:Gift      },
    { id:"profile",     label:"Profile",    Icon:Users     },
  ];

  return (
    <div style={{
      position:"fixed", bottom:0, left:0, right:0, zIndex:50,
      background:`rgba(11,9,16,0.92)`, backdropFilter:"blur(20px)",
      borderTop:`1px solid ${C.border}`,
      display:"flex", alignItems:"flex-end", justifyContent:"space-around",
      padding:"0 8px 16px",
      height:68,
    }}>
      {tabs.map(t => {
        const isActive = tab === t.id;
        const isEarn   = t.id === "earn";
        if (isEarn) {
          return (
            <motion.button key={t.id} onClick={() => onTab(t.id)}
              whileTap={{ scale:0.93 }}
              style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
                gap:2, cursor:"pointer", border:"none", background:"none", position:"relative", bottom:18, flexShrink:0 }}>
              {/* Hex button */}
              <motion.div
                animate={{ boxShadow: isActive
                  ? `0 0 0 4px rgba(139,92,246,0.3), 0 8px 24px rgba(139,92,246,0.6)`
                  : `0 4px 16px rgba(139,92,246,0.4)` }}
                transition={{ duration:0.3 }}
                style={{
                  width:52, height:52, borderRadius:"50%",
                  background:"radial-gradient(circle at 50% 35%,#241442,#12081F 75%)",
                  border:"1.5px solid rgba(168,85,247,0.6)",
                  display:"flex", alignItems:"center", justifyContent:"center",
                }}>
                <img src="/mini-logo.png" alt="" style={{ width:26, height:26, objectFit:"contain",
                  filter:"drop-shadow(0 0 8px rgba(168,85,247,0.9))" }} />
              </motion.div>
              <span style={{ color:isActive?C.accentHi:C.text3, fontSize:10, fontWeight:700 }}>Earn</span>
            </motion.button>
          );
        }
        return (
          <button key={t.id} onClick={() => onTab(t.id)}
            style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"flex-end",
              gap:3, cursor:"pointer", border:"none", background:"none", padding:"8px 4px 0",
              flex:1, minWidth:0 }}>
            <div style={{ position:"relative" }}>
              {isActive && (
                <motion.div layoutId="nav-glow"
                  style={{ position:"absolute", inset:-6, borderRadius:"50%",
                    background:"radial-gradient(circle,rgba(139,92,246,0.5) 0%,transparent 70%)" }} />
              )}
              <t.Icon size={20} color={isActive ? C.accentHi : C.text3} style={{ position:"relative" }} />
            </div>
            <span style={{ color:isActive?C.accentHi:C.text3, fontSize:10, fontWeight:isActive?700:500,
              overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", width:"100%", textAlign:"center" }}>
              {t.label}
            </span>
            {isActive && (
              <motion.div layoutId="nav-dot"
                style={{ width:4, height:4, borderRadius:"50%", background:C.accentHi }} />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
function MainApp({ fid, ctx, added, addApp }: {
  fid: number; ctx: MiniCtx | null; added: boolean; addApp: () => void;
}) {
  const [tab,          setTab]         = useState<AppTab>(() => {
    const p = new URLSearchParams(window.location.search);
    const t = p.get("tab");
    if (t === "leaderboard" || t === "earn" || t === "rewards" || t === "profile") return t;
    return "home";
  });
  const [pts,          setPts]         = useState<FidPts | null>(null);
  const [board,        setBoard]       = useState<LBRow[]>([]);
  const [stats,        setStats]       = useState<StatsData | null>(null);
  const [allowance,    setAllowance]   = useState<AllowanceData | null>(null);
  const [ptsLoad,      setPtsLoad]     = useState(true);
  const [boardLoad,    setBoardLoad]   = useState(true);
  const [statsLoad,    setStatsLoad]   = useState(true);
  const [allowLoad,    setAllowLoad]   = useState(true);
  const [claimedPts,   setClaimedPts]  = useState(0);

  const username = ctx?.user?.username ?? `fid${fid}`;
  const pfpUrl   = ctx?.user?.pfpUrl ?? null;
  const rank     = board.find(r => r.fid === fid)?.rank ?? null;

  useEffect(() => {
    setPtsLoad(true);
    setBoardLoad(true);
    setStatsLoad(true);
    apiPoints(fid).then(p => {
      setPts(p);
      if (p?.pendingClaimed && p.pendingClaimed > 0) {
        setClaimedPts(p.pendingClaimed);
        setTimeout(() => setClaimedPts(0), 6000);
      }
      setPtsLoad(false);
    });
    apiMiniBoard(50).then(b => { setBoard(b); setBoardLoad(false); });
    apiStats(fid).then(s => { setStats(s); setStatsLoad(false); });
    apiAllowance(fid).then(a => { setAllowance(a); setAllowLoad(false); });
  }, [fid]);

  return (
    <div style={{ minHeight:"100svh", background:C.bg, display:"flex", flexDirection:"column" }}>
      <BgOrbs />

      {/* Header */}
      <div style={{
        position:"sticky", top:0, zIndex:40, background:`rgba(11,9,16,0.92)`,
        backdropFilter:"blur(14px)", borderBottom:`1px solid ${C.border}`,
        padding:"10px 16px", display:"flex", alignItems:"center", gap:8,
      }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, flex:1, minWidth:0 }}>
          <img src="/mini-logo.png" alt="" style={{ width:26, height:26, objectFit:"contain",
            filter:"drop-shadow(0 0 6px rgba(168,85,247,0.7))" }} />
          <span style={{ color:C.text1, fontWeight:800, fontSize:15, letterSpacing:"-0.01em",
            overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>FidCaster</span>
        </div>
        <span style={{ display:"flex", alignItems:"center", gap:5, background:"rgba(23,15,44,0.85)",
          border:"1px solid rgba(139,92,246,0.25)", borderRadius:999, padding:"5px 10px",
          color:C.text2, fontSize:11, fontWeight:700, flexShrink:0 }}>
          <span style={{ width:12, height:12, borderRadius:"50%", background:"#0052FF", display:"inline-block" }} />
          Base
        </span>
        {!added && (
          <button onClick={addApp} style={{ background:`rgba(139,92,246,0.15)`,
            border:`1px solid rgba(139,92,246,0.3)`, color:C.accentHi, borderRadius:8,
            padding:"5px 11px", fontSize:12, fontWeight:700, cursor:"pointer", flexShrink:0 }}>
            Add
          </button>
        )}
        <NotifBell fid={fid} />
        <MenuButton onNav={setTab} />
      </div>

      {/* Pending-gift claimed toast */}
      <AnimatePresence>
        {claimedPts > 0 && (
          <motion.div initial={{ opacity:0, y:-20 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-20 }}
            style={{ position:"fixed", top:60, left:"50%", transform:"translateX(-50%)", zIndex:100,
              display:"flex", alignItems:"center", gap:10, padding:"12px 18px",
              background:"rgba(16,185,129,0.15)", border:"1px solid rgba(16,185,129,0.35)",
              borderRadius:14, backdropFilter:"blur(16px)", whiteSpace:"nowrap" }}>
            <Gift size={16} color={C.green} />
            <p style={{ color:C.green, fontSize:13, fontWeight:600 }}>
              🎁 Claimed {claimedPts.toLocaleString()} gifted points!
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <div style={{ flex:1, padding:"14px 16px 90px", overflowY:"auto", position:"relative", zIndex:1 }}>
        <AnimatePresence mode="wait">
          {tab === "home" && (
            <HomeTab key="home" fid={fid} ctx={ctx} pts={pts} stats={stats} rank={rank} board={board}
              statsLoading={statsLoad} ptsLoading={ptsLoad}
              allowance={allowance} allowanceLoading={allowLoad} />
          )}
          {tab === "leaderboard" && (
            <LeaderboardTab key="lb" fid={fid} board={board} loading={boardLoad} />
          )}
          {tab === "earn" && (
            <EarnTab key="earn" fid={fid} pts={pts} loading={ptsLoad} />
          )}
          {tab === "rewards" && (
            <RewardsTab key="rewards" fid={fid} />
          )}
          {tab === "profile" && (
            <ProfileTab key="profile" fid={fid} ctx={ctx} pts={pts} stats={stats} rank={rank} loading={ptsLoad} />
          )}
        </AnimatePresence>
      </div>

      {/* Bottom nav */}
      <BottomNav tab={tab} onTab={setTab} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT
// ─────────────────────────────────────────────────────────────────────────────
const ONBOARDED_KEY = "fc_v1_onboarded";

export function MiniAppPage() {
  const { fid, ctx, ready, inFC, added, addApp } = useSDK();
  const [onboarded, setOnboarded] = useState(false);
  const [onboardChecked, setOnboardChecked] = useState(false);

  useEffect(() => {
    if (!ready || !fid || typeof window === "undefined") return;
    // Scoped per-fid so a shared device with multiple real Farcaster accounts
    // can't have account B silently skip onboarding because account A finished it.
    const key = `${ONBOARDED_KEY}_${fid}`;
    const params = new URLSearchParams(window.location.search);
    if (params.get("reset") === "1") { localStorage.removeItem(key); setOnboarded(false); setOnboardChecked(true); return; }
    // ?fid= preview mode — auto-skip onboarding so testers see the main app
    if (params.get("fid") && params.get("fid") !== "0") { setOnboarded(true); setOnboardChecked(true); return; }
    setOnboarded(localStorage.getItem(key) === "1");
    setOnboardChecked(true);
  }, [ready, fid]);

  function completeOnboarding() {
    if (fid) localStorage.setItem(`${ONBOARDED_KEY}_${fid}`, "1");
    setOnboarded(true);
  }

  if (!ready) return <LoadingScreen />;
  if (!fid)  return <BrowserScreen />;
  if (!onboardChecked) return <LoadingScreen />;

  if (!onboarded) {
    return <OnboardingFlow fid={fid} ctx={ctx} onComplete={completeOnboarding} />;
  }

  return <MainApp fid={fid} ctx={ctx} added={added} addApp={addApp} />;
}
