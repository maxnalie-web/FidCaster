/**
 * Admin configuration store.
 *
 * Source of truth is now the server (`/api/public-config` for reads served to
 * every visitor, `/api/admin/config` for authenticated writes) — a real
 * database row, not each browser's own localStorage. localStorage is kept
 * only as a synchronous first-paint cache (so the UI doesn't flash defaults
 * while the network request is in flight); it's refreshed from the server on
 * every load and is never treated as authoritative.
 *
 * `api.neynarApiKey` / `api.imgurClientId` are never included in what's sent
 * to or read from the public config — those are real secrets and live only
 * in the admin-only `/api/admin/secrets` endpoint (see AdminPage's API Keys
 * section), which requires a valid admin session.
 */

export const ADMIN_FID = 16333; // @m--

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Announcement {
  id: string;
  text: string;
  type: "info" | "warning" | "success";
  dismissible: boolean;
  enabled: boolean;
  url?: string;
  urlLabel?: string;
}

export interface FeaturedChannel {
  id: string;
  label?: string;
}

export interface LandingFeature {
  title: string;
  desc: string;
  color: string;
}

export interface FooterLink {
  label: string;
  url: string;
}

export interface AdminConfig {
  // ── Copy / landing hero
  copy: {
    heroTitle: string;
    heroSubtitle: string;
    heroDescription: string;
    heroCta: string;
    heroSecondaryCta: string;
    heroTags: string[];
    navBrand: string;
    appBadge: string;
  };

  // ── SEO
  seo: {
    pageTitle: string;
    metaDescription: string;
    ogImage: string;
    ogUrl: string;
  };

  // ── Social links
  social: {
    twitter: string;
    telegram: string;
    github: string;
    discord: string;
    website: string;
  };

  // ── Branding
  branding: {
    logoText: string;
    faviconEmoji: string;
  };

  // ── App UI texts
  appTexts: {
    sidebarHome: string;
    sidebarMarket: string;
    sidebarSearch: string;
    sidebarNotifications: string;
    sidebarProfile: string;
    feedTabFollowing: string;
    feedTabForYou: string;
    feedTabChannels: string;
    emptyFeedMessage: string;
    errorGeneric: string;
    loginWelcomeTitle: string;
    loginWelcomeSub: string;
  };

  // ── Landing features section (icon order fixed, text editable)
  landingFeatures: LandingFeature[];

  // ── Landing footer
  landingFooter: {
    brandTagline: string;
    copyright: string;
    links: FooterLink[];
  };

  // ── Theme
  theme: {
    primaryHsl: string;
    primaryDarkHsl: string;
    primaryForegroundHsl: string;
    backgroundHsl: string;
    darkBackgroundHsl: string;
    backgroundImage: string;
    borderRadius: string;
    fontFamily: string;
  };

  // ── Feature flags
  features: {
    marketEnabled: boolean;
    notificationsEnabled: boolean;
    searchEnabled: boolean;
    miniAppsEnabled: boolean;
    proChannelEnabled: boolean;
    castComposerEnabled: boolean;
    darkModeToggleEnabled: boolean;
    landingPageEnabled: boolean;
    growEnabled: boolean;
    growToolsForAll: boolean;
  };

  // ── Privileged users
  privilegedUsers: string[];

  // ── API / endpoints
  api: {
    neynarApiKey: string;
    hubUrl: string;
    rpcUrl: string;
    imgurClientId: string;
  };

  // ── Announcements
  announcements: Announcement[];

  // ── Featured channels
  featuredChannels: FeaturedChannel[];

  // ── Rate limiting
  rateLimits: {
    actionPerMin: number;
    globalPerMin: number;
  };

  // ── Custom CSS
  customCss: string;

