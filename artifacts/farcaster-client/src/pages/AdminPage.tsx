import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import {
  Settings, Type, Palette, Users, Key, Bell, Hash,
  Save, RotateCcw, ChevronRight, X, Plus, Trash2,
  Shield, ToggleLeft, ToggleRight, ArrowLeft, Check,
  AlertTriangle, Info, RefreshCw, Globe, Search, Share2,
  Sparkles, Code, FileText, Link, Twitter, Send,
  Github, MessageSquare, Eye, EyeOff, Lock, KeyRound, LogIn,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useAdminConfig } from "@/hooks/useAdminConfig";
import {
  resetAdminConfig, applyAdminTheme, applyAdminSeo,
  ADMIN_FID, type Announcement, type FeaturedChannel, type LandingFeature, type FooterLink,
} from "@/lib/admin-config";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Section definitions ───────────────────────────────────────────────────────

type Section =
  | "branding" | "landing" | "seo" | "social"
  | "theme" | "apptexts" | "css"
  | "features" | "announcements" | "channels"
  | "users" | "api" | "misc";

interface SectionDef {
  id: Section;
  label: string;
  icon: typeof Settings;
  group: string;
  badge?: string;
}

const SECTIONS: SectionDef[] = [
  { id: "branding",      label: "Branding",        icon: Sparkles,     group: "Site" },
  { id: "landing",       label: "Landing Page",    icon: Globe,        group: "Site" },
  { id: "seo",           label: "SEO",             icon: Search,       group: "Site" },
  { id: "social",        label: "Social Links",    icon: Share2,       group: "Site" },
  { id: "theme",         label: "Theme & Colors",  icon: Palette,      group: "Design" },
  { id: "apptexts",      label: "App Texts",       icon: Type,         group: "Design" },
  { id: "css",           label: "Custom CSS",      icon: Code,         group: "Design" },
  { id: "features",      label: "Feature Flags",   icon: ToggleLeft,   group: "App" },
  { id: "announcements", label: "Announcements",   icon: Bell,         group: "App" },
  { id: "channels",      label: "Channels",        icon: Hash,         group: "App" },
  { id: "users",         label: "Privileged Users",icon: Users,        group: "App" },
  { id: "api",           label: "API Keys",        icon: Key,          group: "System" },
  { id: "misc",          label: "Misc & Footer",   icon: Settings,     group: "System" },
];

const GROUPS = ["Site", "Design", "App", "System"];

// ── Shared form primitives ────────────────────────────────────────────────────

