import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import {
  Settings, Type, Palette, Zap, Users, Key, Bell, Hash,
  Save, RotateCcw, ChevronRight, X, Plus, Trash2, Eye, EyeOff,
  Code, Shield, Gauge, ToggleLeft, ToggleRight, ArrowLeft, Copy, Check,
  AlertTriangle, Info, CheckCircle2, RefreshCw,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useAdminConfig } from "@/hooks/useAdminConfig";
import { resetAdminConfig, applyAdminTheme, ADMIN_FID, type Announcement, type FeaturedChannel } from "@/lib/admin-config";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ── Section IDs ────────────────────────────────────────────────────────────────
type Section =
  | "copy"
  | "theme"
  | "features"
  | "users"
  | "api"
  | "announcements"
  | "channels"
  | "ratelimits"
  | "css"
  | "misc";

const SECTIONS: { id: Section; label: string; icon: typeof Settings; description: string }[] = [
  { id: "copy",          label: "متن‌ها و Copy",    icon: Type,         description: "عناوین، دکمه‌ها، توضیحات" },
  { id: "theme",         label: "تم و رنگ‌ها",      icon: Palette,      description: "رنگ primary، پس‌زمینه، فونت" },
  { id: "features",      label: "Feature Flags",    icon: ToggleLeft,   description: "فعال/غیرفعال کردن قابلیت‌ها" },
  { id: "users",         label: "کاربران مجاز",     icon: Users,        description: "دسترسی‌های خاص و batch follow" },
  { id: "api",           label: "تنظیمات API",      icon: Key,          description: "کلید Neynar، Hub URL، RPC" },
  { id: "announcements", label: "اعلانیه‌ها",        icon: Bell,         description: "بنرهای سراسری" },
  { id: "channels",      label: "کانال‌های پیشفرض", icon: Hash,         description: "Featured channels" },
  { id: "ratelimits",    label: "Rate Limits",      icon: Gauge,        description: "محدودیت درخواست سرور" },
  { id: "css",           label: "Custom CSS",       icon: Code,         description: "استایل دلخواه" },
  { id: "misc",          label: "متفرقه",            icon: Settings,     description: "تنظیمات عمومی" },
];

// ── Small utility components ───────────────────────────────────────────────────

function Label({ children, sub }: { children: React.ReactNode; sub?: string }) {
  return (
    <div className="mb-1.5">
      <p className="text-sm font-semibold text-foreground">{children}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div className="space-y-1.5 mb-5">{children}</div>;
}

function Input({ value, onChange, placeholder, type = "text", className = "" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; type?: string; className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn("input-luxury w-full px-3 py-2 text-sm", className)}
    />
  );
}

function Textarea({ value, onChange, placeholder, rows = 4 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="input-luxury w-full px-3 py-2 text-sm resize-y"
    />
  );
}

function Toggle({ enabled, onChange, label }: { enabled: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      onClick={() => onChange(!enabled)}
      className="flex items-center gap-3 w-full py-2.5 px-3 rounded-xl hover:bg-accent/40 transition-colors text-left"
    >
      {enabled
        ? <ToggleRight className="w-5 h-5 text-primary shrink-0" />
        : <ToggleLeft className="w-5 h-5 text-muted-foreground shrink-0" />}
      <span className={cn("text-sm font-medium", enabled ? "text-foreground" : "text-muted-foreground")}>{label}</span>
      <span className={cn("ml-auto text-xs font-semibold px-2 py-0.5 rounded-full",
        enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}>{enabled ? "ON" : "OFF"}</span>
    </button>
  );
}

function NumberInput({ value, onChange, min, max, step = 1 }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className="input-luxury w-full px-3 py-2 text-sm"
    />
  );
}

// ── Main AdminPage ─────────────────────────────────────────────────────────────

