import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X, Zap, UserPlus, UserMinus, ChevronRight,
  Loader2, CheckCircle2, XCircle, Users, Shield,
  TrendingUp, Heart, Clock, SlidersHorizontal, RefreshCw, Ban, ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { hubFollow } from "@/lib/hub-submit";
import { getFollowers, getFollowing, hasPowerBadge, type NeynarUser } from "@/lib/neynar";
import type { LocalSigner } from "@/lib/wallet";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchMode = "follow" | "unfollow";

interface BatchFilters {
  limit: number;
  onlyPowerBadge: boolean;
  onlyMutuals: boolean;
  onlyNonFollowers: boolean;
  skipMutuals: boolean;
  minFollowers: number;
  maxFollowers: number;
}

type Preset = "balanced" | "quality" | "cleanup" | "aggressive" | "custom";

interface PresetDef {
  id: Preset;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  filters: Partial<BatchFilters>;
}

export interface BatchFollowSheetProps {
  mode: BatchMode;
  sourceFid: number;
  myFid: number;
  localSigner: LocalSigner;
  neynarKey: string;
  onClose: () => void;
  zIndex?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DELAY_MS = 2000;

const DEFAULT_FILTERS: BatchFilters = {
  limit: 50,
  onlyPowerBadge: false,
  onlyMutuals: false,
  onlyNonFollowers: false,
  skipMutuals: false,
  minFollowers: 0,
  maxFollowers: 0,
};

const FOLLOW_PRESETS: PresetDef[] = [
  {
    id: "balanced",
    label: "Balanced",
    desc: "Only people who already follow you",
    icon: <Heart className="w-4 h-4" />,
    color: "text-primary border-primary/30 bg-primary/8",
    filters: { limit: 50, onlyMutuals: true },
  },
  {
    id: "quality",
    label: "Quality",
    desc: "Power Badge holders only",
    icon: <Shield className="w-4 h-4" />,
    color: "text-amber-500 border-amber-500/30 bg-amber-500/8",
    filters: { limit: 50, onlyPowerBadge: true },
  },
  {
    id: "aggressive",
    label: "Growth",
    desc: "Max follows, no filters",
    icon: <TrendingUp className="w-4 h-4" />,
    color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/8",
    filters: { limit: 200 },
  },
  {
    id: "custom",
    label: "Custom",
    desc: "Set your own filters",
    icon: <SlidersHorizontal className="w-4 h-4" />,
    color: "text-muted-foreground border-border bg-muted/30",
    filters: {},
  },
];

const UNFOLLOW_PRESETS: PresetDef[] = [
  {
    id: "cleanup",
    label: "Ghost Clean",
    desc: "Unfollow non-followers only",
    icon: <RefreshCw className="w-4 h-4" />,
    color: "text-rose-500 border-rose-500/30 bg-rose-500/8",
    filters: { limit: 50, onlyNonFollowers: true, skipMutuals: true },
  },
  {
    id: "quality",
    label: "Safe",
    desc: "Keep mutuals & Power Badge",
    icon: <Shield className="w-4 h-4" />,
    color: "text-amber-500 border-amber-500/30 bg-amber-500/8",
    filters: { limit: 50, skipMutuals: true },
  },
  {
    id: "aggressive",
    label: "Mass",
    desc: "Unfollow everyone (no filter)",
    icon: <UserMinus className="w-4 h-4" />,
    color: "text-orange-500 border-orange-500/30 bg-orange-500/8",
    filters: { limit: 200 },
  },
  {
    id: "custom",
    label: "Custom",
    desc: "Set your own filters",
    icon: <SlidersHorizontal className="w-4 h-4" />,
    color: "text-muted-foreground border-border bg-muted/30",
    filters: {},
  },
];

const LIMIT_PRESETS = [10, 25, 50, 100, 250];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse raw exclusion text (usernames or FIDs, comma/newline separated) into sets */
function parseExclusions(raw: string): { fidSet: Set<number>; usernameSet: Set<string> } {
  const fidSet = new Set<number>();
  const usernameSet = new Set<string>();
  raw.split(/[\n,]+/).map(s => s.trim().replace(/^@/, "")).filter(Boolean).forEach(token => {
    const n = Number(token);
    if (!isNaN(n) && n > 0 && Number.isInteger(n)) fidSet.add(n);
    else usernameSet.add(token.toLowerCase());
  });
  return { fidSet, usernameSet };
}

function applyFilters(
  users: NeynarUser[],
  mode: BatchMode,
  filters: BatchFilters,
  exclusions?: { fidSet: Set<number>; usernameSet: Set<string> },
): NeynarUser[] {
  let list = [...users];
  if (mode === "follow") {
    list = list.filter(u => u.viewer_context?.following !== true);
    if (filters.onlyMutuals) list = list.filter(u => u.viewer_context?.followed_by === true);
    if (filters.onlyPowerBadge) list = list.filter(u => hasPowerBadge(u));
  } else {
    if (filters.skipMutuals || filters.onlyNonFollowers)
      list = list.filter(u => u.viewer_context?.followed_by !== true);
    if (filters.onlyPowerBadge) list = list.filter(u => hasPowerBadge(u));
  }
  if (filters.minFollowers > 0) list = list.filter(u => (u.follower_count ?? 0) >= filters.minFollowers);
  if (filters.maxFollowers > 0) list = list.filter(u => (u.follower_count ?? 0) <= filters.maxFollowers);
  if (exclusions) {
    list = list.filter(u =>
      !exclusions.fidSet.has(u.fid) &&
      !exclusions.usernameSet.has((u.username ?? "").toLowerCase())
    );
  }
  return list.slice(0, filters.limit);
}

function etaStr(count: number): string {
  const secs = count * (DELAY_MS / 1000);
  if (secs < 90) return `~${Math.round(secs)}s`;
  return `~${Math.round(secs / 60)}m`;
}

// ─── Component ────────────────────────────────────────────────────────────────

type Phase = "setup" | "fetching" | "confirm" | "running" | "done";

export function BatchFollowSheet({
  mode, sourceFid, myFid, localSigner, neynarKey, onClose, zIndex = "z-[70]",
}: BatchFollowSheetProps) {
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
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [fetchPg, setFetchPg] = useState({ pages: 0, found: 0 });
  const cancelRef = useRef(false);

  const exclusions = excludeRaw.trim() ? parseExclusions(excludeRaw) : undefined;
  const excludeCount = (exclusions?.fidSet.size ?? 0) + (exclusions?.usernameSet.size ?? 0);

  function selectPreset(p: PresetDef) {
    setActivePreset(p.id);
    if (p.id !== "custom") setFilters({ ...DEFAULT_FILTERS, ...p.filters });
  }

  function updateFilter<K extends keyof BatchFilters>(key: K, val: BatchFilters[K]) {
    setFilters(f => ({ ...f, [key]: val }));
    setActivePreset("custom");
  }

  const fetchUsers = useCallback(async () => {
    setPhase("fetching");
    setFetchPg({ pages: 0, found: 0 });
    cancelRef.current = false;
    const collected: NeynarUser[] = [];
    let cursor: string | undefined;
    const fetchFid = mode === "unfollow" ? myFid : sourceFid;
    try {
      do {
        if (cancelRef.current) break;
        const fn = mode === "unfollow" ? getFollowing : getFollowers;
        const res = await fn(fetchFid, myFid, neynarKey, cursor);
        const batch = res.users.map((u: { user: NeynarUser }) => u.user).filter(Boolean);
        collected.push(...batch);
        cursor = res.next?.cursor;
        setFetchPg({ pages: Math.ceil(collected.length / 50), found: collected.length });
        const filtered = applyFilters(collected, mode, filters);
        if (filtered.length >= filters.limit && !filters.onlyNonFollowers && !filters.skipMutuals && !filters.onlyMutuals) break;
      } while (cursor && collected.length < filters.limit * 8);
    } catch (e) {
      toast.error("Failed to load: " + (e instanceof Error ? e.message : "error"));
      setPhase("setup");
      return;
    }
    setFetchedUsers(applyFilters(collected, mode, filters, exclusions));
    setPhase("confirm");
  }, [mode, sourceFid, myFid, neynarKey, filters]);

  async function startOperation() {
    if (fetchedUsers.length === 0) { toast.info("No users match your filters"); return; }
    cancelRef.current = false;
    setProgress({ done: 0, total: fetchedUsers.length, errors: 0 });
    setPhase("running");
    let done = 0, errors = 0;
    for (let i = 0; i < fetchedUsers.length; i++) {
      if (cancelRef.current) break;
      try {
        await hubFollow(myFid, localSigner, fetchedUsers[i].fid, { unfollow: mode === "unfollow", neynarKey });
        done++;
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("429") || msg.toLowerCase().includes("rate")) {
          await new Promise(r => setTimeout(r, 62_000));
          if (!cancelRef.current) {
            try { await hubFollow(myFid, localSigner, fetchedUsers[i].fid, { unfollow: mode === "unfollow", neynarKey }); done++; }
            catch { errors++; }
          }
        } else { errors++; }
      }
      setProgress({ done, total: fetchedUsers.length, errors });
      if (i < fetchedUsers.length - 1 && !cancelRef.current)
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    setPhase("done");
  }

  function reset() {
    setPhase("setup");
    setFetchedUsers([]);
    setProgress({ done: 0, total: 0, errors: 0 });
    cancelRef.current = false;
    setExcludeOpen(false);
  }

  const pct = progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  const remaining = Math.max(0, progress.total - progress.done - progress.errors);
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
        onClick={phase === "running" ? undefined : onClose}
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
                        onClick={() => { updateFilter("limit", n); setCustomLimit(""); }}
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
                      type="number" min={1} max={500} placeholder="Other"
                      value={customLimit}
                      onChange={e => {
                        setCustomLimit(e.target.value);
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v > 0) updateFilter("limit", Math.min(500, v));
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
                      <Toggle label="Power Badge only" sub="Active & verified Farcaster users" icon={<Zap className="w-3.5 h-3.5 text-amber-500" />} checked={filters.onlyPowerBadge} onChange={v => updateFilter("onlyPowerBadge", v)} />
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
            <div className="px-5 py-12 flex flex-col items-center gap-5 min-h-[260px] justify-center">
              <div className="relative">
                <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center", accentIcon)}>
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
              </div>
              <div className="text-center">
                <p className="font-bold text-foreground">Loading users…</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {fetchPg.found} users found · page {fetchPg.pages}
                </p>
              </div>
              <button onClick={() => { cancelRef.current = true; setPhase("setup"); }} className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors">
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
                  {filters.onlyPowerBadge && <Chip label="Power Badge" />}
                  {filters.minFollowers > 0 && <Chip label={`≥ ${filters.minFollowers} followers`} />}
                  {filters.maxFollowers > 0 && <Chip label={`≤ ${filters.maxFollowers} followers`} />}
                </div>

                {/* Preview */}
                {fetchedUsers.length > 0 ? (
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
                        {hasPowerBadge(u) && <Zap className="w-3.5 h-3.5 text-amber-500 shrink-0" />}
                        {u.viewer_context?.followed_by && <Heart className="w-3.5 h-3.5 text-rose-400 shrink-0" />}
                      </div>
                    ))}
                    {fetchedUsers.length > 5 && (
                      <p className="text-[12px] text-muted-foreground pt-1 pl-11">+{fetchedUsers.length - 5} more</p>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3 py-6 text-muted-foreground">
                    <Users className="w-8 h-8 opacity-25" />
                    <p className="text-sm">No users match your filters.</p>
                    <button onClick={() => setPhase("setup")} className="text-sm text-primary underline underline-offset-2">
                      Adjust filters
                    </button>
                  </div>
                )}
              </div>

              {fetchedUsers.length > 0 && (
                <div className="px-5 py-4 border-t border-border flex gap-3">
                  <button onClick={() => setPhase("setup")} className="flex-1 py-3 rounded-2xl border border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 font-semibold text-sm transition-all">
                    Back
                  </button>
                  <button onClick={startOperation} className={cn("flex-[2] flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-[15px] transition-all active:scale-[0.98]", accentCls)}>
                    <Zap className="w-4 h-4" />
                    {mode === "follow" ? `Follow ${fetchedUsers.length}` : `Unfollow ${fetchedUsers.length}`}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ── RUNNING ───────────────────────────────────────────── */}
          {phase === "running" && (
            <div className="px-5 py-6 min-h-[320px] flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center", accentIcon)}>
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
                <div>
                  <h2 className="font-bold text-[15px] text-foreground">
                    {cancelRef.current ? "Stopping…" : mode === "follow" ? "Following…" : "Unfollowing…"}
                  </h2>
                  <p className="text-[12px] text-muted-foreground">
                    {etaStr(remaining)} remaining · 2s/action
                  </p>
                </div>
              </div>

              {/* Progress bar */}
              <div className="mb-4">
                <div className="flex justify-between text-[12px] text-muted-foreground mb-1.5">
                  <span>{progress.done} {mode === "follow" ? "followed" : "unfollowed"}</span>
                  <span className="font-mono font-bold text-foreground">{Math.round(pct)}%</span>
                  <span>{progress.total} total</span>
                </div>
                <div className="h-3 rounded-full bg-muted overflow-hidden">
                  <motion.div
                    className={cn("h-full rounded-full", mode === "follow" ? "bg-primary" : "bg-rose-500")}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
              </div>

              {/* Stat cards */}
              <div className="grid grid-cols-3 gap-2 mb-6">
                <StatCard label={mode === "follow" ? "Followed" : "Unfollowed"} value={progress.done} color="text-emerald-500" />
                <StatCard label="Errors" value={progress.errors} color="text-rose-400" />
                <StatCard label="Left" value={remaining} color="text-muted-foreground" />
              </div>

              <div className="mt-auto">
                <button
                  onClick={() => { cancelRef.current = true; }}
                  disabled={cancelRef.current}
                  className="w-full py-3 rounded-2xl border border-border text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 font-semibold text-sm transition-all disabled:opacity-40"
                >
                  Stop
                </button>
              </div>
            </div>
          )}

