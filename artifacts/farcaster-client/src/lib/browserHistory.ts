// Persistence for the in-app DeFi browser (DeFiBrowserSheet). The sheet is
// fully unmounted whenever it's closed (its React state — url, network,
// connection — dies with it), so without this, every re-open started from a
// blank "New Tab" page. This module keeps the last page you were on (so
// reopening the browser resumes where you left off) and a simple visit
// history, both in localStorage.

const LAST_SESSION_KEY = "fc-browser-last-session";
const HISTORY_KEY = "fc-browser-history";
const MAX_HISTORY = 200;

export interface LastSession {
  url: string;
  network: string;
}

export interface HistoryEntry {
  url: string;
  visitedAt: number;
}

export function loadLastSession(): LastSession | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastSession>;
    if (typeof parsed.url !== "string" || typeof parsed.network !== "string") return null;
    return { url: parsed.url, network: parsed.network };
  } catch { return null; }
}

export function saveLastSession(url: string, network: string): void {
  try { localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ url, network })); } catch { /* storage full/unavailable */ }
}

export function clearLastSession(): void {
  try { localStorage.removeItem(LAST_SESSION_KEY); } catch { /* ignore */ }
}

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is HistoryEntry => typeof e?.url === "string" && typeof e?.visitedAt === "number");
  } catch { return []; }
}

export function addHistoryEntry(url: string): void {
  try {
    const existing = loadHistory().filter(e => e.url !== url);
    const next = [{ url, visitedAt: Date.now() }, ...existing].slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch { /* storage full/unavailable */ }
}

export function clearHistory(): void {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
}
