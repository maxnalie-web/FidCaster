import { useState, useEffect } from "react";
import { createWalletClient, http } from "viem";
import { mainnet, optimism } from "viem/chains";
import type { WalletClient } from "viem";
import { useWallet } from "@/hooks/useWallet";
import { useMarketWallet } from "@/hooks/useMarketWallet";
import {
  checkFnameAvailability,
  transferFname,
  FNAME_EIP712_DOMAIN,
  FNAME_EIP712_TYPES,
} from "@/lib/farcaster-api";
import { changeNameOnchain, getCustodyAddress } from "@/lib/contracts";
import { Loader2, CheckCircle2, XCircle, Info, AlertTriangle, Link, ExternalLink, Wallet, X } from "lucide-react";

/**
 * Farcaster has two separate name systems:
 *  1. On-chain NameRegistry (Optimism) — `changeName` on 0x...NameRegistry.
 *     Writes the name permanently to the chain; required for ENS/on-chain resolution.
 *     Costs a tiny amount of ETH gas (~$0.001 on Optimism).
 *  2. Off-chain fname server (fnames.farcaster.xyz) — EIP-712 signed HTTP transfer.
 *     Updates the social-graph display name shown in Farcaster/etc. No gas.
 *
 * This component surfaces BOTH paths clearly:
 *  • Primary: on-chain NameRegistry tx via viem (what the task spec requires)
 *  • Secondary: off-chain fname server sync (for social-graph display name)
 */

type OnchainPhase =
  | { id: "idle" }
  | { id: "sending" }
  | { id: "done"; txHash: string }
  | { id: "error"; msg: string };

type FnamePhase =
  | { id: "idle" }
  | { id: "wallet-mismatch"; ownerAddr: string } // fname owned by a different wallet — warn but allow
  | { id: "signing-release" }
  | { id: "releasing" }
  | { id: "signing-claim" }
  | { id: "claiming" }
  | { id: "done" }
  | { id: "error"; msg: string };