          {/* ── DONE ──────────────────────────────────────────────── */}
          {phase === "done" && (
            <div className="px-5 py-10 flex flex-col items-center gap-4 min-h-[280px] justify-center">
              {progress.done > 0
                ? <CheckCircle2 className={cn("w-12 h-12", mode === "follow" ? "text-primary" : "text-rose-500")} />
                : <XCircle className="w-12 h-12 text-rose-400" />
              }
              <div className="text-center">
                <p className="font-bold text-lg text-foreground">
                  {cancelRef.current ? `Stopped` : `Done!`}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  <span className="text-foreground font-bold">{progress.done}</span> {mode === "follow" ? "followed" : "unfollowed"}
                  {progress.errors > 0 && <> · <span className="text-rose-400">{progress.errors} failed</span></>}
                </p>
              </div>
              <div className="flex gap-3 w-full mt-3">
                <button onClick={reset} className="flex-1 py-3 rounded-2xl border border-border text-muted-foreground hover:text-foreground font-semibold text-sm transition-all">
                  Run again
                </button>
                <button onClick={onClose} className="flex-[2] py-3 rounded-2xl bg-muted text-foreground font-bold text-sm hover:bg-muted/70 transition-all">
                  Close
                </button>
              </div>
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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center py-2.5 px-2 rounded-xl bg-muted/30 border border-border">
      <span className={cn("text-xl font-black leading-none", color)}>{value}</span>
      <span className="text-[10px] text-muted-foreground font-medium mt-1">{label}</span>
    </div>
  );
}
