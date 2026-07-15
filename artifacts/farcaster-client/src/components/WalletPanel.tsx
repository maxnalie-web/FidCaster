import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Copy, Send, ArrowDownLeft, RefreshCw, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronLeft, X,
  ArrowUpRight, Repeat, Sparkles, FileText, ChevronRight,
  Wallet, Zap, LayoutGrid,
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
import { useWalletStore } from "@/store/walletStore";
import { WalletSwitcherSheet } from "@/components/wallet/WalletSwitcherSheet";
import { WalletsList } from "@/components/wallet/WalletsList";
import { CreateWallet } from "@/components/wallet/CreateWallet";
import { ImportWallet } from "@/components/wallet/ImportWallet";
import { ImportPrivateKey } from "@/components/wallet/ImportPrivateKey";
import { AddWatchOnly } from "@/components/wallet/AddWatchOnly";
import { WalletSettings } from "@/components/wallet/WalletSettings";
import { WalletDetailSettings } from "@/components/wallet/WalletDetailSettings";
import { NftGallery } from "@/components/wallet/NftGallery";
import { SwapSheet } from "@/components/wallet/SwapSheet";
import { AddressBookSheet } from "@/components/wallet/AddressBookSheet";
import { DeFiAppsSheet } from "@/components/wallet/DeFiAppsSheet";
import { DeFiBrowserSheet } from "@/components/wallet/DeFiBrowserSheet";
import { useAddressBookStore } from "@/store/addressBookStore";

// ─── helpers ──────────────────────────────────────────────────────────────────

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

type WalletOverlay =
  | "none"
  | "switcher"
  | "list"
  | "create"
  | "import"
  | "import-key"
  | "watch"
  | "settings"
  | { detail: string };

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

