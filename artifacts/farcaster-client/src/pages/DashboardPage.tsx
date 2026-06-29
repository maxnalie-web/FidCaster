import { useEffect, useState, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useWallet } from "@/hooks/useWallet";
import { UsernameChange } from "@/components/UsernameChange";
import { FeedPanel } from "@/components/FeedPanel";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { WalletPanel } from "@/components/WalletPanel";
import { ProfilePage } from "@/pages/ProfilePage";
import { FidSoldScreen } from "@/components/FidSoldScreen";
import { FarcasterSignIn } from "@/components/FarcasterSignIn";
import { CastComposer } from "@/components/CastComposer";
import { useTheme } from "@/App";
import {
  Home, Bell, Search, User, LogOut, AtSign,
  FileText, MessageSquare, Settings, Wallet,
  Plus, X, Loader2, CheckCircle2, Clock, UserCircle,
  Sun, Moon, AlertCircle, PenSquare, Copy,
  MoreHorizontal, Tag, KeyRound, QrCode, ChevronLeft,
} from "lucide-react";
import { createWalletClient, custom } from "viem";
import { optimism } from "viem/chains";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type MainTab = "feed" | "notifications" | "search" | "wallet" | "profile";
type ProfileSection = "posts" | "settings";
type SettingsTab = "username" | "signer";

const SIDEBAR_ITEMS: { id: MainTab; label: string; icon: typeof Home }[] = [
  { id: "feed",          label: "Home",          icon: Home },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "search",        label: "Search",        icon: Search },
  { id: "wallet",        label: "Wallet",        icon: Wallet },
  { id: "profile",       label: "Profile",       icon: User },
];

const BOTTOM_NAV: { id: MainTab; icon: typeof Home }[] = [
  { id: "feed",          icon: Home },
  { id: "search",        icon: Search },
  { id: "wallet",        icon: Wallet },
  { id: "notifications", icon: Bell },
  { id: "profile",       icon: User },
];


const SETTINGS_TABS: { id: SettingsTab; label: string; icon: typeof Home }[] = [
  { id: "username", label: "Username", icon: AtSign },
  { id: "signer",   label: "Signer",   icon: CheckCircle2 },
];

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

/* ─── Add Account Modal ──────────────────────────────────────────────────── */
type AddMethod = "pick" | "mnemonic" | "wallet" | "farcaster";

