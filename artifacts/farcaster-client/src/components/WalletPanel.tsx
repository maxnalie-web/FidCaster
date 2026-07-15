import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Copy, Send, ArrowDownLeft, RefreshCw, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronLeft, X,
  ArrowUpRight, Repeat, Sparkles, FileText, Compass,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "@/hooks/useWallet";
import {
  publicClient, basePublicClient,
  USDC_BASE_ADDRESS, ERC20_BALANCE_ABI, ERC20_TRANSFER_ABI,
} from "@/lib/contracts";
import { createBaseWalletClient } from "@/lib/wallet";
import {
  formatEther, parseEther, parseUnits, isAddress, formatUnits, type Address,
} from "viem";
import { optimism, base } from "viem/chains";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ─── helpers ──────────────────────────────────────────────────────────────────

const WALLET_COLORS = ["#ff6b9d","#4c9aff","#34d399","#fb923c","#a78bfa","#f472b6","#22c1c3","#fbbf24"];
function walletColor(addr: string | null): string {
  if (!addr) return WALLET_COLORS[0];
  let h = 0;
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) >>> 0;
  return WALLET_COLORS[h % WALLET_COLORS.length];
}

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function fetchEthPriceUsd(): Promise<number | null> {
  try {
    const r = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      { signal: timeoutSignal(5000) }
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

function formatRelativeTime(ts: number): string {
  if (!ts) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(ts).toLocaleDateString();
}

function dateGroupFor(ts: number): string {
  if (!ts) return "Earlier";
  const now = new Date();
  const d = new Date(ts);
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (now.getFullYear() === d.getFullYear() && now.getMonth() === d.getMonth()) return "This Month";
  return "Earlier";
}

function groupActivity(items: ActivityItem[]): { title: string; data: ActivityItem[] }[] {
  const order = ["Today", "Yesterday", "This Month", "Earlier"];
  const buckets = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = dateGroupFor(item.timestamp);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(item);
  }
  return order.filter(k => buckets.has(k)).map(title => ({ title, data: buckets.get(title)! }));
}

// ─── types ────────────────────────────────────────────────────────────────────

type MainTab = "tokens" | "nfts" | "activity";
type ActionMode = "none" | "send" | "receive";
type SendToken = "op-eth" | "base-eth" | "base-usdc";
type SendStep = "recipient" | "asset" | "amount";
type ActivityNetwork = "Optimism" | "Base";
type ActivityType = "sent" | "received" | "minted" | "swapped" | "approved" | "interacted";

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

type ActivityItem = {
  hash: string;
  network: ActivityNetwork;
  direction: "sent" | "received";
  activityType: ActivityType;
  contractName: string | null;
  counterparty: string;
  valueEth: number;
  valueWei: bigint;
  nonce: number | null;
  status: "ok" | "error" | "pending";
  timestamp: number;
};

// ─── activity meta ────────────────────────────────────────────────────────────

const SEND_ACCENT = "#ff3b5c";

type ActivityMeta = {
  icon: typeof Send;
  label: string;
  color: string;
};

const ACTIVITY_TYPE_META: Record<ActivityType, ActivityMeta> = {
  sent:        { icon: ArrowUpRight,  label: "Sent",        color: "#ff3b5c" },
  received:    { icon: ArrowDownLeft, label: "Received",    color: "#10b981" },
  minted:      { icon: Sparkles,      label: "Minted",      color: "#fbbf24" },
  swapped:     { icon: Repeat,        label: "Swapped",     color: "#6366f1" },
  approved:    { icon: CheckCircle2,  label: "Approved",    color: "#4c9aff" },
  interacted:  { icon: FileText,      label: "Interacted",  color: "#8b859a" },
};

const BLOCKSCOUT_HOST: Record<ActivityNetwork, string> = {
  Optimism: "optimism.blockscout.com",
  Base: "base.blockscout.com",
};

function classifyActivity(method: string | null | undefined, direction: "sent" | "received"): ActivityType {
  const m = (method ?? "").toLowerCase();
  if (m.includes("approve")) return "approved";
  if (m.includes("mint")) return "minted";
  if (m.includes("swap")) return "swapped";
  if (m) return "interacted";
  return direction;
}

async function fetchActivityForNetwork(network: ActivityNetwork, address: Address): Promise<ActivityItem[]> {
  try {
    const r = await fetch(
      `https://${BLOCKSCOUT_HOST[network]}/api/v2/addresses/${address}/transactions`,
      { signal: timeoutSignal(8000) }
    );
    if (!r.ok) return [];
    const d = await r.json();
    const items = Array.isArray(d?.items) ? d.items : [];
    return items
      .filter((it: unknown) => (it as Record<string,unknown>)?.hash && (it as Record<string,unknown>)?.value !== undefined)
      .map((it: Record<string, unknown>): ActivityItem => {
        const fromAddr = (String((it.from as Record<string,unknown>)?.hash ?? "")).toLowerCase();
        const isSent = fromAddr === address.toLowerCase();
        const valueWei = BigInt(String(it.value ?? "0"));
        const direction: "sent" | "received" = isSent ? "sent" : "received";
        const methodName: string | null = typeof it.method === "string" ? it.method : null;
        return {
          hash: String(it.hash),
          network,
          direction,
          activityType: classifyActivity(methodName, direction),
          contractName: (it.to as Record<string,unknown>)?.name as string | null ?? null,
          counterparty: String(isSent ? (it.to as Record<string,unknown>)?.hash : (it.from as Record<string,unknown>)?.hash) ?? "",
          valueEth: parseFloat(formatEther(valueWei)),
          valueWei,
          nonce: typeof it.nonce === "number" ? it.nonce : it.nonce ? parseInt(String(it.nonce), 10) : null,
          status: it.status === "ok" ? "ok" : it.status === "error" ? "error" : "pending",
          timestamp: it.timestamp ? new Date(String(it.timestamp)).getTime() : 0,
        };
      });
  } catch { return []; }
}

// ─── component ────────────────────────────────────────────────────────────────

export function WalletPanel() {
  const { address, walletClient, profile } = useWallet();

  const walletLabel = profile?.displayName ?? profile?.username ?? "My Wallet";
  const walletInitial = walletLabel.trim()[0]?.toUpperCase() ?? "W";
  const color = walletColor(address);

  const [tab, setTab] = useState<MainTab>("tokens");
  const [action, setAction] = useState<ActionMode>("none");
  const [sendStep, setSendStep] = useState<SendStep>("recipient");
  const [assetLocked, setAssetLocked] = useState(false);

  // balances
  const [opEth, setOpEth] = useState<bigint | null>(null);
  const [baseEth, setBaseEth] = useState<bigint | null>(null);
  const [baseUsdc, setBaseUsdc] = useState<bigint | null>(null);
  const [loadingOp, setLoadingOp] = useState(false);
  const [loadingBase, setLoadingBase] = useState(false);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const priceRef = useRef(false);

  // send
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sendToken, setSendToken] = useState<SendToken>("op-eth");
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmTx, setConfirmTx] = useState<{
    to: string; amount: string; symbol: string; network: string; usdValue: string | null;
  } | null>(null);

  // activity
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const activityFetchedFor = useRef<string | null>(null);

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
    } catch { /**/ }
    finally {
      setLoadingOp(false);
      setLoadingBase(false);
    }
  }, [address]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    if (priceRef.current) return;
    priceRef.current = true;
    fetchEthPriceUsd().then(p => { if (p) setEthPrice(p); });
  }, []);

  const fetchActivity = useCallback(async () => {
    if (!address) return;
    setLoadingActivity(true);
    activityFetchedFor.current = address;
    try {
      const [opTxs, baseTxs] = await Promise.all([
        fetchActivityForNetwork("Optimism", address),
        fetchActivityForNetwork("Base", address),
      ]);
      setActivity([...opTxs, ...baseTxs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30));
    } finally {
      setLoadingActivity(false);
    }
  }, [address]);

  useEffect(() => {
    if (tab === "activity" && address && activityFetchedFor.current !== address) {
      fetchActivity();
    }
  }, [tab, address, fetchActivity]);

  // derived
  const opEthNum = opEth !== null ? parseFloat(formatEther(opEth)) : 0;
  const baseEthNum = baseEth !== null ? parseFloat(formatEther(baseEth)) : 0;
  const baseUsdcNum = baseUsdc !== null ? parseFloat(formatUnits(baseUsdc, 6)) : 0;
  const totalUsd = ethPrice ? (opEthNum + baseEthNum) * ethPrice + baseUsdcNum : null;

  const tokens: TokenRow[] = [
    {
      key: "op-eth",
      name: "Ethereum",
      symbol: "ETH",
      network: "Optimism",
      networkColor: "#ff0420",
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
      networkColor: "#0052ff",
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
      networkColor: "#0052ff",
      balance: baseUsdcNum,
      rawBalance: baseUsdc,
      usdValue: baseUsdcNum,
      loading: loadingBase,
      icon: "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
    },
  ];

  const selectedToken = tokens.find(t => t.key === sendToken) ?? tokens[0];
  const sendDisabled = sending || !toAddress || !amount;

  const usdEquivalent = (() => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt)) return "$0.00";
    if (selectedToken.usdValue == null || selectedToken.balance === 0) return "—";
    const perToken = selectedToken.usdValue / selectedToken.balance;
    return `$${(amt * perToken).toFixed(2)}`;
  })();

  function handleMax() {
    if (selectedToken.loading) return;
    if (sendToken === "base-usdc") {
      if (baseUsdc !== null) setAmount(formatUnits(baseUsdc, 6));
    } else {
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
      : selectedToken.symbol === "USDC" ? `$${numAmount.toFixed(2)}` : null;
    setConfirmTx({ to: toAddress, amount, symbol: selectedToken.symbol, network: selectedToken.network, usdValue });
  }

  async function executeSend() {
    if (!walletClient || !address || !confirmTx) return;
    setConfirmTx(null);
    setSending(true);
    setSendError(null);
    setTxHash(null);
    try {
      let hash: `0x${string}`;
      const isBase = sendToken === "base-eth" || sendToken === "base-usdc";
      const activeClient = isBase ? createBaseWalletClient(walletClient.account!) : walletClient;
      if (sendToken === "base-usdc") {
        const rawAmt = parseUnits(amount, 6);
        if (baseUsdc !== null && rawAmt > baseUsdc) { setSendError("Insufficient USDC balance."); setSending(false); return; }
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
        const chain = sendToken === "op-eth" ? optimism : base;
        const chainPublicClient = sendToken === "op-eth" ? publicClient : basePublicClient;
        let gas: bigint | undefined;
        try {
          const estimated = await chainPublicClient.estimateGas({ account: walletClient.account!, to: toAddress as `0x${string}`, value });
          gas = (estimated * 130n) / 100n;
        } catch { /**/ }
        hash = await activeClient.sendTransaction({
          account: walletClient.account!,
          chain,
          to: toAddress as `0x${string}`,
          value,
          ...(gas !== undefined ? { gas } : {}),
        });
      }
      setTxHash(hash);
      toast.success("Transaction sent!");
      setToAddress(""); setAmount("");
      setTimeout(fetchAll, 5000);
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "Transaction failed.");
    } finally { setSending(false); }
  }

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const explorerBase = sendToken === "op-eth"
    ? "https://optimistic.etherscan.io/tx/"
    : "https://basescan.org/tx/";

  function openSend(tokenKey?: SendToken) {
    setSendStep("recipient");
    setAssetLocked(false);
    setToAddress("");
    setAmount("");
    setSendError(null);
    setTxHash(null);
    if (tokenKey) { setSendToken(tokenKey); setAssetLocked(true); setSendStep("asset"); }
    setAction("send");
  }

  // ─── sheet close on outside click (backdrop) ──────────────────────────────

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Confirm dialog ──────────────────────────────────────────────── */}
      {confirmTx && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-card rounded-3xl border border-border shadow-2xl overflow-hidden">
            <div className="px-5 pt-5 pb-4 border-b border-border/60">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest mb-1">Confirm Transaction</p>
              <p className="text-[15px] font-semibold text-foreground">Send {confirmTx.symbol} on {confirmTx.network}</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="rounded-xl border border-border/50 bg-muted/30 divide-y divide-border/40 text-sm">
                <div className="flex items-start justify-between px-4 py-3 gap-3">
                  <span className="text-muted-foreground shrink-0">To</span>
                  <span className="font-mono text-xs text-foreground break-all text-right">{confirmTx.to.slice(0,10)}…{confirmTx.to.slice(-8)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-muted-foreground">Amount</span>
                  <div className="text-right">
                    <span className="font-semibold text-foreground font-mono">{confirmTx.amount} {confirmTx.symbol}</span>
                    {confirmTx.usdValue && <p className="text-xs text-muted-foreground">{confirmTx.usdValue}</p>}
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-muted-foreground">Network</span>
                  <span className="font-medium text-foreground">{confirmTx.network}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">This transaction is irreversible once signed and broadcast.</p>
            </div>
            <div className="px-5 pb-5 flex gap-2">
              <button onClick={() => setConfirmTx(null)} className="flex-1 py-3.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">Cancel</button>
              <button onClick={executeSend} className="flex-1 py-3.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
                <Send className="w-4 h-4" />Sign & Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Receive sheet ───────────────────────────────────────────────── */}
      {action === "receive" && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={() => setAction("none")}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-t-[28px] px-5 pt-3 pb-8 space-y-4 max-h-[88vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-2" />
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest">Your address (all networks)</p>
              <button onClick={() => setAction("none")} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex justify-center py-2">
              <div className="bg-white p-4 rounded-2xl shadow-lg">
                {address && <QRCodeSVG value={address} size={168} />}
              </div>
            </div>
            <div className="bg-muted/60 rounded-xl p-3">
              <p className="text-xs font-mono text-foreground text-center break-all leading-relaxed">{address}</p>
            </div>
            <button
              onClick={copyAddress}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-full bg-primary/10 border border-primary/20 text-sm font-bold text-primary hover:bg-primary/20 transition-colors"
            >
              {copied ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied!" : "Copy address"}
            </button>
            <p className="text-[11px] text-muted-foreground text-center">Same address works on Optimism and Base</p>
          </div>
        </div>
      )}

      {/* ── Send sheet (3-step) ─────────────────────────────────────────── */}
      {action === "send" && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={() => setAction("none")}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-t-[28px] px-5 pt-3 pb-8 max-h-[92vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border rounded-full mx-auto mb-3" />

            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              {sendStep === "recipient" ? (
                <div className="w-6" />
              ) : (
                <button
                  onClick={() => setSendStep(sendStep === "amount" ? (assetLocked ? "recipient" : "asset") : "recipient")}
                  className="p-0.5 text-foreground"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
              )}
              <p className="text-[17px] font-black text-foreground">Send</p>
              <button onClick={() => setAction("none")} className="p-1 text-muted-foreground hover:text-foreground transition-colors"><X className="w-5 h-5" /></button>
            </div>

            {/* Recipient chip on steps 2+3 */}
            {sendStep !== "recipient" && !!toAddress && (
              <button
                onClick={() => setSendStep("recipient")}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-muted/60 mb-4"
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0" style={{ backgroundColor: color }}>
                  {toAddress.slice(2, 4).toUpperCase()}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs text-muted-foreground">To</p>
                  <p className="text-[15px] font-bold text-foreground font-mono truncate">{toAddress.slice(0,6)}…{toAddress.slice(-4)}</p>
                </div>
                <ChevronDown className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
              </button>
            )}

            {/* ── STEP 1: RECIPIENT ── */}
            {sendStep === "recipient" && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 bg-muted/60 rounded-2xl px-3 py-3">
                  <span className="text-sm font-black text-muted-foreground shrink-0">To:</span>
                  <input
                    autoFocus
                    value={toAddress}
                    onChange={e => setToAddress(e.target.value)}
                    placeholder="Address (0x…)"
                    className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none font-mono"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <button
                    onClick={() => navigator.clipboard.readText().then(t => setToAddress(t.trim())).catch(() => {})}
                    className="text-xs font-black text-primary shrink-0"
                  >
                    Paste
                  </button>
                </div>
                {isAddress(toAddress) && (
                  <button
                    onClick={() => setSendStep(assetLocked ? "amount" : "asset")}
                    className="w-full py-4 rounded-full font-black text-[15px] text-white"
                    style={{ backgroundColor: SEND_ACCENT, boxShadow: `0 8px 24px ${SEND_ACCENT}66` }}
                  >
                    Continue
                  </button>
                )}
              </div>
            )}

            {/* ── STEP 2: ASSET ── */}
            {sendStep === "asset" && (
              <div className="space-y-1">
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-widest px-1 pt-2 pb-1">Select Token</p>
                {tokens.map(tk => (
                  <button
                    key={tk.key}
                    onClick={() => { setSendToken(tk.key); setAmount(""); setSendStep("amount"); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-2xl hover:bg-muted/40 transition-colors"
                  >
                    <div className="relative shrink-0">
                      <img src={tk.icon} alt={tk.symbol} className="w-10 h-10 rounded-full bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                      <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-card flex items-center justify-center" style={{ backgroundColor: tk.networkColor }}>
                        <span className="text-[7px] font-bold text-white leading-none">{tk.network === "Optimism" ? "OP" : "B"}</span>
                      </div>
                    </div>
                    <div className="flex-1 text-left">
                      <p className="text-[15px] font-bold text-foreground">{tk.symbol}</p>
                      <p className="text-xs text-muted-foreground">
                        {tk.loading ? "Loading…" : `${formatBal(tk.balance, tk.symbol === "USDC" ? 2 : 6)} ${tk.symbol} · ${tk.network}`}
                      </p>
                    </div>
                    <p className="text-[15px] font-bold text-foreground">
                      {tk.usdValue != null ? `$${tk.usdValue.toFixed(2)}` : "—"}
                    </p>
                  </button>
                ))}
              </div>
            )}

            {/* ── STEP 3: AMOUNT ── */}
            {sendStep === "amount" && (
              <div className="space-y-3.5">
                {/* token card */}
                <button
                  onClick={() => !assetLocked && setSendStep("asset")}
                  className="w-full flex items-center gap-3 p-3.5 rounded-2xl bg-muted/60"
                >
                  <img src={selectedToken.icon} alt={selectedToken.symbol} className="w-10 h-10 rounded-full bg-muted shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                  <div className="flex-1 text-left">
                    <p className="text-base font-black text-foreground">{selectedToken.symbol}</p>
                    <p className="text-[13px] text-muted-foreground">
                      {selectedToken.usdValue != null
                        ? `$${selectedToken.usdValue.toFixed(2)} available`
                        : `${formatBal(selectedToken.balance, 6)} available`}
                    </p>
                  </div>
                  {!assetLocked && <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0" />}
                </button>

                {/* amount input */}
                <div className="flex items-center justify-between px-4 py-4 rounded-2xl bg-muted/60">
                  <input
                    autoFocus
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    placeholder="0"
                    type="number"
                    min="0"
                    className="flex-1 bg-transparent text-[34px] font-black outline-none tabular-nums mr-3"
                    style={{ color: amount ? SEND_ACCENT : "var(--muted-foreground)" }}
                  />
                  <span className="text-xl font-black text-foreground shrink-0">{selectedToken.symbol}</span>
                </div>

                {/* USD equivalent + Max */}
                <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-muted/60">
                  <span className="text-[15px] font-bold text-muted-foreground truncate flex-1">{usdEquivalent}</span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      onClick={handleMax}
                      disabled={selectedToken.loading || selectedToken.balance === 0}
                      className="px-3 py-1.5 rounded-full text-xs font-black disabled:opacity-40"
                      style={{ backgroundColor: `${SEND_ACCENT}22`, color: SEND_ACCENT }}
                    >
                      Max
                    </button>
                    <span className="text-xl font-black text-foreground">USD</span>
                  </div>
                </div>

                {sendError && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{sendError}
                  </div>
                )}
                {txHash && (
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Sent!</p>
                      <a href={`${explorerBase}${txHash}`} target="_blank" rel="noreferrer" className="font-mono break-all hover:underline opacity-70">{txHash.slice(0,24)}…</a>
                    </div>
                  </div>
                )}

                <button
                  onClick={handleSend}
                  disabled={sendDisabled}
                  className="w-full py-4 rounded-full font-black text-base flex items-center justify-center gap-2 transition-all"
                  style={sendDisabled
                    ? { backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }
                    : { backgroundColor: SEND_ACCENT, color: "#fff", boxShadow: `0 8px 24px ${SEND_ACCENT}66` }}
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : !sendDisabled ? <Send className="w-4 h-4" /> : null}
                  {sending ? "Sending…" : !amount ? "Enter an Amount" : `Send ${selectedToken.symbol}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center px-5 pt-6 pb-5">
        {/* Wallet avatar */}
        <div
          className="w-[76px] h-[76px] rounded-full flex items-center justify-center shadow-xl"
          style={{ backgroundColor: color }}
        >
          <span className="text-[34px] font-black text-white leading-none">{walletInitial}</span>
        </div>

        {/* Wallet name */}
        <div className="flex items-center gap-1 mt-3">
          <span className="text-[15px] font-bold text-foreground">{walletLabel}</span>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </div>

        {/* Total balance */}
        {totalUsd !== null ? (
          <p className="text-[40px] font-black text-foreground tabular-nums mt-1.5 tracking-tight leading-tight">
            {formatUsd(totalUsd)}
          </p>
        ) : (
          <div className="h-12 flex items-center mt-1.5">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Network dots */}
        <div className="flex items-center gap-1.5 mt-1.5">
          <div className="w-2.5 h-2.5 rounded-full border-2 border-background" style={{ backgroundColor: "#ff0420" }} />
          <div className="w-2.5 h-2.5 rounded-full border-2 border-background -ml-1.5" style={{ backgroundColor: "#0052ff" }} />
          <span className="text-[11px] font-bold text-muted-foreground ml-1">Optimism · Base</span>
        </div>

        {/* Quick action circles */}
        <div className="flex gap-2.5 mt-5 w-full">
          {[
            { label: "Receive", icon: ArrowDownLeft, onClick: () => setAction(action === "receive" ? "none" : "receive") },
            { label: "Send", icon: Send, onClick: () => openSend() },
            { label: "Refresh", icon: RefreshCw, onClick: fetchAll, spin: loadingOp || loadingBase, disabled: loadingOp || loadingBase },
            { label: "Swap", icon: Repeat, onClick: () => toast.info("Swap coming soon") },
            { label: "Browser", icon: Compass, onClick: () => toast.info("Browser coming soon") },
          ].map(({ label, icon: Icon, onClick, spin, disabled }) => (
            <button
              key={label}
              onClick={onClick}
              disabled={!!disabled}
              className="flex-1 flex flex-col items-center gap-1.5 disabled:opacity-50"
            >
              <div
                className="w-[50px] h-[50px] rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: color,
                  boxShadow: `0 6px 20px ${color}55`,
                }}
              >
                <Icon className={cn("w-[19px] h-[19px] text-white", spin && "animate-spin")} strokeWidth={2.6} />
              </div>
              <span className="text-[11.5px] font-bold text-foreground">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <div className="flex mx-4 mb-1 p-1 bg-muted/50 rounded-2xl gap-1">
        {(["tokens", "nfts", "activity"] as MainTab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all capitalize",
              tab === t
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "tokens" ? "Tokens" : t === "nfts" ? "NFTs" : "Activity"}
          </button>
        ))}
      </div>

      {/* ── Tokens tab ──────────────────────────────────────────────────── */}
      {tab === "tokens" && (
        <div className="px-4 py-2 space-y-2.5">
          {tokens.map(tk => (
            <button
              key={tk.key}
              onClick={() => openSend(tk.key)}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border border-border/50 bg-card shadow-sm hover:bg-muted/30 transition-colors"
            >
              <div className="relative shrink-0">
                <img
                  src={tk.icon} alt={tk.symbol}
                  className="w-10 h-10 rounded-full bg-muted"
                  onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center"
                  style={{ backgroundColor: tk.networkColor }}
                >
                  <span className="text-[7px] font-bold text-white leading-none">{tk.network === "Optimism" ? "OP" : "B"}</span>
                </div>
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-bold text-foreground">{tk.symbol}</p>
                <div className="inline-flex mt-0.5 px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${tk.networkColor}1a` }}>
                  <p className="text-[11px] font-semibold" style={{ color: tk.networkColor }}>{tk.network}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                {tk.loading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-auto" />
                ) : (
                  <>
                    <p className="text-sm font-bold text-foreground tabular-nums">{formatBal(tk.balance, tk.symbol === "USDC" ? 2 : 4)} {tk.symbol}</p>
                    {tk.usdValue !== null && <p className="text-xs text-muted-foreground tabular-nums">{formatUsd(tk.usdValue)}</p>}
                  </>
                )}
              </div>
            </button>
          ))}

          {/* No ETH warning */}
          {opEth === 0n && baseEth === 0n && !loadingOp && !loadingBase && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl border bg-amber-50 border-amber-200/80 text-xs text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold mb-0.5">No ETH balance</p>
                <p className="opacity-80">Send ETH on Optimism or Base to get started. You need a tiny amount for gas (~$0.01).</p>
                <code className="block mt-2 break-all font-mono text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded text-[10px]">{address}</code>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── NFTs tab (stub) ─────────────────────────────────────────────── */}
      {tab === "nfts" && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground px-5">
          <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mb-2">
            <span className="text-3xl">🖼️</span>
          </div>
          <p className="text-sm font-bold">NFT Gallery</p>
          <p className="text-xs opacity-60 text-center">Your NFT collection will appear here</p>
        </div>
      )}

      {/* ── Activity tab ────────────────────────────────────────────────── */}
      {tab === "activity" && (
        <div className="px-4 py-2 space-y-4">
          {loadingActivity && activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : activity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
              <ChevronDown className="w-8 h-8 opacity-20" />
              <p className="text-sm font-bold">No transactions yet</p>
              <p className="text-xs opacity-60">Activity will show your recent on-chain transactions</p>
            </div>
          ) : (
            groupActivity(activity).map(group => (
              <div key={group.title} className="space-y-2.5">
                <p className="text-base font-black text-foreground mt-1">{group.title}</p>
                {group.data.map(item => {
                  const explorer = item.network === "Optimism" ? "https://optimistic.etherscan.io/tx/" : "https://basescan.org/tx/";
                  const networkColor = item.network === "Optimism" ? "#ff0420" : "#0052ff";
                  const meta = ACTIVITY_TYPE_META[item.activityType];
                  const TypeIcon = meta.icon;
                  const title = meta.label;
                  const subtitle = (item.activityType === "sent" || item.activityType === "received")
                    ? `${item.activityType === "sent" ? "To" : "From"} ${item.counterparty.slice(0,6)}…${item.counterparty.slice(-4)}`
                    : item.contractName ?? `${item.counterparty.slice(0,6)}…${item.counterparty.slice(-4)}`;
                  return (
                    <a
                      key={`${item.network}-${item.hash}`}
                      href={`${explorer}${item.hash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border border-border/50 bg-card shadow-sm hover:bg-muted/30 transition-colors"
                    >
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
                        style={{ backgroundColor: `${meta.color}1a` }}
                      >
                        <TypeIcon className="w-[18px] h-[18px]" style={{ color: meta.color }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground">{title}</p>
                        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                        <div className="inline-flex mt-0.5 px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${networkColor}1a` }}>
                          <p className="text-[11px] font-semibold" style={{ color: networkColor }}>{item.network}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 space-y-0.5">
                        <p className="text-sm font-bold text-foreground tabular-nums">
                          {item.direction === "sent" ? "-" : "+"}{formatBal(item.valueEth, 6)} ETH
                        </p>
                        <p className="text-[11px] text-muted-foreground">{formatRelativeTime(item.timestamp)}</p>
                        {item.status === "error" && <p className="text-[10px] font-bold text-destructive">Failed</p>}
                        {item.status === "pending" && <p className="text-[10px] font-bold text-amber-500">Pending</p>}
                      </div>
                    </a>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
