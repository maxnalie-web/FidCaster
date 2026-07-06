import { useState, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { FidCasterLogo } from "@/components/FidCasterLogo";
import { SeedPhraseInput } from "@/components/SeedPhraseInput";
import { WalletConnectLogin } from "@/components/WalletConnectLogin";
import { FarcasterSignIn } from "@/components/FarcasterSignIn";
import { useWallet } from "@/hooks/useWallet";
import { clearStoredSession } from "@/lib/session-crypto";
import { validateMnemonicWords, validateWord } from "@/lib/wallet";
import { wordlist } from "@scure/bip39/wordlists/english";
import { validateMnemonic } from "@scure/bip39";
import {
  Loader2, ShieldCheck, Eye, EyeOff, ClipboardPaste,
  Grid3x3, Lock, KeyRound, ArrowLeft, ArrowRight,
  Wallet, QrCode, KeySquare, AlertTriangle, Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";

type InputMode = "grid" | "text";
type Step = "choose" | "phrase" | "setPassword" | "unlock" | "wallet" | "farcaster";

function parseMnemonic(raw: string): string[] {
  return raw.trim().toLowerCase().split(/[\s,\n\r\t]+/)
    .map((w) => w.replace(/[^a-z]/g, "")).filter(Boolean);
}

function mnemonicErrorHint(phrase: string): string {
  const words = parseMnemonic(phrase);
  if (words.length !== 12 && words.length !== 24)
    return `You entered ${words.length} words. A valid phrase is exactly 12 or 24 words.`;
  const bad = words.filter((w) => !wordlist.includes(w));
  if (bad.length > 0)
    return `These words are not in the BIP39 wordlist: ${bad.slice(0, 4).join(", ")}${bad.length > 4 ? "…" : ""}.`;
  return "The checksum doesn't match. Check the word order.";
}

function PasswordStrengthBar({ password }: { password: string }) {
  const score = Math.min(4, [
    password.length >= 8, password.length >= 12,
    /[A-Z]/.test(password), /[0-9!@#$%^&*]/.test(password),
  ].filter(Boolean).length);
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-500", "bg-orange-400", "bg-yellow-400", "bg-emerald-400"];
  if (!password) return null;
  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className={cn("h-1 flex-1 rounded-full transition-colors duration-300",
            i <= score ? colors[score] : "bg-white/10")} />
        ))}
      </div>
      <p className={cn("text-xs", score >= 3 ? "text-emerald-400" : "text-white/40")}>{labels[score]}</p>
    </div>
  );
}

function SecurityNote({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 p-3.5 rounded-xl"
      style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.14)" }}>
      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
      <p className="text-xs text-white/38 leading-relaxed">{text}</p>
    </div>
  );
}

