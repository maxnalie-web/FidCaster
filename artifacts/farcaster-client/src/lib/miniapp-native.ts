import { Capacitor } from "@capacitor/core";
import { InAppBrowser, ToolBarType } from "@capgo/capacitor-inappbrowser";
import type { MiniApp } from "./farcaster-api";
import { attachMiniAppHost } from "./miniapp-host";
import type { FarcasterProfile } from "./farcaster-api";
import { setMinimizedMiniApp } from "./miniapp-minimize-state";

/** True only when running inside the Capacitor native shell (iOS/Android). */
export function isNativeRuntime(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/** True for the installed Capacitor app or an installed/standalone PWA —
 * anything that isn't a plain browser tab landing on the marketing site. */
export function isInstalledApp(): boolean {
  if (isNativeRuntime()) return true;
  try { return window.matchMedia("(display-mode: standalone)").matches; } catch { return false; }
}

/**
 * Injected at DOCUMENT-START inside each mini app's native WebView · before any
 * of the app's own JavaScript runs. Production mini apps refuse to render unless
 * they believe they're inside an official Farcaster client; they detect this by
 * reading `document.referrer` and `window.ReactNativeWebView`. A web iframe
 * cannot touch a cross-origin document, but a native WebView can inject here, so
 * we satisfy those checks and the app renders embedded.
 *
 * The `ReactNativeWebView` shim also carries the real Farcaster Mini App SDK
 * protocol to/from the native host (see miniapp-host.ts, which implements the
 * other end using @farcaster/miniapp-host's Comlink-based RPC dispatcher):
 *  - Outgoing (mini app → host): window.ReactNativeWebView.postMessage(data)
 *    forwards to window.mobileApp.postMessage({ detail: { fcsdk: data } }),
 *    which the InAppBrowser plugin delivers to the app as "messageFromWebview".
 *  - Incoming (host → mini app): the plugin dispatches a "messageFromNative"
 *    DOM event carrying { fcsdkKind, fcsdkData }; this re-dispatches it as one
 *    of the three document events the SDK actually listens for
 *    (FarcasterFrameCallback / FarcasterFrameEvent / FarcasterFrameEthProviderEvent),
 *    matching exactly what the official React Native host adapter does.
 */
const DOCUMENT_START_SCRIPT = `
(function () {
  try {
    Object.defineProperty(document, 'referrer', {
      get: function () { return 'https://farcaster.xyz/'; },
      configurable: true
    });
  } catch (e) {}
  try {
    if (!window.ReactNativeWebView) {
      window.ReactNativeWebView = {
        postMessage: function (data) {
          try { window.mobileApp && window.mobileApp.postMessage({ detail: { fcsdk: data } }); } catch (e) {}
        }
      };
      var EVENT_NAMES = { callback: 'FarcasterFrameCallback', event: 'FarcasterFrameEvent', ethEvent: 'FarcasterFrameEthProviderEvent' };
      window.addEventListener('messageFromNative', function (e) {
        try {
          var detail = e && e.detail ? e.detail : undefined;
          var kind = detail && detail.fcsdkKind;
          var name = kind && EVENT_NAMES[kind];
          if (name && detail.fcsdkData !== undefined) {
            document.dispatchEvent(new MessageEvent(name, { data: detail.fcsdkData }));
          }
        } catch (err) {}
      });
    }
  } catch (e) {}
})();
`;

/**
 * Open a mini app in the native in-app WebView with the document-start spoof,
 * and attach the real SDK host bridge (user context + read-only wallet
 * detection · see miniapp-host.ts) so the mini app can tell it's running
 * inside FidCaster instead of a plain browser tab.
 *
 * Returns true if it was handled natively, false on the web (caller falls
 * back to opening the URL in a new tab).
 */
export async function openNativeMiniApp(
  app: MiniApp,
  host: { profile: FarcasterProfile | null; address: `0x${string}` | null; navigate: (path: string) => void },
): Promise<boolean> {
  if (!isNativeRuntime()) return false;
  const { id } = await InAppBrowser.openWebView({
    url: app.url,
    title: app.name,
    // COMPACT = close button only (+ our own minimize button below) · no
    // share action, no overflow ("...") menu, no URL bar — reads as a native
    // modal, not a browser tab.
    toolbarType: ToolBarType.COMPACT,
    visibleTitle: true,
    showReloadButton: false,
    // false = show the webview immediately instead of blocking until the
    // remote mini-app site finishes loading. Previously `true`, which made
    // the whole "tap Open" gesture feel like it did nothing for however long
    // the third-party site took to load — the top complaint about mini apps.
    // preShowScriptInjectionTime: "documentStart" (below) injects the
    // anti-detection shim before the page's own JS regardless of this flag;
    // it isn't tied to isPresentAfterPageLoad the way the older preShowScript
    // (pageLoad-time-only) behavior was.
    isPresentAfterPageLoad: false,
    isInspectable: false,
    preShowScript: DOCUMENT_START_SCRIPT,
    preShowScriptInjectionTime: "documentStart",
    // Minimize affordance next to the close button — hides the webview
    // (keeping its JS/state alive) instead of destroying it; the user can
    // resume via the floating pill (MinimizedMiniAppBar.tsx) shown while a
    // mini app is minimized.
    buttonNearDone: {
      ios: { iconType: "sf-symbol", icon: "chevron.down" },
      android: { iconType: "asset", icon: "public/minimize.svg", width: 22, height: 22 },
    },
  });

  let cleanedUp = false;
  const cleanup = attachMiniAppHost({
    webviewId: id,
    miniAppOrigin: new URL(app.url).origin,
    profile: host.profile,
    address: host.address,
    navigate: host.navigate,
  });
  const closeHandle = await InAppBrowser.addListener("closeEvent", (event) => {
    if (event.id !== id || cleanedUp) return;
    cleanedUp = true;
    cleanup();
    setMinimizedMiniApp(null);
    void closeHandle.remove();
    void minimizeHandle.remove();
  });
  const minimizeHandle = await InAppBrowser.addListener("buttonNearDoneClick", (event) => {
    if ((event as { id?: string }).id !== id) return;
    void InAppBrowser.hide({ id });
    setMinimizedMiniApp({ webviewId: id, name: app.name, iconUrl: app.iconUrl });
  });

  return true;
}
