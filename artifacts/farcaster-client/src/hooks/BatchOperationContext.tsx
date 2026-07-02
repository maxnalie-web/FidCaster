import { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, UserMinus, CheckCircle2, XCircle, X, ChevronDown, ChevronUp, Clock, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { hubFollow } from "@/lib/hub-submit";
import { checkFollowStatusBulk, type NeynarUser } from "@/lib/neynar";
import type { LocalSigner } from "@/lib/wallet";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";

// ─── Timing knobs ─────────────────────────────────────────────────────────────
// Normal gap between consecutive hub submissions (keeps us well under rate limit)
const DELAY_MS = 1500;
// How long to wait before retrying after a signer-not-yet-known error.
// Hubs typically sync a new signer within 60–120s of the on-chain tx confirming.
const SIGNER_RETRY_WAIT_MS = 90_000;
// How many times we'll wait+retry a single FID before giving up on it.
const MAX_SIGNER_RETRIES = 3;
// If this many FIDs in a row produce hub errors (any kind), pause before continuing.
// Raised from 4 → 10: transient server restarts / blips should not trigger this.
const CONSECUTIVE_ERR_LIMIT = 10;
// How long to pause when consecutive errors hit the limit.
const CONSECUTIVE_ERR_PAUSE_MS = 30_000;

const BATCH_PERSIST_KEY = "fc_batch_op_v1";

// ─── Persistence helpers ───────────────────────────────────────────────────────

interface PersistedBatch {
  mode: "follow" | "unfollow";
  pendingFids: number[];
  myFid: number;
  neynarKey: string;
  label: string;
  total: number;
  done: number;
  errors: number;
  skipped: number;
}

function saveBatch(s: PersistedBatch) {
  if (s.pendingFids.length === 0) {
    localStorage.removeItem(BATCH_PERSIST_KEY);
  } else {
    try { localStorage.setItem(BATCH_PERSIST_KEY, JSON.stringify(s)); } catch { /* quota */ }
  }
}

function clearBatch() {
  localStorage.removeItem(BATCH_PERSIST_KEY);
}

function loadBatch(): PersistedBatch | null {
  try {
    const raw = localStorage.getItem(BATCH_PERSIST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedBatch;
  } catch { return null; }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchOp {
  mode: "follow" | "unfollow";
  phase: "running" | "done" | "cancelled";
  done: number;
  total: number;
  errors: number;
  skipped: number;
  prefiltered: number;
  label: string;
  /** Set while the batch is waiting before a retry — shown to user in the pill */
  waitMsg?: string;
}

export interface StartOpParams {
  mode: "follow" | "unfollow";
  users: NeynarUser[];
  myFid: number;
  localSigner: LocalSigner;
  neynarKey: string;
  label: string;
}

interface RunBatchParams {
  mode: "follow" | "unfollow";
  fids: number[];
  myFid: number;
  signer: LocalSigner;
  neynarKey: string;
  label: string;
  total: number;
  prefiltered?: number;
  initialDone?: number;
  initialErrors?: number;
  initialSkipped?: number;
}

interface BatchOperationCtx {
  op: BatchOp | null;
  startOp: (params: StartOpParams) => void;
  cancelOp: () => void;
  clearOp: () => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const BatchOperationContext = createContext<BatchOperationCtx>({
  op: null,
  startOp: () => {},
  cancelOp: () => {},
  clearOp: () => {},
});

export function useBatchOperation() {
  return useContext(BatchOperationContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function BatchOperationProvider({ children }: { children: React.ReactNode }) {
  const { fid, localSigner, neynarKey: walletNeynarKey } = useWallet();
  const [op, setOp] = useState<BatchOp | null>(null);
  const cancelRef = useRef(false);
  const resumedRef = useRef(false);

  // Core runner — used for fresh starts AND resumes.
  // Captures signer in closure so account switches in the UI don't affect it.
  const runBatch = useCallback(async ({
    mode, fids, myFid, signer, neynarKey, label, total,
    prefiltered = 0, initialDone = 0, initialErrors = 0, initialSkipped = 0,
  }: RunBatchParams) => {
    cancelRef.current = false;
    let done = initialDone;
    let errors = initialErrors;
    let skipped = initialSkipped;
    const pf = prefiltered;
    setOp({ mode, phase: "running", done, total, errors, skipped, prefiltered: pf, label });

    const attempt = async (targetFid: number) =>
      hubFollow(myFid, signer, targetFid, { unfollow: mode === "unfollow", neynarKey });

    // Helper: update op state (with optional wait message shown in the pill)
    const update = (waitMsg?: string) =>
      setOp({ mode, phase: "running", done, total, errors, skipped, prefiltered: pf, label, waitMsg });

    // Tracks runs of consecutive non-duplicate hub errors so we can auto-throttle
    let consecutiveErrors = 0;

    for (let i = 0; i < fids.length; i++) {
      if (cancelRef.current) break;
      const targetFid = fids[i];

      // Persist remaining work BEFORE each action so a page refresh can resume
      saveBatch({ mode, pendingFids: fids.slice(i), myFid, neynarKey, label, total, done, errors, skipped });

      // ── Inner retry loop for this single FID ──────────────────────────────
      // We never cancel the whole batch for transient hub issues; we wait and retry.
      let result: "done" | "skipped" | "error" = "error";
      let signerRetries = 0;  // retries specifically for signer-sync errors
      let genericRetries = 0; // retries for rate-limit / timeout

      while (!cancelRef.current) {
        try {
          await attempt(targetFid);
          result = "done";
          break;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const lo = msg.toLowerCase();

          const isDuplicate = lo.includes("duplicate") || lo.includes("already follow");
          // PERMANENT_SKIP: target FID deleted/deactivated/invalid — hub returns
          // bad_request.validation_failure for all targets. No point retrying.
          const isPermanentSkip =
            lo.includes("permanent_skip") ||
            lo.includes("validation_failure") ||
            lo.includes("bad_request.validation");
          const isSignerError =
            lo.includes("signer_not_registered") ||
            lo.includes("signer not recognized") ||
            lo.includes("signer key is not yet recognized") ||
            lo.includes("fid cannot be 0") ||
            lo.includes("unknown signer") ||
            lo.includes("invalid signer");
          const isRateLimit =
            msg.includes("429") || lo.includes("rate limit") || lo.includes("too many requests");
          const isTransient = lo.includes("timeout") || lo.includes("abort") || lo.includes("signal");

          if (isDuplicate || isPermanentSkip) {
            result = "skipped";
            break;
          }

          if (isSignerError && signerRetries < MAX_SIGNER_RETRIES) {
            // Hub hasn't synced the signer yet — this is a temporary condition.
            // Wait for the hub to catch up, then retry the same FID silently.
            signerRetries++;
            const secsLeft = Math.round(SIGNER_RETRY_WAIT_MS / 1000);
            update(`Hub syncing signer… retry ${signerRetries}/${MAX_SIGNER_RETRIES} in ${secsLeft}s`);
            await new Promise(r => setTimeout(r, SIGNER_RETRY_WAIT_MS));
            update(); // clear wait message before retrying
            continue; // retry the same FID
          }

          if (isRateLimit && genericRetries < 3) {
            genericRetries++;
            update(`Rate limited — waiting 62s (retry ${genericRetries}/3)`);
            await new Promise(r => setTimeout(r, 62_000));
            update();
            continue;
          }

          if (isTransient && genericRetries === 0) {
            genericRetries++;
            await new Promise(r => setTimeout(r, 3_000));
            continue;
          }

          // Gave up on this FID
          result = "error";
          break;
        }
      }

      // Tally the result
      if (result === "done") {
        done++;
        consecutiveErrors = 0;
      } else if (result === "skipped") {
        skipped++;
        consecutiveErrors = 0;
      } else {
        errors++;
        consecutiveErrors++;
      }

      // Auto-throttle: if the hub keeps rejecting in a row, give it a 60s breather.
      // This handles undocumented per-FID or per-app rate windows transparently.
      if (consecutiveErrors >= CONSECUTIVE_ERR_LIMIT && !cancelRef.current) {
        update(`Hub is busy — cooling down for 60s…`);
        await new Promise(r => setTimeout(r, CONSECUTIVE_ERR_PAUSE_MS));
        consecutiveErrors = 0;
        update();
      }

      update();
      if (i < fids.length - 1 && !cancelRef.current)
        await new Promise(r => setTimeout(r, DELAY_MS));
    }

    clearBatch();
    setOp(prev => prev
      ? { ...prev, done, errors, skipped, phase: cancelRef.current ? "cancelled" : "done" }
      : null
    );
  }, []);

  // Fresh start — pre-filters already-followed/unfollowed users before running
  const startOp = useCallback((params: StartOpParams) => {
    const { mode, users, myFid, localSigner, neynarKey, label } = params;

    (async () => {
      // Step 1: split by whether viewer_context is available
      const withCtx  = users.filter(u => u.viewer_context !== undefined);
      const noCtx    = users.filter(u => u.viewer_context === undefined);

      // Filter users we already know about from viewer_context
      let filtered = withCtx.filter(u =>
        mode === "follow" ? !u.viewer_context!.following : u.viewer_context!.following
      );

      // Step 2: for users missing viewer_context do a bulk API check (batches of 100)
      if (noCtx.length > 0) {
        try {
          const followedSet = await checkFollowStatusBulk(myFid, noCtx.map(u => u.fid), neynarKey);
          const checkedOk = noCtx.filter(u =>
            mode === "follow" ? !followedSet.has(u.fid) : followedSet.has(u.fid)
          );
          filtered = [...filtered, ...checkedOk];
        } catch {
          // API check failed — include them all; duplicates handled at runtime
          filtered = [...filtered, ...noCtx];
        }
      }

      const prefiltered = users.length - filtered.length;
      if (prefiltered > 0) {
        toast.info(`Filtered ${prefiltered} already-${mode === "follow" ? "followed" : "unfollowed"} users`, { duration: 3000 });
      }
      if (filtered.length === 0) {
        toast.success(`All ${users.length} users already ${mode === "follow" ? "followed" : "unfollowed"}! Nothing to do.`);
        return;
      }

      runBatch({ mode, fids: filtered.map(u => u.fid), myFid, signer: localSigner, neynarKey, label, total: filtered.length, prefiltered });
    })();
  }, [runBatch]);

  // Auto-resume on page reload — fires when wallet session is restored
  useEffect(() => {
    if (!fid || !localSigner || resumedRef.current) return;
    const saved = loadBatch();
    if (!saved) return;
    if (saved.myFid !== Number(fid) || !saved.pendingFids.length) { clearBatch(); return; }
    resumedRef.current = true;
    toast.info(`Resuming batch (${saved.pendingFids.length} left)…`, { duration: 3000 });
    runBatch({
      mode: saved.mode,
      fids: saved.pendingFids,
      myFid: saved.myFid,
      signer: localSigner,
      neynarKey: saved.neynarKey || walletNeynarKey,
      label: saved.label,
      total: saved.total,
      initialDone: saved.done,
      initialErrors: saved.errors,
      initialSkipped: saved.skipped ?? 0,
    });
  }, [fid, localSigner, runBatch, walletNeynarKey]);

  function cancelOp() { cancelRef.current = true; clearBatch(); }
  function clearOp() { setOp(null); }

  return (
    <BatchOperationContext.Provider value={{ op, startOp, cancelOp, clearOp }}>
      {children}
      <BatchProgressPill op={op} onCancel={cancelOp} onDismiss={clearOp} />
    </BatchOperationContext.Provider>
  );
}

// ─── Floating progress pill (expandable) ──────────────────────────────────────

function BatchProgressPill({ op, onCancel, onDismiss }: {
  op: BatchOp | null;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const { isLocked } = useWallet();
  const [expanded, setExpanded] = useState(false);

  // Auto-dismiss after 6s once finished
  useEffect(() => {
    if (op?.phase === "done" || op?.phase === "cancelled") {
      setExpanded(false);
      const t = setTimeout(onDismiss, 6000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [op?.phase, onDismiss]);

  // Collapse when operation is gone
  useEffect(() => {
    if (!op) setExpanded(false);
  }, [op]);

  const pct = op && op.total > 0 ? (op.done / op.total) * 100 : 0;
  const remaining = op ? Math.max(0, op.total - op.done - op.errors) : 0;
  const etaSecs = remaining * ((DELAY_MS + 300) / 1000);
  const etaStr = etaSecs < 60
    ? `~${Math.round(etaSecs)}s left`
    : `~${Math.round(etaSecs / 60)}m left`;

  const isRunning = op?.phase === "running";
  const isDone = op?.phase === "done";
  const isCanc = op?.phase === "cancelled";

  const pillColor = isDone
    ? "border-green-500/25 shadow-green-500/5"
    : isCanc
    ? "border-border"
    : op?.mode === "follow"
    ? "border-primary/25 shadow-primary/8"
    : "border-rose-500/25 shadow-rose-500/8";

  const iconBg = isDone
    ? "bg-green-500/10 text-green-500"
    : isCanc
    ? "bg-muted text-muted-foreground"
    : op?.mode === "follow"
    ? "bg-primary/10 text-primary"
    : "bg-rose-500/10 text-rose-500";

  const barColor = op?.mode === "follow" ? "bg-primary" : "bg-rose-500";

  return (
    <AnimatePresence>
      {op && !isLocked && (
        <motion.div
          key="batch-pill"
          initial={{ y: 96, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 96, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          className="fixed bottom-[72px] md:bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[min(400px,calc(100vw-24px))]"
        >
          <AnimatePresence mode="wait">
            {expanded ? (
              /* ── EXPANDED PANEL ─────────────────────────────────── */
              <motion.div
                key="expanded"
                initial={{ opacity: 0, scale: 0.97, y: 12 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97, y: 12 }}
                transition={{ type: "spring", damping: 28, stiffness: 360 }}
                className={cn(
                  "rounded-2xl shadow-2xl border bg-background/98 backdrop-blur-xl overflow-hidden",
                  pillColor,
                )}
              >
                {/* Header — tap to collapse */}
                <button
                  onClick={() => setExpanded(false)}
                  className="w-full flex items-center gap-3 px-4 pt-4 pb-3 text-left hover:bg-muted/20 transition-colors"
                >
                  <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center shrink-0", iconBg)}>
                    {isDone ? <CheckCircle2 className="w-4.5 h-4.5" />
                      : isCanc ? <XCircle className="w-4.5 h-4.5" />
                      : op.mode === "follow" ? <UserPlus className="w-4.5 h-4.5" />
                      : <UserMinus className="w-4.5 h-4.5" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-foreground truncate">{op.label}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {isRunning ? "Running…" : isDone ? "Completed" : "Stopped"}
                    </p>
                  </div>
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>

                {/* Progress bar */}
                <div className="px-4 pb-1">
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <motion.div
                      className={cn("h-full rounded-full", barColor)}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6 }}
                    />
                  </div>
                </div>

                {/* Stats grid */}
                <div className="grid grid-cols-4 gap-2 px-4 py-3">
                  <StatBox label="Done" value={op.done} color="text-foreground" />
                  <StatBox label="Left" value={Math.max(0, op.total - op.done - op.errors - op.skipped)} color="text-muted-foreground" />
                  <StatBox label="Skipped" value={op.skipped} color="text-amber-500" />
                  <StatBox label="Errors" value={op.errors} color={op.errors > 0 ? "text-rose-500" : "text-muted-foreground"} />
                </div>

                {/* Wait / retry status */}
                {isRunning && op.waitMsg && (
                  <div className="flex items-center gap-2 mx-4 mb-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/25">
                    <Loader2 className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-spin" />
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                      {op.waitMsg}
                    </p>
                  </div>
                )}

                {/* ETA + rate info */}
                {isRunning && !op.waitMsg && (
                  <div className="flex items-center gap-2 mx-4 mb-3 px-3 py-2 rounded-xl bg-muted/30 border border-border">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <p className="text-[11px] text-muted-foreground">
                      {etaStr} · auto-retries on hub errors · won't stop on refresh
                    </p>
                  </div>
                )}

                {/* Pre-filtered note */}
                {op.prefiltered > 0 && (
                  <div className="flex items-center gap-2 mx-4 mb-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/20">
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {op.prefiltered} already-{op.mode === "follow" ? "followed" : "unfollowed"} users skipped before start
                    </p>
                  </div>
                )}

                {/* Error note */}
                {op.errors > 0 && (
                  <div className="flex items-center gap-2 mx-4 mb-3 px-3 py-2 rounded-xl bg-rose-500/8 border border-rose-500/20">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <p className="text-[11px] text-rose-600 dark:text-rose-400">
                      {op.errors} action{op.errors !== 1 ? "s" : ""} failed — others completed successfully
                    </p>
                  </div>
                )}

                {/* Done message */}
                {isDone && (
                  <p className="text-center text-[13px] font-semibold text-green-500 px-4 mb-3">
                    ✓ All done! {op.done} {op.mode === "follow" ? "followed" : "unfollowed"}
                    {op.errors > 0 ? `, ${op.errors} failed` : ""}
                  </p>
                )}

                {/* Actions */}
                <div className="px-4 pb-4 flex gap-2">
                  {isRunning ? (
                    <>
                      <button
                        onClick={() => setExpanded(false)}
                        className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 font-semibold text-[13px] transition-all"
                      >
                        Minimize
                      </button>
                      <button
                        onClick={onCancel}
                        className="flex-1 py-2.5 rounded-xl border border-rose-500/30 bg-rose-500/8 text-rose-500 hover:bg-rose-500/15 font-semibold text-[13px] transition-all"
                      >
                        Stop
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={onDismiss}
                      className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground font-semibold text-[13px] transition-all"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              </motion.div>
            ) : (
              /* ── COLLAPSED PILL ─────────────────────────────────── */
              <motion.div
                key="collapsed"
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ type: "spring", damping: 28, stiffness: 360 }}
                className={cn(
                  "flex items-center gap-3 px-3.5 py-2.5 rounded-2xl shadow-2xl border cursor-pointer",
                  "bg-background/96 backdrop-blur-xl select-none",
                  pillColor,
                )}
                onClick={() => setExpanded(true)}
              >
                {/* Icon */}
                <div className={cn("w-8 h-8 rounded-xl flex items-center justify-center shrink-0", iconBg)}>
                  {isDone ? <CheckCircle2 className="w-4 h-4" />
                    : isCanc ? <XCircle className="w-4 h-4" />
                    : op.mode === "follow" ? <UserPlus className="w-4 h-4" />
                    : <UserMinus className="w-4 h-4" />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  {isRunning ? (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <p className="text-[12px] font-semibold text-foreground truncate">{op.label}</p>
                        <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                          {op.done}/{op.total}
                        </span>
                      </div>
                      {op.waitMsg ? (
                        <div className="flex items-center gap-1.5">
                          <Loader2 className="w-3 h-3 text-amber-500 animate-spin shrink-0" />
                          <span className="text-[10px] text-amber-500 truncate">{op.waitMsg}</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                            <motion.div
                              className={cn("h-full rounded-full", barColor)}
                              animate={{ width: `${pct}%` }}
                              transition={{ duration: 0.5 }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{etaStr}</span>
                        </div>
                      )}
                    </>
                  ) : isDone ? (
                    <p className="text-[13px] font-semibold text-foreground">
                      Done{" "}
                      <span className="text-green-500">{op.done} {op.mode === "follow" ? "followed" : "unfollowed"}</span>
                      {op.errors > 0 && <span className="text-rose-400"> · {op.errors} failed</span>}
                    </p>
                  ) : (
                    <p className="text-[13px] font-semibold text-foreground">
                      Stopped · <span className="text-muted-foreground">{op.done}/{op.total} done</span>
                    </p>
                  )}
                </div>

                {/* Expand chevron / stop button */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {isRunning && (
                    <button
                      onClick={e => { e.stopPropagation(); onCancel(); }}
                      className="text-[11px] font-semibold text-muted-foreground hover:text-rose-500 border border-border hover:border-rose-500/30 rounded-xl px-2 py-1 transition-all"
                    >
                      Stop
                    </button>
                  )}
                  {!isRunning && (
                    <button
                      onClick={e => { e.stopPropagation(); onDismiss(); }}
                      className="p-1 rounded-lg hover:bg-muted text-muted-foreground transition-colors"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatBox({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 px-2 py-2 rounded-xl bg-muted/30 border border-border">
      <span className={cn("text-[18px] font-black tabular-nums leading-none", color)}>
        {value.toLocaleString()}
      </span>
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">{label}</span>
    </div>
  );
}
