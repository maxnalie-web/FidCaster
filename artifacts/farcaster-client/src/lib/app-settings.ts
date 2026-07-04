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
