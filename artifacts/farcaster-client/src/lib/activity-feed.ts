export type ActivityEventKind = "listed" | "price_drop" | "cancelled" | "ownership_changed" | "available_again";

export interface ActivityEvent {
  id: string;
  fid: number;
  kind: ActivityEventKind;
  message: string;
  priceEth?: string;
  timestamp: number;
  read: boolean;
}

const FEED_KEY = "watchlist_activity_feed";
const MAX_EVENTS = 200;

export function loadActivityFeed(): ActivityEvent[] {
  try {
    const raw = localStorage.getItem(FEED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveActivityFeed(events: ActivityEvent[]): void {
  try { localStorage.setItem(FEED_KEY, JSON.stringify(events.slice(0, MAX_EVENTS))); } catch {}
}

export const EVENT_LABEL: Record<ActivityEventKind, string> = {
  listed:            "Listed for sale",
  price_drop:        "Price dropped",
  cancelled:         "Listing cancelled",
  ownership_changed: "Ownership changed",
  available_again:   "Available again",
};
