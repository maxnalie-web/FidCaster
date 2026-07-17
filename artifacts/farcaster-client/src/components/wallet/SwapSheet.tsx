import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpDown, ChevronDown, Loader2, X, ExternalLink,
  AlertTriangle, Search, Check, RefreshCw,
} from "lucide-react";
import { formatUnits, parseUnits, encodeFunctionData, type Address } from "viem";
import { optimism, base, mainnet, arbitrum, polygon } from "viem/chains";
import { createChainWalletClient, getPublicClientForChain } from "@/lib/wallet";

const ERC20_BAL_ABI = [{
  name: "balanceOf", type: "function", stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }],
  outputs: [{ type: "uint256" }],
}] as const;

const ERC20_ALLOWANCE_ABI = [{
  name: "allowance", type: "function", stateMutability: "view",
  inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }],
  outputs: [{ type: "uint256" }],
}] as const;

const ERC20_APPROVE_ABI = [{
  name: "approve", type: "function", stateMutability: "nonpayable",
  inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
  outputs: [{ type: "bool" }],
}] as const;
import { useWalletStore } from "@/store/walletStore";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

/* ─── Chains ──────────────────────────────────────────────────────────────── */
const CHAINS = [
  { id: 10    as const, label: "Optimism", short: "OP",   color: "#ff0420", ooKey: "optimism", kyberKey: "optimism",  viem: optimism  },
  { id: 8453  as const, label: "Base",     short: "BASE", color: "#0052ff", ooKey: "base",     kyberKey: "base",       viem: base      },
  { id: 1     as const, label: "Ethereum", short: "ETH",  color: "#627EEA", ooKey: "eth",      kyberKey: "ethereum",   viem: mainnet   },
  { id: 42161 as const, label: "Arbitrum", short: "ARB",  color: "#28a0f0", ooKey: "arbitrum", kyberKey: "arbitrum",   viem: arbitrum  },
  { id: 137   as const, label: "Polygon",  short: "POL",  color: "#8247E5", ooKey: "polygon",  kyberKey: "polygon",    viem: polygon   },
];
type ChainId = typeof CHAINS[number]["id"];

/* ─── Tokens ──────────────────────────────────────────────────────────────── */
interface Token { symbol: string; name: string; address: string; decimals: number; chainId: ChainId; logo: string }

