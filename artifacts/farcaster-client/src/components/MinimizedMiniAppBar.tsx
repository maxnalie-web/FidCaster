import { useEffect, useState } from "react";
import { InAppBrowser } from "@capgo/capacitor-inappbrowser";
import { ChevronUp, Layers } from "lucide-react";
import {
  getMinimizedMiniApp, setMinimizedMiniApp, subscribeMinimizedMiniApp, type MinimizedMiniApp,
} from "@/lib/miniapp-minimize-state";
import {
  getWebMiniAppState, subscribeWebMiniAppState, restoreWebMiniApp, type WebMiniAppState,
} from "@/lib/miniapp-web-state";

/** Web/PWA counterpart - same floating pill, restores the hidden iframe modal. */
function WebRestorePill() {
  const [state, setState] = useState<WebMiniAppState | null>(getWebMiniAppState);
  useEffect(() => subscribeWebMiniAppState(setState), []);
  if (!state?.minimized) return null;
  return (
    <button
      onClick={restoreWebMiniApp}
      className="fixed bottom-[62px] left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 pl-2 pr-3.5 py-2 rounded-full bg-foreground text-background shadow-lg active:scale-[0.97] transition-transform"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-6 h-6 rounded-full overflow-hidden bg-background/20 shrink-0 flex items-center justify-center">
        {state.app.iconUrl ? (
          <img src={state.app.iconUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Layers className="w-3.5 h-3.5 opacity-70" />
        )}
      </div>
      <span className="text-xs font-semibold truncate max-w-[140px]">{state.app.name}</span>
      <ChevronUp className="w-3.5 h-3.5 shrink-0 opacity-70" />
    </button>
  );
}

/** Native counterpart - same floating pill, calls InAppBrowser.show() to resume. */
function NativeRestorePill() {
  const [app, setApp] = useState<MinimizedMiniApp | null>(getMinimizedMiniApp);
  useEffect(() => subscribeMinimizedMiniApp(setApp), []);
  if (!app) return null;
  return (
    <button
      onClick={() => {
        void InAppBrowser.show({ id: app.webviewId });
        setMinimizedMiniApp(null);
      }}
      className="fixed bottom-[62px] left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 pl-2 pr-3.5 py-2 rounded-full bg-foreground text-background shadow-lg active:scale-[0.97] transition-transform"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="w-6 h-6 rounded-full overflow-hidden bg-background/20 shrink-0 flex items-center justify-center">
        {app.iconUrl ? (
          <img src={app.iconUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <Layers className="w-3.5 h-3.5 opacity-70" />
        )}
      </div>
      <span className="text-xs font-semibold truncate max-w-[140px]">{app.name}</span>
      <ChevronUp className="w-3.5 h-3.5 shrink-0 opacity-70" />
    </button>
  );
}

/**
 * Floating pill shown app-wide while a mini app is minimized - the mini
 * app's own webview/iframe is still alive in the background (hidden, not
 * closed), so tapping this just brings it back to the foreground instead of
 * reloading it from scratch. Exactly one of the native/web pills renders at
 * a time (each is null unless its own path is the one that's minimized).
 */
export function MinimizedMiniAppBar() {
  return (
    <>
      <NativeRestorePill />
      <WebRestorePill />
    </>
  );
}
