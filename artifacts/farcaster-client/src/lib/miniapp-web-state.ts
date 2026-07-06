/**
 * Shared state for the web/PWA mini-app iframe modal (MiniAppIframeModal.tsx)
 * — mounted once at the App root rather than inside MiniAppsPanel, so
 * minimizing a mini app and navigating elsewhere in FidCaster doesn't unmount
 * its iframe (which would lose its session/state entirely). Mirrors the
 * native side's hide()/show() persistence, just via React state instead of a
 * real separate native view.
 */
import type { MiniApp } from "./farcaster-api";

export interface WebMiniAppState {
  app: MiniApp;
  minimized: boolean;
}

let current: WebMiniAppState | null = null;
const listeners = new Set<(state: WebMiniAppState | null) => void>();

export function getWebMiniAppState(): WebMiniAppState | null {
  return current;
}

function set(next: WebMiniAppState | null): void {
  current = next;
  for (const l of listeners) l(current);
}

export function openWebMiniApp(app: MiniApp): void {
  set({ app, minimized: false });
}

export function closeWebMiniApp(): void {
  set(null);
}

export function minimizeWebMiniApp(): void {
  if (current) set({ ...current, minimized: true });
}

export function restoreWebMiniApp(): void {
  if (current) set({ ...current, minimized: false });
}

export function subscribeWebMiniAppState(listener: (state: WebMiniAppState | null) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
