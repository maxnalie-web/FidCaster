import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Search, UserPlus, UserMinus, Users, Loader2,
  X, ChevronDown, CheckSquare, Square,
  Heart, Ban, Check, AlertCircle, Scissors, ChevronRight,
  ListChecks, XCircle, Clock, Eye, Award, Sparkles,
} from "lucide-react";
import { cn, formatCompactCount } from "@/lib/utils";
import {
  searchUsers, getUserByFid, getFollowers, getFollowing, getFollowListFids,
  neynarScore, type NeynarUser,
} from "@/lib/neynar";
import { NeynarScoreBadge, NeynarLogo } from "@/components/NeynarScoreBadge";
import { ProBadge, useProStatus } from "@/components/ProBadge";
import { hydrateProfiles, useHydratedUser } from "@/lib/profile-hydrate";
import { getCachedFollowList, setCachedFollowList } from "@/lib/farcaster-db";
import { getSpamLabelsFor, type SpamLabelFilter } from "@/lib/spam-labels";
import { useWallet } from "@/hooks/useWallet";
import { useBatchOperation } from "@/hooks/BatchOperationContext";
import { BottomNav } from "@/components/BottomNav";
import { toast } from "sonner";
import type { BatchFilters, SortOrder, Preset } from "@/lib/batch-follow-utils";
import {
  DEFAULT_FILTERS, FOLLOW_PRESETS, UNFOLLOW_PRESETS, SORT_OPTIONS,
  LIMIT_PRESETS, MAX_SCAN, parseExclusions, applyFilters, smartScore, etaStr, AVG_ACTION_SECS,
} from "@/lib/batch-follow-utils";
import type { BatchOp } from "@/hooks/BatchOperationContext";

// ─── Mode ──────────────────────────────────────────────────────────────────────
// "follow"  → browse someone else's followers/following and follow them
// "cleanup" → browse YOUR OWN following list and unfollow

type PageMode = "follow" | "cleanup";

function readUrlParams(): { mode: PageMode; preloadFid: number | null } {
  const p = new URLSearchParams(window.location.search);
  const mode: PageMode = p.get("mode") === "cleanup" ? "cleanup" : "follow";
  const fid = p.get("fid") ? Number(p.get("fid")) : null;
  return { mode, preloadFid: fid && fid > 0 ? fid : null };
}

// ─── Hub fast path ──────────────────────────────────────────────────────────────
// Scans the raw follow graph from free hubs (~2000 FIDs/call, zero Neynar credits,
// newest first) instead of Neynar's 100-profile pages, computes viewer_context
// locally from the viewer's own link sets, and hydrates profiles lazily · only
// for rows that become visible (or the smart-sort candidate window).
// Not eligible when filters need full profiles up front (follower range, Pro,
// username exclusions) · those keep the exact Neynar pipeline.

const FAST_SCAN_CAP = 30_000;       // raw FIDs per scan (~15 free hub calls)
const VIEWER_SET_TTL = 10 * 60_000;
const VIEWER_SET_PAGE_CAP = 60;     // ~120K links · beyond this the set is partial

const _viewerSets = new Map<string, { ts: number; set: Set<number>; complete: boolean }>();

async function getViewerLinkSet(
  myFid: number,
  type: "followers" | "following",
): Promise<{ set: Set<number>; complete: boolean }> {
  const key = `${type}:${myFid}`;
  const hit = _viewerSets.get(key);
  if (hit && Date.now() - hit.ts < VIEWER_SET_TTL) return hit;
  const set = new Set<number>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await getFollowListFids(myFid, type, cursor);
    for (const f of page.fids) set.add(f);
    cursor = page.nextCursor;
    pages++;
  } while (cursor && pages < VIEWER_SET_PAGE_CAP);
  const entry = { ts: Date.now(), set, complete: !cursor };
  _viewerSets.set(key, entry);
  return entry;
}

/** Returns the filtered list, or null when correctness requires the Neynar path. */
async function fastHubScan(opts: {
  targetFid: number;
  lt: "followers" | "following";
  myFid: number;
  mode: "follow" | "unfollow";
  filters: BatchFilters;
  fidExclusions?: Set<number>;
  onProgress: (pages: number, found: number) => void;
}): Promise<NeynarUser[] | null> {
  const { targetFid, lt, myFid, mode, filters, fidExclusions, onProgress } = opts;

  // 1. Raw FID scan of the target list (free, newest first).
  const raw: number[] = [];
  const seen = new Set<number>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await getFollowListFids(targetFid, lt, cursor);
    for (const f of page.fids) if (!seen.has(f)) { seen.add(f); raw.push(f); }
    cursor = page.nextCursor;
    pages++;
    onProgress(pages, raw.length);
  } while (cursor && raw.length < FAST_SCAN_CAP);

  // 2. Viewer link sets → viewer_context for every candidate (also free).
  //    Cleanup mode scans MY following, so `following` is true by definition.
  const needFollowers = mode === "follow" || filters.skipMutuals || filters.onlyNonFollowers;
  const [following, followers] = await Promise.all([
    mode === "follow"
      ? getViewerLinkSet(myFid, "following")
      : Promise.resolve({ set: new Set<number>(), complete: true }),
    needFollowers
      ? getViewerLinkSet(myFid, "followers")
      : Promise.resolve({ set: new Set<number>(), complete: true }),
  ]);

  // Mutual-based FILTERS need the complete followers set · if the viewer has
  // more followers than the scan cap, only the exact Neynar path is correct.
  const usesMutualFilter = mode === "follow"
    ? (filters.onlyMutuals || filters.onlyNonFollowers)
    : (filters.skipMutuals || filters.onlyNonFollowers);
  if (usesMutualFilter && !followers.complete) return null;

  // 3. Stub users with real viewer_context; profiles hydrate lazily per row.
  let candidates: NeynarUser[] = raw
    .filter(f => f !== myFid)
    .map(f => ({
      fid: f, username: "", display_name: "", pfp_url: "",
      follower_count: 0, following_count: 0,
      viewer_context: {
        following: mode === "unfollow" ? true : following.set.has(f),
        followed_by: followers.set.has(f),
      },
    }));

  // 4. Identical filter semantics to applyFilters (follower-range/Pro never reach here).
  if (mode === "follow") {
    candidates = candidates.filter(u => !u.viewer_context!.following);
    if (filters.onlyMutuals) candidates = candidates.filter(u => u.viewer_context!.followed_by);
    if (filters.onlyNonFollowers) candidates = candidates.filter(u => !u.viewer_context!.followed_by);
  } else if (filters.skipMutuals || filters.onlyNonFollowers) {
    candidates = candidates.filter(u => !u.viewer_context!.followed_by);
  }
  // FID range is known on the bare stubs, so the fast path can apply it directly.
  if (filters.minFid > 0) candidates = candidates.filter(u => u.fid >= filters.minFid);
  if (filters.maxFid > 0) candidates = candidates.filter(u => u.fid <= filters.maxFid);
  if (fidExclusions && fidExclusions.size > 0) {
    candidates = candidates.filter(u => !fidExclusions.has(u.fid));
  }

  // 5. Sort. Smart scoring needs counts · hydrate a bounded candidate window
  //    through the SQLite-backed bulk cache, then rank.
  if (filters.sortOrder === "oldest") candidates.reverse();
  else if (filters.sortOrder === "random") {
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
  } else if (filters.sortOrder === "smart") {
    const windowSize = Math.min(candidates.length, Math.max(filters.limit * 2, 500), 3000);
    const window = candidates.slice(0, windowSize);
    const profiles = await hydrateProfiles(window.map(u => u.fid));
    const scored = window.map(u => {
      const p = profiles.get(u.fid);
      return p ? { ...p, viewer_context: u.viewer_context } : u;
    });
    scored.sort((a, b) => smartScore(b) - smartScore(a));
    return scored.slice(0, filters.limit);
  }

  return candidates.slice(0, filters.limit);
}