function Label({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-1.5">
      <p className="text-[13px] font-semibold text-foreground">{children}</p>
      {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Field({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("space-y-1 mb-4", className)}>{children}</div>;
}

function Inp({ value, onChange, placeholder, type = "text", mono = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  type?: string; mono?: boolean;
}) {
  const [show, setShow] = useState(false);
  const isPassword = type === "password";
  return (
    <div className="relative">
      <input
        type={isPassword && !show ? "password" : "text"}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border",
          "text-foreground placeholder:text-muted-foreground/50",
          "outline-none focus:border-primary/50 focus:bg-muted/50 transition-all",
          mono && "font-mono",
          isPassword && "pr-9",
        )}
      />
      {isPassword && (
        <button
          type="button"
          onClick={() => setShow(s => !s)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
        >
          {show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      )}
    </div>
  );
}

function Txtarea({ value, onChange, placeholder, rows = 3, mono = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cn(
        "w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border",
        "text-foreground placeholder:text-muted-foreground/50",
        "outline-none focus:border-primary/50 focus:bg-muted/50 transition-all resize-y",
        mono && "font-mono",
      )}
    />
  );
}

function ToggleRow({ enabled, onChange, label, sub }: {
  enabled: boolean; onChange: (v: boolean) => void; label: string; sub?: string;
}) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-3 w-full py-2.5 px-3 rounded-xl hover:bg-muted/40 transition-colors text-left group"
    >
      <div className={cn(
        "relative shrink-0 w-9 h-5 rounded-full border-2 transition-all duration-200",
        enabled ? "bg-primary border-primary" : "bg-muted/60 border-border",
      )}>
        <span className={cn(
          "absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-sm transition-all duration-200",
          enabled ? "left-[calc(100%-16px)]" : "left-0.5",
        )} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={cn("text-[13px] font-medium leading-tight", enabled ? "text-foreground" : "text-muted-foreground")}>{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <span className={cn(
        "text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0",
        enabled ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
      )}>{enabled ? "ON" : "OFF"}</span>
    </button>
  );
}

function Card({ title, children, className }: { title?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-border/60 bg-card/40 overflow-hidden", className)}>
      {title && (
        <div className="px-4 py-3 border-b border-border/40 bg-muted/20">
          <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">{title}</p>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

function InfoBox({ children, variant = "info" }: { children: React.ReactNode; variant?: "info" | "warn" }) {
  return (
    <div className={cn(
      "flex items-start gap-2.5 px-3.5 py-3 rounded-xl border text-[12px] mb-4",
      variant === "warn"
        ? "bg-amber-500/8 border-amber-500/20 text-amber-400"
        : "bg-primary/6 border-primary/20 text-muted-foreground",
    )}>
      {variant === "warn"
        ? <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
        : <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
      }
      <span>{children}</span>
    </div>
  );
}

function AddField({ placeholder, onAdd, btnLabel = "Add" }: {
  placeholder: string; onAdd: (v: string) => void; btnLabel?: string;
}) {
  const [val, setVal] = useState("");
  return (
    <div className="flex gap-2 mt-2">
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && val.trim()) { onAdd(val.trim()); setVal(""); } }}
        placeholder={placeholder}
        className="flex-1 px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 transition-all"
      />
      <button
        onClick={() => { if (val.trim()) { onAdd(val.trim()); setVal(""); } }}
        className="px-3 py-2 rounded-xl bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/20 transition-colors border border-primary/20 shrink-0"
      >
        {btnLabel}
      </button>
    </div>
  );
}

// ── Admin PIN helpers ─────────────────────────────────────────────────────────

const ADMIN_PIN_KEY       = "fc_admin_pin";      // SHA-256 hash of PIN
const ADMIN_PIN_LOCK_KEY  = "fc_admin_pin_locked"; // locked-until timestamp
const ADMIN_PIN_TRIES_KEY = "fc_admin_pin_tries";  // consecutive wrong attempts
const PIN_UNLOCK_KEY      = "fc_admin_unlocked";   // sessionStorage: unlock flag
const MAX_PIN_TRIES       = 5;
const LOCKOUT_MS          = 5 * 60 * 1000;         // 5 minutes

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode("fidcaster_admin:" + text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getPinLockInfo(): { locked: boolean; secsLeft: number; tries: number } {
  const lockedUntil = Number(localStorage.getItem(ADMIN_PIN_LOCK_KEY) ?? 0);
  const tries = Number(localStorage.getItem(ADMIN_PIN_TRIES_KEY) ?? 0);
  const secsLeft = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
  return { locked: secsLeft > 0, secsLeft, tries };
}

// ── PIN Gate Component ────────────────────────────────────────────────────────

function PinGate({ onUnlocked }: { onUnlocked: () => void }) {
  const storedHash = localStorage.getItem(ADMIN_PIN_KEY);
  const [mode, setMode] = useState<"enter" | "set">(storedHash ? "enter" : "set");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [lockInfo, setLockInfo] = useState(getPinLockInfo());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Refresh lock countdown every second
    const t = setInterval(() => setLockInfo(getPinLockInfo()), 1000);
    return () => clearInterval(t);
  }, []);

  async function handleEnter(e: React.FormEvent) {
    e.preventDefault();
    if (lockInfo.locked) return;
    setLoading(true);
    setError("");
    const hash = await sha256Hex(pin);
    if (hash === storedHash) {
      localStorage.setItem(ADMIN_PIN_TRIES_KEY, "0");
      localStorage.removeItem(ADMIN_PIN_LOCK_KEY);
      sessionStorage.setItem(PIN_UNLOCK_KEY, "1");
      onUnlocked();
    } else {
      const tries = lockInfo.tries + 1;
      localStorage.setItem(ADMIN_PIN_TRIES_KEY, String(tries));
      if (tries >= MAX_PIN_TRIES) {
        localStorage.setItem(ADMIN_PIN_LOCK_KEY, String(Date.now() + LOCKOUT_MS));
        localStorage.setItem(ADMIN_PIN_TRIES_KEY, "0");
        setError("Too many wrong attempts — locked for 5 minutes.");
      } else {
        setError(`Wrong PIN. ${MAX_PIN_TRIES - tries} attempt${MAX_PIN_TRIES - tries !== 1 ? "s" : ""} left.`);
      }
      setPin("");
      setLockInfo(getPinLockInfo());
    }
    setLoading(false);
  }

  async function handleSet(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length < 6) { setError("PIN must be at least 6 characters."); return; }
    if (pin !== confirm) { setError("PINs don't match."); return; }
    setLoading(true);
    const hash = await sha256Hex(pin);
    localStorage.setItem(ADMIN_PIN_KEY, hash);
    localStorage.setItem(ADMIN_PIN_TRIES_KEY, "0");
    localStorage.removeItem(ADMIN_PIN_LOCK_KEY);
    sessionStorage.setItem(PIN_UNLOCK_KEY, "1");
    onUnlocked();
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-xs mx-auto p-6">
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <h1 className="font-bold text-xl text-foreground">
            {mode === "set" ? "Set Admin PIN" : "Admin Access"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1.5">
            {mode === "set"
              ? "Create a PIN to protect the admin panel. You'll need it every session."
              : "Enter your admin PIN to continue."}
          </p>
        </div>

        <form onSubmit={mode === "set" ? handleSet : handleEnter} className="space-y-3">
          <input
            ref={inputRef}
            type="password"
            value={pin}
            onChange={e => { setPin(e.target.value); setError(""); }}
            placeholder={mode === "set" ? "Create PIN (min 6 chars)" : "Enter PIN"}
            disabled={lockInfo.locked || loading}
            autoComplete="current-password"
            className="w-full px-4 py-3 rounded-xl border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60 text-center tracking-widest text-lg transition-colors disabled:opacity-50"
          />
          {mode === "set" && (
            <input
              type="password"
              value={confirm}
              onChange={e => { setConfirm(e.target.value); setError(""); }}
              placeholder="Confirm PIN"
              disabled={loading}
              autoComplete="new-password"
              className="w-full px-4 py-3 rounded-xl border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/60 text-center tracking-widest text-lg transition-colors"
            />
          )}

          {lockInfo.locked && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-destructive/8 border border-destructive/20">
              <AlertTriangle className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-[12px] text-destructive">
                Locked — wait {Math.floor(lockInfo.secsLeft / 60)}:{String(lockInfo.secsLeft % 60).padStart(2, "0")}
              </p>
            </div>
          )}
          {error && !lockInfo.locked && (
            <p className="text-[12px] text-destructive text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={lockInfo.locked || loading || pin.length === 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-primary text-white font-bold text-[15px] transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : mode === "set" ? (
              <><KeyRound className="w-4 h-4" /> Set PIN & Enter</>
            ) : (
              <><LogIn className="w-4 h-4" /> Unlock</>
            )}
          </button>
        </form>

        {mode === "enter" && (
          <p className="text-center text-[11px] text-muted-foreground mt-5">
            Forgot your PIN?{" "}
            <button
              onClick={() => {
                if (window.confirm("This will clear the stored PIN hash and require setting a new one. Continue?")) {
                  localStorage.removeItem(ADMIN_PIN_KEY);
                  localStorage.removeItem(ADMIN_PIN_LOCK_KEY);
                  localStorage.removeItem(ADMIN_PIN_TRIES_KEY);
                  setMode("set");
                  setPin("");
                  setError("");
                }
              }}
              className="underline underline-offset-2 hover:text-foreground transition-colors"
            >
              Reset PIN
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main AdminPage ────────────────────────────────────────────────────────────

export function AdminPage() {
  const { fid } = useWallet();
  const [, navigate] = useLocation();
  const [cfg, update] = useAdminConfig();
  const [activeSection, setActiveSection] = useState<Section>("branding");
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  // PIN gate — session-scoped; cleared on browser/tab close
  const [pinUnlocked, setPinUnlocked] = useState(
    () => sessionStorage.getItem(PIN_UNLOCK_KEY) === "1"
  );

  const isAdmin = fid !== null && Number(fid) === ADMIN_FID;

  useEffect(() => {
    if (isAdmin) { applyAdminTheme(cfg); applyAdminSeo(cfg); }
  }, [cfg, isAdmin]);

  function save() {
    applyAdminTheme(cfg);
    applyAdminSeo(cfg);
    setSaveState("saved");
    toast.success("Settings saved");
    setTimeout(() => setSaveState("idle"), 2500);
  }

  function doReset() {
    if (!confirm("Reset all settings to defaults?")) return;
    resetAdminConfig();
    toast.success("Reset to defaults");
    window.location.reload();
  }

  function set<K extends keyof typeof cfg>(section: K, key: keyof (typeof cfg)[K], value: unknown) {
    update(prev => ({
      ...prev,
      [section]: { ...(prev[section] as object), [key]: value },
    }));
  }

  const activeDef = SECTIONS.find(s => s.id === activeSection);

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <div className="w-16 h-16 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8 text-destructive/60" />
          </div>
          <p className="text-xl font-bold text-foreground">Access Denied</p>
          <p className="text-sm text-muted-foreground">This page is only accessible to the admin.</p>
          <button onClick={() => navigate("/dashboard")}
            className="px-5 py-2 rounded-xl bg-primary text-white font-semibold text-sm hover:bg-primary/90 transition-colors">
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // PIN gate — shown every new browser session even for the admin FID
  if (!pinUnlocked) {
    return <PinGate onUnlocked={() => setPinUnlocked(true)} />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" style={{ fontFamily: "inherit" }}>

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60 bg-background/95 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-1.5 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-xl bg-primary/15 flex items-center justify-center">
              <Shield className="w-3.5 h-3.5 text-primary" />
            </div>
            <span className="font-bold text-[15px] text-foreground">Admin Panel</span>
          </div>
          <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
            @m-- · FID {ADMIN_FID}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {activeDef && (
            <span className="hidden md:flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <activeDef.icon className="w-3.5 h-3.5" />
              {activeDef.label}
            </span>
          )}
          <button
            onClick={doReset}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-border/60"
          >
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <button
            onClick={save}
            className={cn(
              "flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-[12px] font-semibold transition-all",
              saveState === "saved"
                ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25"
                : "bg-primary text-white hover:bg-primary/90 shadow-lg shadow-primary/20",
            )}
          >
            {saveState === "saved"
              ? <><Check className="w-3 h-3" /> Saved</>
              : <><Save className="w-3 h-3" /> Save changes</>
            }
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Sidebar ───────────────────────────────────────────────────── */}
        <aside className="w-52 shrink-0 border-r border-border/60 overflow-y-auto bg-card/30">
          <nav className="p-2.5 space-y-4">
            {GROUPS.map(group => {
              const items = SECTIONS.filter(s => s.group === group);
              return (
                <div key={group}>
                  <p className="px-3 pb-1.5 text-[10px] font-bold text-muted-foreground/60 uppercase tracking-widest">
                    {group}
                  </p>
                  <div className="space-y-0.5">
                    {items.map(s => {
                      const Icon = s.icon;
                      const active = activeSection === s.id;
                      return (
                        <button
                          key={s.id}
                          onClick={() => setActiveSection(s.id)}
                          className={cn(
                            "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition-all text-[13px]",
                            active
                              ? "bg-primary/12 text-primary font-semibold shadow-sm"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                          )}
                        >
                          <Icon className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{s.label}</span>
                          {active && <ChevronRight className="w-3 h-3 ml-auto shrink-0 opacity-60" />}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
        </aside>

        {/* ── Content ───────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto p-6 space-y-5">

            {/* Section header */}
            {activeDef && (
              <div className="flex items-center gap-3 pb-1">
                <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                  <activeDef.icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-[15px] text-foreground leading-none">{activeDef.label}</h2>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{activeDef.group} settings</p>
                </div>
              </div>
            )}

            {/* ── BRANDING ───────────────────────────────────────── */}
            {activeSection === "branding" && (
              <>
                <Card title="Identity">
                  <Field>
                    <Label sub="Name shown in nav bar, footer, and app title">Logo / Brand Name</Label>
                    <Inp value={cfg.branding.logoText} onChange={v => set("branding", "logoText", v)} placeholder="FidCaster" />
                  </Field>
                  <Field>
                    <Label sub="Emoji used as browser favicon (leave empty for default logo)">Favicon Emoji</Label>
                    <Inp value={cfg.branding.faviconEmoji} onChange={v => set("branding", "faviconEmoji", v)} placeholder="🎭" />
                  </Field>
                </Card>
                <Card title="Nav Badge">
                  <Field>
                    <Label sub="The green badge pill shown above the hero title on the landing page">App Badge Text</Label>
                    <Inp value={cfg.copy.appBadge} onChange={v => set("copy", "appBadge", v)} placeholder="Farcaster Client · Live on Optimism" />
                  </Field>
                  <Field>
                    <Label sub="Nav bar brand name (separate from logo text if needed)">Nav Brand Text</Label>
                    <Inp value={cfg.copy.navBrand} onChange={v => set("copy", "navBrand", v)} />
                  </Field>
                </Card>
              </>
            )}

            {/* ── LANDING PAGE ───────────────────────────────────── */}
            {activeSection === "landing" && (
              <>
                <Card title="Hero Section">
                  <Field>
                    <Label sub="Main headline — use \\n for line breaks">Hero Title</Label>
                    <Txtarea value={cfg.copy.heroTitle} onChange={v => set("copy", "heroTitle", v)} rows={3} placeholder="Cast. Connect.\nTrade your\nFarcaster ID." />
                  </Field>
                  <Field>
                    <Label sub="Subtitle line below the title">Hero Subtitle</Label>
                    <Txtarea value={cfg.copy.heroSubtitle} onChange={v => set("copy", "heroSubtitle", v)} rows={2} />
                  </Field>
                  <Field>
                    <Label sub="Second description line">Hero Description</Label>
                    <Inp value={cfg.copy.heroDescription} onChange={v => set("copy", "heroDescription", v)} />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <Label>Primary CTA</Label>
                      <Inp value={cfg.copy.heroCta} onChange={v => set("copy", "heroCta", v)} placeholder="Enter App" />
                    </Field>
                    <Field>
                      <Label>Secondary CTA</Label>
                      <Inp value={cfg.copy.heroSecondaryCta} onChange={v => set("copy", "heroSecondaryCta", v)} placeholder="Explore FID Market" />
                    </Field>
                  </div>
                  <Field>
                    <Label sub="Comma-separated tags below the CTA buttons">Hero Tag Pills</Label>
                    <Inp
                      value={cfg.copy.heroTags.join(", ")}
                      onChange={v => set("copy", "heroTags", v.split(",").map(s => s.trim()).filter(Boolean))}
                      placeholder="No registration, No email, Open source, On Optimism"
                    />
                  </Field>
                </Card>

                <Card title="Features Section">
                  <InfoBox>Edit the title and description of each feature card. Icon order is fixed.</InfoBox>
                  <div className="space-y-3">
                    {cfg.landingFeatures.map((feat, i) => (
                      <div key={i} className="p-3 rounded-xl bg-muted/20 border border-border/40 space-y-2">
                        <div className="flex items-center gap-2 mb-1">
                          <div className="w-3 h-3 rounded-full shrink-0" style={{ background: feat.color }} />
                          <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Feature {i + 1}</span>
                        </div>
                        <Inp
                          value={feat.title}
                          onChange={v => update(p => ({
                            ...p,
                            landingFeatures: p.landingFeatures.map((f, j) => j === i ? { ...f, title: v } : f),
                          }))}
                          placeholder="Feature title"
                        />
                        <Txtarea
                          value={feat.desc}
                          onChange={v => update(p => ({
                            ...p,
                            landingFeatures: p.landingFeatures.map((f, j) => j === i ? { ...f, desc: v } : f),
                          }))}
                          rows={2}
                          placeholder="Feature description"
                        />
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-muted-foreground">Color:</span>
                          <input
                            type="color"
                            value={feat.color}
                            onChange={e => update(p => ({
                              ...p,
                              landingFeatures: p.landingFeatures.map((f, j) => j === i ? { ...f, color: e.target.value } : f),
                            }))}
                            className="w-7 h-7 rounded-lg border border-border cursor-pointer"
                          />
                          <Inp
                            value={feat.color}
                            onChange={v => update(p => ({
                              ...p,
                              landingFeatures: p.landingFeatures.map((f, j) => j === i ? { ...f, color: v } : f),
                            }))}
                            placeholder="#7c3aed"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

                <Card title="Footer">
                  <Field>
                    <Label sub="Small tagline next to the logo">Brand Tagline</Label>
                    <Inp value={cfg.landingFooter.brandTagline} onChange={v => set("landingFooter", "brandTagline", v)} placeholder="Farcaster Client" />
                  </Field>
                  <Field>
                    <Label sub="Copyright / credits line on the right">Copyright Text</Label>
                    <Inp value={cfg.landingFooter.copyright} onChange={v => set("landingFooter", "copyright", v)} placeholder="Built on Farcaster · Powered by Optimism" />
                  </Field>
                  <Field>
                    <Label sub="Footer navigation links">Footer Links</Label>
                    <div className="space-y-2">
                      {cfg.landingFooter.links.map((lnk, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Inp value={lnk.label} onChange={v => update(p => ({
                            ...p, landingFooter: { ...p.landingFooter, links: p.landingFooter.links.map((l, j) => j === i ? { ...l, label: v } : l) },
                          }))} placeholder="Label" />
                          <Inp value={lnk.url} onChange={v => update(p => ({
                            ...p, landingFooter: { ...p.landingFooter, links: p.landingFooter.links.map((l, j) => j === i ? { ...l, url: v } : l) },
                          }))} placeholder="/path or https://..." />
                          <button
                            onClick={() => update(p => ({ ...p, landingFooter: { ...p.landingFooter, links: p.landingFooter.links.filter((_, j) => j !== i) } }))}
                            className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          ><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={() => update(p => ({ ...p, landingFooter: { ...p.landingFooter, links: [...p.landingFooter.links, { label: "", url: "" }] } }))}
                      className="mt-2 flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 font-semibold transition-colors"
                    >
                      <Plus className="w-3.5 h-3.5" /> Add link
                    </button>
                  </Field>
                </Card>
              </>
            )}

            {/* ── SEO ────────────────────────────────────────────── */}
            {activeSection === "seo" && (
              <Card title="Search Engine Optimization">
                <InfoBox>These values are applied dynamically at runtime via JavaScript. Static HTML defaults are in index.html.</InfoBox>
                <Field>
                  <Label sub="Browser tab title">Page Title</Label>
                  <Inp value={cfg.seo.pageTitle} onChange={v => set("seo", "pageTitle", v)} placeholder="FidCaster" />
                </Field>
                <Field>
                  <Label sub="Meta description tag">Meta Description</Label>
                  <Txtarea value={cfg.seo.metaDescription} onChange={v => set("seo", "metaDescription", v)} rows={2} placeholder="FidCaster — a luxury Farcaster client. Your keys, your identity." />
                </Field>
                <Field>
                  <Label sub="og:image URL — shown when sharing on social media">OG Image URL</Label>
                  <Inp value={cfg.seo.ogImage} onChange={v => set("seo", "ogImage", v)} placeholder="https://..." />
                </Field>
                <Field>
                  <Label sub="og:url — canonical URL of the page">OG URL</Label>
                  <Inp value={cfg.seo.ogUrl} onChange={v => set("seo", "ogUrl", v)} placeholder="https://fidcaster.app" />
                </Field>
              </Card>
            )}

            {/* ── SOCIAL ─────────────────────────────────────────── */}
            {activeSection === "social" && (
              <Card title="Social & Community Links">
                <InfoBox>These links appear in the landing page footer and anywhere social icons are shown.</InfoBox>
                {([
                  { key: "twitter",  label: "Twitter / X",  Icon: Twitter,       placeholder: "https://twitter.com/fidcaster" },
                  { key: "telegram", label: "Telegram",      Icon: Send,          placeholder: "https://t.me/fidcaster" },
                  { key: "github",   label: "GitHub",        Icon: Github,        placeholder: "https://github.com/..." },
                  { key: "discord",  label: "Discord",       Icon: MessageSquare, placeholder: "https://discord.gg/..." },
                  { key: "website",  label: "Website",       Icon: Globe,         placeholder: "https://fidcaster.app" },
                ] as const).map(({ key, label, Icon, placeholder }) => (
                  <Field key={key}>
                    <Label>
                      <span className="flex items-center gap-1.5"><Icon className="w-3.5 h-3.5 inline" /> {label}</span>
                    </Label>
                    <Inp
                      value={(cfg.social as Record<string, string>)[key]}
                      onChange={v => set("social", key as keyof typeof cfg.social, v)}
                      placeholder={placeholder}
                    />
                  </Field>
                ))}
              </Card>
            )}

            {/* ── THEME ──────────────────────────────────────────── */}
            {activeSection === "theme" && (
              <>
                <InfoBox variant="warn">Colors must be in HSL format without parentheses, e.g. <code className="font-mono text-amber-300">263 70% 50%</code></InfoBox>
                <Card title="Colors">
                  {([
                    { key: "primaryHsl",            label: "Primary Color (Light)",      ph: "263 70% 50%" },
                    { key: "primaryDarkHsl",         label: "Primary Color (Dark)",       ph: "263 78% 62%" },
                    { key: "primaryForegroundHsl",   label: "Button Text Color",          ph: "0 0% 100%" },
                    { key: "backgroundHsl",          label: "Background (Light)",         ph: "0 0% 100%" },
                    { key: "darkBackgroundHsl",      label: "Background (Dark)",          ph: "224 32% 8%" },
                  ] as const).map(({ key, label, ph }) => (
                    <Field key={key}>
                      <Label>{label}</Label>
                      <div className="flex gap-2 items-center">
                        <Inp value={(cfg.theme as Record<string, string>)[key]} onChange={v => set("theme", key as keyof typeof cfg.theme, v)} placeholder={ph} />
                        <div className="w-9 h-9 rounded-xl shrink-0 border border-border" style={{ background: `hsl(${(cfg.theme as Record<string, string>)[key]})` }} />
                      </div>
                    </Field>
                  ))}
                </Card>
                <Card title="Typography & Shape">
                  <Field>
                    <Label sub="CSS value, e.g. 0.75rem or 1rem">Border Radius</Label>
                    <Inp value={cfg.theme.borderRadius} onChange={v => set("theme", "borderRadius", v)} placeholder="0.75rem" />
                  </Field>
                  <Field>
                    <Label sub="Google Fonts name (empty = system default)">Font Family</Label>
                    <Inp value={cfg.theme.fontFamily} onChange={v => set("theme", "fontFamily", v)} placeholder="Inter" />
                  </Field>
                </Card>
                <button
                  onClick={() => { applyAdminTheme(cfg); toast.success("Theme previewed"); }}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 text-primary text-[13px] font-semibold hover:bg-primary/20 transition-colors border border-primary/20"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Preview theme now
                </button>
              </>
            )}

            {/* ── APP TEXTS ──────────────────────────────────────── */}
            {activeSection === "apptexts" && (
              <>
                <Card title="Sidebar Navigation">
                  {([
                    { key: "sidebarHome",          label: "Home / Feed" },
                    { key: "sidebarMarket",         label: "FID Market" },
                    { key: "sidebarSearch",         label: "Search" },
                    { key: "sidebarNotifications",  label: "Notifications" },
                    { key: "sidebarProfile",        label: "Profile" },
                  ] as const).map(({ key, label }) => (
                    <Field key={key}>
                      <Label>{label}</Label>
                      <Inp value={(cfg.appTexts as Record<string, string>)[key]} onChange={v => set("appTexts", key as keyof typeof cfg.appTexts, v)} />
                    </Field>
                  ))}
                </Card>
                <Card title="Feed Tabs">
                  {([
                    { key: "feedTabFollowing", label: "Following tab" },
                    { key: "feedTabForYou",    label: "For You tab" },
                    { key: "feedTabChannels",  label: "Channels tab" },
                  ] as const).map(({ key, label }) => (
                    <Field key={key}>
                      <Label>{label}</Label>
                      <Inp value={(cfg.appTexts as Record<string, string>)[key]} onChange={v => set("appTexts", key as keyof typeof cfg.appTexts, v)} />
                    </Field>
                  ))}
                </Card>
                <Card title="Messages & Login">
                  <Field>
                    <Label sub="Shown when feed is empty">Empty Feed Message</Label>
                    <Txtarea value={cfg.appTexts.emptyFeedMessage} onChange={v => set("appTexts", "emptyFeedMessage", v)} rows={2} />
                  </Field>
                  <Field>
                    <Label sub="Generic error message">Error Message</Label>
                    <Inp value={cfg.appTexts.errorGeneric} onChange={v => set("appTexts", "errorGeneric", v)} />
                  </Field>
                  <Field>
                    <Label sub="Title on the login/sign-in page">Login Page Title</Label>
                    <Inp value={cfg.appTexts.loginWelcomeTitle} onChange={v => set("appTexts", "loginWelcomeTitle", v)} />
                  </Field>
                  <Field>
                    <Label sub="Subtitle on the login page">Login Page Subtitle</Label>
                    <Txtarea value={cfg.appTexts.loginWelcomeSub} onChange={v => set("appTexts", "loginWelcomeSub", v)} rows={2} />
                  </Field>
                </Card>
              </>
            )}

            {/* ── CUSTOM CSS ─────────────────────────────────────── */}
            {activeSection === "css" && (
              <Card title="Custom CSS">
                <InfoBox variant="warn">CSS is injected directly into the page. Use responsibly.</InfoBox>
                <Txtarea
                  value={cfg.customCss}
                  onChange={v => update(p => ({ ...p, customCss: v }))}
                  rows={16}
                  mono
                  placeholder={`.my-class {\n  color: var(--primary);\n}`}
                />
              </Card>
            )}

            {/* ── FEATURE FLAGS ──────────────────────────────────── */}
            {activeSection === "features" && (
              <Card title="Feature Flags">
                <div className="space-y-0.5">
                  <ToggleRow enabled={cfg.features.marketEnabled} onChange={v => set("features", "marketEnabled", v)} label="FID Marketplace" sub="Enable the /market route and tab" />
                  <ToggleRow enabled={cfg.features.notificationsEnabled} onChange={v => set("features", "notificationsEnabled", v)} label="Notifications" sub="Show notifications tab in sidebar" />
                  <ToggleRow enabled={cfg.features.searchEnabled} onChange={v => set("features", "searchEnabled", v)} label="Search" sub="Show search in sidebar" />
                  <ToggleRow enabled={cfg.features.miniAppsEnabled} onChange={v => set("features", "miniAppsEnabled", v)} label="Mini Apps" sub="Enable mini apps embeds in casts" />
                  <ToggleRow enabled={cfg.features.proChannelEnabled} onChange={v => set("features", "proChannelEnabled", v)} label="Pro Channel Tab" sub="Show Channels tab in feed" />
                  <ToggleRow enabled={cfg.features.castComposerEnabled} onChange={v => set("features", "castComposerEnabled", v)} label="Cast Composer" sub="Allow users to write and post casts" />
                  <ToggleRow enabled={cfg.features.darkModeToggleEnabled} onChange={v => set("features", "darkModeToggleEnabled", v)} label="Dark Mode Toggle" sub="Show theme switcher in app" />
                  <ToggleRow enabled={cfg.features.landingPageEnabled} onChange={v => set("features", "landingPageEnabled", v)} label="Landing Page" sub="Show / landing page; if off, redirect to /login" />
                  <ToggleRow enabled={cfg.features.growEnabled} onChange={v => set("features", "growEnabled", v)} label="Grow" sub="Show Grow (follow tools) in sidebar and bottom nav" />
                </div>
              </Card>
            )}

            {/* ── ANNOUNCEMENTS ──────────────────────────────────── */}
            {activeSection === "announcements" && (
              <>
                <InfoBox>Banners shown above the feed. Multiple can be active at the same time.</InfoBox>
                <div className="space-y-3">
                  {cfg.announcements.length === 0 && (
                    <div className="text-center py-10 text-muted-foreground">
                      <Bell className="w-8 h-8 opacity-20 mx-auto mb-3" />
                      <p className="text-sm">No announcements yet</p>
                    </div>
                  )}
                  {cfg.announcements.map((a, i) => (
                    <AnnouncementEditor
                      key={a.id} announcement={a}
                      onChange={updated => update(p => ({
                        ...p, announcements: p.announcements.map((x, j) => j === i ? updated : x),
                      }))}
                      onDelete={() => update(p => ({ ...p, announcements: p.announcements.filter((_, j) => j !== i) }))}
                    />
                  ))}
                </div>
                <button
                  onClick={() => update(p => ({
                    ...p, announcements: [...p.announcements, {
                      id: Date.now().toString(), text: "", type: "info", dismissible: true, enabled: true,
                    }],
                  }))}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-dashed border-primary/30 text-primary text-[13px] font-semibold hover:bg-primary/5 transition-colors w-full justify-center mt-2"
                >
                  <Plus className="w-4 h-4" /> New Announcement
                </button>
              </>
            )}

            {/* ── CHANNELS ───────────────────────────────────────── */}
            {activeSection === "channels" && (
              <>
                <InfoBox>Channels shown by default in the sidebar and feed selector.</InfoBox>
                <Card>
                  <div className="space-y-2 mb-3">
                    {cfg.featuredChannels.map((ch: FeaturedChannel, i: number) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-muted-foreground text-[13px] shrink-0">#</span>
                        <Inp
                          value={ch.id}
                          onChange={v => update(p => ({
                            ...p, featuredChannels: p.featuredChannels.map((c: FeaturedChannel, j: number) => j === i ? { ...c, id: v } : c),
                          }))}
                          placeholder="channel-id"
                        />
                        <button
                          onClick={() => update(p => ({ ...p, featuredChannels: p.featuredChannels.filter((_: FeaturedChannel, j: number) => j !== i) }))}
                          className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        ><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    ))}
                  </div>
                  <AddField
                    placeholder="channel-id"
                    onAdd={id => update(p => ({ ...p, featuredChannels: [...p.featuredChannels, { id }] }))}
                    btnLabel="Add"
                  />
                </Card>
              </>
            )}

            {/* ── USERS ──────────────────────────────────────────── */}
            {activeSection === "users" && (
              <>
                <Card title="Grow Tools Access">
                  <InfoBox>When enabled, ALL signed-in users get access to Grow (batch follow/unfollow) tools — no need to add them individually below.</InfoBox>
                  <ToggleRow enabled={cfg.features.growToolsForAll} onChange={v => set("features", "growToolsForAll", v)} label="Grow tools for everyone" sub="If off, only users in the privileged list below can use batch tools" />
                </Card>
                <InfoBox>Users on this list get batch follow, advanced tools, and privileged features (when Grow tools for everyone is off).</InfoBox>
                <Card>
                  <div className="space-y-2 mb-3">
                    {cfg.privilegedUsers.map((u, i) => (
                      <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/20 border border-border/40">
                        <span className="text-[13px] font-mono text-foreground flex-1">@{u}</span>
                        {u !== "m--"
                          ? (
                            <button
                              onClick={() => update(p => ({ ...p, privilegedUsers: p.privilegedUsers.filter((_, j) => j !== i) }))}
                              className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                            ><Trash2 className="w-3.5 h-3.5" /></button>
                          ) : (
                            <Shield className="w-3.5 h-3.5 text-primary shrink-0" />
                          )
                        }
                      </div>
                    ))}
                  </div>
                  <AddField
                    placeholder="username (without @)"
                    onAdd={u => { if (!cfg.privilegedUsers.includes(u)) update(p => ({ ...p, privilegedUsers: [...p.privilegedUsers, u] })); }}
                  />
                </Card>
              </>
            )}

            {/* ── API ────────────────────────────────────────────── */}
            {activeSection === "api" && (
              <Card title="API Configuration">
                <InfoBox variant="warn">Stored in localStorage only. Empty = use server env variables.</InfoBox>
                <Field>
                  <Label sub="Overrides NEYNAR_API_KEY env var">Neynar API Key</Label>
                  <Inp type="password" value={cfg.api.neynarApiKey} onChange={v => set("api", "neynarApiKey", v)} placeholder="neynar_..." />
                </Field>
                <Field>
                  <Label sub="Default: hub-api.neynar.com">Hub URL Override</Label>
                  <Inp value={cfg.api.hubUrl} onChange={v => set("api", "hubUrl", v)} placeholder="https://hub-api.neynar.com" />
                </Field>
                <Field>
                  <Label sub="Default: mainnet.optimism.io">Optimism RPC URL</Label>
                  <Inp value={cfg.api.rpcUrl} onChange={v => set("api", "rpcUrl", v)} placeholder="https://mainnet.optimism.io" />
                </Field>
                <Field>
                  <Label sub="For image uploads">Imgur Client ID</Label>
                  <Inp type="password" value={cfg.api.imgurClientId} onChange={v => set("api", "imgurClientId", v)} />
                </Field>
                <div className="mt-4 pt-4 border-t border-border/40 grid grid-cols-2 gap-3">
                  <Field>
                    <Label sub="Max actions per minute">Action Rate Limit</Label>
                    <input type="number" value={cfg.rateLimits.actionPerMin} min={10} max={1000}
                      onChange={e => update(p => ({ ...p, rateLimits: { ...p.rateLimits, actionPerMin: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all" />
                  </Field>
                  <Field>
                    <Label sub="Global requests per minute">Global Rate Limit</Label>
                    <input type="number" value={cfg.rateLimits.globalPerMin} min={10} max={1000}
                      onChange={e => update(p => ({ ...p, rateLimits: { ...p.rateLimits, globalPerMin: Number(e.target.value) } }))}
                      className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all" />
                  </Field>
                </div>
              </Card>
            )}

            {/* ── MISC ───────────────────────────────────────────── */}
            {activeSection === "misc" && (
              <>
                <Card title="Maintenance">
                  <ToggleRow enabled={cfg.misc.maintenanceMode} onChange={v => set("misc", "maintenanceMode", v)} label="Maintenance Mode" sub="Shows a maintenance banner to all users" />
                  <Field className="mt-3">
                    <Label sub="Message shown during maintenance">Maintenance Message</Label>
                    <Inp value={cfg.misc.maintenanceMessage} onChange={v => set("misc", "maintenanceMessage", v)} />
                  </Field>
                </Card>
                <Card title="App Settings">
                  <Field>
                    <Label sub="Default tab when opening the app">Default Feed Tab</Label>
                    <select
                      value={cfg.misc.defaultTab}
                      onChange={e => set("misc", "defaultTab", e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all"
                    >
                      <option value="feed">Feed</option>
                      <option value="market">Market</option>
                      <option value="notifications">Notifications</option>
                    </select>
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field>
                      <Label sub="ms between batch follows">Batch Follow Delay</Label>
                      <input type="number" value={cfg.misc.batchFollowDelay} min={500} max={10000} step={100}
                        onChange={e => set("misc", "batchFollowDelay", Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all" />
                    </Field>
                    <Field>
                      <Label sub="ms of inactivity before lock">Session Timeout</Label>
                      <input type="number" value={cfg.misc.sessionInactivityMs} min={60000} max={86400000} step={60000}
                        onChange={e => set("misc", "sessionInactivityMs", Number(e.target.value))}
                        className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all" />
                    </Field>
                  </div>
                </Card>
                <Card title="Footer">
                  <Field>
                    <Label sub="Optional extra text in the app footer">App Footer Text</Label>
                    <Inp value={cfg.misc.footerText} onChange={v => set("misc", "footerText", v)} placeholder="Optional footer note" />
                  </Field>
                </Card>
                <Card title="Admin PIN">
                  <ChangePinForm />
                </Card>
              </>
            )}

          </div>
        </main>
      </div>
    </div>
  );
}

// ── Change PIN form ───────────────────────────────────────────────────────────

function ChangePinForm() {
  const [oldPin, setOldPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [cfmPin, setCfmPin] = useState("");
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);
  const [loading, setLoading] = useState(false);

  const hasPin = !!localStorage.getItem(ADMIN_PIN_KEY);

  async function handleChange(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setOk(false); setLoading(true);
    if (hasPin) {
      const oldHash = await sha256Hex(oldPin);
      if (oldHash !== localStorage.getItem(ADMIN_PIN_KEY)) {
        setError("Current PIN is wrong."); setLoading(false); return;
      }
    }
    if (newPin.length < 6) { setError("New PIN must be at least 6 characters."); setLoading(false); return; }
    if (newPin !== cfmPin) { setError("New PINs don't match."); setLoading(false); return; }
    const hash = await sha256Hex(newPin);
    localStorage.setItem(ADMIN_PIN_KEY, hash);
    localStorage.removeItem(ADMIN_PIN_LOCK_KEY);
    localStorage.setItem(ADMIN_PIN_TRIES_KEY, "0");
    setOldPin(""); setNewPin(""); setCfmPin("");
    setOk(true); setLoading(false);
  }

  return (
    <form onSubmit={handleChange} className="space-y-3">
      <p className="text-[12px] text-muted-foreground leading-snug mb-2">
        The admin PIN protects the panel from unauthorized access. Required every new browser session.
      </p>
      {hasPin && (
        <div>
          <Label>Current PIN</Label>
          <input type="password" value={oldPin} onChange={e => { setOldPin(e.target.value); setError(""); setOk(false); }}
            placeholder="Current PIN"
            className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label>{hasPin ? "New PIN" : "Create PIN"}</Label>
          <input type="password" value={newPin} onChange={e => { setNewPin(e.target.value); setError(""); setOk(false); }}
            placeholder="Min 6 chars"
            className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all" />
        </div>
        <div>
          <Label>Confirm</Label>
          <input type="password" value={cfmPin} onChange={e => { setCfmPin(e.target.value); setError(""); setOk(false); }}
            placeholder="Repeat PIN"
            className="w-full px-3 py-2 rounded-xl text-[13px] bg-muted/30 border border-border text-foreground outline-none focus:border-primary/50 transition-all" />
        </div>
      </div>
      {error && <p className="text-[12px] text-destructive">{error}</p>}
      {ok && <p className="text-[12px] text-emerald-500 font-semibold">PIN changed successfully.</p>}
      <button type="submit" disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-white font-bold text-[13px] hover:bg-primary/90 transition-all disabled:opacity-50">
        {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
        {hasPin ? "Change PIN" : "Set PIN"}
      </button>
    </form>
  );
}

// ── Announcement editor ───────────────────────────────────────────────────────

function AnnouncementEditor({ announcement: a, onChange, onDelete }: {
  announcement: Announcement;
  onChange: (a: Announcement) => void;
  onDelete: () => void;
}) {
  return (
    <div className="p-4 rounded-2xl border border-border/60 bg-card/40 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <select
            value={a.type}
            onChange={e => onChange({ ...a, type: e.target.value as Announcement["type"] })}
            className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-muted/40 border border-border text-foreground outline-none focus:border-primary/50"
          >
            <option value="info">ℹ Info</option>
            <option value="warning">⚠ Warning</option>
            <option value="success">✓ Success</option>
          </select>
          <span className={cn("text-[11px] font-bold px-2 py-0.5 rounded-full",
            a.enabled ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground"
          )}>
            {a.enabled ? "LIVE" : "OFF"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => onChange({ ...a, enabled: !a.enabled })}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
            {a.enabled ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
          <button onClick={onDelete} className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <Txtarea value={a.text} onChange={v => onChange({ ...a, text: v })} placeholder="Announcement text…" rows={2} />
      <div className="grid grid-cols-2 gap-2">
        <Inp value={a.url ?? ""} onChange={v => onChange({ ...a, url: v })} placeholder="Link URL (optional)" />
        <Inp value={a.urlLabel ?? ""} onChange={v => onChange({ ...a, urlLabel: v })} placeholder="Link label" />
      </div>
      <ToggleRow enabled={a.dismissible} onChange={v => onChange({ ...a, dismissible: v })} label="Dismissible by users" />
    </div>
  );
}
