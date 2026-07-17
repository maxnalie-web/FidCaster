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
import { getContract } from "viem";
import { getPublicClientForChain } from "@/lib/wallet";

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
// Address is matched too (not just symbol/name) so pasting a full contract
// address finds it directly when it's already indexed here.
export function searchTokenList(list: DiscoveredToken[], query: string, limit = 40): DiscoveredToken[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: DiscoveredToken[] = [];
  for (const t of list) {
    if (t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q) {
      results.push(t);
      if (results.length >= limit) break;
    }
  }
  return results;
}

const EVM_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export function isTokenAddress(query: string): boolean {
  return EVM_ADDRESS_RE.test(query.trim());
}

const ERC20_META_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
] as const;

// Last-resort fallback: pasting a contract address that isn't in the
// curated list, 1inch's list, or Clanker's index (a brand-new or obscure
// token) still works by reading symbol/name/decimals directly from the
// contract on-chain. Only ever called with a value that already passed
// isTokenAddress -- never guesses at an address, only resolves one the user
// explicitly supplied, so there's no funds-safety risk from a wrong lookup.
// Same function ported to the native app's core/token-list.ts.
export async function fetchTokenByAddress(chainId: number, address: string): Promise<DiscoveredToken | null> {
  if (!isTokenAddress(address)) return null;
  try {
    const client = getPublicClientForChain(chainId);
    const contract = getContract({ address: address as `0x${string}`, abi: ERC20_META_ABI, client });
    const symbol = await contract.read.symbol();
    const name = await contract.read.name().catch(() => symbol);
    const decimals = await contract.read.decimals();
    return { symbol, name: name || symbol, address, decimals, chainId, logo: "" };
  } catch {
    return null; // not a contract, not an ERC-20, or the RPC call failed
  }
}

// Clanker (clanker.world) is a token-launch platform on Base -- most of
// what it deploys is small/new enough that 1inch's list above never picks
// it up. clanker.world's own public tokens API (free, keyless, server-side
// search) covers exactly that gap: real Base-deployed contract addresses,
// same funds-safety reasoning as the 1inch list above (never hand-typing
// addresses). Clanker's factory always deploys standard 18-decimal ERC-20s.
// Same function ported to the native app's core/token-list.ts.
const CLANKER_CHAIN_ID = 8453; // Base only -- Clanker doesn't deploy elsewhere

interface ClankerApiToken {
  contract_address: string;
  name: string;
  symbol: string;
  img_url?: string;
  chain_id: number;
}

export async function searchClankerTokens(query: string, limit = 20): Promise<DiscoveredToken[]> {
  const q = query.trim();
  if (!q) return [];
  const r = await fetch(`https://www.clanker.world/api/tokens?search=${encodeURIComponent(q)}`, {
    signal: AbortSignal.timeout(TOKEN_LIST_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const body = (await r.json()) as { data?: ClankerApiToken[] };
  return (body.data ?? [])
    .filter(t => t.chain_id === CLANKER_CHAIN_ID)
    .slice(0, limit)
    .map(t => ({
      symbol: t.symbol,
      name: t.name,
      address: t.contract_address,
      decimals: 18,
      chainId: CLANKER_CHAIN_ID,
      logo: t.img_url ?? "",
    }));
}
