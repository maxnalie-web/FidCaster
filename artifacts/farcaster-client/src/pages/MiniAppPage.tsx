/**
 * FidCaster Mini App — Luxury Protocol Design
 *
 * Flow:
 *  LOADING  → spinner while SDK resolves
 *  ONBOARD  → shown in plain browser (not Warpcast) — explains how to participate
 *  MAIN APP → shown inside Warpcast with valid FID
 *
 * Access is gated on sdkFid (Farcaster SDK) — web-session fallback intentionally
 * removed so the app only fully opens inside Warpcast.
 */
import { useEffect, useState, useCallback, useRef } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import {
  Trophy, Star, Users, Copy, Check, ChevronRight,
  Loader2, Lock, Zap, ExternalLink, Medal, Sparkles,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface LeaderboardRow { fid: number; total_points: number; rank: number; }
interface FidPoints {
  fid: number;
  total_points: number;
  breakdown: { action_type: string; total_actions: number; points_earned: number }[];
}
interface MiniCtx {
  user?: { fid: number; username?: string; displayName?: string; pfpUrl?: string };
  client?: { added?: boolean };
}

// ── Hook: Farcaster SDK context ────────────────────────────────────────────────
function useMiniAppFid() {
  const [sdkFid, setSdkFid]         = useState<number | null>(null);
  const [sdkCtx, setSdkCtx]         = useState<MiniCtx | null>(null);
  const [sdkReady, setSdkReady]     = useState(false);
  const [isInFarcaster, setInFC]    = useState(false);
  const [added, setAdded]           = useState(false);

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
    try { await (sdk.actions as any).addMiniApp(); setAdded(true); } catch { /* declined */ }
  }

  return { sdkFid, sdkCtx, sdkReady, isInFarcaster, added, addMiniApp };
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function fetchPoints(fid: number): Promise<FidPoints | null> {
  try { const r = await fetch(`/api/points/my?fid=${fid}`); return r.ok ? r.json() : null; } catch { return null; }
}
async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  try { const r = await fetch("/api/points/leaderboard?limit=50"); if (!r.ok) return []; const d = await r.json(); return d.leaderboard ?? []; } catch { return []; }
}

// ── Animated counter ───────────────────────────────────────────────────────────
function AnimatedNumber({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef(0);
  useEffect(() => {
    const start = ref.current; const end = value; const dur = 900;
    const t0 = performance.now();
    function step(now: number) {
      const p = Math.min((now - t0) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      const cur = Math.round(start + (end - start) * ease);
      setDisplay(cur); ref.current = cur;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }, [value]);
  return <span className={className}>{display.toLocaleString()}</span>;
}

// ── Animated background (orbs) ─────────────────────────────────────────────────
function Background() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ background: "#06011A", zIndex: 0 }}>
      {/* Aurora layer */}
      <div className="absolute inset-0 lp-grid-bg opacity-30" />
      {/* Orb 1 — large purple */}
      <div className="lp-orb-1 absolute" style={{
        width: 480, height: 480,
        background: "radial-gradient(circle, rgba(124,58,237,0.35) 0%, rgba(109,40,217,0.15) 50%, transparent 70%)",
        top: "-10%", left: "-8%", borderRadius: "50%", filter: "blur(60px)",
      }} />
      {/* Orb 2 — indigo */}
      <div className="lp-orb-2 absolute" style={{
        width: 400, height: 400,
        background: "radial-gradient(circle, rgba(99,102,241,0.30) 0%, rgba(139,92,246,0.12) 50%, transparent 70%)",
        bottom: "0%", right: "-10%", borderRadius: "50%", filter: "blur(70px)",
      }} />
      {/* Orb 3 — violet accent */}
      <div className="lp-orb-3 absolute" style={{
        width: 260, height: 260,
        background: "radial-gradient(circle, rgba(192,38,211,0.20) 0%, transparent 70%)",
        top: "40%", right: "15%", borderRadius: "50%", filter: "blur(50px)",
      }} />
    </div>
  );
}

