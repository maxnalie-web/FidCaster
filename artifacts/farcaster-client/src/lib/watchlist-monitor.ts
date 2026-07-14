import { toast } from "sonner";
import { loadWatchlists, saveWatchlists } from "@/lib/watchlist";
import { loadActivityFeed, saveActivityFeed, type ActivityEvent, type ActivityEventKind } from "@/lib/activity-feed";

interface ListingSnapshot {
  active: boolean;
  buyable: boolean;
  priceEth?: string;
}

const SNAPSHOT_KEY = "watchlist_listing_snapshots";
const LAST_BLOCK_KEY = "watchlist_last_block";
const CHECK_INTERVAL_MS = 60_000;

function loadSnapshots(): Record<string, ListingSnapshot> {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function makeEvent(fid: number, kind: ActivityEventKind, message: string, priceEth?: string): ActivityEvent {
  return {
    id: `${fid}-${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    fid, kind, message, priceEth, timestamp: Date.now(), read: false,
  };
}

function getAllWatchedFids(myFid: number | null): Set<number> {
  if (!myFid) return new Set();
  const lists = loadWatchlists(myFid);
  return new Set(lists.flatMap(l => l.fids));
}

function addEvents(newEvents: ActivityEvent[]): void {
  if (newEvents.length === 0) return;
  const existing = loadActivityFeed();
  saveActivityFeed([...newEvents, ...existing]);
}

let checking = false;
let intervalHandle: ReturnType<typeof setInterval> | null = null;
let _myFid: number | null = null;

export function setWatchlistMonitorFid(fid: number | null): void {
  _myFid = fid;
}

export async function checkWatchlistOnce(): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    const watched = getAllWatchedFids(_myFid);
    if (watched.size === 0) return;

    const [listRes, activityRes] = await Promise.all([
      fetch("/api/fid-market/cached-listings"),
      fetch("/api/fid-market/activity"),
    ]);
    if (!listRes.ok) return;
    const listData = await listRes.json();
    const activityData = activityRes.ok ? await activityRes.json() : { activity: [] };

    const listings: Array<{ fid: number; active: boolean; buyable: boolean; priceEth: string; sigExpired: boolean; listingExpired: boolean }> = listData.listings ?? [];
    const activity: Array<{ fid: number; type: "listed" | "sold" | "cancelled"; priceEth: string; blockNumber: number; transactionHash: string }> = activityData.activity ?? [];

    const listingByFid = new Map(listings.map(l => [l.fid, l]));
    const snapshots = loadSnapshots();

    const rawLastBlock = (() => { try { const r = localStorage.getItem(LAST_BLOCK_KEY); return r ? Number(r) : undefined; } catch { return undefined; } })();
    const isFirstRun = rawLastBlock === undefined;
    const lastBlock = rawLastBlock ?? 0;
    const relevantActivity = activity.filter(a => watched.has(a.fid));
    let maxBlock = lastBlock;
    for (const a of relevantActivity) maxBlock = Math.max(maxBlock, a.blockNumber);

    const newActivity = isFirstRun
      ? []
      : relevantActivity.filter(a => a.blockNumber > lastBlock).sort((a, b) => a.blockNumber - b.blockNumber);

    const events: ActivityEvent[] = [];
    const consumedAsPriceDrop = new Set<string>();

    newActivity.forEach((item, i) => {
      const key = `${item.fid}-${item.blockNumber}-${item.transactionHash}`;
      if (item.type === "sold") {
        events.push(makeEvent(item.fid, "ownership_changed", `FID ${item.fid} sold for ${parseFloat(item.priceEth).toFixed(4)} ETH`, item.priceEth));
      } else if (item.type === "cancelled") {
        const relist = newActivity.find(
          (b, j) =>
            j > i &&
            b.fid === item.fid &&
            b.type === "listed" &&
            parseFloat(b.priceEth) < parseFloat(item.priceEth) &&
            !consumedAsPriceDrop.has(`${b.fid}-${b.blockNumber}-${b.transactionHash}`),
        );
        if (relist) {
          consumedAsPriceDrop.add(`${relist.fid}-${relist.blockNumber}-${relist.transactionHash}`);
          events.push(makeEvent(item.fid, "price_drop", `FID ${item.fid} price dropped to ${parseFloat(relist.priceEth).toFixed(4)} ETH`, relist.priceEth));
        } else {
          events.push(makeEvent(item.fid, "cancelled", `FID ${item.fid} listing was cancelled`));
        }
      } else if (item.type === "listed" && !consumedAsPriceDrop.has(key)) {
        events.push(makeEvent(item.fid, "listed", `FID ${item.fid} listed for ${parseFloat(item.priceEth).toFixed(4)} ETH`, item.priceEth));
      }
    });

    for (const fid of watched) {
      const cur = listingByFid.get(fid);
      const prev = snapshots[String(fid)];
      if (cur && prev && cur.active && prev.active && cur.buyable && !prev.buyable) {
        events.push(makeEvent(fid, "available_again", `FID ${fid} is available to buy again`));
      }
      snapshots[String(fid)] = { active: cur?.active ?? false, buyable: cur?.buyable ?? false, priceEth: cur?.priceEth };
    }

    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots)); } catch {}
    if (maxBlock > lastBlock) { try { localStorage.setItem(LAST_BLOCK_KEY, String(maxBlock)); } catch {} }

    if (events.length > 0) {
      addEvents(events);
      toast.info(events.length === 1 ? events[0].message : `${events.length} watchlist updates`, { duration: 4000 });
    }
  } catch (err) {
    console.warn("[watchlist] check failed", err);
  } finally {
    checking = false;
  }
}

export function startWatchlistMonitor(fid: number | null): () => void {
  _myFid = fid;
  checkWatchlistOnce();
  intervalHandle = setInterval(checkWatchlistOnce, CHECK_INTERVAL_MS);
  return () => {
    if (intervalHandle) clearInterval(intervalHandle);
    intervalHandle = null;
  };
}
