/**
 * Persists which mini apps the user has "added" via the SDK's addMiniApp
 * action (sdk.actions.addMiniApp() — many mini apps call this after their
 * own onboarding, or from a settings screen, and then check
 * context.client.added on future opens to render "Add" vs "Added"). Keyed by
 * origin, not full URL, since a mini app's identity is its domain regardless
 * of path/query — same rule Farcaster's own manifest-based mini app
 * discovery uses. Local-only (no server sync): this is a per-device
 * bookmark list, not an account-level Farcaster concept we can write to.
 */

export interface AddedMiniApp {
  origin: string;
  name: string;
  iconUrl?: string;
  addedAt: number;
}

const STORAGE_KEY = "fc_added_miniapps";

function load(): AddedMiniApp[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function save(list: AddedMiniApp[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch { /* ignore quota errors */ }
}

let cache: AddedMiniApp[] = load();
const listeners = new Set<(apps: AddedMiniApp[]) => void>();

function notify(): void {
  for (const l of listeners) l(cache);
}

export function getAddedMiniApps(): AddedMiniApp[] {
  return cache;
}

export function isMiniAppAdded(origin: string): boolean {
  return cache.some((a) => a.origin === origin);
}

export function addMiniAppToStore(entry: { origin: string; name: string; iconUrl?: string }): void {
  if (isMiniAppAdded(entry.origin)) return;
  cache = [{ ...entry, addedAt: Date.now() }, ...cache];
  save(cache);
  notify();
}

export function removeMiniAppFromStore(origin: string): void {
  if (!isMiniAppAdded(origin)) return;
  cache = cache.filter((a) => a.origin !== origin);
  save(cache);
  notify();
}

export function subscribeAddedMiniApps(listener: (apps: AddedMiniApp[]) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
