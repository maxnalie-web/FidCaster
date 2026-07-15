import { create } from "zustand";
import type { WalletClient } from "viem";
import { isAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  deriveWalletAccount,
  generateWalletMnemonic,
  exportPrivateKeyHex,
  validateMnemonicWords,
  createOpWalletClient,
  createBaseWalletClient,
} from "@/lib/wallet";
import {
  saveWalletMnemonic,
  getWalletMnemonic,
  clearWalletMnemonic,
  saveWalletPrivateKey,
  getWalletPrivateKey,
  clearWalletPrivateKey,
} from "@/lib/walletSecureStore";

export type WalletKind = "seed" | "private-key" | "watch-only";

export interface WalletAccount {
  index: number;
  address: `0x${string}`;
  label: string;
}

export interface Wallet {
  id: string;
  kind: WalletKind;
  label: string;
  accounts: WalletAccount[];
  sourceFid?: number;
  color: string;
  emoji: string;
  backedUp?: boolean;
}

export const WALLET_COLORS = [
  "#ff6b9d", "#4c9aff", "#34d399", "#fb923c",
  "#a78bfa", "#f472b6", "#22c1c3", "#fbbf24",
];
export const WALLET_EMOJIS = [
  "🐷", "🌍", "🐉", "🦄", "🦊", "🐸", "🌵", "🍊",
  "🐱", "🐼", "🦁", "🐙",
];

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

const WALLETS_KEY = "ws_wallets";
const ACTIVE_ID_KEY = "ws_active_id";
const ACTIVE_IDX_KEY = "ws_active_idx";

function persistMeta(wallets: Wallet[], activeId: string | null, activeIdx: number) {
  try {
    localStorage.setItem(WALLETS_KEY, JSON.stringify(wallets));
    localStorage.setItem(ACTIVE_ID_KEY, JSON.stringify(activeId));
    localStorage.setItem(ACTIVE_IDX_KEY, JSON.stringify(activeIdx));
  } catch { /* quota */ }
}

function loadMeta<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch { return fallback; }
}

