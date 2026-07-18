// Purge panel - bulk delete casts/replies, unlike likes, un-recast recasts.
import { useState, useRef, useCallback } from "react";
import {
  Trash2, MessageSquareOff, HeartOff, Repeat2, AtSign, Loader2,
  AlertTriangle, Check, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { useCleanupOp } from "@/hooks/CleanupOpContext";
import { fetchRecentForCleanup, type CleanupKind } from "@/lib/cast-cleanup";
import { toast } from "sonner";

// ─── Slider helpers ────────────────────────────────────────────────────────────
const MAX_COUNT = 5000;
const LOG_MIN = Math.log(1);
const LOG_MAX = Math.log(MAX_COUNT);
const clampCount = (n: number) => Math.min(MAX_COUNT, Math.max(1, Math.round(n)));
const valueToT   = (v: number) => (Math.log(clampCount(v)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
const tToValue   = (t: number) => clampCount(Math.exp(LOG_MIN + Math.max(0, Math.min(1, t)) * (LOG_MAX - LOG_MIN)));

function CountSlider({ value, onChange, accent, disabled }: {
  value: number; onChange: (n: number) => void; accent: string; disabled: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const t = valueToT(value);
  function updateFromClientX(clientX: number) {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(tToValue(frac));
  }
  return (
    <div
      ref={trackRef}
      className={cn("relative h-7 flex items-center cursor-pointer select-none", disabled && "opacity-40 pointer-events-none")}
      onMouseDown={e => {
        dragging.current = true; updateFromClientX(e.clientX);
        const onMove = (ev: MouseEvent) => { if (dragging.current) updateFromClientX(ev.clientX); };
        const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove); window.addEventListener("mouseup", onUp);
      }}
      onTouchStart={e => {
        updateFromClientX(e.touches[0].clientX);
        const onMove = (ev: TouchEvent) => updateFromClientX(ev.touches[0].clientX);
        const onEnd = () => { trackRef.current?.removeEventListener("touchmove", onMove); trackRef.current?.removeEventListener("touchend", onEnd); };
        trackRef.current?.addEventListener("touchmove", onMove, { passive: true });
        trackRef.current?.addEventListener("touchend", onEnd);
      }}
    >
      <div className="w-full h-[4px] rounded-full bg-muted overflow-visible relative">
        <div className="h-full rounded-full transition-none" style={{ width: `${t * 100}%`, backgroundColor: accent }} />
      </div>
      <div
        className="absolute w-[18px] h-[18px] rounded-full border-2 border-white shadow-md transition-none"
        style={{ left: `calc(${t * 100}% - 9px)`, backgroundColor: accent }}
      />
    </div>
  );
}

// ─── Card definitions ──────────────────────────────────────────────────────────
type CardDef = {
  kind: CleanupKind; title: string; desc: string;
  Icon: typeof Trash2; verb: string; ingVerb: string;
  accent: string; destructive: boolean;
};

const CARDS: CardDef[] = [
  { kind: "casts",    title: "Casts",    desc: "Permanently delete your top-level posts.",   Icon: Trash2,          verb: "Delete",    ingVerb: "Deleting",      accent: "#ef4444", destructive: true  },
  { kind: "replies",  title: "Comments", desc: "Permanently delete your recent replies.",     Icon: MessageSquareOff,verb: "Delete",    ingVerb: "Deleting",      accent: "#f97316", destructive: true  },
  { kind: "unlike",   title: "Likes",    desc: "Remove your most recent likes.",              Icon: HeartOff,        verb: "Unlike",    ingVerb: "Unliking",      accent: "#ec4899", destructive: false },
  { kind: "unrecast", title: "Recasts",  desc: "Undo your most recent recasts.",              Icon: Repeat2,         verb: "Un-recast", ingVerb: "Un-recasting",  accent: "#8b5cf6", destructive: false },
];

// ─── Single card ───────────────────────────────────────────────────────────────
function CleanupCard({ card }: { card: CardDef }) {
  const { fid, localSigner, neynarKey, profile } = useWallet();
  const cleanupOp = useCleanupOp();
  const canWrite = Boolean(fid) && Boolean(localSigner);
  const myFid = fid ? Number(fid) : 0;
  const accountLabel = profile?.username ? `@${profile.username}` : myFid ? `FID ${myFid}` : "";
  const { accent, destructive } = card;

  const liveOp = cleanupOp.ops.find(o => o.myFid === myFid && o.kind === card.kind && o.phase === "running")
    ?? cleanupOp.ops.find(o => o.myFid === myFid && o.kind === card.kind);

  const [countText, setCountText] = useState("25");
  const count = clampCount(parseInt(countText, 10) || 1);
  const [targetUsername, setTargetUsername] = useState("");
  const [fetching, setFetching] = useState(false);
  const [loadedSoFar, setLoadedSoFar] = useState(0);
  const [confirming, setConfirming] = useState<{ items: unknown[] } | null>(null);

  const running = liveOp?.phase === "running";
  const done = liveOp?.phase === "done";
  const busy = fetching || running;

  const setCount = useCallback((n: number) => { setCountText(String(clampCount(n))); }, []);

  async function handleRun() {
    if (!canWrite || busy || !fid || !localSigner) return;
    setFetching(true);
    setLoadedSoFar(0);
    try {
      const items = await fetchRecentForCleanup(
        myFid, card.kind, count, neynarKey ?? "",
        loaded => setLoadedSoFar(loaded),
        targetUsername || undefined,
      );
      if (items.length === 0) {
        const scope = targetUsername ? ` involving @${targetUsername.replace(/^@/, "")}` : "";
        toast.error(`Nothing to ${card.verb.toLowerCase()}${scope}`);
        return;
      }
      if (destructive) {
        setConfirming({ items });
      } else {
        runOp(items);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${card.verb.toLowerCase()}`);
    } finally {
      setFetching(false);
      setLoadedSoFar(0);
    }
  }

  function runOp(items: unknown[]) {
    if (!fid || !localSigner) return;
    const scope = targetUsername ? ` involving @${targetUsername.replace(/^@/, "")}` : "";
    cleanupOp.startOp({
      kind: card.kind,
      items: items as Parameters<typeof cleanupOp.startOp>[0]["items"],
      myFid,
      localSigner,
      accountLabel,
      label: targetUsername
        ? `${card.verb} ${card.title} · @${targetUsername.replace(/^@/, "")}`
        : `${card.verb} ${card.title}${scope}`,
    });
    setConfirming(null);
  }

  const progressPct = liveOp && liveOp.total > 0
    ? Math.min(1, (liveOp.done + liveOp.skipped + liveOp.errors) / liveOp.total)
    : 0;

  return (
    <div
      className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm"
      style={{ borderTop: `3px solid ${accent}` }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
          style={{ backgroundColor: `${accent}18` }}
        >
          <card.Icon className="w-[18px] h-[18px]" style={{ color: accent }} strokeWidth={2.3} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[14px] font-extrabold text-foreground tracking-tight">{card.title}</p>
          <p className="text-[11.5px] text-muted-foreground leading-snug mt-0.5">{card.desc}</p>
        </div>
        {done && (
          <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-500/10 flex items-center justify-center">
            <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={2.5} />
          </div>
        )}
      </div>

      {/* Inline confirm overlay */}
      {confirming && (
        <div className="mx-4 mb-4 rounded-xl border border-destructive/20 bg-destructive/[0.06] p-3.5 space-y-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-[13px] font-bold text-foreground">
                {card.verb} {confirming.items.length} {card.title.toLowerCase()}?
              </p>
              <p className="text-[11px] text-muted-foreground mt-0.5">This can't be undone.</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming(null)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-[12px] font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Cancel
            </button>
            <button
              onClick={() => runOp(confirming.items)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-bold text-white transition-colors hover:opacity-90"
              style={{ backgroundColor: "#ef4444" }}
            >
              <Trash2 className="w-3.5 h-3.5" /> Confirm
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      {!confirming && (
        <div className="px-4 pb-4 space-y-3">
          {/* Count row */}
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground shrink-0">Last</span>
            <input
              type="text"
              inputMode="numeric"
              value={countText}
              onChange={e => setCountText(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
              onBlur={() => setCount(count)}
              disabled={busy}
              className="w-14 text-center text-[14px] font-bold text-foreground border border-border rounded-lg py-1 px-2 bg-muted/40 focus:outline-none focus:border-primary/40 disabled:opacity-50"
            />
            <span className="text-[12px] text-muted-foreground shrink-0">{card.title.toLowerCase()}</span>
          </div>

          {/* Slider */}
          <CountSlider value={count} onChange={setCount} accent={accent} disabled={busy} />

          {/* Username filter */}
          <div className={cn(
            "flex items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2",
            busy && "opacity-50 pointer-events-none"
          )}>
            <AtSign className="w-3 h-3 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={targetUsername}
              onChange={e => setTargetUsername(e.target.value)}
              placeholder="Filter by username (optional)"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={busy}
              className="flex-1 text-[12px] text-foreground placeholder:text-muted-foreground/40 bg-transparent focus:outline-none"
            />
            {targetUsername && (
              <button onClick={() => setTargetUsername("")} className="text-muted-foreground hover:text-foreground">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Progress bar (while running) */}
          {running && liveOp && (
            <div className="space-y-1.5">
              <div className="h-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressPct * 100}%`, backgroundColor: accent }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {card.ingVerb} {liveOp.done + liveOp.skipped + liveOp.errors} of {liveOp.total}
                {" · "}<span className="text-emerald-500 font-semibold">{liveOp.done} done</span>
                {liveOp.errors > 0 && <span className="text-destructive"> · {liveOp.errors} failed</span>}
              </p>
            </div>
          )}

          {/* Action button */}
          {!running && (
            <button
              onClick={handleRun}
              disabled={!canWrite || busy}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-bold text-white transition-all hover:opacity-90 active:scale-[0.98]",
                (!canWrite || busy) && "opacity-50 cursor-not-allowed"
              )}
              style={{ backgroundColor: accent }}
            >
              {fetching ? (
                <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading{loadedSoFar > 0 ? ` ${loadedSoFar}…` : "…"}</>
              ) : (
                <><card.Icon className="w-3.5 h-3.5" strokeWidth={2.5} /> {card.verb} last {count}</>
              )}
            </button>
          )}
          {running && (
            <button
              onClick={() => cleanupOp.cancelOp(myFid, card.kind)}
              className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-[13px] font-semibold text-muted-foreground border border-border hover:text-foreground hover:border-foreground/30 transition-all"
            >
              <X className="w-3.5 h-3.5" /> Stop
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Panel ─────────────────────────────────────────────────────────────────────
export function CleanupCastsPanel() {
  const { fid } = useWallet();

  if (!fid) {
    return (
      <div className="flex flex-col items-center gap-3 py-20 text-muted-foreground px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center">
          <Trash2 className="w-7 h-7 opacity-30" />
        </div>
        <p className="text-sm font-bold text-foreground">Sign in to use Purge</p>
        <p className="text-[12px] max-w-[220px] leading-relaxed">Log in to delete casts, remove likes, or undo recasts in bulk.</p>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-0 pb-8 space-y-3">
      {/* Warning */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3.5 py-3">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-[1px]" />
        <p className="text-[11.5px] text-amber-700 dark:text-amber-400 leading-[1.55]">
          Actions run newest-first. Deletions are permanent. Progress continues in the Active tab even after leaving.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {CARDS.map(card => (
          <CleanupCard key={card.kind} card={card} />
        ))}
      </div>
    </div>
  );
}
