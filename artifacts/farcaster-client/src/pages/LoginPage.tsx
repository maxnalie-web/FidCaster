import { motion, useInView, AnimatePresence } from "framer-motion";
import { useRef, useMemo, useState, useEffect } from "react";
import { useLocation } from "wouter";
import { FidCasterLogo } from "@/components/FidCasterLogo";
import { XLogo, TelegramLogo } from "@/components/NeynarScoreBadge";
import {
  ArrowRight, TrendingUp, Zap, Shield, Globe, MessageCircle,
  Heart, Repeat2, Tag, Activity, Star, ChevronRight,
  BarChart2, Wallet, Users, Layers, Search, Bell,
  CheckCircle2, ExternalLink, Github, MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLandingStats, formatVolume, formatCount, formatUserCount, type MarketListing, type MarketActivity } from "@/hooks/useLandingStats";

/* ─── Mock data ─── */
const MOCK_FEED = [
  {
    handle: "dwr.eth", fid: 3, initials: "D", color: "#7c3aed",
    text: "The future of social is self-sovereign. Own your FID, own your identity forever.",
    likes: 1247, recasts: 382, replies: 94, time: "2m",
    channel: "fc-protocol",
  },
  {
    handle: "vitalik.eth", fid: 5650, initials: "V", color: "#2563eb",
    text: "Decentralized social graphs change the incentive structure entirely. Platforms compete on UX, not lock-in.",
    likes: 3821, recasts: 1204, replies: 287, time: "8m",
    channel: "ethereum",
  },
  {
    handle: "cassie.eth", fid: 1080, initials: "C", color: "#db2777",
    text: "FID #42 just sold for 2.5 ETH on FidCaster Market 🔥 Low-number FIDs are becoming collector items.",
    likes: 544, recasts: 117, replies: 52, time: "14m",
    channel: "fid-market",
    hasImage: true,
  },
  {
    handle: "pfista.eth", fid: 239, initials: "P", color: "#059669",
    text: "Building on Farcaster means your users always own their data and social graph. No platform can take that away.",
    likes: 892, recasts: 301, replies: 78, time: "22m",
    channel: "dev",
  },
];



// Icons are fixed in order; titles/descs/colors come from admin config
const FEATURE_ICONS = [
  <MessageCircle className="w-5 h-5" />,
  <Users className="w-5 h-5" />,
  <Globe className="w-5 h-5" />,
  <Tag className="w-5 h-5" />,
  <Shield className="w-5 h-5" />,
  <BarChart2 className="w-5 h-5" />,
];

const LANDING_FEATURE_DATA = [
  { title: "Cast & Engage", desc: "Post, reply, recast, and react to everything in your Farcaster feed.", color: "#7c3aed" },
  { title: "Grow Your Network", desc: "Smart batch-follow tools surface quality accounts relevant to your niche.", color: "#6366f1" },
  { title: "Explore Channels", desc: "Browse Farcaster channels, trending casts, and discovery feeds.", color: "#8b5cf6" },
  { title: "FID Marketplace", desc: "Buy, sell, and watch Farcaster ID listings settled on-chain.", color: "#a855f7" },
  { title: "Your Keys, Always", desc: "Posting keys are generated on your device. FidCaster never holds your seed.", color: "#9333ea" },
  { title: "Stats & Insights", desc: "Track followers, engagement, and Neynar quality scores in real time.", color: "#7c3aed" },
];

/* ─── Particle system ─── */
function Particles() {
  const particles = useMemo(() =>
    Array.from({ length: 45 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: Math.random() * 3 + 0.5,
      duration: Math.random() * 26 + 14,
      delay: Math.random() * 22,
      color: i % 6 === 0
        ? "rgba(240,171,252,0.7)" : i % 4 === 0
        ? "rgba(129,140,248,0.6)" : i % 3 === 0
        ? "rgba(192,38,211,0.45)"
        : "rgba(139,92,246,0.4)",
    })), []);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {particles.map((p) => (
        <div key={p.id} className="absolute rounded-full"
          style={{
            left: `${p.x}%`, bottom: "-8px",
            width: p.size, height: p.size,
            background: p.color,
            animation: `lp-particle-rise ${p.duration}s ${p.delay}s linear infinite`,
          }} />
      ))}
    </div>
  );
}

