// Global signing/transaction request handler for PROVIDER-mode WalletConnect
// (see lib/walletconnect-provider.ts). A connected dApp can send a request
// at any time regardless of which page the user is on, so this is mounted
// once, globally, in App.tsx (same pattern as SignerSetupPopup) rather than
// being a routed page. Nothing here signs anything until the user clicks
// Approve. Same feature already shipped in the native app's
// WalletConnectRequestScreen.
import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { useWalletStore } from "@/store/walletStore";
import {
  onSessionRequest,
  approveRequest,
  rejectRequest,
  getSessionAddress,
  type SessionRequestEvent,
} from "@/lib/walletconnect-provider";

const CHAIN_ID_FROM_CAIP = (caip: string): number => Number(caip.split(":")[1]);

export function WalletConnectRequestModal() {
  const getActiveWalletClientForChain = useWalletStore(s => s.getActiveWalletClientForChain);
  const wallets = useWalletStore(s => s.wallets);
  const activeWalletId = useWalletStore(s => s.activeWalletId);
  const activeAccountIndex = useWalletStore(s => s.activeAccountIndex);
  const activeAddress = wallets.find(w => w.id === activeWalletId)?.accounts.find(a => a.index === activeAccountIndex)?.address;

  const [request, setRequest] = useState<SessionRequestEvent | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSessionRequest(r => { setError(null); setRequest(r); }), []);

  if (!request) return null;

  const { method, params } = request.params.request;
  const chainId = CHAIN_ID_FROM_CAIP(request.params.chainId);
  // The address the dApp's session was actually granted, vs whatever wallet
  // happens to be active right now -- these can diverge if the user
  // switched wallets after approving the session. Signing with the wrong
  // one would be a real security bug, not just a display glitch, so this
  // blocks Approve entirely on mismatch rather than silently signing with
  // whichever wallet is currently active.
  const sessionAddress = getSessionAddress(request.topic);
  const addressMismatch = !!sessionAddress && !!activeAddress && sessionAddress.toLowerCase() !== activeAddress.toLowerCase();

  async function handleReject() {
    await rejectRequest(request!.id, request!.topic, "User rejected the request.");
    setRequest(null);
  }

  async function handleApprove() {
    if (addressMismatch) {
      setError("This session was approved for a different wallet than the one currently active. Switch back to that wallet to continue.");
      return;
    }
    setProcessing(true);
    setError(null);
    try {
      const walletClient = await getActiveWalletClientForChain(chainId);
      if (!walletClient?.account) throw new Error("This wallet can't sign -- it's watch-only.");
      if (sessionAddress && walletClient.account.address.toLowerCase() !== sessionAddress.toLowerCase()) {
        throw new Error("Active wallet no longer matches this session. Switch back to the original wallet to continue.");
      }

      let result: unknown;
      if (method === "personal_sign") {
        const [messageHex] = params as [string, string];
        result = await walletClient.signMessage({ account: walletClient.account, message: { raw: messageHex as `0x${string}` } });
      } else if (method === "eth_signTypedData_v4") {
        const [, typedDataJson] = params as [string, string];
        const typedData = JSON.parse(typedDataJson);
        if (typedData?.types?.EIP712Domain) delete typedData.types.EIP712Domain;
        result = await walletClient.signTypedData({
          account: walletClient.account,
          domain: typedData.domain,
          types: typedData.types,
          primaryType: typedData.primaryType,
          message: typedData.message,
        });
      } else if (method === "eth_sendTransaction") {
        const [tx] = params as [{ from: string; to?: string; value?: string; data?: string; gas?: string }];
        result = await walletClient.sendTransaction({
          account: walletClient.account,
          chain: walletClient.chain,
          to: tx.to as `0x${string}` | undefined,
          value: tx.value ? BigInt(tx.value) : undefined,
          data: tx.data as `0x${string}` | undefined,
          gas: tx.gas ? BigInt(tx.gas) : undefined,
        });
      } else {
        throw new Error(`Unsupported request method: ${method}`);
      }

      await approveRequest(request!.id, request!.topic, result);
      setRequest(null);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to complete the request.";
      setError(message);
      await rejectRequest(request!.id, request!.topic, message).catch(() => {});
    } finally {
      setProcessing(false);
    }
  }

  const host = request.verifyContext?.verified?.origin ?? "A connected dApp";
  const displayError = addressMismatch
    ? (error ?? "This session was approved for a different wallet than the one currently active. Switch back to that wallet to continue.")
    : error;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border p-5 space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-foreground">Signing Request</span>
          <button onClick={handleReject} className="p-1"><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>
        <p className="text-xs text-muted-foreground truncate">{host}</p>
        <div className="rounded-xl border border-border bg-muted/40 p-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">{method}</p>
          <p className="text-xs font-mono text-foreground break-all line-clamp-6">{JSON.stringify(params)}</p>
        </div>
        {displayError && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
            <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{displayError}</p>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={handleReject} disabled={processing} className="flex-1 py-3.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50">
            Reject
          </button>
          <button
            onClick={handleApprove}
            disabled={processing || addressMismatch}
            className="flex-1 py-3.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Approve"}
          </button>
        </div>
      </div>
    </div>
  );
}
