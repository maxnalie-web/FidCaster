import { type NeynarUser, neynarScore, hasPowerBadge, xAccount } from "@/lib/neynar";
import {
  Clock, History, Shuffle, Sparkles,
  Heart, Shield, TrendingUp, SlidersHorizontal,
  RefreshCw, UserMinus, Award, Users2,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BatchMode = "follow" | "unfollow";

export type SortOrder = "newest" | "oldest" | "random" | "smart";

export type Preset = "balanced" | "quality" | "cleanup" | "aggressive" | "network" | "custom";

export interface BatchFilters {
  limit: number;
  onlyPro: boolean;
  onlyMutuals: boolean;
  onlyNonFollowers: boolean;
  skipMutuals: boolean;
  minFollowers: number;
  maxFollowers: number;
  /** 0–100 (Neynar's 0–1 score ×100 for a friendlier UI number). 0 = no filter. */
  minNeynarScore: number;
  /** Only accounts holding the Farcaster Power Badge · strong "real, active user" signal. */
  requirePowerBadge: boolean;
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
  onlyPro: false,
  onlyMutuals: false,
  onlyNonFollowers: false,
  skipMutuals: false,
  minFollowers: 0,
  maxFollowers: 0,
  minNeynarScore: 0,
  requirePowerBadge: false,
  sortOrder: "newest",
};

export const SORT_OPTIONS: SortOptionDef[] = [
  { id: "newest", label: "Newest", desc: "Most recent followers first",          icon: <Clock    className="w-3.5 h-3.5" /> },
  { id: "oldest", label: "Oldest", desc: "Earliest followers first",             icon: <History  className="w-3.5 h-3.5" /> },
  { id: "random", label: "Random", desc: "Shuffled · less predictable",          icon: <Shuffle  className="w-3.5 h-3.5" /> },
  { id: "smart",  label: "Smart",  desc: "Best follow-back probability first",   icon: <Sparkles className="w-3.5 h-3.5" /> },
];

export const FOLLOW_PRESETS: PresetDef[] = [
  { id: "balanced",   label: "Mutuals",    desc: "People who already follow you, ranked by how likely they are to engage back",              icon: <Heart             className="w-4 h-4" />, color: "text-primary border-primary/30 bg-primary/8",             filters: { limit: 100, onlyMutuals: true, sortOrder: "smart" } },
  { id: "quality",    label: "Quality",    desc: "Established, real accounts: 500+ followers, Neynar score 40+, verified where possible",     icon: <Shield            className="w-4 h-4" />, color: "text-amber-500 border-amber-500/30 bg-amber-500/8",       filters: { limit: 100, minFollowers: 500, minNeynarScore: 40, sortOrder: "smart" } },
  { id: "network",    label: "Power Circle", desc: "Power Badge holders only, ranked by real engagement signals · highest follow-back rate", icon: <Award             className="w-4 h-4" />, color: "text-violet-500 border-violet-500/30 bg-violet-500/8",    filters: { limit: 100, requirePowerBadge: true, sortOrder: "smart" } },
  { id: "aggressive", label: "Growth",     desc: "Smart-ranked wide net across active accounts, tuned for maximum follow-back volume",         icon: <TrendingUp        className="w-4 h-4" />, color: "text-emerald-500 border-emerald-500/30 bg-emerald-500/8", filters: { limit: 500, sortOrder: "smart", minFollowers: 30, maxFollowers: 50000, minNeynarScore: 20 } },
  { id: "custom",     label: "Custom",     desc: "Set every filter yourself",                                                                  icon: <SlidersHorizontal className="w-4 h-4" />, color: "text-muted-foreground border-border bg-muted/30",         filters: {} },
];

export const UNFOLLOW_PRESETS: PresetDef[] = [
  { id: "cleanup",    label: "Ghost Clean", desc: "Unfollow accounts that never followed back · mutuals are always kept safe",             icon: <RefreshCw         className="w-4 h-4" />, color: "text-rose-500 border-rose-500/30 bg-rose-500/8",       filters: { limit: 50, skipMutuals: true } },
  { id: "quality",    label: "Safe",        desc: "Keep mutuals safe, unfollow only accounts that never followed you back",              icon: <Shield            className="w-4 h-4" />, color: "text-amber-500 border-amber-500/30 bg-amber-500/8",    filters: { limit: 100, skipMutuals: true } },
  { id: "network",    label: "Inactive",    desc: "Skip mutuals, target accounts with few followers · likely inactive or abandoned",       icon: <Users2            className="w-4 h-4" />, color: "text-violet-500 border-violet-500/30 bg-violet-500/8", filters: { limit: 100, skipMutuals: true, maxFollowers: 25 } },
  { id: "aggressive", label: "Mass",        desc: "Unfollow everyone regardless of mutual status · no safety filter, use with care",       icon: <UserMinus         className="w-4 h-4" />, color: "text-orange-500 border-orange-500/30 bg-orange-500/8", filters: { limit: 200 } },
  { id: "custom",     label: "Custom",      desc: "Set every filter yourself",                                                              icon: <SlidersHorizontal className="w-4 h-4" />, color: "text-muted-foreground border-border bg-muted/30",      filters: {} },
];

export const LIMIT_PRESETS = [100, 250, 500, 1000, 2000, 5000];

export const MAX_SCAN = 10_000; // 100 pages max · enough for high-limit requests (5000+)

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

  // Strongest signal: already follows me → near-guaranteed reciprocal
  if (u.viewer_context?.followed_by === true) s += 50;

  const fc = u.follower_count ?? 0;
  const fing = u.following_count ?? 0;

  // Follower count sweet spot: active but not mega-influencer
  if (fc >= 500 && fc <= 10_000) s += 18;
  else if (fc >= 100 && fc < 500) s += 14;
  else if (fc > 10_000 && fc <= 50_000) s += 9;
  else if (fc >= 30 && fc < 100) s += 6;
  else if (fc > 50_000) s += 1; // mega-accounts rarely follow back

  // Following/follower ratio: balanced = engaged account; very high = follow-backer
  if (fc > 0 && fing > 0) {
    const ratio = fing / fc;
    if (ratio >= 0.3 && ratio <= 2) s += 14;   // balanced, quality
    else if (ratio > 2 && ratio <= 5) s += 7;
    else if (ratio > 5 && ratio <= 12) s += 3;
    // ratio > 12 = aggressive follow-backer, no bonus
  }

  // Profile completeness signals
  if (u.pfp_url) s += 3;
  const bio = (u as NeynarUser & { profile?: { bio?: { text?: string } } }).profile?.bio?.text ?? "";
  if (bio.trim().length > 5) s += 5;

  // On-chain verified (real person)
  const eth = (u as NeynarUser & { verified_addresses?: { eth_addresses?: string[] } })
    .verified_addresses?.eth_addresses;
  if (Array.isArray(eth) && eth.length > 0) s += 8;

  // Power Badge · Warpcast's own "active, real, in-good-standing" signal
  if (hasPowerBadge(u)) s += 12;

  // Verified X/Twitter account · cross-platform identity, lower spam likelihood
  if (xAccount(u)) s += 6;

  // Neynar quality score, when available, is the strongest single signal we
  // have for "not spam" · weight it heavily rather than treating it as a
  // simple filter only.
  const q = neynarScore(u);
  if (q !== undefined) s += q * 25;

  // Tiny noise to break ties
  s += Math.random() * 2;

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
  } else {
    if (filters.skipMutuals || filters.onlyNonFollowers)
      list = list.filter(u => u.viewer_context?.followed_by !== true);
  }
  if (filters.minFollowers > 0) list = list.filter(u => (u.follower_count ?? 0) >= filters.minFollowers);
  if (filters.maxFollowers > 0) list = list.filter(u => (u.follower_count ?? 0) <= filters.maxFollowers);
  if (filters.requirePowerBadge) list = list.filter(u => hasPowerBadge(u));
  // Neynar score filter · quality gate (spam/low-effort accounts score low).
  // Users the API didn't return a score for are kept rather than dropped, since
  // a missing score isn't evidence of low quality, just an unscored account.
  if (filters.minNeynarScore > 0) {
    const threshold = filters.minNeynarScore / 100;
    list = list.filter(u => {
      const s = neynarScore(u);
      return s === undefined || s >= threshold;
    });
  }
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

// Measured average wall-clock time per follow/unfollow action end-to-end
// (sign + relay + inter-action delay) · used everywhere an ETA is shown so the
// pre-start estimate and the live progress-pill estimate always agree.
export const AVG_ACTION_SECS = 2.3;

export function etaStr(count: number): string {
  const secs = count * AVG_ACTION_SECS;
  if (secs < 90) return `~${Math.round(secs)}s`;
  return `~${Math.round(secs / 60)}m`;
}
