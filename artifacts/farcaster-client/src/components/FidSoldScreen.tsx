import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import { WalletPanel } from "@/components/WalletPanel";
import { publicClient, basePublicClient, USDC_BASE_ADDRESS, ERC20_BALANCE_ABI } from "@/lib/contracts";
import { formatEther, formatUnits } from "viem";
import {
  ArrowDownLeft, ExternalLink, LogOut, Wallet,
  TrendingDown, ChevronRight, Copy, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

async function fetchEthUsd(): Promise<number | null> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    return (await r.json())?.ethereum?.usd ?? null;
  } catch { return null; }
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function FidSoldScreen() {
  const { fid, profile, address, logout } = useWallet();
  const [showWallet, setShowWallet] = useState(false);
  const [opEth, setOpEth] = useState<bigint | null>(null);
  const [baseEth, setBaseEth] = useState<bigint | null>(null);
  const [usdcBal, setUsdcBal] = useState<bigint | null>(null);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const loadBalances = useCallback(async () => {
    if (!address) return;
    const [op, base, usdc, price] = await Promise.allSettled([
      publicClient.getBalance({ address }),
      basePublicClient.getBalance({ address }),
      basePublicClient.readContract({ address: USDC_BASE_ADDRESS, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [address] }) as Promise<bigint>,
      fetchEthUsd(),
    ]);
    if (op.status === "fulfilled") setOpEth(op.value);
    if (base.status === "fulfilled") setBaseEth(base.value);
    if (usdc.status === "fulfilled") setUsdcBal(usdc.value as bigint);
    if (price.status === "fulfilled") setEthUsd(price.value);
  }, [address]);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  const fidNum = fid ? Number(fid) : null;
  const totalEth = (opEth ?? 0n) + (baseEth ?? 0n);
  const totalEthNum = parseFloat(formatEther(totalEth));
  const totalUsd = ethUsd ? totalEthNum * ethUsd : null;
  const usdcNum = usdcBal ? parseFloat(formatUnits(usdcBal, 6)) : 0;
  const hasBalance = totalEthNum > 0.0001 || usdcNum > 0.01;

  async function copyAddress() {
    if (!address) return;
    await navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    toast.success("Address copied");
  }

  if (showWallet) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <button
            onClick={() => setShowWallet(false)}
            className="p-1.5 rounded-full hover:bg-accent transition-colors"
          >
            <ChevronRight className="w-4 h-4 rotate-180 text-muted-foreground" />
          </button>
          <span className="font-semibold text-sm text-foreground">Wallet</span>
        </div>
        <div className="flex-1 overflow-auto">
          <WalletPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5 py-10 relative overflow-hidden">

      {/* Ambient background blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-red-500/6 blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-orange-500/6 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-sm flex flex-col items-center gap-6">

        {/* Icon */}
        <div className="relative">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-red-500/15 to-orange-500/15 border border-red-500/20 flex items-center justify-center shadow-lg">
            <TrendingDown className="w-10 h-10 text-red-500" strokeWidth={1.5} />
          </div>
          <div className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-background border border-border flex items-center justify-center shadow-sm">
            <span className="text-[10px] font-black text-red-500">SOLD</span>
          </div>
        </div>

        {/* Headline */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-extrabold text-foreground tracking-tight">
            Your FID was sold
          </h1>
          {fidNum && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted border border-border text-xs font-mono text-muted-foreground">
              FID #{fidNum}
              {profile?.username && (
                <span className="text-foreground font-semibold">· @{profile.username}</span>
              )}
            </div>
          )}
          <p className="text-sm text-muted-foreground leading-relaxed mt-1">
            Your Farcaster account has been transferred to a new owner via FID Market.
            Your wallet is still active — you can withdraw any remaining ETH.
          </p>
        </div>

        {/* Wallet balance card */}
        <div className="w-full rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-semibold text-foreground">Your wallet</span>
            </div>
            {address && (
              <button
                onClick={copyAddress}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied
                  ? <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                  : <Copy className="w-3 h-3" />}
                <span className="font-mono">{shortAddr(address)}</span>
              </button>
            )}
          </div>

          <div className="px-4 py-4 space-y-3">
            {/* Total balance */}
            <div className="flex items-end justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Total balance</p>
                <p className="text-3xl font-black text-foreground font-mono tracking-tight">
                  {totalEthNum > 0 ? totalEthNum.toFixed(4) : "0.0000"}
                  <span className="text-lg font-bold text-muted-foreground ml-1">ETH</span>
                </p>
                {totalUsd !== null && totalUsd > 0 && (
                  <p className="text-sm text-muted-foreground mt-0.5">
                    ≈ ${totalUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                  </p>
                )}
              </div>
              <button
                onClick={loadBalances}
                className="text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                Refresh
              </button>
            </div>

            {/* Network breakdown */}
            <div className="space-y-1.5">
              {opEth !== null && (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    <span className="text-muted-foreground">Optimism</span>
                  </div>
                  <span className="font-mono font-semibold text-foreground">
                    {parseFloat(formatEther(opEth)).toFixed(4)} ETH
                  </span>
                </div>
              )}
              {baseEth !== null && (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span className="text-muted-foreground">Base</span>
                  </div>
                  <span className="font-mono font-semibold text-foreground">
                    {parseFloat(formatEther(baseEth)).toFixed(4)} ETH
                  </span>
                </div>
              )}
              {usdcBal !== null && usdcNum > 0.01 && (
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-muted-foreground">USDC (Base)</span>
                  </div>
                  <span className="font-mono font-semibold text-foreground">
                    ${usdcNum.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Withdraw CTA */}
          <div className="px-4 pb-4">
            <button
              onClick={() => setShowWallet(true)}
              className={cn(
                "w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98]",
                hasBalance
                  ? "bg-primary text-white shadow-md hover:bg-primary/90"
                  : "bg-muted text-muted-foreground cursor-default"
              )}
            >
              <ArrowDownLeft className="w-4 h-4" />
              {hasBalance ? "Withdraw ETH to external wallet" : "Open wallet"}
            </button>
            {hasBalance && (
              <p className="text-center text-[11px] text-muted-foreground mt-2">
                Tap to send your ETH to any external wallet or exchange
              </p>
            )}
          </div>
        </div>

        {/* Market link */}
        <a
          href="/market"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ExternalLink className="w-3 h-3" />
          View FID Market activity
        </a>

        {/* Sign out */}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          <LogOut className="w-3 h-3" />
          Sign out
        </button>
      </div>
    </div>
  );
}
