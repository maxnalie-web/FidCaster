import { useState, useCallback } from "react";
import {
  Loader2, ChevronLeft, X, KeyRound, Wallet, QrCode, Plus, LogOut, CheckCircle2, UserCircle,
} from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { FarcasterSignIn } from "@/components/FarcasterSignIn";
import { createWalletClient, custom } from "viem";
import { optimism } from "viem/chains";
import { cn } from "@/lib/utils";

/**
 * Split out of DashboardPage.tsx so DesktopSidebar.tsx (used by every
 * top-level page, not just the dashboard tab shell) can reuse the same
 * account-switcher UI without creating a DashboardPage <-> DesktopSidebar
 * import cycle (DashboardPage embeds ProfilePage, which now also mounts
 * DesktopSidebar for its standalone route).
 */

/* ─── Add Account Modal ──────────────────────────────────────────────────── */
type AddMethod = "pick" | "mnemonic" | "wallet" | "farcaster";

export function AddAccountModal({ onClose, onAdd }: { onClose: () => void; onAdd: (m: string) => Promise<void> }) {
  const { loginWithWallet } = useWallet();
  const [method, setMethod] = useState<AddMethod>("pick");
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(Array(12).fill(""));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleWordCountChange(n: 12 | 24) {
    setWordCount(n); setWords(Array(n).fill("")); setError(null);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").trim().split(/\s+/);
    if (pasted.length === 12 || pasted.length === 24) {
      e.preventDefault();
      const n = pasted.length as 12 | 24;
      setWordCount(n); setWords(pasted.slice(0, n));
    } else if (pasted.length > 12) {
      e.preventDefault(); setWords(pasted.slice(0, wordCount));
    }
  }

  async function handleAddMnemonic() {
    const filled = words.map((w) => w.trim().toLowerCase());
    if (filled.some((w) => !w)) { setError(`Please fill in all ${wordCount} words.`); return; }
    setLoading(true); setError(null);
    try { await onAdd(filled.join(" ")); onClose(); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : "Failed to add account."); }
    finally { setLoading(false); }
  }

  const handleAddWallet = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ethereum = (window as any)?.ethereum;
      if (!ethereum?.request) throw new Error("No wallet found. Install MetaMask.");
      const accounts: string[] = await ethereum.request({ method: "eth_requestAccounts" });
      if (!accounts.length) throw new Error("No accounts returned.");
      const wc = createWalletClient({ account: accounts[0] as `0x${string}`, chain: optimism, transport: custom(ethereum) });
      await loginWithWallet(wc, accounts[0] as `0x${string}`);
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Wallet connection failed.");
    } finally { setLoading(false); }
  }, [loginWithWallet, onClose]);

  const cols = wordCount === 24 ? 4 : 3;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-background border border-border rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onPaste={method === "mnemonic" ? handlePaste : undefined}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {method !== "pick" && (
              <button onClick={() => { setMethod("pick"); setError(null); }} className="p-1 text-muted-foreground hover:text-foreground">
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <h3 className="font-bold text-base text-foreground">Add account</h3>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* METHOD PICKER */}
        {method === "pick" && (
          <div className="space-y-2">
            {[
              { id: "mnemonic" as AddMethod, icon: KeyRound, label: "Seed phrase", desc: "12 or 24-word recovery phrase" },
              { id: "wallet"   as AddMethod, icon: Wallet,   label: "Wallet",      desc: "MetaMask or WalletConnect" },
              { id: "farcaster" as AddMethod, icon: QrCode,  label: "Farcaster",   desc: "Scan QR · full read & write" },
            ].map(({ id, icon: Icon, label, desc }) => (
              <button key={id} onClick={() => setMethod(id)}
                className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-border hover:border-primary/40 hover:bg-accent transition-all text-left">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{label}</p>
                  <p className="text-xs text-muted-foreground">{desc}</p>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* MNEMONIC */}
        {method === "mnemonic" && (
          <div>
            <div className="flex gap-1 mb-3 p-0.5 bg-muted rounded-lg w-fit">
              {([12, 24] as const).map((n) => (
                <button key={n} onClick={() => handleWordCountChange(n)}
                  className={cn("px-3 py-1 rounded-md text-xs font-semibold transition-all",
                    wordCount === n ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                  {n} words
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mb-3">Enter or paste your {wordCount}-word seed phrase.</p>
            <div className="grid gap-1.5 mb-4" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {words.map((w, i) => (
                <div key={i} className="word-input-wrapper flex items-center gap-1 px-2 py-1.5">
                  <span className="text-[9px] text-muted-foreground/60 font-mono shrink-0 w-4">{i + 1}.</span>
                  <input value={w} onChange={(e) => { const nw = [...words]; nw[i] = e.target.value; setWords(nw); }}
                    className="w-full bg-transparent text-xs text-foreground outline-none" autoComplete="off" spellCheck={false} />
                </div>
              ))}
            </div>
            {error && <p className="text-xs text-destructive mb-3">{error}</p>}
            <button onClick={handleAddMnemonic} disabled={loading}
              className="w-full py-2.5 rounded-full btn-luxury text-white text-sm font-semibold flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {loading ? "Adding…" : "Add account"}
            </button>
          </div>
        )}

        {/* WALLET */}
        {method === "wallet" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Connect your MetaMask wallet to add this account.</p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <button onClick={handleAddWallet} disabled={loading}
              className="w-full py-2.5 rounded-full btn-luxury text-white text-sm font-semibold flex items-center justify-center gap-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
              {loading ? "Connecting…" : "Connect Wallet"}
            </button>
          </div>
        )}

        {/* FARCASTER */}
        {method === "farcaster" && (
          <FarcasterSignIn onBack={() => setMethod("pick")} onDone={onClose} />
        )}
      </div>
    </div>
  );
}

/* ─── Account Dropdown Panel ─────────────────────────────────────────────── */
export function AccountDropdownPanel({
  accounts, currentFid, onSwitch, onAddAccount, onLogout, onRemoveAccount,
}: {
  accounts: { fid: number; username?: string; pfpUrl?: string }[];
  currentFid: number;
  onSwitch: (fid: number) => void;
  onAddAccount: () => void;
  onLogout: () => void;
  onRemoveAccount: (fid: number) => void;
}) {
  return (
    <div className="absolute left-0 bottom-full mb-2 bg-popover border border-border rounded-2xl p-1.5 min-w-[240px] shadow-2xl z-50">
      <div className="px-2.5 py-1.5 mb-1">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Accounts</p>
      </div>
      {/* cap to 4 rows visible (~36px each) */}
      <div className="overflow-y-auto" style={{ maxHeight: "160px" }}>
        {accounts.map((acc) => (
          <div key={acc.fid} className="flex items-center group">
            <button
              onClick={() => { if (acc.fid !== currentFid) onSwitch(acc.fid); }}
              className={cn(
                "flex-1 flex items-center gap-2.5 px-2.5 py-2 rounded-full text-xs transition-colors min-w-0",
                acc.fid === currentFid ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <div className="w-7 h-7 rounded-full overflow-hidden bg-muted shrink-0">
                {acc.pfpUrl ? <img src={acc.pfpUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <UserCircle className="w-full h-full p-1 text-muted-foreground" />}
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="font-semibold truncate">{acc.username || `FID ${acc.fid}`}</p>
                <p className="opacity-60 font-mono text-[9px]">FID {acc.fid}</p>
              </div>
              {acc.fid === currentFid && <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />}
            </button>
            {acc.fid !== currentFid && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveAccount(acc.fid); }}
                className="shrink-0 mr-1.5 p-1 rounded-full opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                title="Remove account"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="h-px bg-border my-1" />
      <button onClick={onAddAccount} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-full text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <Plus className="w-3.5 h-3.5" /> Add account
      </button>
      <button onClick={onLogout} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-full text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/8 transition-colors">
        <LogOut className="w-3.5 h-3.5" /> Sign out
      </button>
    </div>
  );
}
