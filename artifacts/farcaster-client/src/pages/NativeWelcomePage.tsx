import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { FidCasterLogo } from "@/components/FidCasterLogo";

/**
 * First screen an installed app (Capacitor native, or an installed/standalone
 * PWA) shows when logged out — replaces the old behavior of redirecting
 * straight from the splash screen into the login form with zero transition.
 * Distinct on purpose from both the marketing LoginPage (a browser-tab
 * landing page full of feature sections) and AuthPage (the actual sign-in
 * form): this is a single, calm "welcome" beat that continues the splash
 * screen's dark background so the open→splash→here→login sequence reads as
 * one deliberate flow instead of a jarring flash into a form.
 */
export function NativeWelcomePage() {
  const [, navigate] = useLocation();

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center px-8 text-white overflow-hidden"
      style={{ background: "#0E111B" }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(ellipse 70% 50% at 50% 35%, rgba(124,58,237,0.22) 0%, transparent 70%)",
      }} />

      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative flex flex-col items-center"
      >
        <FidCasterLogo size={104} showName={false} />
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.25 }}
          className="mt-2 text-3xl font-black tracking-tight"
        >
          FidCaster
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.4 }}
          className="mt-2 text-white/45 text-[15px] text-center max-w-[280px]"
        >
          Your Farcaster identity, casts, and FID — all in one place.
        </motion.p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.6 }}
        className="relative w-full max-w-xs mt-14"
      >
        <button
          onClick={() => navigate("/login")}
          className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl bg-white text-[#0E111B] font-bold text-[16px] transition-transform active:scale-[0.97] shadow-[0_8px_30px_rgba(255,255,255,0.12)]"
        >
          Get Started <ArrowRight className="w-4 h-4" />
        </button>
        <p className="text-center text-white/25 text-xs mt-4">
          A Farcaster client · built on Optimism
        </p>
      </motion.div>
    </div>
  );
}