/**
 * Batch-fetch Pro status for a candidate list. Used to run one 100-FID chunk
 * at a time sequentially, which for a few-thousand-candidate scan meant
 * dozens of back-to-back round-trips ("scanning 100 at a time"). Fetch
 * chunks with bounded concurrency instead.
 */
async function fetchProStatusMap(fids: number[]): Promise<Record<number, boolean>> {
  const proMap: Record<number, boolean> = {};
  const chunks: number[][] = [];
  for (let i = 0; i < fids.length; i += 100) chunks.push(fids.slice(i, i + 100));
  const CONCURRENCY = 6;
  let next = 0;
  async function worker() {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      try {
        const r = await fetch(`/api/pro-status?fids=${chunk.join(",")}`, { headers: { accept: "application/json" } });
        if (r.ok) {
          const data = await r.json() as Record<string, boolean>;
          for (const fid of chunk) proMap[fid] = !!data[fid];
        }
      } catch { /* leave undefined → treated as false */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  return proMap;
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function UserRow({
  user: rawUser, selected, onToggle, mode,
}: {
  user: NeynarUser;
  selected: boolean;
  onToggle: () => void;
  mode: PageMode;
}) {
  // Fast-path rows arrive as bare-FID stubs (empty username) · hydrate the
  // display fields lazily, keeping the viewer_context computed from hub sets.
  const hydrated = useHydratedUser(rawUser.fid, !rawUser.username);
  const user = !rawUser.username && hydrated
    ? { ...hydrated, viewer_context: rawUser.viewer_context }
    : rawUser;
  const followingMe = user.viewer_context?.followed_by;
  const iFollow = user.viewer_context?.following;
  const proMap = useProStatus([user.fid]);
  const isPro = proMap[user.fid] ?? false;

  return (
    <button
      onClick={onToggle}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-3 text-left transition-colors",
        selected ? "bg-primary/5" : "hover:bg-muted/30",
      )}
    >
      <div className={cn(
        "shrink-0 w-5 h-5 rounded flex items-center justify-center border transition-all",
        selected
          ? mode === "follow" ? "bg-primary border-primary" : "bg-rose-500 border-rose-500"
          : "border-border",
      )}>
        {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
      </div>

      <div className="shrink-0 w-9 h-9 rounded-full overflow-hidden bg-muted ring-1 ring-border">
        {user.pfp_url
          ? <img src={user.pfp_url} alt="" className="w-full h-full object-cover" />
          : <span className="w-full h-full flex items-center justify-center text-xs font-bold text-primary bg-primary/10">
              {(user.username || "?")[0].toUpperCase()}
            </span>
        }
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground truncate">
            @{user.username}
          </p>
          {isPro && <ProBadge size={13} />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[11px] text-muted-foreground truncate">{user.display_name || user.username}</p>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatCompactCount(user.follower_count ?? 0)} followers
          </span>
          {(() => {
            const s = neynarScore(user);
            return s !== undefined ? <NeynarScoreBadge score={s} className="shrink-0" /> : null;
          })()}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {followingMe && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/10 text-rose-500 border border-rose-500/20">
            follows you
          </span>
        )}
        {iFollow && (
          <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
            following
          </span>
        )}
      </div>
    </button>
  );
}

function Toggle({ label, sub, checked, onChange, icon }: {
  label: string; sub?: string; checked: boolean;
  onChange: (v: boolean) => void; icon?: React.ReactNode;
}) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center gap-3 py-2.5 w-full text-left">
      {icon && <span className="shrink-0 text-muted-foreground w-4 flex items-center justify-center">{icon}</span>}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground leading-tight">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </div>
      <div className={cn(
        "relative shrink-0 w-10 h-5 rounded-full border transition-all duration-200",
        checked ? "bg-primary border-primary" : "bg-muted border-border",
      )}>
        <motion.div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
          animate={{ left: checked ? "calc(100% - 18px)" : "2px" }}
          transition={{ type: "spring", damping: 22, stiffness: 400 }}
        />
      </div>
    </button>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

type Phase = "idle" | "searching" | "loading" | "loaded" | "empty";

export function FollowPage() {
  const [, navigate] = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, []);
  const { fid, localSigner, neynarKey, profile } = useWallet();
  const batchOp = useBatchOperation();
  const myFid = fid ? Number(fid) : 0;

  // ── Init from URL params ──────────────────────────────────────────────────
  const initRef = useRef(false);
  const [mode, setMode] = useState<PageMode>(() => readUrlParams().mode);
  // "Active" is a separate view (not a scanning mode) that lists every grow
  // running across every account · reachable via ?tab=active (the overflow
  // chip on the floating progress stack links here).
  const [showActive, setShowActive] = useState(
    () => new URLSearchParams(window.location.search).get("tab") === "active"
  );

  // Search state (follow mode)
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<NeynarUser[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [targetUser, setTargetUser] = useState<NeynarUser | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const suggestDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Own profile (cleanup mode)
  const [ownProfile, setOwnProfile] = useState<NeynarUser | null>(null);

  // List state
  const [listType, setListType] = useState<"followers" | "following">("followers");
  const [phase, setPhase] = useState<Phase>("idle");
  const [scanProgress, setScanProgress] = useState({ pages: 0, found: 0 });
  const [allUsers, setAllUsers] = useState<NeynarUser[]>([]);
  const [selectedFids, setSelectedFids] = useState<Set<number>>(new Set());

  // Filter state
  const [filters, setFilters] = useState<BatchFilters>(DEFAULT_FILTERS);
  const [excludeRaw, setExcludeRaw] = useState("");
  const [showExclude, setShowExclude] = useState(false);
  const [activePreset, setActivePreset] = useState<Preset>("custom");
  const [batchStarted, setBatchStarted] = useState(false);
  const [lastBatchLabel, setLastBatchLabel] = useState("");

  // List virtualization · render only the first N rows to prevent page freeze
  const [visibleCount, setVisibleCount] = useState(40);

  // Deep scan · continues past the initial 10K cap for large accounts
  const [deepScanCursor, setDeepScanCursor] = useState<string | undefined>(undefined);
  const [deepScanning, setDeepScanning] = useState(false);
  const deepScanRawRef = useRef<NeynarUser[]>([]);
  const deepScanTargetRef = useRef<{ user: NeynarUser; lt: "followers" | "following" } | null>(null);

  const exclusions = excludeRaw.trim() ? parseExclusions(excludeRaw) : undefined;
  const excludeCount = (exclusions?.fidSet.size ?? 0) + (exclusions?.usernameSet.size ?? 0);

  // ── Switch mode ───────────────────────────────────────────────────────────

  function switchMode(next: PageMode) {
    setShowActive(false);
    setMode(next);
    setAllUsers([]);
    setSelectedFids(new Set());
    setPhase("idle");
    setBatchStarted(false);
    setFilters(DEFAULT_FILTERS);
    setActivePreset("custom");
    if (next === "cleanup") {
      setListType("following");
    } else {
      setTargetUser(null);
      setSearchQuery("");
    }
  }

  // ── On mount: handle URL params ───────────────────────────────────────────

  useEffect(() => {
    if (initRef.current || !myFid) return;
    initRef.current = true;
    const { mode: initMode, preloadFid } = readUrlParams();
    setMode(initMode);
    if (initMode === "cleanup") setListType("following");

    if (preloadFid) {
      // Pre-load the target profile
      setPhase("searching");
      getUserByFid(preloadFid, myFid, neynarKey ?? "").then(res => {
        const u = res.users?.[0] ?? null;
        if (u) {
          setTargetUser(u);
          setSearchQuery(`@${u.username}`);
        }
        setPhase("idle");
      }).catch(() => { setPhase("idle"); });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myFid]);

  // ── Load own profile whenever cleanup mode is active ──────────────────────
  // Separate from init so it also fires when user clicks "Clean Up" tab

  useEffect(() => {
    if (mode !== "cleanup" || !myFid) return;
    getUserByFid(myFid, myFid, neynarKey ?? "").then(res => {
      const u = res.users?.[0] ?? null;
      if (u) setOwnProfile(u);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, myFid, neynarKey]);

  // ── Search suggestions (follow mode) ─────────────────────────────────────

  function onSearchChange(val: string) {
    setSearchQuery(val);
    if (suggestDebounce.current) clearTimeout(suggestDebounce.current);
    if (!val.trim() || !myFid) { setSuggestions([]); return; }
    suggestDebounce.current = setTimeout(async () => {
      try {
        const clean = val.replace(/^@/, "").trim();
        if (!clean || /^\d+$/.test(clean)) { setSuggestions([]); return; }
        const res = await searchUsers(clean, myFid, neynarKey ?? "");
        setSuggestions(res.result?.users?.slice(0, 6) ?? []);
        setShowSuggestions(true);
      } catch { setSuggestions([]); }
    }, 350);
  }

  async function selectSuggestion(user: NeynarUser) {
    setTargetUser(user);
    setSearchQuery(`@${user.username}`);
    setSuggestions([]);
    setShowSuggestions(false);
    setAllUsers([]);
    setSelectedFids(new Set());
    setPhase("idle");
  }

  async function doSearch() {
    if (!searchQuery.trim() || !myFid) return;
    const clean = searchQuery.replace(/^@/, "").trim();
    setPhase("searching");
    setSuggestions([]);
    setShowSuggestions(false);
    try {
      let found: NeynarUser | null = null;
      if (/^\d+$/.test(clean)) {
        const res = await getUserByFid(Number(clean), myFid, neynarKey ?? "");
        found = res.users?.[0] ?? null;
      } else {
        const res = await searchUsers(clean, myFid, neynarKey ?? "");
        found = res.result?.users?.[0] ?? null;
      }
      if (!found) { toast.error("User not found"); setPhase("idle"); return; }
      await selectSuggestion(found);
    } catch (e) {
      toast.error("Search failed: " + (e instanceof Error ? e.message : "error"));
      setPhase("idle");
    }
  }

  // ── Load list ─────────────────────────────────────────────────────────────

  const loadList = useCallback(async (
    target: NeynarUser,
    lt: "followers" | "following",
    currentFilters: BatchFilters,
    currentMode: PageMode,
    currentExclusions?: { fidSet: Set<number>; usernameSet: Set<string> },
  ) => {
    if (!myFid) return;
    setPhase("loading");
    setScanProgress({ pages: 0, found: 0 });
    setAllUsers([]);
    setSelectedFids(new Set());

    const batchMode = currentMode === "follow" ? "follow" : "unfollow";
    const fetchFid = target.fid;
    const fetchFn = lt === "following" ? getFollowing : getFollowers;
    let collected: NeynarUser[] = [];

    // ── Browser-side cache (IndexedDB, 15 min TTL) ─────────────────────────
    // Skip cache when strict filters are active · those filters need MAX_SCAN
    // raw data to find enough qualifying results. With only limit×4 cached
    // users, strict filters (minFollowers, Power Badge, Pro) almost always
    // produce an empty result.
    const strictFilters =
      (currentFilters.minFollowers ?? 0) > 0 ||
      (currentFilters.maxFollowers ?? 0) > 0 ||
      (currentFilters.minNeynarScore ?? 0) > 0 ||
      currentFilters.onlyPro === true ||
      currentFilters.requirePowerBadge === true ||
      currentFilters.spamLabel !== "any";
    const cached = strictFilters ? null : await getCachedFollowList(lt, fetchFid, myFid);
    const minRawNeeded = Math.min(currentFilters.limit * 4, MAX_SCAN);
    if (cached && cached.length >= minRawNeeded) {
      collected = cached as NeynarUser[];
      setScanProgress({ pages: Math.ceil(collected.length / 100), found: collected.length });
      if (currentFilters.spamLabel !== "any") await getSpamLabelsFor(collected.map(u => u.fid));
      const result = applyFilters(collected, batchMode, currentFilters, currentExclusions, myFid);
      setAllUsers(result);
      setSelectedFids(new Set(result.map(u => u.fid)));
      setPhase(result.length === 0 ? "empty" : "loaded");
      return;
    }

    // ── Hub fast path · raw-FID scan from free hubs (zero Neynar credits) ──
    // Falls back to the exact Neynar pipeline below on any failure, when
    // filters need full profiles (range/Pro), or on username exclusions.
    const canFastScan =
      !strictFilters &&
      (currentExclusions?.usernameSet.size ?? 0) === 0;
    if (canFastScan) {
      try {
        const fast = await fastHubScan({
          targetFid: fetchFid, lt, myFid, mode: batchMode, filters: currentFilters,
          fidExclusions: currentExclusions?.fidSet,
          onProgress: (pages, found) => setScanProgress({ pages, found }),
        });
        if (fast) {
          // Fast scan already covers up to 30K raw FIDs · deeper than the
          // native scan + deep-scan combined, so no deep-scan banner needed.
          deepScanRawRef.current = [];
          deepScanTargetRef.current = null;
          setDeepScanCursor(undefined);
          setAllUsers(fast);
          setSelectedFids(new Set(fast.map(u => u.fid)));
          setPhase(fast.length === 0 ? "empty" : "loaded");
          return;
        }
      } catch (e) {
        console.warn("[grow] hub fast path failed · falling back to Neynar scan:", e);
      }
    }

    // ── Fresh fetch from server ────────────────────────────────────────────
    let cursor: string | undefined;

    try {
      do {
        const res = await fetchFn(fetchFid, myFid, neynarKey ?? "", cursor);
        const batch = res.users.map((u: NeynarUser | { user: NeynarUser }) =>
          ("user" in u && u.user) ? (u as { user: NeynarUser }).user : (u as NeynarUser)
        ).filter(Boolean);
        collected.push(...batch);
        cursor = res.next?.cursor;
        setScanProgress({ pages: Math.ceil(collected.length / 100), found: collected.length });
        // Early-exit only for non-Pro filters (Pro needs full scan to batch-check status)
        if (!currentFilters.onlyPro) {
          const interim = applyFilters(collected, batchMode, { ...currentFilters, limit: MAX_SCAN }, currentExclusions, myFid);
          if (interim.length >= currentFilters.limit) break;
        }
      } while (cursor && collected.length < MAX_SCAN);

      void setCachedFollowList(lt, fetchFid, myFid, collected);
    } catch (e) {
      toast.error("Failed to load: " + (e instanceof Error ? e.message : "error"));
      setPhase("idle");
      return;
    }

    deepScanRawRef.current = collected;
    deepScanTargetRef.current = { user: target, lt };
    setDeepScanCursor(cursor);

    if (currentFilters.spamLabel !== "any") await getSpamLabelsFor(collected.map(u => u.fid));

    // ── Pro filter: batch-fetch Pro status, then apply ────────────────────
    let finalResult: NeynarUser[];
    if (currentFilters.onlyPro) {
      // First apply all other filters (without limit cap so we get all candidates)
      const candidates = applyFilters(
        collected, batchMode,
        { ...currentFilters, onlyPro: false, limit: MAX_SCAN },
        currentExclusions, myFid,
      );
      setScanProgress(p => ({ ...p, found: candidates.length }));

      const proMap = await fetchProStatusMap(candidates.map(u => u.fid));
      finalResult = candidates.filter(u => proMap[u.fid] === true).slice(0, currentFilters.limit);
    } else {
      finalResult = applyFilters(collected, batchMode, currentFilters, currentExclusions, myFid);
    }

    setAllUsers(finalResult);
    setSelectedFids(new Set(finalResult.map(u => u.fid)));
    setPhase(finalResult.length === 0 ? "empty" : "loaded");
  }, [myFid, neynarKey]);

  function handleLoad() {
    const target = mode === "cleanup" ? ownProfile : targetUser;
    if (!target) return;
    const lt = mode === "cleanup" ? "following" : listType;
    setVisibleCount(40);
    setDeepScanCursor(undefined);
    deepScanRawRef.current = [];
    loadList(target, lt, filters, mode, exclusions);
  }

  // Continues scanning 10K more raw users when initial scan found fewer than limit
  async function handleDeepScan() {
    if (!deepScanCursor || !deepScanTargetRef.current || deepScanning || !myFid) return;
    setDeepScanning(true);
    const { user: target, lt } = deepScanTargetRef.current;
    const fetchFn = lt === "following" ? getFollowing : getFollowers;
    const batchMode = mode === "follow" ? "follow" : "unfollow";
    let collected = [...deepScanRawRef.current];
    let cursor: string | undefined = deepScanCursor;
    const rawCap = collected.length + 10_000; // 10K more raw users per batch

    try {
      do {
        const res = await fetchFn(target.fid, myFid, neynarKey ?? "", cursor);
        const batch = res.users.map((u: NeynarUser | { user: NeynarUser }) =>
          ("user" in u && u.user) ? (u as { user: NeynarUser }).user : (u as NeynarUser)
        ).filter(Boolean);
        collected.push(...batch);
        cursor = res.next?.cursor;
        setScanProgress({ pages: Math.ceil(collected.length / 100), found: collected.length });
        if (!filters.onlyPro) {
          const interim = applyFilters(collected, batchMode, { ...filters, limit: 999_999 }, exclusions, myFid);
          if (interim.length >= filters.limit) break;
        }
      } while (cursor && collected.length < rawCap);

      void setCachedFollowList(lt, target.fid, myFid, collected);
    } catch (e) {
      toast.error("Scan failed: " + (e instanceof Error ? e.message : "error"));
      setDeepScanning(false);
      return;
    }

    deepScanRawRef.current = collected;
    setDeepScanCursor(cursor);

    if (filters.spamLabel !== "any") await getSpamLabelsFor(collected.map(u => u.fid));

    // ── Pro filter: batch-fetch Pro status, then apply ─────────────────────
    let result: NeynarUser[];
    if (filters.onlyPro) {
      const candidates = applyFilters(collected, batchMode, { ...filters, onlyPro: false, limit: MAX_SCAN }, exclusions, myFid);
      setScanProgress(p => ({ ...p, found: candidates.length }));
      const proMap = await fetchProStatusMap(candidates.map(u => u.fid));
      result = candidates.filter(u => proMap[u.fid] === true).slice(0, filters.limit);
    } else {
      result = applyFilters(collected, batchMode, filters, exclusions, myFid);
    }

    setAllUsers(result);
    setSelectedFids(new Set(result.map(u => u.fid)));
    setDeepScanning(false);
  }

  // ── Selection ─────────────────────────────────────────────────────────────

  function toggleUser(userFid: number) {
    setSelectedFids(prev => {
      const next = new Set(prev);
      if (next.has(userFid)) next.delete(userFid); else next.add(userFid);
      return next;
    });
  }

  function selectAll() { setSelectedFids(new Set(allUsers.map(u => u.fid))); }
  function deselectAll() { setSelectedFids(new Set()); }

  // ── Start op ──────────────────────────────────────────────────────────────

  function startBatch() {
    if (!localSigner || !myFid) { toast.error("Wallet not ready"); return; }
    const selected = allUsers.filter(u => selectedFids.has(u.fid));
    if (selected.length === 0) { toast.error("Select at least one user"); return; }
    const batchMode = mode === "follow" ? "follow" : "unfollow";
    const target = mode === "cleanup" ? ownProfile : targetUser;
    const verb = mode === "follow" ? "Following" : "Unfollowing";
    const label = `${verb} ${selected.length} · @${target?.username ?? "?"}`;
    const accountLabel = profile?.username ? `@${profile.username}` : `FID ${myFid}`;
    batchOp.startOp({ mode: batchMode, users: selected, myFid, localSigner, neynarKey: neynarKey ?? "", label, accountLabel });
    setLastBatchLabel(label);
    setBatchStarted(true);
    setSelectedFids(new Set());
  }

  // ── Filter helpers ────────────────────────────────────────────────────────

  function updateFilter<K extends keyof BatchFilters>(key: K, val: BatchFilters[K]) {
    setFilters(f => ({ ...f, [key]: val }));
    setActivePreset("custom");
  }

  function applyPreset(presetFilters: Partial<BatchFilters>, id: Preset) {
    // Presets reset everything to a known baseline EXCEPT the FID range —
    // that's a simple universal constraint the user sets independently of
    // which preset is active, and presets don't know about it, so folding it
    // into DEFAULT_FILTERS here would silently wipe out a range typed in
    // before picking a preset.
    setFilters(f => ({ ...DEFAULT_FILTERS, minFid: f.minFid, maxFid: f.maxFid, ...presetFilters }));
    setActivePreset(id);
  }

  const presets = mode === "follow" ? FOLLOW_PRESETS : UNFOLLOW_PRESETS;
  const isLoading = phase === "loading" || phase === "searching";
  const isLoaded  = phase === "loaded";
  const isEmpty   = phase === "empty";
  const selectedCount = selectedFids.size;

  const canLoad = mode === "cleanup"
    ? ownProfile !== null && myFid > 0
    : targetUser !== null && myFid > 0;

  const accentCls = mode === "follow"
    ? "bg-primary text-white hover:bg-primary/90"
    : "bg-rose-500 text-white hover:bg-rose-500/90";

  const pageTitle = mode === "follow" ? "Follow from Profile" : "Clean Up Following";
  const pageSubtitle = mode === "follow"
    ? "Browse any profile's community and follow them"
    : "Review and remove people from your following list";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background flex flex-col pb-[54px] md:pb-0">

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-background/96 backdrop-blur-xl border-b border-border relative overflow-hidden">
        <div className={cn(
          "absolute inset-0 opacity-[0.07] pointer-events-none",
          mode === "follow"
            ? "bg-gradient-to-r from-primary via-violet-500 to-transparent"
            : "bg-gradient-to-r from-rose-500 via-orange-400 to-transparent"
        )} />
        <div className="h-[53px] flex items-center gap-3 px-4 max-w-[900px] mx-auto w-full relative">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-2 -ml-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className={cn(
            "shrink-0 w-8 h-8 rounded-xl flex items-center justify-center",
            mode === "follow" ? "bg-primary/10 text-primary" : "bg-rose-500/10 text-rose-500",
          )}>
            {mode === "follow" ? <UserPlus className="w-4 h-4" /> : <Scissors className="w-4 h-4" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-[15px] text-foreground">{pageTitle}</h1>
            <p className="text-[11px] text-muted-foreground leading-none mt-0.5">{pageSubtitle}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 lg:min-h-0 max-w-[900px] w-full mx-auto flex flex-col lg:flex-row gap-0 lg:gap-6 px-0 lg:px-4 lg:py-4">

        {/* ── LEFT: CONTROLS (full-width when the Active view replaces the two-column layout) ── */}
        <div className={cn("flex flex-col gap-4", showActive ? "w-full" : "lg:w-[280px] lg:shrink-0")}>

          {/* Mode switcher */}
          <div className="px-4 pt-4 lg:px-0 lg:pt-0">
            <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border border-border">
              <button
                onClick={() => switchMode("follow")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
                  mode === "follow" && !showActive
                    ? "bg-primary text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <UserPlus className="w-3.5 h-3.5" />
                Follow
              </button>
              <button
                onClick={() => switchMode("cleanup")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
                  mode === "cleanup" && !showActive
                    ? "bg-rose-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Scissors className="w-3.5 h-3.5" />
                Clean Up
              </button>
              <button
                onClick={() => { setShowActive(true); navigate("/follow?tab=active", { replace: true }); }}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
                  showActive
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <ListChecks className="w-3.5 h-3.5" />
                Active
                {batchOp.ops.filter(o => o.phase === "running").length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                )}
              </button>
            </div>
          </div>

          {showActive ? (
            <ActiveGrowsView ops={batchOp.ops} onCancel={batchOp.cancelOp} onDismiss={batchOp.clearOp} onUnhide={batchOp.unhideOp} />
          ) : (
          <>
          {/* ── FOLLOW MODE: search for a target profile ── */}
          {mode === "follow" && (
            <div className="px-4 lg:px-0 space-y-3">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Target profile
              </p>
              <div className="relative">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      ref={searchRef}
                      value={searchQuery}
                      onChange={e => onSearchChange(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter") doSearch();
                        if (e.key === "Escape") setShowSuggestions(false);
                      }}
                      onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                      placeholder="@username or FID…"
                      className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-border bg-muted/20 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/40 focus:ring-2 focus:ring-primary/10 transition-all"
                    />
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    {searchQuery && (
                      <button
                        onClick={() => { setSearchQuery(""); setTargetUser(null); setAllUsers([]); setSuggestions([]); setPhase("idle"); }}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={doSearch}
                    disabled={!searchQuery.trim() || isLoading}
                    className="px-3.5 py-2.5 rounded-xl bg-primary text-white font-semibold text-[13px] hover:bg-primary/90 disabled:opacity-40 transition-all shrink-0"
                  >
                    {phase === "searching" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </button>
                </div>

                {/* Autocomplete */}
                <AnimatePresence>
                  {showSuggestions && suggestions.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute top-full mt-1.5 left-0 right-0 z-50 bg-background border border-border rounded-xl shadow-xl overflow-hidden"
                    >
                      {suggestions.map(u => (
                        <button key={u.fid} onClick={() => selectSuggestion(u)}
                          className="flex items-center gap-2.5 w-full px-3 py-2.5 hover:bg-accent transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-full overflow-hidden bg-muted shrink-0">
                            {u.pfp_url
                              ? <img src={u.pfp_url} alt="" className="w-full h-full object-cover" />
                              : <span className="w-full h-full flex items-center justify-center text-[10px] font-bold text-primary">{(u.username || "?")[0].toUpperCase()}</span>
                            }
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-semibold text-foreground truncate">@{u.username}</p>
                            <p className="text-[10px] text-muted-foreground">{formatCompactCount(u.follower_count ?? 0)} followers</p>
                          </div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Target user card */}
              {targetUser && (
                <div className="rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/[0.06] to-transparent p-3.5 flex items-center gap-3">
                  <div className="w-12 h-12 rounded-full overflow-hidden bg-muted shrink-0 ring-2 ring-primary/20">
                    {targetUser.pfp_url
                      ? <img src={targetUser.pfp_url} alt="" className="w-full h-full object-cover" />
                      : <span className="w-full h-full flex items-center justify-center text-base font-bold text-primary bg-primary/10">{(targetUser.username || "?")[0].toUpperCase()}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13.5px] font-bold text-foreground truncate">{targetUser.display_name || targetUser.username}</p>
                    <p className="text-[11px] text-muted-foreground">@{targetUser.username}</p>
                    <div className="flex gap-3 mt-1">
                      <span className="text-[10px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{formatCompactCount(targetUser.follower_count ?? 0)}</span> followers
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{formatCompactCount(targetUser.following_count ?? 0)}</span> following
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Scan their: Followers / Following */}
              {targetUser && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Scan their
                  </p>
                  <div className="flex gap-1.5">
                    {(["followers", "following"] as const).map(lt => {
                      const count = lt === "followers"
                        ? (targetUser?.follower_count ?? 0)
                        : (targetUser?.following_count ?? 0);
                      return (
                        <button
                          key={lt}
                          onClick={() => { setListType(lt); setAllUsers([]); setSelectedFids(new Set()); setPhase("idle"); }}
                          className={cn(
                            "flex-1 flex flex-col items-center py-2 rounded-xl border text-[12px] font-semibold transition-all",
                            listType === lt
                              ? "bg-primary/10 border-primary/30 text-primary"
                              : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/20",
                          )}
                        >
                          <span className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" />
                            {lt === "followers" ? "Followers" : "Following"}
                          </span>
                          <span className={cn("text-[10px] font-normal mt-0.5", listType === lt ? "text-primary/70" : "text-muted-foreground/60")}>
                            {formatCompactCount(count)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state · no target yet */}
              {!targetUser && phase !== "searching" && (
                <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
                  <div className="w-12 h-12 rounded-2xl bg-primary/8 flex items-center justify-center">
                    <UserPlus className="w-6 h-6 text-primary/50" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-semibold text-foreground">Find a profile</p>
                    <p className="text-[12px] mt-1 max-w-[200px] mx-auto text-muted-foreground">
                      Search by @username or FID to browse their community
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── CLEANUP MODE: own account, auto-shown ── */}
          {mode === "cleanup" && (
            <div className="px-4 lg:px-0 space-y-3">
              {ownProfile ? (
                <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0 ring-1 ring-border">
                    {ownProfile.pfp_url
                      ? <img src={ownProfile.pfp_url} alt="" className="w-full h-full object-cover" />
                      : <span className="w-full h-full flex items-center justify-center text-sm font-bold text-primary bg-primary/10">{(ownProfile.username || "?")[0].toUpperCase()}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-foreground truncate">{ownProfile.display_name || ownProfile.username}</p>
                    <p className="text-[11px] text-muted-foreground">@{ownProfile.username}</p>
                    <span className="text-[10px] text-muted-foreground">
                      <span className="font-semibold text-foreground">{formatCompactCount(ownProfile.following_count ?? 0)}</span> following
                    </span>
                  </div>
                  <div className="shrink-0">
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-rose-500/10 text-rose-500 border border-rose-500/20">
                      your list
                    </span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 p-3 rounded-xl border border-border bg-muted/20">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
                  <p className="text-[13px] text-muted-foreground">Loading your account…</p>
                </div>
              )}
            </div>
          )}

          {/* ── Filters (shown once a target is set) ── */}
          {canLoad && (
            <div className="px-4 lg:px-0 space-y-3">

              {/* Filter panel · always open, no collapse toggle */}
              <div className="space-y-3">

                {/* Limit */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Max users
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {LIMIT_PRESETS.map(n => (
                      <button
                        key={n}
                        onClick={() => setFilters(f => ({ ...f, limit: n }))}
                        className={cn(
                          "px-3 py-1.5 rounded-lg border text-[11px] font-semibold transition-all",
                          filters.limit === n
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {n >= 1000 ? `${n / 1000}k` : n}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sort order */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Order
                  </p>
                  <div className="grid grid-cols-4 gap-1">
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => updateFilter("sortOrder", opt.id as SortOrder)}
                        className={cn(
                          "flex flex-col items-center gap-1 py-2 rounded-xl border text-[10px] font-semibold transition-all",
                          filters.sortOrder === opt.id
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/30",
                        )}
                      >
                        {opt.icon}
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Toggles */}
                <div className="rounded-xl border border-border divide-y divide-border/60 overflow-hidden">
                  {mode === "follow" ? (
                    <>
                      <div className="px-3">
                        <Toggle label="Mutuals only" sub="Only those who already follow me" checked={filters.onlyMutuals} onChange={v => { updateFilter("onlyMutuals", v); if (v) updateFilter("onlyNonFollowers", false); }} icon={<Heart className="w-3.5 h-3.5" />} />
                      </div>
                      <div className="px-3">
                        <Toggle label="Hide people who follow me" sub="Skip accounts that already follow me" checked={filters.onlyNonFollowers} onChange={v => { updateFilter("onlyNonFollowers", v); if (v) updateFilter("onlyMutuals", false); }} icon={<UserMinus className="w-3.5 h-3.5" />} />
                      </div>
                      <div className="px-3">
                        {/* Farcaster's purple badge IS the Pro-subscriber badge · there is no
                            separate badge, so this is the only toggle for it (a second
                            "Purple badge only" toggle used to exist here, checking the same
                            thing under a different name — removed). */}
                        <Toggle label="Farcaster Pro only" sub="Paid subscribers ($10/mo) · rare, high intent" checked={filters.onlyPro} onChange={v => updateFilter("onlyPro", v)} icon={<ProBadge size={14} />} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="px-3">
                        <Toggle
                          label="Skip mutuals"
                          sub="Don't unfollow people who follow me back"
                          checked={filters.skipMutuals || filters.onlyNonFollowers}
                          onChange={v => { updateFilter("skipMutuals", v); updateFilter("onlyNonFollowers", v); }}
                          icon={<Heart className="w-3.5 h-3.5" />}
                        />
                      </div>
                    </>
                  )}
                </div>

                {/* Min / Max followers */}
                <div className="rounded-xl border border-border px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Follower range</p>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">Min</label>
                      <input
                        type="number" min={0}
                        value={filters.minFollowers || ""}
                        onChange={e => updateFilter("minFollowers", Number(e.target.value) || 0)}
                        placeholder="0"
                        className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-border bg-muted/20 text-[12px] text-foreground outline-none focus:border-primary/40 transition-colors"
                      />
                    </div>
                    <span className="text-muted-foreground text-sm pb-1.5">–</span>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">Max</label>
                      <input
                        type="number" min={0}
                        value={filters.maxFollowers || ""}
                        onChange={e => updateFilter("maxFollowers", Number(e.target.value) || 0)}
                        placeholder="any"
                        className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-border bg-muted/20 text-[12px] text-foreground outline-none focus:border-primary/40 transition-colors"
                      />
                    </div>
                  </div>
                </div>

                {/* FID range */}
                <div className="rounded-xl border border-border px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">FID range</p>
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">From FID</label>
                      <input
                        type="number" min={0}
                        value={filters.minFid || ""}
                        onChange={e => updateFilter("minFid", Number(e.target.value) || 0)}
                        placeholder="1"
                        className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-border bg-muted/20 text-[12px] text-foreground outline-none focus:border-primary/40 transition-colors"
                      />
                    </div>
                    <span className="text-muted-foreground text-sm pb-1.5">–</span>
                    <div className="flex-1">
                      <label className="text-[10px] text-muted-foreground">To FID</label>
                      <input
                        type="number" min={0}
                        value={filters.maxFid || ""}
                        onChange={e => updateFilter("maxFid", Number(e.target.value) || 0)}
                        placeholder="any"
                        className="w-full mt-0.5 px-2 py-1.5 rounded-lg border border-border bg-muted/20 text-[12px] text-foreground outline-none focus:border-primary/40 transition-colors"
                      />
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Only list accounts whose FID is in this range. Lower FIDs are older accounts.</p>
                </div>

                {/* Neynar quality score */}
                <div className="rounded-xl border border-border px-3 py-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                      <NeynarLogo size={12} /> Min Neynar score
                    </p>
                    <span className="text-[12px] font-bold text-foreground tabular-nums">
                      {filters.minNeynarScore > 0 ? filters.minNeynarScore : "Any"}
                    </span>
                  </div>
                  <input
                    type="range" min={0} max={99} step={1}
                    value={filters.minNeynarScore}
                    onChange={e => updateFilter("minNeynarScore", Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Skips low-quality/likely-spam accounts below this score. 0 = no filter.
                  </p>
                </div>

                {/* Real Farcaster spam label · independent of the score slider above */}
                <div className="rounded-xl border border-border px-3 py-2.5 space-y-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                    Spam label
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {([
                      { id: "any", label: "Any" },
                      { id: "not-spam", label: "Not spam" },
                      { id: "spam-only", label: "Spam only" },
                    ] as { id: SpamLabelFilter; label: string }[]).map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => updateFilter("spamLabel", opt.id)}
                        className={cn(
                          "py-2 rounded-lg border text-[11px] font-semibold transition-all",
                          filters.spamLabel === opt.id
                            ? "bg-primary/10 border-primary/30 text-primary"
                            : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Farcaster's actual published 0/2 label, refreshed weekly · unlabelled accounts are kept either way.
                  </p>
                </div>

                {/* Exclusion list */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <button
                    onClick={() => setShowExclude(v => !v)}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-left hover:bg-muted/20 transition-colors"
                  >
                    <Ban className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="flex-1 font-medium text-foreground">Skip specific users</span>
                    {excludeCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                        {excludeCount}
                      </span>
                    )}
                    <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", showExclude && "rotate-180")} />
                  </button>
                  {showExclude && (
                    <div className="px-3 pb-3 border-t border-border/60">
                      <p className="text-[11px] text-muted-foreground mt-2 mb-1.5">
                        FIDs or usernames, one per line or comma-separated
                      </p>
                      <textarea
                        value={excludeRaw}
                        onChange={e => setExcludeRaw(e.target.value)}
                        placeholder={"@dwr.eth\nvitalik.eth\n12345"}
                        rows={3}
                        className="w-full px-2.5 py-2 rounded-xl text-[11px] font-mono border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-none"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Load button */}
              <button
                onClick={handleLoad}
                disabled={isLoading || !canLoad}
                className={cn(
                  "w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-[13px] transition-all active:scale-[0.98]",
                  accentCls,
                  (isLoading || !canLoad) && "opacity-60 cursor-not-allowed",
                )}
              >
                {isLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Loading…</>
                  : mode === "cleanup"
                    ? <><Users className="w-4 h-4" /> Load my following</>
                    : <><Users className="w-4 h-4" /> Load list</>
                }
              </button>
            </div>
          )}
          </>
          )}
        </div>

        {/* ── RIGHT: USER LIST · hidden while the Active view is shown ── */}
        {!showActive && (
        <div className="flex-1 min-w-0 lg:min-h-0 border-t lg:border-t-0 lg:border-l border-border">

          {/* Scan progress */}
          {phase === "loading" && (
            <div className="flex flex-col items-center gap-4 py-16 text-muted-foreground">
              <Loader2 className="w-8 h-8 text-primary/50 animate-spin" />
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">Scanning…</p>
                <p className="text-[12px] mt-1">{scanProgress.found.toLocaleString()} users · page {scanProgress.pages}</p>
              </div>
            </div>
          )}

          {/* Success state */}
          {batchStarted && (
            <div className="flex flex-col items-center gap-5 py-16 px-6">
              <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center ring-4 ring-emerald-500/10">
                <Check className="w-8 h-8 text-emerald-500" strokeWidth={2.5} />
              </div>
              <div className="text-center">
                <p className="text-base font-bold text-foreground">Done!</p>
                <p className="text-[13px] text-muted-foreground mt-1 max-w-[260px] mx-auto">
                  {lastBatchLabel} · the progress pill at the bottom tracks it live.
                </p>
              </div>
              <div className="flex flex-col gap-2 w-full max-w-[240px]">
                <button
                  onClick={() => { setBatchStarted(false); setAllUsers([]); setSelectedFids(new Set()); setPhase("idle"); }}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border bg-muted/30 hover:bg-muted/60 text-[13px] font-semibold text-foreground transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Load another list
                </button>
                {mode === "follow" && (
                  <button
                    onClick={() => { setBatchStarted(false); setTargetUser(null); setSearchQuery(""); setAllUsers([]); setSelectedFids(new Set()); setPhase("idle"); }}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 hover:bg-primary/20 text-[13px] font-semibold text-primary transition-colors"
                  >
                    <Search className="w-4 h-4" />
                    Search another profile
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Empty filters */}
          {isEmpty && !batchStarted && (
            <div className="flex flex-col items-center gap-4 py-16 text-muted-foreground">
              <AlertCircle className="w-10 h-10 opacity-25" />
              <div className="text-center">
                <p className="text-sm font-semibold text-foreground">No users match your filters</p>
                <p className="text-[12px] mt-1">Try adjusting your strategy or filters</p>
              </div>
            </div>
          )}

          {/* Idle / searching */}
          {(phase === "idle" || phase === "searching") && !batchStarted && (
            <div className="flex flex-col items-center gap-4 py-16 text-muted-foreground">
              {phase === "searching"
                ? <Loader2 className="w-8 h-8 animate-spin text-primary/40" />
                : <Users className="w-10 h-10 opacity-15" />
              }
              {phase !== "searching" && (
                <p className="text-sm text-center px-6">
                  {canLoad
                    ? <>Configure filters, then tap <span className="font-semibold text-foreground">{mode === "cleanup" ? "Load my following" : "Load list"}</span></>
                    : mode === "follow"
                      ? "Search for a profile to get started"
                      : "Loading your account…"
                  }
                </p>
              )}
            </div>
          )}

          {/* User list */}
          {isLoaded && allUsers.length > 0 && !batchStarted && (
            <div className="flex flex-col">
              {/* Deep scan banner · shown when we hit the scan cap before reaching the limit */}
              {!batchStarted && deepScanCursor && allUsers.length < filters.limit && (
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-amber-500/8 border-b border-amber-500/20">
                  <div className="flex items-center gap-2 min-w-0">
                    <Search className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    <span className="text-[12px] text-muted-foreground">
                      Found <span className="font-semibold text-foreground">{allUsers.length.toLocaleString()}</span> of {filters.limit.toLocaleString()} · scanned first {deepScanRawRef.current.length.toLocaleString()} users
                    </span>
                  </div>
                  <button
                    onClick={handleDeepScan}
                    disabled={deepScanning}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-white text-[11px] font-bold shrink-0 transition-colors disabled:opacity-60"
                  >
                    {deepScanning
                      ? <><Loader2 className="w-3 h-3 animate-spin" /> Scanning…</>
                      : <><Search className="w-3 h-3" /> Scan 10K more</>}
                  </button>
                </div>
              )}

              {/* List header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-muted/10 sticky top-[53px] z-10">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-foreground">
                    {allUsers.length.toLocaleString()} users
                  </span>
                  {selectedCount > 0 && selectedCount < allUsers.length && (
                    <span className="text-[12px] text-muted-foreground">· {selectedCount} selected</span>
                  )}
                  {selectedCount === allUsers.length && (
                    <span className="text-[12px] text-primary font-semibold">· All selected</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {selectedCount < allUsers.length
                    ? (
                      <button onClick={selectAll} className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                        <CheckSquare className="w-3.5 h-3.5" /> Select all
                      </button>
                    ) : (
                      <button onClick={deselectAll} className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:underline">
                        <Square className="w-3.5 h-3.5" /> Deselect
                      </button>
                    )
                  }
                </div>
              </div>

              {/* List rows · flow in the page's own scroll (a bounded internal scroll
                  region needs a definite parent height, which this responsive layout
                  doesn't have; using page scroll + sticky header/footer avoids the
                  "whole page blows out when the list loads" layout break). Windowed to
                  the first N rows so huge lists never freeze the page. */}
              <div className="divide-y divide-border/40 pb-24">
                {allUsers.slice(0, visibleCount).map(user => (
                  <UserRow
                    key={user.fid}
                    user={user}
                    selected={selectedFids.has(user.fid)}
                    onToggle={() => toggleUser(user.fid)}
                    mode={mode}
                  />
                ))}
                {visibleCount < allUsers.length && (
                  <button
                    onClick={() => setVisibleCount(v => v + 40)}
                    className="w-full flex items-center justify-center gap-2 py-4 text-[13px] font-semibold text-primary hover:bg-primary/5 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                    Load 40 more
                    <span className="text-muted-foreground font-normal ml-1">
                      ({allUsers.length - visibleCount} remaining)
                    </span>
                  </button>
                )}
              </div>

              {/* Action bar · sits above the mobile bottom nav (54px), flush to the
                  viewport edge on desktop where there's no bottom nav to clear. */}
              <div className="sticky bottom-[54px] md:bottom-0 px-4 py-3 border-t border-border bg-background/98 backdrop-blur-md flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-semibold text-foreground">
                    {selectedCount} user{selectedCount !== 1 ? "s" : ""} selected
                  </p>
                  {selectedCount > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {etaStr(selectedCount)} est. · progress pill tracks live
                    </p>
                  )}
                </div>
                <button
                  onClick={startBatch}
                  disabled={selectedCount === 0 || !localSigner}
                  className={cn(
                    "flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-[13px] transition-all active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed",
                    accentCls,
                  )}
                >
                  {mode === "follow"
                    ? <><UserPlus className="w-4 h-4" /> Follow {selectedCount || ""}</>
                    : <><UserMinus className="w-4 h-4" /> Unfollow {selectedCount || ""}</>
                  }
                </button>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      <BottomNav active="grow" />
    </div>
  );
}

// ─── Active Grows · every running/finished op across every account, as a plain
// scrollable list (not floating pills). Persists across account switches since
// it just reads straight from BatchOperationContext, which isn't scoped to
// "whichever account is currently active" in the first place. ──────────────────
function ActiveGrowsView({ ops, onCancel, onDismiss, onUnhide }: {
  ops: BatchOp[];
  onCancel: (myFid: number, mode: "follow" | "unfollow") => void;
  onDismiss: (myFid: number, mode: "follow" | "unfollow") => void;
  onUnhide: (myFid: number, mode: "follow" | "unfollow") => void;
}) {
  if (ops.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground px-6 text-center">
        <ListChecks className="w-10 h-10 opacity-15" />
        <p className="text-sm">No grows running right now.</p>
        <p className="text-[12px] text-muted-foreground/70">
          Each account can run one Follow and one Unfollow grow at the same time.
          Start one from the Follow or Clean Up tab.
        </p>
      </div>
    );
  }

  return (
    <div className="px-4 lg:px-0 space-y-2.5 pb-4">
      {ops.map(op => {
        const remaining = Math.max(0, op.total - op.done - op.errors - op.skipped);
        const pct = op.total > 0 ? (op.done / op.total) * 100 : 0;
        const etaSecs = remaining * AVG_ACTION_SECS;
        const eta = etaSecs < 60 ? `~${Math.round(etaSecs)}s left` : `~${Math.round(etaSecs / 60)}m left`;
        const isRunning = op.phase === "running";
        const accent = op.mode === "follow" ? "text-primary" : "text-rose-500";
        const barColor = op.mode === "follow" ? "bg-primary" : "bg-rose-500";

        return (
          <div key={op.id} className="rounded-2xl border border-border bg-card p-3.5">
            <div className="flex items-center gap-2.5">
              <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                op.mode === "follow" ? "bg-primary/10" : "bg-rose-500/10")}>
                {op.mode === "follow" ? <UserPlus className={cn("w-4 h-4", accent)} /> : <UserMinus className={cn("w-4 h-4", accent)} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-bold text-foreground truncate">{op.accountLabel}</p>
                <p className="text-[11px] text-muted-foreground truncate">{op.label}</p>
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground shrink-0 tabular-nums">{op.done}/{op.total}</span>
              {isRunning ? (
                <button
                  onClick={() => onCancel(op.myFid, op.mode)}
                  className="text-[11px] font-semibold text-muted-foreground hover:text-rose-500 border border-border hover:border-rose-500/30 rounded-lg px-2.5 py-1.5 transition-all shrink-0"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => onDismiss(op.myFid, op.mode)}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-3">
              <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
            </div>

            <div className="flex items-center justify-between mt-2 text-[11px]">
              <span className={cn(
                "flex items-center gap-1",
                op.phase === "done" ? "text-emerald-500" : op.phase === "cancelled" ? "text-muted-foreground" : "text-muted-foreground"
              )}>
                {op.phase === "done"
                  ? <><CheckSquare className="w-3 h-3" /> Completed</>
                  : op.phase === "cancelled"
                    ? <><XCircle className="w-3 h-3" /> Stopped</>
                    : op.waitMsg
                      ? <><Loader2 className="w-3 h-3 animate-spin text-amber-500" /> <span className="text-amber-500">{op.waitMsg}</span></>
                      : <><Clock className="w-3 h-3" /> {eta}</>
                }
              </span>
              {(op.skipped > 0 || op.errors > 0) && (
                <span className="text-muted-foreground/70">
                  {op.skipped > 0 && `${op.skipped} skipped`}
                  {op.skipped > 0 && op.errors > 0 && " · "}
                  {op.errors > 0 && `${op.errors} failed`}
                </span>
              )}
            </div>

            {isRunning && op.hiddenFromStack && (
              <button
                onClick={() => onUnhide(op.myFid, op.mode)}
                className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-dashed border-border text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-all"
              >
                <Eye className="w-3.5 h-3.5" /> Show floating pill again
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
