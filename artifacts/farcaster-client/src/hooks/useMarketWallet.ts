import { useState, useCallback, useEffect, useRef } from "react";
import { createWalletClient, custom, type WalletClient, type Address } from "viem";
import { optimism } from "viem/chains";
import { notifyWalletAccountChange } from "@/lib/wallet-events";

export interface MarketWallet {
  address: Address;
  walletClient: WalletClient;
}

type ProviderType = "injected" | "walletconnect";

let wcProvider: any = null;

async function getWCProvider() {
  if (wcProvider) return wcProvider;
  const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();
  // WalletConnect's relay + QR modal + wallet list require a real project id
  // (from cloud.reown.com). With an empty id the modal silently never loads,
  // which looks like "connect wallet is broken" even though the injected
  // (MetaMask/extension) path works fine. Fail loudly with a clear reason.
  if (!projectId) {
    throw new Error(
      "WalletConnect isn't configured. Set the WALLETCONNECT_PROJECT_ID environment variable (get a free id at cloud.reown.com) and rebuild. Browser-extension wallets still work in the meantime.",
    );
  }
  const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
  wcProvider = await EthereumProvider.init({
    projectId,
    // Optimism as a REQUIRED chain makes many wallets reject or silently
    // mis-negotiate the pairing (most wallet apps only guarantee mainnet) ·
    // the session then approves without eip155:10, and every subsequent
    // Optimism request fails with "Missing or invalid. request() chainId:
    // eip155:10". Making everything optional lets any wallet connect, and
    // the post-connect wallet_switchEthereumChain call below prompts it to
    // add/switch to Optimism afterward instead of requiring it upfront.
    chains: [],
    optionalChains: [optimism.id, 1],
    // Lets the provider serve Optimism read calls over this RPC even for
    // wallets that never approved eip155:10 in their session namespaces ·
    // further guards against the same "missing chainId" failure.
    rpcMap: { [optimism.id]: "https://mainnet.optimism.io" },
    showQrModal: true,
    metadata: {
      name: "FidCaster",
      description: "Farcaster FID Market on Optimism",
      url: window.location.origin,
      icons: [`${window.location.origin}/favicon.ico`],
    },
  });
  return wcProvider;
}

async function switchToOptimism(ethereum: any) {
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xa" }],
    });
  } catch (switchErr: any) {
    if (switchErr.code === 4902) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0xa",
          chainName: "Optimism",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://mainnet.optimism.io"],
          blockExplorerUrls: ["https://optimistic.etherscan.io"],
        }],
      });
    }
  }
}

