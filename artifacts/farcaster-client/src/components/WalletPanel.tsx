import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Copy, Send, ArrowDownLeft, RefreshCw, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronUp,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import {
  publicClient, basePublicClient,
  USDC_BASE_ADDRESS, ERC20_BALANCE_ABI, ERC20_TRANSFER_ABI,
} from "@/lib/contracts";
import { createBaseWalletClient } from "@/lib/wallet";
import {
  formatEther, parseEther, parseUnits, isAddress, formatUnits,
} from "viem";
import { optimism, base } from "viem/chains";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

async function fetchEthPriceUsd(): Promise<number | null> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) }
    );
    if (!r.ok) return null;
    const d = await r.json();
    return d?.ethereum?.usd ?? null;
  } catch { return null; }
}

function formatBal(n: number, decimals = 4): string {
  if (n === 0) return "0";
  if (n >= 0.001) return n.toFixed(decimals);
  const s = n.toFixed(8);
  const m = s.match(/^0\.(0+[1-9][0-9]{0,3})/);
  return m ? `0.${m[1]}` : n.toPrecision(3);
}

function formatUsd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type MainTab = "tokens" | "activity";
type ActionMode = "none" | "send" | "receive";
type SendToken = "op-eth" | "base-eth" | "base-usdc";

type TokenRow = {
  key: SendToken;
  name: string;
  symbol: string;
  network: string;
  networkColor: string;
  balance: number;
  rawBalance: bigint | null;
  usdValue: number | null;
  loading: boolean;
  icon: string;
};

