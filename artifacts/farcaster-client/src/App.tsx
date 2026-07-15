import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { Toaster } from "sonner";
import { Capacitor } from "@capacitor/core";
import { StatusBar, Style } from "@capacitor/status-bar";
import { WalletProvider } from "@/hooks/WalletProvider";
import { BatchOperationProvider } from "@/hooks/BatchOperationContext";
import { CleanupOpProvider } from "@/hooks/CleanupOpContext";
import { useWallet } from "@/hooks/useWallet";
import { LoginPage } from "@/pages/LoginPage";
import { NativeWelcomePage } from "@/pages/NativeWelcomePage";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { ThreadPage } from "@/pages/ThreadPage";
import { ChannelPage } from "@/pages/ChannelPage";
import { ChannelsListPage } from "@/pages/ChannelsListPage";
import FidMarketPage from "@/pages/FidMarketPage";
import FidDetailPage from "@/pages/FidDetailPage";
import { FollowPage } from "@/pages/FollowPage";
import { DownloadPage } from "@/pages/DownloadPage";
import { useEffect, useState } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { applyStoredAppSettings } from "@/lib/app-settings";
import { SignerSetupPopup } from "@/components/SignerSetupPopup";
import { MinimizedMiniAppBar } from "@/components/MinimizedMiniAppBar";
import { MiniAppIframeModal } from "@/components/MiniAppIframeModal";
import { BatchProgressPill } from "@/components/BatchProgressPill";
import { isInstalledApp } from "@/lib/miniapp-native";

export type Theme = "light" | "dark";

export function getTheme(): Theme {
  try { return (localStorage.getItem("fc_theme") as Theme) || "light"; } catch { return "light"; }
}

export function applyTheme(theme: Theme) {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  try { localStorage.setItem("fc_theme", theme); } catch {}
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(getTheme);
  function setTheme(t: Theme) {
    applyTheme(t);
    setThemeState(t);
  }
  return [theme, setTheme];
}

function AuthRedirect() {
  const { fid, isLocked, isCheckingSession } = useWallet();
  const [location, navigate] = useLocation();
  useEffect(() => {
    // Don't decide anything until the stored session has actually been read ·
    // fid/isLocked both start out "empty" on a cold page load (e.g. opening a
    // shared /channel or /cast link directly), so acting before this flips to
    // false bounced already-logged-in users to /login for an instant before
    // snapping back to /dashboard, losing the deep link's destination.
    if (isCheckingSession) return;
    if (fid && (location === "/" || location === "/login")) navigate("/dashboard");
    // The installed app (Capacitor/PWA) never shows the marketing landing
    // page's "Client / FID Market / Features" scroll page meant for a
    // browser tab — but it also shouldn't snap straight into the sign-in
    // form with zero transition. "/" itself forks in Router() below: an
    // installed app renders NativeWelcomePage there instead of LoginPage,
    // so no redirect is needed at all for that case anymore.
    // Auto-locked from anywhere in the app → unlock screen, never the landing page.
    else if (!fid && isLocked && location !== "/login") navigate("/login");
    // A shared cast/profile/channel link opened by someone with no FidCaster
    // session at all (not even a locked one) used to render the page anyway ·
    // anyone could browse content without ever signing in. Require login first.
    else if (!fid && !isLocked && /^\/(profile|cast|channel)\//.test(location)) navigate("/login");
  }, [fid, isLocked, isCheckingSession, location, navigate]);
  return null;
}

function Router() {
  return (
    <>
      <AuthRedirect />
      <Switch>
        <Route path="/" component={isInstalledApp() ? NativeWelcomePage : LoginPage} />
        <Route path="/login" component={AuthPage} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/profile/:fid">{() => <ProfilePage />}</Route>
        <Route path="/cast/:hash" component={ThreadPage} />
        <Route path="/channel/:id" component={ChannelPage} />
        <Route path="/channels" component={ChannelsListPage} />
        <Route path="/market" component={FidMarketPage} />
        <Route path="/market/:id" component={FidDetailPage} />
        <Route path="/follow" component={FollowPage} />
        <Route path="/download" component={DownloadPage} />
        <Route>
          <div className="min-h-screen bg-background flex items-center justify-center">
            <div className="text-center text-muted-foreground space-y-3">
              <p className="text-4xl font-bold gradient-text">404</p>
              <p className="text-sm">Page not found</p>
              <a href="/" className="inline-block text-primary hover:underline text-sm">Back to home</a>
            </div>
          </div>
        </Route>
      </Switch>
    </>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const [theme] = useTheme();

  useEffect(() => {
    // Own scroll position ourselves · the app already restores feed/thread
    // scroll manually, and the browser's default "auto" restoration fights that,
    // leaving pages opened half-scrolled (top of the profile hidden under the
    // sticky header) and making back navigation jump before it leaves.
    if ("scrollRestoration" in history) {
      try { history.scrollRestoration = "manual"; } catch { /* older browsers */ }
    }
    applyTheme(getTheme());
    applyStoredAppSettings();
  }, []);

  useEffect(() => {
    // Native only · match the status bar to the app's own header background
    // (white in light mode, near-black in dark mode) instead of the OS
    // default gray scrim, and reserve its own space (overlay: false) so app
    // content never paints a mismatched color underneath it.
    if (!Capacitor.isNativePlatform()) return;
    const isDark = theme === "dark";
    StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    StatusBar.setBackgroundColor({ color: isDark ? "#0e111b" : "#ffffff" }).catch(() => {});
    StatusBar.setStyle({ style: isDark ? Style.Dark : Style.Light }).catch(() => {});
  }, [theme]);

  return (
    <WalletProvider>
      <BatchOperationProvider>
        <CleanupOpProvider>
        <WouterRouter base={base}>
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </WouterRouter>
        <BatchProgressPill />
        <SignerSetupPopup />
        {false && <MinimizedMiniAppBar />}
        {false && <MiniAppIframeModal />}
        <Toaster
        position="bottom-right"
        theme={theme === "dark" ? "dark" : "light"}
        toastOptions={{
          style: theme === "dark" ? {
            background: "rgba(22, 18, 42, 0.95)",
            border: "1px solid rgba(130, 110, 220, 0.20)",
            color: "hsl(210 35% 92%)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 8px 32px rgba(0,0,0,0.40)",
          } : {
            background: "rgba(255,255,255,0.92)",
            border: "1px solid hsl(240 14% 87%)",
            color: "hsl(224 44% 8%)",
            backdropFilter: "blur(16px)",
            boxShadow: "0 8px 32px rgba(90,70,200,0.10)",
          },
        }}
        />
        </CleanupOpProvider>
      </BatchOperationProvider>
    </WalletProvider>
  );
}

export default App;
