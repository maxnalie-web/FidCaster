import { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, UserMinus, CheckCircle2, XCircle, X, ChevronDown, ChevronUp, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { hubFollow } from "@/lib/hub-submit";
import type { NeynarUser } from "@/lib/neynar";
import type { LocalSigner } from "@/lib/wallet";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";

const DELAY_MS = 2000;
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
}

function saveBatch(s: PersistedBatch) {
  if (s.pendingFids.length === 0) {
    sessionStorage.removeItem(BATCH_PERSIST_KEY);
  } else {
    try { sessionStorage.setItem(BATCH_PERSIST_KEY, JSON.stringify(s)); } catch { /* quota */ }
  }
}

function clearBatch() {
  sessionStorage.removeItem(BATCH_PERSIST_KEY);
}

function loadBatch(): PersistedBatch | null {
  try {
    const raw = sessionStorage.getItem(BATCH_PERSIST_KEY);
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
  label: string;
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
  initialDone?: number;
  initialErrors?: number;
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
    initialDone = 0, initialErrors = 0,
  }: RunBatchParams) => {
    cancelRef.current = false;
    let done = initialDone;
    let errors = initialErrors;
    setOp({ mode, phase: "running", done, total, errors, label });

    for (let i = 0; i < fids.length; i++) {
      if (cancelRef.current) break;

      // Persist remaining work before each action
      saveBatch({ mode, pendingFids: fids.slice(i), myFid, neynarKey, label, total, done, errors });

      try {
        await hubFollow(myFid, signer, fids[i], { unfollow: mode === "unfollow", neynarKey });
        done++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
          // Rate-limited: wait 62s then retry once
          await new Promise(r => setTimeout(r, 62_000));
          if (!cancelRef.current) {
            try {
              await hubFollow(myFid, signer, fids[i], { unfollow: mode === "unfollow", neynarKey });
              done++;
            } catch { errors++; }
          }
        } else {
          errors++;
        }
      }

      setOp({ mode, phase: "running", done, total, errors, label });
      if (i < fids.length - 1 && !cancelRef.current)
        await new Promise(r => setTimeout(r, DELAY_MS));
    }

    clearBatch();
    setOp(prev => prev
      ? { ...prev, done, errors, phase: cancelRef.current ? "cancelled" : "done" }
      : null
    );
  }, []);

  // Fresh start (called from BatchFollowSheet)
  const startOp = useCallback((params: StartOpParams) => {
    const { mode, users, myFid, localSigner, neynarKey, label } = params;
    runBatch({ mode, fids: users.map(u => u.fid), myFid, signer: localSigner, neynarKey, label, total: users.length });
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
      {op && (
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
                <div className="grid grid-cols-3 gap-2 px-4 py-3">
                  <StatBox label="Done" value={op.done} color="text-foreground" />
                  <StatBox label="Left" value={Math.max(0, op.total - op.done - op.errors)} color="text-muted-foreground" />
                  {op.errors > 0
                    ? <StatBox label="Errors" value={op.errors} color="text-rose-500" />
                    : <StatBox label="Total" value={op.total} color="text-muted-foreground" />
                  }
                </div>

                {/* ETA + rate info */}
                {isRunning && (
                  <div className="flex items-center gap-2 mx-4 mb-3 px-3 py-2 rounded-xl bg-muted/30 border border-border">
                    <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <p className="text-[11px] text-muted-foreground">
                      {etaStr} · 2s per action · won't stop on refresh
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