function AddAccountModal({ onClose, onAdd }: { onClose: () => void; onAdd: (m: string) => Promise<void> }) {
  const { loginWithWallet } = useWallet();
  const [method, setMethod] = useState<AddMethod>("pick");
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(Array(12).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleWordCountChange(n: 12 | 24) {
    setWordCount(n); setWords(Array(n).fill("")); setError(null);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").trim().split(/\s+/);
    if (pasted.length === 12 || pasted.length === 24) {
      e.preventDefault();
      const n = pasted.length as 12 | 24;
      setWordCount(n); setWords(pasted.slice(0, n));
    } else if (pasted.length > 12) {
      e.preventDefault(); setWords(pasted.slice(0, wordCount));
    }
  }

  async function handleAddMnemonic() {
    const filled = words.map((w) => w.trim().toLowerCase());
    if (filled.some((w) => !w)) { setError(`Please fill in all ${wordCount} words.`); return; }
    setLoading(true); setError(null);
    try { await onAdd(filled.join(" ")); onClose(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to add account."); }
    finally { setLoading(false); }
  }

  const handleAddWallet = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ethereum = (window as any)?.ethereum;
      if (!ethereum?.request) throw new Error("No wallet found. Install MetaMask.");
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts.length) throw new Error("No accounts returned.");
      const wc = createWalletClient({ account: accounts[0] as `0x${string}`, chain: optimism, transport: custom(ethereum) });
      await loginWithWallet(wc, accounts[0] as `0x${string}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Wallet connection failed.");
    } finally { setLoading(false); }
  }, [loginWithWallet, onClose]);

  const cols = wordCount === 24 ? 4 : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-background border border-border rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onPaste={method === "mnemonic" ? handlePaste : undefined}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {method !== "pick" && (
              <button onClick={() => { setMethod("pick"); setError(null); }} className="p-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h3 className="font-bold text-base text-foreground">Add account</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* METHOD PICKER */}
        {method === "pick" && (
          <div className="space-y-2">
            {[
              { id: "mnemonic" as AddMethod, icon: KeyRound, label: "Seed phrase", desc: "12 or 24-word recovery phrase" },
              { id: "wallet"   as AddMethod, icon: Wallet,   label: "Wallet",      desc: "MetaMask or WalletConnect" },
              { id: "farcaster" as AddMethod, icon: QrCode,  label: "Farcaster",   desc: "Scan QR — full read & write" },
            ].map(({ id, icon: Icon, label, desc }) => (
              <button key={id} onClick={() => setMethod(id)}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/40 hover:bg-accent transition-all text-left">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* MNEMONIC */}
        {method === "mnemonic" && (
          <div>
            <div className="flex gap-1 mb-3 p-0.5 bg-muted rounded-lg w-fit">
              {([12, 24] as const).map((n) => (
                <button key={n} onClick={() => handleWordCountChange(n)}
                  className={cn("px-3 py-1 rounded-md text-xs font-semibold transition-all",
                    wordCount === n ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {n} words
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-3">Enter or paste your {wordCount}-word seed phrase.</p>
            <div className="grid gap-1.5 mb-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {words.map((w, i) => (
                <div key={i} className="word-input-wrapper flex items-center gap-1 px-2 py-1.5">
                  <span className="text-[9px] text-muted-foreground/60 font-mono shrink-0 w-4">{i + 1}.</span>
                  <input value={w} onChange={(e) => { const nw = [...words]; nw[i] = e.target.value; setWords(nw); }}
                    className="w-full bg-transparent text-xs text-foreground outline-none" autoComplete="off" spellCheck={false} />
                </div>
              ))}
            </div>
            {error && <p className="text-xs text-destructive mb-3">{error}</p>}
            <button onClick={handleAddMnemonic} disabled={loading}
              className="w-full py-2.5 rounded-full btn-luxury text-white text-sm font-semibold flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {loading ? "Adding…" : "Add account"}
            </button>
          </div>
        )}

        {/* WALLET */}
        {method === "wallet" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Connect your MetaMask wallet to add this account.</p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button onClick={handleAddWallet} disabled={loading}
              className="w-full py-2.5 rounded-full btn-luxury text-white text-sm font-semibold flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
              {loading ? "Connecting…" : "Connect Wallet"}
            </button>
          </div>
        )}

        {/* FARCASTER */}
        {method === "farcaster" && (
          <FarcasterSignIn onBack={() => setMethod("pick")} onDone={onClose} />
        )}
      </div>
    </div>
  );
}

/* ─── Compose Modal ──────────────────────────────────────────────────────── */
function ComposeModal({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm md:block" />
      {/* Mobile: full-screen; Desktop: centered card */}
      <div
        className="relative w-full sm:max-w-lg bg-background sm:rounded-2xl sm:shadow-2xl sm:border sm:border-border flex flex-col max-h-screen sm:max-h-[80vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <button onClick={onClose} className="text-sm font-medium text-muted-foreground sm:hidden">Cancel</button>
          <span className="text-sm font-bold text-foreground">New Cast</span>
          <button onClick={onClose} className="hidden sm:flex p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
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
  open, onClose, profile, fid, accounts, switchAccount, logout, theme, setTheme, onAddAccount, onOpenSettings, onNavigateToProfile,
}: {
  open: boolean; onClose: () => void;
  profile: { pfpUrl?: string; username?: string; bio?: string; displayName?: string } | null;
  fid: number;
  accounts: { fid: number; username?: string; pfpUrl?: string }[];
  switchAccount: (fid: number) => void;
  logout: () => void;
  theme: string; setTheme: (t: string) => void;
  onAddAccount: () => void; onOpenSettings: () => void;
  onNavigateToProfile: () => void;
}) {
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[55] bg-black/40 backdrop-blur-sm transition-opacity duration-300 md:hidden",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        )}
        onClick={onClose}
      />
      <div
        className={cn(
          "fixed top-0 left-0 bottom-0 z-[56] w-72 bg-background border-r border-border flex flex-col transition-transform duration-300 ease-out md:hidden",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="p-5 pt-10">
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => { onNavigateToProfile(); onClose(); }}
              className="w-14 h-14 rounded-full overflow-hidden bg-primary/10 ring-2 ring-border hover:ring-primary/50 transition-all"
            >
              {profile?.pfpUrl ? (
                <img src={profile.pfpUrl} alt="" className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center"><UserCircle className="w-8 h-8 text-primary/40" /></div>
              )}
            </button>
            <button
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
          <button
            onClick={() => { onNavigateToProfile(); onClose(); }}
            className="text-left w-full"
          >
            <p className="font-bold text-base text-foreground truncate">{profile?.displayName || profile?.username || `FID ${fid}`}</p>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">@{profile?.username || `fid${fid}`}</p>
          </button>
          {profile?.bio && <p className="text-xs text-foreground/70 mt-2 line-clamp-2">{profile.bio}</p>}
        </div>

        <div className="h-px bg-border mx-4" />

        {accounts.length > 1 && (
          <div className="px-3 py-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide px-2 mb-1">
              Accounts ({accounts.length})
            </p>
            <div className="overflow-y-auto" style={{ maxHeight: "calc(40vh)" }}>
              {accounts.map((acc) => (
                <button
                  key={acc.fid}
                  onClick={() => { switchAccount(acc.fid); onClose(); }}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-full text-sm transition-colors",
                    acc.fid === fid ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  )}
                >
                  <div className="w-7 h-7 rounded-full overflow-hidden bg-muted shrink-0">
                    {acc.pfpUrl ? <img src={acc.pfpUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <UserCircle className="w-full h-full p-1 text-muted-foreground" />}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="font-medium truncate">{acc.username || `FID ${acc.fid}`}</p>
                    <p className="text-[10px] opacity-50 font-mono">FID {acc.fid}</p>
                  </div>
                  {acc.fid === fid && <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
            <div className="h-px bg-border my-1.5 mx-2" />
          </div>
        )}

        <nav className="flex-1 px-3 py-1 space-y-0.5">
          <button onClick={() => { onOpenSettings(); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
            <Settings className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Settings</span>
          </button>
          <button onClick={() => { onAddAccount(); onClose(); }} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-full text-sm text-foreground/80 hover:text-foreground hover:bg-accent transition-colors">
            <Plus className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-left font-medium">Add account</span>
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
    </>
  );
}

/* ─── Account Dropdown Panel ─────────────────────────────────────────────── */
function AccountDropdownPanel({
  accounts, currentFid, onSwitch, onAddAccount, onLogout,
}: {
  accounts: { fid: number; username?: string; pfpUrl?: string }[];
  currentFid: number;
  onSwitch: (fid: number) => void;
  onAddAccount: () => void;
  onLogout: () => void;
}) {
  return (
    <div className="absolute left-0 bottom-full mb-2 bg-popover border border-border rounded-2xl p-1.5 min-w-[240px] shadow-2xl z-50">
      <div className="px-2.5 py-1.5 mb-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Accounts</p>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: "min(60vh, 320px)" }}>
        {accounts.map((acc) => (
          <button
            key={acc.fid}
            onClick={() => { if (acc.fid !== currentFid) onSwitch(acc.fid); }}
            className={cn(
              "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-full text-xs transition-colors",
              acc.fid === currentFid ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
            )}
          >
            <div className="w-7 h-7 rounded-full overflow-hidden bg-muted shrink-0">
              {acc.pfpUrl ? <img src={acc.pfpUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <UserCircle className="w-full h-full p-1 text-muted-foreground" />}
            </div>
            <div className="flex-1 text-left min-w-0">
              <p className="font-semibold truncate">{acc.username || `FID ${acc.fid}`}</p>
              <p className="opacity-60 font-mono text-[9px]">FID {acc.fid}</p>
            </div>
            {acc.fid === currentFid && <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />}
          </button>
        ))}
      </div>
      <div className="h-px bg-border my-1" />
      <button onClick={onAddAccount} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add account
      </button>
      <button onClick={onLogout} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-full text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors">
        <LogOut className="w-3.5 h-3.5" /> Sign out
      </button>
    </div>
  );
}

/* ─── DashboardPage ──────────────────────────────────────────────────────── */
export function DashboardPage() {
  const {
    fid, profile, signerApproved, autoSignerLoading, signerError,
    retrySignerSetup, accounts, logout, isLoading, addAccount, switchAccount,
    fidSold, authMethod, isCheckingSession, error: walletError,
  } = useWallet();
  const [, navigate] = useLocation();
  const [theme, setTheme] = useTheme();

  const [walletNotice, setWalletNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!walletError) return;
    if (walletError.startsWith("Connect your wallet") || walletError.startsWith("Session locked")) {
      setWalletNotice(walletError);
    } else {
      toast.error(walletError);
    }
  }, [walletError]);

  const VALID_TABS: MainTab[] = ["feed", "notifications", "search", "wallet", "profile"];
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

  const [profileSection, setProfileSection] = useState<ProfileSection>("posts");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("username");
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);
  const [showDrawer, setShowDrawer] = useState(false);
  const [showFabCompose, setShowFabCompose] = useState(false);
  const [feedRefreshKey, setFeedRefreshKey] = useState(0);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const sidebarItems = authMethod === "mnemonic"
    ? SIDEBAR_ITEMS
    : SIDEBAR_ITEMS.filter((i) => i.id !== "wallet");
  const bottomNavItems = authMethod === "mnemonic"
    ? BOTTOM_NAV
    : BOTTOM_NAV.filter((i) => i.id !== "wallet");

  useEffect(() => {
    if (!isCheckingSession && !isLoading && !fid) navigate("/");
  }, [fid, isLoading, isCheckingSession, navigate]);

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

  function openSettings() {
    setMainTab("profile");
    setProfileSection("settings");
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
                {settingsTab === "username" && <UsernameChange />}
                {settingsTab === "signer" && (
                  <SignerPanel
                    approved={signerApproved}
                    loading={autoSignerLoading}
                    error={signerError}
                    onRetry={retrySignerSetup}
                  />
                )}
              </div>
            </div>
          );
        }
        return (
          <ProfilePage
            embedded
            fid={fidNum}
            onOpenSettings={() => setProfileSection("settings")}
          />
        );
    }
  }

  return (
    <div className="min-h-screen bg-background flex w-full overflow-x-hidden">

      {/* ── DESKTOP SIDEBAR ─────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 bottom-0 w-[270px] border-r border-border bg-background z-40">

        {/* Logo */}
        <div className="px-5 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <img
              src="/fidcaster-logo.png"
              alt="FidCaster"
              className="w-11 h-11 object-contain logo-animated shrink-0"
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
                <Icon
                  className={cn("w-[26px] h-[26px] shrink-0", active ? "text-foreground" : "text-foreground/75")}
                  strokeWidth={active ? 2.5 : 2}
                />
                <span className={cn("text-[1.0625rem]", active ? "text-foreground" : "text-foreground/85")}>
                  {item.label}
                </span>
              </button>
            );
          })}

          {/* FID Market link */}
          <button
            onClick={() => navigate("/market")}
            className="sidebar-item"
          >
            <Tag className="w-[26px] h-[26px] shrink-0 text-foreground/75" strokeWidth={2} />
            <span className="text-[1.0625rem] text-foreground/85">FID Market</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="sidebar-item"
          >
            {theme === "dark"
              ? <Sun className="w-[26px] h-[26px] shrink-0 text-foreground/75" strokeWidth={2} />
              : <Moon className="w-[26px] h-[26px] shrink-0 text-foreground/75" strokeWidth={2} />}
            <span className="text-[1.0625rem] text-foreground/85">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          </button>
        </nav>

        {/* Cast button */}
        <div className="px-4 pb-3">
          <button
            onClick={() => setShowFabCompose(true)}
            className="w-full py-3.5 rounded-full bg-primary text-white font-bold text-[1.0625rem] hover:bg-primary/90 active:scale-[0.98] transition-all shadow-sm flex items-center justify-center gap-2"
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
                <div title={autoSignerLoading ? "Registering signer…" : signerApproved ? "Signer active" : "Signer not registered — click Profile → Settings → Signer"} className={cn(
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
            />
          )}
        </div>
      </aside>

      {/* ── MAIN AREA ────────────────────────────────────────────── */}
      <div className="md:ml-[270px] flex-1 min-w-0 min-h-screen flex flex-col">

        {/* ── MOBILE HEADER ──────────────────────────────────── */}
        <header className="md:hidden sticky top-0 z-30 bg-background/96 backdrop-blur-xl border-b border-border">
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

        {/* ── CONTENT ────────────────────────────────────────── */}
        <div className="flex-1 max-w-[600px] w-full mx-auto pb-24 md:pb-0">
          {renderContent()}
        </div>

        {/* ── MOBILE BOTTOM NAV ──────────────────────────────── */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background/96 backdrop-blur-xl border-t border-border z-30 flex h-[54px]">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const active = mainTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setMainTab(item.id)}
                className="flex-1 flex items-center justify-center transition-colors"
              >
                <Icon
                  className={cn("w-6 h-6", active ? "text-primary" : "text-muted-foreground")}
                  strokeWidth={active ? 2.5 : 2}
                />
              </button>
            );
          })}
          {/* FID Market tab */}
          <button
            onClick={() => navigate("/market")}
            className="flex-1 flex items-center justify-center transition-colors"
          >
            <Tag className="w-6 h-6 text-muted-foreground" strokeWidth={2} />
          </button>
        </nav>

        {/* ── FAB (mobile) ───────────────────────────────────── */}
        {showFab && (
          <button
            onClick={() => setShowFabCompose(true)}
            className="md:hidden fixed bottom-[70px] right-4 z-40 w-14 h-14 rounded-full bg-primary text-white shadow-[0_4px_20px_rgba(124,58,237,0.45)] flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
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
        logout={logout}
        theme={theme}
        setTheme={setTheme}
        onAddAccount={() => setShowAddAccount(true)}
        onOpenSettings={openSettings}
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
