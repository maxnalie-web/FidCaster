import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { WalletContext, type WalletState } from "./useWallet";
import { deriveAccount, signerFromBytes, signerFromPrivateKeyHex, signerPrivateKeyHex, type LocalSigner } from "@/lib/wallet";
import { lookupFid, getSignerState, registerSignerOnchain, publicClient } from "@/lib/contracts";
import { fetchProfile } from "@/lib/farcaster-api";
import type { FarcasterProfile } from "@/lib/farcaster-api";
import { DEFAULT_API_KEY } from "@/lib/neynar";
import { hexToBytes, createWalletClient, custom } from "viem";
import type { WalletClient } from "viem";
import { optimism } from "viem/chains";
import { setWalletAccountChangeCallback } from "@/lib/wallet-events";
import {
  encryptAndStore,
  decryptStored,
  decryptStoredAuto,
  hasStoredSession,
  clearStoredSession,
  storeAccountMnemonic,
  loadAccountMnemonic,
  loadAccountMnemonicAuto,
  removeAccountMnemonic,
  storeLightSession,
  loadLightSession,
  clearLightSession,
} from "@/lib/session-crypto";
import {
  loadAccountsMeta,
  upsertAccountMeta,
  removeAccountFromStore,
  setActiveFid,
  getActiveFid,
  storeSignerPrivKey,
  loadSignerPrivKey,
  clearSignerPrivKey,
  getFailedAttempts,
  incFailedAttempts,
  clearFailedAttempts,
  type AccountMeta,
  type AuthMethod,
} from "@/lib/account-store";

const NEYNAR_KEY_STORAGE = "fc_neynar_key";
const SESSION_PWD_KEY = "fc_spwd";
const INACTIVITY_MS = 30 * 60 * 1000;
const HIDDEN_LOCK_MS = 5 * 60 * 1000;

function loadNeynarKey(): string {
  try { return localStorage.getItem(NEYNAR_KEY_STORAGE) ?? DEFAULT_API_KEY; } catch { return DEFAULT_API_KEY; }
}
function saveNeynarKey(key: string): void {
  try { localStorage.setItem(NEYNAR_KEY_STORAGE, key); } catch {}
}
function removeAccountFromStore2(fid: number): void {
  try { localStorage.removeItem(`fc_signer_${fid}`); } catch {}
}

function signerApprovedKey(fid: number): string { return `fc_signer_ok_${fid}`; }
function loadSignerApproved(fid: number): boolean {
  try { return localStorage.getItem(signerApprovedKey(fid)) === "1"; } catch { return false; }
}
function markSignerApproved(fid: number): void {
  try { localStorage.setItem(signerApprovedKey(fid), "1"); } catch {}
}
function clearSignerApproved(fid: number): void {
  try { localStorage.removeItem(signerApprovedKey(fid)); } catch {}
}

function fidCacheKey(addr: string): string { return `fc_fid_${addr.toLowerCase()}`; }
function loadCachedFid(addr: string): bigint | null {
  try { const v = localStorage.getItem(fidCacheKey(addr)); return v ? BigInt(v) : null; } catch { return null; }
}
function saveCachedFid(addr: string, fid: bigint): void {
  try { localStorage.setItem(fidCacheKey(addr), fid.toString()); } catch {}
}

// Wallet auth session · persists in sessionStorage so page refresh keeps the user logged in
// without requiring a new signMessage. Clears when the browser tab is closed.
const WALLET_SESSION_KEY = "fc_wlt_v1";

