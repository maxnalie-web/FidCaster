import React from "react";
import { Plus, KeyRound, FileKey, Eye, ChevronRight } from "lucide-react";
import { useWalletStore } from "@/store/walletStore";
import { WalletAvatar } from "./WalletAvatar";

type AddMode = "create" | "import" | "import-key" | "watch";

interface Props {
  onAdd: (mode: AddMode) => void;
  onSelectWallet: (walletId: string) => void;
  onBack: () => void;
}

export function WalletsList({ onAdd, onSelectWallet, onBack }: Props) {
  const wallets = useWalletStore(s => s.wallets);
  const activeWalletId = useWalletStore(s => s.activeWalletId);
  const setActiveWallet = useWalletStore(s => s.setActiveWallet);

  const addOptions = [
    {
      mode: "create" as AddMode,
      icon: <Plus size={18} className="text-white" />,
      color: "#6366f1",
      label: "Create a new wallet",
      desc: "Generate fresh seed phrase",
    },
    {
      mode: "import" as AddMode,
      icon: <KeyRound size={18} className="text-white" />,
      color: "#0ea5e9",
      label: "Import seed phrase",
      desc: "Restore from 12 or 24 words",
    },
    {
      mode: "import-key" as AddMode,
      icon: <FileKey size={18} className="text-white" />,
      color: "#f59e0b",
      label: "Import private key",
      desc: "Paste a 0x private key",
    },
    {
      mode: "watch" as AddMode,
      icon: <Eye size={18} className="text-white" />,
      color: "#10b981",
      label: "Watch an address",
      desc: "Track any wallet read-only",
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <span className="text-base font-bold text-foreground">Wallets</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 space-y-3 pb-6">
        {wallets.length > 0 && (
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">
              My Wallets
            </p>
            <div className="grid grid-cols-2 gap-3">
              {wallets.map(wallet => {
                const isActive = wallet.id === activeWalletId;
                const firstAccount = wallet.accounts[0];
                return (
                  <div
                    key={wallet.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => { setActiveWallet(wallet.id, 0); onBack(); }}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveWallet(wallet.id, 0); onBack(); } }}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all cursor-pointer ${isActive ? "border-primary/40 bg-primary/5" : "border-border/40 bg-card hover:bg-muted/30"}`}
                  >
                    {isActive && (
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-primary" />
                    )}
                    <WalletAvatar
                      label={wallet.label}
                      color={wallet.color}
                      seed={firstAccount?.address}
                      size={48}
                      className="shadow-lg"
                    />
                    <div className="text-center min-w-0 w-full">
                      <div className="text-xs font-bold text-foreground truncate">{wallet.label}</div>
                      <div className="text-[10px] text-muted-foreground font-mono truncate">
                        {firstAccount ? `${firstAccount.address.slice(0, 6)}…${firstAccount.address.slice(-4)}` : ""}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5 capitalize">{wallet.kind}</div>
                    </div>
                    <button
                      className="absolute bottom-2 right-2 p-1"
                      onClick={e => { e.stopPropagation(); onSelectWallet(wallet.id); }}
                    >
                      <ChevronRight size={13} className="text-muted-foreground" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2 px-1">
            Add Wallet
          </p>
          <div className="space-y-2">
            {addOptions.map(opt => (
              <button
                key={opt.mode}
                onClick={() => onAdd(opt.mode)}
                className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card border border-border/40 hover:bg-muted/30 transition-colors text-left"
              >
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: opt.color }}
                >
                  {opt.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.desc}</div>
                </div>
                <ChevronRight size={16} className="text-muted-foreground flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
