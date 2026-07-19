/**
 * Admin Dashboard — points system monitor.
 *
 * Password-gated (X-Admin-Password header). Password is stored in
 * sessionStorage so it persists within the tab but clears on close.
 *
 * Sections:
 *   - Ledger stats (total / verified / pending / excluded)
 *   - Watcher health (grow, hub, market, ledger)
 *   - Background jobs (verification, sybil)
 *   - Points leaderboard (top 50)
 *   - Snapshot download (CSV / JSON)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import {
  ShieldCheck, RefreshCw, Download, AlertTriangle, CheckCircle2,
  XCircle, Clock, Activity, Users, TrendingUp, Database, LogOut,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DesktopSidebar } from "@/components/DesktopSidebar";

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatcherSnap {
  status: "ok" | "warning" | "error" | "unknown";
  lastRun: string | null;
  detail: Record<string, unknown>;
}

interface HealthReport {
  status: "ok" | "warning" | "error" | "unknown";
  watchers: {
    grow:   WatcherSnap;
    hub:    WatcherSnap;
    market: WatcherSnap;
    ledger: WatcherSnap;
  };
  jobs: {
    verification: { lastRun: string | null; verifiedCount: number; excludedCount: number; pendingCount: number };
    sybil:        { lastRun: string | null; excludedR1: number; excludedR2: number; excludedR3: number };
  };
  generatedAt: string;
}

interface LeaderboardRow { fid: number; total_points: number; rank: number; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ADMIN_PWD_KEY = "fc_admin_pwd";

function savedPwd(): string { return sessionStorage.getItem(ADMIN_PWD_KEY) ?? ""; }

async function fetchAdmin<T>(path: string, pwd: string): Promise<T> {
  const res = await fetch(path, {
    headers: { "X-Admin-Password": pwd },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

function StatusBadge({ status }: { status: string }) {
  const cfg: Record<string, { cls: string; icon: typeof CheckCircle2 }> = {
    ok:      { cls: "text-emerald-500 bg-emerald-500/10",  icon: CheckCircle2 },
    warning: { cls: "text-amber-500 bg-amber-500/10",     icon: AlertTriangle },
    error:   { cls: "text-rose-500 bg-rose-500/10",       icon: XCircle },
    unknown: { cls: "text-muted-foreground bg-muted",     icon: Clock },
  };
  const { cls, icon: Icon } = cfg[status] ?? cfg.unknown;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full", cls)}>
      <Icon className="w-3 h-3" />
      {status}
    </span>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

// ─── Password gate ────────────────────────────────────────────────────────────

function PasswordGate({ onAuth }: { onAuth: (pwd: string) => void }) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState(false);

  async function attempt() {
    try {
      await fetchAdmin<HealthReport>("/api/watchers/health", pwd);
      sessionStorage.setItem(ADMIN_PWD_KEY, pwd);
      onAuth(pwd);
    } catch {
      setErr(true);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="w-full max-w-sm space-y-4 p-8 bg-card border border-border rounded-2xl shadow-lg">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck className="w-6 h-6" />
          <h1 className="text-lg font-bold">Admin Access</h1>
        </div>
        <input
          type="password"
          placeholder="Admin password"
          value={pwd}
          onChange={e => { setPwd(e.target.value); setErr(false); }}
          onKeyDown={e => e.key === "Enter" && attempt()}
          className={cn(
            "w-full px-3 py-2 text-sm rounded-lg border bg-background focus:outline-none focus:ring-2 focus:ring-primary",
            err ? "border-rose-500" : "border-border",
          )}
          autoFocus
        />
        {err && <p className="text-xs text-rose-500">Incorrect password</p>}
        <button
          onClick={attempt}
          className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition"
        >
          Enter
        </button>
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

export function AdminDashboardPage() {
  const [, navigate] = useLocation();
  const [pwd, setPwd] = useState(savedPwd);
  const [authed, setAuthed] = useState(false);

  const [health, setHealth] = useState<HealthReport | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // check saved password on mount
  useEffect(() => {
    if (!pwd) return;
    fetchAdmin<HealthReport>("/api/watchers/health", pwd)
      .then(() => setAuthed(true))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = useCallback(async (p = pwd) => {
    setLoading(true);
    setError(null);
    try {
      const [h, lb] = await Promise.all([
        fetchAdmin<HealthReport>("/api/watchers/health", p),
        fetch("/api/points/leaderboard?limit=50").then(r => r.json())
          .then((d: { leaderboard: LeaderboardRow[] }) => d.leaderboard ?? []),
      ]);
      setHealth(h);
      setLeaderboard(lb);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, [pwd]);

  useEffect(() => {
    if (!authed) return;
    refresh();
    intervalRef.current = setInterval(() => refresh(), 30_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [authed, refresh]);

  function handleAuth(p: string) {
    setPwd(p);
    setAuthed(true);
  }

  function logout() {
    sessionStorage.removeItem(ADMIN_PWD_KEY);
    setAuthed(false);
    setPwd("");
  }

  async function downloadSnapshot(format: "json" | "csv") {
    const res = await fetch(`/api/points/snapshot?format=${format}`, {
      headers: { "X-Admin-Password": pwd },
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fidcaster-snapshot-${Date.now()}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!authed) return <PasswordGate onAuth={handleAuth} />;

  const ledgerDetail = health?.watchers.ledger.detail as {
    total?: number; verified?: number; pending?: number; excluded?: number;
  } | undefined;

  const verJob  = health?.jobs.verification;
  const sybilJob = health?.jobs.sybil;

  return (
    <div className="flex min-h-screen bg-background">
      <DesktopSidebar active="settings" onCast={() => {}} />

      <main className="flex-1 md:ml-[240px] p-4 md:p-8 max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-bold">Admin Dashboard</h1>
            {health && <StatusBadge status={health.status} />}
          </div>
          <div className="flex items-center gap-2">
            {lastRefresh && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                Updated {timeAgo(lastRefresh.toISOString())}
              </span>
            )}
            <button
              onClick={() => refresh()}
              disabled={loading}
              className="p-2 rounded-lg hover:bg-muted transition text-muted-foreground"
              title="Refresh"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
            <button
              onClick={logout}
              className="p-2 rounded-lg hover:bg-muted transition text-muted-foreground"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-sm text-rose-500">
            {error}
          </div>
        )}

        {/* Ledger stats */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Database className="w-4 h-4" /> Ledger
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="Total actions"    value={ledgerDetail?.total    ?? 0} />
            <Stat label="Verified"         value={ledgerDetail?.verified ?? 0} />
            <Stat label="Pending verify"   value={ledgerDetail?.pending  ?? 0} />
            <Stat label="Excluded (fraud)" value={ledgerDetail?.excluded ?? 0} />
          </div>
        </section>

        {/* Watcher health */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Activity className="w-4 h-4" /> Watchers
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {health && Object.entries(health.watchers).map(([name, snap]) => (
              <div key={name} className="bg-card border border-border rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold capitalize">{name}</span>
                  <StatusBadge status={snap.status} />
                </div>
                <p className="text-xs text-muted-foreground">Last run: {timeAgo(snap.lastRun)}</p>
                <div className="space-y-1">
                  {Object.entries(snap.detail).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{k}</span>
                      <span className="font-mono">{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Background jobs */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4" /> Background Jobs
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Verification job */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <p className="font-semibold">Verification Job</p>
              <p className="text-xs text-muted-foreground">Last run: {timeAgo(verJob?.lastRun ?? null)}</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Verified (lifetime)</span>
                  <span className="font-mono">{verJob?.verifiedCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Excluded (lifetime)</span>
                  <span className="font-mono">{verJob?.excludedCount ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pending now</span>
                  <span className="font-mono">{verJob?.pendingCount ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Sybil job */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-2">
              <p className="font-semibold">Sybil Detector</p>
              <p className="text-xs text-muted-foreground">Last run: {timeAgo(sybilJob?.lastRun ?? null)}</p>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">R1 follow-churn</span>
                  <span className="font-mono">{sybilJob?.excludedR1 ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">R2 velocity cap</span>
                  <span className="font-mono">{sybilJob?.excludedR2 ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">R3 grow-empty</span>
                  <span className="font-mono">{sybilJob?.excludedR3 ?? 0}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Snapshot download */}
        <section className="mb-6">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Download className="w-4 h-4" /> Airdrop Snapshot
          </h2>
          <div className="flex gap-3">
            <button
              onClick={() => downloadSnapshot("csv")}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-semibold hover:opacity-90 transition"
            >
              <Download className="w-4 h-4" /> Download CSV (Airdrop)
            </button>
            <button
              onClick={() => downloadSnapshot("json")}
              className="flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-muted transition"
            >
              <Download className="w-4 h-4" /> Download JSON
            </button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Includes all FIDs with ≥1 verified point. Columns: fid, total_points, rank.
          </p>
        </section>

        {/* Leaderboard */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <TrendingUp className="w-4 h-4" /> Points Leaderboard (top 50)
          </h2>
          {leaderboard.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              No points recorded yet. Actions will appear here after users cast, like, follow, or use the market.
            </div>
          ) : (
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground w-12">#</th>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">FID</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground">Points</th>
                    <th className="w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map((row, i) => (
                    <tr
                      key={row.fid}
                      onClick={() => navigate(`/profile/${row.fid}`)}
                      className={cn(
                        "border-b border-border/50 last:border-0 hover:bg-muted/40 cursor-pointer transition",
                        i < 3 && "bg-primary/3",
                      )}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${row.rank}`}
                      </td>
                      <td className="px-4 py-2.5 font-mono">{row.fid}</td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                        {row.total_points.toLocaleString()}
                      </td>
                      <td className="pr-3">
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Quick actions */}
        <section className="mb-8">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
            <Users className="w-4 h-4" /> Quick Links
          </h2>
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Leaderboard API", href: "/api/points/leaderboard?limit=10" },
              { label: "My points (FID)", href: "/api/points/my?fid=16333" },
              { label: "Referral code", href: "/api/referral/code?fid=16333" },
              { label: "Push debug", href: "/api/push/debug-status" },
            ].map(({ label, href }) => (
              <a
                key={href}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-xs px-3 py-1.5 border border-border rounded-lg hover:bg-muted transition text-muted-foreground"
              >
                {label}
              </a>
            ))}
          </div>
        </section>

      </main>
    </div>
  );
}
