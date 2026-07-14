// Purge panel — bulk delete casts/replies, unlike likes, un-recast recasts.
// Rendered as the third mode tab in FollowPage ("Purge"), matching native's
// CleanUpCastsScreen which is itself an inline GrowScreen mode (not a pushed
// screen). Four cards, each with a count input, a log-scale range slider, an
// optional @username filter, and a confirm + run flow backed by
// CleanupOpContext (persisted, resumable, cancellable — same guarantees as
// follow/unfollow batch ops).
import { useState, useRef, useCallback } from "react";
import {
  Trash2, MessageSquareOff, HeartOff, Repeat2, AlertTriangle, AtSign, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWallet } from "@/hooks/useWallet";
import { useCleanupOp } from "@/hooks/CleanupOpContext";
import { fetchRecentForCleanup, type CleanupKind } from "@/lib/cast-cleanup";
import { toast } from "sonner";

// ─── Slider helpers ────────────────────────────────────────────────────────────
// Log-scale so small counts (1–25) have fine control and large counts (up to
// 5000) are reachable in a single drag — preset chips felt arbitrary/limiting.

const MAX_COUNT = 5000;
const LOG_MIN = Math.log(1);
const LOG_MAX = Math.log(MAX_COUNT);

const clampCount = (n: number) => Math.min(MAX_COUNT, Math.max(1, Math.round(n)));
const valueToT   = (v: number) => (Math.log(clampCount(v)) - LOG_MIN) / (LOG_MAX - LOG_MIN);
const tToValue   = (t: number) => clampCount(Math.exp(LOG_MIN + Math.max(0, Math.min(1, t)) * (LOG_MAX - LOG_MIN)));

