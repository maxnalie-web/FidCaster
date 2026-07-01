import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useMarketWallet } from "@/hooks/useMarketWallet";
import {
  Loader2, CheckCircle2, AlertTriangle, ArrowLeft,
  Wallet, Link,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Phase =
  | "idle"
  | "connecting"
  | "detecting_fid"
  | "signing"
  | "registering"
  | "done"
  | { error: string };

const STEPS = [
  { id: "connecting",    label: "Connect wallet" },
  { id: "detecting_fid", label: "Detect Farcaster ID" },
  { id: "signing",       label: "Sign to derive signer key" },
  { id: "registering",   label: "Register signer on-chain" },
  { id: "done",          label: "Signed in" },
] as const;

function stepIndex(phase: Phase): number {
  if (typeof phase === "object") return -1;
  const map: Record<string, number> = {
    idle: -1, connecting: 0, detecting_fid: 1, signing: 2, registering: 3, done: 4,
  };
  return map[phase] ?? -1;
}

export function WalletConnectLogin({ onBack }: { onBack: () => void }) {
  const {
    loginWithWallet,
    isLoading,
    error: walletError,
    autoSignerLoading,
    signerError,
    fid,
  } = useWallet();

  const {
    wallet: extWallet,
    connectMetaMask,
    connectWalletConnect,
    connecting,
    hasInjected,
  } = useMarketWallet();

  const [phase, setPhase] = useState<Phase>("idle");

  const displayError = typeof phase === "object"
    ? phase.error
    : (walletError || signerError || null);

  useEffect(() => {
    if (extWallet && phase === "connecting") {
      setPhase("detecting_fid");
      loginWithWallet(extWallet.walletClient, extWallet.address).catch((e) => {
        setPhase({ error: e instanceof Error ? e.message : "Connection failed." });
      });
    }
  }, [extWallet, phase, loginWithWallet]);

  useEffect(() => {
    if (isLoading && phase === "detecting_fid") setPhase("signing");
    if (autoSignerLoading) setPhase("registering");
    if (fid && !autoSignerLoading && !isLoading) setPhase("done");
  }, [isLoading, autoSignerLoading, fid, phase]);

  // When loginWithWallet catches an error internally (e.g. user rejected signMessage),
  // it sets state.error but doesn't throw · transition to error phase so the retry button appears.
  useEffect(() => {
    if (walletError && (phase === "detecting_fid" || phase === "signing" || phase === "connecting")) {
      setPhase({ error: walletError });
    }
  }, [walletError, phase]);

  async function handleMetaMask() {
    setPhase("connecting");
    try {
      await connectMetaMask();
    } catch (e) {
      setPhase({ error: e instanceof Error ? e.message : "Failed to connect MetaMask." });
    }
  }

  async function handleWalletConnect() {
    setPhase("connecting");
    try {
      await connectWalletConnect();
    } catch (e) {
      setPhase({ error: e instanceof Error ? e.message : "Failed to connect via WalletConnect." });
    }
  }

  const activeIdx = stepIndex(phase);
  const isWorking = phase === "connecting" || phase === "detecting_fid" || phase === "signing" || phase === "registering" || connecting || isLoading || autoSignerLoading;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-white/30 hover:text-white/60 transition-colors p-1"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: "rgba(124,58,237,0.15)", border: "1px solid rgba(124,58,237,0.25)" }}
        >
          <Wallet className="w-5 h-5 text-violet-400" />
        </div>
        <div>
          <h2 className="text-white font-bold text-base">Connect Wallet</h2>
          <p className="text-white/35 text-xs">MetaMask or any WalletConnect wallet</p>
        </div>
      </div>

      {/* IDLE · Choose MetaMask or WalletConnect */}
      {phase === "idle" && (
        <div className="space-y-3">
          {/* MetaMask */}
          <button
            onClick={handleMetaMask}
            className="w-full text-left rounded-xl p-4 transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: hasInjected ? "rgba(245,158,11,0.10)" : "rgba(255,255,255,0.04)",
              border: `1px solid ${hasInjected ? "rgba(245,158,11,0.25)" : "rgba(255,255,255,0.06)"}`,
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgba(245,158,11,0.12)" }}
              >
                {/* MetaMask fox icon as SVG */}
                <svg width="20" height="20" viewBox="0 0 280 258" fill="none">
                  <path d="M264 1L155 80l20-47L264 1z" fill="#E17726" stroke="#E17726" strokeWidth="2"/>
                  <path d="M16 1l108 80-19-47L16 1z" fill="#E27625" stroke="#E27625" strokeWidth="2"/>
                  <path d="M226 189l-29 44 62 17 18-60-51-1z" fill="#E27625" stroke="#E27625" strokeWidth="2"/>
                  <path d="M3 190l18 60 62-17-29-44-51 1z" fill="#E27625" stroke="#E27625" strokeWidth="2"/>
                  <path d="M79 113l-18 27 64 3-2-69-44 39z" fill="#E27625" stroke="#E27625" strokeWidth="2"/>
                  <path d="M201 113l-45-40-1 70 64-3-18-27z" fill="#E27625" stroke="#E27625" strokeWidth="2"/>
                  <path d="M83 233l38-18-33-26-5 44z" fill="#E27625" stroke="#E27625" strokeWidth="2"/>
                  <path d="M159 215l38 18-5-44-33 26z" fill="#E27625" stroke="#E27625" strokeWidth="2"/>
                </svg>
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold text-sm">MetaMask</p>
                <p className="text-white/35 text-xs">
                  {hasInjected ? "Browser wallet detected" : "Install MetaMask to use this option"}
                </p>
              </div>
              {!hasInjected && (
                <span className="text-[10px] text-white/25 font-medium px-2 py-0.5 rounded-md"
                  style={{ background: "rgba(255,255,255,0.06)" }}>
                  Not installed
                </span>
              )}
            </div>
          </button>

          {/* WalletConnect */}
          <button
            onClick={handleWalletConnect}
            className="w-full text-left rounded-xl p-4 transition-all hover:scale-[1.01] active:scale-[0.99]"
            style={{
              background: "rgba(59,130,246,0.09)",
              border: "1px solid rgba(59,130,246,0.20)",
            }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgba(59,130,246,0.12)" }}
              >
                <Link className="w-4.5 h-4.5 text-blue-400" style={{ width: "1.125rem", height: "1.125rem" }} />
              </div>
              <div className="flex-1">
                <p className="text-white font-semibold text-sm">WalletConnect</p>
                <p className="text-white/35 text-xs">Rainbow, Trust, Coinbase, and 400+ wallets via QR code</p>
              </div>
            </div>
          </button>

          <p className="text-center text-xs text-white/25">
            Your Farcaster ID is detected automatically from your wallet address.
          </p>
        </div>
      )}

      {/* Working · progress steps */}
      {isWorking && (
        <div className="space-y-3">
          {STEPS.filter((s) => s.id !== "done").map((step, i) => {
            const done = i < activeIdx;
            const active = i === activeIdx;
            return (
              <div key={step.id} className="flex items-center gap-3">
                <div className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center shrink-0 transition-all",
                  done ? "bg-emerald-500/20 border border-emerald-500/40" :
                  active ? "bg-violet-500/20 border border-violet-500/40" :
                  "bg-white/5 border border-white/10"
                )}>
                  {done
                    ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    : active
                    ? <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />
                    : <span className="w-1.5 h-1.5 rounded-full bg-white/20" />
                  }
                </div>
                <span className={cn(
                  "text-sm",
                  done ? "text-emerald-400" :
                  active ? "text-white" :
                  "text-white/25"
                )}>
                  {step.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Done */}
      {phase === "done" && (
        <div
          className="flex items-center gap-2 p-3 rounded-xl text-sm text-emerald-400"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.18)" }}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          Signed in successfully!
        </div>
      )}

      {/* Error */}
      {displayError && (
        <div
          className="p-3 rounded-xl text-sm text-red-300 leading-relaxed"
          style={{ background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.2)" }}
        >
          {displayError}
        </div>
      )}

      {typeof phase === "object" && (
        <button
          onClick={() => setPhase("idle")}
          className="w-full py-2.5 rounded-xl text-sm font-semibold transition-all hover:opacity-90 active:scale-[0.98]"
          style={{ background: "rgba(124,58,237,0.18)", border: "1px solid rgba(124,58,237,0.30)", color: "#a78bfa" }}
        >
          Try again
        </button>
      )}
    </div>
  );
}