/* ─── Animated background ─── */
function AnimatedBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, #12052e 0%, #060018 45%, #020008 100%)",
      }} />
      <div className="absolute inset-0 lp-grid-bg" />
      <div className="absolute lp-orb-1" style={{
        top: "0%", left: "5%", width: "60vw", height: "60vw", maxWidth: 800, maxHeight: 800,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(124,58,237,0.22) 0%, rgba(109,40,217,0.07) 45%, transparent 68%)",
        filter: "blur(55px)",
      }} />
      <div className="absolute lp-orb-2" style={{
        bottom: "10%", right: "0%", width: "50vw", height: "50vw", maxWidth: 680, maxHeight: 680,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(79,70,229,0.05) 50%, transparent 70%)",
        filter: "blur(65px)",
      }} />
      <div className="absolute lp-orb-3" style={{
        top: "55%", left: "50%", transform: "translateX(-50%)",
        width: "35vw", height: "35vw", maxWidth: 480, maxHeight: 480,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(192,38,211,0.12) 0%, transparent 68%)",
        filter: "blur(80px)",
      }} />
      <div className="absolute top-0 left-1/2 -translate-x-1/2" style={{
        width: "70vw", height: "40vw",
        background: "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.14) 0%, transparent 68%)",
        filter: "blur(50px)",
      }} />
      <div className="absolute inset-0" style={{
        background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(139,92,246,0.01) 3px, rgba(139,92,246,0.01) 4px)",
      }} />
      <Particles />
    </div>
  );
}

