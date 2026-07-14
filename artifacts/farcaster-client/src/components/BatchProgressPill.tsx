import { useLocation } from "wouter";
import { useBatchOperation } from "@/hooks/BatchOperationContext";
import type { BatchOp } from "@/hooks/BatchOperationContext";
import { UserPlus, Scissors, X, EyeOff, ListChecks, Loader2, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

function OpsCard({ op, onCancel, onDismiss, onHide }: {
  op: BatchOp;
  onCancel: () => void;
  onDismiss: () => void;
  onHide: () => void;
}) {
  const pct = op.total > 0 ? Math.round((op.done / op.total) * 100) : 0;
  const isRunning = op.phase === "running";
  const isDone = op.phase === "done";
  const isCancelled = op.phase === "cancelled";

  return (
    <div className="bg-background/95 backdrop-blur-md border border-border rounded-2xl shadow-xl overflow-hidden min-w-[230px] max-w-[260px]">
      {/* header */}
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <div className={cn(
            "w-5 h-5 rounded-md flex items-center justify-center shrink-0",
            op.mode === "follow" ? "bg-primary/10" : "bg-rose-500/10",
          )}>
            {op.mode === "follow"
              ? <UserPlus className="w-2.5 h-2.5 text-primary" />
              : <Scissors className="w-2.5 h-2.5 text-rose-500" />}
          </div>
          <span className="text-[11px] font-bold text-foreground truncate leading-tight">{op.label}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isRunning && (
            <button
              onClick={(e) => { e.stopPropagation(); onHide(); }}
              title="Hide pill (keeps running)"
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <EyeOff className="w-3 h-3" />
            </button>
          )}
          {(isDone || isCancelled) && (
            <button
              onClick={(e) => { e.stopPropagation(); onDismiss(); }}
              title="Dismiss"
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
          {isRunning && (
            <button
              onClick={(e) => { e.stopPropagation(); onCancel(); }}
              title="Cancel"
              className="p-1 rounded-lg text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* status line */}
      <div className="px-3 pb-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
          <span className="flex items-center gap-1">
            {isRunning && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {isDone && <CheckCircle2 className="w-2.5 h-2.5 text-emerald-500" />}
            {isCancelled && <XCircle className="w-2.5 h-2.5 text-rose-400" />}
            {op.waitMsg
              ? <span className="truncate max-w-[140px]">{op.waitMsg}</span>
              : isDone ? "Done"
              : isCancelled ? "Cancelled"
              : `${op.done} / ${op.total}`}
          </span>
          <span className={cn(
            "font-semibold tabular-nums",
            isDone ? "text-emerald-500" : isCancelled ? "text-rose-400" : ""
          )}>
            {pct}%
          </span>
        </div>

        {/* progress bar */}
        <div className="h-1 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-300",
              isDone ? "bg-emerald-500" : isCancelled ? "bg-rose-400" : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* error / skip counts */}
        {(op.errors > 0 || op.skipped > 0) && (
          <div className="flex items-center gap-2 mt-1">
            {op.errors > 0 && <span className="text-[10px] text-rose-400">{op.errors} err</span>}
            {op.skipped > 0 && <span className="text-[10px] text-muted-foreground">{op.skipped} skip</span>}
          </div>
        )}
      </div>
      <div className="h-2.5" />
    </div>
  );
}

export function BatchProgressPill() {
  const [, navigate] = useLocation();
  const { ops, cancelOp, clearOp, hideOp } = useBatchOperation();

  const visible = ops.filter(o => !o.hiddenFromStack);

  if (visible.length === 0) return null;

  return (
    <div className="fixed bottom-[5.5rem] md:bottom-6 right-3 md:right-5 z-40 flex flex-col gap-2 items-end pointer-events-none">
      {/* clickable link to Active tab */}
      <button
        onClick={() => navigate("/follow?tab=active")}
        className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-foreground/90 text-background text-[10px] font-semibold shadow-lg hover:bg-foreground transition-colors"
      >
        <ListChecks className="w-3 h-3" />
        View all active
      </button>
      {/* op cards */}
      <div className="pointer-events-auto flex flex-col gap-2 items-end">
        {visible.map(op => (
          <OpsCard
            key={op.id}
            op={op}
            onCancel={() => cancelOp(op.myFid, op.mode)}
            onDismiss={() => clearOp(op.myFid, op.mode)}
            onHide={() => hideOp(op.myFid, op.mode)}
          />
        ))}
      </div>
    </div>
  );
}
