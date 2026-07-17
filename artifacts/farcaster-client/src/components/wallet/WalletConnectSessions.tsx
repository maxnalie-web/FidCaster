// PROVIDER-mode WalletConnect session manager: lists dApps currently
// connected to this app (this app acting as their wallet), lets the user
// disconnect a session, pair with a new dApp by pasting a wc:... URI, and
// approve/reject incoming session proposals. See lib/walletconnect-provider.ts
// for the underlying SignClient wrapper -- nothing here signs or approves
// anything without the user clicking Approve on the proposal modal below.
// Same feature already shipped in the native app's WalletConnectSessionsScreen.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link2, Plus, Trash2, X, AlertTriangle, Loader2 } from "lucide-react";
import { useWalletStore } from "@/store/walletStore";
import {
  initWalletConnectProvider,
  onSessionProposal,
  getActiveSessions,
  disconnectSession,
  pairWithUri,
  approveSession,
  rejectSession,
  type SessionInfo,
  type SessionProposalEvent,
} from "@/lib/walletconnect-provider";

// Both chains this app's active wallet can transact on for a WalletConnect
// session -- kept in sync with the same pairing used elsewhere for signer
// registration (Optimism) / USDC balances (Base).
const OFFERED_CHAIN_IDS = [10, 8453];

export function WalletConnectSessions({ onClose }: { onClose: () => void }) {
  const wallets = useWalletStore(s => s.wallets);
  const activeWalletId = useWalletStore(s => s.activeWalletId);
  const activeAccountIndex = useWalletStore(s => s.activeAccountIndex);
  const activeWallet = wallets.find(w => w.id === activeWalletId);
  const address = activeWallet?.accounts.find(a => a.index === activeAccountIndex)?.address;
  const isWatchOnly = activeWallet?.kind === "watch-only";

  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [pairOpen, setPairOpen] = useState(false);
  const [uriInput, setUriInput] = useState("");
  const [pairing, setPairing] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<SessionProposalEvent | null>(null);
  const [approving, setApproving] = useState(false);
  const initedRef = useRef(false);

  const refreshSessions = useCallback(async () => {
    setLoading(true);
    try {
      setSessions(await getActiveSessions());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initedRef.current) return;
    initedRef.current = true;
    initWalletConnectProvider()
      .then(refreshSessions)
      .catch(() => setLoading(false));
  }, [refreshSessions]);

  useEffect(() => onSessionProposal(p => setProposal(p)), []);

  async function handlePair() {
    const uri = uriInput.trim();
    if (!uri) return;
    setPairing(true);
    setPairError(null);
    try {
      await pairWithUri(uri);
      setPairOpen(false);
      setUriInput("");
    } catch (e) {
      setPairError(e instanceof Error ? e.message : "Failed to pair with that URI.");
    } finally {
      setPairing(false);
    }
  }

  async function handleDisconnect(topic: string) {
    await disconnectSession(topic);
    refreshSessions();
  }

  async function handleApprove() {
    if (!proposal || !address || isWatchOnly) return;
    setApproving(true);
    try {
      await approveSession(proposal.id, address as `0x${string}`, OFFERED_CHAIN_IDS);
      setProposal(null);
      refreshSessions();
    } catch {
      /* leave modal open so the user can retry or reject explicitly */
    } finally {
      setApproving(false);
    }
  }

  async function handleReject() {
    if (!proposal) return;
    await rejectSession(proposal.id);
    setProposal(null);
  }

  const proposerMeta = proposal?.params.proposer.metadata;
  const requestedChains = proposal
    ? [...new Set([...Object.values(proposal.params.requiredNamespaces), ...Object.values(proposal.params.optionalNamespaces)].flatMap(ns => ns.chains ?? []))]
    : [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border flex flex-col max-h-[85vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <span className="text-base font-bold text-foreground">Connected dApps</span>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-5 space-y-2">
          <button
            onClick={() => setPairOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-border text-primary text-sm font-bold hover:bg-primary/5 transition-colors"
          >
            <Plus className="w-4 h-4" /> Connect to dApp
          </button>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 px-4 text-center">
              <Link2 className="w-8 h-8 text-muted-foreground/40" />
              <p className="text-xs text-muted-foreground">
                No dApps connected yet. Tap "Connect to dApp" and paste a WalletConnect URI to get started.
              </p>
            </div>
          ) : (
            sessions.map(session => (
              <div key={session.topic} className="flex items-center gap-3 p-3.5 rounded-2xl border border-border bg-card">
                {session.icon ? (
                  <img src={session.icon} alt="" className="w-10 h-10 rounded-xl bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-muted" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground truncate">{session.name || "Unknown dApp"}</p>
                  <p className="text-xs text-muted-foreground truncate">{session.url}</p>
                </div>
                <button
                  onClick={() => handleDisconnect(session.topic)}
                  className="w-9 h-9 rounded-xl border border-destructive/40 flex items-center justify-center hover:bg-destructive/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Paste wc:// URI */}
      {pairOpen && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={() => setPairOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border p-5 space-y-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-foreground">Connect to a dApp</span>
              <button onClick={() => setPairOpen(false)} className="p-1"><X className="w-4 h-4 text-muted-foreground" /></button>
            </div>
            <p className="text-xs text-muted-foreground">Paste the WalletConnect URI (starts with "wc:") shown by the dApp.</p>
            <textarea
              value={uriInput}
              onChange={e => setUriInput(e.target.value)}
              placeholder="wc:..."
              rows={3}
              className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-xs font-mono text-foreground outline-none focus:border-primary/50"
            />
            {pairError && <p className="text-xs text-destructive">{pairError}</p>}
            <button
              onClick={handlePair}
              disabled={!uriInput.trim() || pairing}
              className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {pairing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Connect"}
            </button>
          </div>
        </div>
      )}

      {/* Incoming session proposal */}
      {proposal && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border p-5 space-y-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Connect to dApp</p>
            <div className="flex items-center gap-3">
              {proposerMeta?.icons?.[0] ? (
                <img src={proposerMeta.icons[0]} alt="" className="w-11 h-11 rounded-2xl bg-muted" />
              ) : (
                <div className="w-11 h-11 rounded-2xl bg-muted" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-foreground truncate">{proposerMeta?.name ?? "Unknown dApp"}</p>
                <p className="text-xs text-muted-foreground truncate">{proposerMeta?.url}</p>
              </div>
            </div>

            {isWatchOnly ? (
              <div className="flex items-start gap-2 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 shrink-0 mt-0.5" />
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  Your active wallet is watch-only and can't sign or send transactions, so it can't approve dApp connections. Switch to a signing wallet first.
                </p>
              </div>
            ) : !address ? (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3">
                <AlertTriangle className="w-3.5 h-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">No active wallet to connect.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-border bg-muted/40 overflow-hidden divide-y divide-border/50">
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-muted-foreground">Account</span>
                  <span className="text-[11px] font-mono text-foreground">{address.slice(0, 10)}…{address.slice(-8)}</span>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <span className="text-[13px] text-muted-foreground">Requested chains</span>
                  <span className="text-xs font-semibold text-foreground">{requestedChains.length ? requestedChains.join(", ") : "eip155 (default)"}</span>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={handleReject} className="flex-1 py-3.5 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={isWatchOnly || !address || approving}
                className="flex-1 py-3.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Approve"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
