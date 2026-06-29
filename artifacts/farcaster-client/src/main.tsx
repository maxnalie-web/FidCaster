import { createRoot } from "react-dom/client";
import { AuthKitProvider } from "@farcaster/auth-kit";
import "@farcaster/auth-kit/styles.css";
import App from "./App";
import "./index.css";

const domain =
  typeof window !== "undefined" ? window.location.hostname : "localhost";
const siweUri =
  typeof window !== "undefined"
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
