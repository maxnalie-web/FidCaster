import type { Express } from "express";
import rateLimit from "express-rate-limit";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, createWalletClient, http, fallback, formatEther, parseTransaction,
  type Address,
} from "viem";
import { optimism } from "viem/chains";
import { singleFlight } from "./neynar-limit.js";
import { logUserAction, type ActionType } from "./actions-ledger-store.js";

const VALID_ETH_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const VALID_HEX_STRING = /^0x[0-9a-fA-F]+$/;

function isValidAddress(addr: unknown): addr is `0x${string}` {
  return typeof addr === "string" && VALID_ETH_ADDRESS.test(addr);
}

function isValidHex(hex: unknown): hex is `0x${string}` {
  return typeof hex === "string" && VALID_HEX_STRING.test(hex);
}

const marketReadLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const marketWriteLimiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Read at call time so env loaded in index.ts is visible (module-level const would be stale)
function getNeynarKey() { return process.env.NEYNAR_API_KEY || ""; }
export const FID_MARKET_ADDRESS = "0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3" as const;
const ID_REGISTRY_ADDRESS = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b" as const;
const FEE_BPS = 900;

const optimismClient = createPublicClient({
  chain: optimism,
  transport: fallback(
    [
      "https://mainnet.optimism.io",
      "https://optimism.llamarpc.com",
      "https://1rpc.io/op",
      "https://optimism.drpc.org",
      "https://optimism-rpc.publicnode.com",
    ].map((url) => http(url, { timeout: 15000, retryCount: 2 })),
    { rank: true }
  ),
});

// Dedicated lightweight client for contract reads - uses same fallback pool as optimismClient
// but without rank probing (avoids extra RPC calls during batch scans)
const readClient = createPublicClient({
  chain: optimism,
  transport: fallback(
    [
      "https://optimism.llamarpc.com",
      "https://mainnet.optimism.io",
      "https://optimism-rpc.publicnode.com",
      "https://optimism.drpc.org",
    ].map((url) => http(url, { timeout: 10000, retryCount: 1 })),
    { rank: false }
  ),
});

