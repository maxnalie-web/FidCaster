// Full per-chain ERC-20 token list for the swap token picker, backed by
// 1inch's free/keyless public token-list API -- the same aggregator already
// used for quotes, so any token it lists is one their router can actually
// route through. Previously the picker only offered ~10 hand-picked tokens
// per chain (SwapSheet.tsx's TOKENS const), which covered a small fraction
// of what's actually swappable -- this powers a live search across
// thousands of real, address-verified tokens instead of guessing/hardcoding
// more addresses by hand (a wrong hardcoded ERC-20 address here would be a
// real funds-safety bug, not just a display one). Same module ported to the
// native app's core/token-list.ts.
export interface DiscoveredToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  chainId: number;
  logo: string;
}

const TOKEN_LIST_TIMEOUT_MS = 10_000;

// In-memory only (session-lifetime) -- these lists are large (thousands of
// entries per chain) and refreshed often upstream, so persisting them to
// disk isn't worth the storage/staleness tradeoff for what's just a search
// index.
const cache = new Map<number, DiscoveredToken[]>();
const inflight = new Map<number, Promise<DiscoveredToken[]>>();

async function fetchTokenList(chainId: number): Promise<DiscoveredToken[]> {
  const r = await fetch(`https://tokens.1inch.io/v1.2/${chainId}`, {
    signal: AbortSignal.timeout(TOKEN_LIST_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = (await r.json()) as Record<
    string,
    { symbol: string; name: string; address: string; decimals: number; logoURI?: string }
  >;
  return Object.values(data).map(t => ({
    symbol: t.symbol,
    name: t.name,
    address: t.address,
    decimals: t.decimals,
    chainId,
    logo: t.logoURI ?? "",
  }));
}

// Cached + de-duplicated in-flight requests, so switching back and forth
// between chains in the picker (or two components requesting the same
// chain at once) doesn't refetch/refire the same multi-thousand-entry list.
export async function getTokenList(chainId: number): Promise<DiscoveredToken[]> {
  const cached = cache.get(chainId);
  if (cached) return cached;
  const existing = inflight.get(chainId);
  if (existing) return existing;

  const promise = fetchTokenList(chainId)
    .then(list => {
      cache.set(chainId, list);
      inflight.delete(chainId);
      return list;
    })
    .catch(e => {
      inflight.delete(chainId);
      throw e;
    });
  inflight.set(chainId, promise);
  return promise;
}

// Case-insensitive substring match against symbol/name, capped so the
// picker never has to render an unbounded result set -- 1inch's own map
// ordering roughly favors more established tokens first, which is a
// reasonable proxy for relevance without fetching per-token liquidity data.
export function searchTokenList(list: DiscoveredToken[], query: string, limit = 40): DiscoveredToken[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: DiscoveredToken[] = [];
  for (const t of list) {
    if (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q)) {
      results.push(t);
      if (results.length >= limit) break;
    }
  }
  return results;
}
