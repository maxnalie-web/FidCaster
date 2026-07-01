import { useState, useEffect, useCallback, useMemo } from "react";
import { useEthPrice } from "@/hooks/useEthPrice";
import { useParams, useLocation } from "wouter";
import { useWallet } from "@/hooks/useWallet";
import {
  ArrowLeft, RefreshCw, ExternalLink, Copy, Check,
  Tag, AlertTriangle, Loader2, CheckCircle2, ChevronLeft, LogIn,
  DollarSign, Clock, Wallet, X,
} from "lucide-react";
import { useMarketWallet } from "@/hooks/useMarketWallet";
import { cn } from "@/lib/utils";
import {
  formatEther, parseEther,
  encodeFunctionData, type Address,
  createPublicClient, http, fallback,
} from "viem";
import type { LocalAccount } from "viem/accounts";
import { optimism } from "viem/chains";

const FID_MARKET_ADDRESS = "0xcc11C0Bc08bbF8A5C0AAca80E884C6c7CC0eE3c3" as const;
const ID_REGISTRY_ADDRESS = "0x00000000Fc6c5F01Fc30151999387Bb99A9f489b" as const;
const FEE_BPS = 900;

function formatTimeAgo(unixSec: number): string {
  if (!unixSec) return "·";
  const diff = Math.floor(Date.now() / 1000) - unixSec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function formatTimeLeft(unixSec: number): { text: string; expired: boolean } {
  if (!unixSec) return { text: "·", expired: false };
  const diff = unixSec - Math.floor(Date.now() / 1000);
  if (diff <= 0) return { text: "Expired", expired: true };
  if (diff < 3600) return { text: `${Math.floor(diff / 60)}m left`, expired: false };
  if (diff < 86400) return { text: `${Math.floor(diff / 3600)}h left`, expired: false };
  return { text: `${Math.floor(diff / 86400)}d left`, expired: false };
}

const OP_RPCS = [
  "https://mainnet.optimism.io",
  "https://optimism.llamarpc.com",
  "https://1rpc.io/op",
  "https://optimism.drpc.org",
  "https://optimism-rpc.publicnode.com",
];

const opClient = createPublicClient({
  chain: optimism,
  transport: fallback(OP_RPCS.map(url => http(url, { timeout: 8000, retryCount: 1 }))),
});

/** Fetch the EIP-712 nonce for an address from IdRegistry on Optimism */
async function fetchAddressNonce(address: Address): Promise<bigint> {
  return opClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: [{ name: "nonces", type: "function", stateMutability: "view",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [{ name: "", type: "uint256" }] }] as const,
    functionName: "nonces",
    args: [address],
  });
}

/** Wait for a transaction receipt using viem (auto-retries with fallback RPCs) */
async function waitForReceipt(txHash: string): Promise<void> {
  const receipt = await opClient.waitForTransactionReceipt({
    hash: txHash as `0x${string}`,
    timeout: 90_000,
    pollingInterval: 2_000,
  });
  if (receipt.status === "reverted") throw new Error("Transaction reverted on-chain");
}

const fidMarketAbi = [
  {
    // buy(uint256 fid, address seller, uint256 toDeadline, bytes toSig)
    // fromSig is already stored on-chain in the listing; contract reads it internally
    name: "buy",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "toDeadline", type: "uint256" },
      { name: "toSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    // list(uint256 fid, uint256 priceWei, uint256 durationSecs, uint256 fromDeadline, bytes fromSig)
    // durationSecs must be in [600, 2592000] (10 min – 30 days)
    // fromDeadline must be <= block.timestamp + durationSecs
    name: "list",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "fid", type: "uint256" },
      { name: "priceWei", type: "uint256" },
      { name: "durationSecs", type: "uint256" },
      { name: "fromDeadline", type: "uint256" },
      { name: "fromSig", type: "bytes" },
    ],
    outputs: [],
  },
  {
    // cancel(uint256 fid) — removes the listing
    name: "cancel",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "fid", type: "uint256" }],
    outputs: [],
  },
] as const;

const ID_REGISTRY_EIP712_DOMAIN = {
  name: "Farcaster IdRegistry",
  version: "1",
  chainId: optimism.id,
  verifyingContract: ID_REGISTRY_ADDRESS,
} as const;

