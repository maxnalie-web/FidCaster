import { InAppBrowser } from "@capgo/capacitor-inappbrowser";
import type { PluginListenerHandle } from "@capacitor/core";
import {
  exposeToEndpoint,
  type HostEndpoint,
  type MiniAppHost,
} from "@farcaster/miniapp-host";
import type { Context } from "@farcaster/miniapp-core";
type MiniAppContext = Context.MiniAppContext;
import * as Provider from "ox/Provider";
import type { FarcasterProfile } from "./farcaster-api";

/**
 * Real host-side implementation of the Farcaster Mini App SDK protocol for
 * mini apps opened in the native (Capacitor) in-app WebView.
 *
 * Every mini app bundles the official `@farcaster/miniapp-sdk`, which — when
 * it detects `window.ReactNativeWebView` (satisfied by the document-start
 * script in miniapp-native.ts) — talks to its host over a Comlink RPC channel
 * carried by `window.ReactNativeWebView.postMessage` / a `messageFromNative`
 * DOM event. This file is the OTHER end of that channel: it wires up
 * `@farcaster/miniapp-host`'s Comlink-based RPC dispatcher (`exposeToEndpoint`)
 * to `@capgo/capacitor-inappbrowser`'s own bridge (`messageFromWebview` /
 * `postMessage` / `executeScript`) instead of the react-native-webview ref
 * the SDK's own React Native adapter uses — same protocol, different
 * transport, since we're a Capacitor app rather than a React Native one.
 *
 * Without this, a mini app's SDK calls (get user context, check wallet
 * accounts, etc.) go out over `window.ReactNativeWebView.postMessage` and
 * nothing on the host side is listening — the mini app's SDK sits waiting
 * for a reply that never arrives, which is the likely cause of mini apps
 * both failing to detect the Farcaster user/wallet AND feeling slow/stuck.
 */

// Kept intentionally small and READ-ONLY for now: mini apps can see they're
// signed in as a real Farcaster user and see a real connected address, but
// anything that would move funds or need a signature (sendTransaction,
// personal_sign, typed-data signing, token swaps/sends) is rejected with a
// standard EIP-1193 "unsupported method" error instead of hanging — safer to
// ship a clean "not yet supported" than to guess at wiring real signing
// through an SDK bridge that can't be tested against a device here.
const DEFAULT_CHAIN_ID_HEX = "0x2105"; // Base — the default chain most mini apps expect
const SUPPORTED_CAIP2_CHAINS = ["eip155:8453"]; // Base only, for now

export function createEthProvider(address: `0x${string}` | null): Provider.Provider<undefined, true> {
  const emitter = Provider.createEmitter();
  const provider = Provider.from({
    ...emitter,
    async request(args: unknown) {
      const { method } = args as { method: string; params?: unknown };
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return address ? [address] : [];
        case "eth_chainId":
          return DEFAULT_CHAIN_ID_HEX;
        case "net_version":
          return String(parseInt(DEFAULT_CHAIN_ID_HEX, 16));
        case "wallet_switchEthereumChain":
          // Only chain we actually "support" is the default one · anything
          // else is a real chain switch we can't honor without real signing.
          throw new Provider.SwitchChainError({ message: "Unsupported chain" });
        default:
          throw new Provider.UnsupportedMethodError({
            message: `${method} isn't supported by FidCaster's mini app host yet`,
          });
      }
    },
  }) as unknown as Provider.Provider<undefined, true>;
  return provider;
}

/**
 * Capacitor-backed Comlink transport, mirroring the official React Native
 * WebView adapter (@farcaster/miniapp-host-react-native's webview.ts) but
 * built on the InAppBrowser plugin's own message bridge instead of a
 * react-native-webview ref.
 */
