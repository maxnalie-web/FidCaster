import { createRoot } from "react-dom/client";
import { AuthKitProvider } from "@farcaster/auth-kit";
import "@farcaster/auth-kit/styles.css";
import { installNativeFetchBridge, NATIVE_API_ORIGIN } from "./lib/native-api-bridge";
import { isNativeRuntime } from "./lib/miniapp-native";
import App from "./App";
import "./index.css";

// Must run before any other module fetches — redirects this app's own
// "/api/..." calls to the real backend when the WebView is showing the
// locally-bundled app rather than the live site (see native-api-bridge.ts).
installNativeFetchBridge();

// The native shell's own WebView origin (https://localhost / capacitor://localhost)
// isn't a real domain · always present the actual service domain in the Sign
// In With Farcaster message, matching where /login and the API really live.
const domain = isNativeRuntime()
  ? new URL(NATIVE_API_ORIGIN).hostname
  : typeof window !== "undefined" ? window.location.hostname : "localhost";
const siweUri = isNativeRuntime()
  ? NATIVE_API_ORIGIN + "/login"
  : typeof window !== "undefined"
    ? window.location.origin + "/login"
    : "http://localhost:5000/login";

const authKitConfig = {
  rpcUrl: "https://mainnet.optimism.io",
  domain,
  siweUri,
};

createRoot(document.getElementById("root")!).render(
  <AuthKitProvider config={authKitConfig}>
    <App />
  </AuthKitProvider>
);
