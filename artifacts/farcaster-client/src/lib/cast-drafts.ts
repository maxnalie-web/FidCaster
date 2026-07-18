/** Draft persistence for the main "new cast" composer (not replies/quotes,
 * which are short-lived and tied to a specific parent in the moment).
 *
 * Mirrors the same server + localStorage pattern as custom-feeds.ts: local
 * storage answers instantly, the server copy is what actually survives
 * logout, account switch, and app uninstall/reinstall, since it's keyed by
 * FID on the backend rather than living only in this one device's storage. */

export type CastDraft = {
  text: string;
  embeds: string[];
  channelId: string | null;
  updatedAt: number;
};

const PREF_KEY = "cast_draft";

function storageKey(fid: number): string {
  return `fc_cast_draft_${fid}`;
}

export function getLocalDraft(fid: number): CastDraft | null {
  try {
    const raw = localStorage.getItem(storageKey(fid));
    return raw ? (JSON.parse(raw) as CastDraft) : null;
  } catch {
    return null;
  }
}

function saveLocal(fid: number, draft: CastDraft): void {
  try { localStorage.setItem(storageKey(fid), JSON.stringify(draft)); } catch { /* ignore */ }
}

function clearLocal(fid: number): void {
  try { localStorage.removeItem(storageKey(fid)); } catch { /* ignore */ }
}

/** Fire-and-forget push so the draft follows the account across devices,
 * logouts, and reinstalls - not just this browser's localStorage. */
export function saveDraft(fid: number, draft: Omit<CastDraft, "updatedAt">): void {
  const full: CastDraft = { ...draft, updatedAt: Date.now() };
  saveLocal(fid, full);
  fetch("/api/user-prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fid, key: PREF_KEY, value: JSON.stringify(full) }),
  }).catch(() => { /* best-effort · localStorage already has it */ });
}

export function clearDraft(fid: number): void {
  clearLocal(fid);
  fetch("/api/user-prefs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fid, key: PREF_KEY, value: JSON.stringify({ text: "", embeds: [], channelId: null, updatedAt: 0 }) }),
  }).catch(() => { /* best-effort */ });
}

/** Reconciles the local draft with whatever's on the server (newer wins),
 * so a draft started on another device/after a reinstall still shows up. */
export async function syncDraftFromServer(fid: number): Promise<CastDraft | null> {
  const local = getLocalDraft(fid);
  try {
    const res = await fetch(`/api/user-prefs?fid=${fid}&key=${PREF_KEY}`);
    if (!res.ok) return local;
    const { value } = await res.json() as { value: string | null };
    if (!value) return local;
    const remote = JSON.parse(value) as CastDraft;
    if (!remote.text && remote.embeds.length === 0) return local;
    if (local && local.updatedAt >= remote.updatedAt) return local;
    saveLocal(fid, remote);
    return remote;
  } catch {
    return local; // offline / server unreachable · keep using the local copy
  }
}