// ── Loading screen ─────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="relative z-10 min-h-screen flex flex-col items-center justify-center gap-5">
      <div className="lp-border-glow w-20 h-20 rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(139,92,246,0.4)" }}>
        <img src="/icons/icon-512-dark.png" alt="FidCaster" className="w-12 h-12 rounded-xl lp-float" />
      </div>
      <Loader2 className="w-5 h-5 animate-spin" style={{ color: "rgba(167,139,250,0.7)" }} />
      <p className="text-sm" style={{ color: "rgba(167,139,250,0.6)" }}>Loading…</p>
    </div>
  );
}

// ── Onboarding screen (browser / non-Farcaster) ────────────────────────────────
function OnboardingScreen() {
  const steps = [
    { icon: "🌐", title: "Visit fidcaster.xyz", desc: "Open the full FidCaster app in any browser" },
    { icon: "🔑", title: "Sign in with Farcaster", desc: "Connect your Farcaster identity — no email, no password" },
    { icon: "🚀", title: "Cast, follow & trade FIDs", desc: "Every action on FidCaster earns you points automatically" },
    { icon: "🎁", title: "Claim your airdrop", desc: "Your points determine your share of the token distribution" },
  ];

  return (
    <div className="relative z-10 min-h-screen flex flex-col items-center justify-start px-5 pt-14 pb-10 max-w-lg mx-auto">
      {/* Logo */}
      <div className="flex flex-col items-center mb-8">
        <div className="lp-border-glow w-20 h-20 rounded-[22px] flex items-center justify-center mb-4 lp-float"
          style={{ background: "rgba(124,58,237,0.18)", border: "1px solid rgba(139,92,246,0.45)" }}>
          <img src="/icons/icon-512-dark.png" alt="" className="w-13 h-13 rounded-xl" style={{ width: 52, height: 52 }} />
        </div>
        <h1 className="text-3xl font-black tracking-tight mb-1">
          <span className="fidcaster-brand">FidCaster</span>
        </h1>
        <p className="text-center text-sm" style={{ color: "rgba(167,139,250,0.75)" }}>
          Points · Leaderboard · Airdrop
        </p>
      </div>

      {/* How it works */}
      <div className="lp-glass-card w-full p-5 mb-4">
        <p className="text-xs font-semibold uppercase tracking-widest mb-4" style={{ color: "rgba(167,139,250,0.6)" }}>
          How to participate
        </p>
        <div className="space-y-4">
          {steps.map((s, i) => (
            <div key={i} className="flex items-start gap-3.5">
              <div className="w-9 h-9 rounded-xl shrink-0 flex items-center justify-center text-lg"
                style={{ background: "rgba(124,58,237,0.18)", border: "1px solid rgba(139,92,246,0.25)" }}>
                {s.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{s.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.65)" }}>{s.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* FidCaster Pass preview */}
      <div className="lp-glass-card w-full p-4 mb-4 flex items-center gap-4">
        <img src="/nft-pass.png" alt="FidCaster Pass" className="w-16 h-16 rounded-xl object-contain lp-float-2"
          style={{ background: "rgba(124,58,237,0.1)" }} />
        <div>
          <p className="text-sm font-bold text-white">FidCaster Pass</p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.65)" }}>
            Free NFT pass. Mint yours to unlock exclusive access.
          </p>
          <span className="inline-block mt-1.5 text-xs px-2 py-0.5 rounded-full font-semibold"
            style={{ background: "rgba(124,58,237,0.2)", color: "rgba(167,139,250,0.9)", border: "1px solid rgba(139,92,246,0.3)" }}>
            Coming soon
          </span>
        </div>
      </div>

      {/* CTA */}
      <a href="https://fidcaster.xyz" className="lp-cta-btn w-full text-center block mb-3">
        Open FidCaster App
      </a>
      <p className="text-xs text-center" style={{ color: "rgba(167,139,250,0.4)" }}>
        Then open this mini app inside Warpcast to track your points
      </p>
    </div>
  );
}

// ── Main app (inside Warpcast) ──────────────────────────────────────────────────
type Tab = "points" | "leaderboard" | "airdrop";

function MainApp({ sdkFid, sdkCtx, added, addMiniApp }: {
  sdkFid: number; sdkCtx: MiniCtx | null; added: boolean; addMiniApp: () => void;
}) {
  const [tab, setTab]               = useState<Tab>("points");
  const [points, setPoints]         = useState<FidPoints | null>(null);
  const [leaderboard, setLB]        = useState<LeaderboardRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [copied, setCopied]         = useState(false);
  const [visible, setVisible]       = useState(false);

  const username = sdkCtx?.user?.username ?? `fid${sdkFid}`;
  const pfpUrl   = sdkCtx?.user?.pfpUrl   ?? null;
  const referralUrl = `https://fidcaster.xyz/?ref=${sdkFid.toString(36).toUpperCase()}`;

  useEffect(() => {
    setTimeout(() => setVisible(true), 60);
    setLoading(true);
    Promise.all([fetchPoints(sdkFid), fetchLeaderboard()])
      .then(([pts, lb]) => { setPoints(pts); setLB(lb); })
      .finally(() => setLoading(false));
  }, [sdkFid]);

  const totalPts = points?.total_points ?? 0;
  const rank = leaderboard.find(r => r.fid === sdkFid)?.rank ?? null;

  const copy = useCallback(async () => {
    await navigator.clipboard.writeText(referralUrl).catch(() => {});
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  }, [referralUrl]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "points",      label: "Points"      },
    { id: "leaderboard", label: "Leaderboard" },
    { id: "airdrop",     label: "Airdrop"     },
  ];

  return (
    <div className="relative z-10 flex flex-col max-w-lg mx-auto min-h-screen"
      style={{ opacity: visible ? 1 : 0, transition: "opacity 0.4s ease" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 pt-10 pb-4">
        <div className="lp-glass-card p-4 flex items-center gap-3">
          {/* Avatar */}
          {pfpUrl ? (
            <img src={pfpUrl} alt="" className="w-11 h-11 rounded-full shrink-0 object-cover"
              style={{ border: "2px solid rgba(139,92,246,0.5)" }} />
          ) : (
            <div className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center text-sm font-bold"
              style={{ background: "rgba(124,58,237,0.25)", border: "2px solid rgba(139,92,246,0.4)", color: "#c4b5fd" }}>
              {String(username).slice(0, 2).toUpperCase()}
            </div>
          )}

          {/* Name + FID */}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm text-white truncate">@{username}</p>
            <p className="text-xs" style={{ color: "rgba(167,139,250,0.6)" }}>FID {sdkFid}</p>
          </div>

          {/* Add button */}
          {!added && (
            <button onClick={addMiniApp}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all hover:scale-105"
              style={{ background: "rgba(124,58,237,0.25)", border: "1px solid rgba(139,92,246,0.4)", color: "#c4b5fd" }}>
              <Zap className="w-3 h-3" /> Add
            </button>
          )}
        </div>
      </div>

      {/* ── Points Hero ────────────────────────────────────────────────────── */}
      <div className="px-4 pb-4">
        <div className="lp-glass-card p-5 text-center relative overflow-hidden">
          <div className="lp-shimmer" />
          <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: "rgba(167,139,250,0.55)" }}>
            Total Points
          </p>
          {loading ? (
            <Loader2 className="w-8 h-8 animate-spin mx-auto my-2" style={{ color: "rgba(139,92,246,0.6)" }} />
          ) : (
            <>
              <p className="text-5xl font-black tracking-tight lp-gradient-text">
                <AnimatedNumber value={totalPts} />
              </p>
              <div className="flex items-center justify-center gap-3 mt-2">
                {rank && (
                  <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
                    style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.3)", color: "#c4b5fd" }}>
                    <Trophy className="w-3 h-3" /> Rank #{rank}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full"
                  style={{ background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.25)", color: "#a5b4fc" }}>
                  <Users className="w-3 h-3" /> {leaderboard.length} participants
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Tab bar ────────────────────────────────────────────────────────── */}
      <div className="px-4 mb-1">
        <div className="flex rounded-2xl p-1 gap-1"
          style={{ background: "rgba(15,8,40,0.7)", border: "1px solid rgba(139,92,246,0.12)" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 py-2 rounded-xl text-sm font-semibold transition-all"
              style={tab === t.id
                ? { background: "rgba(124,58,237,0.35)", color: "#e9d5ff", border: "1px solid rgba(139,92,246,0.35)" }
                : { color: "rgba(167,139,250,0.55)", border: "1px solid transparent" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 pb-8 pt-3 space-y-3">

        {/* ── POINTS TAB ──────────────────────────────────────────────────── */}
        {tab === "points" && (
          <>
            {/* FidCaster Pass card */}
            <div className="lp-glass-card p-4 flex items-center gap-4 relative overflow-hidden">
              <div className="lp-shimmer" style={{ "--shimmer-delay": "1s" } as React.CSSProperties} />
              <img src="/nft-pass.png" alt="FidCaster Pass"
                className="w-14 h-14 rounded-xl object-contain shrink-0 lp-float"
                style={{ background: "rgba(10,0,40,0.5)" }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-bold text-white">FidCaster Pass</p>
                  <span className="text-xs px-1.5 py-0.5 rounded-full font-semibold"
                    style={{ background: "rgba(192,38,211,0.2)", color: "#e879f9", border: "1px solid rgba(192,38,211,0.3)" }}>
                    Free Mint
                  </span>
                </div>
                <p className="text-xs" style={{ color: "rgba(167,139,250,0.65)" }}>
                  Your exclusive NFT pass. Unlock premium access.
                </p>
              </div>
              <button className="shrink-0 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:scale-105"
                style={{ background: "rgba(124,58,237,0.25)", border: "1px solid rgba(139,92,246,0.4)", color: "#c4b5fd" }}>
                Soon
              </button>
            </div>

            {/* How to earn — shown when 0 points */}
            {!loading && !points?.breakdown?.length && (
              <div className="lp-glass-card p-5">
                <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "rgba(167,139,250,0.55)" }}>
                  How to earn points
                </p>
                {[
                  ["💬", "Cast on FidCaster", "1 pt per cast"],
                  ["❤️", "Like & react",       "0.5 pt per like"],
                  ["👥", "Follow users",        "0.5 pt per follow"],
                  ["🏪", "Trade FIDs",          "10 pts per trade"],
                  ["📨", "Refer friends",       "200 pts per referral"],
                ].map(([icon, action, pts]) => (
                  <div key={action} className="flex items-center justify-between py-2.5 border-b"
                    style={{ borderColor: "rgba(139,92,246,0.1)" }}>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base">{icon}</span>
                      <span className="text-sm text-white">{action}</span>
                    </div>
                    <span className="text-xs font-bold" style={{ color: "#a78bfa" }}>{pts}</span>
                  </div>
                ))}
                <a href="https://fidcaster.xyz" target="_blank"
                  className="lp-cta-btn flex items-center justify-center gap-2 mt-4 w-full text-sm">
                  Start earning <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            )}

            {/* Points breakdown */}
            {!loading && points?.breakdown && points.breakdown.length > 0 && (
              <div className="lp-glass-card overflow-hidden">
                <div className="px-4 py-3 border-b" style={{ borderColor: "rgba(139,92,246,0.12)" }}>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(167,139,250,0.55)" }}>
                    Activity Breakdown
                  </p>
                </div>
                {points.breakdown.map((b) => (
                  <div key={b.action_type} className="flex items-center justify-between px-4 py-3 border-b"
                    style={{ borderColor: "rgba(139,92,246,0.08)" }}>
                    <div>
                      <p className="text-sm font-medium text-white capitalize">{b.action_type.replace(/_/g, " ")}</p>
                      <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.55)" }}>
                        {b.total_actions.toLocaleString()} actions
                      </p>
                    </div>
                    <span className="text-sm font-bold" style={{ color: "#a78bfa" }}>
                      +{b.points_earned.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Referral card */}
            {!loading && (
              <div className="lp-glass-card p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4" style={{ color: "#a78bfa" }} />
                  <p className="text-sm font-semibold text-white">Referral Link</p>
                </div>
                <p className="text-xs" style={{ color: "rgba(167,139,250,0.6)" }}>
                  Refer a friend. When they hit 100 pts, you both earn 200 bonus points.
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 px-3 py-2 rounded-xl text-xs font-mono truncate"
                    style={{ background: "rgba(10,0,40,0.6)", border: "1px solid rgba(139,92,246,0.2)", color: "#c4b5fd" }}>
                    {referralUrl}
                  </div>
                  <button onClick={copy}
                    className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:scale-110"
                    style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.35)" }}>
                    {copied
                      ? <Check className="w-4 h-4" style={{ color: "#4ade80" }} />
                      : <Copy className="w-4 h-4" style={{ color: "#a78bfa" }} />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── LEADERBOARD TAB ─────────────────────────────────────────────── */}
        {tab === "leaderboard" && (
          <>
            {loading ? (
              <div className="flex justify-center py-12">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(139,92,246,0.6)" }} />
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-12">
                <Trophy className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(139,92,246,0.3)" }} />
                <p className="text-sm" style={{ color: "rgba(167,139,250,0.5)" }}>No data yet</p>
              </div>
            ) : (
              <>
                {/* Top 3 podium */}
                {leaderboard.length >= 3 && (
                  <div className="lp-glass-card p-4">
                    <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: "rgba(167,139,250,0.55)" }}>
                      Top Earners
                    </p>
                    <div className="flex items-end justify-center gap-3">
                      {/* 2nd */}
                      <div className="flex flex-col items-center gap-1 flex-1">
                        <Medal className="w-6 h-6" style={{ color: "#94a3b8" }} />
                        <div className="w-full py-3 rounded-xl text-center"
                          style={{ background: "rgba(148,163,184,0.1)", border: "1px solid rgba(148,163,184,0.2)" }}>
                          <p className="text-xs font-bold text-white">FID {leaderboard[1].fid}</p>
                          <p className="text-xs mt-0.5" style={{ color: "#94a3b8" }}>{leaderboard[1].total_points.toLocaleString()}</p>
                        </div>
                      </div>
                      {/* 1st */}
                      <div className="flex flex-col items-center gap-1 flex-[1.2]">
                        <Sparkles className="w-7 h-7 lp-glow-breathe" style={{ color: "#fbbf24" }} />
                        <div className="w-full py-4 rounded-xl text-center"
                          style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.3)" }}>
                          <p className="text-xs font-bold text-white">FID {leaderboard[0].fid}</p>
                          <p className="text-xs mt-0.5 font-bold" style={{ color: "#fbbf24" }}>{leaderboard[0].total_points.toLocaleString()}</p>
                        </div>
                      </div>
                      {/* 3rd */}
                      <div className="flex flex-col items-center gap-1 flex-1">
                        <Medal className="w-6 h-6" style={{ color: "#a16207" }} />
                        <div className="w-full py-3 rounded-xl text-center"
                          style={{ background: "rgba(161,98,7,0.1)", border: "1px solid rgba(161,98,7,0.25)" }}>
                          <p className="text-xs font-bold text-white">FID {leaderboard[2].fid}</p>
                          <p className="text-xs mt-0.5" style={{ color: "#a16207" }}>{leaderboard[2].total_points.toLocaleString()}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Full list */}
                <div className="lp-glass-card overflow-hidden">
                  {leaderboard.map((row, i) => {
                    const isMe = row.fid === sdkFid;
                    const medalColor = i === 0 ? "#fbbf24" : i === 1 ? "#94a3b8" : i === 2 ? "#a16207" : "rgba(167,139,250,0.5)";
                    return (
                      <div key={row.fid}
                        className="flex items-center gap-3 px-4 py-3 border-b transition-all"
                        style={{
                          borderColor: "rgba(139,92,246,0.08)",
                          background: isMe ? "rgba(124,58,237,0.12)" : "transparent",
                        }}>
                        <span className="w-7 text-xs font-bold shrink-0" style={{ color: medalColor }}>
                          #{row.rank}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate" style={{ color: isMe ? "#c4b5fd" : "white" }}>
                            FID {row.fid} {isMe && <span style={{ color: "rgba(167,139,250,0.6)", fontSize: "0.7rem" }}>(you)</span>}
                          </p>
                        </div>
                        <span className="text-sm font-bold shrink-0" style={{ color: isMe ? "#a78bfa" : "rgba(167,139,250,0.7)" }}>
                          {row.total_points.toLocaleString()}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* ── AIRDROP TAB ─────────────────────────────────────────────────── */}
        {tab === "airdrop" && (
          <>
            {/* Locked card */}
            <div className="lp-glass-card p-6 text-center relative overflow-hidden">
              <div className="lp-shimmer" style={{ "--shimmer-delay": "2s" } as React.CSSProperties} />
              <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center lp-glow-breathe"
                style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(139,92,246,0.4)" }}>
                <Lock className="w-7 h-7" style={{ color: "#a78bfa" }} />
              </div>
              <h3 className="text-xl font-black text-white mb-2">Snapshot Coming Soon</h3>
              <p className="text-sm" style={{ color: "rgba(167,139,250,0.65)" }}>
                The airdrop snapshot hasn't been taken yet. Keep earning points — your allocation is proportional to your score at snapshot time.
              </p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <div className="rounded-2xl p-3 text-center"
                  style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <p className="text-2xl font-black" style={{ color: "#c4b5fd" }}>
                    {totalPts.toLocaleString()}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.55)" }}>Your points</p>
                </div>
                <div className="rounded-2xl p-3 text-center"
                  style={{ background: "rgba(99,102,241,0.12)", border: "1px solid rgba(99,102,241,0.2)" }}>
                  <p className="text-2xl font-black" style={{ color: "#a5b4fc" }}>
                    {rank ? `#${rank}` : "—"}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "rgba(167,139,250,0.55)" }}>Your rank</p>
                </div>
              </div>
            </div>

            {/* Info card */}
            <div className="lp-glass-card p-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "rgba(167,139,250,0.55)" }}>
                Airdrop details
              </p>
              {[
                ["1", "Earn points by using FidCaster daily"],
                ["2", "Snapshot taken — date TBA"],
                ["3", "Register your Base wallet (opens after snapshot)"],
                ["4", "Tokens sent pro-rata to registered wallets on Base"],
              ].map(([n, t]) => (
                <div key={n} className="flex items-start gap-3">
                  <span className="w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-xs font-bold mt-0.5"
                    style={{ background: "rgba(124,58,237,0.2)", color: "#c4b5fd", border: "1px solid rgba(139,92,246,0.3)" }}>
                    {n}
                  </span>
                  <p className="text-sm" style={{ color: "rgba(167,139,250,0.75)" }}>{t}</p>
                </div>
              ))}
            </div>

            {/* Keep earning CTA */}
            <a href="https://fidcaster.xyz" target="_blank" className="lp-cta-btn flex items-center justify-center gap-2 w-full text-sm">
              Keep earning on FidCaster <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </>
        )}
      </div>
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────
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