/* ─── Mock app UI (feed preview) ─── */
function MockAppPreview() {
  const [activeCast, setActiveCast] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActiveCast((v) => (v + 1) % MOCK_FEED.length), 3000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="relative w-full max-w-sm mx-auto" style={{ perspective: 1000 }}>
      {/* Glow under */}
      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 pointer-events-none" style={{
        width: "80%", height: 60,
        background: "radial-gradient(ellipse, rgba(124,58,237,0.45) 0%, transparent 70%)",
        filter: "blur(24px)",
      }} />

      {/* Browser chrome */}
      <motion.div
        initial={{ opacity: 0, y: 40, rotateX: 8 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 1.1, delay: 0.3, ease: [0.16, 1, 0.3, 1] }}
        style={{
          background: "rgba(10,4,30,0.92)",
          border: "1px solid rgba(139,92,246,0.25)",
          borderRadius: "16px",
          overflow: "hidden",
          boxShadow: "0 32px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(139,92,246,0.1), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        {/* Title bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-white/5">
          <div className="flex gap-1.5">
            {["#ff5f57","#febc2e","#28c840"].map((c) => (
              <div key={c} className="w-2.5 h-2.5 rounded-full" style={{ background: c, opacity: 0.7 }} />
            ))}
          </div>
          <div className="flex-1 mx-3 flex items-center gap-2 px-3 py-1 rounded-md text-xs"
            style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.3)" }}>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            fidcaster.xyz
          </div>
          <div className="w-4 h-4 rounded text-white/20 flex items-center justify-center">
            <ExternalLink className="w-3 h-3" />
          </div>
        </div>

        {/* App layout */}
        <div className="flex" style={{ height: 360 }}>
          {/* Left nav */}
          <div className="flex flex-col items-center gap-5 py-4 px-2.5 border-r border-white/5"
            style={{ background: "rgba(255,255,255,0.015)" }}>
            <FidCasterLogo size={24} showName={false} />
            <div className="flex-1 flex flex-col gap-3 mt-2">
              {[
                { icon: <Layers className="w-4 h-4" />, active: true },
                { icon: <Search className="w-4 h-4" />, active: false },
                { icon: <Bell className="w-4 h-4" />, active: false },
                { icon: <Tag className="w-4 h-4" />, active: false },
                { icon: <Wallet className="w-4 h-4" />, active: false },
              ].map((item, i) => (
                <div key={i}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
                  style={{
                    background: item.active ? "rgba(124,58,237,0.25)" : "transparent",
                    color: item.active ? "#a78bfa" : "rgba(255,255,255,0.22)",
                    border: item.active ? "1px solid rgba(124,58,237,0.3)" : "none",
                  }}>
                  {item.icon}
                </div>
              ))}
            </div>
          </div>

          {/* Feed */}
          <div className="flex-1 overflow-hidden">
            {/* Tabs */}
            <div className="flex gap-0 border-b border-white/5">
              {["Following", "For You", "Channels"].map((t, i) => (
                <button key={t} className="px-4 py-2.5 text-xs font-semibold transition-all"
                  style={{
                    color: i === 0 ? "#a78bfa" : "rgba(255,255,255,0.2)",
                    borderBottom: i === 0 ? "2px solid #a78bfa" : "2px solid transparent",
                  }}>
                  {t}
                </button>
              ))}
            </div>

            {/* Cast cards */}
            <div className="overflow-hidden relative" style={{ height: 315 }}>
              <AnimatePresence mode="popLayout">
                {MOCK_FEED.map((cast, i) => (
                  <motion.div
                    key={cast.fid + cast.time}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: i === 0 ? 1 : 0.65 - i * 0.12, y: i * 88, scale: 1 - i * 0.02 }}
                    exit={{ opacity: 0, y: -30 }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute inset-x-0 mx-0 px-4 py-3 border-b border-white/[0.04]"
                    style={{ top: 0 }}
                  >
                    <div className="flex gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0"
                        style={{ background: cast.color, boxShadow: `0 0 10px ${cast.color}50` }}>
                        {cast.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className="text-white text-xs font-semibold">{cast.handle}</span>
                          <span className="text-white/20 text-[10px]">·</span>
                          <span className="text-white/25 text-[10px]">{cast.time} ago</span>
                          {cast.channel && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                              style={{ background: "rgba(124,58,237,0.15)", color: "#c4b5fd" }}>
                              /{cast.channel}
                            </span>
                          )}
                        </div>
                        <p className="text-white/70 text-[11px] leading-relaxed line-clamp-2">{cast.text}</p>
                        {cast.hasImage && (
                          <div className="mt-1.5 rounded-lg overflow-hidden" style={{
                            height: 28, background: "linear-gradient(135deg, rgba(124,58,237,0.2), rgba(192,38,211,0.2))",
                            border: "1px solid rgba(139,92,246,0.2)",
                          }}>
                            <div className="w-full h-full flex items-center justify-center">
                              <span className="text-[9px] text-white/30">chart.png</span>
                            </div>
                          </div>
                        )}
                        <div className="flex items-center gap-4 mt-2">
                          {[
                            { icon: <Heart className="w-3 h-3" />, count: cast.likes },
                            { icon: <Repeat2 className="w-3 h-3" />, count: cast.recasts },
                            { icon: <MessageCircle className="w-3 h-3" />, count: cast.replies },
                          ].map((a, j) => (
                            <button key={j} className="flex items-center gap-1 text-[10px] transition-colors"
                              style={{ color: "rgba(255,255,255,0.22)" }}>
                              {a.icon}
                              <span>{a.count > 999 ? `${(a.count / 1000).toFixed(1)}k` : a.count}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )).slice(0, 4)}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/* ─── Activity ticker ─── */
function ActivityTicker({ activity, listings }: { activity: MarketActivity[]; listings: MarketListing[] }) {
  const [offset, setOffset] = useState(0);

  // Real data only: prefer the on-chain activity feed; if it's empty, fall back
  // to current listings rendered as "Listed" entries. Never mock data.
  const items = activity.length > 0
    ? activity.map((a) => ({
        key: `${a.transactionHash}:${a.type}`,
        type: a.type,
        fid: a.fid,
        price: a.type === "cancelled" ? "" : `${parseFloat(a.priceEth).toFixed(3)} ETH`,
      }))
    : listings.map((l) => ({
        key: `l-${l.fid}`,
        type: "listed" as const,
        fid: l.fid,
        price: `${parseFloat(l.priceEth).toFixed(3)} ETH`,
      }));

  useEffect(() => {
    if (items.length === 0) return;
    const t = setInterval(() => setOffset((v) => v + 1), 2800);
    return () => clearInterval(t);
  }, [items.length]);

  if (items.length === 0) return null; // nothing on-chain yet · hide the strip

  const visible = items.concat(items); // duplicate for a seamless loop

  return (
    <div className="relative overflow-hidden rounded-xl py-3"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="absolute left-0 top-0 bottom-0 w-8 pointer-events-none" style={{
        background: "linear-gradient(to right, rgba(4,1,16,0.9), transparent)", zIndex: 2,
      }} />
      <div className="absolute right-0 top-0 bottom-0 w-8 pointer-events-none" style={{
        background: "linear-gradient(to left, rgba(4,1,16,0.9), transparent)", zIndex: 2,
      }} />
      <motion.div
        animate={{ x: `${-offset * 220}px` }}
        transition={{ duration: 2.4, ease: "easeInOut" }}
        className="flex items-center gap-6 px-6 whitespace-nowrap"
        style={{ width: "max-content" }}
      >
        {visible.map((act, i) => (
          <div key={`${act.key}-${i}`} className="flex items-center gap-2 text-xs">
            <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse",
              act.type === "sold" ? "bg-emerald-400" :
              act.type === "listed" ? "bg-violet-400" : "bg-orange-400"
            )} />
            <span style={{ color: act.type === "sold" ? "#34d399" : act.type === "listed" ? "#c4b5fd" : "#fb923c" }}>
              {act.type === "sold" ? "Sold" : act.type === "listed" ? "Listed" : "Cancelled"}
            </span>
            <span className="text-white font-semibold">FID #{act.fid}</span>
            {act.price && <span style={{ color: "rgba(255,255,255,0.4)" }}>{act.price}</span>}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/* ─── FID listing card ─── */
function ListingCard({ listing, index }: { listing: MarketListing; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  const sellerShort = listing.seller.length >= 10
    ? `${listing.seller.slice(0, 6)}…${listing.seller.slice(-4)}`
    : listing.seller;
  const ageMs = Date.now() - listing.listedAt * 1000;
  const ageLabel = ageMs < 3_600_000
    ? `${Math.floor(ageMs / 60_000)}m ago`
    : ageMs < 86_400_000
    ? `${Math.floor(ageMs / 3_600_000)}h ago`
    : `${Math.floor(ageMs / 86_400_000)}d ago`;

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 30, scale: 0.95 }}
      animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
      transition={{ duration: 0.5, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      className="group cursor-pointer relative rounded-2xl p-5 transition-all duration-300"
      style={{
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.07)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "rgba(124,58,237,0.08)";
        e.currentTarget.style.borderColor = "rgba(124,58,237,0.25)";
        e.currentTarget.style.transform = "translateY(-3px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.03)";
        e.currentTarget.style.borderColor = "rgba(255,255,255,0.07)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="text-xs text-white/30 mb-0.5 uppercase tracking-widest font-semibold">FID</div>
          <div className="text-3xl font-black text-white" style={{ letterSpacing: "-0.03em" }}>
            #{listing.fid}
          </div>
        </div>
        <span
          className="text-xs font-bold px-2 py-1 rounded-full text-emerald-400"
          style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.2)" }}
        >
          Listed
        </span>
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] text-white/25 uppercase tracking-widest mb-0.5">Price</div>
          <div className="text-white font-extrabold text-lg">
            {parseFloat(listing.priceEth).toFixed(4)} <span className="text-white/40 text-sm font-normal">ETH</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-white/25 mb-0.5">Seller</div>
          <div className="text-white/40 text-xs font-mono">{sellerShort}</div>
          <div className="text-white/20 text-[10px]">{ageLabel}</div>
        </div>
      </div>
      <a
        href="/market"
        className="mt-4 block w-full py-2 rounded-xl text-xs font-bold text-center transition-all duration-200 opacity-0 group-hover:opacity-100"
        style={{
          background: "rgba(124,58,237,0.25)",
          border: "1px solid rgba(124,58,237,0.4)",
          color: "#c4b5fd",
        }}
      >
        Buy on Optimism →
      </a>
    </motion.div>
  );
}

/* ─── Feature card ─── */
function FeatureCard({ feat, index }: { feat: { icon: React.ReactNode; title: string; desc: string; color: string }; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      animate={inView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.7, delay: index * 0.09, ease: [0.16, 1, 0.3, 1] }}
      className="group p-5 rounded-2xl transition-all duration-300 cursor-default"
      style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `rgba(${feat.color.slice(1).match(/.{2}/g)?.map((h: string) => parseInt(h, 16)).join(",") ?? "124,58,237"},0.07)`;
        e.currentTarget.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "rgba(255,255,255,0.025)";
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      <div className="w-10 h-10 rounded-xl flex items-center justify-center mb-4 transition-transform duration-300 group-hover:scale-110"
        style={{ background: `${feat.color}18`, border: `1px solid ${feat.color}30`, color: feat.color }}>
        {feat.icon}
      </div>
      <h3 className="text-white font-bold text-sm mb-2">{feat.title}</h3>
      <p className="text-white/35 text-xs leading-relaxed">{feat.desc}</p>
    </motion.div>
  );
}

/* ─── Section heading ─── */
function SectionHeading({ tag, title, sub }: { tag: string; title: React.ReactNode; sub: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  return (
    <div ref={ref} className="text-center mb-12 md:mb-16">
      <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 0.5 }}
        className="inline-block text-xs font-bold tracking-[0.2em] uppercase mb-4 px-3 py-1.5 rounded-full"
        style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.22)", color: "#a78bfa" }}>
        {tag}
      </motion.div>
      <motion.h2 initial={{ opacity: 0, y: 24 }} animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7, delay: 0.05 }}
        className="text-3xl md:text-5xl font-black text-white mb-4" style={{ letterSpacing: "-0.025em" }}>
        {title}
      </motion.h2>
      <motion.p initial={{ opacity: 0, y: 14 }} animate={inView ? { opacity: 1, y: 0 } : {}}
        transition={{ duration: 0.7, delay: 0.12 }}
        className="text-base max-w-xl mx-auto" style={{ color: "rgba(255,255,255,0.3)" }}>
        {sub}
      </motion.p>
    </div>
  );
}

