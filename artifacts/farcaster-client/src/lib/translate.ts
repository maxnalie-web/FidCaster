// Broad world-language coverage · Farsi always included.
export const SUPPORTED_LANGS = [
  { code: "en",    label: "English" },
  { code: "es",    label: "Español" },
  { code: "fa",    label: "فارسی" },
  { code: "ar",    label: "العربية" },
  { code: "fr",    label: "Français" },
  { code: "zh-CN", label: "中文" },
  { code: "ru",    label: "Русский" },
  { code: "pt",    label: "Português" },
  { code: "de",    label: "Deutsch" },
  { code: "it",    label: "Italiano" },
  { code: "ja",    label: "日本語" },
  { code: "ko",    label: "한국어" },
  { code: "hi",    label: "हिन्दी" },
  { code: "tr",    label: "Türkçe" },
  { code: "vi",    label: "Tiếng Việt" },
  { code: "id",    label: "Bahasa Indonesia" },
  { code: "th",    label: "ไทย" },
  { code: "pl",    label: "Polski" },
  { code: "nl",    label: "Nederlands" },
  { code: "uk",    label: "Українська" },
] as const;

export type LangCode = (typeof SUPPORTED_LANGS)[number]["code"];

export interface TranslateResult { translated: string; detected?: string }

// Small client-side cache · avoids re-fetching within one session (e.g. toggling
// translate on/off, or revisiting the same cast).
const cache = new Map<string, TranslateResult>();

/**
 * Translate scales to thousands of concurrent viewers the same way follow/unfollow
 * does: each browser calls Google's public translate endpoint DIRECTLY from the
 * user's own IP first (it's CORS-enabled · verified live), so no single server IP
 * ever accumulates enough volume to get rate-limited. Our own /api/translate is
 * only a fallback for the rare network/CORS-hostile environment, and it caches
 * results server-side too, so even the fallback path stays cheap.
 */
async function translateDirect(text: string, target: LangCode): Promise<TranslateResult | null> {
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6_000) });
    if (!res.ok) return null;
    const data = await res.json() as [Array<[string, string]>, unknown, string];
    const translated = data[0]?.map((seg) => seg[0]).join("") ?? "";
    if (!translated) return null;
    return { translated, detected: typeof data[2] === "string" ? data[2] : undefined };
  } catch {
    return null; // CORS-hostile network / offline / Google hiccup → fall back to server
  }
}

async function translateViaServer(text: string, target: LangCode): Promise<TranslateResult> {
  const res = await fetch("/api/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, target }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `Translation failed (${res.status})`);
  }
  return res.json() as Promise<TranslateResult>;
}

export async function translateTextFull(text: string, target: LangCode): Promise<TranslateResult> {
  const key = `${target}:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const direct = await translateDirect(text, target);
  const result = direct ?? await translateViaServer(text, target);
  cache.set(key, result);
  return result;
}

export async function translateText(text: string, target: LangCode): Promise<string> {
  return (await translateTextFull(text, target)).translated;
}

/** Best-guess default target language from the browser's locale, falling back to English. */
export function localeToLang(locale: string): LangCode {
  const nav = locale.toLowerCase();
  if (nav.startsWith("fa")) return "fa";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("ar")) return "ar";
  if (nav.startsWith("fr")) return "fr";
  if (nav.startsWith("zh")) return "zh-CN";
  if (nav.startsWith("ru")) return "ru";
  if (nav.startsWith("pt")) return "pt";
  if (nav.startsWith("de")) return "de";
  if (nav.startsWith("it")) return "it";
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("ko")) return "ko";
  if (nav.startsWith("hi")) return "hi";
  if (nav.startsWith("tr")) return "tr";
  if (nav.startsWith("vi")) return "vi";
  if (nav.startsWith("id")) return "id";
  if (nav.startsWith("th")) return "th";
  if (nav.startsWith("pl")) return "pl";
  if (nav.startsWith("nl")) return "nl";
  if (nav.startsWith("uk")) return "uk";
  return "en";
}

export function defaultTargetLang(): LangCode {
  return localeToLang(navigator.language || "en");
}

// ─── User preference (Settings → Language) ────────────────────────────────────
// Translation is always manual (tap the globe icon) · it defaults to the
// viewer's device locale, and this lets them override that default explicitly.
const PREF_LANG_KEY = "fc_translate_lang";

/** Either an explicit language code, or "auto" (follow the device locale). */
export type LangSetting = LangCode | "auto";

/** Raw setting as chosen in Settings → Language · "auto" when unset or auto. */
export function getLangSetting(): LangSetting {
  try {
    const stored = localStorage.getItem(PREF_LANG_KEY);
    if (stored === "auto") return "auto";
    if (stored && SUPPORTED_LANGS.some((l) => l.code === stored)) return stored as LangCode;
  } catch { /* ignore */ }
  return "auto";
}

/** Viewer's preferred translation target · resolves "auto" to the device locale. */
export function getPreferredLang(): LangCode {
  const setting = getLangSetting();
  return setting === "auto" ? defaultTargetLang() : setting;
}

export function setPreferredLang(lang: LangSetting): void {
  try { localStorage.setItem(PREF_LANG_KEY, lang); } catch { /* ignore */ }
}