export function WalletPanel() {
  const { address, walletClient } = useWallet();
  const [tab, setTab] = useState<MainTab>("tokens");
  const [action, setAction] = useState<ActionMode>("none");

  const [opEth, setOpEth] = useState<bigint | null>(null);
  const [baseEth, setBaseEth] = useState<bigint | null>(null);
  const [baseUsdc, setBaseUsdc] = useState<bigint | null>(null);
  const [loadingOp, setLoadingOp] = useState(false);
  const [loadingBase, setLoadingBase] = useState(false);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const priceRef = useRef(false);

  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sendToken, setSendToken] = useState<SendToken>("op-eth");
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmTx, setConfirmTx] = useState<{
    to: string; amount: string; symbol: string; network: string; usdValue: string | null;
  } | null>(null);

  const fetchAll = useCallback(async () => {
    if (!address) return;
    setLoadingOp(true);
    setLoadingBase(true);
    try {
      const [opBal, baseBal, usdcBal] = await Promise.all([
        publicClient.getBalance({ address }),
        basePublicClient.getBalance({ address }),
        basePublicClient.readContract({
          address: USDC_BASE_ADDRESS,
          abi: ERC20_BALANCE_ABI,
          functionName: "balanceOf",
          args: [address],
        }),
      ]);
      setOpEth(opBal);
      setBaseEth(baseBal);
      setBaseUsdc(usdcBal as bigint);
    } catch { /* ignore */ }
    finally {
      setLoadingOp(false);
      setLoadingBase(false);
    }
  }, [address]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (priceRef.current) return;
    priceRef.current = true;
    fetchEthPriceUsd().then((p) => { if (p) setEthPrice(p); });
  }, []);

  const opEthNum = opEth !== null ? parseFloat(formatEther(opEth)) : 0;
  const baseEthNum = baseEth !== null ? parseFloat(formatEther(baseEth)) : 0;
  const baseUsdcNum = baseUsdc !== null ? parseFloat(formatUnits(baseUsdc, 6)) : 0;
  const totalUsd = ethPrice
    ? (opEthNum + baseEthNum) * ethPrice + baseUsdcNum
    : null;

  const tokens: TokenRow[] = [
    {
      key: "op-eth",
      name: "Ethereum",
      symbol: "ETH",
      network: "Optimism",
      networkColor: "bg-red-500",
      balance: opEthNum,
      rawBalance: opEth,
      usdValue: ethPrice ? opEthNum * ethPrice : null,
      loading: loadingOp,
      icon: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    },
    {
      key: "base-eth",
      name: "Ethereum",
      symbol: "ETH",
      network: "Base",
      networkColor: "bg-blue-500",
      balance: baseEthNum,
      rawBalance: baseEth,
      usdValue: ethPrice ? baseEthNum * ethPrice : null,
      loading: loadingBase,
      icon: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    },
    {
      key: "base-usdc",
      name: "USD Coin",
      symbol: "USDC",
      network: "Base",
      networkColor: "bg-blue-500",
      balance: baseUsdcNum,
      rawBalance: baseUsdc,
      usdValue: baseUsdcNum,
      loading: loadingBase,
      icon: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
    },
  ];

  const selectedToken = tokens.find((t) => t.key === sendToken) ?? tokens[0];

  function handleMax() {
    if (selectedToken.loading) return;
    if (sendToken === "base-usdc") {
      setAmount(formatBal(selectedToken.balance, 2));
    } else {
      // leave ~0.0001 ETH for gas
      const max = Math.max(0, selectedToken.balance - 0.0001);
      setAmount(max > 0 ? max.toFixed(8) : "0");
    }
  }

  function handleSend() {
    if (!walletClient || !address || !toAddress || !amount) return;
    if (!isAddress(toAddress)) { setSendError("Invalid Ethereum address."); return; }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) { setSendError("Enter a valid amount."); return; }
    setSendError(null);
    setTxHash(null);

    const usdValue = ethPrice && selectedToken.symbol !== "USDC"
      ? `$${(numAmount * ethPrice).toFixed(2)}`
      : selectedToken.symbol === "USDC"
        ? `$${numAmount.toFixed(2)}`
        : null;

    setConfirmTx({
      to: toAddress,
      amount,
      symbol: selectedToken.symbol,
      network: selectedToken.network,
      usdValue,
    });
  }

  async function executeSend() {
    if (!walletClient || !address || !confirmTx) return;
    setConfirmTx(null);
    setSending(true);
    setSendError(null);
    setTxHash(null);

    try {
      let hash: `0x${string}`;

      // Use a chain-specific walletClient so the tx is broadcast to the correct RPC.
      const isBase = sendToken === "base-eth" || sendToken === "base-usdc";
      const activeClient = isBase
        ? createBaseWalletClient(walletClient.account!)
        : walletClient;

      if (sendToken === "base-usdc") {
        const rawAmt = parseUnits(amount, 6);
        if (baseUsdc !== null && rawAmt > baseUsdc) {
          setSendError("Insufficient USDC balance.");
          setSending(false);
          return;
        }
        const { request } = await basePublicClient.simulateContract({
          address: USDC_BASE_ADDRESS,
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [toAddress as `0x${string}`, rawAmt],
          account: walletClient.account!,
        });
        hash = await activeClient.writeContract({ ...request, chain: base });
      } else {
        const value = parseEther(amount);
        const bal = sendToken === "op-eth" ? opEth : baseEth;
        if (bal !== null && value > bal) { setSendError("Insufficient ETH balance."); setSending(false); return; }
        hash = await activeClient.sendTransaction({
          account: walletClient.account!,
          chain: sendToken === "op-eth" ? optimism : base,
          to: toAddress as `0x${string}`,
          value,
        });
      }

      setTxHash(hash);
      toast.success("Transaction sent!");
      setToAddress("");
      setAmount("");
      setTimeout(fetchAll, 5000);
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "Transaction failed.");
    } finally {
      setSending(false);
    }
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      toast.success("Address copied!");
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const explorerBase =
    sendToken === "op-eth"
      ? "https://optimistic.etherscan.io/tx/"
      : "https://basescan.org/tx/";

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Send confirmation dialog ──────────── */}
      {confirmTx && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card rounded-2xl border border-border shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-border/60">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Confirm Transaction</p>
              <p className="text-sm font-medium text-foreground">
                Send {confirmTx.symbol} on {confirmTx.network}
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-xl border border-border/50 bg-muted/20 divide-y divide-border/40 text-sm">
                <div className="flex items-start justify-between px-4 py-3 gap-3">
                  <span className="text-muted-foreground shrink-0">To</span>
                  <span className="font-mono text-xs text-foreground break-all text-right">
                    {confirmTx.to.slice(0, 10)}…{confirmTx.to.slice(-8)}
                  </span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-muted-foreground">Amount</span>
                  <div className="text-right">
                    <span className="font-semibold text-foreground font-mono">
                      {confirmTx.amount} {confirmTx.symbol}
                    </span>
                    {confirmTx.usdValue && (
                      <p className="text-xs text-muted-foreground">{confirmTx.usdValue}</p>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium text-foreground">{confirmTx.network}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                This transaction is irreversible once signed and broadcast.
              </p>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button
                onClick={() => setConfirmTx(null)}
                className="flex-1 py-3 rounded-xl border border-border text-sm font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeSend}
                className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
              >
                <Send className="w-4 h-4" />
                Sign & Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Total balance hero ───────────────── */}
      <div className="px-5 pt-7 pb-5 border-b border-border">
        <p className="text-xs text-muted-foreground font-medium mb-1">Total Balance</p>
        {totalUsd !== null ? (
          <p className="text-4xl font-bold text-foreground tabular-nums">
            {formatUsd(totalUsd)}
          </p>
        ) : (
          <div className="h-10 flex items-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3 mt-5">
          <button
            onClick={() => { setAction(action === "receive" ? "none" : "receive"); }}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl text-xs font-semibold transition-all",
              action === "receive"
                ? "bg-primary text-white"
                : "bg-muted/70 text-foreground hover:bg-muted"
            )}
          >
            <ArrowDownLeft className="w-5 h-5" />
            Receive
          </button>
          <button
            onClick={() => { setAction(action === "send" ? "none" : "send"); }}
            className={cn(
              "flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl text-xs font-semibold transition-all",
              action === "send"
                ? "bg-primary text-white"
                : "bg-muted/70 text-foreground hover:bg-muted"
            )}
          >
            <Send className="w-5 h-5" />
            Send
          </button>
          <button
            onClick={fetchAll}
            disabled={loadingOp || loadingBase}
            className="flex-1 flex flex-col items-center gap-1 py-3 rounded-2xl text-xs font-semibold bg-muted/70 text-foreground hover:bg-muted transition-all disabled:opacity-50"
          >
            <RefreshCw className={cn("w-5 h-5", (loadingOp || loadingBase) && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Receive panel ────────────────────── */}
      {action === "receive" && (
        <div className="px-5 py-4 border-b border-border space-y-3 bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Your address (all networks)</p>
          <div className="p-3 bg-background rounded-xl border border-border">
            <code className="text-xs font-mono text-foreground break-all leading-relaxed">{address}</code>
          </div>
          <button onClick={copyAddress}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/8 border border-primary/20 text-sm font-semibold text-primary hover:bg-primary/15 transition-colors">
            {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
            {copied ? "Copied!" : "Copy address"}
          </button>
          <p className="text-[11px] text-muted-foreground text-center">Same address works on Optimism and Base</p>
        </div>
      )}

      {/* ── Send panel ───────────────────────── */}
      {action === "send" && (
        <div className="px-5 py-4 border-b border-border space-y-3 bg-muted/20">

          {/* Token selector */}
          <div className="relative">
            <button
              onClick={() => setShowTokenPicker((v) => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-background hover:bg-muted/40 transition-colors"
            >
              <img
                src={selectedToken.icon}
                alt={selectedToken.symbol}
                className="w-7 h-7 rounded-full bg-muted shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-semibold text-foreground leading-tight">
                  {selectedToken.symbol}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{selectedToken.network}</span>
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {selectedToken.loading
                    ? "Loading…"
                    : `Balance: ${formatBal(selectedToken.balance, selectedToken.symbol === "USDC" ? 2 : 6)} ${selectedToken.symbol}`}
                </p>
              </div>
              {showTokenPicker
                ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
            </button>

            {/* Dropdown */}
            {showTokenPicker && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-popover border border-border rounded-xl shadow-xl z-20 overflow-hidden">
                {tokens.map((tk) => (
                  <button
                    key={tk.key}
                    onClick={() => { setSendToken(tk.key); setShowTokenPicker(false); setAmount(""); }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors",
                      tk.key === sendToken && "bg-primary/8"
                    )}
                  >
                    <div className="relative shrink-0">
                      <img src={tk.icon} alt={tk.symbol}
                        className="w-8 h-8 rounded-full bg-muted"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <div className={cn("absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center", tk.networkColor)}>
                        <span className="text-[7px] font-bold text-white leading-none">
                          {tk.network === "Optimism" ? "OP" : "B"}
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground">{tk.symbol}
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">{tk.network}</span>
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {tk.loading
                          ? "Loading…"
                          : `${formatBal(tk.balance, tk.symbol === "USDC" ? 2 : 6)} ${tk.symbol}`}
                      </p>
                    </div>
                    {tk.key === sendToken && (
                      <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Recipient + amount */}
          <div className="space-y-2">
            <input
              value={toAddress}
              onChange={(e) => setToAddress(e.target.value)}
              placeholder="Recipient address (0x…)"
              className="input-luxury w-full px-4 py-3 text-sm font-mono"
            />
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={selectedToken.symbol === "USDC" ? "0.00" : "0.001"}
                  type="number"
                  min="0"
                  step={selectedToken.symbol === "USDC" ? "0.01" : "0.0001"}
                  className="input-luxury w-full px-4 py-3 pr-16 text-sm"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground pointer-events-none">
                  {selectedToken.symbol}
                </span>
              </div>
              <button
                onClick={handleMax}
                disabled={selectedToken.loading || selectedToken.balance === 0}
                className="px-4 py-3 rounded-xl border border-border text-xs font-semibold text-primary hover:bg-primary/8 transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Max
              </button>
            </div>
          </div>

          {sendError && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/8 border border-destructive/20 text-xs text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{sendError}
            </div>
          )}
          {txHash && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-900/40 dark:text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Sent!</p>
                <a href={`${explorerBase}${txHash}`} target="_blank" rel="noreferrer"
                  className="font-mono break-all hover:underline opacity-70">{txHash.slice(0, 24)}…</a>
              </div>
            </div>
          )}

          <button
            onClick={handleSend}
            disabled={sending || !toAddress || !amount}
            className="w-full py-3 rounded-xl btn-luxury text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-40"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {sending
              ? "Sending…"
              : `Send ${selectedToken.symbol} on ${selectedToken.network}`}
          </button>
        </div>
      )}

      {/* ── Tabs ─────────────────────────────── */}
      <div className="flex border-b border-border px-1">
        {(["tokens", "activity"] as MainTab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={cn(
              "px-4 py-3 text-sm font-semibold capitalize transition-colors border-b-2 -mb-px",
              tab === t
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground"
            )}>
            {t === "tokens" ? "Tokens" : "Activity"}
          </button>
        ))}
      </div>

      {/* ── Tokens tab ───────────────────────── */}
      {tab === "tokens" && (
        <div className="divide-y divide-border/50">
          {tokens.map((tk) => (
            <div key={tk.key}
              onClick={() => {
                setSendToken(tk.key);
                setAction("send");
                setAmount("");
                setSendError(null);
                setTxHash(null);
              }}
              className="flex items-center gap-3.5 px-5 py-4 hover:bg-muted/30 transition-colors cursor-pointer"
            >
              <div className="relative shrink-0">
                <img
                  src={tk.icon}
                  alt={tk.symbol}
                  className="w-10 h-10 rounded-full bg-muted"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className={cn("absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center", tk.networkColor)}>
                  <span className="text-[7px] font-bold text-white leading-none">
                    {tk.network === "Optimism" ? "OP" : "B"}
                  </span>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{tk.symbol}</p>
                <p className="text-xs text-muted-foreground">{tk.network}</p>
              </div>

              <div className="text-right shrink-0">
                {tk.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
                ) : (
                  <>
                    <p className="text-sm font-semibold text-foreground tabular-nums">
                      {formatBal(tk.balance, tk.symbol === "USDC" ? 2 : 4)} {tk.symbol}
                    </p>
                    {tk.usdValue !== null && (
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {formatUsd(tk.usdValue)}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}

          {/* Low balance warning */}
          {opEth === 0n && baseEth === 0n && !loadingOp && !loadingBase && (
            <div className="mx-5 my-4 flex items-start gap-2.5 p-4 rounded-xl bg-amber-50 border border-amber-200/80 text-xs text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">No ETH balance</p>
                <p className="opacity-80">Send ETH on Optimism or Base to get started. You need a tiny amount for gas (~$0.01).</p>
                <code className="block mt-2 break-all font-mono text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded text-[10px]">{address}</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Activity tab ─────────────────────── */}
      {tab === "activity" && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
          <ChevronDown className="w-8 h-8 opacity-20" />
          <p className="text-sm">Transaction history coming soon</p>
          <p className="text-xs opacity-60">Activity will show your recent on-chain transactions</p>
        </div>
      )}
    </div>
  );
}
