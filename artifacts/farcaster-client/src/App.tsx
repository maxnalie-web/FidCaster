import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { Toaster } from "sonner";
import { WalletProvider } from "@/hooks/WalletProvider";
import { BatchOperationProvider } from "@/hooks/BatchOperationContext";
import { useWallet } from "@/hooks/useWallet";
import { LoginPage } from "@/pages/LoginPage";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { ThreadPage } from "@/pages/ThreadPage";
import FidMarketPage from "@/pages/FidMarketPage";
import FidDetailPage from "@/pages/FidDetailPage";
import { AdminPage } from "@/pages/AdminPage";
import { useEffect, useState } from "react";
import { applyAdminTheme, applyAdminSeo, loadAdminConfig } from "@/lib/admin-config";

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
  const { fid, isLocked } = useWallet();
  const [location, navigate] = useLocation();
  useEffect(() => {
    if (fid && (location === "/" || location === "/login")) navigate("/dashboard");
    // Auto-locked from anywhere in the app → unlock screen, never the landing page.
    else if (!fid && isLocked && location !== "/login") navigate("/login");
  }, [fid, isLocked, location, navigate]);
  return null;
}

function Router() {
  return (
    <>
      <AuthRedirect />
      <Switch>
        <Route path="/" component={LoginPage} />
        <Route path="/login" component={AuthPage} />
        <Route path="/dashboard" component={DashboardPage} />
        <Route path="/profile/:fid">{() => <ProfilePage />}</Route>
        <Route path="/cast/:hash" component={ThreadPage} />
        <Route path="/market" component={FidMarketPage} />
        <Route path="/market/:id" component={FidDetailPage} />
        <Route path="/admin" component={AdminPage} />
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
    applyTheme(getTheme());
    const cfg = loadAdminConfig();
    applyAdminTheme(cfg);
    applyAdminSeo(cfg);
  }, []);

  return (
    <WalletProvider>
      <BatchOperationProvider>
        <WouterRouter base={base}>
          <Router />
        </WouterRouter>
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
      </BatchOperationProvider>
    </WalletProvider>
  );
}

export default App;
