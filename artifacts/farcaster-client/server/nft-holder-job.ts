/**
 * FasterTask NFT holder bonus.
 *
 * One-time points bonus for users who hold a FasterTask Pass NFT
 * (ERC-1155, Base mainnet, contract 0x9C4F...39Ba). Detected via the
 * user's Farcaster custody address — resolved from their fid through the
 * Farcaster ID Registry on Optimism, the same mechanism FasterTask's own
 * app uses. No wallet connection is required from the FidCaster user.
 *
 * Awarded once per fid via the normal idempotent (action_type, proof)
 * ledger pattern — see db/ledger.ts logUserAction.
 */
import { createPublicClient, http, fallback, type Address } from "viem";
import { base, optimism } from "viem/chains";
import { getPool } from "./db/pool.js";
import { logUserAction } from "./db/ledger.js";

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

export async function checkFidHoldsFasterTaskNft(fid: number): Promise<boolean> {
  try {
    const custody = await optimismClient.readContract({
      address: ID_REGISTRY_ADDRESS, abi: custodyOfAbi, functionName: "custodyOf", args: [BigInt(fid)],
    }) as string;
    if (!custody || custody.toLowerCase() === ZERO_ADDRESS) return false;

    const accounts = TOKEN_IDS.map(() => custody as Address);
    const balances = await baseClient.readContract({
      address: FASTERTASK_NFT_ADDRESS, abi: balanceOfBatchAbi, functionName: "balanceOfBatch",
      args: [accounts, TOKEN_IDS],
    }) as bigint[];
    return balances.some((b) => b > 0n);
  } catch (e) {
    console.warn(`[nft-holder-job] check failed for fid ${fid}:`, (e as Error).message);
    return false;
  }
}

const BATCH_SIZE       = 25;
const SCAN_INTERVAL_MS = 30 * 60_000; // 30 min

async function runHolderScan(): Promise<void> {
  const pool = getPool();
  if (!pool) return;
  try {
    // Only fids that don't already have the one-time bonus row. Non-holders
    // are intentionally re-checked on every scan (not cached as "no") so a
    // user who buys the NFT later still gets picked up automatically.
    const { rows } = await pool.query(
      `SELECT u.fid FROM users u
       LEFT JOIN user_actions ua
         ON ua.fid = u.fid AND ua.action_type = 'nft_holder_bonus' AND ua.excluded = false
       WHERE ua.id IS NULL
       ORDER BY u.last_seen DESC
       LIMIT $1`,
      [BATCH_SIZE],
    );

    for (const row of rows) {
      const fid = Number(row.fid);
      const isHolder = await checkFidHoldsFasterTaskNft(fid);
      if (isHolder) {
        await logUserAction({
          fid, actionType: "nft_holder_bonus",
          payload: { source: "fastertask_nft", contract: FASTERTASK_NFT_ADDRESS },
          proof: `nft_holder_bonus:${fid}`, verified: true,
        });
        console.log(`[nft-holder-job] fid ${fid}: FasterTask NFT holder bonus awarded`);
      }
    }
  } catch (e) {
    console.warn("[nft-holder-job] scan error:", (e as Error).message);
  }
}

let _timer: ReturnType<typeof setInterval> | null = null;

export function startNftHolderJob(): void {
  if (_timer) return;
  runHolderScan();
  _timer = setInterval(runHolderScan, SCAN_INTERVAL_MS);
  console.log(`[nft-holder-job] started (every ${SCAN_INTERVAL_MS / 60_000}min, batch=${BATCH_SIZE})`);
}
