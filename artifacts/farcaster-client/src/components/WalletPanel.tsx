import { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, Copy, Send, ArrowDownLeft, RefreshCw, CheckCircle2,
  AlertTriangle, ChevronDown, ChevronLeft, X,
  ArrowUpRight, Repeat, Sparkles, FileText,
  Wallet, Zap,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useWallet } from "@/hooks/useWallet";
import {
  publicClient, basePublicClient, arbPublicClient, ethPublicClient,
  USDC_BASE_ADDRESS, USDC_OP_ADDRESS, USDC_ARB_ADDRESS, USDC_ETH_ADDRESS,
  ERC20_BALANCE_ABI, ERC20_TRANSFER_ABI,
} from "@/lib/contracts";
import { createBaseWalletClient, createArbWalletClient, createEthWalletClient } from "@/lib/wallet";
import {
  formatEther, parseEther, parseUnits, isAddress, formatUnits, type Address,
} from "viem";
import { optimism, base, arbitrum, mainnet } from "viem/chains";
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
import { DeFiBrowserSheet } from "@/components/wallet/DeFiBrowserSheet";
import { TokenDetailPopup } from "@/components/wallet/TokenDetailPopup";
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

function networkAbbrev(network: string): string {
  if (network === "Optimism") return "OP";
  if (network === "Base") return "B";
  if (network === "Arbitrum") return "A";
  return "E";
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
type SendToken = "op-eth" | "op-usdc" | "base-eth" | "base-usdc" | "arb-eth" | "arb-usdc" | "eth-eth" | "eth-usdc";
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

// ─── ERC-20 token support (Blockscout) ────────────────────────────────────────

type Erc20TokenRow = {
  key: string;
  name: string;
  symbol: string;
  network: "Optimism" | "Base";
  networkColor: string;
  balance: number;
  rawBalance: bigint;
  usdValue: number | null;
  loading: false;
  icon: string;
  contractAddress: string;
  isSpam: boolean;
};

const ERC20_SKIP_SYMBOLS = new Set(["WETH", "USDC", "USDC.e", "USDbC", "wETH"]);

async function fetchErc20Balances(
  network: "Optimism" | "Base",
  address: Address
): Promise<Erc20TokenRow[]> {
  const host = network === "Optimism" ? "optimism.blockscout.com" : "base.blockscout.com";
  const networkColor = network === "Optimism" ? "#ff0420" : "#0052ff";
  try {
    const r = await fetch(
      `https://${host}/api/v2/addresses/${address}/token-balances?type=ERC-20`,
      { signal: timeoutSignal(10000) }
    );
    if (!r.ok) return [];
    const items = await r.json() as unknown[];
    if (!Array.isArray(items)) return [];
    return items
      .filter((item) => {
        const it = item as Record<string, unknown>;
        const token = it.token as Record<string, unknown> | undefined;
        return (
          token?.type === "ERC-20" &&
          it.value && it.value !== "0" &&
          token?.symbol &&
          !ERC20_SKIP_SYMBOLS.has(String(token.symbol))
        );
      })
      .map((item): Erc20TokenRow => {
        const it = item as Record<string, unknown>;
        const token = it.token as Record<string, unknown>;
        const decimals = Math.min(parseInt(String(token.decimals ?? "18"), 10), 18);
        const rawBalance = BigInt(String(it.value));
        const balance = parseFloat(formatUnits(rawBalance, decimals));
        const rate = token.exchange_rate ? parseFloat(String(token.exchange_rate)) : null;
        const usdValue = (rate !== null && rate > 0) ? balance * rate : null;
        const isSpam = usdValue !== null ? usdValue < 0.01 : !token.exchange_rate;
        return {
          key: `erc20-${network}-${String(token.address)}`,
          name: String(token.name ?? token.symbol ?? "Unknown"),
          symbol: String(token.symbol ?? "?"),
          network,
          networkColor,
          balance,
          rawBalance,
          usdValue,
          loading: false,
          icon: String(token.icon_url ?? ""),
          contractAddress: String(token.address),
          isSpam,
        };
      })
      .filter(t => t.balance > 0)
      .sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));
  } catch { return []; }
}