const TOKENS: Token[] = [
  // Optimism
  { symbol:"ETH",    name:"Ethereum",       address:NATIVE,                                          decimals:18, chainId:10,    logo:"https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  // Native USDC — MUST match USDC_OP_ADDRESS in lib/contracts.ts, which is what
  // the main wallet balance reads. These previously pointed at two different
  // contracts (this one used to be USDC.e, the legacy bridged token) — a user
  // with native USDC showed a balance in the wallet but couldn't swap it here,
  // and any USDC.e they held was invisible everywhere (also filtered out of
  // ERC-20 discovery below by ERC20_SKIP_SYMBOLS).
  { symbol:"USDC",   name:"USD Coin",        address:"0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",   decimals:6,  chainId:10,    logo:"https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol:"USDC.e", name:"Bridged USDC (USDC.e)", address:"0x7F5c764cBc14f9669B88837ca1490cCa17c31607", decimals:6, chainId:10, logo:"https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol:"USDT",   name:"Tether",          address:"0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",   decimals:6,  chainId:10,    logo:"https://assets.coingecko.com/coins/images/325/small/Tether.png" },
  { symbol:"DAI",    name:"Dai",             address:"0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",   decimals:18, chainId:10,    logo:"https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png" },
  { symbol:"OP",     name:"Optimism",        address:"0x4200000000000000000000000000000000000042",   decimals:18, chainId:10,    logo:"https://assets.coingecko.com/coins/images/25244/small/Optimism.png" },
  { symbol:"WBTC",   name:"Wrapped BTC",     address:"0x68f180fcCe6836688e9084f035309E29Bf0A2095",   decimals:8,  chainId:10,    logo:"https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png" },
  { symbol:"wstETH", name:"Lido Wrapped stETH", address:"0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb", decimals:18, chainId:10,  logo:"https://assets.coingecko.com/coins/images/18834/small/wstETH.png" },
  { symbol:"VELO",   name:"Velodrome",       address:"0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",   decimals:18, chainId:10,    logo:"https://assets.coingecko.com/coins/images/25783/small/velo.png" },
  { symbol:"SNX",    name:"Synthetix",       address:"0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B",   decimals:18, chainId:10,    logo:"https://assets.coingecko.com/coins/images/3406/small/SNX.png" },
  // Base
  { symbol:"ETH",    name:"Ethereum",        address:NATIVE,                                          decimals:18, chainId:8453,  logo:"https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  { symbol:"USDC",   name:"USD Coin",         address:"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",   decimals:6,  chainId:8453,  logo:"https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol:"cbETH",  name:"Coinbase ETH",     address:"0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22",   decimals:18, chainId:8453,  logo:"https://assets.coingecko.com/coins/images/27008/small/cbeth.png" },
  { symbol:"cbBTC",  name:"Coinbase BTC",     address:"0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",   decimals:8,  chainId:8453,  logo:"https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png" },
  { symbol:"AERO",   name:"Aerodrome",        address:"0x940181a94A35A4569E4529A3CDfB74e38FD98631",   decimals:18, chainId:8453,  logo:"https://assets.coingecko.com/coins/images/31745/small/token.png" },
  { symbol:"BRETT",  name:"Brett",            address:"0x532f27101965dd16442E59d40670FaF5eBB142E4",   decimals:18, chainId:8453,  logo:"https://assets.coingecko.com/coins/images/35529/small/200x200logo.png" },
  { symbol:"DEGEN",  name:"Degen",            address:"0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed",   decimals:18, chainId:8453,  logo:"https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png" },
  { symbol:"HIGHER", name:"Higher",           address:"0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe",   decimals:18, chainId:8453,  logo:"https://assets.coingecko.com/coins/images/36084/small/higher.jpg" },
  // Ethereum
  { symbol:"ETH",    name:"Ethereum",         address:NATIVE,                                          decimals:18, chainId:1,     logo:"https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  { symbol:"USDC",   name:"USD Coin",          address:"0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",   decimals:6,  chainId:1,     logo:"https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol:"USDT",   name:"Tether",            address:"0xdAC17F958D2ee523a2206206994597C13D831ec7",   decimals:6,  chainId:1,     logo:"https://assets.coingecko.com/coins/images/325/small/Tether.png" },
  { symbol:"WBTC",   name:"Wrapped BTC",       address:"0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",   decimals:8,  chainId:1,     logo:"https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png" },
  { symbol:"DAI",    name:"Dai",               address:"0x6B175474E89094C44Da98b954EedeAC495271d0F",   decimals:18, chainId:1,     logo:"https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png" },
  { symbol:"stETH",  name:"Lido Staked ETH",   address:"0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84",   decimals:18, chainId:1,     logo:"https://assets.coingecko.com/coins/images/13442/small/steth_logo.png" },
  // Arbitrum
  { symbol:"ETH",    name:"Ethereum",          address:NATIVE,                                          decimals:18, chainId:42161, logo:"https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  { symbol:"USDC",   name:"USD Coin",           address:"0xaf88d065e77c8cC2239327C5EDb3A432268e5831",   decimals:6,  chainId:42161, logo:"https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol:"ARB",    name:"Arbitrum",           address:"0x912CE59144191C1204E64559FE8253a0e49E6548",   decimals:18, chainId:42161, logo:"https://assets.coingecko.com/coins/images/16547/small/photo_2023-03-29_21.47.00.jpeg" },
  { symbol:"WBTC",   name:"Wrapped BTC",        address:"0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f",   decimals:8,  chainId:42161, logo:"https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png" },
  // Polygon
  { symbol:"POL",    name:"Polygon",            address:NATIVE,                                          decimals:18, chainId:137,   logo:"https://assets.coingecko.com/coins/images/4713/small/matic-token-icon.png" },
  { symbol:"USDC",   name:"USD Coin",            address:"0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",   decimals:6,  chainId:137,   logo:"https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol:"WETH",   name:"Wrapped ETH",         address:"0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",   decimals:18, chainId:137,   logo:"https://assets.coingecko.com/coins/images/2518/small/weth.png" },
];

/* ─── Aggregator config ───────────────────────────────────────────────────── */
const AGGS = [
  { key: "lifi",      name: "LI.FI",      color: "#F97316", sameChainOnly: false },
  { key: "kyber",     name: "KyberSwap",  color: "#31CB9E", sameChainOnly: true  },
  { key: "odos",      name: "Odos",       color: "#9B59B6", sameChainOnly: true  },
  { key: "openocean", name: "OpenOcean",  color: "#22D3EE", sameChainOnly: true  },
  { key: "paraswap",  name: "Paraswap",   color: "#2EBAC6", sameChainOnly: true  },
] as const;

/* ─── Quote type ──────────────────────────────────────────────────────────── */
interface QuoteResult {
  source: string;
  outAmountRaw: bigint;
  outFmt: string;
  outUsd?: string;
  gas?: string;
  route?: string;
  loading: boolean;
  error?: string;
  txTo?: string;
  txData?: string;
  txValue?: bigint;
  txGas?: bigint;
  meta?: unknown;
}

function emptyQuotes(): QuoteResult[] {
  return AGGS.map(a => ({ source: a.key, outAmountRaw: 0n, outFmt: "", loading: false }));
}

/* ─── Individual fetchers ─────────────────────────────────────────────────── */
async function fetchLifi(
  fromChainId: number, toChainId: number,
  fromAddr: string, toAddr: string,
  fromDec: number, toDec: number,
  amount: string, user: string, sig: AbortSignal
): Promise<Partial<QuoteResult>> {
  const amtWei = parseUnits(amount, fromDec).toString();
  const url = `https://li.quest/v1/quote?fromChain=${fromChainId}&toChain=${toChainId}&fromToken=${fromAddr}&toToken=${toAddr}&fromAmount=${amtWei}&fromAddress=${user}&slippage=0.005`;
  const r = await fetch(url, { signal: sig });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.message) throw new Error(d.message.slice(0, 60));
  const outRaw = BigInt(d.estimate?.toAmount ?? "0");
  const outUsdStr = d.estimate?.toAmountUSD;
  const gasUsd = d.estimate?.gasCosts?.[0]?.amountUSD;
  const tx = d.transactionRequest;
  return {
    outAmountRaw: outRaw,
    outFmt: parseFloat(formatUnits(outRaw, toDec)).toFixed(6),
    outUsd: outUsdStr ? `$${parseFloat(outUsdStr).toFixed(2)}` : undefined,
    gas: gasUsd ? `~$${parseFloat(gasUsd).toFixed(2)} gas` : undefined,
    route: (d.includedSteps as Array<{ type: string }>)?.map(s => s.type).join(" → "),
    txTo: tx?.to,
    txData: tx?.data,
    txValue: tx?.value != null ? BigInt(tx.value) : 0n,
    txGas: tx?.gasLimit ? BigInt(tx.gasLimit) : undefined,
  };
}

async function fetchKyber(
  chainKey: string, fromAddr: string, toAddr: string,
  fromDec: number, toDec: number,
  amount: string, user: string, sig: AbortSignal
): Promise<Partial<QuoteResult>> {
  const amtWei = parseUnits(amount, fromDec).toString();
  const r = await fetch(
    `https://aggregator-api.kyberswap.com/${chainKey}/api/v1/routes?tokenIn=${fromAddr}&tokenOut=${toAddr}&amountIn=${amtWei}&gasInclude=true`,
    { signal: sig }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const rs = d?.data?.routeSummary;
  if (!rs) throw new Error("No route");
  const outRaw = BigInt(rs.amountOut ?? "0");
  return {
    outAmountRaw: outRaw,
    outFmt: parseFloat(formatUnits(outRaw, toDec)).toFixed(6),
    gas: rs.gasUsd ? `~$${parseFloat(rs.gasUsd).toFixed(3)} gas` : undefined,
    route: (rs.route?.[0]?.pools as Array<{ exchange: string }>)?.map(p => p.exchange).slice(0, 3).join(" → "),
    meta: { routeSummary: rs, chainKey, user },
  };
}

async function fetchOdos(
  chainId: number, fromAddr: string, toAddr: string,
  fromDec: number, toDec: number,
  amount: string, user: string, sig: AbortSignal
): Promise<Partial<QuoteResult>> {
  const amtWei = parseUnits(amount, fromDec).toString();
  const r = await fetch("https://api.odos.xyz/sor/quote/v2", {
    method: "POST", signal: sig,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chainId, inputTokens: [{ tokenAddress: fromAddr, amount: amtWei }],
      outputTokens: [{ tokenAddress: toAddr, proportion: 1 }],
      userAddr: user, slippageLimitPercent: 0.5, referralCode: 0, disableRFQs: false, compact: true,
    }),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (!d.outAmounts?.[0]) throw new Error("No quote");
  const outRaw = BigInt(d.outAmounts[0]);
  return {
    outAmountRaw: outRaw,
    outFmt: parseFloat(formatUnits(outRaw, toDec)).toFixed(6),
    outUsd: d.outValues?.[0] ? `$${parseFloat(d.outValues[0]).toFixed(2)}` : undefined,
    gas: d.gasEstimateValue ? `~$${parseFloat(d.gasEstimateValue).toFixed(3)} gas` : undefined,
    route: d.pathId ? "Odos Aggregated" : undefined,
    meta: { pathId: d.pathId, user },
  };
}

async function fetchOpenOcean(
  ooChain: string, fromAddr: string, toAddr: string,
  toDec: number, amount: string, user: string, sig: AbortSignal
): Promise<Partial<QuoteResult>> {
  const url = `https://open-api.openocean.finance/v3/${ooChain}/quote?inTokenAddress=${fromAddr}&outTokenAddress=${toAddr}&amount=${amount}&gasPrice=1&slippage=1&account=${user}`;
  const r = await fetch(url, { signal: sig });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.code !== 200) throw new Error((d.error as string | undefined)?.slice(0, 50) ?? "Error");
  const outRaw = BigInt(d.data.outAmount ?? "0");
  return {
    outAmountRaw: outRaw,
    outFmt: parseFloat(formatUnits(outRaw, toDec)).toFixed(6),
    outUsd: d.data.outUsd ? `$${parseFloat(d.data.outUsd).toFixed(2)}` : undefined,
    meta: { ooChain, fromAddr, toAddr, amount, user },
  };
}

async function fetchParaswap(
  chainId: number, fromAddr: string, toAddr: string,
  fromDec: number, toDec: number,
  amount: string, user: string, sig: AbortSignal
): Promise<Partial<QuoteResult>> {
  const amtWei = parseUnits(amount, fromDec).toString();
  const src = fromAddr === NATIVE ? "ETH" : fromAddr;
  const dst = toAddr === NATIVE ? "ETH" : toAddr;
  const url = `https://apiv5.paraswap.io/prices?srcToken=${src}&srcDecimals=${fromDec}&destToken=${dst}&destDecimals=${toDec}&amount=${amtWei}&side=SELL&network=${chainId}&partner=fidcaster`;
  const r = await fetch(url, { signal: sig });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  const pr = d.priceRoute;
  if (!pr?.destAmount) throw new Error("No route");
  const outRaw = BigInt(pr.destAmount);
  const exch = (pr.bestRoute?.[0]?.swaps?.[0]?.swapExchanges as Array<{ exchange: string }> | undefined)?.map(e => e.exchange).slice(0, 3).join(" → ");
  return {
    outAmountRaw: outRaw,
    outFmt: parseFloat(formatUnits(outRaw, toDec)).toFixed(6),
    outUsd: pr.destUSD ? `$${parseFloat(pr.destUSD).toFixed(2)}` : undefined,
    gas: pr.gasCostUSD ? `~$${parseFloat(pr.gasCostUSD).toFixed(3)} gas` : undefined,
    route: exch,
    meta: { priceRoute: pr, chainId, src, dst, amtWei, user, fromDec, toDec },
  };
}

/* ─── Component ──────────────────────────────────────────────────────────── */
interface Props { address: Address; walletColor: string; onClose: () => void }

type Tab = "swap" | "bridge";

export function SwapSheet({ address, walletColor, onClose }: Props) {
  const { walletClient: fcWalletClient } = useWallet();
  const getActiveWalletClient = useWalletStore(s => s.getActiveWalletClient);

  const [tab, setTab] = useState<Tab>("swap");

  const [fromChainId, setFromChainId] = useState<ChainId>(10);
  const [toChainId,   setToChainId]   = useState<ChainId>(8453);
  const [fromToken,   setFromToken]   = useState<Token>(TOKENS[0]);
  const [toToken,     setToToken]     = useState<Token>(TOKENS[1]);
  const [amount,      setAmount]      = useState("");

  const [pickerFor,   setPickerFor]   = useState<"from" | "to" | null>(null);
  const [pickerChain, setPickerChain] = useState<ChainId>(10);
  const [search,      setSearch]      = useState("");

  const [quotes,          setQuotes]          = useState<QuoteResult[]>(emptyQuotes);
  const [selectedSource,  setSelectedSource]  = useState("lifi");
  const [showRoutes,      setShowRoutes]      = useState(false);
  const [swapping,        setSwapping]        = useState(false);
  const [txHash,          setTxHash]          = useState<string | null>(null);
  const quoteCtrl = useRef<AbortController | null>(null);

  // Prepared transaction pending user confirmation (review popup)
  const [pendingTx, setPendingTx] = useState<{
    txTo: Address;
    txData: `0x${string}`;
    txValue: bigint;
    txGas?: bigint;
    needsApproval: boolean;
    needsReset: boolean;
    spender?: Address;
    approveAmount?: bigint;
    simStatus: "passed" | "after-approval";
    gasEstimate?: bigint;
    source: string;
  } | null>(null);
  const [preparing, setPreparing] = useState(false);
  // Which leg of a multi-transaction swap (reset allowance -> approve ->
  // swap) is next. Previously a single "Sign & Send" click silently chained
  // every leg back-to-back with no checkpoint in between -- each blockchain
  // transaction now gets its own explicit confirmation click instead, reset
  // to 0 whenever a fresh pendingTx is prepared. Same fix ported to the
  // native app's SwapScreen.tsx.
  const [stepIndex, setStepIndex] = useState(0);

  // Live wallet balance for the "from" token
  const [fromBalance, setFromBalance] = useState<bigint | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [maxLoading, setMaxLoading] = useState(false);

  // Fetch live balance for the selected from-token whenever it or the address changes
  useEffect(() => {
    if (!address) { setFromBalance(null); return; }
    let cancelled = false;
    setFromBalance(null);
    setLoadingBalance(true);
    const client = getPublicClientForChain(fromChainId);
    const doFetch = async () => {
      try {
        const bal = fromToken.address === NATIVE
          ? await client.getBalance({ address })
          : await client.readContract({
              address: fromToken.address as Address,
              abi: ERC20_BAL_ABI,
              functionName: "balanceOf",
              args: [address],
            }) as bigint;
        if (!cancelled) setFromBalance(bal);
      } catch { if (!cancelled) setFromBalance(null); }
      if (!cancelled) setLoadingBalance(false);
    };
    void doFetch();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromToken.address, fromToken.chainId, fromChainId, address]);

  const isBridge = tab === "bridge";
  const effectiveToChainId = isBridge ? toChainId : fromChainId;
  const fromChain = CHAINS.find(c => c.id === fromChainId)!;
  const toChain   = CHAINS.find(c => c.id === effectiveToChainId)!;

  /* ── Quote fetching ─────────────────────────────────────────────────── */
  const fetchAll = useCallback(async () => {
    const num = parseFloat(amount);
    if (!amount || isNaN(num) || num <= 0) { setQuotes(emptyQuotes()); return; }
    if (quoteCtrl.current) quoteCtrl.current.abort();
    const ctrl = new AbortController();
    quoteCtrl.current = ctrl;
    const sig = ctrl.signal;

    setQuotes(AGGS.map(a => ({ source: a.key, outAmountRaw: 0n, outFmt: "", loading: true })));

    const update = (key: string, patch: Partial<QuoteResult>) => {
      setQuotes(prev => prev.map(q => q.source === key ? { ...q, ...patch, loading: false } : q));
    };

    const run = async (key: string, fn: () => Promise<Partial<QuoteResult>>) => {
      try   { update(key, await fn()); }
      catch (e) {
        if ((e as Error).name === "AbortError") return;
        update(key, { error: (e as Error).message?.slice(0, 40) ?? "Failed" });
      }
    };

    run("lifi", () => fetchLifi(
      fromChainId, effectiveToChainId,
      fromToken.address, toToken.address,
      fromToken.decimals, toToken.decimals,
      amount, address, sig
    ));

    if (!isBridge) {
      run("kyber", () => fetchKyber(
        fromChain.kyberKey, fromToken.address, toToken.address,
        fromToken.decimals, toToken.decimals, amount, address, sig
      ));
      run("odos", () => fetchOdos(
        fromChainId, fromToken.address, toToken.address,
        fromToken.decimals, toToken.decimals, amount, address, sig
      ));
      run("openocean", () => fetchOpenOcean(
        fromChain.ooKey, fromToken.address, toToken.address,
        toToken.decimals, amount, address, sig
      ));
      run("paraswap", () => fetchParaswap(
        fromChainId, fromToken.address, toToken.address,
        fromToken.decimals, toToken.decimals, amount, address, sig
      ));
    } else {
      for (const k of ["kyber", "odos", "openocean", "paraswap"]) {
        update(k, { error: "Cross-chain: use LI.FI" });
      }
    }
  }, [amount, fromToken, toToken, fromChainId, effectiveToChainId, isBridge, address, fromChain]);

  useEffect(() => {
    const t = setTimeout(fetchAll, 600);
    return () => clearTimeout(t);
  }, [fetchAll]);

  useEffect(() => {
    const loaded = quotes.filter(q => !q.loading && !q.error && q.outAmountRaw > 0n);
    if (!loaded.length) return;
    const best = loaded.reduce((a, b) => (b.outAmountRaw > a.outAmountRaw ? b : a));
    setSelectedSource(best.source);
  }, [quotes]);

  const selectedQ = quotes.find(q => q.source === selectedSource);

  /* ── Prepare (build tx + allowance check + simulation) ──────────────── */
  async function prepare() {
    if (!selectedQ?.outFmt || !amount || swapping || preparing) return;
    setPreparing(true);
    try {
      let txTo: string | undefined;
      let txData: string | undefined;
      let txValue: bigint = 0n;
      let txGas: bigint | undefined;
      let spender: string | undefined;

      const src = selectedQ.source;

      if (src === "lifi" && selectedQ.txTo) {
        txTo    = selectedQ.txTo;
        txData  = selectedQ.txData;
        txValue = selectedQ.txValue ?? 0n;
        txGas   = selectedQ.txGas;

      } else if (src === "openocean") {
        const m = selectedQ.meta as { ooChain: string; fromAddr: string; toAddr: string; amount: string; user: string };
        const r = await fetch(
          `https://open-api.openocean.finance/v3/${m.ooChain}/swap_quote?inTokenAddress=${m.fromAddr}&outTokenAddress=${m.toAddr}&amount=${m.amount}&gasPrice=1&slippage=1&account=${m.user}`,
          { signal: AbortSignal.timeout(15_000) }
        );
        if (!r.ok) throw new Error(`OO ${r.status}`);
        const d = await r.json();
        if (d.code !== 200) throw new Error(d.error ?? "OO swap error");
        txTo    = d.data.to;
        txData  = d.data.data;
        txValue = fromToken.address === NATIVE ? parseUnits(amount, fromToken.decimals) : 0n;
        txGas   = BigInt(Math.ceil(Number(d.data.estimatedGas) * 1.3));

      } else if (src === "kyber") {
        const m = selectedQ.meta as { routeSummary: unknown; chainKey: string; user: string };
        const r = await fetch(
          `https://aggregator-api.kyberswap.com/${m.chainKey}/api/v1/route/build`,
          {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ routeSummary: m.routeSummary, sender: m.user, recipient: m.user, slippageTolerance: 50 }),
            signal: AbortSignal.timeout(15_000),
          }
        );
        if (!r.ok) throw new Error(`Kyber ${r.status}`);
        const d = await r.json();
        txTo    = d.data?.routerAddress;
        txData  = d.data?.data;
        txValue = fromToken.address === NATIVE ? parseUnits(amount, fromToken.decimals) : 0n;

      } else if (src === "odos") {
        const m = selectedQ.meta as { pathId: string; user: string };
        const r = await fetch("https://api.odos.xyz/sor/assemble", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pathId: m.pathId, userAddr: m.user, simulate: false }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) throw new Error(`Odos ${r.status}`);
        const d = await r.json();
        txTo    = d.transaction?.to;
        txData  = d.transaction?.data;
        txValue = d.transaction?.value ? BigInt(d.transaction.value) : 0n;
        txGas   = d.transaction?.gas ? BigInt(d.transaction.gas) : undefined;

      } else if (src === "paraswap") {
        const m = selectedQ.meta as { priceRoute: { tokenTransferProxy?: string }; chainId: number; src: string; dst: string; amtWei: string; user: string; fromDec: number; toDec: number };
        spender = m.priceRoute?.tokenTransferProxy;
        const r = await fetch(`https://apiv5.paraswap.io/transactions/${m.chainId}`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            srcToken: m.src, srcDecimals: m.fromDec, destToken: m.dst, destDecimals: m.toDec,
            srcAmount: m.amtWei, slippage: 1, priceRoute: m.priceRoute,
            userAddress: m.user, partner: "fidcaster",
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!r.ok) throw new Error(`Paraswap ${r.status}`);
        const d = await r.json();
        txTo    = d.to;
        txData  = d.data;
        txValue = d.value ? BigInt(d.value) : 0n;
        txGas   = d.gas ? BigInt(Math.ceil(Number(d.gas) * 1.2)) : undefined;
      }

      if (!txTo || !txData) throw new Error("Could not build transaction");

      const pub = getPublicClientForChain(fromChainId);
      const approveSpender = (spender ?? txTo) as Address;
      const sellAmount = parseUnits(amount, fromToken.decimals);

      // ERC-20 sells need an allowance for the router before the swap can succeed
      let needsApproval = false;
      let needsReset = false;
      if (fromToken.address !== NATIVE) {
        const allowance = await pub.readContract({
          address: fromToken.address as Address,
          abi: ERC20_ALLOWANCE_ABI,
          functionName: "allowance",
          args: [address, approveSpender],
        }) as bigint;
        needsApproval = allowance < sellAmount;
        // Some tokens (USDT being the famous case — and it's swappable here
        // on both Optimism and Ethereum) reject changing a non-zero
        // allowance straight to a different non-zero value; it must go
        // through zero first. Detecting this reliably per-token isn't
        // practical, so always take the safe two-step path whenever a
        // leftover non-zero allowance exists (harmless extra tx for tokens
        // that don't require it).
        needsReset = needsApproval && allowance > 0n;
      }

      // Simulate before ever signing: a failing eth_call means the swap would
      // revert on-chain, so surface the error instead of burning gas.
      let gasEstimate: bigint | undefined;
      let simStatus: "passed" | "after-approval" = "passed";
      if (needsApproval) {
        // Swap can't be simulated until the approval lands — simulate
        // whichever tx actually gets broadcast first: the zero-reset if one
        // is needed, otherwise the approval itself.
        simStatus = "after-approval";
        await pub.call({
          account: address,
          to: fromToken.address as Address,
          data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [approveSpender, needsReset ? 0n : sellAmount] }),
        });
      } else {
        await pub.call({
          account: address,
          to: txTo as Address,
          data: txData as `0x${string}`,
          value: txValue,
        });
        try {
          gasEstimate = await pub.estimateGas({
            account: address,
            to: txTo as Address,
            data: txData as `0x${string}`,
            value: txValue,
          });
        } catch { /* keep aggregator-provided gas */ }
      }

      setPendingTx({
        txTo: txTo as Address,
        txData: txData as `0x${string}`,
        txValue,
        txGas,
        needsApproval,
        needsReset,
        spender: approveSpender,
        approveAmount: sellAmount,
        simStatus,
        gasEstimate,
        source: src,
      });
      setStepIndex(0);
    } catch (e) {
      const msg = (e as Error).message ?? "Failed to prepare transaction";
      toast.error(msg.includes("revert") || msg.includes("execution")
        ? "Simulation failed — this swap would revert on-chain. Try refreshing quotes."
        : msg.slice(0, 140));
    } finally {
      setPreparing(false);
    }
  }

  // The ordered legs of this pendingTx, each requiring its own explicit
  // confirmation click -- never auto-chained. Reset (USDT-style allowance
  // reset) and approve are each a real on-chain transaction with their own
  // signature; so is the swap/bridge itself.
  function swapSteps(tx: NonNullable<typeof pendingTx>): Array<"reset" | "approve" | "swap"> {
    const steps: Array<"reset" | "approve" | "swap"> = [];
    if (tx.needsApproval) {
      if (tx.needsReset) steps.push("reset");
      steps.push("approve");
    }
    steps.push("swap");
    return steps;
  }

  /* ── Confirm & sign ONE step, in response to an explicit user click ──── */
  async function confirmCurrentStep() {
    if (!pendingTx || swapping) return;
    const steps = swapSteps(pendingTx);
    const step = steps[stepIndex];
    setSwapping(true);
    try {
      let wc = fcWalletClient;
      try { const sc = await getActiveWalletClient(); if (sc) wc = sc.walletClient; } catch { /* fall back */ }
      if (!wc?.account) throw new Error("No wallet connected");

      // Always sign & broadcast on the chain the quote was built for — never
      // reuse a client bound to another chain's RPC.
      const chainWc = createChainWalletClient(wc.account, fromChainId);
      const pub = getPublicClientForChain(fromChainId);

      if (step === "reset") {
        const resetHash = await chainWc.sendTransaction({
          account: chainWc.account!,
          chain: fromChain.viem,
          to: fromToken.address as Address,
          data: encodeFunctionData({ abi: ERC20_APPROVE_ABI, functionName: "approve", args: [pendingTx.spender!, 0n] }),
          value: 0n,
        });
        toast.info(`Resetting ${fromToken.symbol} allowance…`);
        await pub.waitForTransactionReceipt({ hash: resetHash, timeout: 60_000 });
        setStepIndex(i => i + 1);
        return;
      }

      if (step === "approve") {
        const approveHash = await chainWc.sendTransaction({
          account: chainWc.account!,
          chain: fromChain.viem,
          to: fromToken.address as Address,
          data: encodeFunctionData({
            abi: ERC20_APPROVE_ABI,
            functionName: "approve",
            args: [pendingTx.spender!, pendingTx.approveAmount!],
          }),
          value: 0n,
        });
        toast.success(`${fromToken.symbol} approved.`);
        await pub.waitForTransactionReceipt({ hash: approveHash, timeout: 60_000 });
        setStepIndex(i => i + 1);
        return;
      }

      // step === "swap"
      const hash = await chainWc.sendTransaction({
        account: chainWc.account!,
        chain: fromChain.viem,
        to: pendingTx.txTo,
        data: pendingTx.txData,
        value: pendingTx.txValue,
        ...(pendingTx.gasEstimate
          ? { gas: (pendingTx.gasEstimate * 130n) / 100n }
          : pendingTx.txGas ? { gas: pendingTx.txGas } : {}),
      });

      setPendingTx(null);
      setStepIndex(0);
      setTxHash(hash);
      toast.success(isBridge ? "Bridge submitted!" : "Swap submitted!");
      setAmount("");
    } catch (e) {
      toast.error(((e as Error).message ?? "Transaction failed").slice(0, 140));
    } finally {
      setSwapping(false);
    }
  }

  /* ── Helpers ─────────────────────────────────────────────────────────── */
  function explorerUrl(hash: string) {
    if (fromChainId === 10)    return `https://optimistic.etherscan.io/tx/${hash}`;
    if (fromChainId === 8453)  return `https://basescan.org/tx/${hash}`;
    if (fromChainId === 1)     return `https://etherscan.io/tx/${hash}`;
    if (fromChainId === 42161) return `https://arbiscan.io/tx/${hash}`;
    if (fromChainId === 137)   return `https://polygonscan.com/tx/${hash}`;
    return "#";
  }

  async function onMaxFrom() {
    if (!fromBalance || fromBalance <= 0n || maxLoading) return;
    if (fromToken.address !== NATIVE) {
      // ERC-20 sells don't touch the token itself for gas — the exact full
      // raw balance is always sellable. Uses formatUnits directly (not a
      // parseFloat/toFixed(6) round-trip) so high-decimal tokens don't lose
      // precision and leave dust behind.
      setAmount(formatUnits(fromBalance, fromToken.decimals));
      setTxHash(null);
      return;
    }
    setMaxLoading(true);
    try {
      const pub = getPublicClientForChain(fromChainId);
      const [gasPrice, baseGas] = await Promise.all([
        pub.getGasPrice(),
        pub.estimateGas({ account: address, to: address, value: 1n }).catch(() => 21_000n),
      ]);
      // A swap/bridge transaction costs meaningfully more than a plain
      // transfer (router logic, DEX calls) and the exact router isn't known
      // until a quote comes back — use a generous floor rather than the
      // flat ETH-amount buffer this used to be (which ignored gas price
      // entirely and badly under-reserved on Ethereum L1).
      const swapGasUnits = baseGas > 150_000n ? baseGas : 150_000n;
      const reserve = (swapGasUnits * gasPrice * 150n) / 100n;
      const maxWei = fromBalance > reserve ? fromBalance - reserve : 0n;
      setAmount(formatUnits(maxWei, fromToken.decimals));
    } catch {
      const raw = parseFloat(formatUnits(fromBalance, fromToken.decimals));
      setAmount(Math.max(0, raw - 0.002).toFixed(6));
    } finally {
      setMaxLoading(false);
    }
    setTxHash(null);
  }

  function switchSides() {
    const pFT = fromToken; const pTT = toToken;
    const pFC = fromChainId; const pTC = toChainId;
    setFromToken(pTT); setToToken(pFT);
    if (isBridge) { setFromChainId(pTC); setToChainId(pFC); }
    setAmount(""); setTxHash(null);
  }

  function pickFromChain(id: ChainId) {
    setFromChainId(id);
    const def = TOKENS.find(t => t.chainId === id)!;
    setFromToken(def);
    setAmount(""); setTxHash(null);
  }

  function pickToChain(id: ChainId) {
    setToChainId(id);
    const sameSymbol = TOKENS.find(t => t.chainId === id && t.symbol === toToken.symbol);
    setToToken(sameSymbol ?? TOKENS.find(t => t.chainId === id)!);
    setAmount(""); setTxHash(null);
  }

  const sortedQuotes = [...quotes].sort((a, b) => {
    if (a.loading  && !b.loading)  return -1;
    if (!a.loading && b.loading)   return 1;
    if (a.error    && !b.error)    return 1;
    if (!a.error   && b.error)     return -1;
    return b.outAmountRaw > a.outAmountRaw ? 1 : -1;
  });

  const bestSource = sortedQuotes.find(q => !q.loading && !q.error && q.outAmountRaw > 0n)?.source;
  const activeAgg  = AGGS.find(a => a.key === selectedSource);

  /* ── Render ──────────────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col h-full min-h-0">

      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-2 shrink-0">
        <div className="flex gap-0.5 p-1 bg-muted/50 rounded-xl border border-border/40">
          {(["swap", "bridge"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn("px-4 py-1.5 rounded-lg text-xs font-bold transition-all capitalize", t === tab ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={fetchAll} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted/50 transition-colors">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-2 min-h-0">

        {/* Bridge: from chain row */}
        {isBridge && (
          <div className="flex gap-1.5">
            {CHAINS.map(c => (
              <button key={c.id} onClick={() => pickFromChain(c.id)}
                className={cn("flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border truncate",
                  fromChainId === c.id ? "text-white border-transparent" : "border-border/60 text-muted-foreground hover:text-foreground bg-muted/20")}
                style={fromChainId === c.id ? { backgroundColor: c.color } : {}}>
                {c.short}
              </button>
            ))}
          </div>
        )}

        {/* From box */}
        <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/60 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              {isBridge ? `From · ${fromChain.label}` : "You pay"}
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">
                {loadingBalance ? "…" : fromBalance !== null ? `${parseFloat(formatUnits(fromBalance, fromToken.decimals)).toFixed(4)} ${fromToken.symbol}` : ""}
              </span>
              {fromBalance !== null && fromBalance > 0n && (
                <button
                  onClick={onMaxFrom}
                  disabled={maxLoading}
                  className="flex items-center gap-1 text-[10px] font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 hover:bg-primary/20 transition-colors disabled:opacity-50"
                >
                  {maxLoading && <Loader2 size={9} className="animate-spin" />}
                  MAX
                </button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" min="0" placeholder="0.0" value={amount}
              onChange={e => { setAmount(e.target.value); setTxHash(null); }}
              className="flex-1 bg-transparent text-2xl font-black text-foreground outline-none tabular-nums min-w-0" />
            <button onClick={() => { setPickerFor("from"); setPickerChain(fromChainId); setSearch(""); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-background border border-border hover:border-primary/40 transition-colors shrink-0 shadow-sm">
              <img src={fromToken.logo} alt="" className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display="none"; }} />
              <span className="text-sm font-bold">{fromToken.symbol}</span>
              <ChevronDown size={12} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Flip */}
        <div className="flex justify-center">
          <button onClick={switchSides}
            className="p-2 rounded-full bg-muted/40 hover:bg-muted border border-border hover:border-primary/30 transition-all hover:rotate-180 duration-300">
            <ArrowUpDown size={13} className="text-muted-foreground" />
          </button>
        </div>

        {/* Bridge: to chain row */}
        {isBridge && (
          <div className="flex gap-1.5">
            {CHAINS.filter(c => c.id !== fromChainId).map(c => (
              <button key={c.id} onClick={() => pickToChain(c.id)}
                className={cn("flex-1 py-1.5 rounded-lg text-[10px] font-bold transition-all border truncate",
                  toChainId === c.id ? "text-white border-transparent" : "border-border/60 text-muted-foreground hover:text-foreground bg-muted/20")}
                style={toChainId === c.id ? { backgroundColor: c.color } : {}}>
                {c.short}
              </button>
            ))}
          </div>
        )}

        {/* To box */}
        <div className="p-3.5 rounded-2xl bg-muted/20 border border-border/60 space-y-1">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {isBridge ? `To · ${toChain.label}` : "You receive"}
          </span>
          <div className="flex items-center gap-2">
            <div className="flex-1 text-2xl font-black tabular-nums text-muted-foreground min-h-[2rem] flex items-center">
              {selectedQ?.loading
                ? <Loader2 size={18} className="animate-spin text-muted-foreground" />
                : selectedQ?.outFmt ? selectedQ.outFmt : "—"}
            </div>
            <button onClick={() => { setPickerFor("to"); setPickerChain(isBridge ? toChainId : fromChainId); setSearch(""); }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-background border border-border hover:border-primary/40 transition-colors shrink-0 shadow-sm">
              <img src={toToken.logo} alt="" className="w-4 h-4 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display="none"; }} />
              <span className="text-sm font-bold">{toToken.symbol}</span>
              <ChevronDown size={12} className="text-muted-foreground" />
            </button>
          </div>
          {selectedQ?.outUsd && (
            <p className="text-[11px] text-muted-foreground">≈ {selectedQ.outUsd}</p>
          )}
        </div>

        {/* Best route — auto-selected, comparison is view-only */}
        {amount && parseFloat(amount) > 0 && (
          <div className="space-y-1">
            {(() => {
              const anyLoading = quotes.some(q => q.loading);
              const best = quotes.find(q => q.source === selectedSource);
              const agg = AGGS.find(a => a.key === selectedSource);
              const okCount = quotes.filter(q => !q.loading && !q.error && q.outAmountRaw > 0n).length;
              if (!best || (!best.outFmt && anyLoading)) {
                return (
                  <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-border/40 bg-muted/10">
                    <Loader2 size={13} className="animate-spin text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground">Finding the best route…</span>
                  </div>
                );
              }
              if (!best.outFmt) return null;
              return (
                <button onClick={() => setShowRoutes(v => !v)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-left">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `${agg?.color ?? "#10b981"}22` }}>
                    <div className="w-2 h-2 rounded-full" style={{ background: agg?.color ?? "#10b981" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-foreground">Best route: {agg?.name}</span>
                      <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 uppercase tracking-wide">Auto</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-tight">
                      {anyLoading ? "Still comparing…" : `Picked automatically from ${Math.max(okCount, 1)} quote${okCount === 1 ? "" : "s"}`}
                      {best.gas ? ` · ${best.gas}` : ""}
                    </p>
                  </div>
                  <ChevronDown size={13} className={cn("text-muted-foreground shrink-0 transition-transform", showRoutes && "rotate-180")} />
                </button>
              );
            })()}
            {showRoutes && sortedQuotes.map(q => {
              const agg = AGGS.find(a => a.key === q.source)!;
              if (q.error === "Cross-chain: use LI.FI") return null;
              const isBestQ = q.source === bestSource;
              return (
                <div key={q.source}
                  className={cn(
                    "w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border border-border/40 bg-muted/10 text-left",
                    (q.loading || q.error) && "opacity-50"
                  )}>
                  <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: `${agg.color}22` }}>
                    <div className="w-1.5 h-1.5 rounded-full" style={{ background: agg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold text-foreground">{agg.name}</span>
                      {isBestQ && !q.loading && !q.error && (
                        <span className="text-[8px] font-black px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 uppercase tracking-wide">Best</span>
                      )}
                    </div>
                    {q.route && <p className="text-[9px] text-muted-foreground truncate leading-tight">{q.route}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {q.loading
                      ? <Loader2 size={12} className="animate-spin text-muted-foreground" />
                      : q.error
                      ? <span className="text-[9px] text-muted-foreground/60">{q.error.slice(0, 20)}</span>
                      : <p className="text-xs font-bold text-foreground tabular-nums">{q.outFmt}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Tx success */}
        {txHash && (
          <a href={explorerUrl(txHash)} target="_blank" rel="noreferrer"
            className="flex items-center gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 transition-colors">
            <Check size={13} className="shrink-0" />
            <span className="font-bold">{isBridge ? "Bridge" : "Swap"} sent!</span>
            <span className="font-mono truncate flex-1">{txHash.slice(0, 16)}…</span>
            <ExternalLink size={11} className="shrink-0" />
          </a>
        )}

        {/* Review button — opens the confirmation popup, nothing is signed yet */}
        <button onClick={prepare}
          disabled={!selectedQ?.outFmt || !amount || swapping || preparing || !!selectedQ?.loading}
          className="w-full py-3.5 rounded-2xl text-white font-bold text-sm disabled:opacity-40 transition-all flex items-center justify-center gap-2"
          style={{
            backgroundColor: walletColor,
            boxShadow: selectedQ?.outFmt ? `0 6px 20px ${walletColor}44` : undefined,
          }}>
          {swapping
            ? <><Loader2 size={15} className="animate-spin" /> Processing…</>
            : preparing
            ? <><Loader2 size={15} className="animate-spin" /> Simulating…</>
            : !amount
            ? "Enter Amount"
            : !selectedQ?.outFmt
            ? "Fetching quotes…"
            : isBridge
            ? `Review Bridge (${activeAgg?.name ?? "LI.FI"})`
            : `Review Swap (${activeAgg?.name ?? "Best route"})`}
        </button>

        <p className="text-[10px] text-muted-foreground text-center pb-1">
          {isBridge
            ? "Powered by LI.FI · 20+ bridges · Optimism, Base, ETH, Arbitrum, Polygon"
            : "Best rate from 5 aggregators: LI.FI, KyberSwap, Odos, OpenOcean, Paraswap"}
        </p>
      </div>

      {/* Confirm transaction popup — centered, shows simulation result before signing */}
      {pendingTx && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={() => { if (!swapping) { setPendingTx(null); setStepIndex(0); } }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm bg-card rounded-3xl border border-border shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}>
            <div className="px-5 pt-5 pb-4 border-b border-border/60">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Confirm {isBridge ? "Bridge" : "Swap"}</p>
              <p className="text-[15px] font-semibold text-foreground">
                {amount} {fromToken.symbol} → ~{selectedQ?.outFmt} {toToken.symbol}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-xl border border-border/50 bg-muted/30 divide-y divide-border/40 text-sm">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">You pay</span>
                  <span className="font-semibold text-foreground font-mono">{amount} {fromToken.symbol}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">You receive</span>
                  <div className="text-right">
                    <span className="font-semibold text-foreground font-mono">~{selectedQ?.outFmt} {toToken.symbol}</span>
                    {selectedQ?.outUsd && <p className="text-xs text-muted-foreground">{selectedQ.outUsd}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium text-foreground">
                    {fromChain.label}{isBridge ? ` → ${toChain.label}` : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-muted-foreground">Route</span>
                  <span className="font-medium text-foreground">{AGGS.find(a => a.key === pendingTx.source)?.name}</span>
                </div>
                {pendingTx.gasEstimate !== undefined && (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-muted-foreground">Est. gas</span>
                    <span className="font-medium text-foreground font-mono">{pendingTx.gasEstimate.toLocaleString()} units</span>
                  </div>
                )}
              </div>

              {(() => {
                const steps = swapSteps(pendingTx);
                const step = steps[stepIndex];
                const multiStep = steps.length > 1;
                const stepLabel =
                  step === "reset" ? `Reset ${fromToken.symbol} Allowance`
                  : step === "approve" ? `Approve ${fromToken.symbol}`
                  : "Sign & Send";
                return (
                  <>
                    {pendingTx.simStatus === "passed" ? (
                      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400">
                        <Check size={13} className="shrink-0 mt-0.5" />
                        Simulation passed — this transaction should succeed on-chain.
                      </div>
                    ) : (
                      <div className="flex items-start gap-2 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                        <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                        {multiStep
                          ? `Step ${stepIndex + 1} of ${steps.length}: each transaction is signed separately — this one is "${stepLabel}".`
                          : "Confirm below to sign and send this transaction."}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground text-center">Nothing is signed until you confirm below.</p>
                  </>
                );
              })()}
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => { setPendingTx(null); setStepIndex(0); }} disabled={swapping}
                className="flex-1 py-3.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={confirmCurrentStep} disabled={swapping}
                className="flex-1 py-3.5 rounded-xl text-white text-sm font-bold transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ backgroundColor: walletColor }}>
                {swapping
                  ? <><Loader2 size={14} className="animate-spin" /> Signing…</>
                  : swapSteps(pendingTx)[stepIndex] === "reset" ? `Reset ${fromToken.symbol} Allowance`
                  : swapSteps(pendingTx)[stepIndex] === "approve" ? `Approve ${fromToken.symbol}`
                  : "Sign & Send"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Token picker */}
      {pickerFor && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" onClick={() => setPickerFor(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative bg-card rounded-2xl w-full max-w-sm max-h-[65vh] flex flex-col overflow-hidden shadow-2xl border border-border/60 mt-2"
            onClick={e => e.stopPropagation()}>
            <div className="px-4 pt-4 pb-2 shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-foreground">Select Token</p>
                <button onClick={() => setPickerFor(null)} className="p-1 text-muted-foreground hover:text-foreground"><X size={16} /></button>
              </div>
              {/* Chain filter tabs in picker */}
              <div className="flex gap-1">
                {CHAINS.map(c => (
                  <button key={c.id} onClick={() => setPickerChain(c.id)}
                    className={cn("flex-1 py-1 rounded-lg text-[9px] font-bold transition-all border truncate",
                      pickerChain === c.id ? "text-white border-transparent" : "border-border/50 text-muted-foreground")}
                    style={pickerChain === c.id ? { backgroundColor: c.color } : {}}>
                    {c.short}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/40 border border-border/40">
                <Search size={13} className="text-muted-foreground shrink-0" />
                <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  className="flex-1 bg-transparent text-sm outline-none text-foreground placeholder:text-muted-foreground" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto pb-4">
              {TOKENS
                .filter(t => t.chainId === pickerChain && (
                  search === "" ||
                  t.symbol.toLowerCase().includes(search.toLowerCase()) ||
                  t.name.toLowerCase().includes(search.toLowerCase())
                ))
                .map(tk => (
                  <button key={`${tk.chainId}-${tk.address}`}
                    onClick={() => {
                      if (pickerFor === "from") {
                        setFromToken(tk);
                        setFromChainId(tk.chainId);
                        // In swap mode, keep to-token on the same chain
                        if (!isBridge) {
                          const compatTo = TOKENS.find(t => t.chainId === tk.chainId && t.address !== tk.address);
                          if (compatTo) setToToken(compatTo);
                        }
                      } else {
                        setToToken(tk);
                        if (isBridge) {
                          setToChainId(tk.chainId);
                        } else if (tk.chainId !== fromChainId) {
                          // Swap mode: auto-sync from-chain so aggregators get consistent params
                          setFromChainId(tk.chainId);
                          const compatFrom = TOKENS.find(t => t.chainId === tk.chainId && t.address === NATIVE);
                          if (compatFrom) setFromToken(compatFrom);
                        }
                      }
                      setPickerFor(null); setAmount(""); setTxHash(null);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors">
                    <img src={tk.logo} alt="" className="w-8 h-8 rounded-full bg-muted/20" onError={e => { (e.target as HTMLImageElement).style.display="none"; }} />
                    <div className="flex-1 text-left">
                      <p className="text-sm font-bold text-foreground">{tk.symbol}</p>
                      <p className="text-[11px] text-muted-foreground">{tk.name}</p>
                    </div>
                    {((pickerFor === "from" && tk.address === fromToken.address && tk.chainId === fromToken.chainId) ||
                      (pickerFor === "to"   && tk.address === toToken.address   && tk.chainId === toToken.chainId)) && (
                      <Check size={14} className="text-primary shrink-0" />
                    )}
                  </button>
                ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
