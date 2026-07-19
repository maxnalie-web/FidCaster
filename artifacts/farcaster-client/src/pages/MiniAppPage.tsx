/**
 * FidCaster Mini App — v5
 *
 * Glass-card design, animated BgOrbs, Lucide icons, 3-step gated onboarding.
 * Step 2 is hard-gated: user cannot proceed until NFT Pass is minted.
 */
import {
  useEffect, useState, useCallback, useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { sdk } from "@farcaster/miniapp-sdk";
import {
  ArrowRight, ArrowLeft, Copy, Check, ExternalLink,
  Loader2, HelpCircle, X, ChevronRight,
  Zap, Trophy, Users, ShoppingBag, Tag, Share2,
  Sword, Sprout, Heart, RefreshCw, Edit3,
  Wallet, Shield, Globe, Star, Gift,
} from "lucide-react";

// ── Design tokens ─────────────────────────────────────────────────────────────
const C = {
  bg:        "#060a14",
  surface:   "rgba(255,255,255,0.03)",
  surfaceHi: "rgba(255,255,255,0.07)",
  border:    "rgba(255,255,255,0.07)",
  borderMed: "rgba(255,255,255,0.13)",
  accent:    "#7C3AED",
  accentHi:  "#A78BFA",
  text1:     "rgba(255,255,255,0.95)",
  text2:     "rgba(255,255,255,0.55)",
  text3:     "rgba(255,255,255,0.28)",
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

// ── Scoring data ──────────────────────────────────────────────────────────────
const SCORING = [
  { Icon: Edit3,      action: "Cast",          pts: 10,  cap: 50   },
  { Icon: RefreshCw,  action: "Recast",        pts: 3,   cap: 30   },
  { Icon: Heart,      action: "Like",          pts: 1,   cap: 50   },
  { Icon: Users,      action: "Follow",        pts: 2,   cap: 50   },
  { Icon: ShoppingBag,action: "Buy FID",       pts: 100, cap: 300  },
  { Icon: Tag,        action: "List FID",      pts: 50,  cap: 250  },
  { Icon: Share2,     action: "Refer User",    pts: 200, cap: 2000 },
  { Icon: Sword,      action: "Quest",         pts: 100, cap: 500  },
  { Icon: Sprout,     action: "Grow Campaign", pts: 30,  cap: 150  },
];

const ACTION_MAP: Record<string, { label: string; Icon: React.ElementType }> = {
  cast:                  { label: "Cast",          Icon: Edit3       },
  recast:                { label: "Recast",        Icon: RefreshCw   },
  like:                  { label: "Like",          Icon: Heart       },
  follow:                { label: "Follow",        Icon: Users       },
  market_buy:            { label: "Buy FID",       Icon: ShoppingBag },
  market_list:           { label: "List FID",      Icon: Tag         },
  referral:              { label: "Referral",      Icon: Share2      },
  quest:                 { label: "Quest",         Icon: Sword       },
  grow_campaign_complete:{ label: "Grow Campaign", Icon: Sprout      },
};

// ── Types ─────────────────────────────────────────────────────────────────────
interface MiniCtx {
  user?: {
    fid: number; username?: string; displayName?: string; pfpUrl?: string;
    verifiedAddresses?: { eth_addresses?: string[] };
  };
  client?: { added?: boolean };
}
interface LBRow  { fid: number; total_points: number; rank: number; }
interface FidPts {
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
      const params = new URLSearchParams(window.location.search);
      const pFid = parseInt(params.get("fid") ?? "0", 10);
      const pEth = params.get("eth") ?? undefined;          // ?eth=0x… simulates a verified wallet
      if (pFid > 0) {
        setFid(pFid);
        setCtx({
          user: {
            fid: pFid,
            username: `fid${pFid}`,
            displayName: `FID ${pFid}`,
            ...(pEth ? { verifiedAddresses: { eth_addresses: [pEth] } } : {}),
          },
        });
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
  try {
    const r = await fetch("/api/points/leaderboard?limit=50");
    const d = await r.json();
    return d.leaderboard ?? [];
  } catch { return []; }
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

// ── Animated background orbs ──────────────────────────────────────────────────
function BgOrbs() {
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, overflow: "hidden" }}>
      <motion.div
        animate={{ x: [0, 40, -20, 0], y: [0, -30, 20, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        style={{
          position: "absolute", top: "-10%", left: "-5%",
          width: 340, height: 340, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.22) 0%, transparent 70%)",
          filter: "blur(40px)",
        }}
      />
      <motion.div
        animate={{ x: [0, -30, 15, 0], y: [0, 25, -15, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: "easeInOut", delay: 4 }}
        style={{
          position: "absolute", bottom: "10%", right: "-8%",
          width: 280, height: 280, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(245,158,11,0.14) 0%, transparent 70%)",
          filter: "blur(50px)",
        }}
      />
      <motion.div
        animate={{ x: [0, 20, -10, 0], y: [0, -20, 30, 0] }}
        transition={{ duration: 26, repeat: Infinity, ease: "easeInOut", delay: 8 }}
        style={{
          position: "absolute", top: "40%", left: "30%",
          width: 200, height: 200, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(168,85,247,0.12) 0%, transparent 70%)",
          filter: "blur(60px)",
        }}
      />
    </div>
  );
}

// ── Icon badge ────────────────────────────────────────────────────────────────
function IBadge({ Icon, size = 52, bg = "rgba(124,58,237,0.15)", color = "#A78BFA" }: {
  Icon: React.ElementType; size?: number; bg?: string; color?: string;
}) {
  return (
    <div style={{
      width: size, height: size, borderRadius: size * 0.28,
      background: bg, display: "flex", alignItems: "center",
      justifyContent: "center", border: `1px solid rgba(255,255,255,0.08)`,
      flexShrink: 0,
    }}>
      <Icon size={size * 0.44} color={color} />
    </div>
  );
}

// ── Glass card ────────────────────────────────────────────────────────────────
function Card({ children, style = {}, glow = false }: {
  children: React.ReactNode; style?: React.CSSProperties; glow?: boolean;
}) {
  return (
    <div style={{
      background: C.surface,
      border: `1px solid ${glow ? "rgba(124,58,237,0.3)" : C.border}`,
      borderRadius: 18,
      overflow: "hidden",
      position: "relative",
      backdropFilter: "blur(12px)",
      boxShadow: glow
        ? "0 0 0 1px rgba(124,58,237,0.15), 0 8px 32px rgba(124,58,237,0.10)"
        : "none",
      ...style,
    }}>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LOADING
// ─────────────────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 14 }}>
      <BgOrbs />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 16,
          background: "linear-gradient(135deg, rgba(124,58,237,0.4), rgba(168,85,247,0.2))",
          border: "1px solid rgba(124,58,237,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Zap size={26} color="#A78BFA" />
        </div>
        <Loader2 size={18} className="animate-spin" style={{ color: C.accentHi }} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER GATE
// ─────────────────────────────────────────────────────────────────────────────
function BrowserScreen() {
  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <BgOrbs />
      <motion.div {...fadeUp} style={{ position: "relative", zIndex: 1, maxWidth: 360, width: "100%", textAlign: "center" }}>
        <IBadge Icon={Globe} size={64} bg="rgba(124,58,237,0.15)" />
        <div style={{ height: 20 }} />
        <p style={{ color: C.text1, fontWeight: 800, fontSize: 20, marginBottom: 10 }}>Open in Warpcast</p>
        <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.7, marginBottom: 28 }}>
          This mini app runs inside Warpcast. Search for{" "}
          <strong style={{ color: C.accentHi }}>FidCaster</strong> or tap the link below.
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
// NFT PASS CARD (used inside onboarding step 2)
// ─────────────────────────────────────────────────────────────────────────────
function NFTPassCard({
  fid, ethAddress, onMinted,
}: { fid: number; ethAddress?: string; onMinted?: () => void }) {
  const [s,          setS]          = useState<"checking"|"idle"|"input"|"minting"|"done"|"error">("checking");
  const [manualAddr, setManualAddr] = useState("");
  const [txHash,     setTxHash]     = useState("");
  const [err,        setErr]        = useState("");

  useEffect(() => {
    const addr = ethAddress;
    if (!addr) { setS("idle"); return; }
    fetch(`/api/nft-pass/check/${addr}`)
      .then(r => r.json())
      .then(d => {
        if (d.hasMinted) { setS("done"); onMinted?.(); }
        else setS("idle");
      })
      .catch(() => setS("idle"));
  }, [ethAddress]);

  const short = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  async function doMint(address: string) {
    setS("minting");
    try {
      const r = await fetch("/api/nft-pass/mint", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid, address }),
      });
      const d = await r.json();
      if (d.alreadyMinted || r.ok) {
        setTxHash(d.txHash ?? "");
        setS("done");
        onMinted?.();
      } else {
        throw new Error(d.error ?? "Mint failed");
      }
    } catch (e) { setErr(String(e)); setS("error"); }
  }

  function handleMint() {
    if (ethAddress) doMint(ethAddress);
    else setS("input");
  }

  if (s === "checking") {
    return (
      <Card style={{ padding: "18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Loader2 size={18} className="animate-spin" style={{ color: C.accentHi }} />
          <p style={{ color: C.text2, fontSize: 14 }}>Checking wallet...</p>
        </div>
      </Card>
    );
  }

  if (s === "done") {
    return (
      <Card glow style={{ padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <img src="/nft-pass-v2.png" alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: "contain", background: "rgba(124,58,237,0.12)" }} />
          <div style={{ flex: 1 }}>
            <p style={{ color: C.text1, fontWeight: 700, fontSize: 15 }}>FidCaster Pass</p>
            <p style={{ color: C.green, fontSize: 13, marginTop: 2, display: "flex", alignItems: "center", gap: 5 }}>
              <Check size={13} /> Minted · Full access active
            </p>
          </div>
          {txHash && (
            <a href={`https://basescan.org/tx/${txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ color: C.text3, display: "flex" }}>
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card glow>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px" }}>
        <img src="/nft-pass-v2.png" alt="" style={{ width: 48, height: 48, borderRadius: 12, objectFit: "contain", background: "rgba(124,58,237,0.12)" }} />
        <div style={{ flex: 1 }}>
          <p style={{ color: C.text1, fontWeight: 700, fontSize: 15 }}>FidCaster Pass</p>
          <p style={{ color: C.text2, fontSize: 12, marginTop: 2 }}>
            {ethAddress
              ? <>Free NFT on Base · <span style={{ fontFamily: "monospace", color: C.accentHi }}>{short(ethAddress)}</span></>
              : "Free NFT on Base"
            }
          </p>
        </div>
        {s === "idle" && (
          <button onClick={handleMint} style={{
            background: `linear-gradient(135deg, ${C.accent}, #A855F7)`,
            color: "#fff", borderRadius: 10, padding: "8px 16px",
            fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer", flexShrink: 0,
            boxShadow: "0 4px 16px rgba(124,58,237,0.3)",
          }}>
            Mint free
          </button>
        )}
        {s === "minting" && (
          <span style={{ color: C.accentHi, fontSize: 13, display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
            <Loader2 size={14} className="animate-spin" /> Minting...
          </span>
        )}
      </div>

      <AnimatePresence>
        {s === "input" && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} style={{ overflow: "hidden" }}>
            <div style={{ borderTop: `1px solid ${C.border}`, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ color: C.text3, fontSize: 12 }}>No verified wallet found. Enter your Base address:</p>
              <input type="text" placeholder="0x..." value={manualAddr} onChange={e => setManualAddr(e.target.value)}
                style={{ width: "100%", padding: "10px 12px", background: "rgba(0,0,0,0.4)", border: `1px solid ${C.borderMed}`, borderRadius: 10, color: C.text1, fontSize: 13, fontFamily: "monospace", outline: "none", boxSizing: "border-box" }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => doMint(manualAddr)} disabled={!manualAddr.trim()}
                  style={{ flex: 1, padding: "10px", borderRadius: 10, background: `linear-gradient(135deg, ${C.accent}, #A855F7)`, color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: "pointer", opacity: manualAddr.trim() ? 1 : 0.45 }}>
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
            <button onClick={() => setS("idle")} style={{ background: "none", border: "none", color: C.text3, fontSize: 12, cursor: "pointer", marginTop: 4 }}>
              Try again
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING (3 steps, step 2 hard-gated on NFT mint)
// ─────────────────────────────────────────────────────────────────────────────
const OB_STEPS = [
  { Icon: Star,   title: "Welcome to FidCaster",  hint: "Step 1 of 3" },
  { Icon: Shield, title: "Mint Your Pass",         hint: "Step 2 of 3" },
  { Icon: Globe,  title: "Join fidcaster.xyz",     hint: "Step 3 of 3" },
];

function OnboardingFlow({ fid, ctx, onComplete }: {
  fid: number; ctx: MiniCtx | null; onComplete: () => void;
}) {
  const [step,   setStep]   = useState(0);
  const [minted, setMinted] = useState(false);

  const username = ctx?.user?.username ?? `fid${fid}`;
  const pfpUrl   = ctx?.user?.pfpUrl ?? null;
  const ethAddr  = ctx?.user?.verifiedAddresses?.eth_addresses?.[0];

  function next() { if (step < 2) setStep(s => s + 1); }
  function back() { if (step > 0) setStep(s => s - 1); }

  const stepContent = [
    // ── Step 0: Welcome ────────────────────────────────────────────────────
    <motion.div key="s0" {...slideIn} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Identity card */}
      <div style={{
        display: "flex", alignItems: "center", gap: 14,
        padding: "16px 18px",
        background: C.surfaceHi,
        borderRadius: 16, border: `1px solid ${C.borderMed}`,
      }}>
        {pfpUrl
          ? <img src={pfpUrl} alt="" style={{ width: 48, height: 48, borderRadius: "50%", flexShrink: 0 }} />
          : <div style={{ width: 48, height: 48, borderRadius: "50%", background: `linear-gradient(135deg, ${C.accent}, #A855F7)`, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 900, color: "#fff" }}>
              {username.slice(0,2).toUpperCase()}
            </div>
        }
        <div style={{ flex: 1 }}>
          <p style={{ color: C.text1, fontWeight: 700, fontSize: 16 }}>@{username}</p>
          <p style={{ color: C.text3, fontSize: 13, marginTop: 2 }}>Farcaster ID {fid}</p>
        </div>
        <Check size={18} color={C.green} />
      </div>

      {/* Description */}
      <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.75 }}>
        <strong style={{ color: C.text1 }}>FidCaster</strong> is a Farcaster client that tracks your activity and rewards every verified action with points. Points count toward the airdrop. All earning activities take place at{" "}
        <strong style={{ color: C.amber }}>fidcaster.xyz</strong>.
      </p>

      {/* Pillars */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {[
          { Icon: Zap,      color: C.accentHi, text: "Earn points for every verified Farcaster action you take" },
          { Icon: Trophy,   color: C.amber,    text: "Climb the leaderboard and secure a larger share of the airdrop" },
          { Icon: Shield,   color: C.green,    text: "Your FID is your account. No sign-up, fully on-chain" },
        ].map(({ Icon, color, text }) => (
          <div key={text} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 14px", background: C.surface, borderRadius: 12, border: `1px solid ${C.border}` }}>
            <Icon size={16} color={color} style={{ flexShrink: 0, marginTop: 1 }} />
            <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.5 }}>{text}</p>
          </div>
        ))}
      </div>
    </motion.div>,

    // ── Step 1: Mint Pass (HARD GATE) ──────────────────────────────────────
    <motion.div key="s1" {...slideIn} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.7 }}>
        The <strong style={{ color: C.text1 }}>FidCaster Pass</strong> is a free NFT on Base that unlocks full access to the app. You must mint it to continue.
      </p>

      <NFTPassCard fid={fid} ethAddress={ethAddr} onMinted={() => setMinted(true)} />

      {minted && (
        <motion.div
          initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.22)", borderRadius: 14 }}>
          <Check size={16} color={C.green} />
          <p style={{ color: C.green, fontSize: 13, fontWeight: 600 }}>Pass minted! Tap Continue to proceed.</p>
        </motion.div>
      )}

      {!minted && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "rgba(245,158,11,0.07)", border: "1px solid rgba(245,158,11,0.20)", borderRadius: 14 }}>
          <Shield size={15} color={C.amber} />
          <p style={{ color: C.amber, fontSize: 13 }}>You must mint the pass to unlock the app.</p>
        </div>
      )}
    </motion.div>,

    // ── Step 2: Join fidcaster.xyz ─────────────────────────────────────────
    <motion.div key="s2" {...slideIn} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ color: C.text2, fontSize: 14, lineHeight: 1.7 }}>
        All earning activities happen on{" "}
        <strong style={{ color: C.amber }}>fidcaster.xyz</strong>. Create your account there to start earning points.
      </p>

      {/* 6-step guide */}
      <Card style={{ padding: "4px 0" }}>
        {[
          { n: 1, Icon: Globe,      text: "Go to fidcaster.xyz"                         },
          { n: 2, Icon: Users,      text: "Sign in with your Farcaster account"          },
          { n: 3, Icon: Edit3,      text: "Cast, recast, and like to earn Cast points"   },
          { n: 4, Icon: ShoppingBag,text: "Buy or list FIDs on the marketplace"          },
          { n: 5, Icon: Share2,     text: "Refer friends for 200 pts each"               },
          { n: 6, Icon: Zap,        text: "Check this mini app daily to track your score"},
        ].map(({ n, Icon, text }, i, arr) => (
          <div key={n}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: "rgba(124,58,237,0.15)",
                border: "1px solid rgba(124,58,237,0.25)",
                display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0,
              }}>
                <span style={{ color: C.accentHi, fontSize: 12, fontWeight: 800 }}>{n}</span>
              </div>
              <Icon size={15} color={C.text3} style={{ flexShrink: 0 }} />
              <p style={{ color: C.text2, fontSize: 13, lineHeight: 1.4 }}>{text}</p>
            </div>
            {i < arr.length - 1 && <div style={{ height: 1, background: C.border, margin: "0 16px" }} />}
          </div>
        ))}
      </Card>

      {/* Primary CTA */}
      <a
        href="https://fidcaster.xyz"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          padding: "15px 20px", borderRadius: 14,
          background: `linear-gradient(135deg, ${C.accent} 0%, #A855F7 100%)`,
          color: "#fff", fontWeight: 800, fontSize: 15, textDecoration: "none",
          boxShadow: "0 4px 24px rgba(124,58,237,0.30)",
        }}
      >
        Open fidcaster.xyz <ExternalLink size={15} />
      </a>

      {/* Secondary: already registered */}
      <button
        onClick={onComplete}
        style={{
          width: "100%", background: "none", border: `1px solid ${C.border}`,
          borderRadius: 14, padding: "13px 20px",
          color: C.text2, fontSize: 14, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}
      >
        I have registered <ArrowRight size={15} />
      </button>
    </motion.div>,
  ];

  // Determine if "Continue" is enabled
  const canContinue = step === 0 || (step === 1 && minted);

  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", flexDirection: "column" }}>
      <BgOrbs />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 20px 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ color: C.text1, fontWeight: 800, fontSize: 17 }}>FidCaster</span>
        <span style={{ color: C.text3, fontSize: 12 }}>{OB_STEPS[step].hint}</span>
      </div>

      {/* Progress bar */}
      <div style={{ position: "relative", zIndex: 1, margin: "14px 20px 0", height: 3, background: C.border, borderRadius: 3 }}>
        <motion.div
          animate={{ width: `${((step + 1) / OB_STEPS.length) * 100}%` }}
          transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          style={{ height: "100%", borderRadius: 3, background: `linear-gradient(90deg, ${C.accent}, #A855F7)` }}
        />
      </div>

      {/* Step icon + title */}
      <div style={{ position: "relative", zIndex: 1, padding: "22px 20px 12px", display: "flex", alignItems: "center", gap: 14 }}>
        <IBadge Icon={OB_STEPS[step].Icon} size={48} />
        <p style={{ color: C.text1, fontWeight: 800, fontSize: 22, lineHeight: 1.2 }}>{OB_STEPS[step].title}</p>
      </div>

      {/* Content */}
      <div style={{ position: "relative", zIndex: 1, flex: 1, padding: "4px 20px 20px", overflowY: "auto" }}>
        <AnimatePresence mode="wait">
          {stepContent[step]}
        </AnimatePresence>
      </div>

      {/* Footer nav — hidden on step 2 (handled inside step content) */}
      {step < 2 && (
        <div style={{ position: "relative", zIndex: 1, padding: "12px 20px 32px", display: "flex", gap: 10 }}>
          {step > 0 && (
            <button onClick={back} style={{ padding: "13px 16px", borderRadius: 12, background: C.surface, border: `1px solid ${C.border}`, color: C.text2, cursor: "pointer", display: "flex", alignItems: "center" }}>
              <ArrowLeft size={16} />
            </button>
          )}
          <button
            onClick={next}
            disabled={!canContinue}
            style={{
              flex: 1, padding: "14px 20px", borderRadius: 14, border: "none",
              background: canContinue
                ? `linear-gradient(135deg, ${C.accent} 0%, #A855F7 100%)`
                : C.surfaceHi,
              color: canContinue ? "#fff" : C.text3,
              cursor: canContinue ? "pointer" : "not-allowed",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              fontSize: 15, fontWeight: 700,
              boxShadow: canContinue ? "0 4px 20px rgba(124,58,237,0.28)" : "none",
              transition: "all 0.2s",
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
        style={{ width: "100%", maxHeight: "88svh", overflowY: "auto", background: "#0a0f1e", borderRadius: "22px 22px 0 0", padding: "20px 20px 40px", border: `1px solid ${C.borderMed}` }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Zap size={20} color={C.accentHi} />
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
                <row.Icon size={14} color={C.text3} />
                {row.action}
              </span>
              <span style={{ color: C.accentHi, fontSize: 13, fontWeight: 800, textAlign: "right", minWidth: 52 }}>+{row.pts}</span>
              <span style={{ color: C.text3, fontSize: 12, textAlign: "right", minWidth: 64 }}>{row.cap.toLocaleString()}</span>
            </div>
          ))}
        </Card>

        <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 10 }}>Exclusion rules</p>
        {[
          {
            Icon: X, color: C.rose,
            label: "Sybil / bot detection",
            desc: "حساب‌هایی که رفتار غیرطبیعی دارند (ارسال انبوه، تعامل هماهنگ چند حساب، فارم‌کردن امتیاز) به‌صورت دائمی از ایردراپ حذف می‌شوند. این تصمیم قابل بازگشت نیست. سیستم شناسایی ما به‌صورت مداوم روی داده‌های Farcaster Hub اجرا می‌شود.",
          },
          {
            Icon: Shield, color: C.amber,
            label: "Hub verification failure",
            desc: "هر اکشن باید روی Farcaster Hub تأیید شود. اگر cast، recast یا like شما در Hub ثبت نشده باشد یا پس از ثبت حذف شده باشد، امتیاز آن اکشن محاسبه نمی‌شود. اتصال ضعیف اینترنت یا حساب‌های بدون Hub relay هم ممکن است این خطا را ایجاد کنند.",
          },
          {
            Icon: RefreshCw, color: C.text2,
            label: "Duplicate submissions",
            desc: "اگر یک اکشن بیش از یک بار به سیستم ارسال شود، فقط یک بار شمارش می‌شود. مثلاً unlike و re-like کردن همان cast دوباره امتیاز نمی‌دهد.",
          },
          {
            Icon: Sprout, color: C.text2,
            label: "Grow Campaign: حداقل ۵ فالوور",
            desc: "یک کمپین Grow فقط در صورتی امتیاز می‌گیرد که حداقل ۵ فالوور جدید و تأییدشده ایجاد کند. کمپین‌هایی که به این آستانه نرسند هیچ امتیازی ندارند.",
          },
        ].map(r => (
          <div key={r.label} style={{ display: "flex", gap: 12, padding: "13px 14px", background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 8 }}>
            <r.Icon size={16} color={r.color} style={{ flexShrink: 0, marginTop: 2 }} />
            <div>
              <p style={{ color: r.color, fontSize: 13, fontWeight: 700, marginBottom: 5 }}>{r.label}</p>
              <p style={{ color: C.text3, fontSize: 12, lineHeight: 1.65 }}>{r.desc}</p>
            </div>
          </div>
        ))}
      </motion.div>
    </motion.div>
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
        background: `linear-gradient(180deg, rgba(124,58,237,0.16) 0%, rgba(124,58,237,0.03) 100%)`,
        border: `1px solid rgba(124,58,237,0.20)`, borderRadius: 20,
        position: "relative", overflow: "hidden",
        backdropFilter: "blur(12px)",
      }}>
        <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -55%)", width: 200, height: 200, borderRadius: "50%", background: "radial-gradient(circle, rgba(124,58,237,0.25) 0%, transparent 70%)", pointerEvents: "none" }} />

        <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
          <Zap size={11} color={C.text3} /> Total Points
        </p>
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
            <span style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.30)", color: C.amber, borderRadius: 10, padding: "5px 12px", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", gap: 5 }}>
              <Trophy size={12} color={C.amber} /> Rank #{rank}
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
          <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", padding: "12px 16px 6px", display: "flex", alignItems: "center", gap: 5 }}>
            <Gift size={11} color={C.text3} /> Earnings Breakdown
          </p>
          {pts.breakdown.filter(b => b.points_earned > 0).sort((a, b) => b.points_earned - a.points_earned).map((b, i, arr) => {
            const meta = ACTION_MAP[b.action_type] ?? { label: b.action_type, Icon: Zap };
            const pct  = total > 0 ? (b.points_earned / total) * 100 : 0;
            return (
              <div key={b.action_type}>
                <div style={{ padding: "10px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                    <span style={{ color: C.text1, fontSize: 13, display: "flex", alignItems: "center", gap: 7 }}>
                      <meta.Icon size={14} color={C.text3} />
                      {meta.label}
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
            <p style={{ color: C.text1, fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", gap: 6 }}>
              <Share2 size={14} color={C.accentHi} /> Invite Friends
            </p>
            <p style={{ color: C.text2, fontSize: 12, marginTop: 3 }}>Earn <strong style={{ color: C.amber }}>+200 pts</strong> per successful referral</p>
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
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy</>}
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
      <Trophy size={40} color={C.text3} style={{ marginBottom: 12 }} />
      <p style={{ color: C.text3, fontSize: 14 }}>No data yet. Start earning points on fidcaster.xyz</p>
    </motion.div>
  );

  const TOP_COLORS = [C.amber, C.accentHi, C.text2];
  const TOP_LABELS = ["1st", "2nd", "3rd"];

  return (
    <motion.div key="board-tab" {...fadeUp} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Top 3 */}
      <Card>
        <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", padding: "12px 16px 4px", display: "flex", alignItems: "center", gap: 5 }}>
          <Trophy size={11} color={C.text3} /> Top Earners
        </p>
        {board.slice(0, 3).map((row, i) => {
          const isMe = row.fid === fid;
          return (
            <div key={row.fid}>
              <div style={{
                display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                background: isMe ? "rgba(124,58,237,0.10)" : "transparent",
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: TOP_COLORS[i], width: 28, textAlign: "center", flexShrink: 0 }}>{TOP_LABELS[i]}</span>
                <span style={{ flex: 1, color: isMe ? C.accentHi : C.text1, fontWeight: isMe ? 700 : 500, fontSize: 14 }}>
                  FID {row.fid}{isMe ? " (you)" : ""}
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
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: isMe ? "rgba(124,58,237,0.08)" : "transparent" }}
                >
                  <span style={{ width: 28, color: C.text3, fontSize: 12, textAlign: "right", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                    {row.rank}
                  </span>
                  <span style={{ flex: 1, color: isMe ? C.accentHi : C.text1, fontWeight: isMe ? 700 : 400, fontSize: 13 }}>
                    FID {row.fid}{isMe ? " (you)" : ""}
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
        background: `linear-gradient(135deg, rgba(124,58,237,0.13) 0%, rgba(168,85,247,0.06) 100%)`,
        border: `1px solid rgba(124,58,237,0.22)`,
        backdropFilter: "blur(12px)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
          {pfpUrl
            ? <img src={pfpUrl} alt="" style={{ width: 60, height: 60, borderRadius: "50%", border: `2px solid rgba(124,58,237,0.45)` }} />
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
            { label: "Points",  value: loading ? "..." : total.toLocaleString(),    Icon: Zap    },
            { label: "Rank",    value: loading ? "..." : rank ? `#${rank}` : "N/A", Icon: Trophy },
            { label: "Actions", value: loading ? "..." : actions.toString(),         Icon: Star   },
          ].map((s, i) => (
            <div key={s.label} style={{ textAlign: "center", padding: "12px 6px", borderRight: i < 2 ? `1px solid ${C.border}` : "none" }}>
              <s.Icon size={14} color={C.text3} style={{ marginBottom: 4 }} />
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
          <p style={{ color: C.text3, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", padding: "12px 16px 4px", display: "flex", alignItems: "center", gap: 5 }}>
            <Wallet size={11} color={C.text3} /> Verified Wallets
          </p>
          {ethAddrs.map((addr, i) => (
            <div key={addr}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px" }}>
                <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.green, flexShrink: 0 }} />
                <span style={{ color: C.text1, fontSize: 12, fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{addr}</span>
                <a href={`https://basescan.org/address/${addr}`} target="_blank" rel="noopener noreferrer" style={{ color: C.text3, display: "flex" }}>
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
          <Zap size={16} color={C.accentHi} />
          <p style={{ color: C.text1, fontSize: 14, fontWeight: 700 }}>Scoring Rules</p>
        </div>
        <ChevronRight size={16} style={{ color: C.text3 }} />
      </button>

      {/* Airdrop status */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "15px 16px", background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 16 }}>
        <Gift size={20} color={C.amber} style={{ flexShrink: 0 }} />
        <div>
          <p style={{ color: C.text1, fontWeight: 700, fontSize: 14 }}>Airdrop</p>
          <p style={{ color: C.text2, fontSize: 12, marginTop: 3 }}>Snapshot not announced yet. Keep earning.</p>
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
  const [tab,   setTab]   = useState<AppTab>("score");
  const [pts,   setPts]   = useState<FidPts | null>(null);
  const [board, setBoard] = useState<LBRow[]>([]);
  const [load,  setLoad]  = useState(true);
  const [rules, setRules] = useState(false);

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

  const TABS: { id: AppTab; label: string; Icon: React.ElementType }[] = [
    { id: "score",   label: "Score",    Icon: Zap    },
    { id: "board",   label: "Rankings", Icon: Trophy },
    { id: "profile", label: "Profile",  Icon: Users  },
  ];

  return (
    <div style={{ minHeight: "100svh", background: C.bg, display: "flex", flexDirection: "column" }}>
      <BgOrbs />

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
          <button onClick={addApp} style={{ background: `rgba(124,58,237,0.18)`, border: `1px solid rgba(124,58,237,0.35)`, color: C.accentHi, borderRadius: 8, padding: "5px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
            Add app
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
            <t.Icon size={14} /> {t.label}
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
const ONBOARDED_KEY = "fc_v1_onboarded";

export function MiniAppPage() {
  const { fid, ctx, ready, inFC, added, addApp } = useSDK();
  const [onboarded, setOnboarded] = useState(() => {
    // ?reset=1  →  clears onboarding flag so you can re-run the flow
    if (new URLSearchParams(window.location.search).get("reset") === "1") {
      localStorage.removeItem(ONBOARDED_KEY);
      return false;
    }
    return localStorage.getItem(ONBOARDED_KEY) === "1";
  });

  let phase: "loading" | "browser" | "onboarding" | "app";
  if (!ready)             phase = "loading";
  else if (!fid || !inFC) phase = "browser";
  else if (!onboarded)    phase = "onboarding";
  else                    phase = "app";

  function complete() {
    localStorage.setItem(ONBOARDED_KEY, "1");
    setOnboarded(true);
  }

  return (
    <div style={{ background: C.bg, minHeight: "100svh" }}>
      <AnimatePresence mode="wait">
        {phase === "loading"    && <LoadingScreen key="L" />}
        {phase === "browser"    && <BrowserScreen key="B" />}
        {phase === "onboarding" && fid && (
          <OnboardingFlow key="O" fid={fid} ctx={ctx} onComplete={complete} />
        )}
        {phase === "app" && fid && (
          <MainApp key="A" fid={fid} ctx={ctx} added={added} addApp={addApp} />
        )}
      </AnimatePresence>
    </div>
  );
}
