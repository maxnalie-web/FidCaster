import React from "react";
import { KeyRound, FileKey, Eye, BookUser, ChevronRight } from "lucide-react";
import { useWalletStore, type WalletKind } from "@/store/walletStore";

function kindIcon(kind: WalletKind) {
  if (kind === "seed") return <KeyRound size={15} className="text-primary" />;
  if (kind === "private-key") return <FileKey size={15} className="text-primary" />;
  return <Eye size={15} className="text-primary" />;
}
function kindLabel(kind: WalletKind): string {
  if (kind === "seed") return "Recovery phrase wallet";
  if (kind === "private-key") return "Private key wallet";
  return "Watch-only wallet";
}

interface Props {
  onSelectWallet: (walletId: string) => void;
  onBack: () => void;
}

export function WalletSettings({ onSelectWallet, onBack }: Props) {
  const wallets = useWalletStore(s => s.wallets);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">← Back</button>
        <span className="text-base font-bold text-foreground">Wallet Settings</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-5">
        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">General</p>
          <div className="rounded-2xl bg-card border border-border overflow-hidden">
            <button className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors" onClick={() => alert("Address book — coming soon")}>
              <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                <BookUser size={15} className="text-primary" />
              </div>
              <div className="flex-1 text-left">
                <div className="text-sm font-semibold text-foreground">Address Book</div>
                <div className="text-xs text-muted-foreground">Saved contacts for quick sends</div>
              </div>
              <ChevronRight size={15} className="text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground px-1">Your Wallets</p>
          {wallets.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">No wallets yet.</div>
          ) : (
            <div className="rounded-2xl bg-card border border-border overflow-hidden divide-y divide-border/50">
              {wallets.map(wallet => (
                <button
                  key={wallet.id}
                  onClick={() => onSelectWallet(wallet.id)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-base flex-shrink-0" style={{ backgroundColor: wallet.color }}>
                    {wallet.emoji}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{wallet.label}</div>
                    <div className="text-xs text-muted-foreground">{kindLabel(wallet.kind)}</div>
                  </div>
                  <ChevronRight size={15} className="text-muted-foreground flex-shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
