import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useWallet } from "@/hooks/useWallet";
import { useUnreadNotifications } from "@/hooks/useUnreadNotifications";
import { UsernameChange } from "@/components/UsernameChange";
import { hubUpdateUserData } from "@/lib/hub-submit";
import { FeedPanel } from "@/components/FeedPanel";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { WalletPanel } from "@/components/WalletPanel";
import { MiniAppsPanel } from "@/components/MiniAppsPanel";
import { ProfilePage } from "@/pages/ProfilePage";
import { FidSoldScreen } from "@/components/FidSoldScreen";
import { FarcasterSignIn } from "@/components/FarcasterSignIn";
import { CastComposer } from "@/components/CastComposer";
import { useTheme } from "@/App";
import { getFontSize, applyFontSize, getReduceMotion, applyReduceMotion, type FontSize } from "@/lib/app-settings";
import { isInstalledApp } from "@/lib/miniapp-native";
import { clearAllCaches } from "@/lib/farcaster-db";
import {
  Home, Bell, Search, User, LogOut, AtSign,
  FileText, MessageSquare, Settings, Wallet,
  Plus, X, Loader2, CheckCircle2, Clock, UserCircle,
  Sun, Moon, AlertCircle, PenSquare, Copy,
  MoreHorizontal, Tag, KeyRound, QrCode, ChevronLeft, Layers, Camera, Shield,
  Info, AlertTriangle, UserPlus, TrendingUp, Globe,
  LifeBuoy, Sparkles, Lock, Zap, ExternalLink, Hash, Type, Wind, Trash2,
} from "lucide-react";
import { getUserByFid, type NeynarUser } from "@/lib/neynar";
import { NeynarScoreBadge, XLogo, TelegramLogo, FarcasterLogo } from "@/components/NeynarScoreBadge";
import {
  SUPPORTED_LANGS, getLangSetting, setPreferredLang, defaultTargetLang,
  type LangCode, type LangSetting,
} from "@/lib/translate";
import { AddAccountModal, AccountDropdownPanel } from "@/components/AccountModals";
import { createWalletClient, custom } from "viem";
import { optimism } from "viem/chains";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type MainTab = "feed" | "notifications" | "search" | "wallet" | "profile" | "miniapps";
type ProfileSection = "posts" | "settings" | "support";
type SettingsTab = "app" | "username" | "signer" | "profile" | "language";

const SIDEBAR_ITEMS: { id: MainTab; label: string; icon: typeof Home }[] = [
  { id: "feed",          label: "Home",          icon: Home },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "search",        label: "Search",        icon: Search },
  { id: "miniapps",      label: "Mini Apps",     icon: Layers },
  { id: "wallet",        label: "Wallet",        icon: Wallet },
  { id: "profile",       label: "Profile",       icon: User },
];

const BOTTOM_NAV: { id: MainTab; icon: typeof Home }[] = [
  { id: "feed",          icon: Home },
  { id: "search",        icon: Search },
];


const SETTINGS_TABS: { id: SettingsTab; label: string; icon: typeof Home }[] = [
  { id: "app",      label: "App",      icon: Settings },
  { id: "username", label: "Username", icon: AtSign },
  { id: "signer",   label: "Signer",   icon: CheckCircle2 },
  { id: "language", label: "Language", icon: Globe },
];

/* ─── App Settings Panel · general app-wide preferences ──────────────────────── */
function ToggleRow({ icon, title, desc, checked, onChange }: {
  icon: React.ReactNode; title: string; desc: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl border border-border bg-muted/20">
      <div className="flex items-start gap-3 min-w-0">
        <span className="shrink-0 mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          "shrink-0 w-11 h-6 rounded-full transition-colors relative",
          checked ? "bg-primary" : "bg-muted-foreground/25"
        )}
      >
        {/* Positioned with `left` (not translate-x) · this project's Tailwind build
            doesn't emit a `transform` for translate-x utilities on this element
            (computed style showed `transform: none`), which left the thumb sitting
            at a stray left/right-constrained position that overflowed the track
            once toggled on. Plain `left` always works regardless of that. */}
        <span
          className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-[left]"
          style={{ left: checked ? 22 : 2 }}
        />
      </button>
    </div>
  );
}

const FONT_SIZE_OPTIONS: { id: FontSize; label: string }[] = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Default" },
  { id: "lg", label: "Large" },
];