type ActivityMeta = { icon: typeof Send; label: string; color: string };

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
  const { address: fcAddress, walletClient: fcWalletClient, profile } = useWallet();

  // ── wallet store ────────────────────────────────────────────────────────────
  const hydrate = useWalletStore(s => s.hydrate);
  const storeActiveWallet = useWalletStore(s => s.activeWallet());
  const storeActiveAccount = useWalletStore(s => s.activeAccount());
  const getActiveWalletClient = useWalletStore(s => s.getActiveWalletClient);
  const wallets = useWalletStore(s => s.wallets);
  const importSeedWallet = useWalletStore(s => s.importSeedWallet);

  useEffect(() => { hydrate(); }, [hydrate]);

  // Dev-only: auto-import VITE_APP_MNEMONIC on first load if no wallets exist.
  // VITE_APP_MNEMONIC is intentionally blanked in production builds (see vite.config.ts)
  // so this never runs in a deployed bundle.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const mnemonic = (import.meta.env.VITE_APP_MNEMONIC as string | undefined)?.trim();
    if (!mnemonic || wallets.length > 0) return;
    importSeedWallet(mnemonic, "App Wallet").catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prefer walletStore's active account address; fall back to Farcaster auth address
  const address = (storeActiveAccount?.address ?? fcAddress) as Address | null;

  // Display info: prefer walletStore wallet; fall back to Farcaster profile
  const walletColor = storeActiveWallet?.color ?? "#6366f1";
  const walletLabel = storeActiveWallet?.label ?? profile?.displayName ?? profile?.username ?? "My Wallet";
  const isWatchOnly = storeActiveWallet?.kind === "watch-only";

  // ── address book ────────────────────────────────────────────────────────────
  const { contacts, hydrate: hydrateAB } = useAddressBookStore();
  useEffect(() => { hydrateAB(); }, [hydrateAB]);

  // ── wallet overlay ──────────────────────────────────────────────────────────
  const [overlay, setOverlay] = useState<WalletOverlay>("none");
  const [showSwap, setShowSwap] = useState(false);
  const [showDeFi, setShowDeFi] = useState(false);
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserUrl, setBrowserUrl] = useState("");
  const [showAddressBook, setShowAddressBook] = useState(false);

  // ── main wallet state ───────────────────────────────────────────────────────
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

  // Re-fetch when active wallet changes
  useEffect(() => {
    setOpEth(null); setBaseEth(null); setBaseUsdc(null);
    setActivity([]); activityFetchedFor.current = null;
    fetchAll();
  }, [address, fetchAll]);

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
      key: "op-eth", name: "Ethereum", symbol: "ETH", network: "Optimism", networkColor: "#ff0420",
      balance: opEthNum, rawBalance: opEth, usdValue: ethPrice ? opEthNum * ethPrice : null,
      loading: loadingOp, icon: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    },
    {
      key: "base-eth", name: "Ethereum", symbol: "ETH", network: "Base", networkColor: "#0052ff",
      balance: baseEthNum, rawBalance: baseEth, usdValue: ethPrice ? baseEthNum * ethPrice : null,
      loading: loadingBase, icon: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    },
    {
      key: "base-usdc", name: "USD Coin", symbol: "USDC", network: "Base", networkColor: "#0052ff",
      balance: baseUsdcNum, rawBalance: baseUsdc, usdValue: baseUsdcNum, loading: loadingBase,
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
    if (!address || !toAddress || !amount) return;
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
    if (!address || !confirmTx) return;
    setConfirmTx(null);
    setSending(true);
    setSendError(null);
    setTxHash(null);
    try {
      // Get walletClient: prefer walletStore active client, fall back to fcWalletClient
      let walletClient = fcWalletClient;
      try {
        const storeClients = await getActiveWalletClient();
        if (storeClients) {
          walletClient = storeClients.walletClient;
        }
      } catch { /**/ }

      if (!walletClient) { setSendError("No wallet connected."); setSending(false); return; }

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

  // ─── no wallet state ───────────────────────────────────────────────────────
  if (!address && wallets.length === 0 && overlay === "none") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] px-6 text-center gap-4">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Wallet size={36} className="text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-foreground">No wallet yet</h2>
          <p className="text-sm text-muted-foreground mt-1">Create or import a wallet to get started</p>
        </div>
        <button
          onClick={() => setOverlay("list")}
          className="px-6 py-3.5 rounded-2xl bg-primary text-white font-bold text-sm shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
        >
          Set Up Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-full">

      {/* ── Wallet overlay panels ────────────────────────────────────────── */}
      {overlay !== "none" && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOverlay("none")}
          />
          <div
            className="relative bg-background rounded-t-[28px] max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-border/70 rounded-full mx-auto mt-3 mb-1 flex-shrink-0" />

            {overlay === "switcher" && (
              <WalletSwitcherSheet
                onClose={() => setOverlay("none")}
                onManage={() => setOverlay("list")}
                onSettings={() => setOverlay("settings")}
              />
            )}
            {overlay === "list" && (
              <WalletsList
                onAdd={mode => setOverlay(mode)}
                onSelectWallet={id => setOverlay({ detail: id })}
                onBack={() => setOverlay("none")}
              />
            )}
            {overlay === "create" && (
              <CreateWallet onDone={() => setOverlay("none")} onBack={() => setOverlay("list")} />
            )}
            {overlay === "import" && (
              <ImportWallet onDone={() => setOverlay("none")} onBack={() => setOverlay("list")} />
            )}
            {overlay === "import-key" && (
              <ImportPrivateKey onDone={() => setOverlay("none")} onBack={() => setOverlay("list")} />
            )}
            {overlay === "watch" && (
              <AddWatchOnly onDone={() => setOverlay("none")} onBack={() => setOverlay("list")} />
            )}
            {overlay === "settings" && (
              <WalletSettings
                onSelectWallet={id => setOverlay({ detail: id })}
                onBack={() => setOverlay("none")}
              />
            )}
            {typeof overlay === "object" && "detail" in overlay && (
              <WalletDetailSettings
                walletId={overlay.detail}
                onBack={() => setOverlay(wallets.length > 0 ? "list" : "none")}
              />
            )}
          </div>
        </div>
      )}

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

      {/* ── DeFi Apps sheet ─────────────────────────────────────────────── */}
      {showDeFi && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={() => setShowDeFi(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-t-[28px] max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-0 flex-shrink-0" />
            <div className="flex-1 overflow-y-auto">
              <DeFiAppsSheet
                walletColor={walletColor}
                onClose={() => setShowDeFi(false)}
                onOpenBrowser={(url) => {
                  setShowDeFi(false);
                  setBrowserUrl(url);
                  setShowBrowser(true);
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* ── DeFi Browser (Rainbow-style) ─────────────────────────────────── */}
      {showBrowser && browserUrl && (
        <DeFiBrowserSheet
          initialUrl={browserUrl}
          onClose={() => setShowBrowser(false)}
        />
      )}

      {/* ── Swap sheet ──────────────────────────────────────────────────── */}
      {showSwap && address && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={() => setShowSwap(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-t-[28px] max-h-[92vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-0 flex-shrink-0" />
            <div className="flex-1 overflow-y-auto">
              <SwapSheet address={address} walletColor={walletColor} onClose={() => setShowSwap(false)} />
            </div>
          </div>
        </div>
      )}

      {/* ── Address Book sheet ───────────────────────────────────────────── */}
      {showAddressBook && (
        <div className="fixed inset-0 z-40 flex flex-col justify-end" onClick={() => setShowAddressBook(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-t-[28px] max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-0 flex-shrink-0" />
            <div className="flex-1 overflow-y-auto">
              <AddressBookSheet
                onSelectAddress={(addr) => { setToAddress(addr); setShowAddressBook(false); }}
                onClose={() => setShowAddressBook(false)}
              />
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

            {sendStep !== "recipient" && !!toAddress && (
              <button
                onClick={() => setSendStep("recipient")}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-2xl bg-muted/60 mb-4"
              >
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-black shrink-0" style={{ backgroundColor: walletColor }}>
                  {toAddress.slice(2, 4).toUpperCase()}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-xs text-muted-foreground">To</p>
                  <p className="text-[15px] font-bold text-foreground font-mono truncate">{toAddress.slice(0,6)}…{toAddress.slice(-4)}</p>
                </div>
                <ChevronDown className="w-4.5 h-4.5 text-muted-foreground shrink-0" />
              </button>
            )}

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
                {contacts.length > 0 && !isAddress(toAddress) && (
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">Contacts</p>
                      <button onClick={() => setShowAddressBook(true)} className="text-[11px] text-primary font-semibold">Manage</button>
                    </div>
                    <div className="space-y-1">
                      {contacts.slice(0, 5).map(c => (
                        <button key={c.id} onClick={() => { setToAddress(c.address); }}
                          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl bg-muted/40 hover:bg-muted/70 transition-colors text-left">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-base flex-shrink-0">{c.emoji}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-foreground truncate">{c.label}</p>
                            <p className="text-[10px] font-mono text-muted-foreground">{c.address.slice(0,8)}…{c.address.slice(-6)}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {contacts.length === 0 && !isAddress(toAddress) && (
                  <button onClick={() => setShowAddressBook(true)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-border/60 text-xs font-semibold text-muted-foreground hover:bg-muted/20 transition-colors">
                    📒 Open Address Book
                  </button>
                )}
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

            {sendStep === "amount" && (
              <div className="space-y-3.5">
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
                  disabled={sendDisabled || isWatchOnly}
                  className="w-full py-4 rounded-full font-black text-base flex items-center justify-center gap-2 transition-all"
                  style={(sendDisabled || isWatchOnly)
                    ? { backgroundColor: "var(--muted)", color: "var(--muted-foreground)" }
                    : { backgroundColor: SEND_ACCENT, color: "#fff", boxShadow: `0 8px 24px ${SEND_ACCENT}66` }}
                >
                  {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : !sendDisabled ? <Send className="w-4 h-4" /> : null}
                  {isWatchOnly ? "Watch-only — can't send" : sending ? "Sending…" : !amount ? "Enter an Amount" : `Send ${selectedToken.symbol}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Hero Card ────────────────────────────────────────────────────── */}
      <div className="px-4 pt-4 pb-2">
        <div
          className="relative rounded-3xl overflow-hidden px-5 pt-5 pb-5 shadow-xl"
          style={{ background: `linear-gradient(140deg, ${walletColor}f0 0%, ${walletColor}99 100%)` }}
        >
          {/* Decorative blobs */}
          <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full opacity-20" style={{ backgroundColor: walletColor, filter: "blur(32px)" }} />
          <div className="absolute -bottom-6 -left-6 w-24 h-24 rounded-full opacity-15" style={{ backgroundColor: "#fff", filter: "blur(24px)" }} />

          {/* Top row: avatar + name + copy address */}
          <div className="relative flex items-center justify-between mb-5">
            <button
              onClick={() => setOverlay("switcher")}
              className="flex items-center gap-2.5 active:opacity-80 transition-opacity"
            >
              <div className="w-10 h-10 rounded-full bg-white/25 flex items-center justify-center ring-2 ring-white/40 shrink-0">
                <span className="text-sm font-black text-white leading-none">
                  {address ? address.slice(2, 4).toUpperCase() : "WL"}
                </span>
              </div>
              <div className="text-left">
                <div className="flex items-center gap-1">
                  <span className="text-[15px] font-bold text-white leading-tight">{walletLabel}</span>
                  <ChevronDown size={13} className="text-white/70" />
                </div>
                {isWatchOnly && (
                  <span className="text-[9px] font-bold text-white/70 bg-white/20 px-1.5 py-0.5 rounded-full">Watch-only</span>
                )}
                {wallets.length > 1 && !isWatchOnly && (
                  <span className="text-[9px] font-semibold text-white/60">{wallets.length} wallets</span>
                )}
              </div>
            </button>
            <button
              onClick={copyAddress}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/15 hover:bg-white/25 active:scale-95 transition-all"
            >
              {copied
                ? <CheckCircle2 size={12} className="text-white" />
                : <Copy size={12} className="text-white/80" />}
              <span className="text-[11px] text-white/80 font-mono">
                {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "—"}
              </span>
            </button>
          </div>

          {/* Balance */}
          <div className="relative mb-4">
            <p className="text-white/60 text-[10px] font-bold uppercase tracking-widest mb-1">Total Balance</p>
            {totalUsd !== null ? (
              <button
                onClick={fetchAll}
                className="flex items-center gap-2 active:opacity-80 transition-opacity"
              >
                <span className="text-white text-[40px] font-black tracking-tight leading-none tabular-nums">
                  {formatUsd(totalUsd)}
                </span>
                {(loadingOp || loadingBase) && (
                  <Loader2 size={16} className="text-white/60 animate-spin mt-1" />
                )}
              </button>
            ) : (
              <div className="h-10 flex items-center">
                <Loader2 className="w-5 h-5 animate-spin text-white/50" />
              </div>
            )}
          </div>

          {/* Network badges */}
          <div className="relative flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/15">
              <div className="flex -space-x-1">
                <div className="w-3 h-3 rounded-full bg-[#ff0420] ring-1 ring-white/30" />
                <div className="w-3 h-3 rounded-full bg-[#0052ff] ring-1 ring-white/30" />
              </div>
              <span className="text-[10px] text-white/80 font-bold">Optimism · Base</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-2 px-4 py-3">
        {[
          { label: "Receive", icon: ArrowDownLeft, onClick: () => setAction(action === "receive" ? "none" : "receive"), disabled: false, color: "#10b981" },
          { label: "Send",    icon: Send,          onClick: () => openSend(), disabled: isWatchOnly, color: "#ff3b5c" },
          { label: "Swap",    icon: Repeat,        onClick: () => isWatchOnly ? toast.info("Watch-only wallet — import keys to swap") : setShowSwap(true), disabled: false, color: "#6366f1" },
          { label: "DeFi",    icon: Zap,           onClick: () => setShowDeFi(true), disabled: false, color: "#f59e0b" },
          { label: "Wallets", icon: Wallet,        onClick: () => setOverlay("list"), disabled: false, color: walletColor },
        ].map(({ label, icon: Icon, onClick, disabled, color }) => (
          <button
            key={label}
            onClick={onClick}
            disabled={!!disabled}
            className="flex flex-col items-center gap-1.5 disabled:opacity-40"
          >
            <div
              className="w-[50px] h-[50px] rounded-2xl flex items-center justify-center transition-transform active:scale-90"
              style={{ backgroundColor: `${color}18`, border: `1.5px solid ${color}30` }}
            >
              <Icon className="w-[20px] h-[20px]" strokeWidth={2.4} style={{ color }} />
            </div>
            <span className="text-[10.5px] font-bold text-muted-foreground">{label}</span>
          </button>
        ))}
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
              onClick={() => !isWatchOnly && openSend(tk.key)}
              className={cn(
                "w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border border-border/50 bg-card shadow-sm transition-colors",
                !isWatchOnly && "hover:bg-muted/30 cursor-pointer"
              )}
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

      {/* ── NFTs tab ────────────────────────────────────────────────────── */}
      {tab === "nfts" && address && <NftGallery address={address} />}
      {tab === "nfts" && !address && (
        <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground px-5">
          <p className="text-sm font-bold">Connect a wallet to see NFTs</p>
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
                  const meta = ACTIVITY_TYPE_META[item.activityType];
                  const MetaIcon = meta.icon;
                  const explorerUrl = item.network === "Optimism"
                    ? `https://optimistic.etherscan.io/tx/${item.hash}`
                    : `https://basescan.org/tx/${item.hash}`;
                  return (
                    <a
                      key={item.hash}
                      href={explorerUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-3 p-3.5 rounded-2xl bg-card border border-border/50 hover:bg-muted/30 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${meta.color}20` }}>
                        <MetaIcon size={18} style={{ color: meta.color }} strokeWidth={2.5} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-bold text-foreground">{meta.label}</p>
                          <div className="px-1.5 py-0.5 rounded-md text-[9px] font-bold" style={{ backgroundColor: item.network === "Optimism" ? "#ff042015" : "#0052ff15", color: item.network === "Optimism" ? "#ff0420" : "#0052ff" }}>
                            {item.network === "Optimism" ? "OP" : "Base"}
                          </div>
                          {item.status === "error" && (
                            <div className="px-1.5 py-0.5 rounded-md bg-destructive/10 text-[9px] font-bold text-destructive">Failed</div>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.activityType === "sent" || item.activityType === "interacted"
                            ? item.contractName ?? `→ ${item.counterparty.slice(0, 8)}…`
                            : `← ${item.counterparty.slice(0, 8)}…`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold tabular-nums" style={{ color: item.direction === "received" ? "#10b981" : "var(--foreground)" }}>
                          {item.direction === "received" ? "+" : item.valueEth > 0 ? "-" : ""}
                          {item.valueEth > 0 ? `${formatBal(item.valueEth, 4)} ETH` : "—"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">{formatRelativeTime(item.timestamp)}</p>
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