// SIWF (Sign In With Farcaster) session · persists in localStorage so refresh keeps user in.
// Contains only public profile data (no keys/secrets).
const SIWF_SESSION_KEY = "fc_siwf_v1";
function saveSiwfSession(fid: number, profile: FarcasterProfile | null): void {
  try { localStorage.setItem(SIWF_SESSION_KEY, JSON.stringify({ fid, profile })); } catch {}
}
function loadSiwfSession(): { fid: number; profile: FarcasterProfile | null } | null {
  try {
    const raw = localStorage.getItem(SIWF_SESSION_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d?.fid > 0 ? d : null;
  } catch { return null; }
}
function clearSiwfSession(): void {
  try { localStorage.removeItem(SIWF_SESSION_KEY); } catch {}
}
function clearWalletSession(): void {
  try { sessionStorage.removeItem(WALLET_SESSION_KEY); } catch {}
}

function savePwdToSession(pwd: string) {
  try { sessionStorage.setItem(SESSION_PWD_KEY, pwd); } catch {}
}
function loadPwdFromSession(): string | null {
  try { return sessionStorage.getItem(SESSION_PWD_KEY); } catch { return null; }
}
function clearPwdFromSession() {
  try { sessionStorage.removeItem(SESSION_PWD_KEY); } catch {}
}

/** Retry getSignerState up to 3 times with 1s backoff · Optimism RPC can be flaky. */
async function getSignerStateWithRetry(fid: bigint, pubKey: `0x${string}`): Promise<number> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await getSignerState(fid, pubKey);
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

function buildInitial(): WalletState {
  return {
    address: null, fid: null, profile: null, walletClient: null, localSigner: null,
    signerUuid: null, signerApproved: false, autoSignerLoading: false, signerError: null,
    neynarKey: loadNeynarKey(), isLoading: false, error: null,
    accounts: loadAccountsMeta(), sessionPassword: null,
    hasStoredSession: false, isCheckingSession: true,
    isLocked: false,
    fidSold: false, authMethod: null,
  };
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<WalletState>(buildInitial);
  const sessionPwdRef = useRef<string | null>(null);
  const neynarKeyRef = useRef<string>(loadNeynarKey());
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fidRef = useRef<bigint | null>(null);
  const addressRef = useRef<`0x${string}` | null>(null);
  const walletClientRef = useRef<WalletClient | null>(null);
  const localSignerRef = useRef<LocalSigner | null>(null);

  function _zeroAndLock() {
    if (localSignerRef.current) {
      localSignerRef.current.privateKey.fill(0);
      localSignerRef.current.publicKey.fill(0);
      localSignerRef.current = null;
    }
    fidRef.current = null;
    addressRef.current = null;
    walletClientRef.current = null;
    clearPwdFromSession();
    sessionPwdRef.current = null;
  }

  /**
   * Check on-chain signer state and register if needed.
   * If the signer was previously approved (localStorage cache), unblocks the UI
   * immediately and verifies in the background · so like/follow/cast work instantly
   * on return visits without waiting for RPC.
   */
  const _autoActivateSigner = useCallback(async (
    fid: bigint,
    address: `0x${string}`,
    wc: WalletClient,
    signer: LocalSigner,
  ) => {
    const fidNum = Number(fid);
    const cached = loadSignerApproved(fidNum);

      // Cache hit → unblock UI immediately; verify silently in background
      if (cached) {
        setState((s) => ({ ...s, fid, localSigner: signer, signerApproved: true, autoSignerLoading: false, signerError: null }));
      } else {
        setState((s) => ({ ...s, autoSignerLoading: true, signerError: null }));
      }

      let onChainState: number;
      try {
        onChainState = await getSignerStateWithRetry(fid, signer.publicKeyHex);
      } catch (rpcErr) {
        if (cached) {
          // Background check failed · keep cached approval, don't disrupt the user
          return;
        }
        const rpcMsg = rpcErr instanceof Error ? rpcErr.message : String(rpcErr);
        console.error("All RPC attempts failed for signer check:", rpcMsg);
        setState((s) => ({
          ...s,
          autoSignerLoading: false,
          signerError: `Could not verify signer on Optimism (RPC error). Check your internet connection and tap Retry.\n\nYour signer key: ${signer.publicKeyHex}`,
        }));
        return;
      }

      if (onChainState === 1) {
        if (!cached) markSignerApproved(fidNum);
        setState((s) => ({ ...s, fid, localSigner: signer, signerApproved: true, autoSignerLoading: false, signerError: null }));
        return;
      }

      // Signer was revoked/removed on-chain
      if (cached) clearSignerApproved(fidNum);
      // Revert the optimistic approval and show loading state for registration
      if (cached) {
        setState((s) => ({ ...s, signerApproved: false, autoSignerLoading: true }));
      }

      try {
        const txHash = await registerSignerOnchain(wc, fid, address, signer.publicKeyHex);
        setState((s) => ({
          ...s,
          signerError: `Registering signer on-chain... TX: ${txHash.slice(0, 12)}...`,
        }));
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
        if (receipt.status !== "success") {
          throw new Error(`Transaction reverted on-chain (status: ${receipt.status}). The signer could not be registered. TX: ${txHash}`);
        }
        const postState = await getSignerStateWithRetry(fid, signer.publicKeyHex).catch(() => 0);
        if (postState !== 1) {
          throw new Error(`Transaction confirmed but KeyRegistry still shows state=${postState}. Please retry.`);
        }
        markSignerApproved(fidNum);
        setState((s) => ({ ...s, fid, localSigner: signer, signerApproved: true, autoSignerLoading: false, signerError: null }));
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : String(e);
        console.error("Signer registration failed");
        let msg: string;
        if (raw.toLowerCase().includes("insufficient") || raw.toLowerCase().includes("gas") || raw.toLowerCase().includes("funds")) {
          msg = `Your signer key is not registered on Farcaster.\n\nTo fix this, you need a tiny amount of ETH on Optimism (< $0.01) for a one-time gas fee.\n\n• Go to the Wallet tab → Receive to get your address\n• Send ~0.001 ETH on Optimism to that address\n• Then come back here and tap Retry`;
        } else if (raw.toLowerCase().includes("user rejected") || raw.toLowerCase().includes("denied")) {
          msg = "Transaction cancelled. Tap Retry to try again.";
        } else if (raw.toLowerCase().includes("already") || raw.toLowerCase().includes("invalid key state")) {
          const recheckState = await getSignerStateWithRetry(fid, signer.publicKeyHex).catch(() => 0);
          if (recheckState === 1) {
            markSignerApproved(fidNum);
            setState((s) => ({ ...s, fid, localSigner: signer, signerApproved: true, autoSignerLoading: false, signerError: null }));
            return;
          }
          msg = `Your signer key is not registered on Farcaster.\n\nTo fix this, you need a tiny amount of ETH on Optimism (< $0.01) for a one-time gas fee.\n\n• Go to the Wallet tab → Receive to get your address\n• Send ~0.001 ETH on Optimism to that address\n• Then come back here and tap Retry`;
        } else {
          msg = `Signer registration failed. Tap Retry to try again.`;
        }
        setState((s) => ({ ...s, autoSignerLoading: false, signerError: msg }));
      }
  }, []);

  const _applyAccount = useCallback(async (mnemonic: string): Promise<number> => {
    const neynarKey = neynarKeyRef.current;
    const { address, walletClient, localSigner } = await deriveAccount(mnemonic);

    let fid: bigint = loadCachedFid(address) ?? 0n;
    let lastErr: unknown;
    if (fid === 0n) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          fid = await lookupFid(address);
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt));
        }
      }
      if (fid > 0n) saveCachedFid(address, fid);
    }

    if (fid === 0n && !lastErr) {
      const stored = loadAccountsMeta();
      const known = stored.find(
        (m) => m.address?.toLowerCase() === address.toLowerCase()
      );
      const knownFid = known ? BigInt(known.fid) : null;

      fidRef.current = knownFid;
      addressRef.current = address;
      walletClientRef.current = walletClient;
      localSignerRef.current = localSigner;

      const soldProfile = known ? {
        fid: known.fid,
        username: known.username,
        displayName: known.displayName,
        pfpUrl: known.pfpUrl,
        bio: "", followerCount: 0, followingCount: 0, custodyAddress: address,
      } : null;

      setState((s) => ({
        ...s,
        address, walletClient, localSigner,
        fid: knownFid,
        profile: soldProfile,
        signerUuid: null, signerApproved: false,
        isLoading: false, error: null,
        accounts: loadAccountsMeta(),
        neynarKey, fidSold: true, authMethod: "mnemonic",
      }));
      return known?.fid ?? 0;
    }

    if (fid === 0n && lastErr) throw lastErr;
    if (fid === 0n) throw new Error("No Farcaster ID found for this address. Make sure this is your Farcaster custody wallet seed phrase.");

    const profile = await fetchProfile(fid);
    const fidNum = Number(fid);

    const meta: AccountMeta = {
      fid: fidNum, address,
      username: profile?.username ?? `!${fidNum}`,
      displayName: profile?.displayName ?? `FID ${fidNum}`,
      pfpUrl: profile?.pfpUrl ?? "",
      signerUuid: null,
      authMethod: "mnemonic",
    };
    upsertAccountMeta(meta);
    setActiveFid(fidNum);

    // Store a light session so restore-on-refresh works even if IndexedDB CryptoKey is lost.
    storeLightSession({
      fid: fidNum,
      address,
      authMethod: "mnemonic",
      username: profile?.username ?? `!${fidNum}`,
      displayName: profile?.displayName ?? `FID ${fidNum}`,
      pfpUrl: profile?.pfpUrl ?? "",
      signerUuid: null,
    });

    fidRef.current = fid;
    addressRef.current = address;
    walletClientRef.current = walletClient;
    localSignerRef.current = localSigner;

    setState((s) => ({
      ...s,
      address, fid, profile, walletClient, localSigner,
      signerUuid: null, signerApproved: false,
      isLoading: false, error: null, isLocked: false,
      accounts: loadAccountsMeta(),
      neynarKey, fidSold: false, authMethod: "mnemonic",
    }));

    _autoActivateSigner(fid, address, walletClient, localSigner).catch((err) => {
      console.error("[WalletProvider] background signer activation failed:", err);
    });
    return fidNum;
  }, [_autoActivateSigner]);

  const retrySignerSetup = useCallback(async () => {
    const fid = fidRef.current;
    const address = addressRef.current;
    const signer = localSignerRef.current;
    if (!fid || !address || !signer) return;

    const wc = walletClientRef.current;
    if (!wc) {
      // After a session restore from sessionStorage, walletClient is null until the wallet
      // reconnects via the accountChange callback. Show a helpful message.
      setState((s) => ({
        ...s, signerError: "Wallet not reconnected yet. Please wait a moment or reconnect your wallet, then tap Retry.",
      }));
      return;
    }

    setState((s) => ({ ...s, signerError: null }));
    await _autoActivateSigner(fid, address, wc, signer);
  }, [_autoActivateSigner]);

  /**
   * Flow 2: Connect an external wallet (MetaMask / WalletConnect).
   * Looks up the FID for the connected address, then signs a deterministic
   * message to derive a stable Ed25519 signer key without exposing the seed phrase.
   */
  const loginWithWallet = useCallback(async (
    extWalletClient: WalletClient,
    extAddress: `0x${string}`,
  ) => {
    setState((s) => ({ ...s, isLoading: true, error: null, authMethod: null }));
    try {
      let fid: bigint = loadCachedFid(extAddress) ?? 0n;
      let lastErr: unknown;
      if (fid === 0n) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            fid = await lookupFid(extAddress);
            break;
          } catch (e) {
            lastErr = e;
            if (attempt < 3) await new Promise((r) => setTimeout(r, 1200 * attempt));
          }
        }
        if (fid > 0n) saveCachedFid(extAddress, fid);
      }
      if (fid === 0n && lastErr) throw lastErr;
      if (fid === 0n) throw new Error("No Farcaster ID found for this wallet address. Make sure this address is your Farcaster custody wallet.");

      const message = `farcaster-signer-v1:${extAddress.toLowerCase()}`;
      const rawSig = await extWalletClient.signMessage({ account: extAddress, message });
      const sigBytes = hexToBytes(rawSig);
      const localSigner = signerFromBytes(sigBytes);

      const profile = await fetchProfile(fid);
      const fidNum = Number(fid);

      // Persist the Ed25519 signer key so page refresh doesn't require re-signing.
      storeSignerPrivKey(fidNum, signerPrivateKeyHex(localSigner)).catch(() => {});

      const meta: AccountMeta = {
        fid: fidNum, address: extAddress,
        username: profile?.username ?? `!${fidNum}`,
        displayName: profile?.displayName ?? `FID ${fidNum}`,
        pfpUrl: profile?.pfpUrl ?? "",
        signerUuid: null,
        authMethod: "wallet",
      };
      upsertAccountMeta(meta);
      setActiveFid(fidNum);

      fidRef.current = fid;
      addressRef.current = extAddress;
      walletClientRef.current = extWalletClient;
      localSignerRef.current = localSigner;

      storeLightSession({
        fid: fidNum, address: extAddress, authMethod: "wallet",
        username: profile?.username ?? `!${fidNum}`,
        displayName: profile?.displayName ?? `FID ${fidNum}`,
        pfpUrl: profile?.pfpUrl ?? "",
      });

      setState((s) => ({
        ...s,
        address: extAddress, fid, profile,
        walletClient: extWalletClient, localSigner,
        signerUuid: null, signerApproved: false,
        isLoading: false, error: null, isLocked: false, authMethod: "wallet",
        accounts: loadAccountsMeta(), neynarKey: neynarKeyRef.current, fidSold: false,
        autoSignerLoading: false, signerError: null,
      }));

      _autoActivateSigner(fid, extAddress, extWalletClient, localSigner).catch((err) => {
        console.error("[WalletProvider] background signer activation failed:", err);
      });
      // Bridge WC / injected wallet account changes back into WalletProvider.
      // Only update walletClient when the SAME address reconnects (e.g. after page refresh).
      // Do NOT trigger a full re-login for a different address · that address is likely
      // the market wallet (MetaMask/Rainbow for buying FIDs) and must not cause sign prompts.
      setWalletAccountChangeCallback((newWc, newAddr) => {
        if (newAddr.toLowerCase() === (addressRef.current ?? "").toLowerCase()) {
          walletClientRef.current = newWc;
          setState((s) => ({ ...s, walletClient: newWc }));
        }
        // Different address = market wallet connecting · ignore silently.
      });
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : "Wallet login failed.";
      const friendly = /user rejected|denied|cancelled|4001/i.test(raw)
        ? "You cancelled the signing request. Tap 'Try again' to retry."
        : raw;
      setState((s) => ({ ...s, isLoading: false, error: friendly }));
    }
  }, [_autoActivateSigner]);

  /**
   * Flow 3: Sign In With Farcaster (Warpcast relay / SIWF).
   * Read-only by default · no seed phrase, no signer registration.
   * Posting and market operations require connecting a wallet afterward.
   */
  const loginWithFarcaster = useCallback(async (
    fidNum: number,
    profile: FarcasterProfile | null,
    localSigner: LocalSigner | null,
    signerUuid?: string | null,
  ) => {
    const fid = BigInt(fidNum);
    const uuid = signerUuid ?? null;
    const meta: AccountMeta = {
      fid: fidNum, address: "",
      username: profile?.username ?? `!${fidNum}`,
      displayName: profile?.displayName ?? `FID ${fidNum}`,
      pfpUrl: profile?.pfpUrl ?? "",
      signerUuid: uuid,
      authMethod: "farcaster",
    };
    upsertAccountMeta(meta);
    setActiveFid(fidNum);

    const privKeyHex = localSigner ? signerPrivateKeyHex(localSigner) : null;
    if (privKeyHex) await storeSignerPrivKey(fidNum, privKeyHex);

    storeLightSession({
      fid: fidNum, address: null, authMethod: "farcaster",
      username: profile?.username ?? `!${fidNum}`,
      displayName: profile?.displayName ?? `FID ${fidNum}`,
      pfpUrl: profile?.pfpUrl ?? "",
      signerUuid: uuid,
    });

    fidRef.current = fid;
    addressRef.current = null;
    walletClientRef.current = null;
    localSignerRef.current = localSigner;

    setState((s) => ({
      ...s,
      address: null, fid, profile,
      walletClient: null, localSigner,
      signerUuid: uuid,
      signerApproved: localSigner !== null || uuid !== null,
      isLoading: false, error: null, isLocked: false, authMethod: "farcaster",
      accounts: loadAccountsMeta(), neynarKey: neynarKeyRef.current, fidSold: false,
      autoSignerLoading: false, signerError: null,
    }));
    saveSiwfSession(fidNum, profile);
  }, []);

  useEffect(() => {
    let cancelled = false;
    hasStoredSession().then(async (found) => {
      if (cancelled) return;

      // ── Mnemonic session restore ───────────────────────────────────────────
      if (found) {
        try {
          const activeFid = getActiveFid();
          // Try key-based restore first (no password needed, survives refresh).
          let mnemonic: string | null = activeFid ? await loadAccountMnemonicAuto(activeFid) : null;
          if (!mnemonic) mnemonic = await decryptStoredAuto();

          // Migration fallback: old sessions have password in sessionStorage but no cached key yet.
          if (!mnemonic) {
            const cached = loadPwdFromSession();
            if (cached) {
              mnemonic = activeFid ? await loadAccountMnemonic(activeFid, cached) : null;
              if (!mnemonic) mnemonic = await decryptStored(cached);
              if (mnemonic) sessionPwdRef.current = cached; // keep in memory for this session
            }
          }
          clearPwdFromSession(); // raw password no longer needed in storage

          if (mnemonic && !cancelled) {
            await _applyAccount(mnemonic);
            if (!cancelled) {
              setState((s) => ({ ...s, hasStoredSession: true, isCheckingSession: false }));
            }
            return;
          }
        } catch {}
      }

      // ── Light session restore (wallet / SIWF) ─────────────────────────────
      const light = loadLightSession();
      if (light && !cancelled) {
        if (light.authMethod === "farcaster") {
          const profile: FarcasterProfile = {
            fid: light.fid,
            username: light.username,
            displayName: light.displayName,
            pfpUrl: light.pfpUrl,
            bio: "", followerCount: 0, followingCount: 0, custodyAddress: "",
          };
          // Rehydrate the Ed25519 posting key (stored encrypted in localStorage).
          let restoredSigner: LocalSigner | null = null;
          const storedPrivKey = await loadSignerPrivKey(light.fid);
          if (storedPrivKey) {
            try { restoredSigner = signerFromPrivateKeyHex(storedPrivKey); } catch { restoredSigner = null; }
          }
          await loginWithFarcaster(light.fid, profile, restoredSigner, light.signerUuid ?? null);
          if (!cancelled) setState((s) => ({ ...s, isCheckingSession: false }));
          return;
        }

        if (light.authMethod === "wallet" && light.address) {
          // Attempt silent restore using the cached Ed25519 signer key (no MetaMask prompt).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ethereum = (window as any)?.ethereum;
          let autoReconnected = false;

          const cachedPrivKey = await loadSignerPrivKey(light.fid);
          if (cachedPrivKey && !cancelled) {
            try {
              const restoredSigner = signerFromPrivateKeyHex(cachedPrivKey);
              const restoredProfile: FarcasterProfile = {
                fid: light.fid, username: light.username,
                displayName: light.displayName, pfpUrl: light.pfpUrl,
                bio: "", followerCount: 0, followingCount: 0, custodyAddress: light.address ?? "",
              };
              // Reconstruct the wallet client from MetaMask if available (needed for on-chain ops).
              let wc: WalletClient | null = null;
              if (ethereum?.request) {
                try {
                  const accounts: string[] = await ethereum.request({ method: "eth_accounts" });
                  const match = accounts.find((a) => a.toLowerCase() === light.address!.toLowerCase());
                  if (match) {
                    wc = createWalletClient({ account: match as `0x${string}`, chain: optimism, transport: custom(ethereum) });
                  }
                } catch { /* MetaMask locked · wc stays null, read-only mode */ }
              }
              fidRef.current = BigInt(light.fid);
              addressRef.current = light.address as `0x${string}`;
              walletClientRef.current = wc;
              localSignerRef.current = restoredSigner;
              upsertAccountMeta({ fid: light.fid, address: light.address ?? "", username: light.username, displayName: light.displayName, pfpUrl: light.pfpUrl, signerUuid: null, authMethod: "wallet" });
              setActiveFid(light.fid);
              setState((s) => ({
                ...s,
                fid: BigInt(light.fid), address: light.address as `0x${string}`,
                profile: restoredProfile, walletClient: wc, localSigner: restoredSigner,
                signerApproved: loadSignerApproved(light.fid), authMethod: "wallet",
                isLoading: false, error: null, isCheckingSession: false,
                accounts: loadAccountsMeta(), neynarKey: neynarKeyRef.current,
                fidSold: false, autoSignerLoading: false, signerError: null,
              }));
              autoReconnected = true;
            } catch { /* fall through to MetaMask sign */ }
          }

          // No cached key · try MetaMask sign (first login or key cleared).
          if (!autoReconnected && ethereum?.request) {
            try {
              const accounts: string[] = await ethereum.request({ method: "eth_accounts" });
              const match = accounts.find(
                (a) => a.toLowerCase() === light.address!.toLowerCase(),
              );
              if (match && !cancelled) {
                const wc = createWalletClient({
                  account: match as `0x${string}`,
                  chain: optimism,
                  transport: custom(ethereum),
                });
                await loginWithWallet(wc, match as `0x${string}`);
                if (fidRef.current) {
                  autoReconnected = true;
                  if (!cancelled) setState((s) => ({ ...s, isCheckingSession: false }));
                }
              }
            } catch { /* silent · fall through to partial restore */ }
          }

          // MetaMask locked / wrong account / signing failed · restore partial
          // session so the user stays on their feed with a reconnect cue.
          if (!autoReconnected && !cancelled) {
            const restoredProfile: FarcasterProfile = {
              fid: light.fid,
              username: light.username,
              displayName: light.displayName,
              pfpUrl: light.pfpUrl,
              bio: "", followerCount: 0, followingCount: 0,
              custodyAddress: light.address ?? "",
            };
            const restoredMeta: AccountMeta = {
              fid: light.fid, address: light.address ?? "",
              username: light.username, displayName: light.displayName,
              pfpUrl: light.pfpUrl, signerUuid: null, authMethod: "wallet",
            };
            upsertAccountMeta(restoredMeta);
            setActiveFid(light.fid);
            fidRef.current = BigInt(light.fid);
            addressRef.current = light.address as `0x${string}`;
            setState((s) => ({
              ...s,
              fid: BigInt(light.fid),
              address: light.address as `0x${string}`,
              profile: restoredProfile,
              walletClient: null, localSigner: null,
              signerApproved: false, authMethod: "wallet",
              isLoading: false, error: null, isCheckingSession: false,
              accounts: loadAccountsMeta(), neynarKey: neynarKeyRef.current,
              fidSold: false, autoSignerLoading: false, signerError: null,
            }));
          }
          return;
        }

        if (light.authMethod === "mnemonic" && !cancelled) {
          // CryptoKey was lost (private browsing / browser cleared IndexedDB) but light session persists.
          // Restore the profile in locked mode · feed is visible, posting requires re-adding the account.
          const restoredProfile: FarcasterProfile = {
            fid: light.fid,
            username: light.username,
            displayName: light.displayName,
            pfpUrl: light.pfpUrl,
            bio: "", followerCount: 0, followingCount: 0,
            custodyAddress: light.address ?? "",
          };
          const restoredMeta: AccountMeta = {
            fid: light.fid, address: light.address ?? "",
            username: light.username, displayName: light.displayName,
            pfpUrl: light.pfpUrl, signerUuid: null, authMethod: "mnemonic",
          };
          upsertAccountMeta(restoredMeta);
          setActiveFid(light.fid);
          fidRef.current = BigInt(light.fid);
          addressRef.current = light.address as `0x${string}` | null;
          setState((s) => ({
            ...s,
            fid: BigInt(light.fid),
            address: light.address as `0x${string}` | null,
            profile: restoredProfile,
            walletClient: null, localSigner: null,
            signerApproved: false, authMethod: "mnemonic",
            isLoading: false,
            error: null,
            isLocked: true,
            isCheckingSession: false,
            accounts: loadAccountsMeta(), neynarKey: neynarKeyRef.current,
            fidSold: false, autoSignerLoading: false, signerError: null,
          }));
          return;
        }
      }

      if (!cancelled) setState((s) => ({ ...s, hasStoredSession: found, isCheckingSession: false }));
    });
    return () => { cancelled = true; };
  }, [_applyAccount, loginWithFarcaster, loginWithWallet]);

  useEffect(() => {
    if (!state.fid) return;

    function doLock() {
      _zeroAndLock();
      // Do NOT clearLightSession() here · keep the profile metadata so that on the
      // next page load the user sees their feed in read-only mode instead of being
      // bounced to the marketing landing. The session can still be restored via
      // the stored CryptoKey or by re-entering the seed password.
      setState((s) => ({
        ...s,
        address: null, fid: null, profile: null, walletClient: null, localSigner: null,
        signerUuid: null, signerApproved: false, autoSignerLoading: false, signerError: null,
        sessionPassword: null, isLoading: false, error: null, isCheckingSession: false,
        isLocked: true,
      }));
      hasStoredSession().then((found) => setState((s) => ({ ...s, hasStoredSession: found })));
    }

    function resetTimer() {
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = setTimeout(doLock, INACTIVITY_MS);
    }

    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"] as const;
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    };
  }, [state.fid]);

  useEffect(() => {
    if (!state.fid) return;
    let hiddenSince: number | null = null;

    function onVisibility() {
      if (document.hidden) {
        hiddenSince = Date.now();
      } else {
        if (hiddenSince !== null && Date.now() - hiddenSince >= HIDDEN_LOCK_MS) {
          _zeroAndLock();
          setState((s) => ({
            ...s,
            address: null, fid: null, profile: null, walletClient: null, localSigner: null,
            signerUuid: null, signerApproved: false, autoSignerLoading: false, signerError: null,
            sessionPassword: null, isLoading: false, error: null, isCheckingSession: false,
            isLocked: true,
          }));
          hasStoredSession().then((found) => setState((s) => ({ ...s, hasStoredSession: found })));
        }
        hiddenSince = null;
      }
    }

    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [state.fid]);

  useEffect(() => {
    function onPageHide() { _zeroAndLock(); }
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  // Keep a stable ref to authMethod so the accountsChanged listener below
  // can check the current auth mode without re-subscribing on every state change.
  const authMethodRef = useRef<AuthMethod | null>(null);
  useEffect(() => { authMethodRef.current = state.authMethod; }, [state.authMethod]);

  // When the user is signed in via wallet-auth and switches accounts in MetaMask,
  // automatically re-derive the signer for the new address.
  useEffect(() => {
    const ethereum = (window as any)?.ethereum;
    if (!ethereum?.on) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (authMethodRef.current !== "wallet") return;
      if (accounts.length === 0) {
        // Wallet disconnected · clear session but stay on the page
        fidRef.current = null;
        addressRef.current = null;
        walletClientRef.current = null;
        localSignerRef.current = null;
        setState((s) => ({
          ...s,
          address: null, fid: null, profile: null, walletClient: null, localSigner: null,
          signerUuid: null, signerApproved: false, autoSignerLoading: false, signerError: null,
          isLoading: false, error: "Wallet disconnected.", authMethod: null,
        }));
        return;
      }
      const newAddr = accounts[0] as `0x${string}`;
      if (newAddr.toLowerCase() === (addressRef.current ?? "").toLowerCase()) {
        // Same address as the active account. If we switched to this account while
        // the wallet wasn't connected yet (walletClient == null) and the user has
        // now connected it, wire the client up and clear the "Connect your wallet"
        // hint · otherwise the prompt would keep reappearing after connecting.
        if (!walletClientRef.current) {
          const wc = createWalletClient({ account: newAddr, chain: optimism, transport: custom(ethereum) });
          walletClientRef.current = wc;
          setState((s) => ({
            ...s,
            walletClient: wc,
            error: s.error?.startsWith("Connect your wallet") ? null : s.error,
          }));
        }
        return;
      }

      // Re-derive: create a fresh wallet client for the new account and re-login
      const newWc = createWalletClient({
        account: newAddr,
        chain: optimism,
        transport: custom(ethereum),
      });
      loginWithWallet(newWc, newAddr).catch(() => {});
    };

    ethereum.on("accountsChanged", handleAccountsChanged);
    return () => ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
  }, [loginWithWallet]);

  const login = useCallback(async (mnemonic: string, password: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const fidNum = await _applyAccount(mnemonic);
      await encryptAndStore(mnemonic, password);
      await storeAccountMnemonic(fidNum, mnemonic, password);
      sessionPwdRef.current = password;
      setState((s) => ({ ...s, hasStoredSession: true }));
    } catch (e: unknown) {
      setState((s) => ({ ...s, isLoading: false, error: e instanceof Error ? e.message : "Login failed." }));
    }
  }, [_applyAccount]);

  const unlockWithPassword = useCallback(async (password: string) => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    const attempts = getFailedAttempts();
    if (attempts.count > 0) {
      const delayMs = Math.min(30_000, Math.pow(2, attempts.count - 1) * 2_000);
      await new Promise((r) => setTimeout(r, delayMs));
    }
    try {
      const mainMnemonic = await decryptStored(password);
      if (!mainMnemonic) {
        const count = incFailedAttempts();
        const nextWait = Math.min(30, Math.pow(2, count - 1) * 2);
        setState((s) => ({
          ...s, isLoading: false,
          error: `Incorrect password. Please try again${count > 1 ? ` (wait ${nextWait}s)` : ""}.`,
        }));
        return;
      }
      clearFailedAttempts();
      const activeFid = getActiveFid();
      let mnemonic = mainMnemonic;
      if (activeFid) {
        const activeMnemonic = await loadAccountMnemonic(activeFid, password);
        if (activeMnemonic) mnemonic = activeMnemonic;
      }
      await _applyAccount(mnemonic);
      sessionPwdRef.current = password;
    } catch (e: unknown) {
      setState((s) => ({ ...s, isLoading: false, error: e instanceof Error ? e.message : "Unlock failed." }));
    }
  }, [_applyAccount]);

  const addAccount = useCallback(async (mnemonic: string) => {
    const password = sessionPwdRef.current;
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const fidNum = await _applyAccount(mnemonic);
      if (password) await storeAccountMnemonic(fidNum, mnemonic, password);
    } catch (e: unknown) {
      setState((s) => ({ ...s, isLoading: false, error: e instanceof Error ? e.message : "Failed to add account." }));
      throw e;
    }
  }, [_applyAccount]);

  const switchAccount = useCallback(async (fid: number) => {
    // ── Optimistic update: show new account identity immediately from cache ──
    // This eliminates the ~1 s flash where the old account's name/avatar/feed
    // would show while we await fetchProfile for the new account.
    const accounts = loadAccountsMeta();
    const target = accounts.find((a) => a.fid === fid);
    const optimisticProfile: FarcasterProfile | null = target ? {
      fid,
      username: target.username || `!${fid}`,
      displayName: target.displayName || `FID ${fid}`,
      pfpUrl: target.pfpUrl || "",
      bio: "", followerCount: 0, followingCount: 0,
      custodyAddress: target.address || "",
    } : null;
    fidRef.current = BigInt(fid);
    setState((s) => ({
      ...s,
      isLoading: true,
      error: null,
      fid: BigInt(fid),
      profile: optimisticProfile,
      signerApproved: loadSignerApproved(fid),
      accounts,
    }));
    try {
      const targetAuth = target?.authMethod;

      // Farcaster account · restore from per-account stored signer key
      if (targetAuth === "farcaster") {
        const privKeyHex = await loadSignerPrivKey(fid);
        const signer = privKeyHex ? signerFromPrivateKeyHex(privKeyHex) : null;
        let profile: FarcasterProfile | null = null;
        try { profile = await fetchProfile(BigInt(fid)); } catch {}
        if (!profile && target) {
          profile = { fid, username: target.username, displayName: target.displayName,
            pfpUrl: target.pfpUrl, bio: "", followerCount: 0, followingCount: 0, custodyAddress: "" };
        }
        await loginWithFarcaster(fid, profile, signer, target?.signerUuid ?? null);
        return;
      }

      // Wallet-auth accounts: restore session silently (same pattern as session-restore useEffect).
      // No signing required · the Ed25519 signer key was stored on first login.
      if (targetAuth === "wallet") {
        const privKeyHex = await loadSignerPrivKey(fid);
        const signer = privKeyHex ? signerFromPrivateKeyHex(privKeyHex) : null;
        let profile: FarcasterProfile | null = null;
        try { profile = await fetchProfile(BigInt(fid)); } catch {}
        if (!profile && target) {
          profile = { fid, username: target.username, displayName: target.displayName,
            pfpUrl: target.pfpUrl, bio: "", followerCount: 0, followingCount: 0, custodyAddress: target.address ?? "" };
        }

        // Attempt silent MetaMask reconnect (no popup · eth_accounts never prompts)
        let wc: WalletClient | null = null;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ethereum = (window as any)?.ethereum;
        if (ethereum?.request && target?.address) {
          try {
            const accounts: string[] = await ethereum.request({ method: "eth_accounts" });
            const match = accounts.find((a) => a.toLowerCase() === target.address!.toLowerCase());
            if (match) {
              wc = createWalletClient({ account: match as `0x${string}`, chain: optimism, transport: custom(ethereum) });
            }
          } catch {}
        }

        fidRef.current = BigInt(fid);
        addressRef.current = (target?.address ?? null) as `0x${string}` | null;
        walletClientRef.current = wc;
        localSignerRef.current = signer;

        upsertAccountMeta({
          fid, address: target?.address ?? "",
          username: target?.username ?? `!${fid}`,
          displayName: target?.displayName ?? `FID ${fid}`,
          pfpUrl: target?.pfpUrl ?? "",
          signerUuid: null, authMethod: "wallet",
        });
        setActiveFid(fid);

        storeLightSession({
          fid, address: target?.address ?? null, authMethod: "wallet",
          username: target?.username ?? `!${fid}`,
          displayName: target?.displayName ?? `FID ${fid}`,
          pfpUrl: target?.pfpUrl ?? "",
        });

        const addr = target?.address;
        const walletHint = !wc && addr
          ? `Connect your wallet (${addr.slice(0, 6)}…${addr.slice(-4)}) in MetaMask to enable on-chain actions for this account`
          : null;

        setState((s) => ({
          ...s,
          fid: BigInt(fid),
          address: (target?.address ?? null) as `0x${string}` | null,
          profile, walletClient: wc, localSigner: signer,
          signerApproved: loadSignerApproved(fid), authMethod: "wallet",
          isLoading: false, error: walletHint, isLocked: false,
          accounts: loadAccountsMeta(), neynarKey: neynarKeyRef.current,
          fidSold: false, autoSignerLoading: false, signerError: null,
        }));
        return;
      }

      // Mnemonic account (or unknown authMethod = legacy mnemonic) · try key-based auto-decrypt first, then fall back to password
      let mnemonic: string | null = await loadAccountMnemonicAuto(fid);

      if (!mnemonic) {
        const password = sessionPwdRef.current;
        if (!password) {
          setState((s) => ({ ...s, isLoading: false, error: "Session expired. Please unlock again." }));
          return;
        }
        mnemonic = await loadAccountMnemonic(fid, password);
        if (!mnemonic) {
          const main = await decryptStored(password);
          if (main) {
            const { address } = await deriveAccount(main);
            const mainFid = await lookupFid(address);
            if (Number(mainFid) === fid) mnemonic = main;
          }
        }
      }
      if (!mnemonic) {
        setState((s) => ({ ...s, isLoading: false, error: "Account data not found. Please add the seed phrase again." }));
        return;
      }
      await _applyAccount(mnemonic);
    } catch (e: unknown) {
      setState((s) => ({ ...s, isLoading: false, error: e instanceof Error ? e.message : "Failed to switch account." }));
    }
  }, [_applyAccount, loginWithFarcaster]);

  const removeAccount = useCallback(async (fid: number) => {
    await removeAccountMnemonic(fid);
    removeAccountFromStore2(fid);
    removeAccountFromStore(fid);
    clearSignerApproved(fid);
    clearSignerPrivKey(fid);
    const remaining = loadAccountsMeta();
    setState((s) => ({ ...s, accounts: remaining }));
    if (state.fid && Number(state.fid) === fid) {
      if (remaining.length > 0) {
        await switchAccount(remaining[0].fid);
      } else {
        clearStoredSession();
        clearPwdFromSession();
        clearWalletSession();
        sessionPwdRef.current = null;
        setState({ ...buildInitial(), isCheckingSession: false, hasStoredSession: false });
      }
    }
  }, [state.fid, switchAccount]);

  const refreshProfile = useCallback(async () => {
    if (!state.fid) return;
    try {
      const profile = await fetchProfile(state.fid);
      setState((s) => ({ ...s, profile }));
    } catch {}
  }, [state.fid]);

  const logout = useCallback(async () => {
    const currentFid = fidRef.current ? Number(fidRef.current) : null;

    // Remove current account from the list
    if (currentFid) {
      removeAccountFromStore2(currentFid);
      removeAccountFromStore(currentFid);
      clearSignerApproved(currentFid);
      clearSignerPrivKey(currentFid);
      await removeAccountMnemonic(currentFid);
    }

    const remaining = loadAccountsMeta();

    // Always update accounts list immediately so the removed account disappears from UI
    setState((s) => ({ ...s, accounts: remaining }));

    // If other accounts exist, switch to the first one (skip wallet-auth accounts we can't auto-switch)
    const switchable = remaining.find(
      (a) => a.authMethod === "mnemonic" || a.authMethod === "farcaster" || !a.authMethod,
    );
    if (switchable) {
      await switchAccount(switchable.fid);
      return;
    }
    if (remaining.length > 0) {
      // Only wallet accounts remain · do a full logout and let user reconnect
    }

    // No accounts left (or only wallet accounts) · full logout
    _zeroAndLock();
    clearStoredSession();
    clearLightSession();
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current);
    setWalletAccountChangeCallback(null);
    setState({ ...buildInitial(), neynarKey: neynarKeyRef.current, hasStoredSession: false, isCheckingSession: false });
  }, [switchAccount]);

  const setSigner = useCallback((uuid: string) => {
    setState((s) => ({ ...s, signerUuid: uuid, signerApproved: true, signerError: null }));
  }, []);

  const setNeynarKey = useCallback((key: string) => {
    saveNeynarKey(key);
    neynarKeyRef.current = key;
    setState((s) => ({ ...s, neynarKey: key }));
  }, []);

  return (
    <WalletContext.Provider value={{
      ...state,
      login, unlockWithPassword, logout, refreshProfile, setSigner, setNeynarKey,
      addAccount, switchAccount, removeAccount, retrySignerSetup,
      loginWithWallet, loginWithFarcaster,
    }}>
      {children}
    </WalletContext.Provider>
  );
}
