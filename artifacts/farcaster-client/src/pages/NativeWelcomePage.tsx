import { motion } from "framer-motion";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { FidCasterLogo } from "@/components/FidCasterLogo";
import { XLogo, TelegramLogo, FarcasterLogo } from "@/components/NeynarScoreBadge";
/**
 * First screen an installed app (Capacitor native, or an installed/standalone
 * PWA) shows when logged out - replaces the old behavior of redirecting
 * straight from the splash screen into the login form with zero transition.
 * Distinct on purpose from both the marketing LoginPage (a browser-tab
 * landing page full of feature sections) and AuthPage (the actual sign-in
 * form): this is a single, calm "welcome" beat that continues the splash
 * screen's dark background so the open→splash→here→login sequence reads as
 * one deliberate flow instead of a jarring flash into a form.
 */
const SOCIAL = {
  twitter: "https://x.com/fidcaster",
  telegram: "https://t.me/Fidcaster",
  farcaster: "https://farcaster.xyz/fidcaster",
};

export function NativeWelcomePage() {
  const [, navigate] = useLocation();
  const social = SOCIAL;

  return (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center px-8 text-white overflow-hidden"
      style={{
        background: "#0E111B",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
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
          Your Farcaster identity, casts, and FID, all in one place.
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

        {(social.twitter || social.telegram || social.farcaster) && (
          <div className="flex items-center justify-center gap-4 mt-7">
            {social.twitter && (
              <a
                href={social.twitter}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow on X"
                className="w-10 h-10 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
              >
                <XLogo size={16} />
              </a>
            )}
            {social.telegram && (
              <a
                href={social.telegram}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Join Telegram"
                className="w-10 h-10 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/10 hover:bg-white/10 transition-colors"
              >
                <TelegramLogo size={18} />
              </a>
            )}
            {social.farcaster && (
              <a
                href={social.farcaster}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow on Farcaster"
                className="w-10 h-10 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/10 hover:bg-white/10 transition-colors"
              >
                <FarcasterLogo size={18} />
              </a>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
}