function createCapacitorEndpoint(webviewId: string): { endpoint: HostEndpoint; cleanup: () => void } {
  const listeners: EventListenerOrEventListenerObject[] = [];
  let handle: PluginListenerHandle | null = null;

  InAppBrowser.addListener("messageFromWebview", (event) => {
    if (event.id !== webviewId) return;
    const raw = event.detail?.fcsdk;
    if (raw === undefined) return;
    // The mini app's SDK follows the react-native-webview convention of
    // postMessage(string) · be defensive either way.
    let data: unknown;
    try {
      data = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      data = raw;
    }
    const messageEvent = { data } as unknown as Event;
    for (const l of listeners) {
      if (typeof l === "function") l(messageEvent);
      else l.handleEvent(messageEvent);
    }
  }).then((h) => { handle = h; });

  const endpoint: HostEndpoint = {
    addEventListener: (type, listener) => {
      if (type !== "message") throw new Error(`Unexpected event type "${type}" (expected "message")`);
      listeners.push(listener);
    },
    removeEventListener: (type, listener) => {
      if (type !== "message") throw new Error(`Unexpected event type "${type}" (expected "message")`);
      const i = listeners.indexOf(listener);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage: (data) => {
      void InAppBrowser.postMessage({ id: webviewId, detail: { fcsdkKind: "callback", fcsdkData: data } });
    },
    emit: (event) => {
      void InAppBrowser.postMessage({ id: webviewId, detail: { fcsdkKind: "event", fcsdkData: event } });
    },
    emitEthProvider: (event, params) => {
      void InAppBrowser.postMessage({ id: webviewId, detail: { fcsdkKind: "ethEvent", fcsdkData: { event, params } } });
    },
  };

  return {
    endpoint,
    cleanup: () => { handle?.remove(); },
  };
}

export function toMiniAppContext(profile: FarcasterProfile | null): MiniAppContext {
  return {
    client: {
      platformType: "mobile",
      clientFid: profile?.fid ?? 0,
      added: false,
    },
    user: profile
      ? { fid: profile.fid, username: profile.username, displayName: profile.displayName, pfpUrl: profile.pfpUrl }
      : { fid: 0 },
    location: { type: "launcher" },
  };
}

/**
 * Attaches the SDK host bridge to an already-open mini app webview. Returns a
 * cleanup function to call when the mini app is closed.
 */
export function attachMiniAppHost({
  webviewId,
  miniAppOrigin,
  profile,
  address,
  navigate,
}: {
  webviewId: string;
  miniAppOrigin: string;
  profile: FarcasterProfile | null;
  address: `0x${string}` | null;
  navigate: (path: string) => void;
}): () => void {
  const { endpoint, cleanup: cleanupTransport } = createCapacitorEndpoint(webviewId);
  const context = toMiniAppContext(profile);
  const ethProvider = createEthProvider(address);

  const notSupported = (action: string) => Promise.reject(new Error(`${action} isn't supported yet`));

  const sdk: Omit<MiniAppHost, "ethProviderRequestV2" | "addFrame"> = {
    context,
    ready: () => {},
    close: () => { void InAppBrowser.close({ id: webviewId }); },
    openUrl: (url) => { void InAppBrowser.openWebView({ url, title: "" }); },
    setPrimaryButton: () => {},
    updateBackState: async () => {},
    eip6963RequestProvider: () => {},
    getCapabilities: async () => ["actions.ready", "actions.close", "actions.openUrl", "actions.viewCast", "actions.viewProfile", "wallet.getEthereumProvider"],
    getChains: async () => SUPPORTED_CAIP2_CHAINS,
    viewCast: async ({ hash }) => { navigate(`/cast/${hash}`); },
    viewProfile: async ({ fid }) => { navigate(`/profile/${fid}`); },
    viewToken: async () => {},
    impactOccurred: async () => {},
    notificationOccurred: async () => {},
    selectionChanged: async () => {},
    ethProviderRequest: ethProvider.request,
    solanaProviderRequest: undefined,
    signIn: () => notSupported("Sign in") as never,
    signManifest: () => notSupported("Sign manifest") as never,
    addMiniApp: () => notSupported("Add mini app") as never,
    openMiniApp: async ({ url }) => { void InAppBrowser.openWebView({ url, title: "" }); },
    composeCast: (async () => ({ cast: null })) as MiniAppHost["composeCast"],
    requestCameraAndMicrophoneAccess: () => notSupported("Camera/microphone access") as never,
    sendToken: async () => ({ success: false, reason: "send_failed" }),
    swapToken: async () => ({ success: false, reason: "swap_failed" }),
  };

  const cleanupSdk = exposeToEndpoint({
    endpoint,
    sdk,
    miniAppOrigin,
    ethProvider,
  });

  return () => {
    cleanupSdk();
    cleanupTransport();
  };
}
