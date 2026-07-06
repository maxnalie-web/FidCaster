import { createContext, useContext } from "react";
import type { FarcasterProfile } from "@/lib/farcaster-api";
import type { WalletClient } from "viem";
import type { LocalSigner } from "@/lib/wallet";
import type { AccountMeta, AuthMethod } from "@/lib/account-store";

export type WalletState = {
  address: `0x${string}` | null;
  fid: bigint | null;
  profile: FarcasterProfile | null;
  walletClient: WalletClient | null;
  localSigner: LocalSigner | null;
  signerUuid: string | null;
  signerApproved: boolean;
  autoSignerLoading: boolean;
  signerError: string | null;
  /** Non-error progress text shown while autoSignerLoading is true (e.g. "Confirming
   *  on Optimism… TX: 0x123"). Kept separate from signerError so a normal in-progress
   *  update never makes the setup popup render as if something failed. */
  signerStatus: string | null;
  neynarKey: string;
  isLoading: boolean;
  error: string | null;
  accounts: AccountMeta[];
  sessionPassword: string | null;
  hasStoredSession: boolean;
  isCheckingSession: boolean;
  /** True after an auto-lock (inactivity / tab hidden) · session keys zeroed but
   *  the encrypted vault remains, so the user sees the unlock screen, not landing. */
  isLocked: boolean;
  /** True when the user's FID has been transferred away (sold via FID Market) */
  fidSold: boolean;
  /** How the user authenticated: mnemonic phrase, external wallet, or Farcaster sign-in */
  authMethod: AuthMethod | null;
};

export type WalletContextType = WalletState & {
  login: (mnemonic: string, password: string) => Promise<void>;
  unlockWithPassword: (password: string) => Promise<void>;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  setSigner: (uuid: string) => void;
  setNeynarKey: (key: string) => void;
  addAccount: (mnemonic: string) => Promise<void>;
  switchAccount: (fid: number) => Promise<void>;
  removeAccount: (fid: number) => Promise<void>;
  retrySignerSetup: () => Promise<void>;
  /** Flow 2: connect an external wallet (MetaMask/WC), derive signer deterministically */
  loginWithWallet: (walletClient: WalletClient, address: `0x${string}`) => Promise<void>;
  /** Flow 3: SIWF · sign in with Farcaster relay (read-only; no signer unless passed) */
  loginWithFarcaster: (fid: number, profile: FarcasterProfile | null, localSigner: LocalSigner | null, signerUuid?: string | null) => Promise<void>;
};

export const WalletContext = createContext<WalletContextType | null>(null);

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}