function Particles() {
  const particles = useMemo(() =>
    Array.from({ length: 28 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: Math.random() * 2.5 + 0.5,
      duration: Math.random() * 22 + 12,
      delay: Math.random() * 18,
      color: i % 4 === 0
        ? "rgba(240,171,252,0.6)"
        : i % 3 === 0
        ? "rgba(129,140,248,0.5)"
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

const AUTH_METHODS = [
  {
    id: "farcaster" as Step,
    icon: QrCode,
    title: "Sign In With Farcaster",
    desc: "Scan a QR code in Farcaster. No seed phrase needed, full access instantly, including posting.",
    badge: "Fastest",
    gradient: "linear-gradient(135deg, rgba(168,85,247,0.22), rgba(99,102,241,0.10))",
    border: "rgba(168,85,247,0.35)",
    iconBg: "linear-gradient(135deg, #a855f7, #6366f1)",
  },
  {
    id: "phrase" as Step,
    icon: KeySquare,
    title: "Recovery Phrase",
    desc: "Sign in with your 12- or 24-word BIP39 seed phrase. Full access, including posting.",
    badge: "Full access",
    gradient: "linear-gradient(135deg, rgba(124,58,237,0.18), rgba(139,92,246,0.06))",
    border: "rgba(124,58,237,0.3)",
    iconBg: "linear-gradient(135deg, #7c3aed, #a855f7)",
  },
  {
    id: "wallet" as Step,
    icon: Wallet,
    title: "Connect Wallet",
    desc: "Connect MetaMask or any WalletConnect wallet. Auto-detects your Farcaster ID.",
    badge: null,
    gradient: "linear-gradient(135deg, rgba(99,102,241,0.16), rgba(79,70,229,0.06))",
    border: "rgba(99,102,241,0.28)",
    iconBg: "linear-gradient(135deg, #6366f1, #4f46e5)",
  },
] as const;

export function AuthPage() {
  const { login, unlockWithPassword, logout, isLoading, error, hasStoredSession, isCheckingSession } = useWallet();
  const [, navigate] = useLocation();

  const [mode, setMode] = useState<InputMode>("grid");
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(Array(12).fill(""));
  const [rawText, setRawText] = useState("");
  const [showWords, setShowWords] = useState(false);
  const [step, setStep] = useState<Step>("choose");
  const [pendingMnemonic, setPendingMnemonic] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const handleClearSession = useCallback(async () => {
    await clearStoredSession();
    logout();
    setShowClearConfirm(false);
    setPassword("");
    setStep("choose");
  }, [logout]);

  const handleWordsChange = useCallback((w: string[]) => setWords(w), []);
  const handleWordCountChange = (count: 12 | 24) => {
    setWordCount(count);
    setWords(Array(count).fill(""));
    setShowWords(false);
  };

  const gridMnemonic = words.join(" ").trim().toLowerCase();
  const textMnemonic = rawText.trim().toLowerCase();
  const activeMnemonic = mode === "grid" ? gridMnemonic : textMnemonic;
  const textWords = parseMnemonic(textMnemonic);
  const isGridValid = validateMnemonicWords(words);
  const isTextValid = (textWords.length === 12 || textWords.length === 24) && textWords.every((w) => validateWord(w));
  const isPhraseValid = mode === "grid" ? isGridValid : isTextValid;
  const isPasswordValid = password.length >= 8;
  const isPasswordMatch = password === confirmPassword;
  const canSetPassword = isPasswordValid && isPasswordMatch;

  const displayError = error
    ? (error.includes("Invalid mnemonic") ? mnemonicErrorHint(activeMnemonic) : error)
    : null;

  const currentStep: Step = hasStoredSession ? "unlock" : step;

  const baseInputStyle: React.CSSProperties = {
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "white",
    outline: "none",
    width: "100%",
    padding: "0.75rem 1rem",
    borderRadius: "0.75rem",
    fontSize: "0.875rem",
    fontWeight: 500,
    transition: "all 0.2s",
  };

  function handlePhraseNext(e: React.FormEvent) {
    e.preventDefault();
    if (!isPhraseValid || isLoading) return;
    const phrase = mode === "grid" ? gridMnemonic : textWords.join(" ");
    if (!validateMnemonic(phrase, wordlist)) return;
    setPendingMnemonic(phrase);
    setPassword(""); setConfirmPassword("");
    setStep("setPassword");
  }

  async function handleSetPasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSetPassword || isLoading) return;
    await login(pendingMnemonic, password);
  }

  async function handleUnlockSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password || isLoading) return;
    await unlockWithPassword(password);
  }

  if (isCheckingSession) {
    return (
      <div className="fixed inset-0 flex items-center justify-center" style={{ background: "#040110" }}>
        <div className="relative flex flex-col items-center gap-4">
          <Loader2 className="w-6 h-6 animate-spin text-violet-400" />
          <p className="text-white/25 text-xs tracking-widest uppercase">Checking session…</p>
        </div>
      </div>
    );
  }

  const isSubFlow = currentStep === "wallet" || currentStep === "farcaster";

  return (
    <div className="relative min-h-screen text-white overflow-hidden flex flex-col items-center justify-center px-4 py-8"
      style={{ background: "#040110" }}>

      {/* Background */}
      <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        <div className="absolute inset-0" style={{
          background: "radial-gradient(ellipse 80% 60% at 50% -10%, #12052e 0%, #060018 45%, #020008 100%)",
        }} />
        <div className="absolute inset-0 lp-grid-bg" />
        <div className="absolute lp-orb-1" style={{
          top: "0%", left: "5%", width: "60vw", height: "60vw", maxWidth: 700, maxHeight: 700,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(124,58,237,0.2) 0%, transparent 68%)",
          filter: "blur(60px)",
        }} />
        <div className="absolute lp-orb-2" style={{
          bottom: "10%", right: "0%", width: "45vw", height: "45vw", maxWidth: 600, maxHeight: 600,
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)",
          filter: "blur(70px)",
        }} />
        <Particles />
      </div>

      {/* Back button · goes to landing page (or to chooser from sub-flows) */}
      {!isSubFlow && (
        <motion.button
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          onClick={() => {
            if (currentStep === "phrase" || currentStep === "setPassword") {
              setStep("choose");
            } else {
              navigate("/");
            }
          }}
          className="fixed top-5 left-5 flex items-center gap-2 text-white/30 hover:text-white/70 transition-colors text-sm font-medium"
          style={{ zIndex: 10 }}
        >
          <ArrowLeft className="w-4 h-4" />
          {currentStep === "phrase" || currentStep === "setPassword" ? "Back" : "Back"}
        </motion.button>
      )}

      {/* Card */}
      <motion.div
        initial={{ opacity: 0, y: 32, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-md"
        style={{ zIndex: 1 }}
      >
        {/* Logo + title */}
        {!isSubFlow && (
          <div className="flex flex-col items-center mb-8">
            <motion.div
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }}
              className="mb-4 relative"
            >
              <div className="lp-glow-breathe absolute inset-0 rounded-full pointer-events-none" style={{
                background: "radial-gradient(circle, rgba(139,92,246,0.35) 0%, transparent 68%)",
                transform: "scale(2.4)",
              }} />
              <FidCasterLogo size={56} showName={false} />
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-white font-black text-2xl"
              style={{ letterSpacing: "-0.02em" }}
            >
              {currentStep === "unlock" ? "Welcome back" : "Enter FidCaster"}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.18 }}
              className="text-white/35 text-sm mt-1"
            >
              {currentStep === "unlock"
                ? "Your encrypted session is ready"
                : "Sign in to your Farcaster account"}
            </motion.p>
          </div>
        )}

        {/* Form card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="lp-glass-card p-7 md:p-8"
        >
          <div className="lp-shimmer" style={{ "--shimmer-delay": "2s" } as React.CSSProperties} />

          <AnimatePresence mode="wait">

            {/* CHOOSE METHOD */}
            {currentStep === "choose" && (
              <motion.div key="choose"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}
                className="space-y-3.5">
                <p className="text-[11px] font-semibold text-white/30 uppercase tracking-widest mb-1">
                  Choose sign-in method
                </p>
                {AUTH_METHODS.map((m, i) => {
                  const Icon = m.icon;
                  return (
                    <motion.button
                      key={m.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35, delay: 0.05 * i }}
                      onClick={() => setStep(m.id)}
                      className="group w-full text-left rounded-2xl p-4 transition-all hover:scale-[1.015] active:scale-[0.985]"
                      style={{
                        background: m.gradient,
                        border: `1px solid ${m.border}`,
                        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
                      }}
                    >
                      <div className="flex items-center gap-3.5">
                        <div
                          className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 shadow-lg"
                          style={{ background: m.iconBg }}
                        >
                          <Icon className="w-5 h-5 text-white" strokeWidth={2} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-white font-bold text-[0.9375rem]">{m.title}</span>
                            {m.badge && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white/80 uppercase tracking-wide"
                                style={{ background: "rgba(255,255,255,0.12)" }}>
                                {m.badge}
                              </span>
                            )}
                          </div>
                          <p className="text-white/40 text-xs mt-1 leading-relaxed">{m.desc}</p>
                        </div>
                        <ArrowRight className="w-4 h-4 text-white/25 shrink-0 group-hover:text-white/50 group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </motion.button>
                  );
                })}
              </motion.div>
            )}

            {/* WALLET CONNECT */}
            {currentStep === "wallet" && (
              <motion.div key="wallet"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                <WalletConnectLogin onBack={() => setStep("choose")} />
              </motion.div>
            )}

            {/* FARCASTER SIGN IN */}
            {currentStep === "farcaster" && (
              <motion.div key="farcaster"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                <FarcasterSignIn onBack={() => setStep("choose")} />
              </motion.div>
            )}

            {/* UNLOCK */}
            {currentStep === "unlock" && (
              <motion.div key="unlock"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}
                className="space-y-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}>
                    <Lock className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-base">Unlock Session</h2>
                    <p className="text-white/35 text-xs">Encrypted vault found in this browser</p>
                  </div>
                </div>
                <form onSubmit={handleUnlockSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-white/35 uppercase tracking-widest">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        autoFocus
                        style={{ ...baseInputStyle, paddingRight: "2.75rem" }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.1)"; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
                      />
                      <button type="button" onClick={() => setShowPassword((v: boolean) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  {displayError && (
                    <div className="p-3 rounded-xl text-sm text-red-300 leading-relaxed"
                      style={{ background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      {displayError}
                    </div>
                  )}
                  <button type="submit" disabled={!password || isLoading} className="lp-cta-btn w-full">
                    {isLoading
                      ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Unlocking…</span>
                      : <span className="flex items-center justify-center gap-2">Unlock <ArrowRight className="w-4 h-4" /></span>}
                  </button>
                </form>
                <SecurityNote text="Your session is stored locally in this browser. Nothing is ever sent to a server." />

                {/* Forgot password */}
                {!showClearConfirm ? (
                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => setShowClearConfirm(true)}
                      className="text-xs text-white/30 hover:text-red-400/70 transition-colors underline underline-offset-2">
                      Forgot password? Clear session
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl p-4 space-y-3"
                    style={{ background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-red-300/90 leading-relaxed">
                        This will erase your encrypted vault from this browser. You will need your <strong className="text-red-300">12 or 24-word recovery phrase</strong> to sign in again.
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setShowClearConfirm(false)}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold text-white/50 hover:text-white/80 transition-colors"
                        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleClearSession}
                        className="flex-1 py-2 rounded-lg text-xs font-semibold text-red-300 hover:text-red-200 transition-colors flex items-center justify-center gap-1.5"
                        style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)" }}>
                        <Trash2 className="w-3.5 h-3.5" />
                        Clear &amp; Start Over
                      </button>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* SET PASSWORD */}
            {currentStep === "setPassword" && (
              <motion.div key="setPassword"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}
                className="space-y-5">
                <div className="flex items-center gap-3">
                  <button onClick={() => setStep("phrase")} className="text-white/30 hover:text-white/60 transition-colors p-1">
                    <ArrowLeft className="w-4 h-4" />
                  </button>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}>
                    <KeyRound className="w-5 h-5 text-violet-400" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-base">Protect Your Session</h2>
                    <p className="text-white/35 text-xs">Set a password · one click to get back in next time</p>
                  </div>
                </div>
                <form onSubmit={handleSetPasswordSubmit} className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-white/35 uppercase tracking-widest">New Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        autoFocus
                        style={{ ...baseInputStyle, paddingRight: "2.75rem" }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.1)"; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
                      />
                      <button type="button" onClick={() => setShowPassword((v: boolean) => !v)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60 transition-colors">
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <PasswordStrengthBar password={password} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold text-white/35 uppercase tracking-widest">Confirm Password</label>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Repeat your password"
                      style={{ ...baseInputStyle, borderColor: confirmPassword && !isPasswordMatch ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.08)" }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.1)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = confirmPassword && !isPasswordMatch ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
                    />
                    {confirmPassword && !isPasswordMatch && <p className="text-xs text-red-400">Passwords don't match</p>}
                  </div>
                  {displayError && (
                    <div className="p-3 rounded-xl text-sm text-red-300"
                      style={{ background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      {displayError}
                    </div>
                  )}
                  <button type="submit" disabled={!canSetPassword || isLoading} className="lp-cta-btn w-full">
                    {isLoading
                      ? <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Encrypting…</span>
                      : "Set Password & Enter"}
                  </button>
                </form>
                <SecurityNote text="Your session is saved locally in this browser and expires after 30 days. Nothing is sent to any server." />
              </motion.div>
            )}

            {/* PHRASE */}
            {currentStep === "phrase" && (
              <motion.div key="phrase"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}
                className="space-y-5">
                <div className="flex items-center justify-between">
                  <h2 className="text-white font-bold text-base">Recovery Phrase</h2>
                  <div className="flex gap-0.5 p-0.5 rounded-lg"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    {(["grid", "text"] as InputMode[]).map((m) => (
                      <button key={m} onClick={() => setMode(m)}
                        className={cn("flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200",
                          mode === m ? "text-white" : "text-white/35 hover:text-white/60")}
                        style={mode === m ? { background: "rgba(124,58,237,0.5)" } : {}}>
                        {m === "grid" ? <><Grid3x3 className="w-3 h-3" />Grid</> : <><ClipboardPaste className="w-3 h-3" />Paste</>}
                      </button>
                    ))}
                  </div>
                </div>

                {mode === "grid" && (
                  <div className="flex gap-1 p-0.5 rounded-lg w-fit"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}>
                    {([12, 24] as const).map((n) => (
                      <button key={n} onClick={() => handleWordCountChange(n)}
                        className={cn("px-3 py-1.5 rounded-md text-xs font-semibold transition-all duration-200",
                          wordCount === n ? "text-white" : "text-white/35 hover:text-white/60")}
                        style={wordCount === n ? { background: "rgba(124,58,237,0.5)" } : {}}>
                        {n} words
                      </button>
                    ))}
                  </div>
                )}

                {mode === "grid" && (
                  <div className="relative">
                    <div className={cn("transition-all duration-300",
                      !showWords && "blur-[5px] select-none pointer-events-none opacity-40")}>
                      <SeedPhraseInput key={wordCount} wordCount={wordCount} onChange={handleWordsChange} />
                    </div>
                    {!showWords && (
                      <button type="button" onClick={() => setShowWords(true)}
                        className="absolute inset-0 w-full h-full flex items-center justify-center cursor-pointer">
                        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-violet-300"
                          style={{ background: "rgba(124,58,237,0.18)", border: "1px solid rgba(124,58,237,0.35)" }}>
                          <Eye className="w-4 h-4" />
                          Click to reveal words
                        </div>
                      </button>
                    )}
                  </div>
                )}

                {mode === "grid" && showWords && (
                  <button type="button" onClick={() => setShowWords(false)}
                    className="flex items-center gap-1.5 text-xs text-white/30 hover:text-white/55 transition-colors mx-auto">
                    <EyeOff className="w-3.5 h-3.5" /> Hide phrase
                  </button>
                )}

                {mode === "text" && (
                  <div className="space-y-2">
                    <p className="text-xs text-white/30">Paste your 12- or 24-word phrase, separated by spaces.</p>
                    <textarea
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      placeholder="word1 word2 word3 …"
                      autoCapitalize="none" autoComplete="off" autoCorrect="off" spellCheck={false}
                      rows={4}
                      style={{ ...baseInputStyle, fontFamily: "var(--font-mono)", resize: "none", lineHeight: 1.65 }}
                      onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(139,92,246,0.5)"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(139,92,246,0.1)"; }}
                      onBlur={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.boxShadow = "none"; }}
                    />
                    {rawText.length > 0 && (
                      <p className={cn("text-xs", isTextValid ? "text-emerald-400" : "text-white/30")}>
                        {textWords.length} words{isTextValid ? " ✓ ready" : " entered"}
                      </p>
                    )}
                  </div>
                )}

                {displayError && (
                  <div className="p-3 rounded-xl text-sm text-red-300 leading-relaxed"
                    style={{ background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    {displayError}
                  </div>
                )}

                <form onSubmit={handlePhraseNext}>
                  <button type="submit" disabled={!isPhraseValid || isLoading} className="lp-cta-btn w-full">
                    <span className="flex items-center justify-center gap-2">
                      Continue <ArrowRight className="w-4 h-4" />
                    </span>
                  </button>
                </form>
                <SecurityNote text="Your credentials are processed entirely in your browser. Nothing is transmitted to any server." />
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>
      </motion.div>
    </div>
  );
}
