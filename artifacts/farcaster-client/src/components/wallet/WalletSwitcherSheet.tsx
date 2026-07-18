import React, { useRef, useState } from "react";
import {
  ChevronDown, ChevronRight, Plus, KeyRound, FileKey, Eye,
  ShieldAlert, ArrowUp, ArrowDown, Settings, Copy, CheckCircle2,
} from "lucide-react";
import { useWalletStore, type Wallet } from "@/store/walletStore";
import { PinGate } from "@/components/wallet/PinGate";
import { WalletAvatar } from "./WalletAvatar";

interface Props {
  onClose: () => void;
  onManage: () => void;
  onSettings: () => void;
}

export function WalletSwitcherSheet({ onClose, onManage, onSettings }: Props) {
  const wallets = useWalletStore(s => s.wallets);
  const activeWalletId = useWalletStore(s => s.activeWalletId);
  const activeAccountIndex = useWalletStore(s => s.activeAccountIndex);
  const setActiveWallet = useWalletStore(s => s.setActiveWallet);
  const addAccountToWallet = useWalletStore(s => s.addAccountToWallet);
  const reorderAccounts = useWalletStore(s => s.reorderAccounts);
  const revealPrivateKey = useWalletStore(s => s.revealPrivateKey);

  const [expandedId, setExpandedId] = useState<string | null>(activeWalletId);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const clipClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Exporting a private key requires the wallet PIN - see lib/walletPin.ts.
  const [pinGateFor, setPinGateFor] = useState<{ wallet: Wallet; accountIndex: number } | null>(null);

  function kindIcon(kind: Wallet["kind"]) {
    if (kind === "seed") return KeyRound;
    if (kind === "private-key") return FileKey;
    return Eye;
  }

  async function onCopyAddress(addr: string) {
    await navigator.clipboard.writeText(addr).catch(() => {});
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(a => (a === addr ? null : a)), 2000);
  }

  async function onExportKey(wallet: Wallet, accountIndex: number) {
    try {
      const hex = await revealPrivateKey(wallet.id, accountIndex);
      const confirmed = window.confirm(
        "This key controls your funds. Never share it.\n\nCopy to clipboard? It will be cleared automatically after 60 seconds."
      );
      if (confirmed) {
        await navigator.clipboard.writeText(hex).catch(() => {});
        // Match WalletDetailSettings' reveal flow: never leave a raw private
        // key sitting in the OS clipboard indefinitely.
        if (clipClearRef.current) clearTimeout(clipClearRef.current);
        clipClearRef.current = setTimeout(async () => {
          try {
            const cur = await navigator.clipboard.readText();
            if (cur === hex) await navigator.clipboard.writeText("");
          } catch { /* clipboard read denied / changed - nothing to do */ }
          clipClearRef.current = null;
        }, 60_000);
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not export key.");
    }
  }

  return (
    <div className="flex flex-col max-h-[80vh]">
      <div className="flex items-center justify-between px-5 pt-5 pb-3">
        <span className="text-base font-bold text-foreground">Wallets</span>
        <button
          onClick={onClose}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Done
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-2 space-y-1">
        {wallets.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No wallets yet. Add one below.
          </div>
        )}

        {wallets.map(wallet => {
          const expanded = expandedId === wallet.id;
          const KindIcon = kindIcon(wallet.kind);

          return (
            <div key={wallet.id} className="rounded-2xl overflow-hidden border border-border/40">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                onClick={() => setExpandedId(expanded ? null : wallet.id)}
              >
                <WalletAvatar
                  label={wallet.label}
                  color={wallet.color}
                  seed={wallet.accounts[0]?.address}
                  size={36}
                  className="shadow-sm"
                />
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-semibold text-foreground truncate">{wallet.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {wallet.accounts.length} account{wallet.accounts.length !== 1 ? "s" : ""} · {wallet.kind}
                  </div>
                </div>
                {expanded
                  ? <ChevronDown size={16} className="text-muted-foreground flex-shrink-0" />
                  : <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />}
              </button>

              {wallet.kind === "seed" && wallet.backedUp === false && (
                <div className="mx-3 mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
                  <ShieldAlert size={13} className="text-yellow-500 flex-shrink-0" />
                  <span className="text-xs text-yellow-600 dark:text-yellow-400">
                    Back up this wallet's recovery phrase.
                  </span>
                </div>
              )}

              {expanded && (
                <div className="bg-muted/20 px-3 pb-3 space-y-1">
                  {wallet.accounts.map((account, i) => {
                    const isActive = wallet.id === activeWalletId && account.index === activeAccountIndex;
                    return (
                      <div
                        key={account.index}
                        className={`flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-colors ${isActive ? "bg-primary/10" : "hover:bg-muted/40"}`}
                        onClick={() => { setActiveWallet(wallet.id, account.index); onClose(); }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-foreground">{account.label}</div>
                          <div className="text-[10px] font-mono text-muted-foreground">
                            {account.address.slice(0, 8)}…{account.address.slice(-6)}
                          </div>
                        </div>
                        {isActive && (
                          <CheckCircle2 size={14} className="text-primary flex-shrink-0" />
                        )}
                        <button
                          className="p-1 hover:text-foreground text-muted-foreground transition-colors"
                          onClick={e => { e.stopPropagation(); onCopyAddress(account.address); }}
                        >
                          {copiedAddr === account.address
                            ? <CheckCircle2 size={12} className="text-green-500" />
                            : <Copy size={12} />}
                        </button>
                        {wallet.kind !== "watch-only" && wallet.accounts.length > 1 && (
                          <>
                            <button
                              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={i === 0}
                              onClick={e => { e.stopPropagation(); reorderAccounts(wallet.id, i, i - 1); }}
                            >
                              <ArrowUp size={12} />
                            </button>
                            <button
                              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
                              disabled={i === wallet.accounts.length - 1}
                              onClick={e => { e.stopPropagation(); reorderAccounts(wallet.id, i, i + 1); }}
                            >
                              <ArrowDown size={12} />
                            </button>
                          </>
                        )}
                        {wallet.kind !== "watch-only" && (
                          <button
                            className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                            onClick={e => { e.stopPropagation(); setPinGateFor({ wallet, accountIndex: account.index }); }}
                          >
                            <KeyRound size={12} />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  {wallet.kind === "seed" && (
                    <button
                      className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-primary hover:bg-primary/10 rounded-xl transition-colors w-full"
                      onClick={() => addAccountToWallet(wallet.id)}
                    >
                      <Plus size={13} />
                      Add account
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="px-4 pt-2 pb-4 border-t border-border/40 space-y-1 mt-1">
        <button
          className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl hover:bg-muted/40 transition-colors"
          onClick={onManage}
        >
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Plus size={15} className="text-primary" />
          </div>
          <span className="text-sm font-semibold text-primary">Add or manage wallets</span>
        </button>
        <button
          className="flex items-center gap-3 w-full px-4 py-3 rounded-2xl hover:bg-muted/40 transition-colors"
          onClick={onSettings}
        >
          <div className="w-8 h-8 rounded-full bg-muted/60 flex items-center justify-center">
            <Settings size={15} className="text-muted-foreground" />
          </div>
          <span className="text-sm font-semibold text-muted-foreground">Wallet settings</span>
        </button>
      </div>

      <PinGate
        open={pinGateFor !== null}
        title="Required to export a private key."
        onSuccess={() => {
          const target = pinGateFor;
          setPinGateFor(null);
          if (target) onExportKey(target.wallet, target.accountIndex);
        }}
        onCancel={() => setPinGateFor(null)}
      />
    </div>
  );
}
