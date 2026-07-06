import { exposeToIframe } from "@farcaster/miniapp-host";
import type { MiniAppHost } from "@farcaster/miniapp-core";
import { createEthProvider, toMiniAppContext } from "./miniapp-host";
import type { FarcasterProfile } from "./farcaster-api";

/**
 * Web/PWA counterpart to miniapp-host.ts's native bridge. On a plain browser
 * tab or an installed/standalone PWA there is no native WebView to inject a
 * document-start script into, so mini apps were previously opened with a bare
 * `window.open()` — no Farcaster context, no wallet, indistinguishable from
 * just visiting the site directly.
 *
 * The official Farcaster Mini App SDK also supports an iframe transport
 * (postMessage-based, same protocol as the native one) via
 * `@farcaster/miniapp-host`'s `exposeToIframe` — this loads the mini app at
 * its OWN origin in a real cross-origin iframe (nothing proxied through our
 * server, nothing spoofing our own origin) and talks to it over standard
 * `postMessage`, which is the normal, safe way browsers allow two different
 * origins to communicate. This is unrelated to (and much safer than) the
 * old /api/miniapp-embed server proxy removed earlier for being an SSRF/XSS
 * risk — that fetched arbitrary third-party HTML server-side and re-served
 * it AS our own origin; this never does that, the mini app stays on its own
 * origin the whole time.
 *
 * Same read-only scope as the native bridge: real Farcaster context + a real
 * connected address are exposed, but signing/sending is not supported yet.
 */
export function attachMiniAppIframeHost({
  iframe,
  miniAppOrigin,
  profile,
  address,
  navigate,
  onClose,
}: {
  iframe: HTMLIFrameElement;
  miniAppOrigin: string;
  profile: FarcasterProfile | null;
  address: `0x${string}` | null;
  navigate: (path: string) => void;
  onClose: () => void;
}): () => void {
  const context = toMiniAppContext(profile);
  const ethProvider = createEthProvider(address);
  const notSupported = (action: string) => Promise.reject(new Error(`${action} isn't supported yet`));

  const sdk: Omit<MiniAppHost, "ethProviderRequestV2"> = {
    context,
    ready: () => {},
    close: () => { onClose(); },
    openUrl: (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
    setPrimaryButton: () => {},
    updateBackState: async () => {},
    eip6963RequestProvider: () => {},
    getCapabilities: async () => ["actions.ready", "actions.close", "actions.openUrl", "actions.viewCast", "actions.viewProfile", "wallet.getEthereumProvider"],
    getChains: async () => ["eip155:8453"],
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
    addFrame: () => notSupported("Add frame") as never,
    openMiniApp: async ({ url }) => { window.open(url, "_blank", "noopener,noreferrer"); },
    composeCast: (async () => ({ cast: null })) as MiniAppHost["composeCast"],
    requestCameraAndMicrophoneAccess: () => notSupported("Camera/microphone access") as never,
    sendToken: async () => ({ success: false, reason: "send_failed" }),
    swapToken: async () => ({ success: false, reason: "swap_failed" }),
  };

  const { cleanup } = exposeToIframe({ iframe, sdk, ethProvider, miniAppOrigin });
  return cleanup;
}