const idRegistryAbi = [
  {
    name: "idOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "fid", type: "uint256" }],
  },
  {
    name: "custodyOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "fid", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

const fidMarketAbi = [
  {
    name: "listings",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "fid", type: "uint256" }],
    outputs: [
      { name: "seller", type: "address" },
      { name: "priceWei", type: "uint256" },
      { name: "fromDeadline", type: "uint256" },
      { name: "fromSig", type: "bytes" },
      { name: "listedAt", type: "uint64" },
    ],
  },
  {
    name: "credits",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "addr", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "paused",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

// Real on-chain topic hashes (verified from live logs - event names in bytecode differ from ABI guesses)
const LISTED_TOPIC   = "0xfb1726c338f0dfd05a26a0e8764ed02544cf83687d8d0f82eb3e177d35e47c4e" as `0x${string}`;
const CANCELLED_TOPIC = "0x26deca31ff8139a06c52453ce8985d34f7648a6d9af1d283c4063d052c355a0f" as `0x${string}`;
// Bought topic candidates (no trades yet; will auto-detect from first real trade)
const BOUGHT_TOPIC_CANDIDATES: `0x${string}`[] = [
  "0x39a259c9be698827d9b797bc664b90f310b0f58f7f74df05f0be40a8283ec222",
  "0xa3b62bc36326052d97ea62d63c3d60308ed4c3ea8ac079dd8499f1e9c4f80c0f",
  "0x9e2f5c2330afb3c7cfcf473e62546420851afccbeaf15b45b799f048243170aa",
  "0x44d6d25963f097ad14f29f06854a01f575648a1ef82f30e562ccd3889717e339",
  "0x592a032e7884ba506196d55a5fc14b6dd3f8f1a70beaf433d32006136a513758",
  "0xa58eabed0d7a06e6be26cc28514851bd33923b7a87a3c6674166ebac5ba12430",
];
let confirmedBoughtTopic: `0x${string}` | null = null;

export interface CachedListing {
  fid: number;
  seller: string;
  priceWei: string;
  priceEth: string;
  fromDeadline: number;
  listedAt: number;
  active: boolean;
  sigExpired: boolean;
  listingExpired: boolean;
  buyable: boolean;
}

export interface CachedTrade {
  fid: number;
  seller: string;
  buyer: string;
  priceWei: string;
  priceEth: string;
  feeWei: string;
  blockNumber: number;
  transactionHash: string;
}

export interface CachedActivity {
  type: "listed" | "sold" | "cancelled";
  fid: number;
  seller: string;
  buyer?: string;
  priceWei: string;
  priceEth: string;
  blockNumber: number;
  transactionHash: string;
  /** Unix seconds - unified sort key across real events (approx from block) and
   *  synthetic listed entries (exact listedAt). Lets us interleave correctly. */
  ts: number;
}

let listingsCache: CachedListing[] = [];
let listingsCacheTime = 0;
let tradesCache: CachedTrade[] = [];
let tradesCacheTime = 0;
let totalTradedEth = "0";
let activityCache: CachedActivity[] = [];
let trackedFids = new Set<number>();
const MAX_TRACKED_FIDS = 50_000;

// Generic TTL cache for expensive lookups (Neynar profile, wallet→FID, per-FID data)
class TtlCache<V> {
  private store = new Map<string, { value: V; exp: number }>();
  constructor(private ttlMs: number) {}
  get(key: string): V | undefined {
    const e = this.store.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this.store.delete(key); return undefined; }
    return e.value;
  }
  set(key: string, value: V) { this.store.set(key, { value, exp: Date.now() + this.ttlMs }); }
  size() { return this.store.size; }
  prune() { const now = Date.now(); for (const [k, v] of this.store) if (now > v.exp) this.store.delete(k); }
}

const fidInfoCache  = new TtlCache<unknown>(5 * 60_000);   // Neynar profiles - 5 min
const walletFidCache = new TtlCache<number | null>(10 * 60_000); // wallet→FID - 10 min
const fidDataCache  = new TtlCache<unknown>(30_000);         // per-FID listing - 30 s

// Prune expired entries every 10 minutes
setInterval(() => { fidInfoCache.prune(); walletFidCache.prune(); fidDataCache.prune(); }, 10 * 60_000);
let initialScanDone = false;
let tradesInitialDone = false;
let lastScannedBlock = BigInt(0);

// Listings can stay valid for up to 30 days (~1.3M Optimism blocks @ 2s). The
// cold-start discovery scan must cover that whole window, else still-active
// listings whose Listed event has scrolled out get dropped. Incremental
// refreshes only need a small recent window because trackedFids is persisted +
// accumulated (a discovered FID is always re-verified on-chain regardless).
const INITIAL_SCAN_RANGE = BigInt(1_300_000);
const EVENT_SCAN_RANGE = BigInt(50_000);
const LOG_CHUNK_SIZE = BigInt(5_000);
let isRefreshingListings = false;

// ── Persist trackedFids across restarts ───────────────────────────────────────
// trackedFids is the ONLY source of which FIDs get re-checked on-chain. Losing it
// on restart is what made active listings disappear (5 → 1). Persist to disk so a
// FID, once discovered, is always re-verified regardless of event-scan window.
const TRACKED_FILE = join(import.meta.dirname, ".fidmarket-tracked.json");
let lastPersistedSize = -1;

function loadTrackedFids() {
  try {
    const arr = JSON.parse(readFileSync(TRACKED_FILE, "utf8"));
    if (Array.isArray(arr)) {
      for (const n of arr) {
        const fid = Number(n);
        if (Number.isInteger(fid) && fid > 0 && trackedFids.size < MAX_TRACKED_FIDS) trackedFids.add(fid);
      }
    }
  } catch { /* no file yet - first run */ }
}

function persistTrackedFids() {
  if (trackedFids.size === lastPersistedSize) return;
  try {
    writeFileSync(TRACKED_FILE, JSON.stringify(Array.from(trackedFids)));
    lastPersistedSize = trackedFids.size;
  } catch (err) {
    console.error("[FidMarket] persist trackedFids failed:", err);
  }
}

// Chunks fetched with bounded concurrency, not one-at-a-time. The initial
// discovery scan now covers up to 1.3M blocks (30-day listings, see
// INITIAL_SCAN_RANGE) - that's ~260 chunks per topic at the old fully
// sequential pace, several minutes of wall-clock time against free public
// RPC nodes. In practice that was slow/fragile enough (timeouts, rate
// limits) to leave trackedFids empty and the whole market page blank.
// Fetching a bounded number of chunks in parallel, with one retry per
// chunk, cuts wall-clock time by roughly the concurrency factor while
// staying gentle enough not to trip rate limits itself.
const LOG_FETCH_CONCURRENCY = 8;

async function getLogsRaw(fromBlock: bigint, toBlock: bigint, chunkSize: bigint, topic: `0x${string}`) {
  const ranges: Array<{ from: bigint; to: bigint }> = [];
  for (let from = fromBlock; from <= toBlock; ) {
    const to = from + chunkSize - 1n > toBlock ? toBlock : from + chunkSize - 1n;
    ranges.push({ from, to });
    from = to + 1n;
  }

  const logs: any[] = [];
  async function fetchOne(range: { from: bigint; to: bigint }, retried = false): Promise<void> {
    try {
      const chunk = await optimismClient.getLogs({
        address: FID_MARKET_ADDRESS,
        topics: [[topic]],
        fromBlock: range.from,
        toBlock: range.to,
      });
      logs.push(...chunk);
    } catch (err: any) {
      if (!retried) return fetchOne(range, true);
      console.error(`[FidMarket] getLogsRaw chunk ${range.from}-${range.to} topic=${topic.slice(0, 10)} err:`, err?.shortMessage || err?.message);
    }
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < ranges.length) {
      const range = ranges[cursor++];
      await fetchOne(range);
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOG_FETCH_CONCURRENCY, ranges.length) }, worker));

  return logs;
}

