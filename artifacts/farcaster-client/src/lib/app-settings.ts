// Small, real, working app-wide preferences · each one directly flips a DOM
// attribute/class that the rest of the app already reacts to (root font-size
// for every rem-based size, a class for the reduce-motion CSS override), so
// there's no risk of a setting existing in the UI but doing nothing.

export type FontSize = "sm" | "md" | "lg";

const FONT_SIZE_KEY = "fc_font_size";
const REDUCE_MOTION_KEY = "fc_reduce_motion";

const FONT_SIZE_PX: Record<FontSize, number> = { sm: 14, md: 16, lg: 18 };

export function getFontSize(): FontSize {
  try {
    const v = localStorage.getItem(FONT_SIZE_KEY);
    if (v === "sm" || v === "md" || v === "lg") return v;
  } catch {}
  return "md";
}

export function applyFontSize(size: FontSize): void {
  document.documentElement.style.fontSize = `${FONT_SIZE_PX[size]}px`;
  try { localStorage.setItem(FONT_SIZE_KEY, size); } catch {}
}

export function getReduceMotion(): boolean {
  try { return localStorage.getItem(REDUCE_MOTION_KEY) === "1"; } catch { return false; }
}

export function applyReduceMotion(on: boolean): void {
  document.documentElement.classList.toggle("reduce-motion", on);
  try { localStorage.setItem(REDUCE_MOTION_KEY, on ? "1" : "0"); } catch {}
}

/** Call once on app boot, same as theme. */
export function applyStoredAppSettings(): void {
  applyFontSize(getFontSize());
  applyReduceMotion(getReduceMotion());
}

// ── Notification type visibility ────────────────────────────────────────────
// Simple client-side mute per notification kind · hides that kind from the
// notifications list and from the unread badge count without needing any
// server-side preference (there's no push infra yet, this is purely local).
export type NotifKind = "reactions" | "replies" | "follows";
const NOTIF_MUTE_KEY = "fc_notif_muted";

export function getMutedNotifKinds(): Set<NotifKind> {
  try {
    const raw = localStorage.getItem(NOTIF_MUTE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as NotifKind[]);
  } catch {
    return new Set();
  }
}

export function setNotifKindMuted(kind: NotifKind, muted: boolean): Set<NotifKind> {
  const cur = getMutedNotifKinds();
  if (muted) cur.add(kind); else cur.delete(kind);
  try { localStorage.setItem(NOTIF_MUTE_KEY, JSON.stringify([...cur])); } catch {}
  return cur;
}
