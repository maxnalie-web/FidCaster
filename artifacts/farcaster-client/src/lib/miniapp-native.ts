import { Capacitor } from "@capacitor/core";
import { InAppBrowser, ToolBarType } from "@capgo/capacitor-inappbrowser";
import type { MiniApp } from "./farcaster-api";

/** True only when running inside the Capacitor native shell (iOS/Android). */
export function isNativeRuntime(): boolean {
  try { return Capacitor.isNativePlatform(); } catch { return false; }
}

/**
 * Injected at DOCUMENT-START inside each mini app's native WebView — before any
 * of the app's own JavaScript runs. Production mini apps refuse to render unless
 * they believe they're inside an official Farcaster client; they detect this by
 * reading `document.referrer` and `window.ReactNativeWebView`. A web iframe
 * cannot touch a cross-origin document, but a native WebView can inject here, so
 * we satisfy those checks and the app renders embedded.
 *
 * The `ReactNativeWebView` shim also routes the Farcaster Mini App SDK's
 * messages to the native app (`window.mobileApp.postMessage`) and delivers host
 * replies back as the `FarcasterFrameCallback` document event the SDK listens
 * for — the transport stage-2 wires to the real host (context + wallet).
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
          try { window.mobileApp && window.mobileApp.postMessage({ fcsdk: data }); } catch (e) {}
        }
      };
      window.addEventListener('messageFromNative', function (e) {
        try {
          var d = e && e.detail ? e.detail.fcsdk : undefined;
          if (d !== undefined) {
            document.dispatchEvent(new MessageEvent('FarcasterFrameCallback', { data: d }));
          }
        } catch (err) {}
      });
    }
  } catch (e) {}
})();
`;

/**
 * Open a mini app in the native in-app WebView with the document-start spoof.
 * Returns true if it was handled natively, false on the web (caller falls back
 * to the iframe runner).
 */
export async function openNativeMiniApp(app: MiniApp): Promise<boolean> {
  if (!isNativeRuntime()) return false;
  await InAppBrowser.openWebView({
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
  return true;
}