function parseFidFromTopic(t: string): number {
  try { return Number(BigInt(t)); } catch { return 0; }
}
function parseAddressFromTopic(t: string): string {
  return ("0x" + t.slice(26)).toLowerCase();
}

async function readFidListing(fid: number): Promise<CachedListing | null> {
  try {
    const result = await readClient.readContract({
      address: FID_MARKET_ADDRESS,
      abi: fidMarketAbi,
      functionName: "listings",
      args: [BigInt(fid)],
    });
    const [seller, priceWei, fromDeadline, , listedAt] = result as [string, bigint, bigint, unknown, bigint];
    if (!seller || seller === "0x0000000000000000000000000000000000000000") return null;
    const now = Math.floor(Date.now() / 1000);
    const deadlineNum = Number(fromDeadline);
    const listedAtNum = Number(listedAt);
    const sigExpired = deadlineNum > 0 && deadlineNum < now;
    // A listing is only truly expired once the seller's signed deadline passes
    // (the contract enforces `fromDeadline`, which the seller sets from the chosen
    // duration · up to 30 days). The old fixed 7-day cap wrongly marked longer
    // listings expired after a week even though they were still buyable on-chain.
    const listingExpired = deadlineNum > 0
      ? deadlineNum < now
      : (listedAtNum > 0 && now - listedAtNum > 30 * 24 * 3600);
    const active = !!seller && seller !== "0x0000000000000000000000000000000000000000";
    const buyable = active && !sigExpired && !listingExpired && priceWei > BigInt(0);
    return {
      fid,
      seller: seller.toLowerCase(),
      priceWei: priceWei.toString(),
      priceEth: formatEther(priceWei),
      fromDeadline: deadlineNum,
      listedAt: listedAtNum,
      active,
      sigExpired,
      listingExpired,
      buyable,
    };
  } catch (err: any) {
    console.error(`[FidMarket] readFidListing(${fid}) error:`, err?.shortMessage || err?.message || err);
    return null;
  }
}

// Raw activity snapshots - accumulated across scans so the feed stays complete.
// Each refresh only scans a recent block window; replacing (not merging) these
// would shrink the feed to the last ~27h after the wide initial scan. We merge +
// dedup by txHash:type:fid and cap so activity grows and persists between scans.
let _pendingListedActivity: CachedActivity[] = [];
let _pendingCancelledActivity: CachedActivity[] = [];
let _pendingSoldActivity: CachedActivity[] = [];

