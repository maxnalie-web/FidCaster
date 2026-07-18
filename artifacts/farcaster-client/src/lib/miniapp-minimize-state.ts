/**
 * Tiny module-level pub-sub for "which mini app (if any) is currently
 * minimized" - needs to be visible app-wide (a small floating restore pill,
 * see MinimizedMiniAppBar.tsx), not just inside whatever component opened the
 * mini app, since the user can navigate anywhere in FidCaster while it's
 * minimized in the background.
 */

export interface MinimizedMiniApp {
  webviewId: string;
  name: string;
  iconUrl?: string;
}

let current: MinimizedMiniApp | null = null;
const listeners = new Set<(app: MinimizedMiniApp | null) => void>();

export function getMinimizedMiniApp(): MinimizedMiniApp | null {
  return current;
}

export function setMinimizedMiniApp(app: MinimizedMiniApp | null): void {
  current = app;
  for (const l of listeners) l(current);
}

export function subscribeMinimizedMiniApp(listener: (app: MinimizedMiniApp | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