export function useMarketWallet() {
  const [wallet, setWallet] = useState<MarketWallet | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const providerTypeRef = useRef<ProviderType | null>(null);

  // Restore WalletConnect session after page refresh · @walletconnect/
  // keyvaluestorage migrates ALL its actual session data into IndexedDB on
  // first use and deletes the localStorage copies once that's done (see its
  // source: a one-time migration keyed on "wc_storage_version"), so a
  // localStorage-based "does a session exist" check here always came back
  // empty after the very first connect — this unconditionally attempts
  // restoration instead; EthereumProvider.init() itself checks its real
  // (IndexedDB) storage and is a cheap no-op when there's nothing to restore.
  useEffect(() => {
    getWCProvider().then(async (provider) => {
      if (!provider.connected || !provider.accounts?.[0]) return;
      const addr = provider.accounts[0] as Address;
      const wc = createWalletClient({ account: addr, chain: optimism, transport: custom(provider) });
      setWallet({ address: addr, walletClient: wc });
      notifyWalletAccountChange(wc, addr); // re-hydrate WalletProvider session after refresh
      setChainId(provider.chainId);
      providerTypeRef.current = "walletconnect";
      provider.on("accountsChanged", (accs: string[]) => {
        if (!accs[0]) { setWallet(null); wcProvider = null; return; }
        const a = accs[0] as Address;
        const wc2 = createWalletClient({ account: a, chain: optimism, transport: custom(provider) });
        setWallet({ address: a, walletClient: wc2 });
      });
      provider.on("chainChanged", (cId: number) => setChainId(cId));
      provider.on("disconnect", () => { setWallet(null); wcProvider = null; });
    }).catch(() => {});
  }, []);

  // Auto-connect if injected wallet already has accounts
  useEffect(() => {
    const ethereum = (window as any)?.ethereum;
    if (!ethereum || wallet) return;
    ethereum.request({ method: "eth_accounts" }).then(async (accounts: string[]) => {
      if (!accounts[0]) return;
      const cId = await ethereum.request({ method: "eth_chainId" });
      let chainIdNum = parseInt(cId, 16);
      // Force Optimism network on auto-connect too
      if (chainIdNum !== optimism.id) {
        try {
          await switchToOptimism(ethereum);
          const cId2 = await ethereum.request({ method: "eth_chainId" });
          chainIdNum = parseInt(cId2, 16);
        } catch { /* user may dismiss · proceed anyway */ }
      }
      setChainId(chainIdNum);
      const wc = createWalletClient({
        account: accounts[0] as Address,
        chain: optimism,
        transport: custom(ethereum),
      });
      setWallet({ address: accounts[0] as Address, walletClient: wc });
      notifyWalletAccountChange(wc, accounts[0] as Address); // re-hydrate WalletProvider session after refresh
      providerTypeRef.current = "injected";
    }).catch(() => {});
  }, []);

  const _connectInjected = useCallback(async (ethereum: any) => {
    const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts[0]) throw new Error("No accounts returned");
    const cId = await ethereum.request({ method: "eth_chainId" });
    let chainIdNum = parseInt(cId, 16);
    if (chainIdNum !== optimism.id) {
      await switchToOptimism(ethereum);
      const cId2 = await ethereum.request({ method: "eth_chainId" });
      chainIdNum = parseInt(cId2, 16);
    }
    setChainId(chainIdNum);
    const wc = createWalletClient({
      account: accounts[0] as Address,
      chain: optimism,
      transport: custom(ethereum),
    });
    setWallet({ address: accounts[0] as Address, walletClient: wc });
    providerTypeRef.current = "injected";
  }, []);

  const _connectWalletConnect = useCallback(async () => {
    const provider = await getWCProvider();

    provider.on("accountsChanged", (accounts: string[]) => {
      if (!accounts[0]) { setWallet(null); return; }
      const newAddr = accounts[0] as Address;
      const wc = createWalletClient({
        account: newAddr,
        chain: optimism,
        transport: custom(provider),
      });
      setWallet({ address: newAddr, walletClient: wc });
      // Propagate WC account change into WalletProvider (if wallet-auth is active)
      notifyWalletAccountChange(wc, newAddr);
    });
    provider.on("chainChanged", (cId: number) => setChainId(cId));
    provider.on("disconnect", () => {
      setWallet(null);
      wcProvider = null;
    });

    await provider.connect();

    // On mobile, provider.accounts may be empty immediately after connect()
    // because deep-link return is async. Try eth_requestAccounts first,
    // then fall back to waiting up to 6 s for the accountsChanged event.
    let address: string | undefined = provider.accounts?.[0];
    if (!address) {
      try {
        const req: string[] = await provider.request({ method: "eth_requestAccounts" });
        address = req[0];
      } catch {}
    }
    if (!address) {
      address = await new Promise<string | undefined>((resolve) => {
        const timer = setTimeout(() => resolve(undefined), 6000);
        provider.once("accountsChanged", (accs: string[]) => {
          clearTimeout(timer);
          resolve(accs[0]);
        });
      });
    }
    if (!address) throw new Error("No accounts returned. Please try again.");

    if (provider.chainId !== optimism.id) {
      try {
        await provider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xa" }],
        });
      } catch {
        // some wallets don't support switching via WC · proceed anyway
      }
    }

    setChainId(provider.chainId);

    const wc = createWalletClient({
      account: address as Address,
      chain: optimism,
      transport: custom(provider),
    });
    setWallet({ address: address as Address, walletClient: wc });
    providerTypeRef.current = "walletconnect";
  }, []);

  /** Connect via injected wallet (MetaMask). Throws on error. */
  const connectMetaMask = useCallback(async () => {
    const ethereum = (window as any)?.ethereum;
    if (!ethereum) throw new Error("MetaMask not installed. Install it at metamask.io");
    setConnecting(true);
    setError(null);
    try {
      await _connectInjected(ethereum);
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      const cleaned = msg.toLowerCase().includes("user rejected") || msg.includes("4001")
        ? "Connection cancelled." : msg || "Connection failed";
      setError(cleaned);
      throw new Error(cleaned);
    } finally {
      setConnecting(false);
    }
  }, [_connectInjected]);

  /** Connect via WalletConnect (QR modal). Throws on error. */
  const connectWalletConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      await _connectWalletConnect();
    } catch (err: any) {
      const msg: string = err?.message ?? "";
      const cleaned = msg.toLowerCase().includes("user rejected") || msg.toLowerCase().includes("user closed")
        ? "Connection cancelled." : msg || "Connection failed";
      setError(cleaned);
      throw new Error(cleaned);
    } finally {
      setConnecting(false);
    }
  }, [_connectWalletConnect]);

  /** Auto-pick: MetaMask if available, else WalletConnect. */
  const connect = useCallback(async () => {
    const ethereum = (window as any)?.ethereum;
    if (ethereum) {
      await connectMetaMask();
    } else {
      await connectWalletConnect();
    }
  }, [connectMetaMask, connectWalletConnect]);

  const disconnect = useCallback(async () => {
    if (providerTypeRef.current === "walletconnect" && wcProvider) {
      await wcProvider.disconnect().catch(() => {});
      wcProvider = null;
    }
    setWallet(null);
    setError(null);
    providerTypeRef.current = null;
  }, []);

  // Listen to injected wallet events
  useEffect(() => {
    const ethereum = (window as any)?.ethereum;
    if (!ethereum) return;
    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setWallet(null);
      } else if (wallet && accounts[0].toLowerCase() !== wallet.address.toLowerCase()) {
        const wc = createWalletClient({
          account: accounts[0] as Address,
          chain: optimism,
          transport: custom(ethereum),
        });
        setWallet({ address: accounts[0] as Address, walletClient: wc });
      }
    };
    const handleChainChanged = (cId: string) => setChainId(parseInt(cId, 16));
    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [wallet]);

  const wrongChain = chainId !== null && chainId !== optimism.id;
  const hasInjected = !!(window as any)?.ethereum;

  return {
    wallet,
    connecting,
    error,
    connect,
    connectMetaMask,
    connectWalletConnect,
    disconnect,
    hasProvider: true,
    hasInjected,
    wrongChain,
    chainId,
  };
}
