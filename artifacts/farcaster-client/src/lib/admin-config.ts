/**
 * Admin configuration store.
 * All settings live in localStorage under fc_admin_cfg.
 * Only readable by the app; only writable from AdminPage (guarded by FID check).
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
  id: string; // e.g. "farcaster"
  label?: string;
}

export interface AdminConfig {
  // ── Copy / text
  copy: {
    heroTitle: string;
    heroSubtitle: string;
    heroDescription: string;
    heroCta: string;
    heroSecondaryCta: string;
    heroTags: string[];   // e.g. ["No registration", "No email", ...]
    navBrand: string;
    appBadge: string;
  };

  // ── Theme
  theme: {
    primaryHsl: string;          // e.g. "263 70% 50%"
    primaryDarkHsl: string;      // e.g. "263 78% 62%"
    primaryForegroundHsl: string;
    backgroundHsl: string;       // light mode background
    darkBackgroundHsl: string;   // dark mode background
    backgroundImage: string;     // CSS background-image or ""
    borderRadius: string;        // e.g. "0.75rem"
    fontFamily: string;          // e.g. "" for default or a Google Fonts import name
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
    landingPageEnabled: boolean;  // if false, / redirects to /login immediately
  };

  // ── Privileged users (batch follow + special features)
  privilegedUsers: string[];     // list of usernames, e.g. ["polycaster", "m--"]

  // ── API / endpoints
  api: {
    neynarApiKey: string;        // overrides env key if non-empty
    hubUrl: string;              // override hub URL
    rpcUrl: string;              // override Optimism RPC
    imgurClientId: string;
  };

  // ── Announcements (sitewide banners)
  announcements: Announcement[];

  // ── Featured channels
  featuredChannels: FeaturedChannel[];

  // ── Rate limiting (passed to server via a special header — future use)
  rateLimits: {
    actionPerMin: number;        // default 200
    globalPerMin: number;        // default 120
  };

  // ── Custom CSS (injected into <style>)
  customCss: string;

  // ── Misc
  misc: {
    footerText: string;
    maintenanceMode: boolean;
    maintenanceMessage: string;
    defaultTab: "feed" | "market" | "notifications";
    batchFollowDelay: number;    // ms between batch follows, default 2000
    sessionInactivityMs: number; // default 1800000 (30 min)
  };
}

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: AdminConfig = {
  copy: {
    heroTitle: "Cast. Connect.\nTrade your\nFarcaster ID.",
    heroSubtitle: "The only Farcaster client with a built-in peer-to-peer FID marketplace on Optimism.",
    heroDescription: "No registration. No email. Just your Farcaster identity — ready in seconds.",
    heroCta: "Enter App",
    heroSecondaryCta: "Explore FID Market",
    heroTags: ["No registration", "No email", "Open source", "On Optimism"],
    navBrand: "FidCaster",
    appBadge: "Farcaster Client · Live on Optimism",
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

export function loadAdminConfig(): AdminConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed: StoredConfig = JSON.parse(raw);
    if (parsed.version !== STORAGE_VERSION) return structuredClone(DEFAULT_CONFIG);
    // Deep merge with defaults so new keys from code updates are always present
    return deepMerge(structuredClone(DEFAULT_CONFIG), parsed.data);
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

export function saveAdminConfig(cfg: AdminConfig): void {
  try {
    const stored: StoredConfig = { version: STORAGE_VERSION, data: cfg };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    // Dispatch event so all hook instances react immediately
    window.dispatchEvent(new CustomEvent("fc_admin_cfg_change", { detail: cfg }));
  } catch {}
}

export function resetAdminConfig(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
  window.dispatchEvent(new CustomEvent("fc_admin_cfg_change", { detail: structuredClone(DEFAULT_CONFIG) }));
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
    // Apply to dark mode by checking current class
    const isDark = root.classList.contains("dark");
    root.style.setProperty("--primary", isDark ? t.primaryDarkHsl : t.primaryHsl);
  }
  if (t.primaryForegroundHsl) root.style.setProperty("--primary-foreground", t.primaryForegroundHsl);
  if (t.borderRadius) root.style.setProperty("--radius", t.borderRadius);

  // Custom CSS
  if (!_injectedStyleEl) {
    _injectedStyleEl = document.createElement("style");
    _injectedStyleEl.id = "fc-admin-custom-css";
    document.head.appendChild(_injectedStyleEl);
  }
  _injectedStyleEl.textContent = cfg.customCss || "";
}
