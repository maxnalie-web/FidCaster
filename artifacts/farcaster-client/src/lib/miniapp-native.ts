import { Capacitor } from "@capacitor/core";
import { InAppBrowser, ToolBarType } from "@capgo/capacitor-inappbrowser";
import type { MiniApp } from "./farcaster-api";
import { attachMiniAppHost } from "./miniapp-host";
import type { FarcasterProfile } from "./farcaster-api";

/** True only when running inside the Capacitor native shell (iOS/Android). */
export function isNativeRuntime(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
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
    toolbarType: ToolBarType.ACTIVITY, // minimal: close button, no URL bar
    visibleTitle: true,
    showReloadButton: false,
    isPresentAfterPageLoad: true,
    isInspectable: false,
    preShowScript: DOCUMENT_START_SCRIPT,
    preShowScriptInjectionTime: "documentStart",
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
    void closeHandle.remove();
  });

  return true;
}
