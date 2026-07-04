import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, UserPlus, UserMinus, ChevronRight,
  Loader2, Users, Shield,
  TrendingUp, Heart, Clock, SlidersHorizontal, RefreshCw, Ban, ChevronDown,
  Shuffle, Sparkles, History, ArrowUpNarrowWide,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getFollowers, getFollowing, type NeynarUser } from "@/lib/neynar";
import type { LocalSigner } from "@/lib/wallet";
import { toast } from "sonner";
import { useBatchOperation } from "@/hooks/BatchOperationContext";
import { useWallet } from "@/hooks/useWallet";

import type { BatchMode, SortOrder, BatchFilters, Preset, PresetDef } from "@/lib/batch-follow-utils";
import {
  DEFAULT_FILTERS, SORT_OPTIONS, FOLLOW_PRESETS, UNFOLLOW_PRESETS,
  LIMIT_PRESETS, MAX_SCAN, parseExclusions, applyFilters, etaStr,
} from "@/lib/batch-follow-utils";

export type { BatchMode, SortOrder };

export interface BatchFollowSheetProps {
  mode: BatchMode;
  sourceFid: number;
  myFid: number;
  localSigner: LocalSigner;
  neynarKey: string;
  onClose: () => void;
  zIndex?: string;
  /** Which list to scan: followers or following of sourceFid (defaults by mode) */
  fetchList?: "followers" | "following";
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DELAY_MS = 2000;

// ─── Component ────────────────────────────────────────────────────────────────

type Phase = "setup" | "fetching" | "confirm";

export function BatchFollowSheet({
  mode, sourceFid, myFid, localSigner, neynarKey, onClose, zIndex = "z-[70]", fetchList,
}: BatchFollowSheetProps) {
  const batchOp = useBatchOperation();
  const { profile: myProfile } = useWallet();
  const presets = mode === "follow" ? FOLLOW_PRESETS : UNFOLLOW_PRESETS;
  const [activePreset, setActivePreset] = useState<Preset>(presets[0].id);
  const [filters, setFilters] = useState<BatchFilters>({
    ...DEFAULT_FILTERS,
    ...presets[0].filters,
  });
  const [customLimit, setCustomLimit] = useState("");
  const [excludeRaw, setExcludeRaw] = useState("");
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("setup");
  const [fetchedUsers, setFetchedUsers] = useState<NeynarUser[]>([]);
  const [rawMatchCount, setRawMatchCount] = useState(0); // total matches before limit slice
  const [fetchPg, setFetchPg] = useState({ pages: 0, found: 0, pbFound: 0 });

  const exclusions = excludeRaw.trim() ? parseExclusions(excludeRaw) : undefined;
  const excludeCount = (exclusions?.fidSet.size ?? 0) + (exclusions?.usernameSet.size ?? 0);

  function selectPreset(p: PresetDef) {
    setActivePreset(p.id);
    if (p.id !== "custom") setFilters({ ...DEFAULT_FILTERS, ...p.filters });
    setCustomLimit("");
  }

  /** Change only the count · keeps the active strategy preset visually selected */
  function setLimitOnly(n: number) {
    setFilters(f => ({ ...f, limit: n }));
  }

  /** Change a real filter toggle · switches strategy to Custom */
  function updateFilter<K extends keyof BatchFilters>(key: K, val: BatchFilters[K]) {
    setFilters(f => ({ ...f, [key]: val }));
    if (key !== "limit") setActivePreset("custom");
  }

  const fetchUsers = useCallback(async () => {
    setPhase("fetching");
    setFetchPg({ pages: 0, found: 0, pbFound: 0 });
    const collected: NeynarUser[] = [];
    let cursor: string | undefined;
    let pbCount = 0;
    // Determine which list to scan and whose list it is
    const resolvedFetchList = fetchList ?? (mode === "unfollow" ? "following" : "followers");
    const fetchFid = mode === "unfollow" ? myFid : sourceFid;
    const fn = resolvedFetchList === "following" ? getFollowing : getFollowers;
    try {
      do {
        const res = await fn(fetchFid, myFid, neynarKey, cursor);
        // Handle both API shapes: flat NeynarUser[] and wrapped { user: NeynarUser }[]
      const batch = res.users.map((u: NeynarUser | { user: NeynarUser }) =>
        ("user" in u && u.user) ? (u as { user: NeynarUser }).user : (u as NeynarUser)
      ).filter(Boolean);
        collected.push(...batch);
        cursor = res.next?.cursor;
        setFetchPg({ pages: Math.ceil(collected.length / 100), found: collected.length, pbFound: 0 });
        // Stop as soon as we've found enough matching users (no need to scan the rest)
        const matched = applyFilters(collected, mode, { ...filters, limit: MAX_SCAN });
        if (matched.length >= filters.limit) break;
      } while (cursor && collected.length < MAX_SCAN);
    } catch (e) {
      toast.error("Failed to load: " + (e instanceof Error ? e.message : "error"));
      setPhase("setup");
      return;
    }
    // Count all matches (no limit) so we can show "found X of Y"
    const allMatched = applyFilters(collected, mode, { ...filters, limit: MAX_SCAN }, exclusions);
    setRawMatchCount(allMatched.length);
    setFetchedUsers(allMatched.slice(0, filters.limit));
    setPhase("confirm");
  }, [mode, fetchList, sourceFid, myFid, neynarKey, filters]);

  function startOperation() {
    if (fetchedUsers.length === 0) { toast.info("No users match your filters"); return; }
    const verb = mode === "follow" ? "Following" : "Unfollowing";
    const accountLabel = myProfile?.username ? `@${myProfile.username}` : `FID ${myFid}`;
    batchOp.startOp({
      mode,
      users: fetchedUsers,
      myFid,
      localSigner,
      neynarKey,
      label: `${verb} ${fetchedUsers.length} users`,
      accountLabel,
    });
    onClose(); // sheet closes · operation continues in background pill
  }

  function reset() {
    setPhase("setup");
    setFetchedUsers([]);
    setRawMatchCount(0);
    setExcludeOpen(false);
  }

  const accent = mode === "follow" ? "primary" : "rose-500";
  const accentCls = mode === "follow"
    ? "bg-primary text-white hover:bg-primary/90"
    : "bg-rose-500 text-white hover:bg-rose-500/90";
  const accentIcon = mode === "follow"
    ? "bg-primary/10 text-primary"
    : "bg-rose-500/10 text-rose-500";
  void accent;

  return (
    <div className={cn("fixed inset-0", zIndex)}>
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <AnimatePresence mode="wait">
        <motion.div
          key="sheet"
          initial={{ y: "100%", opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 32, stiffness: 320 }}
          className="absolute bottom-0 left-0 right-0 md:left-1/2 md:right-auto md:-translate-x-1/2 md:bottom-10 w-full md:w-[460px] bg-background border border-border rounded-t-3xl md:rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* ── SETUP ─────────────────────────────────────────────── */}
          {phase === "setup" && (
            <div>
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", accentIcon)}>
                    {mode === "follow" ? <UserPlus className="w-4 h-4" /> : <UserMinus className="w-4 h-4" />}
                  </div>
                  <div>
                    <h2 className="font-bold text-[15px] text-foreground leading-tight">
                      {mode === "follow" ? "Batch Follow" : "Batch Unfollow"}
                    </h2>
                    <p className="text-[11px] text-muted-foreground">
                      {mode === "follow" ? "Smart bulk follow with filters" : "Clean up your following list"}
                    </p>
                  </div>
                </div>
                <button onClick={onClose} className="p-1.5 rounded-full hover:bg-accent transition-colors text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-5 py-4 space-y-5 max-h-[72vh] overflow-y-auto">
                {/* Strategy */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">Strategy</p>
                  <div className="grid grid-cols-2 gap-2">
                    {presets.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => selectPreset(p)}
                        className={cn(
                          "flex items-start gap-2.5 p-3 rounded-xl border text-left transition-all",
                          activePreset === p.id
                            ? cn(p.color, "border-current shadow-sm")
                            : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/30"
                        )}
                      >
                        <span className="shrink-0 mt-0.5">{p.icon}</span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-semibold truncate">{p.label}</p>
                          <p className="text-[11px] opacity-70 leading-snug mt-0.5">{p.desc}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Count */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5">
                    How many · <span className="text-foreground font-bold normal-case">{filters.limit} users</span>
                  </p>
                  <div className="flex gap-2 flex-wrap items-center">
                    {LIMIT_PRESETS.map(n => (
                      <button
                        key={n}
                        onClick={() => { setLimitOnly(n); setCustomLimit(""); }}
                        className={cn(
                          "px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-all",
                          filters.limit === n && !customLimit
                            ? accentCls + " border-transparent"
                            : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"
                        )}
                      >
                        {n}
                      </button>
                    ))}
                    <input
                      type="number" min={1} max={10000} placeholder="Other"
                      value={customLimit}
                      onChange={e => {
                        setCustomLimit(e.target.value);
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v > 0) setLimitOnly(Math.min(10_000, v));
                      }}
                      className="w-20 px-3 py-1.5 rounded-full text-[13px] font-semibold border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 text-center"
                    />
                  </div>
                </div>

                {/* Filters */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Filters</p>
                  <div className="divide-y divide-border/50">
                    {mode === "follow" && <>
                      <Toggle label="Only users who follow me back" sub="High follow-back probability" icon={<Heart className="w-3.5 h-3.5" />} checked={filters.onlyMutuals} onChange={v => updateFilter("onlyMutuals", v)} />
                    </>}
                    {mode === "unfollow" && <>
                      <Toggle label="Skip mutuals (they follow me)" sub="Keep real connections safe" icon={<Heart className="w-3.5 h-3.5" />} checked={filters.skipMutuals} onChange={v => updateFilter("skipMutuals", v)} />
                      <Toggle label="Non-followers only (ghost cleaner)" sub="Unfollow people who don't follow back" icon={<Users className="w-3.5 h-3.5" />} checked={filters.onlyNonFollowers} onChange={v => updateFilter("onlyNonFollowers", v)} />
                    </>}
                    {/* Min followers */}
                    <div className="flex items-center gap-3 py-3">
                      <TrendingUp className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                      <span className="text-[13px] text-foreground flex-1">Min followers</span>
                      <input type="number" min={0} placeholder="Any" value={filters.minFollowers || ""}
                        onChange={e => updateFilter("minFollowers", Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-20 px-2.5 py-1 rounded-lg text-[13px] border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 text-right" />
                    </div>
                    <div className="flex items-center gap-3 py-3">
                      <TrendingUp className="w-3.5 h-3.5 shrink-0 text-muted-foreground opacity-50" />
                      <span className="text-[13px] text-foreground flex-1">Max followers</span>
                      <input type="number" min={0} placeholder="Any" value={filters.maxFollowers || ""}
                        onChange={e => updateFilter("maxFollowers", Math.max(0, parseInt(e.target.value) || 0))}
                        className="w-20 px-2.5 py-1 rounded-lg text-[13px] border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 text-right" />
                    </div>
                  </div>
                </div>

                {/* Order */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <ArrowUpNarrowWide className="w-3 h-3" />
                    Order
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                    {SORT_OPTIONS.map(opt => (
                      <button
                        key={opt.id}
                        onClick={() => updateFilter("sortOrder", opt.id)}
                        title={opt.desc}
                        className={cn(
                          "flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl border text-center transition-all",
                          filters.sortOrder === opt.id
                            ? accentCls + " border-transparent shadow-sm"
                            : "border-border bg-muted/10 text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                        )}
                      >
                        <span className="shrink-0">{opt.icon}</span>
                        <span className="text-[11px] font-semibold leading-none">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1.5 pl-0.5">
                    {SORT_OPTIONS.find(o => o.id === filters.sortOrder)?.desc}
                  </p>
                </div>

                {/* Exclusion list */}
                <div className="rounded-xl border border-border overflow-hidden">
                  <button
                    onClick={() => setExcludeOpen(v => !v)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-accent/30 transition-colors text-left"
                  >
                    <Ban className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                    <span className="text-[13px] font-medium text-foreground flex-1">Skip these users</span>
                    {excludeCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                        {excludeCount}
                      </span>
                    )}
                    <ChevronDown className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", excludeOpen && "rotate-180")} />
                  </button>
                  {excludeOpen && (
                    <div className="px-4 pb-4 border-t border-border/60">
                      <p className="text-[11px] text-muted-foreground mt-3 mb-2">
                        Enter FIDs or usernames (one per line or comma-separated). These accounts will never be touched.
                      </p>
                      <textarea
                        value={excludeRaw}
                        onChange={e => setExcludeRaw(e.target.value)}
                        placeholder={"@dwr.eth\nvitalik.eth\n12345, 67890"}
                        rows={4}
                        className="w-full px-3 py-2.5 rounded-xl text-[12px] font-mono border border-border bg-muted/20 text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary/50 resize-none leading-relaxed"
                      />
                      {excludeCount > 0 && (
                        <p className="text-[11px] text-emerald-500 mt-1.5 font-medium">
                          {excludeCount} account{excludeCount !== 1 ? "s" : ""} will be skipped
                        </p>
                      )}
                    </div>
                  )}
                </div>

                {/* Rate info */}
                <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-muted/20 border border-border">
                  <Clock className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    2s between each action · ~30/min per account · within hub limits ·{" "}
                    <span className="text-foreground font-semibold">{etaStr(filters.limit)} est.</span>
                  </p>
                </div>
              </div>

              <div className="px-5 py-4 border-t border-border">
                <button
                  onClick={fetchUsers}
                  className={cn("w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98]", accentCls)}
                >
                  <ChevronRight className="w-4 h-4" />
                  Preview users & start
                </button>
              </div>
            </div>
          )}

          {/* ── FETCHING ──────────────────────────────────────────── */}
          {phase === "fetching" && (
            <div className="px-5 py-12 flex flex-col items-center gap-5 min-h-[280px] justify-center">
              <div className="relative">
                <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center", accentIcon)}>
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              </div>
              <div className="text-center space-y-1.5">
                <p className="font-bold text-foreground">Scanning users…</p>
                <p className="text-sm text-muted-foreground">
                  {fetchPg.found.toLocaleString()} scanned · page {fetchPg.pages}
                </p>
                {false && (
                  <p className="text-[12px] font-semibold text-amber-500">
                    ⚡ {fetchPg.pbFound} Power Badge found so far
                  </p>
                )}
                {false && fetchPg.pages > 20 && fetchPg.pbFound === 0 && (
                  <p className="text-[11px] text-muted-foreground max-w-[220px] mx-auto leading-snug">
                    Still scanning… Power Badge users are rare. This may take a while.
                  </p>
                )}
              </div>
              <button onClick={() => setPhase("setup")} className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors">
                Cancel
              </button>
            </div>
          )}

          {/* ── CONFIRM ───────────────────────────────────────────── */}
          {phase === "confirm" && (
            <div>
              <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
                <h2 className="font-bold text-[15px] text-foreground">Ready to {mode}</h2>
                <button onClick={() => setPhase("setup")} className="text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors">
                  ← Edit filters
                </button>
              </div>

              <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
                {/* Summary */}
                <div className={cn("rounded-2xl p-4 border flex items-center gap-4",
                  mode === "follow" ? "bg-primary/6 border-primary/20" : "bg-rose-500/6 border-rose-500/20")}>
                  <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center font-black text-2xl shrink-0",
                    mode === "follow" ? "bg-primary/15 text-primary" : "bg-rose-500/15 text-rose-500")}>
                    {fetchedUsers.length}
                  </div>
                  <div>
                    <p className="font-bold text-foreground text-[15px] leading-snug">
                      {fetchedUsers.length} user{fetchedUsers.length !== 1 ? "s" : ""} will be {mode === "follow" ? "followed" : "unfollowed"}
                    </p>
                    <p className="text-[12px] text-muted-foreground mt-1">
                      Est. {etaStr(fetchedUsers.length)} · 2s per action · hub-safe
                    </p>
                  </div>
                </div>

                {/* Active filter chips */}
                <div className="flex flex-wrap gap-1.5">
                  <Chip label={`${filters.limit} max`} />
                  {filters.onlyMutuals && <Chip label="Mutual followers" />}
                  {filters.onlyNonFollowers && <Chip label="Non-followers only" />}
                  {filters.skipMutuals && <Chip label="Skip mutuals" />}
                  {filters.minFollowers > 0 && <Chip label={`≥ ${filters.minFollowers} followers`} />}
                  {filters.maxFollowers > 0 && <Chip label={`≤ ${filters.maxFollowers} followers`} />}
                </div>

                {/* Partial-results warning */}
                {rawMatchCount < filters.limit && rawMatchCount > 0 && (
                  <div className="flex items-start gap-3 px-3 py-3 rounded-xl bg-amber-500/8 border border-amber-500/20">
                    <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-[12px] leading-snug">
                      <p className="font-semibold text-amber-600 dark:text-amber-400">
                        Only {rawMatchCount.toLocaleString()} found (wanted {filters.limit.toLocaleString()})
                      </p>
                      <p className="text-muted-foreground mt-0.5">
                        Scanned {fetchPg.found.toLocaleString()} users · no more match your filters. You can continue with these {rawMatchCount} or go back and change the filters.
                      </p>
                    </div>
                  </div>
                )}
                {rawMatchCount === 0 && (
                  <div className="flex flex-col items-center gap-3 py-4 text-muted-foreground">
                    <Users className="w-8 h-8 opacity-25" />
                    <div className="text-center space-y-1">
                      <p className="text-sm font-semibold text-foreground">0 matches found</p>
                      <p className="text-[12px]">
                        Scanned {fetchPg.found.toLocaleString()} users · none matched your filters.
                      </p>
                    </div>
                    <button onClick={() => setPhase("setup")} className="text-sm text-primary underline underline-offset-2">
                      Adjust filters
                    </button>
                  </div>
                )}

                {/* Preview */}
                {fetchedUsers.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Preview (first 5)</p>
                    {fetchedUsers.slice(0, 5).map(u => (
                      <div key={u.fid} className="flex items-center gap-3 py-2">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-muted shrink-0">
                          {u.pfp_url
                            ? <img src={u.pfp_url} alt={u.username} className="w-full h-full object-cover" />
                            : <span className="w-full h-full flex items-center justify-center text-xs font-bold text-primary bg-primary/10">{u.username?.[0]?.toUpperCase()}</span>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-foreground truncate">@{u.username}</p>
                          <p className="text-[11px] text-muted-foreground">{(u.follower_count ?? 0).toLocaleString()} followers</p>
                        </div>
                        {u.viewer_context?.followed_by && <Heart className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                      </div>
                    ))}
                    {fetchedUsers.length > 5 && (
                      <p className="text-[12px] text-muted-foreground pt-1 pl-11">+{fetchedUsers.length - 5} more</p>
                    )}
                  </div>
                )}
              </div>

              {fetchedUsers.length > 0 && (
                <div className="px-5 py-4 border-t border-border flex gap-3">
                  <button onClick={() => setPhase("setup")} className="flex-1 py-3 rounded-2xl border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 font-semibold text-sm transition-all">
                    Back
                  </button>
                  <button onClick={startOperation} className={cn("flex-[2] flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98]", accentCls)}>
                    <UserPlus className="w-4 h-4" />
                    {mode === "follow" ? `Follow ${fetchedUsers.length}` : `Unfollow ${fetchedUsers.length}`}
                  </button>
                </div>
              )}
            </div>
          )}

        </motion.div>
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({ label, sub, checked, onChange, icon }: {
  label: string; sub: string; checked: boolean;
  onChange: (v: boolean) => void; icon?: React.ReactNode;
}) {
  return (
    <button onClick={() => onChange(!checked)} className="flex items-center gap-3 py-3 w-full text-left">
      <span className="shrink-0 text-muted-foreground w-4 flex items-center justify-center">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-foreground leading-tight">{label}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>
      </div>
      <div className={cn("relative shrink-0 w-10 h-5 rounded-full border transition-all duration-200",
        checked ? "bg-primary border-primary" : "bg-muted border-border")}>
        <motion.div
          className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
          animate={{ left: checked ? "calc(100% - 18px)" : "2px" }}
          transition={{ type: "spring", damping: 22, stiffness: 400 }}
        />
      </div>
    </button>
  );
}

function Chip({ label }: { label: string }) {
  return (
    <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-muted/50 border border-border text-muted-foreground">
      {label}
    </span>
  );
}