export function UsernameChange() {
  const { fid, address, profile, walletClient, authMethod, refreshProfile } = useWallet();
  const {
    wallet: extWallet,
    connectMetaMask,
    connectWalletConnect,
    connecting: connectingExt,
    disconnect: disconnectExt,
  } = useMarketWallet();

  // For farcaster (SIWF) users, use an inline-connected wallet instead of requiring auth switch.
  const effectiveWalletClient = authMethod === "farcaster" ? (extWallet?.walletClient ?? null) : walletClient;
  const effectiveAddress = authMethod === "farcaster" ? (extWallet?.address ?? null) : address;

  // The fname proof is an EIP-712 signature whose domain pins chainId=1 (Ethereum mainnet).
  // - Local accounts (mnemonic): sign purely in-memory on a mainnet-scoped client — no RPC, no popup.
  // - JSON-RPC wallets (MetaMask/WalletConnect): most wallets REJECT eth_signTypedData_v4 when
  //   their active network (here: Optimism) differs from the domain's chainId. So we temporarily
  //   switch the wallet to Ethereum mainnet, sign, then switch it back to Optimism.
  async function signFnameProof(
    name: string,
    timestamp: number,
    owner: `0x${string}`,
  ): Promise<`0x${string}`> {
    if (!effectiveWalletClient?.account) throw new Error("Wallet not connected");
    const account = effectiveWalletClient.account;
    const message = { name, timestamp: BigInt(timestamp), owner };
    const sign = (client: WalletClient) =>
      client.signTypedData({
        account,
        domain: FNAME_EIP712_DOMAIN,
        types: FNAME_EIP712_TYPES,
        primaryType: "UserNameProof",
        message,
      });

    // Local (mnemonic) account — sign offline against a mainnet client.
    if ((account as { type?: string }).type === "local") {
      const local = createWalletClient({ account, chain: mainnet, transport: http() });
      return sign(local);
    }

    // JSON-RPC wallet — ensure the active network is Ethereum mainnet before signing.
    // switchChain to a chain the wallet is already on is a no-op (no popup), so calling it
    // before every signature is cheap.
    try {
      await effectiveWalletClient.switchChain({ id: mainnet.id });
    } catch (e: unknown) {
      const code = (e as { code?: number })?.code;
      if (code === 4902) {
        await effectiveWalletClient.addChain({ chain: mainnet });
        await effectiveWalletClient.switchChain({ id: mainnet.id });
      } else {
        throw e;
      }
    }
    return sign(effectiveWalletClient);
  }

  // After signing on mainnet, return a JSON-RPC wallet to Optimism (best-effort) so the
  // on-chain NameRegistry button keeps working without a manual network switch.
  async function restoreOptimismChain() {
    if (!effectiveWalletClient?.account) return;
    if ((effectiveWalletClient.account as { type?: string }).type === "local") return;
    try { await effectiveWalletClient.switchChain({ id: optimism.id }); } catch { /* ignore */ }
  }

  const [newName, setNewName] = useState("");
  const [checkState, setCheckState] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [onchainPhase, setOnchainPhase] = useState<OnchainPhase>({ id: "idle" });
  const [fnamePhase, setFnamePhase] = useState<FnamePhase>({ id: "idle" });
  const [successPopup, setSuccessPopup] = useState<{ type: "onchain" | "fname"; name: string } | null>(null);

  const hasCurrentFname = Boolean(profile?.username && !profile.username.startsWith("!"));

  useEffect(() => {
    if (!newName || newName.length < 2) { setCheckState("idle"); return; }
    const t = setTimeout(async () => {
      setCheckState("checking");
      const { available } = await checkFnameAvailability(newName);
      setCheckState(available ? "available" : "taken");
    }, 600);
    return () => clearTimeout(t);
  }, [newName]);

  const isValid = /^[a-z0-9][a-z0-9_]{0,14}$/.test(newName) && checkState === "available";

  // ── Primary path: on-chain NameRegistry tx on Optimism ──────────────────
  async function handleOnchainChange(e: React.FormEvent) {
    e.preventDefault();
    if (!effectiveWalletClient || !isValid) return;
    setOnchainPhase({ id: "sending" });
    try {
      const txHash = await changeNameOnchain(effectiveWalletClient, newName);
      setOnchainPhase({ id: "done", txHash });
      setSuccessPopup({ type: "onchain", name: newName });
      await refreshProfile();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Transaction failed";
      setOnchainPhase({ id: "error", msg });
    }
  }

  // ── Secondary path: off-chain fname server (social-graph display name) ──
  async function handleFnameChange() {
    if (!fid || !effectiveAddress || !effectiveWalletClient || !isValid) return;
    setFnamePhase({ id: "idle" });
    const fidNum = Number(fid);
    const now = Math.floor(Date.now() / 1000);

    try {
      if (hasCurrentFname && profile?.username) {
        // Pre-check: the fname server validates the signature against the FID's CURRENT
        // on-chain custody address (IdRegistry.custodyOf). The connected signing wallet must
        // equal that custody — the transfer-history "owner" can be stale and is NOT what the
        // server checks, so we compare against the live on-chain custody instead.
        try {
          const custody = await getCustodyAddress(BigInt(fidNum));
          if (custody && custody.toLowerCase() !== effectiveAddress.toLowerCase()) {
            // Connected wallet is genuinely not the custody — signing would fail. Warn & pause.
            setFnamePhase({ id: "wallet-mismatch", ownerAddr: custody });
            return;
          }
        } catch { /* skip pre-check on RPC error — let the server be the source of truth */ }

        setFnamePhase({ id: "signing-release" });
        const releaseTs = now - 1;
        const releaseSig = await signFnameProof(profile.username, releaseTs, effectiveAddress);

        setFnamePhase({ id: "releasing" });
        const releaseRes = await transferFname({
          name: profile.username,
          from: fidNum,
          to: 0,
          fid: fidNum,
          owner: effectiveAddress,
          timestamp: releaseTs,
          signature: releaseSig,
        });

        if (!releaseRes.success) {
          const errMsg = releaseRes.error ?? "Release failed";
          setFnamePhase({ id: "error", msg: errMsg });
          return;
        }

        await new Promise((r) => setTimeout(r, 500));
      }

      setFnamePhase({ id: "signing-claim" });
      const claimTs = now;
      const claimSig = await signFnameProof(newName, claimTs, effectiveAddress);

      // Show success popup immediately after the second (claim) signature — before the HTTP call.
      setSuccessPopup({ type: "fname", name: newName });

      setFnamePhase({ id: "claiming" });
      const claimRes = await transferFname({
        name: newName,
        from: 0,
        to: fidNum,
        fid: fidNum,
        owner: effectiveAddress,
        timestamp: claimTs,
        signature: claimSig,
      });

      if (claimRes.success) {
        setFnamePhase({ id: "done" });
        await refreshProfile();
      } else {
        setFnamePhase({ id: "error", msg: claimRes.error ?? "Claim failed" });
      }
    } catch (e: unknown) {
      setFnamePhase({ id: "error", msg: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      await restoreOptimismChain();
    }
  }

  // Same as handleFnameChange but skips the pre-check (used after wallet-mismatch warning)
  async function handleFnameChangeDirect() {
    if (!fid || !effectiveAddress || !effectiveWalletClient || !isValid) return;
    const fidNum = Number(fid);
    const now = Math.floor(Date.now() / 1000);
    try {
      if (hasCurrentFname && profile?.username) {
        setFnamePhase({ id: "signing-release" });
        const releaseTs = now - 1;
        const releaseSig = await signFnameProof(profile.username, releaseTs, effectiveAddress);
        setFnamePhase({ id: "releasing" });
        const releaseRes = await transferFname({ name: profile.username, from: fidNum, to: 0, fid: fidNum, owner: effectiveAddress, timestamp: releaseTs, signature: releaseSig });
        if (!releaseRes.success) {
          setFnamePhase({ id: "error", msg: releaseRes.error ?? "Release failed — the fname server rejected the signature. You may need to connect the original custody wallet." });
          return;
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      setFnamePhase({ id: "signing-claim" });
      const claimTs = now;
      const claimSig = await signFnameProof(newName, claimTs, effectiveAddress);
      setFnamePhase({ id: "claiming" });
      const claimRes = await transferFname({ name: newName, from: 0, to: fidNum, fid: fidNum, owner: effectiveAddress, timestamp: claimTs, signature: claimSig });
      if (claimRes.success) {
        setFnamePhase({ id: "done" });
        setSuccessPopup({ type: "fname", name: newName });
        await refreshProfile();
      } else setFnamePhase({ id: "error", msg: claimRes.error ?? "Claim failed" });
    } catch (e: unknown) {
      setFnamePhase({ id: "error", msg: e instanceof Error ? e.message : "Unknown error" });
    } finally {
      await restoreOptimismChain();
    }
  }

  const fnameLabel: Record<string, string> = {
    "signing-release": `Sign to release @${profile?.username ?? "…"}`,
    "releasing": "Submitting release…",
    "signing-claim": `Sign to claim @${newName}`,
    "claiming": "Submitting claim…",
  };

  // For farcaster (SIWF) users: show an inline wallet connect prompt so they can
  // perform on-chain name changes without switching their entire auth method.
  if (authMethod === "farcaster" && !extWallet) {
    return (
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-4 rounded-2xl border border-violet-500/20 bg-violet-500/5">
          <div className="w-9 h-9 rounded-full bg-violet-500/12 flex items-center justify-center shrink-0 mt-0.5">
            <Wallet className="w-4 h-4 text-violet-400" />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-bold text-foreground">Connect a wallet to continue</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              You are signed in via Farcaster (read-only). To change your username on-chain, connect
              your custody wallet below — no need to sign out.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={connectMetaMask}
            disabled={connectingExt}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-amber-500/30 bg-amber-500/8 text-amber-500 text-sm font-semibold hover:bg-amber-500/15 transition-colors disabled:opacity-50"
          >
            {connectingExt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
            MetaMask
          </button>
          <button
            onClick={connectWalletConnect}
            disabled={connectingExt}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-xl border border-blue-500/30 bg-blue-500/8 text-blue-400 text-sm font-semibold hover:bg-blue-500/15 transition-colors disabled:opacity-50"
          >
            {connectingExt ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
            WalletConnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-5">
      {/* Info banner */}
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-primary/5 border border-primary/15">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
          <p className="text-foreground/80 font-medium">Two name systems</p>
          <p>
            <span className="text-foreground/70">On-chain</span> — writes to the Farcaster NameRegistry
            on Optimism via a signed viem tx. Requires gas (~$0.001). Enables on-chain / ENS resolution.
          </p>
          <p>
            <span className="text-foreground/70">Social (fname)</span> — updates your display name in
            Farcaster and other clients via EIP-712 signed transfer. No gas required.
          </p>
        </div>
      </div>

      {/* 7-day cooldown warning */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/8 border border-amber-500/20">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
        <p className="text-[11px] text-amber-400/90 leading-tight">
          You can change your username only <strong>once every 7 days</strong> — choose carefully.
        </p>
      </div>

      {/* Name input (shared) */}
      <div className="space-y-2">
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-primary font-semibold text-sm select-none">@</span>
          <input
            type="text"
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
              setOnchainPhase({ id: "idle" });
              setFnamePhase({ id: "idle" });
            }}
            placeholder="new username"
            maxLength={15}
            className="input-luxury w-full pl-8 pr-10 py-3 text-sm"
          />
          <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
            {checkState === "checking" && <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />}
            {checkState === "available" && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            {checkState === "taken" && <XCircle className="w-4 h-4 text-destructive" />}
          </div>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">3–15 chars, a-z 0-9 underscore</span>
          {checkState === "available" && <span className="text-emerald-400 font-medium">@{newName} is available</span>}
          {checkState === "taken" && <span className="text-destructive">@{newName} is taken</span>}
        </div>
      </div>

      {/* ── PRIMARY: On-chain NameRegistry tx ───────────────────────────── */}
      <div className="rounded-xl border border-border/60 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border/40">
          <Link className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-semibold text-foreground/80">On-chain (NameRegistry · Optimism)</span>
          <span className="ml-auto text-xs text-muted-foreground">~$0.001 gas</span>
        </div>
        <div className="p-4 space-y-3">
          <form onSubmit={handleOnchainChange}>
            <button
              type="submit"
              disabled={!isValid || onchainPhase.id === "sending"}
              className="w-full py-3 rounded-xl text-primary-foreground font-semibold text-sm btn-luxury disabled:opacity-40"
            >
              {onchainPhase.id === "sending" ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending transaction…
                </span>
              ) : (
                "Change username on-chain"
              )}
            </button>
          </form>

          {onchainPhase.id === "done" && (
            <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400 space-y-1.5">
              <div className="flex items-center gap-1.5 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                NameRegistry updated on-chain
              </div>
              <a
                href={`https://optimistic.etherscan.io/tx/${onchainPhase.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 font-mono text-emerald-300/70 hover:text-emerald-300 truncate"
              >
                <ExternalLink className="w-3 h-3 shrink-0" />
                {onchainPhase.txHash.slice(0, 20)}…{onchainPhase.txHash.slice(-8)}
              </a>
            </div>
          )}

          {onchainPhase.id === "error" && (
            <div className="p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-xs text-destructive flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{onchainPhase.msg}</span>
            </div>
          )}
        </div>
      </div>

      {/* ── SECONDARY: Off-chain fname server ───────────────────────────── */}
      <div className="rounded-xl border border-border/40 overflow-hidden opacity-90">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/20 border-b border-border/30">
          <span className="text-xs font-semibold text-foreground/60">Social name (fname server · no gas)</span>
          <span className="ml-auto text-xs text-muted-foreground">EIP-712 signed</span>
        </div>
        <div className="p-4 space-y-3">
          {(fnamePhase.id === "signing-release" || fnamePhase.id === "releasing" ||
            fnamePhase.id === "signing-claim" || fnamePhase.id === "claiming") && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-primary/5 border border-primary/15 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
              {fnameLabel[fnamePhase.id] ?? "Working…"}
            </div>
          )}

          {fnamePhase.id === "done" && (
            <div className="p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 text-xs text-emerald-400 flex items-center gap-2">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              @{newName || profile?.username} social name updated — no gas paid
            </div>
          )}

          {fnamePhase.id === "wallet-mismatch" && (
            <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/8 text-xs text-amber-400 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  This FID's custody wallet is <strong>{fnamePhase.ownerAddr.slice(0, 6)}…{fnamePhase.ownerAddr.slice(-4)}</strong>, but you're connected with a different wallet.
                  Farcaster only accepts the username change if it's signed by the custody wallet — connect <strong>{fnamePhase.ownerAddr.slice(0, 6)}…{fnamePhase.ownerAddr.slice(-4)}</strong> and try again.
                </span>
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleFnameChangeDirect}
                  className="flex-1 py-1.5 rounded-lg border border-amber-500/40 text-amber-400 hover:bg-amber-500/15 transition-colors"
                >
                  Try anyway
                </button>
                <button
                  onClick={() => setFnamePhase({ id: "idle" })}
                  className="px-3 py-1.5 rounded-lg border border-border/40 text-muted-foreground hover:bg-accent/30 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {fnamePhase.id === "error" && (
            <div className="p-3 rounded-xl border border-destructive/20 bg-destructive/5 text-xs text-destructive flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{fnamePhase.msg}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleFnameChange}
            disabled={!isValid || fnamePhase.id === "wallet-mismatch" ||
              fnamePhase.id === "signing-release" || fnamePhase.id === "releasing" ||
              fnamePhase.id === "signing-claim" || fnamePhase.id === "claiming"}
            className="w-full py-2.5 rounded-xl border border-border/60 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors disabled:opacity-40"
          >
            {hasCurrentFname
              ? `Release @${profile?.username ?? "…"} → claim @${newName || "…"}`
              : `Claim @${newName || "…"} via fname server`}
          </button>
        </div>
      </div>
    </div>

      {/* Success popup — shown after final sign */}

      {successPopup && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-8 px-4 pointer-events-none">
          <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-emerald-500/30 bg-card shadow-2xl shadow-emerald-900/20 overflow-hidden animate-in slide-in-from-bottom-4 duration-300">
            <div className="flex items-start gap-3 p-4 bg-emerald-500/8 border-b border-emerald-500/20">
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-400">
                  @{successPopup.name} {successPopup.type === "onchain" ? "registered on-chain" : "social name updated"}
                </p>
                <p className="text-xs text-emerald-400/70 mt-0.5">
                  {successPopup.type === "onchain" ? "NameRegistry · Optimism" : "fname server · no gas"}
                </p>
              </div>
              <button onClick={() => setSuccessPopup(null)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-amber-400">Final confirmation required on Farcaster</p>
              </div>
              <ol className="text-xs text-muted-foreground leading-relaxed list-decimal list-inside space-y-0.5 pl-1">
                <li>Open the Farcaster app or visit farcaster.xyz</li>
                <li>Go to your profile</li>
                <li>Click on your current username</li>
                <li>Select <strong className="text-foreground/80">@{successPopup.name}</strong> to finalize</li>
              </ol>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