function genWalletId(): string {
  return `wallet_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function findAccount(wallet: Wallet | undefined, index: number): WalletAccount | undefined {
  return wallet?.accounts.find(a => a.index === index);
}

interface WalletState {
  wallets: Wallet[];
  activeWalletId: string | null;
  activeAccountIndex: number;

  hydrate: () => void;
  beginWalletCreation: () => Promise<{ walletId: string; mnemonic: string; address: `0x${string}` }>;
  finalizeWalletCreation: (walletId: string, address: `0x${string}`, label?: string) => void;
  discardPendingWallet: (walletId: string) => Promise<void>;
  importSeedWallet: (mnemonic: string, label?: string) => Promise<string>;
  importPrivateKeyWallet: (privateKeyHex: string, label?: string) => Promise<string>;
  addWatchOnlyWallet: (address: `0x${string}`, label?: string) => string;
  addAccountToWallet: (walletId: string) => Promise<void>;
  renameWallet: (walletId: string, label: string) => void;
  renameAccount: (walletId: string, index: number, label: string) => void;
  reorderAccounts: (walletId: string, fromIndex: number, toIndex: number) => void;
  markWalletBackedUp: (walletId: string) => void;
  removeWallet: (walletId: string) => Promise<void>;
  setActiveWallet: (walletId: string, accountIndex?: number) => void;
  revealMnemonic: (walletId: string) => Promise<string>;
  revealPrivateKey: (walletId: string, accountIndex: number) => Promise<string>;
  getActiveWalletClient: () => Promise<{ walletClient: WalletClient; baseWalletClient: WalletClient } | null>;
  linkFarcasterSeed: (fid: number, mnemonic: string, label: string) => Promise<string>;

  activeWallet: () => Wallet | undefined;
  activeAccount: () => WalletAccount | undefined;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  wallets: [],
  activeWalletId: null,
  activeAccountIndex: 0,

  activeWallet: () => {
    const { wallets, activeWalletId } = get();
    return wallets.find(w => w.id === activeWalletId);
  },

  activeAccount: () => {
    const { activeAccountIndex } = get();
    const wallet = get().activeWallet();
    return findAccount(wallet, activeAccountIndex) ?? wallet?.accounts[0];
  },

  hydrate: () => {
    const raw = loadMeta<Wallet[]>(WALLETS_KEY, []);
    let needsPersist = false;
    const wallets = raw.map(w => {
      const color = w.color ?? pickRandom(WALLET_COLORS);
      const emoji = w.emoji ?? pickRandom(WALLET_EMOJIS);
      if (!w.color || !w.emoji) needsPersist = true;
      return { ...w, color, emoji, backedUp: w.backedUp ?? true };
    });
    const activeWalletId = loadMeta<string | null>(ACTIVE_ID_KEY, null);
    const activeAccountIndex = loadMeta<number>(ACTIVE_IDX_KEY, 0);
    if (needsPersist) persistMeta(wallets, activeWalletId, activeAccountIndex);
    set({ wallets, activeWalletId, activeAccountIndex });
  },

  beginWalletCreation: async () => {
    const walletId = genWalletId();
    const mnemonic = generateWalletMnemonic();
    const { address } = await deriveWalletAccount(mnemonic, 0);
    await saveWalletMnemonic(walletId, mnemonic);
    return { walletId, mnemonic, address };
  },

  finalizeWalletCreation: (walletId, address, label) => {
    const wallet: Wallet = {
      id: walletId,
      kind: "seed",
      label: label?.trim() || "My Wallet",
      accounts: [{ index: 0, address, label: "Account 1" }],
      color: pickRandom(WALLET_COLORS),
      emoji: pickRandom(WALLET_EMOJIS),
      backedUp: true,
    };
    const wallets = [...get().wallets, wallet];
    persistMeta(wallets, walletId, 0);
    set({ wallets, activeWalletId: walletId, activeAccountIndex: 0 });
  },

  discardPendingWallet: async walletId => {
    await clearWalletMnemonic(walletId);
  },

  importSeedWallet: async (mnemonic, label) => {
    const phrase = mnemonic.trim().toLowerCase();
    const words = phrase.split(/\s+/);
    if (!validateMnemonicWords(words)) {
      throw new Error("Invalid recovery phrase. Please check all 12 (or 24) words.");
    }
    const { address } = await deriveWalletAccount(phrase, 0);
    // Deduplicate: if a wallet with this address already exists, return its id
    const existing = get().wallets.find(w =>
      w.accounts.some(a => a.address.toLowerCase() === address.toLowerCase())
    );
    if (existing) return existing.id;
    const walletId = genWalletId();
    await saveWalletMnemonic(walletId, phrase);
    const wallet: Wallet = {
      id: walletId,
      kind: "seed",
      label: label?.trim() || "Imported Wallet",
      accounts: [{ index: 0, address, label: "Account 1" }],
      color: pickRandom(WALLET_COLORS),
      emoji: pickRandom(WALLET_EMOJIS),
      backedUp: true,
    };
    const wallets = [...get().wallets, wallet];
    persistMeta(wallets, walletId, 0);
    set({ wallets, activeWalletId: walletId, activeAccountIndex: 0 });
    return walletId;
  },

  importPrivateKeyWallet: async (privateKeyHex, label) => {
    const hex = privateKeyHex.trim();
    if (!isHex(hex) || hex.length !== 66) {
      throw new Error("Invalid private key. Expected a 0x-prefixed 32-byte hex string.");
    }
    const account = privateKeyToAccount(hex as `0x${string}`);
    const walletId = genWalletId();
    await saveWalletPrivateKey(walletId, hex);
    const wallet: Wallet = {
      id: walletId,
      kind: "private-key",
      label: label?.trim() || "Imported Key",
      accounts: [{ index: 0, address: account.address, label: "Account 1" }],
      color: pickRandom(WALLET_COLORS),
      emoji: pickRandom(WALLET_EMOJIS),
      backedUp: true,
    };
    const wallets = [...get().wallets, wallet];
    persistMeta(wallets, walletId, 0);
    set({ wallets, activeWalletId: walletId, activeAccountIndex: 0 });
    return walletId;
  },

  addWatchOnlyWallet: (address, label) => {
    if (!isAddress(address)) throw new Error("Invalid Ethereum address.");
    const walletId = genWalletId();
    const wallet: Wallet = {
      id: walletId,
      kind: "watch-only",
      label: label?.trim() || `Watch ${address.slice(0, 6)}…${address.slice(-4)}`,
      accounts: [{ index: 0, address, label: "Account 1" }],
      color: pickRandom(WALLET_COLORS),
      emoji: pickRandom(WALLET_EMOJIS),
      backedUp: true,
    };
    const wallets = [...get().wallets, wallet];
    persistMeta(wallets, walletId, 0);
    set({ wallets, activeWalletId: walletId, activeAccountIndex: 0 });
    return walletId;
  },

  addAccountToWallet: async walletId => {
    const { wallets } = get();
    const wallet = wallets.find(w => w.id === walletId);
    if (!wallet) throw new Error("Wallet not found.");
    if (wallet.kind !== "seed") throw new Error("Only seed wallets support multiple accounts.");
    const mnemonic = await getWalletMnemonic(walletId);
    if (!mnemonic) throw new Error("Wallet secret not found.");
    const nextIndex = Math.max(...wallet.accounts.map(a => a.index)) + 1;
    const { address } = await deriveWalletAccount(mnemonic, nextIndex);
    const nextAccounts = [...wallet.accounts, { index: nextIndex, address, label: `Account ${nextIndex + 1}` }];
    const nextWallets = wallets.map(w => w.id === walletId ? { ...w, accounts: nextAccounts } : w);
    persistMeta(nextWallets, get().activeWalletId, get().activeAccountIndex);
    set({ wallets: nextWallets });
  },

  renameWallet: (walletId, label) => {
    const wallets = get().wallets.map(w => w.id === walletId ? { ...w, label } : w);
    persistMeta(wallets, get().activeWalletId, get().activeAccountIndex);
    set({ wallets });
  },

  renameAccount: (walletId, index, label) => {
    const wallets = get().wallets.map(w =>
      w.id === walletId ? { ...w, accounts: w.accounts.map(a => a.index === index ? { ...a, label } : a) } : w
    );
    persistMeta(wallets, get().activeWalletId, get().activeAccountIndex);
    set({ wallets });
  },

  reorderAccounts: (walletId, fromIndex, toIndex) => {
    const wallets = get().wallets.map(w => {
      if (w.id !== walletId) return w;
      const accounts = [...w.accounts];
      const [moved] = accounts.splice(fromIndex, 1);
      if (!moved) return w;
      accounts.splice(toIndex, 0, moved);
      return { ...w, accounts };
    });
    persistMeta(wallets, get().activeWalletId, get().activeAccountIndex);
    set({ wallets });
  },

  markWalletBackedUp: walletId => {
    const wallets = get().wallets.map(w => w.id === walletId ? { ...w, backedUp: true } : w);
    persistMeta(wallets, get().activeWalletId, get().activeAccountIndex);
    set({ wallets });
  },

  removeWallet: async walletId => {
    const wallet = get().wallets.find(w => w.id === walletId);
    if (wallet?.sourceFid !== undefined) {
      throw new Error("This wallet is linked to your Farcaster account. Sign out to remove it.");
    }
    if (wallet?.kind === "seed") await clearWalletMnemonic(walletId);
    if (wallet?.kind === "private-key") await clearWalletPrivateKey(walletId);
    const wallets = get().wallets.filter(w => w.id !== walletId);
    const wasActive = get().activeWalletId === walletId;
    const nextActiveId = wasActive ? (wallets[0]?.id ?? null) : get().activeWalletId;
    const nextActiveIdx = wasActive ? 0 : get().activeAccountIndex;
    persistMeta(wallets, nextActiveId, nextActiveIdx);
    set({ wallets, activeWalletId: nextActiveId, activeAccountIndex: nextActiveIdx });
  },

  setActiveWallet: (walletId, accountIndex = 0) => {
    persistMeta(get().wallets, walletId, accountIndex);
    set({ activeWalletId: walletId, activeAccountIndex: accountIndex });
  },

  revealMnemonic: async walletId => {
    const wallet = get().wallets.find(w => w.id === walletId);
    if (!wallet || wallet.kind !== "seed") throw new Error("This wallet has no recovery phrase.");
    const mnemonic = await getWalletMnemonic(walletId);
    if (!mnemonic) throw new Error("Wallet secret not found.");
    return mnemonic;
  },

  revealPrivateKey: async (walletId, accountIndex) => {
    const wallet = get().wallets.find(w => w.id === walletId);
    if (!wallet) throw new Error("Wallet not found.");
    if (wallet.kind === "watch-only") throw new Error("Watch-only wallets have no private key.");
    if (wallet.kind === "private-key") {
      const hex = await getWalletPrivateKey(walletId);
      if (!hex) throw new Error("Wallet secret not found.");
      return hex;
    }
    const mnemonic = await getWalletMnemonic(walletId);
    if (!mnemonic) throw new Error("Wallet secret not found.");
    return exportPrivateKeyHex(mnemonic, accountIndex);
  },

  getActiveWalletClient: async () => {
    const { wallets, activeWalletId, activeAccountIndex } = get();
    const wallet = wallets.find(w => w.id === activeWalletId);
    if (!wallet) return null;
    if (wallet.kind === "watch-only") return null;
    const account = findAccount(wallet, activeAccountIndex) ?? wallet.accounts[0];
    if (!account) return null;

    if (wallet.kind === "private-key") {
      const hex = await getWalletPrivateKey(wallet.id);
      if (!hex) throw new Error("Wallet secret not found.");
      const acc = privateKeyToAccount(hex as `0x${string}`);
      return {
        walletClient: createOpWalletClient(acc),
        baseWalletClient: createBaseWalletClient(acc),
      };
    }

    const mnemonic = await getWalletMnemonic(wallet.id);
    if (!mnemonic) throw new Error("Wallet secret not found.");
    return deriveWalletAccount(mnemonic, account.index);
  },

  linkFarcasterSeed: async (fid, mnemonic, label) => {
    const phrase = mnemonic.trim().toLowerCase();
    const { address } = await deriveWalletAccount(phrase, 0);
    const existing = get().wallets.find(w =>
      w.accounts.some(a => a.address.toLowerCase() === address.toLowerCase())
    );
    if (existing) {
      if (existing.sourceFid !== fid) {
        const wallets = get().wallets.map(w => w.id === existing.id ? { ...w, sourceFid: fid } : w);
        persistMeta(wallets, get().activeWalletId, get().activeAccountIndex);
        set({ wallets });
      }
      return existing.id;
    }
    const walletId = genWalletId();
    await saveWalletMnemonic(walletId, phrase);
    const wallet: Wallet = {
      id: walletId,
      kind: "seed",
      label,
      accounts: [{ index: 0, address, label: "Account 1" }],
      sourceFid: fid,
      color: pickRandom(WALLET_COLORS),
      emoji: pickRandom(WALLET_EMOJIS),
      backedUp: true,
    };
    const wallets = [...get().wallets, wallet];
    const currentActive = get().activeWalletId;
    persistMeta(wallets, currentActive ?? walletId, currentActive ? get().activeAccountIndex : 0);
    set({ wallets, activeWalletId: currentActive ?? walletId });
    return walletId;
  },
}));