/* ════════════════════════════════════════
   MAIN LANDING PAGE
════════════════════════════════════════ */
export function LoginPage() {
  const [, navigate] = useLocation();
  const { market, network, listings, activity } = useLandingStats(90_000);

  const clientFeatures = LANDING_FEATURE_DATA.map((f, i) => ({
    icon: FEATURE_ICONS[i] ?? FEATURE_ICONS[0],
    ...f,
  }));
  const displayListings = listings.filter(l => l.buyable).slice(0, 6);

  /* ── Derived live values (fall back to placeholder "·" until loaded) ── */
  const mktVolume   = market ? formatVolume(market.totalVolumeEth) : "·";
  const mktListings = market ? formatCount(market.activeListings)   : "·";
  const mktTrades   = market ? formatCount(market.totalTrades)      : "·";
  const mktAvgPrice = market ? `${parseFloat(market.avgPriceEth).toFixed(3)} ETH` : "·";
  const netUsers    = network?.userCount ? formatUserCount(network.userCount) : "·";

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden" style={{ background: "#040110" }}>
      <AnimatedBackground />

      {/* ── NAV ── */}
      <motion.nav
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
        className="fixed top-0 left-0 right-0 flex items-center justify-between px-6 md:px-10 py-4"
        style={{
          zIndex: 50,
          background: "rgba(4,1,16,0.7)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
          backdropFilter: "blur(20px)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <FidCasterLogo size={28} showName={false} />
          <span className="text-white font-black text-base" style={{ letterSpacing: "-0.02em" }}>FidCaster</span>
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
          <a href="#client" className="hover:text-white/70 transition-colors">Client</a>
          <a href="#market" className="hover:text-white/70 transition-colors">FID Market</a>
          <a href="#features" className="hover:text-white/70 transition-colors">Features</a>
          <a href="https://docs.fidcaster.xyz" className="hover:text-white/70 transition-colors">Docs</a>
          <button onClick={() => navigate("/download")} className="hover:text-white/70 transition-colors">Download</button>
          <a href="/legal" className="hover:text-white/70 transition-colors">Legal</a>
        </div>
        <button
          onClick={() => navigate("/login")}
          className="flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-all duration-200"
          style={{
            background: "rgba(124,58,237,0.18)",
            border: "1px solid rgba(124,58,237,0.35)",
            color: "#c4b5fd",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(124,58,237,0.32)";
            e.currentTarget.style.borderColor = "rgba(124,58,237,0.6)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "rgba(124,58,237,0.18)";
            e.currentTarget.style.borderColor = "rgba(124,58,237,0.35)";
          }}
        >
          Sign In <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </motion.nav>

      {/* ── HERO ── */}
      <section id="client" className="relative min-h-screen flex flex-col lg:flex-row items-center justify-center gap-12 px-6 md:px-12 pt-28 pb-20" style={{ zIndex: 1 }}>

        {/* Spinning rings */}
        {[
          { size: "min(680px,90vw)", dur: "28s", opacity: 0.06 },
          { size: "min(460px,65vw)", dur: "18s", opacity: 0.045, reverse: true },
        ].map((ring, i) => (
          <div key={i} className="absolute top-1/2 left-1/2 pointer-events-none"
            style={{ transform: "translate(-50%,-50%)", zIndex: 0 }}>
            <div style={{
              width: ring.size, height: ring.size, borderRadius: "50%",
              border: `1px solid rgba(139,92,246,${ring.opacity})`,
              animation: `${ring.reverse ? "lp-spin-reverse" : "lp-spin-slow"} ${ring.dur} linear infinite`,
            }} />
          </div>
        ))}

        {/* Left: text */}
        <div className="relative flex-1 max-w-xl text-center lg:text-left" style={{ zIndex: 2 }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.7, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-semibold mb-6"
            style={{
              background: "rgba(124,58,237,0.12)",
              border: "1px solid rgba(124,58,237,0.26)",
              color: "#c4b5fd",
            }}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Farcaster Client · Live on Optimism
            <Zap className="w-3 h-3 text-yellow-400" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="text-[3.2rem] md:text-[4.5rem] lg:text-[3.8rem] xl:text-[5rem] font-black tracking-tight mb-5 leading-none"
            style={{ letterSpacing: "-0.035em" }}
          >
            <span className="lp-gradient-text">Cast. Connect.</span>
            <br />
            <span className="text-white">Trade your</span>
            <br />
            <span className="lp-gradient-text">Farcaster ID.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="text-base md:text-lg mb-3 max-w-md mx-auto lg:mx-0"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            The only Farcaster client with a built-in peer-to-peer FID marketplace on Optimism.
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.27 }}
            className="text-sm mb-8 max-w-sm mx-auto lg:mx-0"
            style={{ color: "rgba(255,255,255,0.22)" }}
          >
            No registration. No email. Just your Farcaster identity · ready in seconds.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.33 }}
            className="flex flex-col sm:flex-row gap-3 justify-center lg:justify-start mb-8"
          >
            <button className="lp-cta-btn" onClick={() => navigate("/login")}>
              <span className="flex items-center gap-2.5">
                Enter App
                <ArrowRight className="w-4 h-4" />
              </span>
            </button>
            <a href="/market" className="lp-secondary-btn inline-flex items-center gap-2">
              <TrendingUp className="w-4 h-4" />
              Explore FID Market
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.45 }}
            className="flex flex-wrap gap-x-4 gap-y-2 justify-center lg:justify-start mb-6"
            style={{ color: "rgba(255,255,255,0.2)" }}
          >
            {["No registration", "No email", "Open source", "On Optimism"].map((t) => (
              <span key={t} className="flex items-center gap-1.5 text-xs">
                <CheckCircle2 className="w-3 h-3 text-emerald-500/60" />
                {t}
              </span>
            ))}
          </motion.div>

          {/* Live Farcaster network stat strip */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.5 }}
            className="flex flex-wrap items-center gap-4 justify-center lg:justify-start"
          >

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs"
              style={{ background: "rgba(162,28,175,0.08)", border: "1px solid rgba(162,28,175,0.15)" }}>
              <TrendingUp className="w-3 h-3" style={{ color: "#e879f9" }} />
              <span style={{ color: "rgba(255,255,255,0.5)" }}>FIDs on market:</span>
              <span className={cn(
                "font-bold transition-all duration-700",
                mktListings === "·" ? "text-white/20" : "text-fuchsia-300"
              )}>{mktListings}</span>
            </div>
          </motion.div>
        </div>

        {/* Right: Mock client preview */}
        <div className="relative flex-1 max-w-sm lg:max-w-md xl:max-w-lg" style={{ zIndex: 2 }}>
          <MockAppPreview />
        </div>
      </section>

      {/* ── FID MARKET ── */}
      <section id="market" className="relative px-6 md:px-12 py-24" style={{ zIndex: 1 }}>
        {/* Market section bg */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 80% 60% at 50% 50%, rgba(162,28,175,0.09) 0%, transparent 70%)",
        }} />

        <div className="max-w-6xl mx-auto">
          <SectionHeading
            tag="FID Marketplace"
            title={<>Trade Farcaster IDs.<br /><span className="lp-gradient-text" style={{
              backgroundImage: "linear-gradient(135deg, #e879f9 0%, #a855f7 50%, #818cf8 100%)",
            }}>On-chain. Peer-to-peer.</span></>}
            sub="The first FID marketplace built into a Farcaster client. List your FID, set a price, let the market decide. Zero intermediaries · everything settles on Optimism."
          />

          {/* Stats bar · live from on-chain indexer */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {[
              { label: "Total Volume", value: mktVolume,   icon: <BarChart2 className="w-4 h-4" />, color: "#c026d3" },
              { label: "Active Listings", value: mktListings, icon: <Tag className="w-4 h-4" />,     color: "#7c3aed" },
              { label: "Transactions",   value: mktTrades,  icon: <Activity className="w-4 h-4" />, color: "#6366f1" },
              { label: "Avg. Price",     value: mktAvgPrice,icon: <Zap className="w-4 h-4" />,      color: "#0ea5e9" },
            ].map((s, i) => (
              <motion.div
                key={s.label}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08, ease: [0.34, 1.56, 0.64, 1] }}
                className="p-4 rounded-2xl text-center"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
              >
                <div className="flex justify-center mb-2" style={{ color: s.color }}>{s.icon}</div>
                <div className={cn(
                  "font-black text-xl transition-all duration-500",
                  s.value === "·" ? "text-white/20" : "text-white"
                )} style={{ letterSpacing: "-0.02em" }}>{s.value}</div>
                <div className="text-white/25 text-xs mt-0.5">{s.label}</div>
              </motion.div>
            ))}
          </div>
          {/* Data source note */}
          {market && (
            <p className="text-center text-white/15 text-xs mb-6" style={{ letterSpacing: "0.02em" }}>
              Live data from Optimism · {market.isReady ? "indexed" : "indexing…"} ·{" "}
              {market.lastUpdated > 0
                ? `updated ${Math.floor((Date.now() - market.lastUpdated) / 60000)}m ago`
                : "loading"}
            </p>
          )}

          {/* Activity ticker */}
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-white/30 font-semibold uppercase tracking-widest">Live Activity</span>
            </div>
            <ActivityTicker activity={activity} listings={listings} />
          </div>

          {/* Listing grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {displayListings.length > 0
              ? displayListings.map((listing, i) => (
                  <ListingCard key={listing.fid} listing={listing} index={i} />
                ))
              : Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="rounded-2xl p-5 animate-pulse"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", minHeight: 140 }} />
                ))
            }
          </div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.6 }}
            className="text-center mt-10"
          >
            <a href="/market"
              className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-full font-bold text-sm transition-all duration-200"
              style={{
                background: "linear-gradient(135deg, rgba(162,28,175,0.25), rgba(124,58,237,0.25))",
                border: "1px solid rgba(162,28,175,0.35)",
                color: "#e879f9",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(162,28,175,0.4), rgba(124,58,237,0.4))"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "linear-gradient(135deg, rgba(162,28,175,0.25), rgba(124,58,237,0.25))"; }}
            >
              Browse all listings <ChevronRight className="w-4 h-4" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* ── CLIENT FEATURES ── */}
      <section id="features" className="relative px-6 md:px-12 py-24" style={{ zIndex: 1 }}>
        <div className="max-w-5xl mx-auto">
          <SectionHeading
            tag="Client Features"
            title={<>Everything you need<br /><span className="lp-gradient-text">to live on Farcaster</span></>}
            sub="FidCaster is a full-featured Farcaster client · cast, reply, follow, browse channels, manage your identity, and trade your FID. All in one place."
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {clientFeatures.map((feat, i) => (
              <FeatureCard key={feat.title} feat={feat} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="relative px-6 md:px-12 py-24" style={{ zIndex: 1 }}>
        <div className="max-w-4xl mx-auto">
          <SectionHeading
            tag="How it works"
            title="Live on Farcaster in 60 seconds"
            sub="No accounts to create. No email. No passwords to remember. Just your Farcaster identity."
          />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                step: "01",
                title: "Sign in",
                desc: "Open FidCaster and sign in with your Farcaster account. Everything runs locally · nothing is sent anywhere.",
                color: "#7c3aed",
              },
              {
                step: "02",
                title: "Set a password",
                desc: "Protect your session with a password. Next time you open the app, one click brings you back in.",
                color: "#6366f1",
              },
              {
                step: "03",
                title: "Cast, follow, trade",
                desc: "Full Farcaster client access. Post casts, follow people, and trade FIDs on Optimism.",
                color: "#c026d3",
              },
            ].map((step, i) => (
                <motion.div
                  key={step.step}
                  initial={{ opacity: 0, y: 40 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  transition={{ duration: 0.7, delay: i * 0.15, ease: [0.16, 1, 0.3, 1] }}
                  className="relative p-6 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {i < 2 && (
                    <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 text-white/10">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  )}
                  <div className="text-5xl font-black mb-4 lp-gradient-text" style={{ letterSpacing: "-0.04em", opacity: 0.6 }}>
                    {step.step}
                  </div>
                  <h3 className="text-white font-bold text-base mb-2">{step.title}</h3>
                  <p className="text-white/35 text-sm leading-relaxed">{step.desc}</p>
                </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ── */}
      <section className="relative px-6 md:px-12 py-24" style={{ zIndex: 1 }}>
        <div className="max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{ duration: 1, ease: [0.16, 1, 0.3, 1] }}
            className="relative rounded-3xl p-12 md:p-16 text-center overflow-hidden"
            style={{
              background: "linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(162,28,175,0.12) 50%, rgba(99,102,241,0.1) 100%)",
              border: "1px solid rgba(139,92,246,0.22)",
            }}
          >
            <div className="lp-shimmer" style={{ "--shimmer-delay": "3s" } as React.CSSProperties} />
            <div className="absolute top-0 left-1/2 -translate-x-1/2 pointer-events-none" style={{
              width: 500, height: 200,
              background: "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.25) 0%, transparent 70%)",
              filter: "blur(30px)",
            }} />
            <div className="relative">
              <div className="flex justify-center mb-6">
                <FidCasterLogo size={56} showName={false} />
              </div>
              <h2 className="text-3xl md:text-5xl font-black text-white mb-4" style={{ letterSpacing: "-0.025em" }}>
                Ready to cast?
              </h2>
              <p className="text-base max-w-sm mx-auto mb-8" style={{ color: "rgba(255,255,255,0.35)" }}>
                Open FidCaster, sign in to your Farcaster account, and start casting with full ownership of your identity.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button className="lp-cta-btn" onClick={() => navigate("/login")}>
                  <span className="flex items-center gap-2.5">
                    Open FidCaster
                    <ArrowRight className="w-4 h-4" />
                  </span>
                </button>
                <a href="/market" className="lp-secondary-btn inline-flex items-center gap-2">
                  <Tag className="w-4 h-4" />
                  FID Market
                </a>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative px-6 md:px-12 py-8 border-t" style={{ borderColor: "rgba(255,255,255,0.05)", zIndex: 1 }}>
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <FidCasterLogo size={22} showName={false} />
            <span className="text-white/50 text-sm font-semibold">FidCaster</span>
            <span className="text-white/20 text-xs">· The Farcaster client for power users.</span>
          </div>
          <div className="flex items-center gap-6 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
            <a href="/download" className="hover:text-white/50 transition-colors">Download</a>
            <a href="https://docs.fidcaster.xyz" className="hover:text-white/50 transition-colors">Docs</a>
            <a href="/legal" className="hover:text-white/50 transition-colors">Legal</a>
            <span>© {new Date().getFullYear()} FidCaster</span>
          </div>
          {/* Social icons */}
          <div className="flex items-center gap-3" style={{ color: "rgba(255,255,255,0.25)" }}>
            <a href="https://x.com/fidcaster" target="_blank" rel="noopener noreferrer" className="hover:text-white/60 transition-colors">
              <XLogo size={14} />
            </a>
            <a href="https://t.me/Fidcaster" target="_blank" rel="noopener noreferrer" className="hover:text-white/60 transition-colors">
              <TelegramLogo size={14} />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
