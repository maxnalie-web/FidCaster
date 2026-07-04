import { useState, useEffect } from "react";
import { X, Loader2, CheckCircle2, AlertTriangle, XCircle, Info, Clock } from "lucide-react";
import { getUserCasts, type NeynarUser, type NeynarCast } from "@/lib/neynar";
import { analyzeAccount, type SpamAnalysisResult, type SpamCheck } from "@/lib/spam-analysis";
import { cn } from "@/lib/utils";

// One analysis per account per day · analyzing costs real API calls and the
// underlying signals (follower ratio, recent casts, score) don't meaningfully
// change minute to minute, so re-running on demand was just wasted quota.
const COOLDOWN_MS = 24 * 60 * 60 * 1000;
function lastRunKey(fid: number): string { return `fc_spam_analysis_last_${fid}`; }
function getLastRun(fid: number): number {
  try { return Number(localStorage.getItem(lastRunKey(fid))) || 0; } catch { return 0; }
}
function setLastRun(fid: number): void {
  try { localStorage.setItem(lastRunKey(fid), String(Date.now())); } catch {}
}
function getCachedResult(fid: number): SpamAnalysisResult | null {
  try {
    const raw = localStorage.getItem(`fc_spam_analysis_cache_${fid}`);
    return raw ? (JSON.parse(raw) as SpamAnalysisResult) : null;
  } catch { return null; }
}
function setCachedResult(fid: number, result: SpamAnalysisResult): void {
  try { localStorage.setItem(`fc_spam_analysis_cache_${fid}`, JSON.stringify(result)); } catch {}
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-500";
  if (score >= 40) return "text-amber-500";
  return "text-rose-500";
}

function scoreRingColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 40) return "#f59e0b";
  return "#f43f5e";
}

function ScoreRing({ score }: { score: number }) {
  const r = 42;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  return (
    <div className="relative w-28 h-28 shrink-0">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" className="text-muted/30" strokeWidth="8" />
        <circle
          cx="50" cy="50" r={r} fill="none" stroke={scoreRingColor(score)} strokeWidth="8"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-black tabular-nums", scoreColor(score))}>{score}</span>
        <span className="text-[10px] text-muted-foreground font-semibold">/ 100</span>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: SpamCheck["status"] }) {
  if (status === "pass") return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (status === "warn") return <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />;
  return <XCircle className="w-4 h-4 text-rose-500 shrink-0" />;
}

function CheckRow({ check }: { check: SpamCheck }) {
  return (
    <div className="flex items-start gap-2.5 py-3 border-b border-border/40 last:border-b-0">
      <StatusIcon status={check.status} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[13px] font-semibold text-foreground">{check.label}</p>
          {check.impact === "high" && check.status !== "pass" && (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wide bg-rose-500/10 text-rose-500 border border-rose-500/20">
              High impact
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed">{check.detail}</p>
        {check.fixHint && (
          <p className="text-[12px] text-primary/90 mt-1 leading-relaxed">→ {check.fixHint}</p>
        )}
      </div>
    </div>
  );
}

function formatCooldown(ms: number): string {
  const hrs = Math.ceil(ms / 3_600_000);
  if (hrs <= 1) return "less than an hour";
  return `about ${hrs} hours`;
}

export function SpamAnalyzerSheet({ user, myFid, neynarKey, onClose }: {
  user: NeynarUser; myFid: number; neynarKey: string; onClose: () => void;
}) {
  const [result, setResult] = useState<SpamAnalysisResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);

  useEffect(() => {
    const lastRun = getLastRun(user.fid);
    const remaining = COOLDOWN_MS - (Date.now() - lastRun);
    if (remaining > 0) {
      const cached = getCachedResult(user.fid);
      if (cached) {
        setResult(cached);
        setCooldownRemaining(remaining);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError(null);
    getUserCasts(user.fid, myFid, neynarKey, undefined, 40)
      .then((res) => {
        const analysis = analyzeAccount(user, res.casts as NeynarCast[]);
        setResult(analysis);
        setCachedResult(user.fid, analysis);
        setLastRun(user.fid);
        setCooldownRemaining(COOLDOWN_MS);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to analyze account"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.fid]);

  return (
    <div className="fixed inset-0 z-[80] bg-background flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border bg-background/95 backdrop-blur-sm">
        <button onClick={onClose} className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
          <X className="w-5 h-5" />
        </button>
        <span className="text-base font-bold">Score analysis</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-24 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
            <p className="text-sm">Reading this account's profile and recent casts…</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 py-24 text-center px-6">
            <AlertTriangle className="w-8 h-8 text-amber-500 opacity-60" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : result ? (
          <div className="p-5 space-y-6 max-w-lg mx-auto">
            {cooldownRemaining > 0 && (
              <div className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-muted/20 border border-border/60 text-[11px] text-muted-foreground">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                Analyzed once per day · next run available in {formatCooldown(cooldownRemaining)}.
              </div>
            )}

            <div className="flex items-center gap-5 p-4 rounded-2xl border border-border bg-card">
              <ScoreRing score={result.overallScore} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground">
                  {result.overallScore >= 70 ? "Healthy account signals" : result.overallScore >= 40 ? "Room to improve" : "Multiple spam-like signals"}
                </p>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {result.narrative}
                </p>
              </div>
            </div>

            {result.topActions.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  Priority actions for this account
                </p>
                <div className="rounded-2xl border border-border bg-card px-4 divide-y divide-border/40">
                  {result.topActions.map((c) => <CheckRow key={c.id} check={c} />)}
                </div>
              </div>
            )}

            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                All checks
              </p>
              <div className="rounded-2xl border border-border bg-card px-4 divide-y divide-border/40">
                {result.checks.map((c) => <CheckRow key={c.id} check={c} />)}
              </div>
            </div>

            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-muted/20 border border-border/60">
              <Info className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Neynar and Farcaster don't publish the exact formula behind quality scores or spam
                filtering. This report reads the same signals they've publicly named as mattering
                (verified identity, network quality, authentic engagement) and computes every
                number above from this specific account's own data · treat it as a diagnostic, not
                a guarantee.
              </p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
