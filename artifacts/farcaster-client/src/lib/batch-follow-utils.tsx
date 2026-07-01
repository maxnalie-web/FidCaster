import { hasPowerBadge, type NeynarUser } from "@/lib/neynar";
import {
  Clock, History, Shuffle, Sparkles,
  Heart, Shield, TrendingUp, SlidersHorizontal,
  RefreshCw, UserMinus,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchMode = "follow" | "unfollow";

export type SortOrder = "newest" | "oldest" | "random" | "smart";

export type Preset = "balanced" | "quality" | "cleanup" | "aggressive" | "custom";

export interface BatchFilters {
  limit: number;
  onlyPowerBadge: boolean;
  onlyMutuals: boolean;
  onlyNonFollowers: boolean;
  skipMutuals: boolean;
  minFollowers: number;
  maxFollowers: number;
  sortOrder: SortOrder;
}

export interface PresetDef {
  id: Preset;
  label: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
  filters: Partial<BatchFilters>;
}

export interface SortOptionDef {
  id: SortOrder;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_FILTERS: BatchFilters = {
  limit: 50,
  onlyPowerBadge: false,
  onlyMutuals: false,
  onlyNonFollowers: false,
  skipMutuals: false,
  minFollowers: 0,
  maxFollowers: 0,
  sortOrder: "newest",
};

export const SORT_OPTIONS: SortOptionDef[] = [
  { id: "newest", label: "Newest", desc: "Most recent followers first",          icon: <Clock    className="w-3.5 h-3.5" /> },
  { id: "oldest", label: "Oldest", desc: "Earliest followers first",             icon: <History  className="w-3.5 h-3.5" /> },
  { id: "random", label: "Random", desc: "Shuffled — less predictable",          icon: <Shuffle  className="w-3.5 h-3.5" /> },
  { id: "smart",  label: "Smart",  desc: "Best follow-back probability first",   icon: <Sparkles className="w-3.5 h-3.5" /> },
];

export const FOLLOW_PRESETS: PresetDef[] = [
  { id: "balanced",   label: "Balanced", desc: "Only people who already follow you", icon: <Heart           className="w-4 h-4" />, color: "text-primary border-primary/30 bg-primary/8",             filters: { limit: 50, onlyMutuals: true } },
  { id: "quality",    label: "Quality",  desc: "Power Badge holders only",           icon: <Shield          className="w-4 h-4" />, color: "text-amber-500 border-amber-500/30 bg-amber-500/8",       filters: { limit: 50, onlyPowerBadge: true } },
  { id: "aggressive", label: "Growth",   desc: "Max follows, no filters",            icon: <TrendingUp      className="w-4 h-4" />, color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/8", filters: { limit: 200 } },
  { id: "custom",     label: "Custom",   desc: "Set your own filters",              icon: <SlidersHorizontal className="w-4 h-4" />, color: "text-muted-foreground border-border bg-muted/30",        filters: {} },
];

export const UNFOLLOW_PRESETS: PresetDef[] = [
  { id: "cleanup",    label: "Ghost Clean", desc: "Unfollow non-followers only",   icon: <RefreshCw         className="w-4 h-4" />, color: "text-rose-500 border-rose-500/30 bg-rose-500/8",       filters: { limit: 50, onlyNonFollowers: true, skipMutuals: true } },
  { id: "quality",    label: "Safe",        desc: "Keep mutuals & Power Badge",    icon: <Shield            className="w-4 h-4" />, color: "text-amber-500 border-amber-500/30 bg-amber-500/8",    filters: { limit: 50, skipMutuals: true } },
  { id: "aggressive", label: "Mass",        desc: "Unfollow everyone (no filter)", icon: <UserMinus         className="w-4 h-4" />, color: "text-orange-500 border-orange-500/30 bg-orange-500/8", filters: { limit: 200 } },
  { id: "custom",     label: "Custom",      desc: "Set your own filters",          icon: <SlidersHorizontal className="w-4 h-4" />, color: "text-muted-foreground border-border bg-muted/30",      filters: {} },
];

export const LIMIT_PRESETS = [100, 250, 500, 1000, 2000];

export const MAX_SCAN = 10_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function parseExclusions(raw: string): { fidSet: Set<number>; usernameSet: Set<string> } {
  const fidSet = new Set<number>();
  const usernameSet = new Set<string>();
  raw.split(/[\n,]+/).map(s => s.trim().replace(/^@/, "")).filter(Boolean).forEach(token => {
    const n = Number(token);
    if (!isNaN(n) && n > 0 && Number.isInteger(n)) fidSet.add(n);
    else usernameSet.add(token.toLowerCase());
  });
  return { fidSet, usernameSet };
}

export function smartScore(u: NeynarUser): number {
  let s = 0;
  if (hasPowerBadge(u)) s += 40;
  if (u.viewer_context?.followed_by === true) s += 30;
  const fc = u.follower_count ?? 0;
  if (fc >= 200 && fc <= 20_000) s += 20;
  else if (fc >= 50 && fc < 200) s += 10;
  else if (fc > 20_000 && fc <= 100_000) s += 5;
  s += Math.random() * 5;
  return s;
}

export function applyFilters(
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
  switch (filters.sortOrder) {
    case "oldest": list = list.reverse(); break;
    case "random":
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      break;
    case "smart": list = list.slice().sort((a, b) => smartScore(b) - smartScore(a)); break;
  }
  return list.slice(0, filters.limit);
}

export function etaStr(count: number): string {
  const secs = count * 2;
  if (secs < 90) return `~${Math.round(secs)}s`;
  return `~${Math.round(secs / 60)}m`;
}
