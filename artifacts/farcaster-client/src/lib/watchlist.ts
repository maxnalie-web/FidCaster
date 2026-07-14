import type { ActivityLevel } from "@/lib/fid-rating";

export interface WatchlistFilter {
  minPriceEth?: number;
  maxPriceEth?: number;
  minScore?: number;
  powerBadgeOnly?: boolean;
  minFollowers?: number;
  activityLevels?: ActivityLevel[];
}

export interface Watchlist {
  id: string;
  name: string;
  fids: number[];
  filter: WatchlistFilter;
  createdAt: number;
}

function listsKey(fid: number): string {
  return `watchlist_lists_${fid}`;
}

export function loadWatchlists(fid: number): Watchlist[] {
  try {
    const raw = localStorage.getItem(listsKey(fid));
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveWatchlists(fid: number, lists: Watchlist[]): void {
  try { localStorage.setItem(listsKey(fid), JSON.stringify(lists)); } catch {}
}

export function matchesFilter(
  filter: WatchlistFilter,
  info: { priceEth?: number; score?: number; powerBadge?: boolean; followerCount?: number; activity?: ActivityLevel },
): boolean {
  if (filter.minPriceEth !== undefined && (info.priceEth === undefined || info.priceEth < filter.minPriceEth)) return false;
  if (filter.maxPriceEth !== undefined && (info.priceEth === undefined || info.priceEth > filter.maxPriceEth)) return false;
  if (filter.minScore !== undefined && (info.score === undefined || info.score < filter.minScore)) return false;
  if (filter.powerBadgeOnly && !info.powerBadge) return false;
  if (filter.minFollowers !== undefined && (info.followerCount === undefined || info.followerCount < filter.minFollowers)) return false;
  if (filter.activityLevels?.length && (!info.activity || !filter.activityLevels.includes(info.activity))) return false;
  return true;
}

export function newWatchlistId(): string {
  return `wl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
