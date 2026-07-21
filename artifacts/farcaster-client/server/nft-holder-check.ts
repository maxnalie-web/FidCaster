/**
 * FasterTask NFT holder bonus.
 *
 * One-time points bonus for users who hold a FasterTask Pass NFT
 * (ERC-1155, Base mainnet, contract 0x9C4F...39Ba). Checked against the
 * user's Farcaster custody address (resolved from their fid through the
 * Farcaster ID Registry on Optimism) AND all of their verified Ethereum
 * addresses (via Neynar) - most users mint/hold NFTs in a connected wallet,
 * not their rarely-used custody address, so custody-only would miss almost
 * every real holder. No wallet connection is required from the FidCaster
 * user for this check.
 *
 * Awarded once per fid via the normal idempotent (action_type, proof)
 * ledger pattern — see db/ledger.ts logUserAction.
 */
import { createPublicClient, http, fallback, type Address } from "viem";
import { base, optimism } from "viem/chains";
import { getPool } from "./db/pool.js";
import { logUserAction } from "./db/ledger.js";
import { neynarThrottle, penalize429, hasAnyNeynarKey } from "./neynar-limit.js";

const FASTERTASK_NFT_ADDRESS = "0x9C4FfaE666916411aAA546D5834885b5CE4539Ba" as const;
const ID_REGISTRY_ADDRESS    = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b" as const;
const TOKEN_IDS    = Array.from({ length: 55 }, (_, i) => BigInt(i + 1));
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const baseClient = createPublicClient({
  chain: base,
  transport: fallback(
    ["https://mainnet.base.org", "https://base.llamarpc.com", "https://base.drpc.org"]
      .map((url) => http(url, { timeout: 12_000, retryCount: 1 })),
    { rank: true },
  ),
});

const optimismClient = createPublicClient({
  chain: optimism,
  transport: fallback(
    ["https://mainnet.optimism.io", "https://optimism.llamarpc.com", "https://optimism.drpc.org"]
      .map((url) => http(url, { timeout: 12_000, retryCount: 1 })),
    { rank: true },
  ),
});

const balanceOfBatchAbi = [{
  name: "balanceOfBatch", type: "function", stateMutability: "view",
  inputs: [{ name: "accounts", type: "address[]" }, { name: "ids", type: "uint256[]" }],
  outputs: [{ name: "", type: "uint256[]" }],
}] as const;

const custodyOfAbi = [{
  name: "custodyOf", type: "function", stateMutability: "view",
  inputs: [{ name: "fid", type: "uint256" }],
  outputs: [{ name: "owner", type: "address" }],
}] as const;

async function getVerifiedEthAddresses(fid: number): Promise<Address[]> {
  if (!hasAnyNeynarKey()) return [];
  try {
    const apiKey = await neynarThrottle();
    const r = await fetch(`https://api.neynar.com/v2/farcaster/user/bulk?fids=${fid}`, {
      headers: { accept: "application/json", api_key: apiKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) {
      if (r.status === 429) penalize429(apiKey);
      return [];
    }
    const data = await r.json() as {
      users?: { verified_addresses?: { eth_addresses?: string[] } }[];
    };
    return (data.users?.[0]?.verified_addresses?.eth_addresses ?? []) as Address[];
  } catch {
    return [];
  }
}

async function addressHoldsNft(address: Address): Promise<boolean> {
  const accounts = TOKEN_IDS.map(() => address);
  const balances = await baseClient.readContract({
    address: FASTERTASK_NFT_ADDRESS, abi: balanceOfBatchAbi, functionName: "balanceOfBatch",
    args: [accounts, TOKEN_IDS],
  }) as bigint[];
  return balances.some((b) => b > 0n);
}

/**
 * Every Ethereum address actually provable as belonging to this fid: its
 * on-chain custody address (Farcaster ID Registry, Optimism) plus every
 * address Farcaster has verified for it (via Neynar). Used both for the
 * NFT holder-bonus check and to sanity-check a client-supplied mint
 * destination address before spending real gas on it.
 */
export async function getFarcasterOwnedAddresses(fid: number): Promise<Address[]> {
  const addresses: Address[] = [];

  const custody = await optimismClient.readContract({
    address: ID_REGISTRY_ADDRESS, abi: custodyOfAbi, functionName: "custodyOf", args: [BigInt(fid)],
  }) as string;
  if (custody && custody.toLowerCase() !== ZERO_ADDRESS) addresses.push(custody as Address);

  addresses.push(...await getVerifiedEthAddresses(fid));

  return addresses;
}

export async function checkFidHoldsFasterTaskNft(fid: number): Promise<boolean> {
  try {
    const addresses = await getFarcasterOwnedAddresses(fid);

    if (addresses.length === 0) return false;

    for (const address of addresses) {
      if (await addressHoldsNft(address)) return true;
    }
    return false;
  } catch (e) {
    console.warn(`[nft-holder-job] check failed for fid ${fid}:`, (e as Error).message);
    return false;
  }
}

export interface NftHolderCheckResult {
  isHolder: boolean;
  alreadyAwarded: boolean;
  justAwarded: boolean;
}

/**
 * On-demand check, called from the client: once automatically the first
 * time a user opens the app, and again whenever they tap the manual
 * "Check NFT holder status" button. No background polling — this only
 * runs when a real request asks for it.
 */
// This endpoint is intentionally reachable without an auth token (fail-open,
// same rollout stance as the rest of the app), which means a caller can ask
// about ANY fid repeatedly for free - a negative result only ever does an
// on-chain read + a Neynar call and is never cached anywhere, so it can be
// spammed to run up API costs. Short in-memory cooldown on negative results
// bounds that without touching the auth policy.
const NEGATIVE_CACHE_MS = 5 * 60_000;
const negativeCache = new Map<number, number>();

export async function checkAndAwardNftHolderBonus(fid: number): Promise<NftHolderCheckResult> {
  const pool = getPool();
  if (pool) {
    const { rows } = await pool.query(
      `SELECT 1 FROM user_actions WHERE fid = $1 AND action_type = 'nft_holder_bonus' AND excluded = false LIMIT 1`,
      [fid],
    );
    if (rows.length > 0) {
      return { isHolder: true, alreadyAwarded: true, justAwarded: false };
    }
  }

  const cachedAt = negativeCache.get(fid);
  if (cachedAt && Date.now() - cachedAt < NEGATIVE_CACHE_MS) {
    return { isHolder: false, alreadyAwarded: false, justAwarded: false };
  }

  const isHolder = await checkFidHoldsFasterTaskNft(fid);
  if (!isHolder) {
    negativeCache.set(fid, Date.now());
    return { isHolder: false, alreadyAwarded: false, justAwarded: false };
  }

  await logUserAction({
    fid, actionType: "nft_holder_bonus",
    payload: { source: "fastertask_nft", contract: FASTERTASK_NFT_ADDRESS },
    proof: `nft_holder_bonus:${fid}`, verified: true,
  });
  console.log(`[nft-holder-check] fid ${fid}: FasterTask NFT holder bonus awarded`);
  return { isHolder: true, alreadyAwarded: false, justAwarded: true };
}
