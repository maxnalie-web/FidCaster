// Persisted, resumable, cancelable bulk cast-cleanup operations (delete
// casts/replies, unlike, un-recast). Modelled after BatchOperationContext but
// kept separate: that context's types/persistence are hard-typed to follow/
// unfollow against the follow graph; generalising it in place would have
// threaded follow-graph-specific state through cast-shaped data.
//
// Runs with real concurrency (5 lanes in parallel, not sequential like
// follow/unfollow) — deleting/un-reacting your own content doesn't carry
// the "look like a follow-spam bot" risk profile, and the whole point of
// this tool is clearing large volumes quickly.
//
// Uses localStorage for persistence (same pattern as BatchOperationContext)
// so a mid-run cleanup survives a page refresh and resumes on next load.
import { createContext, useContext, useRef, useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { hubDeleteCast, hubReact } from "@/lib/hub-submit";
import { useWallet } from "@/hooks/useWallet";
import { signerFromPrivateKeyHex, type LocalSigner } from "@/lib/wallet";
import { loadSignerPrivKey } from "@/lib/account-store";
import type { NeynarCast } from "@/lib/neynar";
import type { CleanupKind } from "@/lib/cast-cleanup";

// ─── Persistence ──────────────────────────────────────────────────────────────
const CLEANUP_KEY_PREFIX = "fc_cleanup_v1_";
const STOP_TOMBSTONE_MS = 2 * 60_000;
const CONCURRENCY = 5;

interface PersistedCleanupItem {
  hash: string;
  authorFid: number;
  likesCount?: number;
  recastsCount?: number;
}

interface PersistedCleanup {
  kind: CleanupKind;
  pending: PersistedCleanupItem[];
  myFid: number;
  accountLabel: string;
  label: string;
  total: number;
  done: number;
  skipped: number;
  errors: number;
  hidden?: boolean;
}

function opKey(fid: number, kind: CleanupKind) { return `${fid}:${kind}`; }
function cleanupKey(fid: number, kind: CleanupKind) { return `${CLEANUP_KEY_PREFIX}${fid}_${kind}`; }
function stopKey(fid: number, kind: CleanupKind) { return `fc_cleanup_stopped_${fid}_${kind}`; }

function markStopped(fid: number, kind: CleanupKind) {
  try { localStorage.setItem(stopKey(fid, kind), String(Date.now())); } catch { /* quota */ }
}
function isRecentlyStopped(fid: number, kind: CleanupKind): boolean {
  try {
    const raw = localStorage.getItem(stopKey(fid, kind));
    if (!raw) return false;
    if (Date.now() - Number(raw) > STOP_TOMBSTONE_MS) { localStorage.removeItem(stopKey(fid, kind)); return false; }
    return true;
  } catch { return false; }
}
function saveCleanup(fid: number, kind: CleanupKind, s: PersistedCleanup) {
  if (s.pending.length === 0) {
    localStorage.removeItem(cleanupKey(fid, kind));
  } else {
    try { localStorage.setItem(cleanupKey(fid, kind), JSON.stringify(s)); } catch { /* quota */ }
  }
}
function clearCleanup(fid: number, kind: CleanupKind) { localStorage.removeItem(cleanupKey(fid, kind)); }

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CleanupOp {
  id: string;
  myFid: number;
  accountLabel: string;
  kind: CleanupKind;
  phase: "running" | "done" | "cancelled";
  done: number;
  total: number;
  skipped: number;
  errors: number;
  label: string;
  waitMsg?: string;
  hiddenFromStack?: boolean;
}

export interface StartCleanupParams {
  kind: CleanupKind;
  items: NeynarCast[];
  myFid: number;
  localSigner: LocalSigner;
  accountLabel: string;
  label: string;
}

interface RunCleanupParams {
  kind: CleanupKind;
  items: PersistedCleanupItem[];
  myFid: number;
  signer: LocalSigner;
  accountLabel: string;
  label: string;
  total: number;
  initialDone?: number;
  initialSkipped?: number;
  initialErrors?: number;
  initialHidden?: boolean;
}

interface CleanupOpCtx {
  ops: CleanupOp[];
  startOp: (params: StartCleanupParams) => void;
  cancelOp: (myFid: number, kind: CleanupKind) => void;
  clearOp: (myFid: number, kind: CleanupKind) => void;
  hideOp: (myFid: number, kind: CleanupKind) => void;
  unhideOp: (myFid: number, kind: CleanupKind) => void;
}

const CleanupOpContext = createContext<CleanupOpCtx>({
  ops: [],
  startOp: () => {},
  cancelOp: () => {},
  clearOp: () => {},
  hideOp: () => {},
  unhideOp: () => {},
});

export function useCleanupOp() {
  return useContext(CleanupOpContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CleanupOpProvider({ children }: { children: React.ReactNode }) {
  const { fid, localSigner } = useWallet();
  const [ops, setOps] = useState<CleanupOp[]>([]);
  const cancelRefs = useRef<Map<string, { current: boolean }>>(new Map());
  const hiddenRefs = useRef<Map<string, boolean>>(new Map());
  const resumedKeys = useRef<Set<string>>(new Set());

  function upsertOp(key: string, updater: CleanupOp | ((prev: CleanupOp | undefined) => CleanupOp | null)) {
    setOps(prev => {
      const existing = prev.find(o => o.id.startsWith(key + "-") || o.id === key);
      const result = typeof updater === "function" ? updater(existing) : updater;
      if (result === null) return prev.filter(o => !(o.id.startsWith(key + "-") || o.id === key));
      const idx = prev.findIndex(o => o.id.startsWith(key + "-") || o.id === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result;
        return next;
      }
      return [result, ...prev];
    });
  }

  const runCleanup = useCallback(async ({
    kind,
    items,
    myFid,
    signer,
    accountLabel,
    label,
    total,
    initialDone = 0,
    initialSkipped = 0,
    initialErrors = 0,
    initialHidden = false,
  }: RunCleanupParams) => {
    const key = opKey(myFid, kind);
    const opId = `${key}-${Date.now()}`;

    if (!cancelRefs.current.has(key)) cancelRefs.current.set(key, { current: false });
    const cancelRef = cancelRefs.current.get(key)!;
    cancelRef.current = false;
    hiddenRefs.current.set(key, initialHidden);

    let done = initialDone;
    let skipped = initialSkipped;
    let errors = initialErrors;
    let pending = [...items];

    setOps(prev => {
      const filtered = prev.filter(o => !o.id.startsWith(key + "-"));
      return [{
        id: opId,
        myFid,
        accountLabel,
        kind,
        phase: "running" as const,
        done,
        total,
        skipped,
        errors,
        label,
        hiddenFromStack: initialHidden,
      }, ...filtered];
    });

    const persist = () =>
      saveCleanup(myFid, kind, { kind, pending, myFid, accountLabel, label, total, done, skipped, errors, hidden: hiddenRefs.current.get(key) ?? false });

    const update = (waitMsg?: string) =>
      setOps(prev => prev.map(o => o.id === opId ? { ...o, done, total, skipped, errors, waitMsg } : o));

    async function attempt(item: PersistedCleanupItem): Promise<void> {
      if (kind === "casts" || kind === "replies") {
        await hubDeleteCast(myFid, signer, item.hash);
      } else if (kind === "unlike") {
        await hubReact(myFid, signer, item.hash, item.authorFid, "like", { remove: true });
      } else {
        await hubReact(myFid, signer, item.hash, item.authorFid, "recast", { remove: true });
      }
    }

    async function runOne(item: PersistedCleanupItem): Promise<"done" | "skipped" | "error"> {
      let retries = 0;
      while (!cancelRef.current) {
        try {
          await attempt(item);
          return "done";
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          const lo = msg.toLowerCase();
          const isAlreadyGone = lo.includes("not found") || lo.includes("unknown cast") || lo.includes("duplicate");
          const isRateLimit = msg.includes("429") || lo.includes("rate limit") || lo.includes("too many requests");
          const isTransient = lo.includes("timeout") || lo.includes("abort") || lo.includes("signal");
          if (isAlreadyGone) return "skipped";
          if (isRateLimit && retries < 3) {
            retries++;
            update("Rate limited — waiting 15s…");
            await new Promise<void>(r => setTimeout(r, 15_000));
            continue;
          }
          if (isTransient && retries < 2) {
            retries++;
            await new Promise<void>(r => setTimeout(r, 2_000));
            continue;
          }
          return "error";
        }
      }
      return "error";
    }

    let cursor = 0;
    async function lane(): Promise<void> {
      while (cursor < items.length) {
        if (cancelRef.current) return;
        const item = items[cursor++];
        const result = await runOne(item);
        if (result === "done") {
          done++;
        } else if (result === "skipped") {
          skipped++;
        } else {
          errors++;
        }
        pending = pending.filter(p => p.hash !== item.hash);
        persist();
        update();
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, lane));

    clearCleanup(myFid, kind);
    setOps(prev => prev.map(o =>
      o.id === opId
        ? { ...o, done, skipped, errors, phase: cancelRef.current ? "cancelled" : "done", waitMsg: undefined }
        : o
    ));
  }, []);

  const startOp = useCallback((params: StartCleanupParams) => {
    const { kind, items, myFid, localSigner: signer, accountLabel, label } = params;
    const existing = ops.find(o => o.id.startsWith(opKey(myFid, kind) + "-") && o.phase === "running");
    if (existing) {
      toast.error(`${accountLabel} already has a "${label}" cleanup running.`);
      return;
    }
    const pendingItems: PersistedCleanupItem[] = items.map(c => ({
      hash: c.hash,
      authorFid: c.author.fid,
      likesCount: c.reactions?.likes_count,
      recastsCount: c.reactions?.recasts_count,
    }));
    runCleanup({ kind, items: pendingItems, myFid, signer, accountLabel, label, total: pendingItems.length });
  }, [ops, runCleanup]);

  const cancelOp = useCallback((myFid: number, kind: CleanupKind) => {
    const key = opKey(myFid, kind);
    const ref = cancelRefs.current.get(key);
    if (ref) ref.current = true;
    clearCleanup(myFid, kind);
    markStopped(myFid, kind);
  }, []);

  const clearOp = useCallback((myFid: number, kind: CleanupKind) => {
    const key = opKey(myFid, kind);
    clearCleanup(myFid, kind);
    markStopped(myFid, kind);
    setOps(prev => prev.filter(o => !o.id.startsWith(key + "-")));
  }, []);

  const hideOp = useCallback((myFid: number, kind: CleanupKind) => {
    const key = opKey(myFid, kind);
    hiddenRefs.current.set(key, true);
    try {
      const raw = localStorage.getItem(cleanupKey(myFid, kind));
      if (raw) {
        const saved = JSON.parse(raw) as PersistedCleanup;
        localStorage.setItem(cleanupKey(myFid, kind), JSON.stringify({ ...saved, hidden: true }));
      }
    } catch { /* quota/parse */ }
    setOps(prev => prev.map(o => o.id.startsWith(key + "-") ? { ...o, hiddenFromStack: true } : o));
  }, []);

  const unhideOp = useCallback((myFid: number, kind: CleanupKind) => {
    const key = opKey(myFid, kind);
    hiddenRefs.current.set(key, false);
    try {
      const raw = localStorage.getItem(cleanupKey(myFid, kind));
      if (raw) {
        const saved = JSON.parse(raw) as PersistedCleanup;
        localStorage.setItem(cleanupKey(myFid, kind), JSON.stringify({ ...saved, hidden: false }));
      }
    } catch { /* quota/parse */ }
    setOps(prev => prev.map(o => o.id.startsWith(key + "-") ? { ...o, hiddenFromStack: false } : o));
  }, []);

  // Resume any in-progress cleanup ops on mount / account change
  useEffect(() => {
    if (!fid || !localSigner) return;
    const kinds: CleanupKind[] = ["casts", "replies", "unlike", "unrecast"];
    for (const kind of kinds) {
      const resumeKey = opKey(fid, kind);
      if (resumedKeys.current.has(resumeKey)) continue;
      try {
        const raw = localStorage.getItem(cleanupKey(fid, kind));
        if (!raw) continue;
        const saved = JSON.parse(raw) as PersistedCleanup;
        if (!saved.pending.length) continue;
        if (isRecentlyStopped(fid, kind)) { clearCleanup(fid, kind); continue; }
        resumedKeys.current.add(resumeKey);
        toast.info(`Resuming "${saved.label}" (${saved.pending.length} left)…`);
        runCleanup({
          kind: saved.kind,
          items: saved.pending,
          myFid: saved.myFid,
          signer: localSigner,
          accountLabel: saved.accountLabel,
          label: saved.label,
          total: saved.total,
          initialDone: saved.done,
          initialSkipped: saved.skipped ?? 0,
          initialErrors: saved.errors,
          initialHidden: !!saved.hidden,
        });
      } catch { /* parse error */ }
    }
  }, [fid, localSigner, runCleanup]);

  return (
    <CleanupOpContext.Provider value={{ ops, startOp, cancelOp, clearOp, hideOp, unhideOp }}>
      {children}
    </CleanupOpContext.Provider>
  );
}