  // ── Misc
  misc: {
    footerText: string;
    maintenanceMode: boolean;
    maintenanceMessage: string;
    defaultTab: "feed" | "market" | "notifications";
    batchFollowDelay: number;
    sessionInactivityMs: number;
  };
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: AdminConfig = {
  copy: {
    heroTitle: "Cast. Connect.\nTrade your\nFarcaster ID.",
    heroSubtitle: "The only Farcaster client with a built-in peer-to-peer FID marketplace on Optimism.",
    heroDescription: "No registration. No email. Just your Farcaster identity · ready in seconds.",
    heroCta: "Enter App",
    heroSecondaryCta: "Explore FID Market",
    heroTags: ["No registration", "No email", "Open source", "On Optimism"],
    navBrand: "FidCaster",
    appBadge: "Farcaster Client · Live on Optimism",
  },
  seo: {
    pageTitle: "FidCaster",
    metaDescription: "FidCaster · a luxury Farcaster client. Your keys, your identity.",
    ogImage: "",
    ogUrl: "",
  },
  social: {
    twitter: "https://x.com/fidcaster",
    telegram: "https://t.me/Fidcaster",
    github: "",
    discord: "",
    website: "",
  },
  branding: {
    logoText: "FidCaster",
    faviconEmoji: "",
  },
  appTexts: {
    sidebarHome: "Home",
    sidebarMarket: "FID Market",
    sidebarSearch: "Search",
    sidebarNotifications: "Notifications",
    sidebarProfile: "Profile",
    feedTabFollowing: "Following",
    feedTabForYou: "For You",
    feedTabChannels: "Channels",
    emptyFeedMessage: "Nothing here yet. Follow more people to see their casts.",
    errorGeneric: "Something went wrong. Please try again.",
    loginWelcomeTitle: "Welcome back",
    loginWelcomeSub: "Sign in to your Farcaster account to continue.",
  },
  landingFeatures: [
    { title: "Cast & Compose", desc: "Write casts, reply to threads, embed images · signed directly via Farcaster Hub with your keys.", color: "#7c3aed" },
    { title: "Follow & Discover", desc: "Build your social graph. Follow anyone on Farcaster, see their casts in your personalized feed.", color: "#6366f1" },
    { title: "Open Protocol", desc: "Built on Farcaster · a public social protocol. Your social graph belongs to you, not a platform.", color: "#0ea5e9" },
    { title: "FID Marketplace", desc: "List, buy, and trade Farcaster IDs peer-to-peer on Optimism. The only client with an integrated market.", color: "#c026d3" },
    { title: "Your Data, Your Rules", desc: "No registration, no email, no central server. Your account is yours · sign in from any browser, anytime.", color: "#10b981" },
    { title: "On-Chain Actions", desc: "Register signers, transfer recovery, username ops · all on Optimism, straight from the client.", color: "#f59e0b" },
  ],
  landingFooter: {
    brandTagline: "Farcaster Client",
    copyright: "Built on Farcaster · Powered by Optimism",
    links: [
      { label: "FID Market", url: "/market" },
      { label: "Sign In", url: "/login" },
    ],
  },
  theme: {
    primaryHsl: "263 70% 50%",
    primaryDarkHsl: "263 78% 62%",
    primaryForegroundHsl: "0 0% 100%",
    backgroundHsl: "0 0% 100%",
    darkBackgroundHsl: "224 32% 8%",
    backgroundImage: "",
    borderRadius: "0.75rem",
    fontFamily: "",
  },
  features: {
    marketEnabled: true,
    notificationsEnabled: true,
    searchEnabled: true,
    miniAppsEnabled: true,
    proChannelEnabled: true,
    castComposerEnabled: true,
    darkModeToggleEnabled: true,
    landingPageEnabled: true,
    growEnabled: true,
    growToolsForAll: false,
  },
  privilegedUsers: ["polycaster", "m--"],
  api: {
    neynarApiKey: "",
    hubUrl: "",
    rpcUrl: "",
    imgurClientId: "",
  },
  announcements: [],
  featuredChannels: [
    { id: "farcaster" },
    { id: "fc-devs" },
    { id: "design" },
    { id: "base" },
  ],
  rateLimits: {
    actionPerMin: 200,
    globalPerMin: 120,
  },
  customCss: "",
  misc: {
    footerText: "",
    maintenanceMode: false,
    maintenanceMessage: "We'll be back shortly. Maintenance in progress.",
    defaultTab: "feed",
    batchFollowDelay: 2000,
    sessionInactivityMs: 1800000,
  },
};

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "fc_admin_cfg";
const STORAGE_VERSION = 1;

interface StoredConfig {
  version: number;
  data: AdminConfig;
}

/** Secrets never belong in the shared public config — always scrub them,
 * whether reading a locally-cached copy or building a payload to send. */
function scrubSecrets(cfg: AdminConfig): AdminConfig {
  return { ...cfg, api: { ...cfg.api, neynarApiKey: "", imgurClientId: "" } };
}

/** Synchronous fast-paint cache — refreshed from the server by
 * refreshAdminConfigFromServer() on every app load. Never authoritative. */
export function loadAdminConfig(): AdminConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed: StoredConfig = JSON.parse(raw);
    if (parsed.version !== STORAGE_VERSION) return structuredClone(DEFAULT_CONFIG);
    return scrubSecrets(deepMerge(structuredClone(DEFAULT_CONFIG), parsed.data));
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

/** Updates the local fast-paint cache and notifies listeners. Does NOT talk
 * to the server — call pushAdminConfigToServer() (admin-only) for that. */
export function saveAdminConfig(cfg: AdminConfig): void {
  const clean = scrubSecrets(cfg);
  try {
    const stored: StoredConfig = { version: STORAGE_VERSION, data: clean };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {}
  window.dispatchEvent(new CustomEvent("fc_admin_cfg_change", { detail: clean }));
}

export function resetAdminConfig(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  window.dispatchEvent(new CustomEvent("fc_admin_cfg_change", { detail: structuredClone(DEFAULT_CONFIG) }));
}

/** Fetches the real, server-persisted config (every visitor calls this on
 * app load) and updates the local cache so it applies site-wide instead of
 * only in the browser that last edited it. Safe to call unauthenticated. */
export async function refreshAdminConfigFromServer(): Promise<AdminConfig> {
  try {
    const r = await fetch("/api/public-config");
    if (!r.ok) return loadAdminConfig();
    const { config } = await r.json() as { config: AdminConfig | null };
    const merged = scrubSecrets(config ? deepMerge(structuredClone(DEFAULT_CONFIG), config) : structuredClone(DEFAULT_CONFIG));
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data: merged } satisfies StoredConfig));
    } catch {}
    window.dispatchEvent(new CustomEvent("fc_admin_cfg_change", { detail: merged }));
    return merged;
  } catch {
    return loadAdminConfig();
  }
}