const ACTIVITY_ACCUM_CAP = 400;
function mergeActivity(existing: CachedActivity[], incoming: CachedActivity[]): CachedActivity[] {
  const seen = new Set<string>();
  const out: CachedActivity[] = [];
  for (const e of [...incoming, ...existing]) {
    const key = `${e.transactionHash}:${e.type}:${e.fid}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  out.sort((a, b) => b.ts - a.ts);
  return out.slice(0, ACTIVITY_ACCUM_CAP);
}

function rebuildActivity() {
  // Keep only Listed events with a real price (priceWei > 0).
  // Listed events with priceWei=0 are internal state-reset side-effects of cancel().
  const realListings = _pendingListedActivity.filter(e => BigInt(e.priceWei) > 0n);

  // Synthetic "listed" entries from the CURRENT on-chain listings. The public RPC
  // can't reliably return getLogs for old/wide ranges, so a listing's original
  // Listed event is often missing from the scan - but the listing itself is real
  // (readFidListing). Synthesizing from listingsCache guarantees the activity feed
  // reflects every active listing. We skip fids already covered by a real event.
  const realListedFids = new Set(realListings.map(e => e.fid));
  const synthListed: CachedActivity[] = listingsCache
    .filter(l => l.active && BigInt(l.priceWei) > 0n && !realListedFids.has(l.fid))
    .map(l => ({
      type: "listed" as const,
      fid: l.fid, seller: l.seller,
      priceWei: l.priceWei, priceEth: l.priceEth,
      blockNumber: 0, transactionHash: `listing-${l.fid}`,
      ts: l.listedAt || Math.floor(Date.now() / 1000),
    }));

  // Collect txHashes that produced a real listing.
  // list() first cancels any existing listing (emitting Cancelled) then emits Listed -
  // all in the same transaction. Those Cancelled events are NOT user-initiated cancels;
  // they're a re-list. Filter them out so only standalone cancels appear in the feed.
  const relistTxHashes = new Set(realListings.map(e => e.transactionHash));
  const realCancels = _pendingCancelledActivity.filter(
    e => !relistTxHashes.has(e.transactionHash)
  );

  const merged = [...realListings, ...synthListed, ..._pendingSoldActivity, ...realCancels];
  merged.sort((a, b) => b.ts - a.ts);

  // Deduplicate by transactionHash+type (guards against overlapping scan windows)
  const seen = new Set<string>();
  const deduped = merged.filter(e => {
    const key = `${e.transactionHash}:${e.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sync ALL deduped on-chain events to the action ledger (before the display cap).
  // logUserAction() is idempotent on (action_type, proof) so re-scanning
  // overlapping block ranges every poll cycle is safe to call unconditionally.
  syncMarketEventsToLedger(deduped);

  activityCache = deduped.slice(0, 100);
}

/**
 * Server-observed on-chain events are the strongest possible proof (Tier 1
 * of the points system) so these are logged already `verified`. The seller
 * of a listing/cancel IS that FID's owner, so `fid` is the correct party to
 * credit. A `sold` event's buyer is a wallet address — resolving buyer
 * wallet → buyer's own FID is a follow-up; the buyer address is kept in
 * payload so that resolution can run as a later batch pass without
 * re-scanning the chain.
 */
function syncMarketEventsToLedger(events: CachedActivity[]): void {
  for (const e of events) {
    if (!e.transactionHash || !e.fid) continue;
    const actionType: ActionType =
      e.type === "listed"    ? "market_list" :
      e.type === "sold"      ? "market_buy"  :
                               "market_cancel";
    logUserAction({
      fid: e.fid,
      actionType,
      payload: {
        seller:      e.seller,
        buyer:       e.buyer ?? null,
        priceWei:    e.priceWei,
        blockNumber: e.blockNumber,
      },
      proof:    e.transactionHash,
      verified: true,
    }).catch((err: Error) => console.warn(`[ledger] market sync failed (${e.transactionHash}):`, err.message));
  }
}

async function refreshListings() {
  if (isRefreshingListings) return;
  isRefreshingListings = true;
  try {
    const currentBlock = await optimismClient.getBlockNumber();
    const range = initialScanDone ? EVENT_SCAN_RANGE : INITIAL_SCAN_RANGE;
    const scanFrom = currentBlock > range ? currentBlock - range : BigInt(0);
    // Approx unix-seconds for a block (Optimism ~2s/block) for unified activity sorting.
    const nowSec = Math.floor(Date.now() / 1000);
    const tsOf = (bn: number) => nowSec - (Number(currentBlock) - bn) * 2;

    // Use verified raw topic hashes (event names in bytecode differ from ABI guesses)
    const [listedLogs, cancelledLogs] = await Promise.all([
      getLogsRaw(scanFrom, currentBlock, LOG_CHUNK_SIZE, LISTED_TOPIC),
      getLogsRaw(scanFrom, currentBlock, LOG_CHUNK_SIZE, CANCELLED_TOPIC),
    ]);
    if (!initialScanDone) initialScanDone = true;

    // Listed log: topics[1]=fid, topics[2]=seller, data=priceWei
    const listedActivity: CachedActivity[] = [];
    for (const log of listedLogs) {
      const fid = log.topics?.[1] ? parseFidFromTopic(log.topics[1]) : 0;
      if (fid <= 0) continue;
      if (trackedFids.size < MAX_TRACKED_FIDS) trackedFids.add(fid);
      const seller = log.topics?.[2] ? parseAddressFromTopic(log.topics[2]) : "";
      const priceWei = log.data && log.data.length >= 66 ? BigInt("0x" + log.data.slice(2, 66)) : 0n;
      listedActivity.push({
        type: "listed", fid, seller,
        priceWei: priceWei.toString(), priceEth: formatEther(priceWei),
        blockNumber: Number(log.blockNumber), transactionHash: log.transactionHash || "",
        ts: tsOf(Number(log.blockNumber)),
      });
    }

    // Cancelled log: topics[1]=fid OR fid in data
    const cancelledActivity: CachedActivity[] = [];
    for (const log of cancelledLogs) {
      let fid = 0;
      let seller = "";
      if (log.topics?.[1]) {
        fid = parseFidFromTopic(log.topics[1]);
        seller = log.topics?.[2] ? parseAddressFromTopic(log.topics[2]) : "";
      } else if (log.data && log.data.length >= 66) {
        fid = Number(BigInt("0x" + log.data.slice(2, 66)));
      }
      if (fid <= 0) continue;
      if (trackedFids.size < MAX_TRACKED_FIDS) trackedFids.add(fid);
      cancelledActivity.push({
        type: "cancelled", fid, seller,
        priceWei: "0", priceEth: "0",
        blockNumber: Number(log.blockNumber), transactionHash: log.transactionHash || "",
        ts: tsOf(Number(log.blockNumber)),
      });
    }

    _pendingListedActivity = mergeActivity(_pendingListedActivity, listedActivity);
    _pendingCancelledActivity = mergeActivity(_pendingCancelledActivity, cancelledActivity);

    // Check ALL tracked FIDs on-chain - readFidListing returns null for delisted ones
    const fidsToCheck = Array.from(trackedFids);
    const results: CachedListing[] = [];
    for (let i = 0; i < fidsToCheck.length; i += 10) {
      const batch = fidsToCheck.slice(i, i + 10);
      const settled = await Promise.allSettled(batch.map(fid => readFidListing(fid)));
      for (const r of settled) {
        if (r.status === "fulfilled" && r.value && r.value.active) results.push(r.value);
      }
    }

    // Guard against transient RPC failures: readFidListing returns null both for a
    // genuinely-delisted FID and for an RPC error. A scan returning 0 active while we
    // track FIDs and previously had listings is almost always a mass RPC hiccup, not
    // every listing vanishing at once - keep the previous cache instead of clearing it.
    if (results.length === 0 && trackedFids.size > 0 && listingsCache.length > 0) {
      console.warn(`[FidMarket] 0 active from ${trackedFids.size} tracked but cache had ${listingsCache.length} - keeping previous (likely RPC failure)`);
    } else {
      listingsCache = results;
      listingsCacheTime = Date.now();
    }
    console.log(`[FidMarket] Listings: ${listingsCache.length} active`);
  } catch (err) {
    console.error("[FidMarket] Listings refresh error:", err);
  } finally {
    isRefreshingListings = false;
  }
}

async function refreshTrades() {
  try {
    const currentBlock = await optimismClient.getBlockNumber();
    const nowSec = Math.floor(Date.now() / 1000);
    const tsOf = (bn: number) => nowSec - (Number(currentBlock) - bn) * 2;
    // Wide window on the first run so historical sales are complete; small window after.
    const tradeRange = tradesInitialDone ? EVENT_SCAN_RANGE : INITIAL_SCAN_RANGE;
    const scanFrom = currentBlock > tradeRange ? currentBlock - tradeRange : BigInt(0);
    tradesInitialDone = true;

    // Scan all Bought topic candidates until one returns logs (auto-detects the real topic)
    let boughtLogs: any[] = [];
    const topicsToTry = confirmedBoughtTopic
      ? [confirmedBoughtTopic]
      : BOUGHT_TOPIC_CANDIDATES;

    for (const topic of topicsToTry) {
      const logs = await getLogsRaw(scanFrom, currentBlock, LOG_CHUNK_SIZE, topic);
      if (logs.length === 0) continue;

      // Validate that at least one log has the expected Bought structure:
      // topics[1]=fid (non-zero), topics[2]=seller, topics[3]=buyer
      const isValidBoughtLog = logs.some((log: any) => {
        const fid = log.topics?.[1] ? parseFidFromTopic(log.topics[1]) : 0;
        const hasSeller = typeof log.topics?.[2] === "string" && log.topics[2].length === 66;
        const hasBuyer  = typeof log.topics?.[3] === "string" && log.topics[3].length === 66;
        return fid > 0 && fid < 1_000_000_000 && hasSeller && hasBuyer;
      });
      if (!isValidBoughtLog) continue;

      if (!confirmedBoughtTopic) {
        confirmedBoughtTopic = topic;
        console.log(`[FidMarket] Confirmed Bought topic: ${topic}`);
      }
      boughtLogs = logs;
      break;
    }

    // Bought log: topics[1]=fid, topics[2]=seller, topics[3]=buyer (all indexed), data=priceWei+feeWei
    const allBought: CachedTrade[] = boughtLogs.map((log: any) => {
      const fid = log.topics?.[1] ? parseFidFromTopic(log.topics[1]) : 0;
      const seller = log.topics?.[2] ? parseAddressFromTopic(log.topics[2]) : "";
      const buyer = log.topics?.[3] ? parseAddressFromTopic(log.topics[3]) : "";
      let priceWei = 0n;
      let feeWei = 0n;
      if (log.data && log.data.length >= 130) {
        priceWei = BigInt("0x" + log.data.slice(2, 66));
        feeWei = BigInt("0x" + log.data.slice(66, 130));
      } else if (log.data && log.data.length >= 66) {
        priceWei = BigInt("0x" + log.data.slice(2, 66));
      }
      return {
        fid, seller, buyer,
        priceWei: priceWei.toString(),
        priceEth: formatEther(priceWei),
        feeWei: feeWei.toString(),
        blockNumber: Number(log.blockNumber),
        transactionHash: log.transactionHash || "",
      };
    // Only real purchases: fid > 0, priceWei > 0, and buyer address present
    }).filter(t => t.fid > 0 && BigInt(t.priceWei) > 0n && t.buyer !== "").reverse();

    for (const t of allBought) { if (trackedFids.size < MAX_TRACKED_FIDS) trackedFids.add(t.fid); }

    let total = BigInt(0);
    for (const t of allBought) total += BigInt(t.priceWei);
    totalTradedEth = formatEther(total);
    tradesCache = allBought.slice(0, 50);
    tradesCacheTime = Date.now();
    lastScannedBlock = currentBlock;

    // Build sold activity entries (accumulated across scans)
    const soldActivity: CachedActivity[] = allBought.map(t => ({
      type: "sold" as const,
      fid: t.fid, seller: t.seller, buyer: t.buyer,
      priceWei: t.priceWei, priceEth: t.priceEth,
      blockNumber: t.blockNumber, transactionHash: t.transactionHash,
      ts: tsOf(t.blockNumber),
    }));
    _pendingSoldActivity = mergeActivity(_pendingSoldActivity, soldActivity);

    console.log(`[FidMarket] Trades: ${allBought.length}, total: ${totalTradedEth} ETH`);
  } catch (err) {
    console.error("[FidMarket] Trades refresh error:", err);
  }
}

async function neynarFetch(endpoint: string) {
  const res = await fetch(`https://api.neynar.com${endpoint}`, {
    headers: { accept: "application/json", "api_key": getNeynarKey() },
    signal: AbortSignal.timeout(8000),
  });
  return res;
}

type FidInfo = { username: string | null; displayName: string | null; pfpUrl: string | null };

async function getFidInfo(fid: number): Promise<FidInfo | null> {
  const key = String(fid);
  const cached = fidInfoCache.get(key) as FidInfo | undefined;
  if (cached) return cached;
  // Single-flight: dedupe concurrent lookups for the same FID so a burst of
  // requests for an uncached profile only calls Neynar once.
  return singleFlight(`fidinfo:${fid}`, async () => {
    try {
      const res = await neynarFetch(`/v2/farcaster/user/bulk?fids=${fid}`);
      if (!res.ok) return null;
      const data = await res.json();
      const user = data.users?.[0];
      if (!user) return null;
      const info: FidInfo = { username: user.username || null, displayName: user.display_name || null, pfpUrl: user.pfp_url || null };
      fidInfoCache.set(key, info);
      return info;
    } catch { return null; }
  });
}

async function getFidsInfoBulk(fids: number[]) {
  const results: Record<number, FidInfo> = {};
  const uncached: number[] = [];
  for (const fid of fids) {
    const c = fidInfoCache.get(String(fid)) as FidInfo | undefined;
    if (c) results[fid] = c;
    else uncached.push(fid);
  }
  if (uncached.length > 0) {
    try {
      const res = await neynarFetch(`/v2/farcaster/user/bulk?fids=${uncached.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        for (const user of data.users || []) {
          const info: FidInfo = { username: user.username || null, displayName: user.display_name || null, pfpUrl: user.pfp_url || null };
          results[user.fid] = info;
          fidInfoCache.set(String(user.fid), info);
        }
      }
    } catch {}
    for (const fid of uncached) {
      if (!results[fid]) results[fid] = { username: null, displayName: null, pfpUrl: null };
    }
  }
  return results;
}

export function registerFidMarketRoutes(app: Express) {
  app.get("/api/fid-market/stats", marketReadLimiter, (_req, res) => {
    const activeListings = listingsCache.filter(l => l.active && l.buyable);
    const allActive = listingsCache.filter(l => l.active);

    let totalPriceWei = BigInt(0);
    for (const l of activeListings) {
      try { totalPriceWei += BigInt(l.priceWei); } catch {}
    }
    const avgPriceEth = activeListings.length > 0
      ? parseFloat(formatEther(totalPriceWei / BigInt(activeListings.length))).toFixed(4)
      : "0";

    const minPriceEth = activeListings.length > 0
      ? Math.min(...activeListings.map(l => parseFloat(l.priceEth))).toFixed(4)
      : "0";

    res.json({
      activeListings: activeListings.length,
      totalListings: allActive.length,
      totalVolumeEth: parseFloat(totalTradedEth).toFixed(4),
      totalTrades: tradesCache.length,
      feeBps: FEE_BPS,
      feePercent: (FEE_BPS / 100).toFixed(0),
      avgPriceEth,
      minPriceEth,
      lastUpdated: Math.max(listingsCacheTime, tradesCacheTime),
      isReady: initialScanDone,
    });
  });

  app.get("/api/fid-market/cached-listings", marketReadLimiter, (_req, res) => {
    res.json({ listings: listingsCache, lastUpdated: listingsCacheTime, feeBps: FEE_BPS });
  });

  app.get("/api/fid-market/cached-trades", marketReadLimiter, (_req, res) => {
    res.json({ trades: tradesCache, totalTradedEth, totalTradedCount: tradesCache.length, lastUpdated: tradesCacheTime });
  });

  app.get("/api/fid-market/activity", marketReadLimiter, (_req, res) => {
    res.json({ activity: activityCache, lastUpdated: tradesCacheTime });
  });

  app.get("/api/fid-market/fid-info", marketReadLimiter, async (req, res) => {
    const fid = parseInt(req.query.fid as string, 10);
    if (!fid || fid <= 0 || fid >= 1_000_000_000) return res.status(400).json({ error: "Valid FID required" });
    const info = await getFidInfo(fid);
    res.json({ fid, ...(info || { username: null, displayName: null, pfpUrl: null }) });
  });

  app.get("/api/fid-market/fid-info-bulk", marketReadLimiter, async (req, res) => {
    const fidsParam = req.query.fids as string;
    if (!fidsParam || typeof fidsParam !== "string") return res.status(400).json({ error: "fids required" });
    const fids = fidsParam.split(",").map(Number).filter(f => Number.isInteger(f) && f > 0 && f < 1_000_000_000).slice(0, 50);
    if (fids.length === 0) return res.status(400).json({ error: "Valid FIDs required" });

    // getFidsInfoBulk reads/writes per-FID cache entries internally
    const results = await getFidsInfoBulk(fids);
    res.json(results);
  });

  app.get("/api/fid-market/fid-data/:fid", marketReadLimiter, async (req, res) => {
    const fid = parseInt(req.params.fid, 10);
    if (!fid || fid <= 0 || fid >= 1_000_000_000) return res.status(400).json({ error: "Valid FID required" });

    const cached = fidDataCache.get(String(fid));
    if (cached) return res.json(cached);

    try {
      const payload = await singleFlight(`fiddata:${fid}`, async () => {
        const [listing, ownerResult] = await Promise.allSettled([
          readFidListing(fid),
          optimismClient.readContract({
            address: ID_REGISTRY_ADDRESS,
            abi: idRegistryAbi,
            functionName: "custodyOf",
            args: [BigInt(fid)],
          }),
        ]);
        const listingData = listing.status === "fulfilled" ? listing.value : null;
        const owner = ownerResult.status === "fulfilled" ? (ownerResult.value as string).toLowerCase() : "0x0000000000000000000000000000000000000000";
        let paused = false;
        try {
          paused = await optimismClient.readContract({ address: FID_MARKET_ADDRESS, abi: fidMarketAbi, functionName: "paused" }) as boolean;
        } catch {}
        const data = {
          fid,
          owner,
          listing: listingData || { active: false },
          buyable: listingData?.buyable ?? false,
          sigExpired: listingData?.sigExpired ?? false,
          listingExpired: listingData?.listingExpired ?? false,
          paused,
          feeBps: FEE_BPS,
          marketAddress: FID_MARKET_ADDRESS,
        };
        fidDataCache.set(String(fid), data);
        return data;
      });
      res.json(payload);
    } catch (err) {
      console.error("[FidMarket] fid-data error:", err);
      res.status(500).json({ error: "Failed to fetch FID data" });
    }
  });

  app.get("/api/fid-market/wallet-fid", marketReadLimiter, async (req, res) => {
    const address = req.query.address as string;
    if (!isValidAddress(address)) return res.status(400).json({ error: "Valid Ethereum address required (0x + 40 hex chars)" });
    const normalizedAddress = address.toLowerCase() as Address;

    const cachedFid = walletFidCache.get(normalizedAddress);
    if (cachedFid !== undefined) {
      if (cachedFid === null || cachedFid === 0) return res.json({ fid: 0, found: false });
      const info = fidInfoCache.get(String(cachedFid));
      if (info) return res.json({ fid: cachedFid, found: true, ...(info as object) });
    }

    try {
      const result = await singleFlight(`walletfid:${normalizedAddress}`, async () => {
        const fid = await optimismClient.readContract({
          address: ID_REGISTRY_ADDRESS,
          abi: idRegistryAbi,
          functionName: "idOf",
          args: [normalizedAddress],
        }) as bigint;
        const fidNum = Number(fid);
        walletFidCache.set(normalizedAddress, fidNum);
        if (fidNum === 0) return { fid: 0, found: false };
        const info = await getFidInfo(fidNum);
        fidInfoCache.set(String(fidNum), info);
        return { fid: fidNum, found: true, ...info };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: "FID lookup failed" });
    }
  });

  app.get("/api/fid-market/id-nonce/:fid", marketReadLimiter, async (req, res) => {
    try {
      const fidNum = parseInt(req.params.fid, 10);
      if (!Number.isInteger(fidNum) || fidNum <= 0 || fidNum >= 1_000_000_000) {
        return res.status(400).json({ error: "Invalid FID" });
      }
      const fid = BigInt(fidNum);
      const nonce = await optimismClient.readContract({
        address: ID_REGISTRY_ADDRESS,
        abi: [{ name: "nonces", type: "function", stateMutability: "view", inputs: [{ name: "fid", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] }] as const,
        functionName: "nonces",
        args: [fid],
      });
      res.json({ nonce: nonce.toString() });
    } catch (err: any) {
      console.error("[id-nonce]", err);
      res.status(500).json({ error: err.shortMessage || err.message || "nonce fetch failed" });
    }
  });

  app.post("/api/fid-market/track-fid", marketWriteLimiter, async (req, res) => {
    const { fid } = req.body;
    if (!fid || typeof fid !== "number" || !Number.isInteger(fid) || fid <= 0 || fid >= 1_000_000_000) {
      return res.status(400).json({ error: "Valid FID required" });
    }
    if (trackedFids.size >= MAX_TRACKED_FIDS && !trackedFids.has(fid)) {
      return res.status(429).json({ error: "Tracked FID limit reached" });
    }
    trackedFids.add(fid);
    persistTrackedFids();
    refreshListings().then(rebuildActivity);
    res.json({ tracked: true, fid });
  });

  app.post("/api/fid-market/prepare-tx", marketWriteLimiter, async (req, res) => {
    try {
      const { from, to, data, value } = req.body as {
        from: Address; to: Address; data: `0x${string}`; value?: string;
      };
      if (!isValidAddress(from) || !isValidAddress(to)) {
        return res.status(400).json({ error: "from and to must be valid Ethereum addresses" });
      }
      if (data !== undefined && !isValidHex(data)) {
        return res.status(400).json({ error: "data must be a hex string starting with 0x" });
      }
      if (value !== undefined && (typeof value !== "string" || !/^\d+$/.test(value))) {
        return res.status(400).json({ error: "value must be a decimal string" });
      }

      let valueBig: bigint;
      try {
        valueBig = value ? BigInt(value) : BigInt(0);
      } catch {
        return res.status(400).json({ error: "Invalid value" });
      }

      const [nonce, fees] = await Promise.all([
        optimismClient.getTransactionCount({ address: from }),
        optimismClient.estimateFeesPerGas(),
      ]);

      // estimateGas simulates the call - if it throws, the tx will revert on-chain.
      // Propagate the revert reason immediately instead of silently falling back.
      let gasEstimate: bigint;
      try {
        gasEstimate = await optimismClient.estimateGas({
          account: from,
          to,
          data: data || "0x",
          value: valueBig,
        });
      } catch (gasErr: any) {
        const reason =
          gasErr?.cause?.reason ||
          gasErr?.shortMessage ||
          gasErr?.message ||
          "Transaction would revert";
        console.error("[prepare-tx] estimateGas revert:", reason);
        return res.status(400).json({ error: reason });
      }

      const gas = (gasEstimate * BigInt(130)) / BigInt(100);

      res.json({
        nonce,
        maxFeePerGas: fees.maxFeePerGas?.toString() ?? "2000000000",
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas?.toString() ?? "1000000",
        gas: gas.toString(),
        chainId: optimism.id,
      });
    } catch (err: any) {
      console.error("[prepare-tx]", err);
      res.status(500).json({ error: err.shortMessage || err.message || "prepare failed" });
    }
  });

  const RELAY_WHITELIST = new Set([FID_MARKET_ADDRESS.toLowerCase()]);
  app.post("/api/fid-market/relay-tx", marketWriteLimiter, async (req, res) => {
    try {
      const { rawTx } = req.body as { rawTx: `0x${string}` };
      if (!rawTx || !isValidHex(rawTx) || rawTx.length < 4) {
        return res.status(400).json({ error: "rawTx must be a valid hex-encoded signed transaction" });
      }

      let parsedTo: string | undefined;
      try {
        const parsed = parseTransaction(rawTx);
        parsedTo = parsed.to?.toLowerCase();
      } catch {
        return res.status(400).json({ error: "Could not parse transaction" });
      }
      if (!parsedTo || !RELAY_WHITELIST.has(parsedTo)) {
        return res.status(403).json({ error: "Transaction target not whitelisted" });
      }

      const txHash = await optimismClient.request({
        method: "eth_sendRawTransaction",
        params: [rawTx],
      });

      res.json({ txHash });
    } catch (err: any) {
      console.error("[relay-tx]", err);
      res.status(500).json({ error: err.shortMessage || err.message || "relay failed" });
    }
  });

  startIndexer();
}

function startIndexer() {
  console.log("[FidMarket] Starting indexer...");
  loadTrackedFids();
  if (trackedFids.size > 0) {
    console.log(`[FidMarket] Loaded ${trackedFids.size} tracked FIDs from disk`);
  }
  // NOTE: do NOT short-circuit the wide initial scan here. The first refreshListings
  // must scan the full window to populate the ACTIVITY feed (Listed/Cancelled events),
  // not just rediscover listings. Persisted trackedFids are an *additional* guarantee
  // that listings older than the scan window still get re-checked on-chain.
  Promise.all([refreshListings(), refreshTrades()]).then(() => {
    rebuildActivity();
    persistTrackedFids();
    console.log(`[FidMarket] Initial scan done. Tracked FIDs: ${trackedFids.size}`);
  });
  setInterval(() => {
    Promise.all([refreshListings(), refreshTrades()]).then(() => { rebuildActivity(); persistTrackedFids(); });
  }, 30_000);
}
