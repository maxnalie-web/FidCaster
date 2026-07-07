import { motion } from "framer-motion";
import { useLocation } from "wouter";
import {
  ArrowLeft, Apple, Smartphone, Share, SquarePlus, Clock, Sparkles,
} from "lucide-react";
import { FidCasterLogo } from "@/components/FidCasterLogo";

/* ─── Shared background (mirrors LoginPage's tone, lighter weight) ─── */
function BackgroundGlow() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }}>
      <div className="absolute inset-0" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% -10%, #12052e 0%, #060018 45%, #020008 100%)",
      }} />
      <div className="absolute" style={{
        top: "0%", left: "10%", width: "55vw", height: "55vw", maxWidth: 700, maxHeight: 700,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(124,58,237,0.2) 0%, rgba(109,40,217,0.06) 45%, transparent 68%)",
        filter: "blur(60px)",
      }} />
      <div className="absolute" style={{
        bottom: "5%", right: "5%", width: "45vw", height: "45vw", maxWidth: 600, maxHeight: 600,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(99,102,241,0.16) 0%, rgba(79,70,229,0.05) 50%, transparent 70%)",
        filter: "blur(70px)",
      }} />
    </div>
  );
}

/* ─── "Coming soon" badge ─── */
function SoonBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide"
      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.45)" }}>
      <Clock className="w-3 h-3" />
      Coming soon
    </span>
  );
}

function AvailableBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide"
      style={{ background: "rgba(52,211,153,0.12)", border: "1px solid rgba(52,211,153,0.25)", color: "#34d399" }}>
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
      Available now
    </span>
  );
}

/* ─── Platform card shell ─── */
function PlatformCard({
  icon, title, subtitle, badge, children,
}: {
  icon: React.ReactNode; title: string; subtitle: string; badge: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-3xl p-7 md:p-8"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div className="flex items-start justify-between mb-5">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.3)", color: "#c4b5fd" }}>
          {icon}
        </div>
        {badge}
      </div>
      <h3 className="text-white font-black text-xl mb-1.5">{title}</h3>
      <p className="text-white/35 text-sm mb-5 leading-relaxed">{subtitle}</p>
      {children}
    </motion.div>
  );
}

/* ─── Numbered instruction step ─── */
function Step({ n, icon, text }: { n: number; icon: React.ReactNode; text: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold mt-0.5"
        style={{ background: "rgba(124,58,237,0.2)", color: "#c4b5fd" }}>
        {n}
      </div>
      <div className="flex-1 flex items-center gap-2 text-sm text-white/60 leading-relaxed">
        {icon}
        <span>{text}</span>
      </div>
    </div>
  );
}

export function DownloadPage() {
  const [, navigate] = useLocation();

  return (
    <div className="relative min-h-screen text-white overflow-x-hidden" style={{ background: "#040110" }}>
      <BackgroundGlow />

      {/* ── NAV ── */}
      <nav className="fixed top-0 left-0 right-0 flex items-center justify-between px-6 md:px-10 py-4"
        style={{
          zIndex: 50, background: "rgba(4,1,16,0.7)",
          borderBottom: "1px solid rgba(255,255,255,0.05)", backdropFilter: "blur(20px)",
        }}
      >
        <button onClick={() => navigate("/")} className="flex items-center gap-2.5">
          <FidCasterLogo size={28} showName={false} />
          <span className="text-white font-black text-base" style={{ letterSpacing: "-0.02em" }}>FidCaster</span>
        </button>
        <button
          onClick={() => navigate("/")}
          className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200"
          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.6)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back home
        </button>
      </nav>

      <section className="relative px-6 md:px-12 pt-32 pb-24 max-w-4xl mx-auto" style={{ zIndex: 1 }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <div className="inline-block text-xs font-bold tracking-[0.2em] uppercase mb-4 px-3 py-1.5 rounded-full"
            style={{ background: "rgba(124,58,237,0.12)", border: "1px solid rgba(124,58,237,0.22)", color: "#a78bfa" }}>
            Download
          </div>
          <h1 className="text-3xl md:text-5xl font-black text-white mb-4" style={{ letterSpacing: "-0.025em" }}>
            Get FidCaster on your phone
          </h1>
          <p className="text-base max-w-lg mx-auto" style={{ color: "rgba(255,255,255,0.35)" }}>
            Native apps for Android and iOS are on the way. In the meantime, install FidCaster
            as a full-screen app straight from your browser — no App Store needed.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
          {/* ── Android ── */}
          <PlatformCard
            icon={<Smartphone className="w-6 h-6" />}
            title="Android"
            subtitle="A native Android app is in the works."
            badge={<SoonBadge />}
          />

          {/* ── iOS (native) ── */}
          <PlatformCard
            icon={<Apple className="w-6 h-6" />}
            title="iOS"
            subtitle="A native iOS app is in the works."
            badge={<SoonBadge />}
          />
        </div>

        {/* ── iOS PWA install (available now) ── */}
        <PlatformCard
          icon={<Sparkles className="w-6 h-6" />}
          title="Install the web app on iOS"
          subtitle="No App Store, no waiting — add FidCaster to your Home Screen right now and it opens full-screen, just like a native app."
          badge={<AvailableBadge />}
        >
          <div className="rounded-2xl p-5 space-y-4"
            style={{ background: "rgba(0,0,0,0.25)", border: "1px solid rgba(255,255,255,0.06)" }}>
            <Step n={1} icon={null} text={<>Open <b className="text-white/80">fidcaster.xyz</b> in <b className="text-white/80">Safari</b> (this only works in Safari, not Chrome or another browser).</>} />
            <Step n={2} icon={<Share className="w-4 h-4 text-violet-300 shrink-0" />} text={<>Tap the <b className="text-white/80">Share</b> icon in the bottom toolbar.</>} />
            <Step n={3} icon={<SquarePlus className="w-4 h-4 text-violet-300 shrink-0" />} text={<>Scroll down and tap <b className="text-white/80">"Add to Home Screen"</b>.</>} />
            <Step n={4} icon={null} text={<>Tap <b className="text-white/80">"Add"</b> in the top-right corner.</>} />
          </div>
          <p className="text-white/25 text-xs mt-4">
            FidCaster now lives on your Home Screen with its own icon — tap it to open full-screen, no browser bar, just like the native app.
          </p>
        </PlatformCard>

        {/* Android PWA note */}
        <p className="text-center text-white/20 text-xs mt-8">
          On Android? You can already install FidCaster from Chrome too — open the menu (⋮) and tap <b className="text-white/40">"Add to Home screen"</b>.
        </p>
      </section>
    </div>
  );
}
