import React, { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpDown, ChevronDown, Loader2, X, ExternalLink, AlertTriangle, RefreshCw } from "lucide-react";
import { parseEther, parseUnits, formatUnits, type Address } from "viem";
import { optimism, base } from "viem/chains";
import { publicClient, basePublicClient, USDC_BASE_ADDRESS, ERC20_TRANSFER_ABI } from "@/lib/contracts";
import { createBaseWalletClient } from "@/lib/wallet";
import { useWalletStore } from "@/store/walletStore";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";

const NATIVE = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

type ChainId = "optimism" | "base";
type TokenDef = { symbol: string; address: string; decimals: number; chain: ChainId; logo: string };

const TOKENS: TokenDef[] = [
  { symbol: "ETH",  address: NATIVE,                                         decimals: 18, chain: "optimism", logo: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  { symbol: "USDC", address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607", decimals: 6,  chain: "optimism", logo: "https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol: "ETH",  address: NATIVE,                                         decimals: 18, chain: "base",     logo: "https://assets.coingecko.com/coins/images/279/small/ethereum.png" },
  { symbol: "USDC", address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  chain: "base",     logo: "https://assets.coingecko.com/coins/images/6319/small/usdc.png" },
  { symbol: "OP",   address: "0x4200000000000000000000000000000000000042", decimals: 18, chain: "optimism", logo: "https://assets.coingecko.com/coins/images/25244/small/Optimism.png" },
];

const CHAIN_LABEL: Record<ChainId, string> = { optimism: "Optimism", base: "Base" };
const CHAIN_ID: Record<ChainId, number> = { optimism: 10, base: 8453 };
const OO_CHAIN: Record<ChainId, string> = { optimism: "optimism", base: "bsc" };

type QuoteState = { outAmount: string; outUsd: string | null; gas: string | null } | null;

interface Props { address: Address; walletColor: string; onClose: () => void; }

export function SwapSheet({ address, walletColor, onClose }: Props) {
  const { walletClient: fcWalletClient } = useWallet();
  const getActiveWalletClient = useWalletStore(s => s.getActiveWalletClient);

  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<QuoteState>(null);
  const [loadingQuote, setLoadingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const quoteRef = useRef<AbortController | null>(null);
  const rawQuoteRef = useRef<Record<string, unknown> | null>(null);

  const fromToken = TOKENS[fromIdx];
  const toToken = TOKENS[toIdx];

  const getQuote = useCallback(async (amt: string) => {
    const num = parseFloat(amt);
    if (!amt || isNaN(num) || num <= 0) { setQuote(null); return; }
    if (quoteRef.current) quoteRef.current.abort();
    const ctrl = new AbortController();
    quoteRef.current = ctrl;
    setLoadingQuote(true); setQuoteError(null);
    try {
      const amountWei = fromToken.decimals === 18 ? parseEther(amt).toString() : parseUnits(amt, fromToken.decimals).toString();
      const chain = OO_CHAIN[fromToken.chain] === "bsc" && fromToken.chain === "base" ? "bsc" : fromToken.chain;
      const url = `https://open-api.openocean.finance/v3/${fromToken.chain === "base" ? "bsc" : "optimism"}/quote?inTokenAddress=${fromToken.address}&outTokenAddress=${toToken.address}&amount=${amt}&gasPrice=1&slippage=1&account=${address}`;
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`Quote failed: ${r.status}`);
      const data = await r.json();
      if (data.code !== 200) throw new Error(data.error ?? "Quote error");
      const outAmt = formatUnits(BigInt(data.data.outAmount), toToken.decimals);
      const outUsd = data.data.outUsd ? `$${parseFloat(data.data.outUsd).toFixed(2)}` : null;
      setQuote({ outAmount: parseFloat(outAmt).toFixed(6), outUsd, gas: null });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setQuoteError((e as Error).message ?? "Could not get quote");
    } finally {
      setLoadingQuote(false);
    }
  }, [fromToken, toToken, address]);

  useEffect(() => {
    const t = setTimeout(() => getQuote(amount), 600);
    return () => clearTimeout(t);
  }, [amount, getQuote]);

  async function executeSwap() {
    const num = parseFloat(amount);
    if (!num || !quote) return;
    setSwapping(true);
    try {
      const amtWei = fromToken.decimals === 18 ? parseEther(amount).toString() : parseUnits(amount, fromToken.decimals).toString();
      const swapUrl = `https://open-api.openocean.finance/v3/${fromToken.chain === "base" ? "bsc" : "optimism"}/swap_quote?inTokenAddress=${fromToken.address}&outTokenAddress=${toToken.address}&amount=${amount}&gasPrice=1&slippage=1&account=${address}`;
      const r = await fetch(swapUrl, { signal: AbortSignal.timeout(15_000) });
      if (!r.ok) throw new Error(`Swap data failed: ${r.status}`);
      const data = await r.json();
      if (data.code !== 200) throw new Error(data.error ?? "Swap error");
      const tx = data.data;

      let wc = fcWalletClient;
      try { const sc = await getActiveWalletClient(); if (sc) wc = sc.walletClient; } catch {}
      if (!wc) throw new Error("No wallet connected");

      const isBase = fromToken.chain === "base";
      const activeClient = isBase ? createBaseWalletClient(wc.account!) : wc;
      const chain = isBase ? base : optimism;

      const hash = await activeClient.sendTransaction({
        account: wc.account!,
        chain,
        to: tx.to as Address,
        data: tx.data,
        value: fromToken.address === NATIVE ? BigInt(amtWei) : 0n,
        gas: BigInt(Math.ceil(Number(tx.estimatedGas) * 1.3)),
      });
      setTxHash(hash);
      toast.success("Swap submitted!");
      setAmount("");
      setQuote(null);
    } catch (e) {
      toast.error((e as Error).message ?? "Swap failed");
    } finally {
      setSwapping(false);
    }
  }

  function flip() {
    const prevFrom = fromIdx;
    setFromIdx(toIdx);
    setToIdx(prevFrom);
    setAmount("");
    setQuote(null);
  }

  const explorerBase = fromToken.chain === "optimism" ? "https://optimistic.etherscan.io/tx/" : "https://basescan.org/tx/";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <span className="text-base font-bold text-foreground">Swap</span>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground"><X size={20} /></button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-3">
        {/* From */}
        <div className="p-4 rounded-2xl bg-card border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">From</span>
            <span className="text-xs text-muted-foreground">{CHAIN_LABEL[fromToken.chain]}</span>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="number" min="0" placeholder="0.0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="flex-1 bg-transparent text-2xl font-black text-foreground outline-none tabular-nums"
            />
            <button
              onClick={() => setShowFromPicker(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50 hover:bg-muted/80 transition-colors"
            >
              <img src={fromToken.logo} alt={fromToken.symbol} className="w-5 h-5 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className="text-sm font-bold text-foreground">{fromToken.symbol}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Flip */}
        <div className="flex justify-center">
          <button onClick={flip} className="p-2 rounded-full bg-muted/50 hover:bg-muted/80 transition-colors border border-border">
            <ArrowUpDown size={16} className="text-muted-foreground" />
          </button>
        </div>

        {/* To */}
        <div className="p-4 rounded-2xl bg-card border border-border space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">To</span>
            <span className="text-xs text-muted-foreground">{CHAIN_LABEL[toToken.chain]}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex-1 text-2xl font-black tabular-nums text-muted-foreground min-h-[2rem]">
              {loadingQuote ? <Loader2 size={20} className="animate-spin text-muted-foreground" /> : quote ? quote.outAmount : "—"}
            </div>
            <button
              onClick={() => setShowToPicker(true)}
              className="flex items-center gap-2 px-3 py-2 rounded-xl bg-muted/50 hover:bg-muted/80 transition-colors"
            >
              <img src={toToken.logo} alt={toToken.symbol} className="w-5 h-5 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              <span className="text-sm font-bold text-foreground">{toToken.symbol}</span>
              <ChevronDown size={14} className="text-muted-foreground" />
            </button>
          </div>
          {quote?.outUsd && <p className="text-xs text-muted-foreground">≈ {quote.outUsd}</p>}
        </div>

        {quoteError && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            <AlertTriangle size={13} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Quote unavailable</p>
              <p>{quoteError}</p>
              <a href={`https://app.uniswap.org/swap?chain=${fromToken.chain}&inputCurrency=${fromToken.address === NATIVE ? "ETH" : fromToken.address}&outputCurrency=${toToken.address === NATIVE ? "ETH" : toToken.address}`}
                target="_blank" rel="noreferrer" className="flex items-center gap-1 mt-1 text-primary font-semibold">
                <ExternalLink size={11} /> Try on Uniswap
              </a>
            </div>
          </div>
        )}

        {txHash && (
          <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400">
            <span className="font-bold">✓ Swapped!</span>
            <a href={`${explorerBase}${txHash}`} target="_blank" rel="noreferrer" className="font-mono truncate hover:underline ml-1">{txHash.slice(0,20)}…</a>
          </div>
        )}

        <p className="text-[10px] text-muted-foreground text-center">Powered by OpenOcean · 1% slippage</p>

        <button
          onClick={executeSwap}
          disabled={!quote || !amount || swapping}
          className="w-full py-4 rounded-2xl text-white font-bold text-base disabled:opacity-40 transition-all"
          style={{ backgroundColor: walletColor, boxShadow: !quote ? undefined : `0 8px 24px ${walletColor}44` }}
        >
          {swapping ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : !amount ? "Enter Amount" : !quote ? "Getting Quote…" : "Swap"}
        </button>
      </div>

      {/* Token pickers */}
      {(showFromPicker || showToPicker) && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-end justify-center" onClick={() => { setShowFromPicker(false); setShowToPicker(false); }}>
          <div className="bg-card rounded-t-[24px] w-full max-w-sm pb-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border/70 rounded-full mx-auto mt-3 mb-4" />
            <p className="text-sm font-bold text-foreground px-5 mb-3">Select Token</p>
            {TOKENS.map((tk, i) => (
              <button key={`${tk.chain}-${tk.address}`}
                onClick={() => {
                  if (showFromPicker) { setFromIdx(i); setShowFromPicker(false); setAmount(""); setQuote(null); }
                  else { setToIdx(i); setShowToPicker(false); setQuote(null); }
                }}
                className="w-full flex items-center gap-3 px-5 py-3 hover:bg-muted/30 transition-colors"
              >
                <img src={tk.logo} alt={tk.symbol} className="w-9 h-9 rounded-full" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <div className="flex-1 text-left">
                  <p className="text-sm font-bold text-foreground">{tk.symbol}</p>
                  <p className="text-xs text-muted-foreground">{CHAIN_LABEL[tk.chain]}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