export function AdminPage() {
  const { fid } = useWallet();
  const [, navigate] = useLocation();
  const [cfg, update] = useAdminConfig();
  const [activeSection, setActiveSection] = useState<Section>("copy");
  const [saved, setSaved] = useState(false);

  const isAdmin = fid !== null && Number(fid) === ADMIN_FID;

  useEffect(() => {
    if (isAdmin) applyAdminTheme(cfg);
  }, [cfg, isAdmin]);

  function save() {
    setSaved(true);
    applyAdminTheme(cfg);
    toast.success("تنظیمات ذخیره شد ✓");
    setTimeout(() => setSaved(false), 2000);
  }

  function reset() {
    if (!confirm("تمام تنظیمات به حالت پیشفرض برگردد؟")) return;
    resetAdminConfig();
    toast.success("تنظیمات reset شد");
    window.location.reload();
  }

  function set<K extends keyof typeof cfg>(section: K, key: keyof (typeof cfg)[K], value: unknown) {
    update((prev) => ({
      ...prev,
      [section]: { ...(prev[section] as object), [key]: value },
    }));
  }

  // ── Guard ──────────────────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 p-8">
          <Shield className="w-12 h-12 text-destructive mx-auto opacity-60" />
          <p className="text-xl font-bold text-foreground">دسترسی ممنوع</p>
          <p className="text-sm text-muted-foreground">این صفحه فقط برای ادمین قابل دسترسی است.</p>
          <button onClick={() => navigate("/dashboard")} className="btn-luxury px-4 py-2 rounded-xl text-sm font-semibold text-primary-foreground">
            بازگشت
          </button>
        </div>
      </div>
    );
  }

  const SectionIcon = SECTIONS.find(s => s.id === activeSection)?.icon ?? Settings;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top bar */}
      <div className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-background/95 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/dashboard")} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Shield className="w-4 h-4 text-primary" />
          <span className="font-bold text-foreground">Admin Panel</span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">@m--</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={reset} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
            <RotateCcw className="w-3 h-3" /> Reset
          </button>
          <button onClick={save} className={cn(
            "flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all",
            saved ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "btn-luxury text-primary-foreground"
          )}>
            {saved ? <><Check className="w-3 h-3" /> Saved</> : <><Save className="w-3 h-3" /> ذخیره</>}
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-56 shrink-0 border-r border-border overflow-y-auto bg-card/40">
          <nav className="p-2 space-y-0.5">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveSection(s.id)}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all text-sm",
                    activeSection === s.id
                      ? "bg-primary/10 text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  )}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate">{s.label}</p>
                  </div>
                  {activeSection === s.id && <ChevronRight className="w-3 h-3 ml-auto shrink-0" />}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center gap-2 mb-6">
              <SectionIcon className="w-5 h-5 text-primary" />
              <h2 className="text-base font-bold text-foreground">
                {SECTIONS.find(s => s.id === activeSection)?.label}
              </h2>
              <span className="text-xs text-muted-foreground">
                — {SECTIONS.find(s => s.id === activeSection)?.description}
              </span>
            </div>

            {/* ── COPY ── */}
            {activeSection === "copy" && (
              <div>
                <Field>
                  <Label sub="عنوان اصلی صفحه landing">Hero Title</Label>
                  <Textarea value={cfg.copy.heroTitle} onChange={(v) => set("copy", "heroTitle", v)} rows={3} placeholder="Cast. Connect.\nTrade your\nFarcaster ID." />
                </Field>
                <Field>
                  <Label sub="زیرعنوان اول">Hero Subtitle</Label>
                  <Textarea value={cfg.copy.heroSubtitle} onChange={(v) => set("copy", "heroSubtitle", v)} rows={2} />
                </Field>
                <Field>
                  <Label sub="زیرعنوان دوم">Hero Description</Label>
                  <Input value={cfg.copy.heroDescription} onChange={(v) => set("copy", "heroDescription", v)} />
                </Field>
                <Field>
                  <Label sub="دکمه اصلی CTA">Hero CTA Button</Label>
                  <Input value={cfg.copy.heroCta} onChange={(v) => set("copy", "heroCta", v)} />
                </Field>
                <Field>
                  <Label sub="دکمه دوم CTA">Hero Secondary Button</Label>
                  <Input value={cfg.copy.heroSecondaryCta} onChange={(v) => set("copy", "heroSecondaryCta", v)} />
                </Field>
                <Field>
                  <Label sub="تگ‌های زیر دکمه‌ها، با کاما جدا شده">Hero Tags</Label>
                  <Input
                    value={cfg.copy.heroTags.join(", ")}
                    onChange={(v) => set("copy", "heroTags", v.split(",").map(s => s.trim()).filter(Boolean))}
                    placeholder="No registration, No email, Open source, On Optimism"
                  />
                </Field>
                <Field>
                  <Label sub="نام برند در nav">Nav Brand Name</Label>
                  <Input value={cfg.copy.navBrand} onChange={(v) => set("copy", "navBrand", v)} />
                </Field>
                <Field>
                  <Label sub="بج سبز بالای عنوان">App Badge Text</Label>
                  <Input value={cfg.copy.appBadge} onChange={(v) => set("copy", "appBadge", v)} />
                </Field>
              </div>
            )}

            {/* ── THEME ── */}
            {activeSection === "theme" && (
              <div>
                <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 flex items-start gap-2 mb-5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-400">رنگ‌ها به فرمت HSL وارد شوند، مثال: <code>263 70% 50%</code></p>
                </div>
                <Field>
                  <Label sub="HSL — رنگ اصلی، حالت light">Primary Color (Light)</Label>
                  <div className="flex gap-2">
                    <Input value={cfg.theme.primaryHsl} onChange={(v) => set("theme", "primaryHsl", v)} placeholder="263 70% 50%" />
                    <div className="w-10 h-10 rounded-lg shrink-0 border border-border" style={{ background: `hsl(${cfg.theme.primaryHsl})` }} />
                  </div>
                </Field>
                <Field>
                  <Label sub="HSL — رنگ اصلی، حالت dark">Primary Color (Dark)</Label>
                  <div className="flex gap-2">
                    <Input value={cfg.theme.primaryDarkHsl} onChange={(v) => set("theme", "primaryDarkHsl", v)} placeholder="263 78% 62%" />
                    <div className="w-10 h-10 rounded-lg shrink-0 border border-border" style={{ background: `hsl(${cfg.theme.primaryDarkHsl})` }} />
                  </div>
                </Field>
                <Field>
                  <Label sub="رنگ متن روی primary button">Primary Foreground</Label>
                  <div className="flex gap-2">
                    <Input value={cfg.theme.primaryForegroundHsl} onChange={(v) => set("theme", "primaryForegroundHsl", v)} placeholder="0 0% 100%" />
                    <div className="w-10 h-10 rounded-lg shrink-0 border border-border" style={{ background: `hsl(${cfg.theme.primaryForegroundHsl})` }} />
                  </div>
                </Field>
                <Field>
                  <Label sub="HSL — پس‌زمینه، حالت light">Background (Light)</Label>
                  <Input value={cfg.theme.backgroundHsl} onChange={(v) => set("theme", "backgroundHsl", v)} placeholder="0 0% 100%" />
                </Field>
                <Field>
                  <Label sub="HSL — پس‌زمینه، حالت dark">Background (Dark)</Label>
                  <Input value={cfg.theme.darkBackgroundHsl} onChange={(v) => set("theme", "darkBackgroundHsl", v)} placeholder="224 32% 8%" />
                </Field>
                <Field>
                  <Label sub="border-radius پایه، مثال: 0.75rem">Border Radius</Label>
                  <Input value={cfg.theme.borderRadius} onChange={(v) => set("theme", "borderRadius", v)} placeholder="0.75rem" />
                </Field>
                <Field>
                  <Label sub="نام فونت از Google Fonts (خالی = پیشفرض)">Font Family</Label>
                  <Input value={cfg.theme.fontFamily} onChange={(v) => set("theme", "fontFamily", v)} placeholder="Inter" />
                </Field>
                <button
                  onClick={() => { applyAdminTheme(cfg); toast.success("تم اعمال شد"); }}
                  className="btn-luxury px-4 py-2 rounded-xl text-sm font-semibold text-primary-foreground"
                >
                  <RefreshCw className="w-3.5 h-3.5 inline mr-1.5" />
                  پیش‌نمایش تم
                </button>
              </div>
            )}

            {/* ── FEATURES ── */}
            {activeSection === "features" && (
              <div className="space-y-1 bg-card/40 rounded-2xl border border-border/60 p-3">
                <Toggle enabled={cfg.features.marketEnabled} onChange={(v) => set("features", "marketEnabled", v)} label="FID Marketplace" />
                <Toggle enabled={cfg.features.notificationsEnabled} onChange={(v) => set("features", "notificationsEnabled", v)} label="Notifications" />
                <Toggle enabled={cfg.features.searchEnabled} onChange={(v) => set("features", "searchEnabled", v)} label="Search" />
                <Toggle enabled={cfg.features.miniAppsEnabled} onChange={(v) => set("features", "miniAppsEnabled", v)} label="Mini Apps" />
                <Toggle enabled={cfg.features.proChannelEnabled} onChange={(v) => set("features", "proChannelEnabled", v)} label="Pro Channel Tab" />
                <Toggle enabled={cfg.features.castComposerEnabled} onChange={(v) => set("features", "castComposerEnabled", v)} label="Cast Composer (posting)" />
                <Toggle enabled={cfg.features.darkModeToggleEnabled} onChange={(v) => set("features", "darkModeToggleEnabled", v)} label="Dark Mode Toggle" />
                <Toggle enabled={cfg.features.landingPageEnabled} onChange={(v) => set("features", "landingPageEnabled", v)} label="Landing Page (/ route)" />
              </div>
            )}

            {/* ── USERS ── */}
            {activeSection === "users" && (
              <div>
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-2 mb-5">
                  <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">کاربران این لیست به batch follow، قابلیت‌های خاص و ابزارهای پیشرفته دسترسی دارند.</p>
                </div>
                <div className="space-y-2 mb-4">
                  {cfg.privilegedUsers.map((u, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border">
                      <span className="text-sm font-mono text-foreground flex-1">@{u}</span>
                      {u !== "m--" && (
                        <button
                          onClick={() => update(p => ({ ...p, privilegedUsers: p.privilegedUsers.filter((_, j) => j !== i) }))}
                          className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {u === "m--" && <Shield className="w-3.5 h-3.5 text-primary" />}
                    </div>
                  ))}
                </div>
                <AddUsernameField
                  onAdd={(u) => {
                    if (cfg.privilegedUsers.includes(u)) return;
                    update(p => ({ ...p, privilegedUsers: [...p.privilegedUsers, u] }));
                  }}
                />
              </div>
            )}

            {/* ── API ── */}
            {activeSection === "api" && (
              <div>
                <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 flex items-start gap-2 mb-5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-400">این مقادیر فقط در localStorage ذخیره می‌شوند و در کد ارسال نمی‌شوند. خالی = استفاده از env variable پیشفرض.</p>
                </div>
                <Field>
                  <Label sub="جایگزین NEYNAR_API_KEY env — خالی = پیشفرض">Neynar API Key Override</Label>
                  <Input type="password" value={cfg.api.neynarApiKey} onChange={(v) => set("api", "neynarApiKey", v)} placeholder="neynar_..." />
                </Field>
                <Field>
                  <Label sub="Hub URL سفارشی (خالی = hub-api.neynar.com)">Hub URL</Label>
                  <Input value={cfg.api.hubUrl} onChange={(v) => set("api", "hubUrl", v)} placeholder="https://hub-api.neynar.com" />
                </Field>
                <Field>
                  <Label sub="Optimism RPC URL سفارشی">Optimism RPC URL</Label>
                  <Input value={cfg.api.rpcUrl} onChange={(v) => set("api", "rpcUrl", v)} placeholder="https://mainnet.optimism.io" />
                </Field>
                <Field>
                  <Label sub="Imgur Client ID برای آپلود تصویر">Imgur Client ID Override</Label>
                  <Input type="password" value={cfg.api.imgurClientId} onChange={(v) => set("api", "imgurClientId", v)} placeholder="..." />
                </Field>
              </div>
            )}

            {/* ── ANNOUNCEMENTS ── */}
            {activeSection === "announcements" && (
              <div>
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-2 mb-5">
                  <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">بنرهای سراسری که بالای فید نمایش داده می‌شوند. می‌توانی چندتا داشته باشی.</p>
                </div>
                <div className="space-y-3 mb-4">
                  {cfg.announcements.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-8">هیچ اعلانیه‌ای وجود ندارد.</p>
                  )}
                  {cfg.announcements.map((a, i) => (
                    <AnnouncementEditor
                      key={a.id}
                      announcement={a}
                      onChange={(updated) => update(p => ({
                        ...p,
                        announcements: p.announcements.map((x, j) => j === i ? updated : x),
                      }))}
                      onDelete={() => update(p => ({ ...p, announcements: p.announcements.filter((_, j) => j !== i) }))}
                    />
                  ))}
                </div>
                <button
                  onClick={() => update(p => ({
                    ...p,
                    announcements: [...p.announcements, {
                      id: Date.now().toString(),
                      text: "",
                      type: "info",
                      dismissible: true,
                      enabled: true,
                    }],
                  }))}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors w-full justify-center"
                >
                  <Plus className="w-4 h-4" /> اعلانیه جدید
                </button>
              </div>
            )}

            {/* ── CHANNELS ── */}
            {activeSection === "channels" && (
              <div>
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-2 mb-5">
                  <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">کانال‌هایی که در sidebar و feed پیشفرض نشان داده می‌شوند.</p>
                </div>
                <div className="space-y-2 mb-4">
                  {cfg.featuredChannels.map((ch, i) => (
                    <div key={i} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-card border border-border">
                      <Hash className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <Input
                        value={ch.id}
                        onChange={(v) => update(p => ({
                          ...p,
                          featuredChannels: p.featuredChannels.map((c, j) => j === i ? { ...c, id: v } : c),
                        }))}
                        placeholder="channel-id"
                        className="border-0 p-0 h-auto bg-transparent shadow-none"
                      />
                      <button
                        onClick={() => update(p => ({ ...p, featuredChannels: p.featuredChannels.filter((_, j) => j !== i) }))}
                        className="p-1 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => update(p => ({ ...p, featuredChannels: [...p.featuredChannels, { id: "" }] }))}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-primary/40 text-primary text-sm font-semibold hover:bg-primary/5 transition-colors w-full justify-center"
                >
                  <Plus className="w-4 h-4" /> کانال جدید
                </button>
              </div>
            )}

            {/* ── RATE LIMITS ── */}
            {activeSection === "ratelimits" && (
              <div>
                <div className="p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 flex items-start gap-2 mb-5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-400">این مقادیر برای reference هستند. برای اعمال واقعی باید server/index.ts مقداردهی شود.</p>
                </div>
                <Field>
                  <Label sub="تعداد action (follow/like/cast) در دقیقه">Action Limiter (per min)</Label>
                  <NumberInput value={cfg.rateLimits.actionPerMin} onChange={(v) => set("rateLimits", "actionPerMin", v)} min={1} max={1000} />
                </Field>
                <Field>
                  <Label sub="تعداد درخواست کلی در دقیقه">Global Limiter (per min)</Label>
                  <NumberInput value={cfg.rateLimits.globalPerMin} onChange={(v) => set("rateLimits", "globalPerMin", v)} min={1} max={2000} />
                </Field>
              </div>
            )}

            {/* ── CUSTOM CSS ── */}
            {activeSection === "css" && (
              <div>
                <div className="p-3 rounded-xl bg-primary/5 border border-primary/20 flex items-start gap-2 mb-5">
                  <Code className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground">این CSS مستقیم به DOM تزریق می‌شود. از CSS variables سایت استفاده کن: <code className="text-primary">var(--primary)</code></p>
                </div>
                <Field>
                  <Label>Custom CSS</Label>
                  <Textarea
                    value={cfg.customCss}
                    onChange={(v) => update(p => ({ ...p, customCss: v }))}
                    rows={16}
                    placeholder={`.cast-card { border-radius: 16px; }\n.btn-luxury { letter-spacing: 0.02em; }\n/* ... */`}
                  />
                </Field>
                <button
                  onClick={() => { applyAdminTheme(cfg); toast.success("CSS اعمال شد"); }}
                  className="btn-luxury px-4 py-2 rounded-xl text-sm font-semibold text-primary-foreground"
                >
                  <Eye className="w-3.5 h-3.5 inline mr-1.5" />
                  پیش‌نمایش CSS
                </button>
              </div>
            )}

            {/* ── MISC ── */}
            {activeSection === "misc" && (
              <div>
                <Field>
                  <Label sub="متن footer سایت (خالی = نشان داده نشود)">Footer Text</Label>
                  <Input value={cfg.misc.footerText} onChange={(v) => set("misc", "footerText", v)} placeholder="© 2025 FidCaster" />
                </Field>
                <div className="bg-card/40 rounded-2xl border border-border/60 p-3 mb-5 space-y-1">
                  <Toggle
                    enabled={cfg.misc.maintenanceMode}
                    onChange={(v) => set("misc", "maintenanceMode", v)}
                    label="Maintenance Mode (سایت برای بقیه غیرفعال)"
                  />
                </div>
                {cfg.misc.maintenanceMode && (
                  <Field>
                    <Label sub="پیام نمایش داده‌شده در حالت maintenance">Maintenance Message</Label>
                    <Textarea value={cfg.misc.maintenanceMessage} onChange={(v) => set("misc", "maintenanceMessage", v)} rows={2} />
                  </Field>
                )}
                <Field>
                  <Label sub="تب پیشفرض بعد از ورود">Default Tab After Login</Label>
                  <select
                    value={cfg.misc.defaultTab}
                    onChange={(e) => set("misc", "defaultTab", e.target.value)}
                    className="input-luxury w-full px-3 py-2 text-sm"
                  >
                    <option value="feed">Feed</option>
                    <option value="market">FID Market</option>
                    <option value="notifications">Notifications</option>
                  </select>
                </Field>
                <Field>
                  <Label sub="تأخیر بین هر follow در batch (میلی‌ثانیه)">Batch Follow Delay (ms)</Label>
                  <NumberInput value={cfg.misc.batchFollowDelay} onChange={(v) => set("misc", "batchFollowDelay", v)} min={500} max={10000} step={100} />
                </Field>
                <Field>
                  <Label sub="زمان بی‌فعالی تا قفل شدن session (ms) — پیشفرض: 30 دقیقه">Session Inactivity Lock (ms)</Label>
                  <NumberInput value={cfg.misc.sessionInactivityMs} onChange={(v) => set("misc", "sessionInactivityMs", v)} min={60000} max={86400000} step={60000} />
                </Field>

                {/* Debug info */}
                <div className="mt-8 p-4 rounded-xl bg-muted/40 border border-border/60 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">Info</p>
                  <InfoRow label="Admin FID" value={String(ADMIN_FID)} />
                  <InfoRow label="Your FID" value={fid ? String(fid) : "—"} />
                  <InfoRow label="Config version" value="1" />
                  <InfoRow label="Storage key" value="fc_admin_cfg" />
                </div>
              </div>
            )}

            {/* Save button at bottom */}
            <div className="mt-8 pt-6 border-t border-border/60 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">تغییرات فوری اعمال نمی‌شوند تا ذخیره کنی.</p>
              <button onClick={save} className={cn(
                "flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-semibold transition-all",
                saved ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "btn-luxury text-primary-foreground"
              )}>
                {saved ? <><Check className="w-3.5 h-3.5" /> ذخیره شد</> : <><Save className="w-3.5 h-3.5" /> ذخیره تنظیمات</>}
              </button>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="flex items-center gap-1 font-mono text-foreground hover:text-primary transition-colors"
      >
        {value}
        {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3 opacity-40" />}
      </button>
    </div>
  );
}

function AddUsernameField({ onAdd }: { onAdd: (u: string) => void }) {
  const [val, setVal] = useState("");
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">@</span>
        <input
          value={val}
          onChange={(e) => setVal(e.target.value.toLowerCase().replace(/[^a-z0-9_.-]/g, ""))}
          onKeyDown={(e) => { if (e.key === "Enter" && val) { onAdd(val); setVal(""); } }}
          placeholder="username"
          className="input-luxury w-full pl-7 pr-3 py-2 text-sm"
        />
      </div>
      <button
        onClick={() => { if (val) { onAdd(val); setVal(""); } }}
        className="btn-luxury px-3 py-2 rounded-xl text-sm font-semibold text-primary-foreground"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

function AnnouncementEditor({
  announcement: a,
  onChange,
  onDelete,
}: {
  announcement: Announcement;
  onChange: (a: Announcement) => void;
  onDelete: () => void;
}) {
  const typeColors: Record<Announcement["type"], string> = {
    info: "border-primary/30 bg-primary/5",
    warning: "border-amber-500/30 bg-amber-500/5",
    success: "border-emerald-500/30 bg-emerald-500/5",
  };
  const TypeIcon = { info: Info, warning: AlertTriangle, success: CheckCircle2 }[a.type];

  return (
    <div className={cn("rounded-xl border p-4 space-y-3", typeColors[a.type])}>
      <div className="flex items-center gap-2">
        <TypeIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <select
          value={a.type}
          onChange={(e) => onChange({ ...a, type: e.target.value as Announcement["type"] })}
          className="text-xs font-semibold bg-transparent border-0 outline-none text-muted-foreground cursor-pointer"
        >
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="success">Success</option>
        </select>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => onChange({ ...a, enabled: !a.enabled })}
            className="p-1 rounded-lg hover:bg-background/60 transition-colors"
            title={a.enabled ? "غیرفعال کردن" : "فعال کردن"}
          >
            {a.enabled ? <Eye className="w-3.5 h-3.5 text-primary" /> : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />}
          </button>
          <button onClick={onDelete} className="p-1 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      <textarea
        value={a.text}
        onChange={(e) => onChange({ ...a, text: e.target.value })}
        placeholder="متن اعلانیه..."
        rows={2}
        className="input-luxury w-full px-3 py-2 text-sm resize-none"
      />
      <div className="flex gap-2">
        <input
          value={a.url ?? ""}
          onChange={(e) => onChange({ ...a, url: e.target.value || undefined })}
          placeholder="لینک (اختیاری)"
          className="input-luxury flex-1 px-3 py-1.5 text-xs"
        />
        <input
          value={a.urlLabel ?? ""}
          onChange={(e) => onChange({ ...a, urlLabel: e.target.value || undefined })}
          placeholder="متن لینک"
          className="input-luxury w-28 px-3 py-1.5 text-xs"
        />
      </div>
      <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground">
        <input type="checkbox" checked={a.dismissible} onChange={(e) => onChange({ ...a, dismissible: e.target.checked })} className="rounded" />
        قابل بستن توسط کاربر
      </label>
    </div>
  );
}