function CountSlider({
  value,
  onChange,
  accent,
  disabled,
}: {
  value: number;
  onChange: (n: number) => void;
  accent: string;
  disabled: boolean;
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
      className={cn("relative h-6 flex items-center cursor-pointer select-none", disabled && "opacity-40 pointer-events-none")}
      onMouseDown={e => {
        if (disabled) return;
        dragging.current = true;
        updateFromClientX(e.clientX);
        const onMove = (ev: MouseEvent) => { if (dragging.current) updateFromClientX(ev.clientX); };
        const onUp = () => { dragging.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
      }}
      onTouchStart={e => {
        if (disabled) return;
        updateFromClientX(e.touches[0].clientX);
        const onMove = (ev: TouchEvent) => updateFromClientX(ev.touches[0].clientX);
        const onEnd = () => { trackRef.current?.removeEventListener("touchmove", onMove); trackRef.current?.removeEventListener("touchend", onEnd); };
        trackRef.current?.addEventListener("touchmove", onMove, { passive: true });
        trackRef.current?.addEventListener("touchend", onEnd);
      }}
    >
      <div className="w-full h-[5px] rounded-full bg-muted overflow-visible relative">
        <div className="h-full rounded-full transition-none" style={{ width: `${t * 100}%`, backgroundColor: accent }} />
      </div>
      <div
        className="absolute w-5 h-5 rounded-full border-2 border-white shadow-md transition-none"
        style={{ left: `calc(${t * 100}% - 10px)`, backgroundColor: accent }}
      />
    </div>
  );
}

// ─── Card definition ───────────────────────────────────────────────────────────

type CardDef = {
  kind: CleanupKind;
  title: string;
  desc: string;
  Icon: typeof Trash2;
  verb: string;
  ingVerb: string;
};

const CARDS: CardDef[] = [
  { kind: "casts",    title: "Casts",    desc: "Permanently delete your most recent top-level casts.",  Icon: Trash2,          verb: "Delete",     ingVerb: "Deleting"     },
  { kind: "replies",  title: "Comments", desc: "Permanently delete your most recent replies.",           Icon: MessageSquareOff, verb: "Delete",     ingVerb: "Deleting"     },
  { kind: "unlike",   title: "Likes",    desc: "Remove your most recent likes.",                         Icon: HeartOff,         verb: "Unlike",     ingVerb: "Unliking"     },
  { kind: "unrecast", title: "Recasts",  desc: "Remove your most recent recasts.",                       Icon: Repeat2,          verb: "Un-recast",  ingVerb: "Un-recasting" },
];

// ─── Single card ───────────────────────────────────────────────────────────────

function CleanupCard({ card, accent }: { card: CardDef; accent: string }) {
  const { fid, localSigner, neynarKey, profile } = useWallet();
  const cleanupOp = useCleanupOp();
  const canWrite = Boolean(fid) && Boolean(localSigner);
  const myFid = fid ? Number(fid) : 0;
  const accountLabel = profile?.username ? `@${profile.username}` : myFid ? `FID ${myFid}` : "";

  const liveOp = cleanupOp.ops.find(
    o => o.myFid === myFid && o.kind === card.kind && o.phase === "running"
  ) ?? cleanupOp.ops.find(
    o => o.myFid === myFid && o.kind === card.kind
  );

  const [countText, setCountText] = useState("25");
  const count = clampCount(parseInt(countText, 10) || 1);
  const [targetUsername, setTargetUsername] = useState("");
  const [fetching, setFetching] = useState(false);
  const [loadedSoFar, setLoadedSoFar] = useState(0);

  const running = liveOp?.phase === "running";
  const busy = fetching || running;

  const setCount = useCallback((n: number) => {
    setCountText(String(clampCount(n)));
  }, []);

  async function run() {
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
      const scope = targetUsername ? ` involving @${targetUsername.replace(/^@/, "")}` : "";
      const confirmed = window.confirm(
        `${card.verb} ${items.length} ${card.title.toLowerCase()}${scope}?` +
        (card.kind === "casts" || card.kind === "replies" ? "\n\nThis can't be undone." : "")
      );
      if (!confirmed) return;
      cleanupOp.startOp({
        kind: card.kind,
        items,
        myFid,
        localSigner,
        accountLabel,
        label: targetUsername
          ? `${card.verb} ${card.title} · @${targetUsername.replace(/^@/, "")}`
          : `${card.verb} ${card.title}`,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : `Failed to ${card.verb.toLowerCase()}`);
    } finally {
      setFetching(false);
      setLoadedSoFar(0);
    }
  }

  const progressPct = liveOp && liveOp.total > 0
    ? Math.min(1, (liveOp.done + liveOp.skipped + liveOp.errors) / liveOp.total)
    : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3.5 shadow-[0_3px_8px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-[13px] flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}16` }}>
          <card.Icon className="w-5 h-5" style={{ color: accent }} strokeWidth={2.2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-extrabold text-foreground">{card.title}</p>
          <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">{card.desc}</p>
        </div>
      </div>

      {/* Count */}
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-muted-foreground">Last</span>
        <input
          type="text"
          inputMode="numeric"
          value={countText}
          onChange={e => setCountText(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
          onBlur={() => setCount(count)}
          disabled={busy}
          className="w-14 text-center text-[14px] font-bold text-foreground border border-border rounded-lg py-1.5 px-2 bg-muted/50 focus:outline-none focus:border-primary/40 disabled:opacity-50"
        />
        <span className="text-[13px] text-muted-foreground">{card.title.toLowerCase()}</span>
      </div>

      {/* Slider */}
      <CountSlider value={count} onChange={setCount} accent={accent} disabled={busy} />

      {/* Username filter */}
      <div className={cn(
        "flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-3 py-2",
        busy && "opacity-50"
      )}>
        <AtSign className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <input
          type="text"
          value={targetUsername}
          onChange={e => setTargetUsername(e.target.value)}
          placeholder="Only this username (optional)"
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
          className="flex-1 text-[12px] text-foreground placeholder:text-muted-foreground/50 bg-transparent focus:outline-none"
        />
      </div>

      {/* Action button */}
      <button
        onClick={run}
        disabled={!canWrite || busy}
        className={cn(
          "flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-bold text-white transition-opacity",
          !canWrite || busy ? "opacity-50 cursor-not-allowed" : "hover:opacity-90"
        )}
        style={{ backgroundColor: accent }}
      >
        {busy ? (
          fetching
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading{loadedSoFar > 0 ? ` ${loadedSoFar}…` : "…"}</>
            : <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
        ) : (
          <><card.Icon className="w-4 h-4" strokeWidth={2.4} /> {card.verb} last {count}</>
        )}
      </button>

      {/* Progress */}
      {running && liveOp ? (
        <div className="flex flex-col gap-2">
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${progressPct * 100}%`, backgroundColor: accent }} />
          </div>
          <p className="text-[12px] font-semibold text-muted-foreground">
            {card.ingVerb} {liveOp.done + liveOp.skipped + liveOp.errors} of {liveOp.total}
            {" "}· <span className="text-emerald-500">{liveOp.done} done</span>
            {liveOp.skipped > 0 && ` · ${liveOp.skipped} skipped`}
            {liveOp.errors > 0 && ` · `}
            {liveOp.errors > 0 && <span className="text-destructive">{liveOp.errors} failed</span>}
            {" "}· see Active tab
          </p>
        </div>
      ) : null}
    </div>
  );
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

export function CleanupCastsPanel() {
  const { fid } = useWallet();
  const accent = "hsl(var(--primary))";

  if (!fid) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground px-6 text-center">
        <Trash2 className="w-10 h-10 opacity-15" />
        <p className="text-sm font-semibold text-foreground">Sign in to use Purge</p>
        <p className="text-[12px]">Log in to delete casts, remove likes, or undo recasts in bulk.</p>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-0 pb-8 space-y-3">
      {/* Warning banner */}
      <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/[0.07] p-3">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
        <p className="text-[12px] text-amber-600 dark:text-amber-400 leading-[1.5]">
          Each card acts on your most recent activity of that type, newest first.
          Deletions can't be undone. Once started, a cleanup keeps running (and
          shows up in the Active tab) even if you leave this screen.
        </p>
      </div>

      {CARDS.map(card => (
        <CleanupCard key={card.kind} card={card} accent={accent} />
      ))}
    </div>
  );
}
