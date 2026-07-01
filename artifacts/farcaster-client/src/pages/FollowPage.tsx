import { useState, useCallback, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft, Search, UserPlus, UserMinus, Users, Loader2,
  X, ChevronDown, CheckSquare, Square,
  Zap, Heart, Ban, Filter, Check, AlertCircle, Scissors,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  searchUsers, getUserByFid, getFollowers, getFollowing,
  hasPowerBadge, type NeynarUser,
} from "@/lib/neynar";
import { useWallet } from "@/hooks/useWallet";
import { useBatchOperation } from "@/hooks/BatchOperationContext";
import { toast } from "sonner";
import type { BatchFilters, SortOrder, Preset } from "@/lib/batch-follow-utils";
import {
  DEFAULT_FILTERS, FOLLOW_PRESETS, UNFOLLOW_PRESETS, SORT_OPTIONS,
  LIMIT_PRESETS, MAX_SCAN, parseExclusions, applyFilters, etaStr,
} from "@/lib/batch-follow-utils";

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

// ─── Sub-components ────────────────────────────────────────────────────────────

function UserRow({
  user, selected, onToggle, mode,
}: {
  user: NeynarUser;
  selected: boolean;
  onToggle: () => void;
  mode: PageMode;
}) {
  const followingMe = user.viewer_context?.followed_by;
  const iFollow = user.viewer_context?.following;

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
        <div className="flex items-center gap-1.5 min-w-0">
          <p className="text-[13px] font-semibold text-foreground truncate">
            {user.display_name || user.username}
          </p>
          {hasPowerBadge(user) && <Zap className="w-3 h-3 text-amber-500 shrink-0" />}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-[11px] text-muted-foreground truncate">@{user.username}</p>
          <span className="text-[10px] text-muted-foreground shrink-0">
            {(user.follower_count ?? 0).toLocaleString()} followers
          </span>
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
  const { fid, localSigner, neynarKey } = useWallet();
  const batchOp = useBatchOperation();
  const myFid = fid ? Number(fid) : 0;

  // ── Init from URL params ──────────────────────────────────────────────────
  const initRef = useRef(false);
  const [mode, setMode] = useState<PageMode>(() => readUrlParams().mode);

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
  const [showFilters, setShowFilters] = useState(false);
  const [showExclude, setShowExclude] = useState(false);
  const [activePreset, setActivePreset] = useState<Preset>("custom");
  const [batchStarted, setBatchStarted] = useState(false);
  const [lastBatchLabel, setLastBatchLabel] = useState("");

  const exclusions = excludeRaw.trim() ? parseExclusions(excludeRaw) : undefined;
  const excludeCount = (exclusions?.fidSet.size ?? 0) + (exclusions?.usernameSet.size ?? 0);

  // ── Switch mode ───────────────────────────────────────────────────────────

  function switchMode(next: PageMode) {
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

    if (initMode === "cleanup") {
      setListType("following");
      // Load own profile
      getUserByFid(myFid, myFid, neynarKey ?? "").then(res => {
        const u = res.users?.[0] ?? null;
        setOwnProfile(u);
      }).catch(() => { /* ignore */ });
    } else if (preloadFid) {
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
    const collected: NeynarUser[] = [];
    let cursor: string | undefined;

    try {
      do {
        const res = await fetchFn(fetchFid, myFid, neynarKey ?? "", cursor);
        // Handle both Hub-proxy format { user: NeynarUser }[] and Neynar v2 flat NeynarUser[]
        const batch = res.users.map((u: NeynarUser | { user: NeynarUser }) =>
          ("user" in u && u.user) ? (u as { user: NeynarUser }).user : (u as NeynarUser)
        ).filter(Boolean);
        collected.push(...batch);
        cursor = res.next?.cursor;
        setScanProgress({ pages: Math.ceil(collected.length / 100), found: collected.length });
        const interim = applyFilters(collected, batchMode, { ...currentFilters, limit: MAX_SCAN }, currentExclusions);
        if (interim.length >= currentFilters.limit) break;
      } while (cursor && collected.length < MAX_SCAN);
    } catch (e) {
      toast.error("Failed to load: " + (e instanceof Error ? e.message : "error"));
      setPhase("idle");
      return;
    }

    const result = applyFilters(collected, batchMode, currentFilters, currentExclusions);
    setAllUsers(result);
    setSelectedFids(new Set(result.map(u => u.fid)));
    setPhase(result.length === 0 ? "empty" : "loaded");
  }, [myFid, neynarKey]);

  function handleLoad() {
    const target = mode === "cleanup" ? ownProfile : targetUser;
    if (!target) return;
    const lt = mode === "cleanup" ? "following" : listType;
    loadList(target, lt, filters, mode, exclusions);
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
    batchOp.startOp({ mode: batchMode, users: selected, myFid, localSigner, neynarKey: neynarKey ?? "", label });
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
    setFilters({ ...DEFAULT_FILTERS, ...presetFilters });
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
    <div className="min-h-screen bg-background flex flex-col">

      {/* ── HEADER ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 bg-background/96 backdrop-blur-xl border-b border-border">
        <div className="h-[53px] flex items-center gap-3 px-4 max-w-[900px] mx-auto w-full">
          <button
            onClick={() => navigate("/dashboard")}
            className="p-2 -ml-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-[15px] text-foreground">{pageTitle}</h1>
            <p className="text-[11px] text-muted-foreground leading-none mt-0.5">{pageSubtitle}</p>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-[900px] w-full mx-auto flex flex-col lg:flex-row gap-0 lg:gap-6 px-0 lg:px-4 lg:py-4">

        {/* ── LEFT: CONTROLS ──────────────────────────────────────────── */}
        <div className="lg:w-[280px] lg:shrink-0 flex flex-col gap-4">

          {/* Mode switcher */}
          <div className="px-4 pt-4 lg:px-0 lg:pt-0">
            <div className="flex gap-1 p-1 bg-muted/40 rounded-xl border border-border">
              <button
                onClick={() => switchMode("follow")}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[12px] font-semibold transition-all",
                  mode === "follow"
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
                  mode === "cleanup"
                    ? "bg-rose-500 text-white shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Scissors className="w-3.5 h-3.5" />
                Clean Up
              </button>
            </div>
          </div>

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
                            <p className="text-[10px] text-muted-foreground">{(u.follower_count ?? 0).toLocaleString()} followers</p>
                          </div>
                          {hasPowerBadge(u) && <Zap className="w-3 h-3 text-amber-500 shrink-0" />}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Target user card */}
              {targetUser && (
                <div className="rounded-xl border border-border bg-card p-3 flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0 ring-1 ring-border">
                    {targetUser.pfp_url
                      ? <img src={targetUser.pfp_url} alt="" className="w-full h-full object-cover" />
                      : <span className="w-full h-full flex items-center justify-center text-sm font-bold text-primary bg-primary/10">{(targetUser.username || "?")[0].toUpperCase()}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-bold text-foreground truncate">{targetUser.display_name || targetUser.username}</p>
                    <p className="text-[11px] text-muted-foreground">@{targetUser.username}</p>
                    <div className="flex gap-3 mt-0.5">
                      <span className="text-[10px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{(targetUser.follower_count ?? 0).toLocaleString()}</span> followers
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        <span className="font-semibold text-foreground">{(targetUser.following_count ?? 0).toLocaleString()}</span> following
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
                            {count.toLocaleString()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Empty state — no target yet */}
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
                      <span className="font-semibold text-foreground">{(ownProfile.following_count ?? 0).toLocaleString()}</span> following
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

          {/* ── Presets + Filters (shown once a target is set) ── */}
          {canLoad && (
            <div className="px-4 lg:px-0 space-y-3">

              {/* Presets */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  Strategy
                </p>
                <div className="grid grid-cols-2 gap-1.5">
                  {presets.map(p => (
                    <button
                      key={p.id}
                      onClick={() => applyPreset(p.filters, p.id)}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-2 rounded-xl border text-[11px] font-semibold transition-all",
                        activePreset === p.id ? p.color : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/30",
                      )}
                    >
                      {p.icon}
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Filter toggle (mobile) */}
              <div className="lg:hidden">
                <button
                  onClick={() => setShowFilters(v => !v)}
                  className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl border border-border bg-muted/10 text-[12px] font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Filter className="w-3.5 h-3.5" />
                  Filters
                  {excludeCount > 0 && <span className="ml-auto text-rose-500">{excludeCount} excluded</span>}
                  <ChevronDown className={cn("w-3.5 h-3.5 ml-auto transition-transform", showFilters && "rotate-180")} />
                </button>
              </div>

              {/* Filter panel */}
              <div className={cn("space-y-3", !showFilters && "hidden lg:block")}>

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
                        <Toggle label="Mutuals only" sub="Only those who follow me" checked={filters.onlyMutuals} onChange={v => updateFilter("onlyMutuals", v)} icon={<Heart className="w-3.5 h-3.5" />} />
                      </div>
                      <div className="px-3">
                        <Toggle label="Power Badge only" checked={filters.onlyPowerBadge} onChange={v => updateFilter("onlyPowerBadge", v)} icon={<Zap className="w-3.5 h-3.5" />} />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="px-3">
                        <Toggle label="Non-followers only" sub="Skip people who follow me back" checked={filters.onlyNonFollowers} onChange={v => updateFilter("onlyNonFollowers", v)} icon={<UserMinus className="w-3.5 h-3.5" />} />
                      </div>
                      <div className="px-3">
                        <Toggle label="Keep mutuals" sub="Skip anyone who follows me back" checked={filters.skipMutuals} onChange={v => updateFilter("skipMutuals", v)} icon={<Heart className="w-3.5 h-3.5" />} />
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
        </div>

        {/* ── RIGHT: USER LIST ────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 border-t lg:border-t-0 lg:border-l border-border">

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
                  {lastBatchLabel} — the progress pill at the bottom tracks it live.
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
            <div className="flex flex-col h-full">
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

              {/* Scrollable list */}
              <div className="flex-1 overflow-y-auto divide-y divide-border/40 pb-24">
                {allUsers.map(user => (
                  <UserRow
                    key={user.fid}
                    user={user}
                    selected={selectedFids.has(user.fid)}
                    onToggle={() => toggleUser(user.fid)}
                    mode={mode}
                  />
                ))}
              </div>

              {/* Action bar */}
              <div className="sticky bottom-0 px-4 py-3 border-t border-border bg-background/98 backdrop-blur-md flex items-center gap-3">
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
      </div>
    </div>
  );
}