const TRANSFER_TYPES = {
  Transfer: [
    { name: "fid", type: "uint256" },
    { name: "to", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

function shortAddr(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

interface FidData {
  fid: number;
  owner: string;
  listing: {
    active: boolean;
    seller?: string;
    priceWei?: string;
    priceEth?: string;
    fromDeadline?: number;
    listedAt?: number;
    fromSig?: string;
  };
  buyable: boolean;
  sigExpired: boolean;
  listingExpired: boolean;
  paused: boolean;
  feeBps: number;
  marketAddress: string;
}

interface FidInfo {
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
}

type BuyPhase = "idle" | "signing" | "sending" | "confirming" | "done" | { error: string };
type SellPhase = "idle" | "signing" | "sending" | "confirming" | "done" | "delisting" | "delist_confirming" | "delist_done" | { error: string };

export default function FidDetailPage() {
  const params = useParams<{ id: string }>();
  const fid = parseInt(params.id || "0", 10);
  const [, navigate] = useLocation();

  const { fid: myFid, address: myAddress, walletClient, authMethod } = useWallet();
  const {
    wallet: extWallet,
    connect: connectExt,
    connectMetaMask,
    connectWalletConnect,
    connecting: connectingExt,
    disconnect: disconnectExt,
    hasProvider: hasExtProvider,
    wrongChain: wrongExtChain,
  } = useMarketWallet();

  // mnemonic & wallet auth both have a walletClient in WalletContext; farcaster auth needs extWallet
  const isLocalWalletAuth = authMethod === "mnemonic" || authMethod === "wallet";
  const effectiveWC = isLocalWalletAuth ? walletClient : extWallet?.walletClient;
  const effectiveAddr = (isLocalWalletAuth ? myAddress : extWallet?.address) as Address | undefined;

  const [data, setData] = useState<FidData | null>(null);
  const [info, setInfo] = useState<FidInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const ethUsd = useEthPrice();

  const [buyPhase, setBuyPhase] = useState<BuyPhase>("idle");
  const [sellPhase, setSellPhase] = useState<SellPhase>("idle");
  const [sellPrice, setSellPrice] = useState("");
  const [priceMode, setPriceMode] = useState<"eth" | "usd">("eth");
  const [durationDays, setDurationDays] = useState(30);
  const [sellTxHash, setSellTxHash] = useState("");
  const [buyTxHash, setBuyTxHash] = useState("");
  const [confirmPending, setConfirmPending] = useState<null | { action: "buy" | "list" | "delist"; label: string; detail: string; onConfirm: () => void }>(null);

  // Derived ETH price regardless of input mode
  const sellPriceEth = useMemo(() => {
    const n = parseFloat(sellPrice);
    if (!sellPrice || isNaN(n) || n <= 0) return "";
    if (priceMode === "eth") return sellPrice;
    if (!ethUsd || ethUsd === 0) return "";
    return (n / ethUsd).toFixed(6);
  }, [sellPrice, priceMode, ethUsd]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [dataRes, infoRes] = await Promise.all([
        fetch(`/api/fid-market/fid-data/${fid}`),
        fetch(`/api/fid-market/fid-info?fid=${fid}`),
      ]);
      if (dataRes.ok) {
        const d = await dataRes.json();
        // If we recently delisted this FID (within 3 min) but chain hasn't confirmed yet,
        // keep the local override so UI doesn't flash back to "listing active"
        const delistKey = `fidcaster_delist_${fid}`;
        const delistTs = parseInt(sessionStorage.getItem(delistKey) || "0");
        if (delistTs > 0 && Date.now() - delistTs < 180_000 && d.listing?.active && myAddress && d.listing?.seller?.toLowerCase() === myAddress.toLowerCase()) {
          d.listing.active = false;
          d.buyable = false;
        } else if (delistTs > 0 && (!d.listing?.active || Date.now() - delistTs > 180_000)) {
          sessionStorage.removeItem(delistKey);
        }
        setData(d);
      }
      if (infoRes.ok) setInfo(await infoRes.json());
    } catch (e) {
      console.error("[FidDetail] load error", e);
    } finally {
      setLoading(false);
    }
  }, [fid, myAddress]);

  useEffect(() => { load(); }, [load]);

  async function sendViaRelay(
    txData: { to: Address; data: `0x${string}`; value?: bigint }
  ): Promise<`0x${string}`> {
    const prepRes = await fetch("/api/fid-market/prepare-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        from: myAddress,
        to: txData.to,
        data: txData.data,
        value: txData.value?.toString(),
      }),
    });
    if (!prepRes.ok) {
      const e = await prepRes.json().catch(() => ({}));
      throw new Error(e.error || "Failed to prepare transaction");
    }
    const prep = await prepRes.json();

    const localAccount = walletClient!.account as LocalAccount;
    const signed = await localAccount.signTransaction({
      to: txData.to,
      data: txData.data,
      value: txData.value ?? BigInt(0),
      nonce: prep.nonce,
      maxFeePerGas: BigInt(prep.maxFeePerGas),
      maxPriorityFeePerGas: BigInt(prep.maxPriorityFeePerGas),
      gas: BigInt(prep.gas),
      chainId: optimism.id,
      type: "eip1559",
    });

    const relayRes = await fetch("/api/fid-market/relay-tx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rawTx: signed }),
    });
    if (!relayRes.ok) {
      const e = await relayRes.json().catch(() => ({}));
      throw new Error(e.error || "Failed to relay transaction");
    }
    const relay = await relayRes.json();
    return relay.txHash as `0x${string}`;
  }

  async function sendDirect(
    txData: { to: Address; data: `0x${string}`; value?: bigint }
  ): Promise<`0x${string}`> {
    if (!walletClient || !myAddress) throw new Error("No wallet connected.");
    // Use the client's BOUND account object, not a raw address string. For mnemonic auth
    // this is a LocalAccount that signs locally (eth_sendRawTransaction). Passing a string
    // would force a json-rpc account → eth_sendTransaction on a public RPC that has no key.
    return walletClient.sendTransaction({
      account: walletClient.account ?? myAddress,
      to: txData.to,
      data: txData.data,
      value: txData.value ?? BigInt(0),
      chain: optimism,
    });
  }

  function askConfirm(opts: { action: "buy" | "list" | "delist"; label: string; detail: string; onConfirm: () => void }) {
    setConfirmPending(opts);
  }

  async function executeBuy() {
    // wallet-auth uses WalletContext directly; mnemonic and farcaster auth need extWallet.
    const canBuy = authMethod === "wallet" ? (!!walletClient && !!myAddress) : !!extWallet;
    if (!canBuy || !data?.listing.active || !data.listing.seller) return;
    const buyerWc = authMethod === "wallet" ? walletClient : extWallet?.walletClient;
    const buyerAddr = (authMethod === "wallet" ? myAddress : extWallet?.address) as Address | undefined;
    if (!buyerWc || !buyerAddr) return;

    setBuyPhase("signing");
    try {
      const buyerAddress = buyerAddr;
      // Bound account object: LocalAccount (signs locally) for mnemonic, json-rpc account for injected.
      const signAccount = buyerWc.account ?? buyerAddress;
      const nonce = await fetchAddressNonce(buyerAddress);
      const toDeadline = BigInt(Math.floor(Date.now() / 1000) + 86400);

      const toSig = await buyerWc.signTypedData({
        account: signAccount,
        domain: ID_REGISTRY_EIP712_DOMAIN,
        types: TRANSFER_TYPES,
        primaryType: "Transfer",
        message: { fid: BigInt(fid), to: buyerAddress, nonce, deadline: toDeadline },
      });

      setBuyPhase("sending");
      const priceWei = BigInt(data.listing.priceWei || "0");
      const feePaid = priceWei + (priceWei * BigInt(FEE_BPS)) / BigInt(10000);

      const txHash = await buyerWc.sendTransaction({
        account: signAccount,
        to: FID_MARKET_ADDRESS,
        value: feePaid,
        data: encodeFunctionData({
          abi: fidMarketAbi,
          functionName: "buy",
          args: [BigInt(fid), data.listing.seller as Address, toDeadline, toSig],
        }),
        chain: optimism,
      });

      setBuyTxHash(txHash as string);
      setBuyPhase("confirming");
      await waitForReceipt(txHash as string);
      setBuyPhase("done");
      setTimeout(() => load(), 5000);
    } catch (err: any) {
      setBuyPhase({ error: err.message || "Transaction failed" });
    }
  }

  async function executeList() {
    const listWC = effectiveWC;
    const listAddr = effectiveAddr;
    if (!listWC || !listAddr || !data) return;
    if (!sellPriceEth || isNaN(parseFloat(sellPriceEth))) return;
    setSellPhase("signing");
    try {
      // Seller's nonce from IdRegistry (used in the EIP-712 Transfer sig)
      const nonce = await fetchAddressNonce(listAddr);
      // durationSecs must be in [600, 2592000] (10 min – 30 days)
      const durationSecs = BigInt(durationDays * 86400);
      const fromDeadline = BigInt(Math.floor(Date.now() / 1000)) + durationSecs;
      // sellPriceEth = buyer pays total; seller receives = buyerPays / 1.09
      const sellerReceivesEth = (parseFloat(sellPriceEth) / 1.09).toFixed(18);
      const priceWei = parseEther(sellerReceivesEth as `${number}`);

      // mnemonic: LocalAccount has the private key; MetaMask/extWallet: use address string
      const sigAccount = authMethod === "mnemonic"
        ? listWC.account as LocalAccount
        : listAddr as Address;

      // Sign Transfer: seller authorises FID Market to receive the FID via IdRegistry.transferFor()
      // The sig is stored in the listing and used at buy() time — NOT verified at list() time.
      const fromSig = await listWC.signTypedData({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        account: sigAccount as any,
        domain: ID_REGISTRY_EIP712_DOMAIN,
        types: TRANSFER_TYPES,
        primaryType: "Transfer",
        message: { fid: BigInt(fid), to: FID_MARKET_ADDRESS as Address, nonce, deadline: fromDeadline },
      });

      setSellPhase("sending");
      // list(fid, priceWei, durationSecs[600-2592000], fromDeadline[≤block.ts+duration], fromSig)
      const listData = encodeFunctionData({
        abi: fidMarketAbi,
        functionName: "list",
        args: [BigInt(fid), priceWei, durationSecs, fromDeadline, fromSig],
      });

      const SEND_TIMEOUT_MS = 90_000;
      function withTimeout<T>(p: Promise<T>): Promise<T> {
        return Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error("Wallet did not respond in 90 seconds. Please try again.")), SEND_TIMEOUT_MS)
          ),
        ]);
      }

      // For wallet-auth (MetaMask injected): explicitly switch to Optimism before sendTransaction.
      // mnemonic accounts use a LocalAccount with a public RPC — no chain switch needed.
      if (authMethod === "wallet") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _eth = (window as any)?.ethereum;
        if (_eth?.request) {
          try {
            await _eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa" }] });
          } catch (switchErr: any) {
            if (switchErr?.code === 4902) {
              await _eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0xa", chainName: "Optimism", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.optimism.io"], blockExplorerUrls: ["https://optimistic.etherscan.io"] }] });
            }
          }
        }
      }

      let txHash: `0x${string}`;
      if (isLocalWalletAuth) {
        txHash = await withTimeout(sendDirect({ to: FID_MARKET_ADDRESS, data: listData }));
      } else {
        txHash = await withTimeout(listWC.sendTransaction({
          account: listAddr,
          to: FID_MARKET_ADDRESS,
          data: listData,
          chain: optimism,
        }));
      }

      setSellTxHash(txHash);
      setSellPhase("confirming");
      await waitForReceipt(txHash);
      setSellPhase("done");
      // Notify the market indexer so it picks up the new listing immediately
      fetch("/api/fid-market/track-fid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fid: Number(fid) }),
      }).catch(() => {});
      setTimeout(() => load(), 5000);
    } catch (err: any) {
      setSellPhase({ error: err.message || "Transaction failed" });
    }
  }

  async function executeDelist() {
    const delistWC = effectiveWC;
    const delistAddr = effectiveAddr;
    if (!delistWC || !delistAddr) return;
    setSellPhase("delisting");
    try {
      const cancelData = encodeFunctionData({ abi: fidMarketAbi, functionName: "cancel", args: [BigInt(fid)] });

      if (authMethod === "wallet") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _eth = (window as any)?.ethereum;
        if (_eth?.request) {
          try {
            await _eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xa" }] });
          } catch (switchErr: any) {
            if (switchErr?.code === 4902) {
              await _eth.request({ method: "wallet_addEthereumChain", params: [{ chainId: "0xa", chainName: "Optimism", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: ["https://mainnet.optimism.io"], blockExplorerUrls: ["https://optimistic.etherscan.io"] }] });
            }
          }
        }
      }

      let txHash: `0x${string}`;
      if (isLocalWalletAuth) {
        txHash = await sendDirect({ to: FID_MARKET_ADDRESS, data: cancelData });
      } else {
        txHash = await delistWC.sendTransaction({
          account: delistAddr,
          to: FID_MARKET_ADDRESS,
          data: cancelData,
          chain: optimism,
        });
      }
      setSellTxHash(txHash);
      setSellPhase("delist_confirming");
      await waitForReceipt(txHash);
      setSellPhase("delist_done");
      // Persist delist flag (only after confirmed on-chain)
      sessionStorage.setItem(`fidcaster_delist_${fid}`, Date.now().toString());
      setData(prev => prev ? { ...prev, listing: { active: false }, buyable: false, sigExpired: false } : prev);
      setTimeout(() => load(), 6000);
    } catch (err: any) {
      setSellPhase({ error: err.message || "Transaction failed" });
    }
  }

  function handleBuy() {
    // wallet-auth uses WalletContext directly; others need extWallet
    const buyerAddr = authMethod === "wallet" ? myAddress : extWallet?.address;
    if (!buyerAddr || !data?.listing.priceWei) return;
    const priceWei = BigInt(data.listing.priceWei);
    const feePaid = priceWei + (priceWei * BigInt(FEE_BPS)) / BigInt(10000);
    const totalEth = parseFloat(formatEther(feePaid)).toFixed(5);
    askConfirm({
      action: "buy",
      label: `Buy FID ${fid}`,
      detail: `You will send ${totalEth} ETH from ${shortAddr(buyerAddr)} on Optimism. This cannot be undone.`,
      onConfirm: executeBuy,
    });
  }

  function handleList() {
    if (!sellPriceEth || isNaN(parseFloat(sellPriceEth))) return;
    const buyerEth = parseFloat(sellPriceEth);
    const receiveEth = buyerEth / 1.09;
    const buyerUsd = ethUsd ? ` ($${Math.round(buyerEth * ethUsd)})` : "";
    const receiveUsd = ethUsd ? ` ($${Math.round(receiveEth * ethUsd)})` : "";
    askConfirm({
      action: "list",
      label: `List FID ${fid} — buyer pays ${buyerEth.toFixed(4)} ETH${buyerUsd}`,
      detail: `You will receive ${receiveEth.toFixed(4)} ETH${receiveUsd} after the 9% platform fee. Listed for ${durationDays} days.`,
      onConfirm: executeList,
    });
  }

  function handleDelist() {
    askConfirm({
      action: "delist",
      label: `Remove listing for FID ${fid}`,
      detail: `Your FID will be delisted. You will pay a small gas fee on Optimism.`,
      onConfirm: executeDelist,
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground text-sm">Could not load FID {fid}.</p>
        <div className="flex items-center gap-3">
          <button
            onClick={() => load()}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
          <button onClick={() => window.history.back()} className="text-primary text-sm hover:underline">Go back</button>
        </div>
      </div>
    );
  }

  const priceEth = data.listing.priceWei
    ? parseFloat(formatEther(BigInt(data.listing.priceWei))).toFixed(4)
    : null;
  const usdVal = priceEth && ethUsd ? (parseFloat(priceEth) * ethUsd).toFixed(0) : null;

  // effectiveAddr covers wallet-auth (myAddress) and farcaster-auth (extWallet.address)
  const effectiveIsOwner = !!(effectiveAddr && data.owner
    && effectiveAddr.toLowerCase() === data.owner.toLowerCase());
  const effectiveIsSeller = !!(effectiveAddr && data.listing.seller
    && effectiveAddr.toLowerCase() === data.listing.seller.toLowerCase());

  const isMyFid = myFid !== null && Number(myFid) === fid;

  const statusInfo = data.listing.active
    ? data.buyable
      ? { text: "Available", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" }
      : data.sigExpired
        ? { text: "Sig Expired", cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" }
        : { text: "Expired", cls: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20" }
    : { text: "Not Listed", cls: "bg-muted text-muted-foreground border-border" };

  return (
    <div className="min-h-screen bg-background pb-28 md:pb-0">
      {/* ── Confirmation Dialog ── */}
      {confirmPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setConfirmPending(null)} />
          <div className="relative w-full max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
              </div>
              <div>
                <p className="font-bold text-foreground text-[0.9375rem]">{confirmPending.label}</p>
                <p className="text-sm text-muted-foreground mt-0.5 leading-snug">{confirmPending.detail}</p>
              </div>
            </div>
            <div className="flex gap-2.5 pt-1">
              <button
                onClick={() => setConfirmPending(null)}
                className="flex-1 py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { const fn = confirmPending.onConfirm; setConfirmPending(null); fn(); }}
                className={cn(
                  "flex-1 py-2.5 rounded-xl text-sm font-semibold transition-colors",
                  confirmPending.action === "delist"
                    ? "bg-destructive/90 hover:bg-destructive text-white"
                    : "bg-primary hover:bg-primary/90 text-white"
                )}
              >
                {confirmPending.action === "buy" ? "Confirm Buy" : confirmPending.action === "list" ? "Confirm List" : "Remove Listing"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/96 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto h-14 flex items-center gap-3 px-4">
          <button
            onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/market"); }}
            className="p-2 -ml-1 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span className="cursor-pointer hover:text-foreground" onClick={() => { if (window.history.length > 1) window.history.back(); else navigate("/market"); }}>FID Market</span>
            <ChevronLeft className="w-3.5 h-3.5 rotate-180" />
            <span className="text-foreground font-medium">FID {fid}</span>
          </div>
          <div className="ml-auto">
            <button
              onClick={load}
              className="p-2 rounded-xl text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 pt-5 space-y-4">
        {/* FID Card */}
        <div className="rounded-2xl border border-border/60 bg-card overflow-hidden">
          <div className="h-32 bg-gradient-to-br from-primary/10 via-violet-500/5 to-background flex items-center justify-center relative">
            {info?.pfpUrl ? (
              <img src={info.pfpUrl} alt="" className="w-20 h-20 rounded-2xl object-cover shadow-xl ring-2 ring-border/40" />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-violet-500/20 border border-border/40 flex items-center justify-center">
                <span className="text-3xl font-black text-primary font-mono">{fid}</span>
              </div>
            )}
            <span className={cn("absolute top-3 right-3 text-xs px-2.5 py-1 rounded-full border font-medium", statusInfo.cls)}>
              {statusInfo.text}
            </span>
            {isMyFid && (
              <span className="absolute top-3 left-3 text-xs px-2.5 py-1 rounded-full border font-medium bg-primary/10 text-primary border-primary/20">
                Your FID
              </span>
            )}
          </div>

          <div className="p-5 space-y-4">
            <div>
              <h1 className="text-2xl font-black text-foreground">
                {info?.displayName || `FID ${fid}`}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {info?.username && <span className="text-primary text-sm">@{info.username}</span>}
                <span className="text-muted-foreground text-xs font-mono">FID #{fid}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Owner:</span>
              <span className="font-mono">{shortAddr(data.owner)}</span>
              <CopyButton text={data.owner} />
              <a
                href={`https://optimistic.etherscan.io/address/${data.owner}`}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-primary transition-colors"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {data.listing.active && priceEth && (() => {
              const totalEth = (parseFloat(priceEth) * 1.09).toFixed(4);
              const totalUsd = ethUsd ? Math.round(parseFloat(priceEth) * 1.09 * ethUsd) : null;
              return (
                <div className="rounded-xl border border-border/40 bg-muted/20 p-4">
                  <p className="text-xs text-muted-foreground mb-1">{effectiveIsSeller ? "Listed price" : "You pay"}</p>
                  <p className="text-2xl font-black text-foreground font-mono">
                    {effectiveIsSeller ? priceEth : totalEth} <span className="text-sm font-normal text-muted-foreground">ETH</span>
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {effectiveIsSeller
                      ? (usdVal ? `$${usdVal}` : "")
                      : `${totalUsd ? `$${totalUsd} · ` : ""}incl. 9% fee`}
                  </p>
                </div>
              );
            })()}

            {data.listing.active && (
              <div className="rounded-xl border border-border/40 bg-muted/10 divide-y divide-border/40">
                {(() => {
                  const deadline = formatTimeLeft(data.listing.fromDeadline ?? 0);
                  return (
                    <>
                      <div className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                        <span className="text-muted-foreground">Listed</span>
                        <span className="font-medium text-foreground">
                          {data.listing.listedAt ? formatTimeAgo(data.listing.listedAt) : "·"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                        <span className="text-muted-foreground">Sig expires</span>
                        <span className={cn("font-medium", deadline.expired ? "text-destructive" : "text-foreground")}>
                          {data.listing.fromDeadline
                            ? new Date(data.listing.fromDeadline * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) + ` (${deadline.text})`
                            : "·"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                        <span className="text-muted-foreground">Duration</span>
                        <span className="font-medium text-foreground">30 days</span>
                      </div>
                      {data.listing.seller && (
                        <div className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                          <span className="text-muted-foreground">Seller</span>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-foreground">{shortAddr(data.listing.seller)}</span>
                            <CopyButton text={data.listing.seller} />
                            <a
                              href={`https://optimistic.etherscan.io/address/${data.listing.seller}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-muted-foreground hover:text-primary transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        </div>
                      )}
                      <div className="flex items-center justify-between px-3.5 py-2.5 text-xs">
                        <span className="text-muted-foreground">Contract</span>
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-foreground">{shortAddr(FID_MARKET_ADDRESS)}</span>
                          <a
                            href={`https://optimistic.etherscan.io/address/${FID_MARKET_ADDRESS}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary transition-colors"
                          >
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>
            )}
          </div>
        </div>

        {/* Trading panel */}
        <div className="rounded-2xl border border-border/60 bg-card p-5 space-y-4">
          {!isLocalWalletAuth && isMyFid && !effectiveIsOwner && !effectiveIsSeller ? (
            /* Farcaster-auth user: owns this FID by FID match but needs a custody wallet for on-chain actions */
            <div className="py-4 text-center space-y-3">
              <Wallet className="w-8 h-8 text-muted-foreground/40 mx-auto" />
              <p className="text-sm font-medium text-foreground">This is your FID</p>
              <p className="text-xs text-muted-foreground">
                {data.listing.active
                  ? "Connect your custody wallet to manage or remove this listing."
                  : "Connect your custody wallet to list this FID for sale."}
              </p>
              <div className="flex flex-col gap-2 items-center">
                <button
                  onClick={connectMetaMask}
                  disabled={connectingExt}
                  className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  {connectingExt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                  Connect MetaMask
                </button>
                <button
                  onClick={connectWalletConnect}
                  disabled={connectingExt}
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors disabled:opacity-40"
                >
                  {connectingExt ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                  WalletConnect
                </button>
              </div>
            </div>
          ) : effectiveIsOwner && !data.listing.active ? (
            !effectiveWC ? (
              <div className="py-4 text-center space-y-3">
                <LogIn className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm font-medium text-foreground">Sign in to sell this FID</p>
                <p className="text-xs text-muted-foreground">Import your seed phrase in FidCaster to list this FID for sale.</p>
                <button onClick={() => navigate("/")} className="mx-auto flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                  <LogIn className="w-4 h-4" />Sign in
                </button>
              </div>
            ) : (
            /* List for sale */
            <div className="space-y-3">
              {/* Listing removed success banner */}
              {sellPhase === "delist_done" ? (
                <div className="flex items-center gap-2 p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-sm text-emerald-400">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Listing removed</p>
                    <p className="text-xs text-emerald-400/70 mt-0.5">Your FID is no longer listed for sale.</p>
                  </div>
                  {sellTxHash && (
                    <a
                      href={`https://optimistic.etherscan.io/tx/${sellTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto flex items-center gap-1 hover:text-emerald-300 text-xs"
                    >
                      <ExternalLink className="w-3 h-3" />Tx
                    </a>
                  )}
                </div>
              ) : null}

              <p className="text-sm font-semibold text-foreground">List FID {fid} for sale</p>

              {/* ETH / USD toggle */}
              <div className="flex items-center gap-1 p-1 bg-muted/50 rounded-xl w-fit">
                <button
                  onClick={() => { setPriceMode("eth"); setSellPrice(""); }}
                  className={cn("px-3 py-1 rounded-lg text-xs font-semibold transition-colors", priceMode === "eth" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  ETH
                </button>
                <button
                  onClick={() => { setPriceMode("usd"); setSellPrice(""); }}
                  className={cn("px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1", priceMode === "usd" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                >
                  <DollarSign className="w-3 h-3" />USD
                </button>
              </div>

              {/* Quick USD presets (only in USD mode) */}
              {priceMode === "usd" && (
                <div className="flex gap-1.5 flex-wrap">
                  {[10, 25, 50, 100, 250, 500].map(amt => (
                    <button
                      key={amt}
                      onClick={() => setSellPrice(String(amt))}
                      className={cn("px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors", sellPrice === String(amt) ? "border-primary/50 bg-primary/10 text-primary" : "border-border/50 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border")}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              )}

              {/* Price input */}
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    {priceMode === "usd" && (
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground font-medium">$</span>
                    )}
                    <input
                      type="number"
                      value={sellPrice}
                      onChange={e => setSellPrice(e.target.value)}
                      placeholder={priceMode === "eth" ? "0.05" : "50"}
                      step={priceMode === "eth" ? "0.001" : "1"}
                      min={priceMode === "eth" ? "0.001" : "1"}
                      className={cn(
                        "w-full py-3 text-sm rounded-xl border border-border/60 bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono",
                        priceMode === "usd" ? "pl-7 pr-14" : "pl-3.5 pr-14"
                      )}
                    />
                    <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground bg-muted px-1.5 py-0.5 rounded-md">
                      {priceMode === "eth" ? "ETH" : "USD"}
                    </span>
                  </div>
                  <button
                    onClick={handleList}
                    disabled={!sellPriceEth || parseFloat(sellPriceEth) < 0.0001 || sellPhase === "signing" || sellPhase === "sending" || sellPhase === "confirming"}
                    className="px-5 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-40 flex items-center gap-2 whitespace-nowrap"
                  >
                    {(sellPhase === "signing" || sellPhase === "sending" || sellPhase === "confirming") && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {sellPhase === "signing" ? "Sign…" : sellPhase === "sending" ? "Sending…" : sellPhase === "confirming" ? "Confirming…" : "List for sale"}
                  </button>
                </div>

                {/* Price breakdown — sellPriceEth = buyer pays total */}
                {sellPriceEth && parseFloat(sellPriceEth) > 0 ? (() => {
                  const buyerPays = parseFloat(sellPriceEth);          // what user typed
                  const receiveEth = buyerPays / 1.09;                  // seller gets
                  const feeEth = buyerPays - receiveEth;                // platform cut
                  const buyerUsd = ethUsd ? Math.round(buyerPays * ethUsd) : null;
                  const feeUsd   = ethUsd ? Math.round(feeEth   * ethUsd) : null;
                  const recvUsd  = ethUsd ? Math.round(receiveEth * ethUsd) : null;
                  return (
                    <div className="rounded-xl border border-border/40 bg-muted/20 divide-y divide-border/30 text-xs">
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-muted-foreground">Buyer pays</span>
                        <span className="font-semibold text-foreground font-mono">
                          {buyerPays.toFixed(4)} ETH
                          {buyerUsd !== null && <span className="text-muted-foreground font-normal ml-1">(${buyerUsd})</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-muted-foreground">Platform fee <span className="text-[10px]">(9%)</span></span>
                        <span className="font-mono text-muted-foreground">
                          {feeEth.toFixed(4)} ETH
                          {feeUsd !== null && <span className="ml-1">(${feeUsd})</span>}
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-muted-foreground">You receive</span>
                        <span className="font-semibold text-foreground font-mono">
                          {receiveEth.toFixed(4)} ETH
                          {recvUsd !== null && <span className="text-muted-foreground font-normal ml-1">(${recvUsd})</span>}
                        </span>
                      </div>
                    </div>
                  );
                })() : (
                  <p className="text-xs text-muted-foreground px-1">
                    {priceMode === "usd" && !ethUsd ? "Loading ETH price…" : `Enter the total price the buyer will pay.`}
                  </p>
                )}
              </div>

              {/* Duration selector */}
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Listing duration</span>
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {[1, 3, 7, 14, 30].map(d => (
                    <button
                      key={d}
                      onClick={() => setDurationDays(d)}
                      className={cn("px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors", durationDays === d ? "border-primary/50 bg-primary/10 text-primary" : "border-border/50 bg-muted/30 text-muted-foreground hover:text-foreground hover:border-border")}
                    >
                      {d === 1 ? "1 day" : `${d} days`}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground/70 px-0.5">
                  Signature valid for {durationDays} {durationDays === 1 ? "day" : "days"} · anyone can buy within this window
                </p>
              </div>

              {sellPhase === "done" && (
                <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  FID listed successfully!
                  {sellTxHash && (
                    <a
                      href={`https://optimistic.etherscan.io/tx/${sellTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto flex items-center gap-1 hover:text-emerald-300"
                    >
                      <ExternalLink className="w-3 h-3" />Tx
                    </a>
                  )}
                </div>
              )}
              {typeof sellPhase === "object" && "error" in sellPhase && (
                <div className="flex items-start gap-2 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-xs text-destructive">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  {sellPhase.error}
                </div>
              )}
            </div>
            )
          ) : effectiveIsSeller ? (
            !effectiveWC ? (
              <div className="py-4 text-center space-y-3">
                <LogIn className="w-8 h-8 text-muted-foreground/40 mx-auto" />
                <p className="text-sm font-medium text-foreground">Sign in to manage this listing</p>
                <p className="text-xs text-muted-foreground">Import your seed phrase in FidCaster to remove this listing.</p>
                <button onClick={() => navigate("/")} className="mx-auto flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors">
                  <LogIn className="w-4 h-4" />Sign in
                </button>
              </div>
            ) : (
              /* Delist */
              <div className="space-y-3">
                <p className="text-sm font-semibold text-foreground">Your listing is active</p>
                <button
                  onClick={handleDelist}
                  disabled={sellPhase === "delisting" || sellPhase === "delist_confirming"}
                  className="w-full py-3 rounded-xl border border-destructive/20 text-destructive text-sm font-medium hover:bg-destructive/5 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                >
                  {(sellPhase === "delisting" || sellPhase === "delist_confirming") && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Remove Listing
                </button>
                {sellPhase === "done" && (
                  <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />Delisted successfully.
                  </div>
                )}
                {typeof sellPhase === "object" && "error" in sellPhase && (
                  <div className="flex items-start gap-2 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-xs text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{sellPhase.error}
                  </div>
                )}
              </div>
            )
          ) : data.buyable ? (
            /* Buy — wallet-auth uses WalletContext; others need an external wallet */
            <div className="space-y-3">
              {authMethod === "wallet" && myAddress ? (
                /* wallet-auth — buyer wallet already in WalletContext */
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-primary" />
                      Buying with
                    </div>
                    <span className="font-mono text-foreground">{shortAddr(myAddress)}</span>
                  </div>
                  <button
                    onClick={handleBuy}
                    disabled={buyPhase === "signing" || buyPhase === "sending" || buyPhase === "confirming" || data.paused}
                    className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {(buyPhase === "signing" || buyPhase === "sending" || buyPhase === "confirming") && <Loader2 className="w-4 h-4 animate-spin" />}
                    {buyPhase === "signing" ? "Sign transfer…" : buyPhase === "sending" ? "Sending…" : buyPhase === "confirming" ? "Confirming…" : "Buy FID"}
                  </button>
                  {buyPhase === "done" && (
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Purchase submitted!
                      {buyTxHash && (
                        <a href={`https://optimistic.etherscan.io/tx/${buyTxHash}`} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />Tx
                        </a>
                      )}
                    </div>
                  )}
                  {typeof buyPhase === "object" && "error" in buyPhase && (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-xs text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{buyPhase.error}
                    </div>
                  )}
                </div>
              ) : !extWallet ? (
                /* No connected wallet — prompt to connect */
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground leading-snug">
                    Connect an external wallet (MetaMask, Rainbow, etc.) to buy this FID on Optimism.
                  </p>
                  {!hasExtProvider ? (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-600">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      No browser wallet detected. Install MetaMask to continue.
                    </div>
                  ) : (
                    <button
                      onClick={connectExt}
                      disabled={connectingExt}
                      className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {connectingExt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                      {connectingExt ? "Connecting…" : "Connect Wallet to Buy"}
                    </button>
                  )}
                </div>
              ) : (
                /* extWallet connected — buy with it */
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-xs">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      Buying with
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-foreground">{shortAddr(extWallet.address)}</span>
                      <button onClick={disconnectExt} className="text-muted-foreground hover:text-destructive transition-colors" title="Disconnect">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  {wrongExtChain && (
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-600">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      Switch to Optimism network in your wallet
                    </div>
                  )}
                  <button
                    onClick={handleBuy}
                    disabled={buyPhase === "signing" || buyPhase === "sending" || buyPhase === "confirming" || data.paused || wrongExtChain}
                    className="w-full py-3 rounded-xl bg-emerald-600 text-white font-semibold text-sm hover:bg-emerald-700 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {(buyPhase === "signing" || buyPhase === "sending" || buyPhase === "confirming") && <Loader2 className="w-4 h-4 animate-spin" />}
                    {buyPhase === "signing" ? "Sign transfer…" : buyPhase === "sending" ? "Sending…" : buyPhase === "confirming" ? "Confirming…" : "Buy FID"}
                  </button>
                  {buyPhase === "done" && (
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      Purchase submitted!
                      {buyTxHash && (
                        <a href={`https://optimistic.etherscan.io/tx/${buyTxHash}`} target="_blank" rel="noopener noreferrer" className="ml-auto flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" />Tx
                        </a>
                      )}
                    </div>
                  )}
                  {typeof buyPhase === "object" && "error" in buyPhase && (
                    <div className="flex items-start gap-2 p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-xs text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />{buyPhase.error}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center space-y-1">
              <Tag className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-sm font-medium text-muted-foreground">
                {data.listing.active
                  ? "Listing expired or signature invalid."
                  : "This FID is not listed for sale."}
              </p>
            </div>
          )}

          {/* Account info footer */}
          {myFid && myAddress && (
            <div className="pt-3 border-t border-border/40 flex items-center justify-between text-xs text-muted-foreground">
              <span>FidCaster account</span>
              <span className="font-mono">{shortAddr(myAddress)}</span>
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="rounded-2xl border border-border/40 bg-muted/10 p-4 space-y-2 text-xs text-muted-foreground">
          <p className="font-medium text-foreground text-sm">About FID Market</p>
          <p>Selling uses your FidCaster wallet (Optimism). Buying uses an external wallet (MetaMask, etc.).</p>
          <p>Listings use an on-chain transfer signature. Purchases settle directly on Optimism with a 9% platform fee.</p>
          <a
            href={`https://optimistic.etherscan.io/address/${FID_MARKET_ADDRESS}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-primary hover:underline w-fit"
          >
            View contract <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
