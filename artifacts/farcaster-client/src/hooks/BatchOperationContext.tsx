import { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, UserMinus, CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { hubFollow } from "@/lib/hub-submit";
import type { NeynarUser } from "@/lib/neynar";
import type { LocalSigner } from "@/lib/wallet";

const DELAY_MS = 2000;

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
  const [op, setOp] = useState<BatchOp | null>(null);
  const cancelRef = useRef(false);

  const startOp = useCallback(async (params: StartOpParams) => {
    const { mode, users, myFid, localSigner, neynarKey, label } = params;
    cancelRef.current = false;
    setOp({ mode, phase: "running", done: 0, total: users.length, errors: 0, label });

    let done = 0, errors = 0;
    for (let i = 0; i < users.length; i++) {
      if (cancelRef.current) break;
      try {
        await hubFollow(myFid, localSigner, users[i].fid, { unfollow: mode === "unfollow", neynarKey });
        done++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
          // Rate-limited: wait 62s then retry once
          await new Promise(r => setTimeout(r, 62_000));
          if (!cancelRef.current) {
            try {
              await hubFollow(myFid, localSigner, users[i].fid, { unfollow: mode === "unfollow", neynarKey });
              done++;
            } catch { errors++; }
          }
        } else {
          errors++;
        }
      }
      setOp({ mode, phase: "running", done, total: users.length, errors, label });
      if (i < users.length - 1 && !cancelRef.current)
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    setOp(prev => prev
      ? { ...prev, done, errors, phase: cancelRef.current ? "cancelled" : "done" }
      : null
    );
  }, []);

  function cancelOp() {
    cancelRef.current = true;
  }

  function clearOp() {
    setOp(null);
  }

  return (
    <BatchOperationContext.Provider value={{ op, startOp, cancelOp, clearOp }}>
      {children}
      <BatchProgressPill op={op} onCancel={cancelOp} onDismiss={clearOp} />
    </BatchOperationContext.Provider>
  );
}

// ─── Floating progress pill ────────────────────────────────────────────────────

function BatchProgressPill({ op, onCancel, onDismiss }: {
  op: BatchOp | null;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  // Auto-dismiss after 6s once finished
  useEffect(() => {
    if (op?.phase === "done" || op?.phase === "cancelled") {
      const t = setTimeout(onDismiss, 6000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [op?.phase, onDismiss]);

  const pct = op && op.total > 0 ? (op.done / op.total) * 100 : 0;
  const remaining = op ? Math.max(0, op.total - op.done - op.errors) : 0;
  const etaSecs = remaining * ((DELAY_MS + 300) / 1000);
  const etaStr = etaSecs < 60
    ? `~${Math.round(etaSecs)}s left`
    : `~${Math.round(etaSecs / 60)}m left`;

  return (
    <AnimatePresence>
      {op && (
        <motion.div
          key="batch-pill"
          initial={{ y: 96, opacity: 0, scale: 0.95 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: 96, opacity: 0, scale: 0.95 }}
          transition={{ type: "spring", damping: 26, stiffness: 300 }}
          className="fixed bottom-[72px] md:bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[min(380px,calc(100vw-24px))]"
        >
          <div className={cn(
            "flex items-center gap-3 px-3.5 py-3 rounded-2xl shadow-2xl border",
            "bg-background/96 backdrop-blur-xl",
            op.phase === "running"
              ? "border-primary/25 shadow-primary/10"
              : op.phase === "done"
              ? "border-green-500/25"
              : "border-border",
          )}>
            {/* Icon */}
            <div className={cn(
              "w-9 h-9 rounded-xl flex items-center justify-center shrink-0",
              op.phase === "done"
                ? "bg-green-500/10 text-green-500"
                : op.phase === "cancelled"
                ? "bg-muted text-muted-foreground"
                : op.mode === "follow"
                ? "bg-primary/10 text-primary"
                : "bg-rose-500/10 text-rose-500",
            )}>
              {op.phase === "done"
                ? <CheckCircle2 className="w-4.5 h-4.5" />
                : op.phase === "cancelled"
                ? <XCircle className="w-4.5 h-4.5" />
                : op.mode === "follow"
                ? <UserPlus className="w-4.5 h-4.5" />
                : <UserMinus className="w-4.5 h-4.5" />
              }
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              {op.phase === "running" ? (
                <>
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <p className="text-[12px] font-semibold text-foreground truncate">{op.label}</p>
                    <span className="text-[11px] text-muted-foreground shrink-0 tabular-nums">
                      {op.done}/{op.total}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <motion.div
                        className={cn("h-full rounded-full", op.mode === "follow" ? "bg-primary" : "bg-rose-500")}
                        animate={{ width: `${pct}%` }}
                        transition={{ duration: 0.5 }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">{etaStr}</span>
                  </div>
                </>
              ) : op.phase === "done" ? (
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

            {/* Action */}
            {op.phase === "running" ? (
              <button
                onClick={onCancel}
                className="shrink-0 text-[11px] font-semibold text-muted-foreground hover:text-rose-500 border border-border hover:border-rose-500/30 rounded-xl px-2.5 py-1.5 transition-all"
              >
                Stop
              </button>
            ) : (
              <button
                onClick={onDismiss}
                className="shrink-0 p-1.5 rounded-xl hover:bg-muted text-muted-foreground transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
