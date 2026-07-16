import React, { useState, useEffect, useCallback } from "react";
import {
  X, ShieldCheck, ShieldOff, Loader2, AlertTriangle,
  CheckCircle2, RefreshCw, Trash2,
} from "lucide-react";
import { publicClient, basePublicClient } from "@/lib/contracts";
import { parseAbiItem, formatUnits, type Address, type Chain } from "viem";
import { optimism, base } from "viem/chains";
import { createBaseWalletClient } from "@/lib/wallet";
import { useWalletStore } from "@/store/walletStore";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const APPROVAL_EVENT = parseAbiItem(
  "event Approval(address indexed owner, address indexed spender, uint256 value)"
);

const ERC20_ABI = [
  { name: "symbol", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "name", type: "function", inputs: [], outputs: [{ type: "string" }], stateMutability: "view" },
  { name: "decimals", type: "function", inputs: [], outputs: [{ type: "uint8" }], stateMutability: "view" },
  { name: "allowance", type: "function", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ type: "uint256" }], stateMutability: "view" },
  { name: "approve", type: "function", inputs: [{ name: "spender", type: "address" }, { name: "value", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" },
] as const;

const KNOWN_SPENDERS: Record<string, string> = {
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap V3",
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 Router",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch V5",
  "0x1111111254fb6c44bac0bed2854e76f90643097d": "1inch V4",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x Exchange",
  "0x4c4af8dbc524681930a27b2f1af5bcc8062e6fb7": "Velodrome",
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43": "Aerodrome",
  "0x6131b5fae19ea4f9d964eac0408e4408b66337b5": "KyberSwap",
};

type NetworkId = "optimism" | "base";

type Approval = {
  id: string;
  tokenAddress: Address;
  spenderAddress: Address;
  tokenSymbol: string;
  tokenName: string;
  decimals: number;
  allowance: bigint;
  spenderLabel: string;
  network: NetworkId;
  revoking: boolean;
};

const NETWORK_CONFIG: Record<NetworkId, {
  label: string;
  color: string;
  client: typeof publicClient;
  chainObj: Chain;
  fromBlock: bigint;
}> = {
  optimism: {
    label: "Optimism",
    color: "#ff0420",
    client: publicClient,
    chainObj: optimism,
    fromBlock: BigInt("118000000"),
  },
  base: {
    label: "Base",
    color: "#0052ff",
    client: basePublicClient,
    chainObj: base,
    fromBlock: BigInt("18000000"),
  },
};

interface Props {
  address: Address;
  walletColor: string;
  onClose: () => void;
}

// Many public RPC providers in this app's own fallback pool (llamarpc,
// publicnode, drpc, 1rpc, ankr, ...) cap eth_getLogs to a block range far
// smaller than the ~500k-block window this scan needs — a single request
// for the whole range gets rejected outright by most of them. Chunking into
// windows this size keeps each individual call within what virtually every
// provider accepts, at the cost of more requests (run with limited
// concurrency so it doesn't hammer the RPC pool).
const LOG_CHUNK_BLOCKS = 20_000n;
const LOG_CHUNK_CONCURRENCY = 6;

// getLogs' return type is generic over the `event` config passed to it —
// deriving it generically (e.g. via a bare ReturnType<typeof getLogs>) loses
// that and falls back to an untyped Log with no `.args`. Since every call
// site here always passes APPROVAL_EVENT, just declare the shape directly.
type ApprovalLog = {
  address: Address;
  args: { owner?: Address; spender?: Address; value?: bigint };
};

async function getLogsChunked(
  client: typeof publicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ApprovalLog[]> {
  const ranges: [bigint, bigint][] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
    const end = start + LOG_CHUNK_BLOCKS - 1n > toBlock ? toBlock : start + LOG_CHUNK_BLOCKS - 1n;
    ranges.push([start, end]);
  }

  const results: ApprovalLog[] = [];
  for (let i = 0; i < ranges.length; i += LOG_CHUNK_CONCURRENCY) {
    const batch = ranges.slice(i, i + LOG_CHUNK_CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(([from, to]) =>
        client.getLogs({ event: APPROVAL_EVENT, args: { owner: address }, fromBlock: from, toBlock: to })
      )
    );
    for (const r of batchResults) {
      // A single bad chunk (still-too-large-for-that-node, transient error)
      // shouldn't blank out the whole scan — skip it and keep the rest.
      if (r.status === "fulfilled") results.push(...r.value);
    }
  }
  return results;
}

export function TokenApprovalsSheet({ address, walletColor, onClose }: Props) {
  const { walletClient: fcWalletClient } = useWallet();
  const getActiveWalletClient = useWalletStore(s => s.getActiveWalletClient);

  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    setLoading(true);
    setError(null);
    const results: Approval[] = [];

    for (const [netId, cfg] of Object.entries(NETWORK_CONFIG) as [NetworkId, typeof NETWORK_CONFIG[NetworkId]][]) {
      try {
        const latestBlock = await cfg.client.getBlockNumber();
        const fromBlock = latestBlock - 1_000_000n > cfg.fromBlock ? latestBlock - 1_000_000n : cfg.fromBlock;

        const logs = await getLogsChunked(cfg.client, address, fromBlock, latestBlock);

        // Deduplicate: keep only latest per (token, spender)
        const latestMap = new Map<string, typeof logs[0]>();
        for (const log of logs) {
          const key = `${log.address.toLowerCase()}-${(log.args.spender as string).toLowerCase()}`;
          latestMap.set(key, log);
        }

        // Fetch token metadata + live allowance
        const entries = await Promise.allSettled(
          Array.from(latestMap.values()).map(async (log) => {
            const tokenAddr = log.address as Address;
            const spenderAddr = log.args.spender as Address;

            const [symbol, name, decimals, allowance] = await Promise.all([
              cfg.client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "symbol" }).catch(() => "?"),
              cfg.client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "name" }).catch(() => "Unknown Token"),
              cfg.client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "decimals" }).catch(() => 18),
              cfg.client.readContract({ address: tokenAddr, abi: ERC20_ABI, functionName: "allowance", args: [address, spenderAddr] }).catch(() => 0n),
            ]);

            if ((allowance as bigint) === 0n) return null;

            const spenderLabel = KNOWN_SPENDERS[spenderAddr.toLowerCase()] ?? `${spenderAddr.slice(0, 6)}…${spenderAddr.slice(-4)}`;

            return {
              id: `${netId}-${tokenAddr}-${spenderAddr}`,
              tokenAddress: tokenAddr,
              spenderAddress: spenderAddr,
              tokenSymbol: symbol as string,
              tokenName: name as string,
              decimals: decimals as number,
              allowance: allowance as bigint,
              spenderLabel,
              network: netId,
              revoking: false,
            } satisfies Approval;
          })
        );

        for (const r of entries) {
          if (r.status === "fulfilled" && r.value) results.push(r.value);
        }
      } catch {
        // silently skip network errors
      }
    }

    setApprovals(results);
    setLoading(false);
    if (results.length === 0 && !error) setError(null);
  }, [address]);

  useEffect(() => { loadApprovals(); }, [loadApprovals]);

  async function revoke(appr: Approval) {
    setApprovals(prev => prev.map(a => a.id === appr.id ? { ...a, revoking: true } : a));
    try {
      const cfg = NETWORK_CONFIG[appr.network];
      let wc = fcWalletClient;
      try { const sc = await getActiveWalletClient(); if (sc) wc = sc.walletClient; } catch {}
      if (!wc) throw new Error("No wallet connected");

      const activeClient = appr.network === "base" ? createBaseWalletClient(wc.account!) : wc;

      const { request } = await cfg.client.simulateContract({
        address: appr.tokenAddress,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [appr.spenderAddress, 0n],
        account: wc.account!,
      });

      await activeClient.writeContract({ ...request, chain: cfg.chainObj });
      toast.success(`Revoked ${appr.tokenSymbol} approval for ${appr.spenderLabel}`);
      setApprovals(prev => prev.filter(a => a.id !== appr.id));
    } catch (e) {
      toast.error((e as Error).message ?? "Revoke failed");
      setApprovals(prev => prev.map(a => a.id === appr.id ? { ...a, revoking: false } : a));
    }
  }

  const netApprovals = (net: NetworkId) => approvals.filter(a => a.network === net);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${walletColor}20` }}>
            <ShieldCheck size={16} style={{ color: walletColor }} />
          </div>
          <span className="text-base font-bold text-foreground">Token Approvals</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={loadApprovals} disabled={loading} className="p-2 rounded-full hover:bg-muted/60 text-muted-foreground transition-colors">
            <RefreshCw size={15} className={cn(loading && "animate-spin")} />
          </button>
          <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
            <X size={20} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        {loading && approvals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Scanning approval history…</p>
          </div>
        )}

        {!loading && approvals.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center bg-emerald-500/10">
              <ShieldCheck size={24} className="text-emerald-500" />
            </div>
            <p className="text-base font-bold text-foreground">No active approvals</p>
            <p className="text-sm text-muted-foreground max-w-[220px]">Your wallet has no active token spending permissions</p>
          </div>
        )}

        {(["optimism", "base"] as NetworkId[]).map(net => {
          const items = netApprovals(net);
          if (items.length === 0) return null;
          const cfg = NETWORK_CONFIG[net];
          return (
            <div key={net} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cfg.color }} />
                <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{cfg.label}</p>
                <span className="text-[10px] font-bold text-muted-foreground/60 bg-muted/60 px-1.5 py-0.5 rounded-full">{items.length}</span>
              </div>
              <div className="rounded-2xl bg-card border border-border overflow-hidden divide-y divide-border/50">
                {items.map(appr => {
                  const isUnlimited = appr.allowance > BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffff");
                  const displayAmt = isUnlimited ? "Unlimited" : `${parseFloat(formatUnits(appr.allowance, appr.decimals)).toFixed(4)} ${appr.tokenSymbol}`;

                  return (
                    <div key={appr.id} className="flex items-center gap-3 px-4 py-3.5">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-muted/60">
                        <span className="text-xs font-black text-foreground">{appr.tokenSymbol.slice(0, 3)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-foreground truncate">{appr.tokenSymbol}</p>
                          {isUnlimited && (
                            <span className="px-1.5 py-0.5 rounded-full bg-orange-500/10 text-[9px] font-bold text-orange-500">
                              UNLIMITED
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">→ {appr.spenderLabel}</p>
                        <p className="text-[10px] text-muted-foreground/60">{isUnlimited ? "∞" : displayAmt}</p>
                      </div>
                      <button
                        onClick={() => revoke(appr)}
                        disabled={appr.revoking}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all",
                          appr.revoking
                            ? "bg-muted/40 text-muted-foreground"
                            : "bg-destructive/10 text-destructive hover:bg-destructive/20"
                        )}
                      >
                        {appr.revoking
                          ? <Loader2 size={12} className="animate-spin" />
                          : <ShieldOff size={12} />}
                        {appr.revoking ? "…" : "Revoke"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {approvals.length > 0 && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-2xl bg-amber-500/8 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <p>Revoking sends a transaction on-chain. Make sure you have a small ETH balance for gas.</p>
          </div>
        )}
      </div>
    </div>
  );
}