/** Admin-only — persists cfg to the server so every visitor sees it. Requires
 * a valid admin session cookie; the server 401s otherwise. */
export async function pushAdminConfigToServer(cfg: AdminConfig): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch("/api/admin/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: scrubSecrets(cfg) }),
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      return { ok: false, error: (data as { error?: string }).error ?? `Save failed (${r.status})` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

// ── Deep merge helper ─────────────────────────────────────────────────────────

function deepMerge<T>(target: T, source: Partial<T>): T {
  if (!source || typeof source !== "object") return target;
  const result = { ...target };
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sv = source[key];
    const tv = target[key];
    if (sv !== undefined) {
      if (sv && typeof sv === "object" && !Array.isArray(sv) && tv && typeof tv === "object" && !Array.isArray(tv)) {
        (result as Record<keyof T, unknown>)[key] = deepMerge(tv, sv as Partial<typeof tv>);
      } else {
        (result as Record<keyof T, unknown>)[key] = sv;
      }
    }
  }
  return result;
}

// ── CSS injection ─────────────────────────────────────────────────────────────

let _injectedStyleEl: HTMLStyleElement | null = null;

export function applyAdminTheme(cfg: AdminConfig): void {
  const t = cfg.theme;
  const root = document.documentElement;

  if (t.primaryHsl) root.style.setProperty("--primary", t.primaryHsl);
  if (t.primaryDarkHsl) {
    const isDark = root.classList.contains("dark");
    root.style.setProperty("--primary", isDark ? t.primaryDarkHsl : t.primaryHsl);
  }
  if (t.primaryForegroundHsl) root.style.setProperty("--primary-foreground", t.primaryForegroundHsl);
  if (t.borderRadius) root.style.setProperty("--radius", t.borderRadius);

  if (!_injectedStyleEl) {
    _injectedStyleEl = document.createElement("style");
    _injectedStyleEl.id = "fc-admin-custom-css";
    document.head.appendChild(_injectedStyleEl);
  }
  _injectedStyleEl.textContent = cfg.customCss || "";
}

export function applyAdminSeo(cfg: AdminConfig): void {
  try {
    if (cfg.seo.pageTitle) document.title = cfg.seo.pageTitle;
    const setMeta = (sel: string, val: string) => {
      if (!val) return;
      const el = document.querySelector(sel);
      if (el) el.setAttribute("content", val);
    };
    setMeta('meta[name="description"]', cfg.seo.metaDescription);
    setMeta('meta[property="og:title"]', cfg.seo.pageTitle);
    setMeta('meta[property="og:description"]', cfg.seo.metaDescription);
    if (cfg.seo.ogImage) setMeta('meta[property="og:image"]', cfg.seo.ogImage);
    if (cfg.seo.ogUrl) setMeta('meta[property="og:url"]', cfg.seo.ogUrl);
    if (cfg.branding.faviconEmoji) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${cfg.branding.faviconEmoji}</text></svg>`;
      const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
      const link = document.querySelector('link[rel="icon"]') as HTMLLinkElement | null;
      if (link) link.href = url;
    }
  } catch {}
}
