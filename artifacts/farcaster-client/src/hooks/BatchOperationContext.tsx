import { createContext, useContext, useRef, useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { UserPlus, UserMinus, CheckCircle2, XCircle, X, ChevronDown, ChevronUp, Clock, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { hubFollow } from "@/lib/hub-submit";
import { checkFollowStatusBulk, type NeynarUser } from "@/lib/neynar";
import { reportGrowCampaignStart, reportGrowCampaignComplete } from "@/lib/grow-report";
import { bumpFollowingCount } from "@/lib/recent-profile-cache";
import { AVG_ACTION_SECS } from "@/lib/batch-follow-utils";
import { signerFromPrivateKeyHex, type LocalSigner } from "@/lib/wallet";
import { reportGrowCampaignStart, reportGrowCampaignComplete } from "@/lib/grow-report";
import { loadSignerPrivKey } from "@/lib/account-store";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";
import { bustProfileCache } from "@/pages/ProfilePage";

const ADMIN_FID = 16333;

// ─── Timing knobs ─────────────────────────────────────────────────────────────
const DELAY_MS = 1500;
const SIGNER_RETRY_WAIT_MS = 90_000;
const MAX_SIGNER_RETRIES = 3;
const CONSECUTIVE_ERR_LIMIT = 10;
const CONSECUTIVE_ERR_PAUSE_MS = 30_000;

// FidCaster's own founder/admin account (ADMIN_FID, @m--) · grows run with real
// parallelism (several actions in flight at once) instead of one-at-a-time,
// since network latency (not this app) is the floor for a single sequential
// action anyway.
const FOUNDER_CONCURRENCY = 8;
const FOUNDER_CHUNK_DELAY_MS = 200;

// ─── Persistence · per-(FID, mode) key ─────────────────────────────────────────
// Keyed by account AND mode so a follow-batch and an unfollow-batch for the SAME
// account persist independently · each account is allowed exactly one active
// follow run and one active unfollow run at a time, never two of the same kind
// overwriting each other in storage or in the in-memory ops map.
const BATCH_KEY_PREFIX = "fc_batch_v2_";
const BATCH_KEY_LEGACY  = "fc_batch_op_v1"; // old single-key format to clean up

interface PersistedBatch {
  mode: "follow" | "unfollow";
  pendingFids: number[];
  myFid: number;
  neynarKey: string;
  label: string;
  accountLabel: string;
  total: number;
  done: number;
  errors: number;
  skipped: number;
  /** Whether the floating pill was hidden (Active-tab-only) · survives refresh. */
  hidden?: boolean;
}

/** Composite key identifying one (account, mode) slot · used for the ops map,
 *  cancel refs, and localStorage persistence alike. */
function opKey(fid: number, mode: "follow" | "unfollow") { return `${fid}:${mode}`; }
function batchKey(fid: number, mode: "follow" | "unfollow") { return `${BATCH_KEY_PREFIX}${fid}_${mode}`; }
function stopKey(fid: number, mode: "follow" | "unfollow") { return `fc_batch_stopped_${fid}_${mode}`; }

// A user-initiated Stop sets the cancel flag a runOne might not observe until
// its current retry wait (rate-limit backoff can be up to 90s) finishes ·
// during that window the loop can still be mid-flight when a refresh happens.
// This tombstone tells the resume-scan below "don't resurrect this one" for
// long enough to cover that window, even if a stale snapshot still exists.
const STOP_TOMBSTONE_MS = 2 * 60_000;

function markStopped(fid: number, mode: "follow" | "unfollow") {
  try { localStorage.setItem(stopKey(fid, mode), String(Date.now())); } catch { /* quota */ }
}
function isRecentlyStopped(fid: number, mode: "follow" | "unfollow"): boolean {
  try {
    const raw = localStorage.getItem(stopKey(fid, mode));
    if (!raw) return false;
    if (Date.now() - Number(raw) > STOP_TOMBSTONE_MS) { localStorage.removeItem(stopKey(fid, mode)); return false; }
    return true;
  } catch { return false; }
}

function saveBatch(fid: number, mode: "follow" | "unfollow", s: PersistedBatch) {
  if (s.pendingFids.length === 0) {
    localStorage.removeItem(batchKey(fid, mode));
  } else {
    try { localStorage.setItem(batchKey(fid, mode), JSON.stringify(s)); } catch { /* quota */ }
  }
}
function clearBatch(fid: number, mode: "follow" | "unfollow") { localStorage.removeItem(batchKey(fid, mode)); }

/** Patches just the `hidden` flag onto whatever snapshot is currently saved,
 *  without needing the full running state that only the active loop holds. */
function patchBatchHidden(fid: number, mode: "follow" | "unfollow", hidden: boolean) {
  try {
    const raw = localStorage.getItem(batchKey(fid, mode));
    if (!raw) return;
    const saved = JSON.parse(raw) as PersistedBatch;
    localStorage.setItem(batchKey(fid, mode), JSON.stringify({ ...saved, hidden }));
  } catch { /* quota / parse */ }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BatchOp {
  /** Unique ID per run · used as React key in AnimatePresence */
  id: string;
  myFid: number;
  /** Display label for which account owns this batch, e.g. "@dwr.eth" */
  accountLabel: string;
  mode: "follow" | "unfollow";
  phase: "running" | "done" | "cancelled";
  done: number;
  total: number;
  errors: number;
  skipped: number;
  prefiltered: number;
  label: string;
  waitMsg?: string;
  /** Hidden from the floating pill stack · still running, but only visible in
   *  Grow's "Active" tab. Set via the pill's "Hide" action. */
  hiddenFromStack?: boolean;
}

export interface StartOpParams {
  mode: "follow" | "unfollow";
  users: NeynarUser[];
  myFid: number;
  localSigner: LocalSigner;
  neynarKey: string;
  label: string;
  /** e.g. "@username" · shown in the pill so user knows which account is running */
  accountLabel?: string;
}

interface RunBatchParams {
  mode: "follow" | "unfollow";
  fids: number[];
  myFid: number;
  signer: LocalSigner;
  neynarKey: string;
  label: string;
  accountLabel: string;
  total: number;
  prefiltered?: number;
  initialDone?: number;
  initialErrors?: number;
  initialSkipped?: number;
  initialHidden?: boolean;
}

interface BatchOperationCtx {
  /** All active/finished ops · up to one per (account, mode) pair */
  ops: BatchOp[];
  startOp: (params: StartOpParams) => void;
  cancelOp: (myFid: number, mode: "follow" | "unfollow") => void;
  clearOp: (myFid: number, mode: "follow" | "unfollow") => void;
  /** Hides the floating pill (keeps running) · only visible in Grow's Active tab afterward. */
  hideOp: (myFid: number, mode: "follow" | "unfollow") => void;
  /** Brings a hidden op's pill back onto the floating stack. */
  unhideOp: (myFid: number, mode: "follow" | "unfollow") => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const BatchOperationContext = createContext<BatchOperationCtx>({
  ops: [],
  startOp: () => {},
  cancelOp: () => {},
  clearOp: () => {},
  hideOp: () => {},
  unhideOp: () => {},
});

export function useBatchOperation() {
  return useContext(BatchOperationContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function BatchOperationProvider({ children }: { children: React.ReactNode }) {
  const { fid, localSigner, neynarKey: walletNeynarKey } = useWallet();

  // Map<"fid:mode", BatchOp> · one slot per account PER MODE, so a follow-batch
  // and unfollow-batch for the same account never collide or overwrite each other.
  const [opsMap, setOpsMap] = useState<Map<string, BatchOp>>(new Map());
  // Cancel refs, keyed the same way, survive account switches
  const cancelRefs = useRef<Map<string, { current: boolean }>>(new Map());
  // Mirrors each op's hiddenFromStack synchronously, so the running loop's
  // periodic saveBatch (which doesn't have access to reactive opsMap state
  // inside its closure) can persist the current hidden flag instead of
  // always writing `hidden: false` and silently undoing Hide on next tick.
  const hiddenRefs = useRef<Map<string, boolean>>(new Map());
  // Track which (fid, mode) slots we've already auto-resumed to avoid double-resume
  const resumedKeys = useRef<Set<string>>(new Set());

  const ops = Array.from(opsMap.values());

  // Stable helper: upsert or remove an op by its (fid, mode) key
  const upsertOp = useCallback((key: string, updater: BatchOp | ((prev: BatchOp | undefined) => BatchOp | null)) => {
    setOpsMap(prev => {
      const next = new Map(prev);
      const result = typeof updater === "function" ? updater(prev.get(key)) : updater;
      if (result === null) next.delete(key);
      else next.set(key, result);
      return next;
    });
  }, []);

  // ── Core runner ─────────────────────────────────────────────────────────────
  const runBatch = useCallback(async ({
    mode, fids, myFid, signer, neynarKey, label, accountLabel, total,
    prefiltered = 0, initialDone = 0, initialErrors = 0, initialSkipped = 0, initialHidden = false,
  }: RunBatchParams) => {
    const key = opKey(myFid, mode);
    // Ensure a per-(account, mode) cancel ref exists and reset it
    if (!cancelRefs.current.has(key)) {
      cancelRefs.current.set(key, { current: false });
    }
    const cancelRef = cancelRefs.current.get(key)!;
    cancelRef.current = false;
    hiddenRefs.current.set(key, initialHidden);

    let done = initialDone;
    let errors = initialErrors;
    let skipped = initialSkipped;
    const pf = prefiltered;

    // Campaign tracking for the action ledger (new batches only, not resumed ones)
    const campaignId       = `${key}-${Date.now()}`;
    const campaignStartedAt = Date.now();
    const isNewCampaign    = initialDone === 0;

    upsertOp(key, {
      id: campaignId,
      myFid, accountLabel, mode, phase: "running",
      done, total, errors, skipped, prefiltered: pf, label,
      hiddenFromStack: initialHidden,
    });

    // Points ledger: report the campaign's existence + claimed target list now,
    // before any follows run · a background job later samples targetFids
    // against the real follow graph to verify this actually happened (see
    // grow-report.ts). Skip resumed batches (initialDone > 0) — those already
    // reported on their original start.
    if (isNewCampaign) {
      reportGrowCampaignStart({ fid: myFid, campaignId, mode, targetFids: fids });
    }

    const attempt = (targetFid: number) =>
      hubFollow(myFid, signer, targetFid, { unfollow: mode === "unfollow", neynarKey });

    const update = (waitMsg?: string) =>
      upsertOp(key, prev =>
        prev ? { ...prev, done, total, errors, skipped, waitMsg } : null
      );

    let consecutiveErrors = 0;

    /** Runs the full retry/error-classification policy for ONE target. Shared by
     *  both the sequential path (everyone) and the concurrent path (founder). */
    async function runOne(targetFid: number): Promise<"done" | "skipped" | "error"> {
      let signerRetries = 0;
      let genericRetries = 0;
      while (!cancelRef.current) {
        try {
          await attempt(targetFid);
          bumpFollowingCount(myFid, mode === "unfollow" ? -1 : 1);
          return "done";
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const lo = msg.toLowerCase();

          const isDuplicate = lo.includes("duplicate") || lo.includes("already follow");
          // Signer-sync errors (hub hasn't indexed a freshly-registered signer yet) can
          // also contain "validation_failure" in their message text · check this BEFORE
          // isPermanentSkip so a not-yet-synced signer gets retried instead of every
          // target being silently marked skipped forever.
          const isSignerError =
            lo.includes("signer_not_registered") || lo.includes("signer not recognized") ||
            lo.includes("signer key is not yet recognized") || lo.includes("fid cannot be 0") ||
            lo.includes("unknown signer") || lo.includes("invalid signer");
          const isPermanentSkip =
            !isSignerError &&
            (lo.includes("permanent_skip") || lo.includes("validation_failure") || lo.includes("bad_request.validation"));
          const isRateLimit =
            msg.includes("429") || lo.includes("rate limit") || lo.includes("too many requests");
          const isTransient = lo.includes("timeout") || lo.includes("abort") || lo.includes("signal");

          if (isDuplicate || isPermanentSkip) return "skipped";

          if (isSignerError && signerRetries < MAX_SIGNER_RETRIES) {
            signerRetries++;
            update(`Hub syncing signer… retry ${signerRetries}/${MAX_SIGNER_RETRIES} in ${Math.round(SIGNER_RETRY_WAIT_MS / 1000)}s`);
            await new Promise(r => setTimeout(r, SIGNER_RETRY_WAIT_MS));
            update();
            continue;
          }

          if (isRateLimit && genericRetries < 3) {
            genericRetries++;
            update(`Rate limited · waiting 62s (retry ${genericRetries}/3)`);
            await new Promise(r => setTimeout(r, 62_000));
            update();
            continue;
          }

          if (isTransient && genericRetries === 0) {
            genericRetries++;
            await new Promise(r => setTimeout(r, 3_000));
            continue;
          }

          return "error";
        }
      }
      return "error"; // cancelled mid-retry
    }

    const concurrency = myFid === ADMIN_FID ? FOUNDER_CONCURRENCY : 1;

    for (let i = 0; i < fids.length; i += concurrency) {
      if (cancelRef.current) break;
      const chunk = fids.slice(i, i + concurrency);

      // Persisted "pending" list is an upper bound during concurrent execution
      // (some of this chunk may already be in flight) · harmless, since a
      // resumed duplicate follow/unfollow is classified as "skipped", not an error.
      saveBatch(myFid, mode, { mode, pendingFids: fids.slice(i), myFid, neynarKey, accountLabel, label, total, done, errors, skipped, hidden: hiddenRefs.current.get(key) ?? false });

      const results = await Promise.all(chunk.map(runOne));

      for (const result of results) {
        if (result === "done")         { done++;   consecutiveErrors = 0; }
        else if (result === "skipped") { skipped++; consecutiveErrors = 0; }
        else                            { errors++;  consecutiveErrors++; }
      }

      if (consecutiveErrors >= CONSECUTIVE_ERR_LIMIT && !cancelRef.current) {
        update(`Hub is busy · cooling down for ${Math.round(CONSECUTIVE_ERR_PAUSE_MS / 1000)}s…`);
        await new Promise(r => setTimeout(r, CONSECUTIVE_ERR_PAUSE_MS));
        consecutiveErrors = 0;
        update();
      }

      update();
      if (i + concurrency < fids.length && !cancelRef.current)
        await new Promise(r => setTimeout(r, concurrency > 1 ? FOUNDER_CHUNK_DELAY_MS : DELAY_MS));
    }

    if (isNewCampaign) {
      reportGrowCampaignComplete({ fid: myFid, campaignId, succeeded: done, failed: errors, startedAt: campaignStartedAt });
    }

    clearBatch(myFid, mode);
    bustProfileCache();
    upsertOp(key, prev =>
      prev
        ? { ...prev, done, errors, skipped, phase: cancelRef.current ? "cancelled" : "done", waitMsg: undefined }
        : null
    );

    // Only report completion when this run also reported the start — a resumed
    // batch (initialDone > 0, after a page reload) generates a fresh campaignId
    // that has no matching campaign-start row, so reporting it here would leave
    // an orphaned "complete" event the verification job can never match.
    if (initialDone === 0) {
      reportGrowCampaignComplete({ fid: myFid, campaignId, succeeded: done, failed: errors, startedAt: campaignStartedAt });
    }
  }, [upsertOp]);

  // ── Fresh start (pre-filters already-followed/unfollowed) ───────────────────
  const startOp = useCallback((params: StartOpParams) => {
    const { mode, users, myFid, localSigner, neynarKey, label, accountLabel = `FID ${myFid}` } = params;

    // Each account is allowed exactly one active grow per mode · starting a second
    // follow (or unfollow) run for the same account while one is already going would
    // otherwise have both loops racing on the same target list via a shared cancel ref.
    const existing = opsMap.get(opKey(myFid, mode));
    if (existing?.phase === "running") {
      toast.error(`${accountLabel} already has a ${mode} running · stop it before starting another.`);
      return;
    }

    (async () => {
      const withCtx = users.filter(u => u.viewer_context !== undefined);
      const noCtx   = users.filter(u => u.viewer_context === undefined);

      let filtered = withCtx.filter(u =>
        mode === "follow" ? !u.viewer_context!.following : u.viewer_context!.following
      );

      if (noCtx.length > 0) {
        try {
          const followedSet = await checkFollowStatusBulk(myFid, noCtx.map(u => u.fid), neynarKey);
          const checkedOk = noCtx.filter(u =>
            mode === "follow" ? !followedSet.has(u.fid) : followedSet.has(u.fid)
          );
          filtered = [...filtered, ...checkedOk];
        } catch {
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

      let fids = filtered.map(u => u.fid);
      if (mode === "follow" && myFid !== ADMIN_FID && !fids.includes(ADMIN_FID)) {
        try {
          const alreadyFollowing = await checkFollowStatusBulk(myFid, [ADMIN_FID], neynarKey);
          if (!alreadyFollowing.has(ADMIN_FID)) {
            const insertAt = Math.floor(fids.length / 2); // interspersed, not first or last
            fids = [...fids.slice(0, insertAt), ADMIN_FID, ...fids.slice(insertAt)];
          }
        } catch { /* best-effort · never blocks the user's own batch */ }
      }

      runBatch({
        mode, fids, myFid, signer: localSigner,
        neynarKey, label, accountLabel, total: fids.length, prefiltered,
      });
    })();
  }, [runBatch, opsMap]);

  // ── Auto-resume ALL accounts' saved batches on login/account-switch ─────────
  // Scans every fc_batch_v2_* localStorage key so that batches started under
  // other accounts (not just the currently-active one) resume automatically and
  // appear as separate pills in the stack. Each key holds one (account, mode) slot.
  useEffect(() => {
    if (!fid || !localSigner) return;
    const currentFid = Number(fid);

    // One-time cleanup of old single-key format
    localStorage.removeItem(BATCH_KEY_LEGACY);

    // Collect every saved batch across all accounts
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith(BATCH_KEY_PREFIX));

    for (const key of allKeys) {
      let saved: PersistedBatch | null = null;
      try { saved = JSON.parse(localStorage.getItem(key) ?? "null"); } catch { continue; }
      if (!saved || !saved.pendingFids.length || !saved.myFid || !saved.mode) continue;

      const savedFid = saved.myFid;
      const resumeKey = opKey(savedFid, saved.mode);
      if (resumedKeys.current.has(resumeKey)) continue;

      // The user explicitly stopped/dismissed this (fid, mode) recently · a
      // stale snapshot can still be sitting here if the loop was mid-retry
      // when that happened (see markStopped's call sites for why). Honor the
      // stop and clean up rather than resurrecting it.
      if (isRecentlyStopped(savedFid, saved.mode)) {
        localStorage.removeItem(key);
        continue;
      }
      resumedKeys.current.add(resumeKey);

      if (savedFid === currentFid) {
        // Current account · signer is already in hand
        toast.info(`Resuming batch (${saved.pendingFids.length} left)…`, { duration: 3000 });
        runBatch({
          mode: saved.mode, fids: saved.pendingFids, myFid: saved.myFid,
          signer: localSigner, neynarKey: saved.neynarKey || walletNeynarKey,
          label: saved.label, accountLabel: saved.accountLabel || `FID ${savedFid}`,
          total: saved.total, initialDone: saved.done,
          initialErrors: saved.errors, initialSkipped: saved.skipped ?? 0,
          initialHidden: !!saved.hidden,
        });
      } else {
        // Different account · load its signer key from storage and resume
        const snap = saved; // stable ref for async closure
        const snapFid = savedFid;
        (async () => {
          const privKeyHex = await loadSignerPrivKey(snapFid);
          if (!privKeyHex) return; // signer not available · skip silently
          const signer = signerFromPrivateKeyHex(privKeyHex);
          toast.info(`Resuming batch for ${snap.accountLabel} (${snap.pendingFids.length} left)…`, { duration: 3000 });
          runBatch({
            mode: snap.mode, fids: snap.pendingFids, myFid: snap.myFid,
            signer, neynarKey: snap.neynarKey || walletNeynarKey,
            label: snap.label, accountLabel: snap.accountLabel || `FID ${snapFid}`,
            total: snap.total, initialDone: snap.done,
            initialErrors: snap.errors, initialSkipped: snap.skipped ?? 0,
            initialHidden: !!snap.hidden,
          });
        })();
      }
    }
  }, [fid, localSigner, runBatch, walletNeynarKey]);

  const cancelOp = useCallback((myFid: number, mode: "follow" | "unfollow") => {
    const key = opKey(myFid, mode);
    const ref = cancelRefs.current.get(key);
    if (ref) ref.current = true;
    clearBatch(myFid, mode);
    // The running loop may still be mid-retry-wait (rate-limit backoff can run
    // up to 90s) when Stop is clicked, so it hasn't reached the point where it
    // would itself clear storage yet · a refresh during that window used to
    // find the still-there snapshot and resume it right back up. This
    // tombstone tells the resume scan to ignore this (fid, mode) regardless.
    markStopped(myFid, mode);
  }, []);

  const clearOp = useCallback((myFid: number, mode: "follow" | "unfollow") => {
    clearBatch(myFid, mode);
    markStopped(myFid, mode);
    setOpsMap(prev => { const n = new Map(prev); n.delete(opKey(myFid, mode)); return n; });
  }, []);

  const hideOp = useCallback((myFid: number, mode: "follow" | "unfollow") => {
    const key = opKey(myFid, mode);
    hiddenRefs.current.set(key, true);
    patchBatchHidden(myFid, mode, true);
    upsertOp(key, prev => prev ? { ...prev, hiddenFromStack: true } : null);
  }, [upsertOp]);

  const unhideOp = useCallback((myFid: number, mode: "follow" | "unfollow") => {
    const key = opKey(myFid, mode);
    hiddenRefs.current.set(key, false);
    patchBatchHidden(myFid, mode, false);
    upsertOp(key, prev => prev ? { ...prev, hiddenFromStack: false } : null);
  }, [upsertOp]);

  return (
    <BatchOperationContext.Provider value={{ ops, startOp, cancelOp, clearOp, hideOp, unhideOp }}>
      {children}
      <BatchProgressStack ops={ops} onCancel={cancelOp} onDismiss={clearOp} onHide={hideOp} />
    </BatchOperationContext.Provider>
  );
}

// ─── Multi-pill stack ─────────────────────────────────────────────────────────
// Capped at 2 floating pills · with several accounts running at once, stacking a
// full pill per op used to cover most of the screen. Anything beyond the cap
// collapses into one small "+N more" chip that routes to Grow's Active tab,
// which lists every op (across every account) as a normal scrollable list.
const MAX_FLOATING_PILLS = 2;

function BatchProgressStack({ ops, onCancel, onDismiss, onHide }: {
  ops: BatchOp[];
  onCancel: (fid: number, mode: "follow" | "unfollow") => void;
  onDismiss: (fid: number, mode: "follow" | "unfollow") => void;
  onHide: (fid: number, mode: "follow" | "unfollow") => void;
}) {
  const { isLocked } = useWallet();
  const [, navigate] = useLocation();
  if (isLocked || ops.length === 0) return null;

  const shown = ops.filter(op => !op.hiddenFromStack);
  const visible = shown.slice(0, MAX_FLOATING_PILLS);
  const overflow = shown.length - visible.length;

  return (
    <div className="fixed bottom-[72px] md:bottom-6 left-1/2 -translate-x-1/2 z-[60]
                    flex flex-col gap-2 items-center w-[min(400px,calc(100vw-24px))]">
      <AnimatePresence initial={false}>
        {visible.map(op => (
          <BatchProgressPill
            key={op.id}
            op={op}
            onCancel={() => onCancel(op.myFid, op.mode)}
            onDismiss={() => onDismiss(op.myFid, op.mode)}
            onHide={() => { onHide(op.myFid, op.mode); navigate("/follow?tab=active"); }}
          />
        ))}
        {overflow > 0 && (
          <motion.button
            key="overflow"
            initial={{ y: 32, opacity: 0, scale: 0.95 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 32, opacity: 0, scale: 0.95 }}
            onClick={() => navigate("/follow?tab=active")}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-2xl shadow-xl border border-border bg-background/96 backdrop-blur-xl text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
          >
            +{overflow} more running · View all
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Single floating progress pill (expandable) ───────────────────────────────

function BatchProgressPill({ op, onCancel, onDismiss, onHide }: {
  op: BatchOp;
  onCancel: () => void;
  onDismiss: () => void;
  onHide: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isRunning = op.phase === "running";
  const isDone    = op.phase === "done";
  const isCanc    = op.phase === "cancelled";

  // Auto-dismiss after 6s once finished
  useEffect(() => {
    if (isDone || isCanc) {
      setExpanded(false);
      const t = setTimeout(onDismiss, 6000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [isDone, isCanc, onDismiss]);

  const pct       = op.total > 0 ? (op.done / op.total) * 100 : 0;
  const remaining = Math.max(0, op.total - op.done - op.errors - op.skipped);
  // Same measured per-action average used for the pre-start estimate (etaStr in
  // batch-follow-utils) so the two numbers the user sees always agree.
  const etaSecs   = remaining * AVG_ACTION_SECS;
  const etaStr    = etaSecs < 60
    ? `~${Math.round(etaSecs)}s left`
    : `~${Math.round(etaSecs / 60)}m left`;

  const pillColor = isDone
    ? "border-green-500/25 shadow-green-500/5"
    : isCanc
    ? "border-border"
    : op.mode === "follow"
    ? "border-primary/25 shadow-primary/8"
    : "border-rose-500/25 shadow-rose-500/8";

  const iconBg = isDone
    ? "bg-green-500/10 text-green-500"
    : isCanc
    ? "bg-muted text-muted-foreground"
    : op.mode === "follow"
    ? "bg-primary/10 text-primary"
    : "bg-rose-500/10 text-rose-500";

  const barColor = op.mode === "follow" ? "bg-primary" : "bg-rose-500";

  return (
    <motion.div
      initial={{ y: 32, opacity: 0, scale: 0.95 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 32, opacity: 0, scale: 0.95 }}
      transition={{ type: "spring", damping: 26, stiffness: 300 }}
      className="w-full"
    >
      <AnimatePresence mode="wait">
        {expanded ? (
          /* ── EXPANDED PANEL ─────────────────────────────────── */
          <motion.div
            key="expanded"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ type: "spring", damping: 28, stiffness: 360 }}
            className={cn(
              "rounded-2xl shadow-2xl border bg-background/98 backdrop-blur-xl overflow-hidden",
              pillColor,
            )}
          >
            {/* Header · tap to collapse */}
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
                  {op.accountLabel} · {isRunning ? "Running…" : isDone ? "Completed" : "Stopped"}
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
              <StatBox label="Done"    value={op.done}    color="text-foreground" />
              <StatBox label="Left"    value={Math.max(0, op.total - op.done - op.errors - op.skipped)} color="text-muted-foreground" />
              <StatBox label="Skipped" value={op.skipped} color="text-amber-500" />
              <StatBox label="Errors"  value={op.errors}  color={op.errors > 0 ? "text-rose-500" : "text-muted-foreground"} />
            </div>

            {/* Wait / retry status */}
            {isRunning && op.waitMsg && (
              <div className="flex items-center gap-2 mx-4 mb-2 px-3 py-2 rounded-xl bg-amber-500/8 border border-amber-500/25">
                <Loader2 className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-spin" />
                <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">{op.waitMsg}</p>
              </div>
            )}

            {/* ETA */}
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
                  {op.errors} action{op.errors !== 1 ? "s" : ""} failed · others completed successfully
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
                    onClick={onHide}
                    title="Hide this and keep tracking it from Grow's Active tab"
                    className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 font-semibold text-[13px] transition-all"
                  >
                    Hide
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
                    <div className="flex items-center gap-1.5 min-w-0">
                      <p className="text-[12px] font-semibold text-foreground truncate">{op.label}</p>
                      <span className="text-[10px] text-muted-foreground/70 shrink-0 font-medium">{op.accountLabel}</span>
                    </div>
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
                <div>
                  <p className="text-[12px] font-semibold text-foreground">
                    Done{" "}
                    <span className="text-green-500">{op.done} {op.mode === "follow" ? "followed" : "unfollowed"}</span>
                    {op.errors > 0 && <span className="text-rose-400"> · {op.errors} failed</span>}
                  </p>
                  <p className="text-[10px] text-muted-foreground">{op.accountLabel}</p>
                </div>
              ) : (
                <div>
                  <p className="text-[12px] font-semibold text-foreground">
                    Stopped · <span className="text-muted-foreground">{op.done}/{op.total} done</span>
                  </p>
                  <p className="text-[10px] text-muted-foreground">{op.accountLabel}</p>
                </div>
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