function AppSettingsPanel() {
  const [theme, setTheme] = useTheme();
  const [fontSize, setFontSize] = useState<FontSize>(getFontSize);
  const [reduceMotion, setReduceMotion] = useState(getReduceMotion);
  const [clearing, setClearing] = useState(false);

  function changeFontSize(size: FontSize) {
    setFontSize(size);
    applyFontSize(size);
  }

  function changeReduceMotion(v: boolean) {
    setReduceMotion(v);
    applyReduceMotion(v);
  }

  async function handleClearCache() {
    setClearing(true);
    try {
      await clearAllCaches();
      toast.success("Cached data cleared");
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="space-y-6 max-w-md">
      <ToggleRow
        icon={theme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
        title="Dark mode"
        desc="Switch between light and dark appearance."
        checked={theme === "dark"}
        onChange={(v) => setTheme(v ? "dark" : "light")}
      />

      <ToggleRow
        icon={<Wind className="w-4 h-4" />}
        title="Reduce motion"
        desc="Cuts most hover, theme, and transition animations app-wide."
        checked={reduceMotion}
        onChange={changeReduceMotion}
      />

      <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2.5">
        <div className="flex items-center gap-3">
          <Type className="w-4 h-4 text-muted-foreground shrink-0" />
          <div>
            <p className="text-sm font-semibold text-foreground">Text size</p>
            <p className="text-xs text-muted-foreground mt-0.5">Changes text size across the whole app.</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {FONT_SIZE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => changeFontSize(opt.id)}
              className={cn(
                "py-2 rounded-lg border text-xs font-semibold transition-all",
                fontSize === opt.id ? "bg-primary/10 border-primary/30 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-start justify-between gap-4 p-3.5 rounded-xl border border-border bg-muted/20">
        <div className="flex items-start gap-3 min-w-0">
          <Trash2 className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-foreground">Clear cached data</p>
            <p className="text-xs text-muted-foreground mt-0.5">Wipes locally cached feeds, profiles, and notifications. Your account and keys aren't touched.</p>
          </div>
        </div>
        <button
          onClick={handleClearCache}
          disabled={clearing}
          className="shrink-0 px-3.5 py-2 rounded-xl border border-border bg-background text-xs font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-50"
        >
          {clearing ? "Clearing…" : "Clear"}
        </button>
      </div>
    </div>
  );
}

/* ─── Support / About Panel ────────────────────────────────────────────────── */
const PILLARS: { icon: typeof Zap; title: string; desc: string }[] = [
  { icon: Zap,      title: "Built for growth",  desc: "Grow finds and follows the right people for you · quality-filtered, never spammy." },
  { icon: Lock,     title: "Your keys, always", desc: "Posting keys are generated and signed on your device. FidCaster never holds your seed phrase." },
  { icon: Sparkles, title: "Signal over noise", desc: "Neynar quality scores, Pro status, and verified accounts surface right on every profile." },
  { icon: Shield,   title: "Built to last",     desc: "Every write goes straight to the Farcaster protocol · nothing about your identity lives only in our servers." },
];

function SupportPanel() {
  const [founder, setFounder] = useState<NeynarUser | null>(null);
  const [, navigate] = useLocation();
  useEffect(() => {
    getUserByFid(16333, 16333, "").then(res => setFounder(res.users?.[0] ?? null)).catch(() => {});
  }, []);

  const goToFounder = (e: React.MouseEvent) => { e.preventDefault(); navigate(`/profile/16333`); };

  return (
    <div className="max-w-lg space-y-6">
      {/* ── Hero ── */}
      <div className="relative overflow-hidden rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/10 via-violet-500/5 to-background px-6 py-9 text-center">
        <div className="pointer-events-none absolute -top-20 -right-16 w-56 h-56 rounded-full bg-primary/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-12 w-40 h-40 rounded-full bg-violet-600/15 blur-3xl" />
        <div className="relative space-y-3">
          <div className="w-20 h-20 mx-auto flex items-center justify-center">
            <img src="/fidcaster-logo-v2.png" alt="" className="w-20 h-20 object-contain drop-shadow-lg" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
          </div>
          <h2 className="text-2xl font-black tracking-tight bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
            FidCaster
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-xs mx-auto">
            The fastest, most focused way to grow and manage a Farcaster identity,
            crafted like a tool you'd actually want to open every day.
          </p>
        </div>
      </div>

      {/* ── Pillars ── */}
      <div className="grid grid-cols-2 gap-2.5">
        {PILLARS.map((p) => {
          const Icon = p.icon;
          return (
            <div key={p.title} className="group p-4 rounded-2xl border border-border bg-card hover:border-primary/30 hover:shadow-lg hover:shadow-primary/5 transition-all space-y-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary/15 to-violet-500/15 flex items-center justify-center group-hover:scale-105 transition-transform">
                <Icon className="w-4.5 h-4.5 text-primary" />
              </div>
              <p className="text-[13px] font-bold text-foreground leading-tight">{p.title}</p>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{p.desc}</p>
            </div>
          );
        })}
      </div>

      {/* ── Founder ── */}
      <button onClick={goToFounder} className="w-full text-left block rounded-2xl border border-border bg-card overflow-hidden hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 transition-all">
        <div className="h-14 bg-gradient-to-r from-primary/25 via-violet-500/15 to-background" />
        <div className="px-5 pb-5 -mt-8 space-y-3">
          <div className="flex items-end gap-3">
            <div className="w-16 h-16 rounded-2xl overflow-hidden bg-muted shrink-0 ring-4 ring-card shadow-lg">
              {founder?.pfp_url ? (
                <img src={founder.pfp_url} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-violet-500/20"><User className="w-7 h-7 text-muted-foreground/40" /></div>
              )}
            </div>
            <span className="mb-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-primary text-white">
              Founder
            </span>
          </div>
          <div>
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-bold text-foreground text-[16px]">{founder?.display_name ?? "Maximus"}</p>
              {founder?.score !== undefined && <NeynarScoreBadge score={founder.score} />}
            </div>
            <p className="text-xs text-primary font-medium">@{founder?.username ?? "m--"}</p>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {founder?.profile?.bio?.text ?? "Building FidCaster: a professional-grade Farcaster client, one release at a time."}
          </p>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
            View profile <ExternalLink className="w-3 h-3" />
          </span>
        </div>
      </button>

      {/* ── Contact ── */}
      <div className="p-4 rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-transparent flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
          <LifeBuoy className="w-4.5 h-4.5 text-primary" />
        </div>
        <div>
          <p className="text-sm font-bold text-foreground">Need help or have feedback?</p>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5">
            Send a cast to <a href={`/profile/16333`} onClick={goToFounder} className="text-primary font-semibold hover:underline">@m--</a> or mention @fidcaster. Every message reaches the team directly.
          </p>
        </div>
      </div>

      {/* ── Social links ── */}
      <div className="flex items-center gap-2.5">
        <a href="https://x.com/fidcaster" target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-border bg-card text-sm font-semibold text-foreground hover:border-primary/30 hover:bg-accent transition-colors">
          <XLogo size={14} /> Follow on X
        </a>
        <a href="https://t.me/Fidcaster" target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-border bg-card text-sm font-semibold text-foreground hover:border-primary/30 hover:bg-accent transition-colors">
          <TelegramLogo size={14} /> Join Telegram
        </a>
        <a href="https://farcaster.xyz/fidcaster" target="_blank" rel="noopener noreferrer" className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-border bg-card text-sm font-semibold text-foreground hover:border-primary/30 hover:bg-accent transition-colors">
          <FarcasterLogo size={14} /> Follow on Farcaster
        </a>
      </div>
    </div>
  );
}

/* ─── Language / Translation Settings Panel ─────────────────────────────────── */
function LanguageSettingsPanel() {
  const [setting, setSetting] = useState<LangSetting>(() => getLangSetting());
  // The language "auto" resolves to · shown so the user can confirm detection.
  const detected = SUPPORTED_LANGS.find((l) => l.code === defaultTargetLang());

  return (
    <div className="space-y-6 max-w-md">
      <div className="space-y-2">
        <label className="text-[10px] font-bold uppercase tracking-widest text-foreground">Preferred language</label>
        <p className="text-xs text-muted-foreground">
          Tapping the translate icon on a cast always translates to this language. Choose
          <strong className="text-foreground"> Auto</strong> to follow your device's language
          {detected ? <> · currently detected as <strong className="text-foreground">{detected.label}</strong></> : null}.
        </p>
        <select
          value={setting}
          onChange={(e) => { const v = e.target.value as LangSetting; setSetting(v); setPreferredLang(v); }}
          className="w-full px-3 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="auto">Auto{detected ? ` (${detected.label})` : ""}</option>
          {SUPPORTED_LANGS.map((l) => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

/* ─── Signer Panel ───────────────────────────────────────────────────────── */
function SignerPanel({
  approved, loading, error, onRetry,
}: {
  approved: boolean; loading: boolean; error: string | null; onRetry: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  }

  const signerKeyMatch = error?.match(/Your signer key:\s*(0x[0-9a-fA-F]+)/);
  const signerKey = signerKeyMatch?.[1] ?? null;
  const displayError = error
    ? error.replace(/\n*Your signer key:\s*0x[0-9a-fA-F]+/, "").trim()
    : null;

  async function copyKey() {
    if (!signerKey) return;
    await navigator.clipboard.writeText(signerKey).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isInsufficientFunds = error?.toLowerCase().includes("eth on optimism") || error?.toLowerCase().includes("gas fee");

  return (
    <div className="space-y-4">
      <div className={cn(
        "flex items-start gap-3 p-4 rounded-xl border",
        approved
          ? "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800"
          : loading
            ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
            : "bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800"
      )}>
        {approved ? (
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
        ) : loading ? (
          <Loader2 className="w-5 h-5 text-amber-600 shrink-0 mt-0.5 animate-spin" />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-sm font-semibold",
            approved ? "text-emerald-700" : loading ? "text-amber-700" : "text-red-700"
          )}>
            {approved ? "Signer active" : loading ? "Registering signer on Farcaster…" : isInsufficientFunds ? "Needs ETH on Optimism" : "Signer not registered"}
          </p>
          <div className={cn(
            "text-xs mt-1 whitespace-pre-wrap leading-relaxed",
            approved ? "text-emerald-600/80" : loading ? "text-amber-600/80" : "text-red-600/80"
          )}>
            {approved
              ? "Your key is registered. You can like, recast, follow, and cast."
              : loading
                ? "Sending a one-time transaction on Optimism to register your key…"
                : displayError ?? "Unknown error"}
          </div>
        </div>
      </div>

      {!approved && !loading && signerKey && (
        <div className="p-3 rounded-xl bg-muted/30 border border-border space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Your derived signer key (Ed25519)
          </p>
          <div className="flex items-center gap-2">
            <code className="text-[11px] text-primary font-mono break-all flex-1 leading-relaxed">{signerKey}</code>
            <button onClick={copyKey} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors" title="Copy key">
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      )}

      {!approved && !loading && (
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="w-full py-2.5 rounded-full btn-luxury text-white text-sm font-semibold flex items-center justify-center gap-2"
        >
          {retrying ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          {retrying ? "Checking…" : isInsufficientFunds ? "Retry (after funding wallet)" : "Retry registration"}
        </button>
      )}
    </div>
  );
}

/* ─── Compose Modal ──────────────────────────────────────────────────────── */
function ComposeModal({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-lg bg-background rounded-2xl shadow-2xl border border-border flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-bold text-foreground">New Cast</span>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
          <CastComposer
            onPublished={() => { onPublished(); onClose(); }}
            onCanceled={onClose}
          />
        </div>
      </div>
    </div>
  );
}

/* ─── Mobile Drawer ──────────────────────────────────────────────────────── */
function MobileDrawer({
  open, onClose, profile, fid, accounts, switchAccount, removeAccount, logout, theme, setTheme, onAddAccount, onOpenSettings, onOpenSupport, onNavigateToProfile,
}: {
  open: boolean; onClose: () => void;
  profile: { pfpUrl?: string; username?: string; bio?: string; displayName?: string } | null;
  fid: number;
  accounts: { fid: number; username?: string; pfpUrl?: string }[];
  switchAccount: (fid: number) => void;
  removeAccount: (fid: number) => void;
  logout: () => void;
  theme: string; setTheme: (t: string) => void;
  onAddAccount: () => void; onOpenSettings: () => void; onOpenSupport: () => void;
  onNavigateToProfile: () => void;
}) {
  const [, navigate] = useLocation();
  const [showAccSheet, setShowAccSheet] = useState(false);
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm transition-opacity duration-300 md:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={() => { setShowAccSheet(false); onClose(); }}
      />
      <div
        className={cn(
          "fixed top-0 left-0 bottom-0 z-[56] w-72 bg-background border-r border-border flex flex-col transition-transform duration-300 ease-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="p-5" style={{ paddingTop: "max(2.5rem, env(safe-area-inset-top))" }}>
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => { onNavigateToProfile(); onClose(); }}
              className="w-14 h-14 rounded-full overflow-hidden bg-primary/10 ring-2 ring-border hover:ring-primary/50 transition-all shrink-0"
            >
              {profile?.pfpUrl ? (
                <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><UserCircle className="w-8 h-8 text-primary/40" /></div>
              )}
            </button>
            <div className="flex items-center gap-2">
              {accounts.filter(a => a.fid !== fid).slice(0, 2).map(acc => (
                <button
                  key={acc.fid}
                  onClick={() => { switchAccount(acc.fid); onClose(); }}
                  className="w-8 h-8 rounded-full overflow-hidden bg-muted ring-1 ring-border hover:ring-primary/50 transition-all shrink-0"
                >
                  {acc.pfpUrl
                    ? <img src={acc.pfpUrl} alt="" className="w-full h-full object-cover" />
                    : <UserCircle className="w-full h-full p-1 text-muted-foreground" />}
                </button>
              ))}
              <button
                onClick={() => setShowAccSheet(true)}
                className="w-9 h-9 rounded-full border border-border flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <MoreHorizontal className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
          <button
            onClick={() => { onNavigateToProfile(); onClose(); }}
            className="text-left w-full"
          >
            <p className="font-bold text-base text-foreground truncate">{profile?.displayName || profile?.username || `FID ${fid}`}</p>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">@{profile?.username || `fid${fid}`}</p>
          </button>
        </div>

        <div className="h-px bg-border mx-4" />

        <nav className="flex-1 px-3 py-1 space-y-0.5">
          <button onClick={() => { navigate("/channels"); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
            <Hash className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Channels</span>
          </button>
          <button onClick={() => { navigate("/market"); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
            <Tag className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">FID Market</span>
          </button>
          <button onClick={() => { navigate("/dashboard?tab=miniapps"); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
            <Layers className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Mini Apps</span>
          </button>
          <button onClick={() => { onOpenSettings(); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
            <Settings className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Settings</span>
          </button>
          <button onClick={() => { onOpenSupport(); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
            <LifeBuoy className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Support</span>
          </button>
        </nav>

        <div className="h-px bg-border mx-4" />
        <button
          onClick={() => { logout(); onClose(); }}
          className="flex items-center gap-3 w-full px-5 py-4 text-sm text-muted-foreground hover:text-destructive transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>

      {showAccSheet && (
        <>
          <div
            className="fixed inset-0 z-[57] bg-black/50 md:hidden"
            onClick={() => setShowAccSheet(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-[58] bg-background rounded-t-3xl pb-8 md:hidden shadow-2xl">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/25 mx-auto mt-3 mb-2" />
            <div className="flex items-center justify-between px-5 py-3">
              <button
                onClick={() => setShowAccSheet(false)}
                className="text-sm font-semibold text-primary"
              >
                Edit
              </button>
              <span className="text-sm font-bold text-foreground">Accounts</span>
              <div className="w-10" />
            </div>
            <div className="h-px bg-border mx-5 mb-1" />
            {accounts.map(acc => (
              <button
                key={acc.fid}
                onClick={() => {
                  if (acc.fid !== fid) switchAccount(acc.fid);
                  setShowAccSheet(false);
                  onClose();
                }}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-accent transition-colors"
              >
                <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                  {acc.pfpUrl
                    ? <img src={acc.pfpUrl} alt="" className="w-full h-full object-cover" />
                    : <UserCircle className="w-full h-full p-1 text-muted-foreground" />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{acc.username || `FID ${acc.fid}`}</p>
                  <p className="text-xs text-muted-foreground truncate">@{acc.username || `fid${acc.fid}`}</p>
                </div>
                {acc.fid === fid && <CheckCircle2 className="w-5 h-5 text-primary shrink-0" />}
              </button>
            ))}
            <div className="h-px bg-border mx-5 mt-1" />
            <button
              onClick={() => { setShowAccSheet(false); onAddAccount(); }}
              className="w-full flex items-center gap-3 px-5 py-4 text-primary text-sm font-semibold hover:bg-accent transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add an account
            </button>
          </div>
        </>
      )}
    </>
  );
}

/* ─── ProfileEditPanel ───────────────────────────────────────────────────── */
function ProfileEditPanel() {
  const { fid, localSigner, signerApproved, profile } = useWallet();
  const [displayName, setDisplayName] = useState(profile?.displayName || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [pfpUrl, setPfpUrl] = useState(profile?.pfpUrl || "");
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveField(field: "pfp" | "display" | "bio", value: string) {
    if (!fid || !localSigner || !signerApproved) return;
    if (!value.trim()) { toast.error("Value cannot be empty"); return; }
    setSaving(field);
    setError(null);
    setSuccess(null);
    try {
      await hubUpdateUserData(Number(fid), localSigner, field, value.trim());
      setSuccess(
        field === "pfp" ? "Profile picture updated!" :
        field === "display" ? "Display name updated!" : "Bio updated!"
      );
      setTimeout(() => setSuccess(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(null);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving("pfp-upload");
    setError(null);
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/farcaster/upload-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: dataUrl, type: file.type, fid: fid ? Number(fid) : undefined }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errData.error ?? "Upload failed");
      }
      const { url } = await res.json() as { url: string };
      setPfpUrl(url);
      await saveField("pfp", url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      if (saving === "pfp-upload") setSaving(null);
    }
  }

  if (!signerApproved || !localSigner || !fid) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <AlertCircle className="w-8 h-8 text-amber-500 opacity-60" />
        <p className="text-sm text-muted-foreground">Signer must be active to edit your Farcaster profile.</p>
        <p className="text-xs text-muted-foreground/60">Go to the Signer tab and register your key first.</p>
      </div>
    );
  }

  const isSaving = !!saving;

  return (
    <div className="space-y-6">
      {/* Profile Picture */}
      <div className="space-y-3">
        <label className="text-[10px] font-bold text-foreground uppercase tracking-widest">Profile Picture</label>
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-muted border border-border shrink-0">
            {pfpUrl ? (
              <img src={pfpUrl} alt="PFP preview" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <User className="w-7 h-7 text-muted-foreground/40" />
              </div>
            )}
          </div>
          <div className="flex-1 space-y-2">
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp" className="hidden" onChange={handleFileUpload} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-muted/30 text-xs font-semibold text-foreground hover:bg-accent transition-colors disabled:opacity-40"
            >
              <Camera className="w-3.5 h-3.5" />
              {saving === "pfp-upload" ? "Uploading…" : "Upload Photo"}
            </button>
            <div className="flex gap-2">
              <input
                value={pfpUrl}
                onChange={e => setPfpUrl(e.target.value)}
                placeholder="Or paste image URL (https://…)"
                className="flex-1 px-3 py-2 text-xs rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
              />
              <button
                onClick={() => saveField("pfp", pfpUrl)}
                disabled={isSaving || !pfpUrl.startsWith("https://")}
                className="px-3 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
              >
                {saving === "pfp" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Display Name */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-foreground uppercase tracking-widest">Display Name</label>
        <div className="flex gap-2">
          <input
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            maxLength={32}
            placeholder={profile?.displayName || "Your display name…"}
            className="flex-1 px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40"
          />
          <button
            onClick={() => saveField("display", displayName)}
            disabled={isSaving || !displayName.trim()}
            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 transition-colors shrink-0"
          >
            {saving === "display" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save"}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">{displayName.length}/32</p>
      </div>

      {/* Bio */}
      <div className="space-y-2">
        <label className="text-[10px] font-bold text-foreground uppercase tracking-widest">Bio</label>
        <textarea
          value={bio}
          onChange={e => setBio(e.target.value)}
          maxLength={256}
          rows={3}
          placeholder="Tell the world about yourself…"
          className="w-full px-3 py-2.5 text-sm rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/40 resize-none leading-relaxed"
        />
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-muted-foreground">{bio.length}/256</p>
          <button
            onClick={() => saveField("bio", bio)}
            disabled={isSaving || !bio.trim()}
            className="px-4 py-2 rounded-xl bg-primary text-white text-xs font-bold hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            {saving === "bio" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Save Bio"}
          </button>
        </div>
      </div>

      {success && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/8 border border-emerald-500/20 text-emerald-600 text-xs font-semibold">
          <CheckCircle2 className="w-4 h-4 shrink-0" /> {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/8 border border-red-500/20 text-red-500 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="p-3 rounded-xl bg-muted/30 border border-border/50 text-[10px] text-muted-foreground/60 leading-relaxed">
        Profile changes are submitted to the Farcaster hub and may take a few minutes to appear across apps.
      </div>
    </div>
  );
}

/* ─── DashboardPage ──────────────────────────────────────────────────────── */
export function DashboardPage() {
  const {
    fid, profile, signerApproved, autoSignerLoading, signerError,
    retrySignerSetup, accounts, logout, isLoading, addAccount, switchAccount, removeAccount,
    fidSold, authMethod, isCheckingSession, isLocked, error: walletError, neynarKey,
  } = useWallet();
  const [, navigate] = useLocation();
  const [theme, setTheme] = useTheme();

  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  useEffect(() => {
    if (walletError && (walletError.startsWith("Connect your wallet") || walletError.startsWith("Session locked"))) {
      setWalletNotice(walletError);
    } else {
      // Error cleared (e.g. wallet now connected) or it's a different error —
      // dismiss the sticky notice so it doesn't linger after the issue resolves.
      setWalletNotice(null);
      if (walletError) toast.error(walletError);
    }
  }, [walletError]);

  // Mini Apps is native/PWA-only (a plain web tab has no in-app browser or
  // SDK bridge to run them in) — hidden on plain web tabs.
  const miniAppsAllowed = false;
  const VALID_TABS: MainTab[] = ["feed", "notifications", "search", "wallet", "profile", ...(miniAppsAllowed ? (["miniapps"] as MainTab[]) : [])];
  const [mainTab, setMainTab] = useState<MainTab>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const t = p.get("tab") as MainTab | null;
      return t && VALID_TABS.includes(t) ? t : "feed";
    } catch { return "feed"; }
  });

  // Keep URL in sync with active tab so the browser back button restores the right tab.
  useEffect(() => {
    navigate(`/dashboard?tab=${mainTab}`, { replace: true });
  }, [mainTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const [profileSection, setProfileSection] = useState<ProfileSection>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      return p.get("section") === "settings" ? "settings" : "posts";
    } catch { return "posts"; }
  });
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("username");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showFabCompose, setShowFabCompose] = useState(false);
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const sidebarItems = SIDEBAR_ITEMS.filter((i) => miniAppsAllowed || i.id !== "miniapps");
  const bottomNavItems = BOTTOM_NAV;

  const { unread: unreadNotifs, markSeen: markNotifsSeen } = useUnreadNotifications(Number(fid), neynarKey);

  // Clear the bell badge whenever the user is viewing the Notifications tab.
  useEffect(() => {
    if (mainTab === "notifications") markNotifsSeen();
  }, [mainTab, markNotifsSeen]);

  useEffect(() => {
    // Auto-lock zeroes the session but keeps the encrypted vault · send the user
    // to the unlock screen, not the marketing landing.
    if (!isCheckingSession && !isLoading && !fid) navigate(isLocked ? "/login" : "/");
  }, [fid, isLoading, isCheckingSession, isLocked, navigate]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!fid && !fidSold) return null;
  if (fidSold) return <FidSoldScreen />;
  const fidNum = Number(fid);

  function openSettings(tab?: SettingsTab) {
    setMainTab("profile");
    setProfileSection("settings");
    if (tab) setSettingsTab(tab);
  }

  const showFab = mainTab === "feed" || mainTab === "notifications";

  /* ── Content area ──────────────────────────────────────── */
  function renderContent() {
    switch (mainTab) {
      case "feed":
        return <FeedPanel key={feedRefreshKey} />;
      case "notifications":
        return <NotificationsPanel />;
      case "search":
        return <SearchPanel />;
      case "miniapps":
        return <MiniAppsPanel />;
      case "wallet":
        return <WalletPanel />;
      case "profile":
        if (profileSection === "settings") {
          return (
            <div>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <button
                  onClick={() => setProfileSection("posts")}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold text-foreground">Settings</span>
              </div>
              <div className="flex gap-1 px-3 py-2.5 border-b border-border overflow-x-auto">
                {SETTINGS_TABS.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setSettingsTab(t.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all shrink-0",
                        settingsTab === t.id
                          ? "bg-primary text-white"
                          : "text-muted-foreground hover:text-foreground hover:bg-accent"
                      )}
                    >
                      <Icon className="w-3 h-3" />
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <div className="p-5">
                {settingsTab === "app" && <AppSettingsPanel />}
                {settingsTab === "username" && <UsernameChange />}
                {settingsTab === "signer" && (
                  <SignerPanel
                    approved={signerApproved}
                    loading={autoSignerLoading}
                    error={signerError}
                    onRetry={retrySignerSetup}
                  />
                )}
                {settingsTab === "profile" && <ProfileEditPanel />}
                {settingsTab === "language" && <LanguageSettingsPanel />}
              </div>
            </div>
          );
        }
        if (profileSection === "support") {
          return (
            <div>
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                <button
                  onClick={() => setProfileSection("posts")}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold text-foreground">Support</span>
              </div>
              <div className="p-5">
                <SupportPanel />
              </div>
            </div>
          );
        }
        return (
          <ProfilePage
            embedded
            showHeader
            fid={fidNum}
            onOpenSettings={(tab) => { setProfileSection("settings"); if (tab) setSettingsTab(tab); }}
          />
        );
    }
  }

  return (
    <div className="min-h-screen bg-background flex w-full overflow-x-hidden">

      {/* ── DESKTOP SIDEBAR ─────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-[240px] border-r border-border bg-background z-40">

        {/* Logo */}
        <div className="px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <img
              src="/fidcaster-logo-v2.png"
              alt="FidCaster"
              className="w-11 h-11 object-contain logo-animated shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className="fidcaster-brand font-extrabold text-[1.4rem]">FidCaster</span>
          </div>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
          {sidebarItems.map((item) => {
            const Icon = item.icon;
            const active = mainTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setMainTab(item.id)}
                className={cn("sidebar-item", active && "active")}
              >
                <span className="relative shrink-0">
                  <Icon
                    className={cn("w-[22px] h-[22px]", active ? "text-foreground" : "text-foreground/75")}
                    strokeWidth={active ? 2.5 : 2}
                  />
                  {item.id === "notifications" && unreadNotifs > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[17px] h-[17px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-none flex items-center justify-center ring-2 ring-background">
                      {unreadNotifs > 9 ? "9+" : unreadNotifs}
                    </span>
                  )}
                </span>
                <span className={cn("text-[0.9375rem]", active ? "text-foreground" : "text-foreground/85")}>
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* Grow link */}
          <button
            onClick={() => navigate("/follow")}
            className="sidebar-item"
          >
            <TrendingUp className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
            <span className="text-[0.9375rem] text-foreground/85">Grow</span>
          </button>

          {/* FID Market link */}
          <button
            onClick={() => navigate("/market")}
            className="sidebar-item"
          >
            <Tag className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
            <span className="text-[0.9375rem] text-foreground/85">FID Market</span>
          </button>

          {/* Channels link */}
          <button
            onClick={() => navigate("/channels")}
            className="sidebar-item"
          >
            <Hash className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
            <span className="text-[0.9375rem] text-foreground/85">Channels</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => openSettings()}
            className={cn("sidebar-item", mainTab === "profile" && profileSection === "settings" && "active")}
          >
            <Settings
              className={cn("w-[22px] h-[22px] shrink-0", mainTab === "profile" && profileSection === "settings" ? "text-foreground" : "text-foreground/75")}
              strokeWidth={mainTab === "profile" && profileSection === "settings" ? 2.5 : 2}
            />
            <span className={cn("text-[0.9375rem]", mainTab === "profile" && profileSection === "settings" ? "text-foreground" : "text-foreground/85")}>Settings</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="sidebar-item"
          >
            {theme === "dark"
              ? <Sun className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />
              : <Moon className="w-[22px] h-[22px] shrink-0 text-foreground/75" strokeWidth={2} />}
            <span className="text-[0.9375rem] text-foreground/85">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </nav>

        {/* Cast button */}
        <div className="px-4 pb-3">
          <button
            onClick={() => setShowFabCompose(true)}
            className="w-full py-3.5 rounded-full bg-primary text-white font-bold text-[0.9375rem] hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm flex items-center justify-center gap-2"
          >
            <PenSquare className="w-5 h-5" />
            Cast
          </button>
        </div>

        {/* Profile row (bottom) */}
        <div className="px-3 pb-4 relative" ref={accountMenuRef}>
          <div className="flex items-center gap-2.5 w-full px-3 py-2.5 rounded-full hover:bg-accent transition-colors">
            {/* Avatar + name → navigate to own profile */}
            <button
              onClick={() => fidNum ? navigate(`/profile/${fidNum}`) : undefined}
              className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
            >
              <div className="relative shrink-0">
                <div className="w-9 h-9 rounded-full overflow-hidden bg-muted ring-1 ring-border">
                  {profile?.pfpUrl ? (
                    <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-primary/10">
                      <UserCircle className="w-5 h-5 text-primary/50" />
                    </div>
                  )}
                </div>
                {/* Signer status dot */}
                <div title={autoSignerLoading ? "Registering signer…" : signerApproved ? "Signer active" : "Signer not registered · click Profile → Settings → Signer"} className={cn(
                  "absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background",
                  autoSignerLoading ? "bg-amber-400 animate-pulse" : signerApproved ? "bg-emerald-500" : "bg-red-500"
                )} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate leading-tight">
                  {profile?.displayName || profile?.username || `FID ${fidNum}`}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  @{profile?.username || `fid${fidNum}`}
                </p>
              </div>
            </button>
            {/* More → account menu */}
            <button
              onClick={() => setShowAccountMenu((v) => !v)}
              className="shrink-0 p-1 rounded-full hover:bg-muted/60 transition-colors"
            >
              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {showAccountMenu && (
            <AccountDropdownPanel
              accounts={accounts}
              currentFid={fidNum}
              onSwitch={(f) => { switchAccount(f); setShowAccountMenu(false); }}
              onAddAccount={() => { setShowAddAccount(true); setShowAccountMenu(false); }}
              onLogout={() => { logout(); setShowAccountMenu(false); }}
              onRemoveAccount={(f) => { void removeAccount(f); }}
            />
          )}
        </div>
      </aside>

      {/* ── MAIN AREA ────────────────────────────────────────────── */}
      <div className="md:ml-[240px] flex-1 min-w-0 min-h-screen flex flex-col">

        {/* ── MOBILE HEADER ──────────────────────────────────── */}
        {/* Hidden on the profile tab: ProfilePage renders its own banner-blur
            sticky header there (showHeader below) so "my profile" looks the
            same whether reached via the bottom nav or via tapping an avatar
            elsewhere in the app — previously this generic bar and that richer
            header were two different-looking headers for the same profile. */}
        {mainTab !== "profile" && (
        <header className="md:hidden sticky top-0 z-30 bg-background border-b border-border" style={{ paddingTop: "env(safe-area-inset-top)" }}>
          <div className="h-[53px] flex items-center justify-between px-4">
            {/* Avatar with signer dot */}
            <button onClick={() => setShowDrawer(true)} className="relative shrink-0">
              <div className="w-8 h-8 rounded-full overflow-hidden bg-muted ring-1 ring-border">
                {profile?.pfpUrl ? (
                  <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-primary/10">
                    <UserCircle className="w-4 h-4 text-primary/50" />
                  </div>
                )}
              </div>
              <div className={cn(
                "absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-background",
                autoSignerLoading ? "bg-amber-400 animate-pulse" : signerApproved ? "bg-emerald-500" : "bg-red-500"
              )} />
            </button>

            {/* Centered title */}
            <div className="absolute left-1/2 -translate-x-1/2">
              <span className="font-bold text-base text-foreground">
                {mainTab === "feed" ? "Home" : sidebarItems.find(t => t.id === mainTab)?.label ?? "FidCaster"}
              </span>
            </div>

            <button
              onClick={() => setMainTab("search")}
              className="p-2 rounded-full text-foreground/70 hover:bg-accent transition-colors"
            >
              <Search className="w-5 h-5" />
            </button>
          </div>
        </header>
        )}

        {/* ── CONTENT ────────────────────────────────────────── */}
        <div className="flex-1 max-w-[600px] w-full mx-auto pb-24 md:pb-0">
          {/* Locked-session banner · shown when feed is visible but posting is disabled */}
          {isLocked && fid && authMethod === "mnemonic" && (
            <button
              onClick={() => navigate("/login")}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/8 border-b border-amber-500/20 hover:bg-amber-500/12 transition-colors"
            >
              <KeyRound className="w-3.5 h-3.5 shrink-0" />
              <span>Posting locked · tap to re-enter password</span>
            </button>
          )}
          {renderContent()}
        </div>

        {/* ── MOBILE BOTTOM NAV ──────────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t border-border z-30 flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}><div className="flex h-[54px]">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = mainTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setMainTab(item.id)}
                className="flex-1 flex items-center justify-center transition-colors"
              >
                <span className="relative">
                  <Icon
                    className={cn("w-6 h-6", active ? "text-primary" : "text-muted-foreground")}
                    strokeWidth={active ? 2.5 : 2}
                  />
                  {item.id === "notifications" && unreadNotifs > 0 && (
                    <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none flex items-center justify-center ring-2 ring-background">
                      {unreadNotifs > 9 ? "9+" : unreadNotifs}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          {/* Grow tab - always shown (matches native MainTabs) */}
          <button
            onClick={() => navigate("/follow")}
            className="flex-1 flex items-center justify-center transition-colors"
          >
            <TrendingUp className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
          </button>
          {/* Wallet - always shown (matches native; WalletPanel handles no-wallet onboarding state) */}
          <button
            onClick={() => setMainTab("wallet")}
            className="flex-1 flex items-center justify-center transition-colors"
          >
            <Wallet
              className={cn("w-6 h-6", mainTab === "wallet" ? "text-primary" : "text-muted-foreground")}
              strokeWidth={mainTab === "wallet" ? 2.5 : 2}
            />
          </button>
          {/* Notifications · sits right next to Profile */}
          <button
            onClick={() => setMainTab("notifications")}
            className="flex-1 flex items-center justify-center transition-colors"
          >
            <span className="relative">
              <Bell
                className={cn("w-6 h-6", mainTab === "notifications" ? "text-primary" : "text-muted-foreground")}
                strokeWidth={mainTab === "notifications" ? 2.5 : 2}
              />
              {unreadNotifs > 0 && (
                <span className="absolute -top-1.5 -right-2 min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold leading-none flex items-center justify-center ring-2 ring-background">
                  {unreadNotifs > 9 ? "9+" : unreadNotifs}
                </span>
              )}
            </span>
          </button>
          {/* Profile · always last */}
          <button
            onClick={() => fidNum ? navigate(`/profile/${fidNum}`) : setMainTab("profile")}
            className="flex-1 flex items-center justify-center transition-colors"
          >
            <User
              className={cn("w-6 h-6", mainTab === "profile" ? "text-primary" : "text-muted-foreground")}
              strokeWidth={mainTab === "profile" ? 2.5 : 2}
            />
          </button>
        </div></nav>

        {/* ── FAB (mobile) ───────────────────────────────────── */}
        {showFab && (
          <button
            onClick={() => setShowFabCompose(true)}
            className="md:hidden fixed right-4 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-[0_4px_20px_rgba(124,58,237,0.45)] flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all" style={{ bottom: "calc(70px + env(safe-area-inset-bottom))" }}
          >
            <PenSquare className="w-[22px] h-[22px]" />
          </button>
        )}
      </div>

      {/* ── MOBILE DRAWER ──────────────────────────────────────── */}
      <MobileDrawer
        open={showDrawer}
        onClose={() => setShowDrawer(false)}
        profile={profile}
        fid={fidNum}
        accounts={accounts}
        switchAccount={switchAccount}
        removeAccount={(f) => { void removeAccount(f); }}
        logout={logout}
        theme={theme}
        setTheme={setTheme}
        onAddAccount={() => setShowAddAccount(true)}
        onOpenSettings={openSettings}
        onOpenSupport={() => { setMainTab("profile"); setProfileSection("support"); }}
        onNavigateToProfile={() => navigate(`/profile/${fidNum}`)}
      />

      {/* ── COMPOSE MODAL ──────────────────────────────────────── */}
      {showFabCompose && (
        <ComposeModal
          onClose={() => setShowFabCompose(false)}
          onPublished={() => setFeedRefreshKey((k) => k + 1)}
        />
      )}

      {/* ── ADD ACCOUNT MODAL ──────────────────────────────────── */}
      {showAddAccount && (
        <AddAccountModal
          onClose={() => setShowAddAccount(false)}
          onAdd={addAccount}
        />
      )}

      {/* ── WALLET NOTICE MODAL ────────────────────────────────── */}
      {walletNotice && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setWalletNotice(null)} />
          <div className="relative w-full max-w-sm bg-background border border-border rounded-2xl p-6 shadow-2xl">
            <div className="flex items-start gap-3 mb-5">
              <AlertCircle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-sm text-foreground leading-relaxed">{walletNotice}</p>
            </div>
            <button
              onClick={() => setWalletNotice(null)}
              className="w-full py-2.5 rounded-full bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors"
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
