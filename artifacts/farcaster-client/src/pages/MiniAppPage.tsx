/**
 * FidCaster Mini App — runs inside Warpcast (and any Farcaster client).
 *
 * When opened via the Farcaster Mini App SDK:
 *  - sdk.actions.ready() is called immediately so the splash dismisses.
 *  - sdk.context resolves the viewer's FID automatically (no login needed).
 *  - The page shows their points, rank, leaderboard, referral link, and
 *    the ETH address registration form for the token distribution.
 *
 * Falls back gracefully to the FidCaster web session (useWallet) when opened
 * in a plain browser tab.
 */
import { useEffect, useState, useCallback } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { useWallet } from "@/hooks/useWallet";
import {
  Trophy, Star, Users, Copy, Check, Wallet, ChevronRight,
  Loader2, AlertCircle, Zap, Gift,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface LeaderboardRow {
  fid: number;
  total_points: number;
  rank: number;
}

interface FidPoints {
  fid: number;
  total_points: number;
  breakdown: { action_type: string; total_actions: number; points_earned: number }[];
}

interface MiniCtx {
  user?: { fid: number; username?: string; displayName?: string; pfpUrl?: string };
}

// ── Hook: resolve FID from SDK or fallback to web session ─────────────────────
function useMiniAppFid() {
  const { fid: webFid, profile } = useWallet();
  const [sdkFid, setSdkFid] = useState<number | null>(null);
  const [sdkCtx, setSdkCtx] = useState<MiniCtx | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [isInFarcaster, setIsInFarcaster] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Signal readiness ASAP — hides the Warpcast splash screen.
      sdk.actions.ready().catch(() => {});

      try {
        const ctx = await Promise.race([
          sdk.context as Promise<MiniCtx>,
          new Promise<null>((res) => setTimeout(() => res(null), 2000)),
        ]);

        if (!cancelled && ctx?.user?.fid) {
          setSdkCtx(ctx);
          setSdkFid(ctx.user.fid);
          setIsInFarcaster(true);
          setAdded(!!(ctx as any).client?.added);
        }
      } catch {
        // Not in Farcaster — fall back to web session.
      } finally {
        if (!cancelled) setSdkReady(true);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const fid = sdkFid ?? (webFid !== null ? Number(webFid) : null);
  const username = sdkCtx?.user?.username ?? profile?.username ?? null;
  const pfpUrl = sdkCtx?.user?.pfpUrl ?? profile?.pfpUrl ?? null;

  async function addMiniApp() {
    try {
      await (sdk.actions as any).addMiniApp();
      setAdded(true);
    } catch { /* user declined */ }
  }

  return { fid, username, pfpUrl, sdkReady, isInFarcaster, added, addMiniApp };
}

// ── API helpers ────────────────────────────────────────────────────────────────
async function fetchPoints(fid: number): Promise<FidPoints | null> {
  try {
    const r = await fetch(`/api/points/my?fid=${fid}`);
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

async function fetchLeaderboard(): Promise<LeaderboardRow[]> {
  try {
    const r = await fetch(`/api/points/leaderboard?limit=20`);
    if (!r.ok) return [];
    const d = await r.json();
    return d.leaderboard ?? [];
  } catch { return []; }
}

async function fetchRegisteredAddress(fid: number): Promise<string | null> {
  try {
    const r = await fetch(`/api/airdrop/wallet?fid=${fid}`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.address ?? null;
  } catch { return null; }
}

async function fetchReferralStats(fid: number): Promise<number> {
  try {
    const r = await fetch(`/api/points/leaderboard?limit=1000`);
    if (!r.ok) return 0;
    const d = await r.json();
    return (d.leaderboard ?? []).length;
  } catch { return 0; }
}

// ── Main component ─────────────────────────────────────────────────────────────
export function MiniAppPage() {
  const { fid, username, pfpUrl, sdkReady, isInFarcaster, added, addMiniApp } = useMiniAppFid();

  const [points, setPoints] = useState<FidPoints | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [registeredAddress, setRegisteredAddress] = useState<string | null>(null);
  const [totalUsers, setTotalUsers] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // ETH address form
  const [addressInput, setAddressInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Referral link
  const [copied, setCopied] = useState(false);
  const referralCode = fid ? fid.toString(36).toUpperCase() : "";
  const referralUrl = fid ? `https://fidcaster.xyz/?ref=${referralCode}` : "";

  // Active tab
  const [tab, setTab] = useState<"points" | "leaderboard" | "airdrop">("points");

  // Load data when FID is known
  useEffect(() => {
    if (!fid || !sdkReady) return;
    setLoading(true);
    Promise.all([
      fetchPoints(fid),
      fetchLeaderboard(),
      fetchRegisteredAddress(fid),
    ]).then(([pts, lb, addr]) => {
      setPoints(pts);
      setLeaderboard(lb);
      setRegisteredAddress(addr);
      setTotalUsers(lb.length);
      if (addr) setAddressInput(addr);
    }).finally(() => setLoading(false));
  }, [fid, sdkReady]);

  const copyReferral = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(referralUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* fallback */ }
  }, [referralUrl]);

  const saveAddress = useCallback(async () => {
    if (!fid) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    try {
      const r = await fetch("/api/airdrop/wallet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid, address: addressInput.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { setSaveError(d.error ?? "Failed to save"); return; }
      setRegisteredAddress(addressInput.trim());
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 3000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [fid, addressInput]);

  // ── Loading state ────────────────────────────────────────────────────────────
  if (!sdkReady || (sdkReady && !fid && isInFarcaster)) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Loader2 className="w-7 h-7 text-primary animate-spin" />
          </div>
          <p className="text-sm text-muted-foreground">Loading FidCaster…</p>
        </div>
      </div>
    );
  }

  // ── Not logged in ────────────────────────────────────────────────────────────
  if (!fid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="text-center max-w-xs">
          <div className="w-16 h-16 rounded-2xl bg-primary/10 mx-auto flex items-center justify-center mb-4">
            <Trophy className="w-8 h-8 text-primary" />
          </div>
          <h2 className="text-xl font-bold mb-2">FidCaster Points</h2>
          <p className="text-sm text-muted-foreground mb-4">
            Open this page inside Warpcast to see your points, or log in to FidCaster first.
          </p>
          <a
            href="https://fidcaster.xyz"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
          >
            Open FidCaster <ChevronRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    );
  }

  const rank = points ? leaderboard.find(r => r.fid === fid)?.rank ?? null : null;
  const totalPts = points?.total_points ?? 0;

  return (
    <div className="min-h-screen bg-background flex flex-col max-w-lg mx-auto">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1D0070] via-[#4F46E5] to-[#7C3AED] text-white px-4 pt-10 pb-6">
        <div className="flex items-center gap-3 mb-4">
          {pfpUrl ? (
            <img src={pfpUrl} alt="" className="w-12 h-12 rounded-full border-2 border-white/30 object-cover shrink-0" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center shrink-0">
              <span className="text-lg font-bold">{String(username || fid).slice(0, 2).toUpperCase()}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-bold text-base truncate">@{username ?? `fid${fid}`}</p>
            <p className="text-xs text-white/70">FID {fid}</p>
          </div>
          {!added && isInFarcaster && (
            <button
              onClick={addMiniApp}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-xs font-semibold"
            >
              <Zap className="w-3.5 h-3.5" />
              Add
            </button>
          )}
        </div>

        {/* Points hero */}
        <div className="bg-white/10 rounded-2xl p-4 text-center">
          {loading ? (
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-white/70" />
          ) : (
            <>
              <p className="text-4xl font-extrabold tracking-tight">{totalPts.toLocaleString()}</p>
              <p className="text-sm text-white/70 mt-0.5">points</p>
              {rank && (
                <p className="text-xs text-white/60 mt-1">
                  Rank #{rank} of {leaderboard.length}+ users
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-border bg-background sticky top-0 z-10">
        {(["points", "leaderboard", "airdrop"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-semibold transition-colors ${
              tab === t
                ? "text-primary border-b-2 border-primary"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "points" ? "Points" : t === "leaderboard" ? "Leaderboard" : "Airdrop"}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 pb-8 space-y-3">

        {/* ── Points tab ─────────────────────────────────────────────────── */}
        {tab === "points" && (
          <>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : points && points.breakdown.length > 0 ? (
              <>
                <div className="rounded-xl border border-border overflow-hidden">
                  <div className="px-4 py-3 bg-muted/40 border-b border-border">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Breakdown</p>
                  </div>
                  {points.breakdown.map((b) => (
                    <div key={b.action_type} className="flex items-center justify-between px-4 py-3 border-b border-border last:border-0">
                      <div>
                        <p className="text-sm font-medium capitalize">{b.action_type.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">{b.total_actions.toLocaleString()} actions</p>
                      </div>
                      <span className="text-sm font-bold text-primary">+{b.points_earned.toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                {/* Referral section */}
                <div className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-primary" />
                    <p className="text-sm font-semibold">Referral Link</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Refer a friend. When they hit 100 points, you both earn 200 bonus points.
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-muted text-xs font-mono truncate">
                      {referralUrl}
                    </div>
                    <button
                      onClick={copyReferral}
                      className="shrink-0 p-2 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-primary" />}
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-10">
                <Star className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm font-semibold text-foreground mb-1">No points yet</p>
                <p className="text-xs text-muted-foreground">Cast, like, follow, and buy FIDs on FidCaster to earn points.</p>
                <a
                  href="https://fidcaster.xyz/dashboard"
                  className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-full bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  Start earning <ChevronRight className="w-4 h-4" />
                </a>
              </div>
            )}
          </>
        )}

        {/* ── Leaderboard tab ────────────────────────────────────────────── */}
        {tab === "leaderboard" && (
          <>
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-10">
                <Trophy className="w-10 h-10 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No data yet</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                {leaderboard.map((row, i) => {
                  const isMe = row.fid === fid;
                  return (
                    <div
                      key={row.fid}
                      className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 ${isMe ? "bg-primary/5" : ""}`}
                    >
                      <span className={`w-6 text-sm font-bold shrink-0 ${i === 0 ? "text-amber-500" : i === 1 ? "text-slate-400" : i === 2 ? "text-amber-700" : "text-muted-foreground"}`}>
                        #{row.rank}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold truncate ${isMe ? "text-primary" : ""}`}>
                          FID {row.fid} {isMe && <span className="text-xs font-normal text-primary/70">(you)</span>}
                        </p>
                      </div>
                      <span className="text-sm font-bold shrink-0">{row.total_points.toLocaleString()}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* ── Wallet tab ────────────────────────────────────────────────── */}
        {tab === "airdrop" && (
          <>
            <div className="rounded-xl border border-border p-4 space-y-1">
              <div className="flex items-center gap-2 mb-2">
                <Gift className="w-4 h-4 text-amber-500" />
                <p className="text-sm font-semibold">Token Airdrop</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Register your Ethereum wallet on Base to receive the FidCaster token airdrop.
                Allocation is proportional to your total points.
              </p>
              <div className="mt-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-lg px-3 py-2.5">
                <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                  Your allocation: {totalPts.toLocaleString()} points → proportional share of token pool
                </p>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Wallet className="w-4 h-4 text-primary" />
                <p className="text-sm font-semibold">
                  {registeredAddress ? "Update Wallet Address" : "Register Wallet Address"}
                </p>
              </div>

              {registeredAddress && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900/40 rounded-lg">
                  <Check className="w-4 h-4 text-green-600 shrink-0" />
                  <p className="text-xs text-green-700 dark:text-green-400 font-mono break-all">
                    {registeredAddress.slice(0, 10)}…{registeredAddress.slice(-8)}
                  </p>
                </div>
              )}

              <input
                type="text"
                value={addressInput}
                onChange={(e) => setAddressInput(e.target.value)}
                placeholder="0x…"
                className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
                spellCheck={false}
                autoComplete="off"
              />

              {saveError && (
                <div className="flex items-center gap-2 text-destructive text-xs">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {saveError}
                </div>
              )}

              {saveOk && (
                <div className="flex items-center gap-2 text-green-600 dark:text-green-400 text-xs">
                  <Check className="w-3.5 h-3.5 shrink-0" />
                  Wallet registered successfully!
                </div>
              )}

              <button
                onClick={saveAddress}
                disabled={saving || !addressInput.trim()}
                className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</>
                ) : registeredAddress ? "Update Address" : "Register Address"}
              </button>

              <p className="text-xs text-muted-foreground text-center">
                Use a Base-compatible wallet. One address per FID.
              </p>
            </div>

            <div className="rounded-xl border border-border p-4 space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How it works</p>
              {[
                ["1", "Earn points by using FidCaster"],
                ["2", "Register your Base wallet above"],
                ["3", "Snapshot taken at airdrop date"],
                ["4", "Tokens sent pro-rata on Base"],
              ].map(([n, t]) => (
                <div key={n} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{n}</span>
                  <p className="text-xs text-muted-foreground">{t}</p>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
