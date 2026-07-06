import { useEffect, useState } from "react";
import { Loader2, AlertTriangle, X, KeyRound } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { toast } from "sonner";

/**
 * Global popup shown while the Farcaster signer key is being registered
 * on-chain · this is the "a couple more signature prompts" stretch of wallet
 * login (registerSignerOnchain does a signTypedData, then a writeContract
 * confirm, after the signMessage that already completed to get here).
 *
 * Hooks into the wallet context's own reliable progress signals
 * (autoSignerLoading / signerApproved / signerError) instead of the login
 * screen's local step state, so it shows up for every path that can trigger
 * this same registration (initial login, "Retry", adding an account) — not
 * just the first connect screen.
 */
export function SignerSetupPopup() {
  const { fid, autoSignerLoading, signerApproved, signerError, retrySignerSetup } = useWallet();
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // A fresh registration attempt (retry, or a new login) always starts with
  // autoSignerLoading flipping true · un-dismiss so the popup can reappear.
  useEffect(() => {
    if (autoSignerLoading) setDismissed(false);
  }, [autoSignerLoading]);

  const show = !!fid && !dismissed && (autoSignerLoading || (!!signerError && !signerApproved));
  if (!show) return null;

  function handleClose() {
    if (autoSignerLoading) {
      toast.warning("Setup isn't finished — approve the remaining wallet prompt(s) to finish, or retry later from Settings → Signer.");
    }
    setDismissed(true);
  }

  async function handleRetry() {
    setRetrying(true);
    try { await retrySignerSetup(); } finally { setRetrying(false); }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-sm bg-card rounded-2xl border border-border shadow-2xl overflow-hidden">
        <div className="flex items-start gap-3 p-4 border-b border-border/60">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${signerError ? "bg-amber-500/10" : "bg-primary/10"}`}>
            {signerError
              ? <AlertTriangle className="w-4.5 h-4.5 text-amber-500" />
              : <KeyRound className="w-4.5 h-4.5 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              {signerError ? "Setup didn't finish" : "Finishing setup"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {signerError
                ? signerError
                : "2 steps left in your wallet: sign a key request, then confirm one transaction. This closes automatically once you're done."}
            </p>
          </div>
          <button
            onClick={handleClose}
            aria-label="Close"
            className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          {signerError ? (
            <button
              onClick={handleRetry}
              disabled={retrying}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {retrying && <Loader2 className="w-4 h-4 animate-spin" />}
              Retry
            </button>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
              Waiting for your wallet…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