// Curated well-known tokens, read straight from the chain via our RPC proxy.
// This is the safety net for when Blockscout is down/rate-limited (which used
// to make tokens like DEGEN silently vanish from the wallet).
const CURATED_ERC20: { network: "Optimism" | "Base"; symbol: string; name: string; address: `0x${string}`; decimals: number; icon: string }[] = [
  { network: "Base", symbol: "DEGEN",  name: "Degen",      address: "0x4ed4E862860beD51a9570b96d89aF5E1B0Efefed", decimals: 18, icon: "https://assets.coingecko.com/coins/images/34515/small/android-chrome-512x512.png" },
  { network: "Base", symbol: "BRETT",  name: "Brett",      address: "0x532f27101965dd16442E59d40670FaF5eBB142E4", decimals: 18, icon: "https://assets.coingecko.com/coins/images/35529/small/200x200logo.png" },
  { network: "Base", symbol: "HIGHER", name: "Higher",     address: "0x0578d8A44db98B23BF096A382e016e29a5Ce0ffe", decimals: 18, icon: "https://assets.coingecko.com/coins/images/36084/small/higher.jpg" },
  { network: "Base", symbol: "AERO",   name: "Aerodrome",  address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18, icon: "https://assets.coingecko.com/coins/images/31745/small/token.png" },
  { network: "Base", symbol: "cbBTC",  name: "Coinbase BTC", address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8, icon: "https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png" },
  { network: "Optimism", symbol: "OP",   name: "Optimism",  address: "0x4200000000000000000000000000000000000042", decimals: 18, icon: "https://assets.coingecko.com/coins/images/25244/small/Optimism.png" },
  { network: "Optimism", symbol: "USDT", name: "Tether",    address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6,  icon: "https://assets.coingecko.com/coins/images/325/small/Tether.png" },
  { network: "Optimism", symbol: "DAI",  name: "Dai",       address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1", decimals: 18, icon: "https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png" },
  { network: "Optimism", symbol: "WBTC", name: "Wrapped BTC", address: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", decimals: 8, icon: "https://assets.coingecko.com/coins/images/7598/small/wrapped_bitcoin_wbtc.png" },
  { network: "Optimism", symbol: "VELO", name: "Velodrome", address: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db", decimals: 18, icon: "https://assets.coingecko.com/coins/images/25783/small/velo.png" },
];

async function fetchCuratedErc20(address: Address): Promise<Erc20TokenRow[]> {
  const rows = await Promise.all(CURATED_ERC20.map(async (t): Promise<Erc20TokenRow | null> => {
    try {
      const client = t.network === "Base" ? basePublicClient : publicClient;
      const raw = await client.readContract({
        address: t.address, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [address],
      }) as bigint;
      if (raw === 0n) return null;
      const balance = parseFloat(formatUnits(raw, t.decimals));
      return {
        key: `erc20-${t.network}-${t.address}`,
        name: t.name, symbol: t.symbol,
        network: t.network,
        networkColor: t.network === "Optimism" ? "#ff0420" : "#0052ff",
        balance, rawBalance: raw,
        usdValue: null, loading: false,
        icon: t.icon, contractAddress: t.address, isSpam: false,
      };
    } catch { return null; }
  }));
  const found = rows.filter((r): r is Erc20TokenRow => r !== null);
  // Best-effort USD pricing via DexScreener (batch per network); ignore failures
  await Promise.all((["Base", "Optimism"] as const).map(async net => {
    const toks = found.filter(t => t.network === net);
    if (!toks.length) return;
    try {
      const slug = net === "Base" ? "base" : "optimism";
      const r = await fetch(
        `https://api.dexscreener.com/tokens/v1/${slug}/${toks.map(t => t.contractAddress).join(",")}`,
        { signal: timeoutSignal(6000) }
      );
      if (!r.ok) return;
      const pairs = await r.json() as { baseToken?: { address?: string }; priceUsd?: string }[];
      if (!Array.isArray(pairs)) return;
      const priceMap = new Map<string, number>();
      for (const p of pairs) {
        const addr = p.baseToken?.address?.toLowerCase();
        const price = p.priceUsd ? parseFloat(p.priceUsd) : NaN;
        if (addr && !isNaN(price) && !priceMap.has(addr)) priceMap.set(addr, price);
      }
      for (const t of toks) {
        const price = priceMap.get(t.contractAddress.toLowerCase());
        if (price !== undefined) t.usdValue = t.balance * price;
      }
    } catch { /* pricing is optional */ }
  }));
  return found;
}

// ─── hidden tokens (user-managed, persisted) ──────────────────────────────────

const HIDDEN_TOKENS_KEY = "wallet_hidden_tokens";

function loadHiddenTokens(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDDEN_TOKENS_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

// ─── instant-load cache (stale-while-revalidate) ──────────────────────────────
// Balances/tokens/activity are shown from the last-known snapshot the moment an
// address becomes active — no spinner, no "0" flash — while a fresh fetch runs
// in the background and silently replaces it. bigints round-trip through a
// "<digits>n" string tag since JSON has no native bigint support.

function cacheReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${value.toString()}n` : value;
}
function cacheReviver(_key: string, value: unknown): unknown {
  return typeof value === "string" && /^\d+n$/.test(value) ? BigInt(value.slice(0, -1)) : value;
}
function saveCache<T>(key: string, data: T): void {
  try { localStorage.setItem(key, JSON.stringify(data, cacheReplacer)); } catch { /* quota */ }
}
function loadCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw, cacheReviver) as T) : null;
  } catch { return null; }
}

type BalanceSnapshot = {
  opEth: bigint | null; opUsdc: bigint | null;
  baseEth: bigint | null; baseUsdc: bigint | null;
  arbEth: bigint | null; arbUsdc: bigint | null;
  ethEth: bigint | null; ethUsdc: bigint | null;
  ethPrice: number | null;
};

const balCacheKey = (addr: string) => `wallet_cache_bal_${addr.toLowerCase()}`;
const tokCacheKey = (addr: string) => `wallet_cache_tok_${addr.toLowerCase()}`;
const actCacheKey = (addr: string) => `wallet_cache_act_${addr.toLowerCase()}`;

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
  const [showBrowser, setShowBrowser] = useState(false);
  const [browserUrl] = useState("");
  const [showAddressBook, setShowAddressBook] = useState(false);

  // ── main wallet state ───────────────────────────────────────────────────────
  const [tab, setTab] = useState<MainTab>("tokens");
  const [action, setAction] = useState<ActionMode>("none");
  const [sendStep, setSendStep] = useState<SendStep>("recipient");
  const [assetLocked, setAssetLocked] = useState(false);

  // balances
  const [opEth,    setOpEth]    = useState<bigint | null>(null);
  const [opUsdc,   setOpUsdc]   = useState<bigint | null>(null);
  const [baseEth,  setBaseEth]  = useState<bigint | null>(null);
  const [baseUsdc, setBaseUsdc] = useState<bigint | null>(null);
  const [arbEth,   setArbEth]   = useState<bigint | null>(null);
  const [arbUsdc,  setArbUsdc]  = useState<bigint | null>(null);
  const [ethEth,   setEthEth]   = useState<bigint | null>(null);
  const [ethUsdc,  setEthUsdc]  = useState<bigint | null>(null);
  const [loadingOp,   setLoadingOp]   = useState(false);
  const [loadingBase, setLoadingBase] = useState(false);
  const [loadingArb,  setLoadingArb]  = useState(false);
  const [loadingEth,  setLoadingEth]  = useState(false);
  const [erc20Tokens, setErc20Tokens] = useState<Erc20TokenRow[]>([]);
  const [loadingErc20, setLoadingErc20] = useState(false);
  const [detailToken, setDetailToken] = useState<string | null>(null);
  const [hiddenTokens, setHiddenTokens] = useState<Set<string>>(loadHiddenTokens);
  const [showHiddenSection, setShowHiddenSection] = useState(false);

  const toggleHiddenToken = useCallback((key: string) => {
    setHiddenTokens(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try { localStorage.setItem(HIDDEN_TOKENS_KEY, JSON.stringify([...next])); } catch { /* quota */ }
      return next;
    });
  }, []);
  const [ethPrice, setEthPrice] = useState<number | null>(null);
  const priceRef = useRef(false);
  const ethPriceRef = useRef<number | null>(null);
  useEffect(() => { ethPriceRef.current = ethPrice; }, [ethPrice]);

  // send
  const [toAddress, setToAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [sendToken, setSendToken] = useState<SendToken>("op-eth");
  const [sending, setSending] = useState(false);
  const [maxLoading, setMaxLoading] = useState(false);
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

  // Guards fetchAll/fetchActivity against stale responses: if the user
  // switches wallets while a slower fetch for the PREVIOUS address is still
  // in flight, that late response must never clobber the screen with the
  // wrong wallet's balances. Updated synchronously (in the address-change
  // effect, before kicking off any fetch) so every in-flight fetch can check
  // "is my address still the active one?" right before it commits state.
  const activeAddressRef = useRef<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!address) return;
    setLoadingOp(true); setLoadingBase(true); setLoadingArb(true); setLoadingEth(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readErc20 = (client: any, addr: `0x${string}`) =>
      (client.readContract({ address: addr, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [address] })) as Promise<bigint>;
    const safe = <T,>(p: Promise<T>): Promise<T | null> => p.catch(() => null);
    const [opBal, opUsdcBal, baseBal, baseUsdcBal, arbBal, arbUsdcBal, ethBal, ethUsdcBal] = await Promise.all([
      safe(publicClient.getBalance({ address })),
      safe(readErc20(publicClient, USDC_OP_ADDRESS)),
      safe(basePublicClient.getBalance({ address })),
      safe(readErc20(basePublicClient, USDC_BASE_ADDRESS)),
      safe(arbPublicClient.getBalance({ address })),
      safe(readErc20(arbPublicClient, USDC_ARB_ADDRESS)),
      safe(ethPublicClient.getBalance({ address })),
      safe(readErc20(ethPublicClient, USDC_ETH_ADDRESS)),
    ]);
    if (activeAddressRef.current !== address) return; // a newer wallet is active now — discard this stale response
    if (opBal      !== null) setOpEth(opBal);
    if (opUsdcBal  !== null) setOpUsdc(opUsdcBal);
    if (baseBal    !== null) setBaseEth(baseBal);
    if (baseUsdcBal !== null) setBaseUsdc(baseUsdcBal);
    if (arbBal     !== null) setArbEth(arbBal);
    if (arbUsdcBal !== null) setArbUsdc(arbUsdcBal);
    if (ethBal     !== null) setEthEth(ethBal);
    if (ethUsdcBal !== null) setEthUsdc(ethUsdcBal);
    setLoadingOp(false); setLoadingBase(false); setLoadingArb(false); setLoadingEth(false);
    // Cache this snapshot so the next visit to this address renders instantly
    // (stale-while-revalidate) instead of showing loaders from a cold start.
    saveCache<BalanceSnapshot>(balCacheKey(address), {
      opEth: opBal ?? null, opUsdc: opUsdcBal ?? null,
      baseEth: baseBal ?? null, baseUsdc: baseUsdcBal ?? null,
      arbEth: arbBal ?? null, arbUsdc: arbUsdcBal ?? null,
      ethEth: ethBal ?? null, ethUsdc: ethUsdcBal ?? null,
      ethPrice: ethPriceRef.current,
    });
    // Fetch ERC-20 tokens in parallel (non-blocking). Blockscout discovers
    // arbitrary tokens; the curated on-chain read guarantees well-known ones
    // (DEGEN, OP, …) still appear even when Blockscout is unavailable.
    setLoadingErc20(true);
    Promise.all([
      fetchErc20Balances("Optimism", address),
      fetchErc20Balances("Base", address),
      fetchCuratedErc20(address),
    ]).then(([opToks, baseToks, curated]) => {
      if (activeAddressRef.current !== address) return; // stale — a different wallet is active now
      const discovered = [...opToks, ...baseToks];
      const seen = new Set(discovered.map(t => `${t.network}-${t.contractAddress.toLowerCase()}`));
      const extras = curated.filter(t => !seen.has(`${t.network}-${t.contractAddress.toLowerCase()}`));
      const merged = [...discovered, ...extras].sort((a, b) => (b.usdValue ?? -1) - (a.usdValue ?? -1));
      setErc20Tokens(merged);
      saveCache(tokCacheKey(address), merged);
    }).finally(() => setLoadingErc20(false));
  }, [address]);

  const fetchActivity = useCallback(async () => {
    if (!address) return;
    setLoadingActivity(true);
    activityFetchedFor.current = address;
    try {
      const [opTxs, baseTxs] = await Promise.all([
        fetchActivityForNetwork("Optimism", address),
        fetchActivityForNetwork("Base", address),
      ]);
      if (activeAddressRef.current !== address) return; // stale — a different wallet is active now
      const merged = [...opTxs, ...baseTxs].sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
      setActivity(merged);
      saveCache(actCacheKey(address), merged);
    } finally {
      if (activeAddressRef.current === address) setLoadingActivity(false);
    }
  }, [address]);

  // Re-fetch when active wallet changes. Hydrate instantly from the last
  // cached snapshot for this address (if any) so the UI never regresses to a
  // blank/loading state on a switch back to a wallet we've already loaded —
  // fetchAll() then runs in the background and silently replaces stale data.
  useEffect(() => {
    activeAddressRef.current = address;
    activityFetchedFor.current = null;
    if (!address) {
      setOpEth(null); setOpUsdc(null); setBaseEth(null); setBaseUsdc(null);
      setArbEth(null); setArbUsdc(null); setEthEth(null); setEthUsdc(null);
      setActivity([]); setErc20Tokens([]);
      fetchAll();
      return;
    }
    const balSnap = loadCache<BalanceSnapshot>(balCacheKey(address));
    if (balSnap) {
      setOpEth(balSnap.opEth); setOpUsdc(balSnap.opUsdc);
      setBaseEth(balSnap.baseEth); setBaseUsdc(balSnap.baseUsdc);
      setArbEth(balSnap.arbEth); setArbUsdc(balSnap.arbUsdc);
      setEthEth(balSnap.ethEth); setEthUsdc(balSnap.ethUsdc);
      if (balSnap.ethPrice) setEthPrice(balSnap.ethPrice);
    } else {
      setOpEth(null); setOpUsdc(null); setBaseEth(null); setBaseUsdc(null);
      setArbEth(null); setArbUsdc(null); setEthEth(null); setEthUsdc(null);
    }
    setErc20Tokens(loadCache<Erc20TokenRow[]>(tokCacheKey(address)) ?? []);
    setActivity(loadCache<ActivityItem[]>(actCacheKey(address)) ?? []);
    fetchAll();
    // Prefetch activity in the background too (not gated on the Activity tab
    // being open) so it's already warm — instant instead of a spinner — the
    // moment the user taps over to it.
    if (address) fetchActivity();
  }, [address, fetchAll, fetchActivity]);

  useEffect(() => {
    if (priceRef.current) return;
    priceRef.current = true;
    fetchEthPriceUsd().then(p => { if (p) setEthPrice(p); });
  }, []);

  useEffect(() => {
    if (tab === "activity" && address && activityFetchedFor.current !== address) {
      fetchActivity();
    }
  }, [tab, address, fetchActivity]);

  // derived
  const opEthNum    = opEth    !== null ? parseFloat(formatEther(opEth))     : 0;
  const opUsdcNum   = opUsdc   !== null ? parseFloat(formatUnits(opUsdc, 6)) : 0;
  const baseEthNum  = baseEth  !== null ? parseFloat(formatEther(baseEth))   : 0;
  const baseUsdcNum = baseUsdc !== null ? parseFloat(formatUnits(baseUsdc, 6)) : 0;
  const arbEthNum   = arbEth   !== null ? parseFloat(formatEther(arbEth))    : 0;
  const arbUsdcNum  = arbUsdc  !== null ? parseFloat(formatUnits(arbUsdc, 6)) : 0;
  const ethEthNum   = ethEth   !== null ? parseFloat(formatEther(ethEth))    : 0;
  const ethUsdcNum  = ethUsdc  !== null ? parseFloat(formatUnits(ethUsdc, 6)) : 0;
  const erc20Usd = erc20Tokens.reduce((s, t) => s + (hiddenTokens.has(t.key) ? 0 : (t.usdValue ?? 0)), 0);
  const totalUsd = ethPrice
    ? (opEthNum + baseEthNum + arbEthNum + ethEthNum) * ethPrice + opUsdcNum + baseUsdcNum + arbUsdcNum + ethUsdcNum + erc20Usd
    : null;

  const ETH_ICON  = "https://assets.coingecko.com/coins/images/279/small/ethereum.png";
  const USDC_ICON = "https://assets.coingecko.com/coins/images/6319/small/usdc.png";

  const allTokens: TokenRow[] = [
    { key: "op-eth",    name: "Ethereum", symbol: "ETH",  network: "Optimism", networkColor: "#ff0420", balance: opEthNum,    rawBalance: opEth,    usdValue: ethPrice ? opEthNum * ethPrice : null,    loading: loadingOp,   icon: ETH_ICON  },
    { key: "op-usdc",   name: "USD Coin", symbol: "USDC", network: "Optimism", networkColor: "#ff0420", balance: opUsdcNum,   rawBalance: opUsdc,   usdValue: opUsdcNum,                                loading: loadingOp,   icon: USDC_ICON },
    { key: "base-eth",  name: "Ethereum", symbol: "ETH",  network: "Base",     networkColor: "#0052ff", balance: baseEthNum,  rawBalance: baseEth,  usdValue: ethPrice ? baseEthNum * ethPrice : null,  loading: loadingBase, icon: ETH_ICON  },
    { key: "base-usdc", name: "USD Coin", symbol: "USDC", network: "Base",     networkColor: "#0052ff", balance: baseUsdcNum, rawBalance: baseUsdc, usdValue: baseUsdcNum,                              loading: loadingBase, icon: USDC_ICON },
    { key: "arb-eth",   name: "Ethereum", symbol: "ETH",  network: "Arbitrum", networkColor: "#28a0f0", balance: arbEthNum,   rawBalance: arbEth,   usdValue: ethPrice ? arbEthNum * ethPrice : null,   loading: loadingArb,  icon: ETH_ICON  },
    { key: "arb-usdc",  name: "USD Coin", symbol: "USDC", network: "Arbitrum", networkColor: "#28a0f0", balance: arbUsdcNum,  rawBalance: arbUsdc,  usdValue: arbUsdcNum,                               loading: loadingArb,  icon: USDC_ICON },
    { key: "eth-eth",   name: "Ethereum", symbol: "ETH",  network: "Ethereum", networkColor: "#627eea", balance: ethEthNum,   rawBalance: ethEth,   usdValue: ethPrice ? ethEthNum * ethPrice : null,   loading: loadingEth,  icon: ETH_ICON  },
    { key: "eth-usdc",  name: "USD Coin", symbol: "USDC", network: "Ethereum", networkColor: "#627eea", balance: ethUsdcNum,  rawBalance: ethUsdc,  usdValue: ethUsdcNum,                               loading: loadingEth,  icon: USDC_ICON },
  ];

  const loadingDone = !loadingOp && !loadingBase && !loadingArb && !loadingEth;
  // Show a token row only while its network is still fetching (skeleton state)
  // OR once done and it actually has a balance. Zero-balance rows never appear.
  const tokens = allTokens.filter(t => t.loading || t.balance > 0);

  // Single, unified token list — native (ETH/USDC per chain) and discovered
  // ERC-20s merged and sorted by USD value, biggest balance first. Still-
  // loading native rows (skeleton) float to the top rather than the bottom
  // so the list doesn't visibly reshuffle a moment later once they price in.
  type DisplayToken =
    | (TokenRow & { kind: "native" })
    | (Erc20TokenRow & { kind: "erc20" });
  const visibleTokens: DisplayToken[] = [
    ...tokens.filter(tk => !hiddenTokens.has(tk.key)).map(tk => ({ ...tk, kind: "native" as const })),
    ...erc20Tokens.filter(tk => !hiddenTokens.has(tk.key)).map(tk => ({ ...tk, kind: "erc20" as const })),
  ].sort((a, b) => {
    const aLoading = a.kind === "native" && a.loading;
    const bLoading = b.kind === "native" && b.loading;
    if (aLoading && !bLoading) return -1;
    if (!aLoading && bLoading) return 1;
    return (b.usdValue ?? -1) - (a.usdValue ?? -1);
  });

  const selectedToken = allTokens.find(t => t.key === sendToken) ?? allTokens[0];
  const sendDisabled = sending || !toAddress || !amount;

  const usdEquivalent = (() => {
    const amt = parseFloat(amount);
    if (!amount || isNaN(amt)) return "$0.00";
    if (selectedToken.usdValue == null || selectedToken.balance === 0) return "-";
    const perToken = selectedToken.usdValue / selectedToken.balance;
    return `$${(amt * perToken).toFixed(2)}`;
  })();

  async function handleMax() {
    if (selectedToken.loading || maxLoading) return;
    const isUsdc = sendToken.endsWith("-usdc");
    if (isUsdc) {
      // ERC-20 transfers don't spend the token itself for gas — the full raw
      // balance is always sendable (gas comes out of the separate ETH balance).
      const raw = sendToken === "base-usdc" ? baseUsdc : sendToken === "op-usdc" ? opUsdc : sendToken === "arb-usdc" ? arbUsdc : ethUsdc;
      if (raw !== null) setAmount(formatUnits(raw, 6));
      return;
    }

    // Native-token max: a flat "leave 0.0001 ETH for gas" buffer badly
    // under-reserves on Ethereum L1 (where a plain transfer alone can cost
    // several times that at normal gas prices) — reserve the REAL estimated
    // cost of this specific send instead.
    const bal = sendToken === "op-eth" ? opEth : sendToken === "base-eth" ? baseEth : sendToken === "arb-eth" ? arbEth : ethEth;
    if (bal === null) return;
    const pubCli = sendToken === "op-eth" ? publicClient : sendToken === "base-eth" ? basePublicClient : sendToken === "arb-eth" ? arbPublicClient : ethPublicClient;
    const to = (isAddress(toAddress) ? toAddress : address) as `0x${string}` | null;
    if (!to) return;

    setMaxLoading(true);
    try {
      const [estimatedGas, gasPrice] = await Promise.all([
        pubCli.estimateGas({ account: address as `0x${string}`, to, value: 1n }).catch(() => 21_000n),
        pubCli.getGasPrice(),
      ]);
      // +50% headroom: gas price can move between estimating "max" here and
      // the actual send a moment later, especially on Ethereum L1.
      const reserve = (estimatedGas * gasPrice * 150n) / 100n;
      const maxWei = bal > reserve ? bal - reserve : 0n;
      setAmount(maxWei > 0n ? formatEther(maxWei) : "0");
    } catch {
      // Estimation itself failed (RPC hiccup) — fall back to a conservative
      // flat reserve rather than blocking the Max button entirely.
      const max = Math.max(0, selectedToken.balance - 0.0005);
      setAmount(max > 0 ? max.toFixed(8) : "0");
    } finally {
      setMaxLoading(false);
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
      const isArb  = sendToken === "arb-eth"  || sendToken === "arb-usdc";
      const isEth  = sendToken === "eth-eth"  || sendToken === "eth-usdc";
      const activeClient = isBase
        ? createBaseWalletClient(walletClient.account!)
        : isArb
        ? createArbWalletClient(walletClient.account!)
        : isEth
        ? createEthWalletClient(walletClient.account!)
        : walletClient;

      const isUsdc = sendToken.endsWith("-usdc");
      if (isUsdc) {
        const rawAmt = parseUnits(amount, 6);
        const currentBal = sendToken === "base-usdc" ? baseUsdc : sendToken === "op-usdc" ? opUsdc : sendToken === "arb-usdc" ? arbUsdc : ethUsdc;
        if (currentBal !== null && rawAmt > currentBal) { setSendError("Insufficient USDC balance."); setSending(false); return; }
        const usdcAddr  = sendToken === "base-usdc" ? USDC_BASE_ADDRESS : sendToken === "op-usdc" ? USDC_OP_ADDRESS : sendToken === "arb-usdc" ? USDC_ARB_ADDRESS : USDC_ETH_ADDRESS;
        const usdcPub   = sendToken === "base-usdc" ? basePublicClient : sendToken === "op-usdc" ? publicClient : sendToken === "arb-usdc" ? arbPublicClient : ethPublicClient;
        const usdcChain = sendToken === "base-usdc" ? base : sendToken === "op-usdc" ? optimism : sendToken === "arb-usdc" ? arbitrum : mainnet;
        const { request } = await usdcPub.simulateContract({
          address: usdcAddr, abi: ERC20_TRANSFER_ABI, functionName: "transfer",
          args: [toAddress as `0x${string}`, rawAmt], account: walletClient.account!,
        });
        hash = await activeClient.writeContract({ ...request, chain: usdcChain });
      } else {
        const value = parseEther(amount);
        const bal = sendToken === "op-eth" ? opEth : sendToken === "base-eth" ? baseEth : sendToken === "arb-eth" ? arbEth : ethEth;
        if (bal !== null && value > bal) { setSendError("Insufficient ETH balance."); setSending(false); return; }
        const chain  = sendToken === "op-eth" ? optimism : sendToken === "base-eth" ? base : sendToken === "arb-eth" ? arbitrum : mainnet;
        const pubCli = sendToken === "op-eth" ? publicClient : sendToken === "base-eth" ? basePublicClient : sendToken === "arb-eth" ? arbPublicClient : ethPublicClient;
        let gas: bigint | undefined;
        let gasPrice: bigint | undefined;
        try {
          const [estimated, price] = await Promise.all([
            pubCli.estimateGas({ account: walletClient.account!, to: toAddress as `0x${string}`, value }),
            pubCli.getGasPrice(),
          ]);
          gas = (estimated * 130n) / 100n;
          gasPrice = price;
        } catch { /**/ }
        // Catch "the amount alone fits but there's nothing left for gas" up
        // front with a clear message, instead of letting the wallet/RPC
        // reject with a cryptic error after the user already hit Send.
        if (bal !== null && gas !== undefined && gasPrice !== undefined && value + gas * gasPrice > bal) {
          setSendError("Insufficient balance to cover this amount plus network fees.");
          setSending(false);
          return;
        }
        hash = await activeClient.sendTransaction({
          account: walletClient.account!, chain, to: toAddress as `0x${string}`, value,
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

  const explorerBase = sendToken.startsWith("arb")
    ? "https://arbiscan.io/tx/"
    : sendToken.startsWith("base")
    ? "https://basescan.org/tx/"
    : sendToken.startsWith("eth-")
    ? "https://etherscan.io/tx/"
    : "https://optimistic.etherscan.io/tx/";

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOverlay("none")}
          />
          <div
            className="relative bg-background rounded-2xl max-h-[75vh] w-full max-w-[420px] overflow-hidden shadow-2xl flex flex-col"
            onClick={e => e.stopPropagation()}
          >

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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
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


      {/* ── Token detail popup ────────────────────────────────────────────── */}
      {detailToken && (() => {
        const tk = allTokens.find(t => t.key === detailToken) ?? erc20Tokens.find(t => t.key === detailToken);
        if (!tk) return null;
        const isErc20 = "contractAddress" in tk;
        return (
          <TokenDetailPopup
            tokenKey={tk.key}
            name={tk.name}
            symbol={tk.symbol}
            network={tk.network}
            networkColor={tk.networkColor}
            balance={tk.balance}
            usdValue={tk.usdValue}
            icon={tk.icon}
            contractAddress={isErc20 ? (tk as Erc20TokenRow).contractAddress : undefined}
            onClose={() => setDetailToken(null)}
            onSend={isErc20 ? undefined : () => openSend(tk.key as SendToken)}
            onSwap={() => setShowSwap(true)}
            hidden={hiddenTokens.has(tk.key)}
            onToggleHide={() => toggleHiddenToken(tk.key)}
          />
        );
      })()}

      {/* ── DeFi Browser (Rainbow-style) ─────────────────────────────────── */}
      {showBrowser && (
        <DeFiBrowserSheet
          initialUrl={browserUrl}
          onClose={() => setShowBrowser(false)}
        />
      )}

      {/* ── Swap sheet ──────────────────────────────────────────────────── */}
      {showSwap && address && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setShowSwap(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-3xl max-h-[80vh] w-full max-w-sm overflow-hidden flex flex-col shadow-2xl border border-border/60" onClick={e => e.stopPropagation()}>
            <div className="flex-1 overflow-y-auto">
              <SwapSheet address={address} walletColor={walletColor} onClose={() => setShowSwap(false)} />
            </div>
          </div>
        </div>
      )}

      {/* ── Address Book sheet ───────────────────────────────────────────── */}
      {showAddressBook && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setShowAddressBook(false)}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-3xl max-h-[70vh] w-full max-w-sm overflow-hidden flex flex-col shadow-2xl border border-border/60" onClick={e => e.stopPropagation()}>
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
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setAction("none")}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-3xl px-5 pt-5 pb-6 space-y-4 max-h-[85vh] w-full max-w-xs overflow-y-auto overflow-x-hidden shadow-2xl border border-border/60" onClick={e => e.stopPropagation()}>
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
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4" onClick={() => setAction("none")}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
          <div className="relative bg-card rounded-3xl px-5 pt-5 pb-6 max-h-[85vh] w-full max-w-sm overflow-y-auto overflow-x-hidden shadow-2xl border border-border/60" onClick={e => e.stopPropagation()}>
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
                    className="flex-1 min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none font-mono"
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
                      {tk.usdValue != null ? `$${tk.usdValue.toFixed(2)}` : "-"}
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
                    className="flex-1 min-w-0 w-full bg-transparent text-[34px] font-black outline-none tabular-nums mr-3"
                    style={{ color: amount ? SEND_ACCENT : "var(--muted-foreground)" }}
                  />
                  <span className="text-xl font-black text-foreground shrink-0">{selectedToken.symbol}</span>
                </div>

                <div className="flex items-center justify-between px-4 py-3 rounded-2xl bg-muted/60">
                  <span className="text-[15px] font-bold text-muted-foreground truncate flex-1">{usdEquivalent}</span>
                  <div className="flex items-center gap-2.5 shrink-0">
                    <button
                      onClick={handleMax}
                      disabled={selectedToken.loading || selectedToken.balance === 0 || maxLoading}
                      className="px-3 py-1.5 rounded-full text-xs font-black disabled:opacity-40 flex items-center gap-1.5"
                      style={{ backgroundColor: `${SEND_ACCENT}22`, color: SEND_ACCENT }}
                    >
                      {maxLoading && <Loader2 size={11} className="animate-spin" />}
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
                  {isWatchOnly ? "Watch-only - can't send" : sending ? "Sending…" : !amount ? "Enter an Amount" : `Send ${selectedToken.symbol}`}
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
                {address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "-"}
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

        </div>
      </div>

      {/* ── Quick Actions ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-2 px-4 py-3">
        {[
          { label: "Receive", icon: ArrowDownLeft, onClick: () => setAction(action === "receive" ? "none" : "receive"), disabled: false, color: "#10b981" },
          { label: "Send",    icon: Send,          onClick: () => openSend(), disabled: isWatchOnly, color: "#ff3b5c" },
          { label: "Swap",    icon: Repeat,        onClick: () => isWatchOnly ? toast.info("Watch-only wallet - import keys to swap") : setShowSwap(true), disabled: false, color: "#6366f1" },
          { label: "Browser",  icon: Zap,           onClick: () => setShowBrowser(true), disabled: false, color: "#f59e0b" },
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
          {/* Native + ERC-20 tokens, merged into one list sorted by USD value (highest first) */}
          {visibleTokens.map(tk => (
            <button
              key={tk.key}
              onClick={() => setDetailToken(tk.key)}
              className="w-full flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border border-border/50 bg-card shadow-sm transition-colors hover:bg-muted/30 cursor-pointer"
            >
              <div className="relative shrink-0">
                {tk.icon ? (
                  <img src={tk.icon} alt={tk.symbol} className="w-10 h-10 rounded-full bg-muted"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; (e.target as HTMLImageElement).nextElementSibling?.classList.remove("hidden"); }} />
                ) : null}
                <div className={cn("w-10 h-10 rounded-full bg-muted flex items-center justify-center", tk.icon ? "hidden" : "")}>
                  <span className="text-xs font-bold text-muted-foreground">{tk.symbol.slice(0, 3)}</span>
                </div>
                <div
                  className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center"
                  style={{ backgroundColor: tk.networkColor }}
                >
                  <span className="text-[7px] font-bold text-white leading-none">{networkAbbrev(tk.network)}</span>
                </div>
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{tk.symbol}</p>
                <div className="inline-flex mt-0.5 px-1.5 py-0.5 rounded-md" style={{ backgroundColor: `${tk.networkColor}1a` }}>
                  <p className="text-[11px] font-semibold" style={{ color: tk.networkColor }}>{tk.network}</p>
                </div>
              </div>
              <div className="text-right shrink-0">
                {tk.kind === "native" && tk.loading ? (
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

          {loadingErc20 && erc20Tokens.length === 0 && (
            <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading tokens…
            </div>
          )}

          {/* Hidden tokens — user-managed, collapsible */}
          {(() => {
            const hiddenRows = [
              ...tokens.filter(tk => hiddenTokens.has(tk.key)),
              ...erc20Tokens.filter(tk => hiddenTokens.has(tk.key)),
            ];
            if (hiddenRows.length === 0) return null;
            return (
              <div className="pt-1">
                <button
                  onClick={() => setShowHiddenSection(v => !v)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", showHiddenSection && "rotate-180")} />
                  Hidden tokens ({hiddenRows.length})
                </button>
                {showHiddenSection && hiddenRows.map(tk => (
                  <div key={tk.key} className="flex items-center gap-3 px-4 py-2.5 rounded-2xl opacity-60">
                    <img src={tk.icon} alt={tk.symbol} className="w-8 h-8 rounded-full bg-muted shrink-0"
                      onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-sm font-bold text-foreground truncate">{tk.symbol}</p>
                      <p className="text-[11px] text-muted-foreground">{tk.network} · {formatBal(tk.balance, 4)}</p>
                    </div>
                    <button
                      onClick={() => toggleHiddenToken(tk.key)}
                      className="px-3 py-1.5 rounded-full text-[11px] font-bold bg-primary/10 text-primary hover:bg-primary/20 transition-colors shrink-0"
                    >
                      Unhide
                    </button>
                  </div>
                ))}
              </div>
            );
          })()}

          {loadingDone && tokens.length === 0 && erc20Tokens.length === 0 && !loadingErc20 && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-2xl border bg-amber-50 border-amber-200/80 text-xs text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold mb-0.5">No balance yet</p>
                <p className="opacity-80">Send ETH or USDC to your address to get started. You need a tiny amount of ETH for gas (~$0.01).</p>
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
                    : item.network === "Arbitrum"
                    ? `https://arbiscan.io/tx/${item.hash}`
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
                          <div className="px-1.5 py-0.5 rounded-md text-[9px] font-bold" style={{
                            backgroundColor: item.network === "Optimism" ? "#ff042015" : item.network === "Arbitrum" ? "#28a0f015" : "#0052ff15",
                            color: item.network === "Optimism" ? "#ff0420" : item.network === "Arbitrum" ? "#28a0f0" : "#0052ff"
                          }}>
                            {item.network === "Optimism" ? "OP" : item.network === "Arbitrum" ? "ARB" : "Base"}
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
                        {item.valueEth > 0 ? (
                          <p className="text-sm font-bold tabular-nums" style={{ color: item.direction === "received" ? "#10b981" : "var(--foreground)" }}>
                            {item.direction === "received" ? "+" : "-"}
                            {formatBal(item.valueEth, 4)} ETH
                          </p>
                        ) : item.contractName ? (
                          // No native ETH moved (a token approval, a
                          // token-for-token swap, or a plain contract call)
                          // -- previously always showed a bare "—" here even
                          // though the contract/token name was already
                          // fetched (used only in the subtitle for
                          // sent/interacted rows), which read as broken.
                          // Falls back to the contract's tagged name (e.g.
                          // the token being approved, or the router being
                          // called) instead. Same fix ported to the native
                          // app's WalletPanelScreen.tsx.
                          <p className="text-xs font-semibold text-muted-foreground truncate max-w-[120px]">{item.contractName}</p>
                        ) : null}
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
