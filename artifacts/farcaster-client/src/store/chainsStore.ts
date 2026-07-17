// Wallet parity item: the native app lets a user view its supported EVM
// chains and add a custom one by RPC URL/chainId (NetworksScreen.tsx /
// AddNetworkScreen.tsx, backed by state/chainsStore.ts) -- the web app had
// no equivalent. Ported the same store shape; same as native, this is a
// display-and-NFT-fetch chain list (NftGallery), not wired into
// Send/Swap/Browser, which stay on their own fixed chain sets there too.
import { create } from "zustand";

export interface EvmChain {
  id: number; // chain id
  name: string;
  rpcUrl: string;
  nativeSymbol: string;
  explorerTxBase: string; // e.g. 'https://optimistic.etherscan.io/tx/'
  blockscoutHost?: string; // e.g. 'optimism.blockscout.com'
  color: string;
  isCustom: boolean;
}

interface ChainsState {
  chains: EvmChain[]; // DEFAULT_CHAINS + any persisted custom chains, always includes defaults first
  favoriteChainIds: number[];
  hydrate: () => void;
  addCustomChain: (chain: Omit<EvmChain, "isCustom">) => void;
  removeCustomChain: (id: number) => void;
  toggleFavoriteChain: (id: number) => void;
}

const CUSTOM_CHAINS_KEY = "cs_customChains";
const FAVORITE_CHAINS_KEY = "cs_favoriteChainIds";

const DEFAULT_CHAINS: EvmChain[] = [
  {
    id: 10,
    name: "Optimism",
    rpcUrl: "https://mainnet.optimism.io",
    nativeSymbol: "ETH",
    explorerTxBase: "https://optimistic.etherscan.io/tx/",
    blockscoutHost: "optimism.blockscout.com",
    color: "#ff0420",
    isCustom: false,
  },
  {
    id: 8453,
    name: "Base",
    rpcUrl: "https://mainnet.base.org",
    nativeSymbol: "ETH",
    explorerTxBase: "https://basescan.org/tx/",
    blockscoutHost: "base.blockscout.com",
    color: "#0052ff",
    isCustom: false,
  },
  {
    id: 1,
    name: "Ethereum",
    rpcUrl: "https://ethereum-rpc.publicnode.com",
    nativeSymbol: "ETH",
    explorerTxBase: "https://etherscan.io/tx/",
    blockscoutHost: "eth.blockscout.com",
    color: "#627eea",
    isCustom: false,
  },
  {
    id: 137,
    name: "Polygon",
    rpcUrl: "https://polygon-bor-rpc.publicnode.com",
    nativeSymbol: "POL",
    explorerTxBase: "https://polygonscan.com/tx/",
    blockscoutHost: "polygon.blockscout.com",
    color: "#8247e5",
    isCustom: false,
  },
  {
    id: 42161,
    name: "Arbitrum",
    rpcUrl: "https://arbitrum-one-rpc.publicnode.com",
    nativeSymbol: "ETH",
    explorerTxBase: "https://arbiscan.io/tx/",
    blockscoutHost: "arbitrum.blockscout.com",
    color: "#28a0f0",
    isCustom: false,
  },
  {
    id: 7777777,
    name: "Zora",
    rpcUrl: "https://rpc.zora.energy",
    nativeSymbol: "ETH",
    explorerTxBase: "https://explorer.zora.energy/tx/",
    blockscoutHost: "explorer.zora.energy",
    color: "#000000",
    isCustom: false,
  },
];

function getJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function setJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export const useChainsStore = create<ChainsState>((set, get) => ({
  chains: DEFAULT_CHAINS,
  favoriteChainIds: [],

  hydrate: () => {
    const customChains = getJSON<EvmChain[]>(CUSTOM_CHAINS_KEY) ?? [];
    const favoriteChainIds = getJSON<number[]>(FAVORITE_CHAINS_KEY) ?? [];
    set({ chains: [...DEFAULT_CHAINS, ...customChains], favoriteChainIds });
  },

  toggleFavoriteChain: id => {
    const current = get().favoriteChainIds;
    const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
    setJSON(FAVORITE_CHAINS_KEY, next);
    set({ favoriteChainIds: next });
  },

  addCustomChain: chain => {
    const newChain: EvmChain = { ...chain, isCustom: true };
    const chains = [...get().chains, newChain];
    const customChains = chains.filter(c => c.isCustom);
    setJSON(CUSTOM_CHAINS_KEY, customChains);
    set({ chains });
  },

  removeCustomChain: id => {
    const chains = get().chains.filter(c => !(c.id === id && c.isCustom));
    const customChains = chains.filter(c => c.isCustom);
    setJSON(CUSTOM_CHAINS_KEY, customChains);
    set({ chains });
  },
}));
