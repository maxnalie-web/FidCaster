import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { X, ChevronDown, Loader2 } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { attachMiniAppIframeHost } from "@/lib/miniapp-iframe-host";
import {
  getWebMiniAppState, subscribeWebMiniAppState, closeWebMiniApp, minimizeWebMiniApp,
  type WebMiniAppState,
} from "@/lib/miniapp-web-state";

/**
 * Web/PWA mini-app host, mounted once at the App root (see App.tsx) — a real
 * Farcaster context + wallet get exposed to the embedded app (see
 * miniapp-iframe-host.ts) instead of a plain `window.open()` new tab with
 * nothing injected. Minimize hides this overlay with CSS while leaving the
 * iframe mounted (state lives in miniapp-web-state.ts, outside this
 * component's own tree), so navigating the rest of FidCaster doesn't lose
 * the mini app's session — mirrors the native side's hide()/show().
 */
export function MiniAppIframeModal() {
  const [state, setState] = useState<WebMiniAppState | null>(getWebMiniAppState);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const { profile, address } = useWallet();
  const [, navigate] = useLocation();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => subscribeWebMiniAppState(setState), []);

  const app = state?.app;

  useEffect(() => {
    setLoaded(false);
    const iframe = iframeRef.current;
    if (!iframe || !app) return;
    let cleanup: (() => void) | null = null;
    function onLoad() {
      setLoaded(true);
      cleanup = attachMiniAppIframeHost({
        iframe: iframe!,
        miniAppOrigin: new URL(app!.url).origin,
        profile,
        address,
        navigate,
        onClose: closeWebMiniApp,
      });
    }
    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app?.url]);

  if (!app) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-background"
      style={{ display: state?.minimized ? "none" : "flex" }}
    >
      <div className="flex items-center justify-between gap-2 px-3 border-b border-border shrink-0" style={{ height: 52 }}>
        <div className="flex items-center gap-2 min-w-0">
          {app.iconUrl && <img src={app.iconUrl} alt="" className="w-6 h-6 rounded-lg object-cover shrink-0" />}
          <span className="text-sm font-semibold text-foreground truncate">{app.name}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={minimizeWebMiniApp}
            aria-label="Minimize"
            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            onClick={closeWebMiniApp}
            aria-label="Close"
            className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="relative flex-1">
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-background">
            <Loader2 className="w-6 h-6 text-primary animate-spin" />
          </div>
        )}
        <iframe
          ref={iframeRef}
          src={app.url}
          title={app.name}
          className="w-full h-full border-0"
          allow="clipboard-write"
        />
      </div>
    </div>
  );
}
