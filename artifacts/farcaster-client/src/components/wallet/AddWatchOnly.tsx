import React, { useState } from "react";
import { isAddress } from "viem";
import { useWalletStore } from "@/store/walletStore";

interface Props {
  onDone: () => void;
  onBack: () => void;
}

export function AddWatchOnly({ onDone, onBack }: Props) {
  const addWatchOnlyWallet = useWalletStore(s => s.addWatchOnlyWallet);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim() as `0x${string}`;
  const isValid = isAddress(trimmed);

  const onSubmit = () => {
    setError(null);
    try {
      addWatchOnlyWallet(trimmed);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <span className="text-base font-bold text-foreground">Watch Address</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Track any wallet's balance and activity without importing its private key. Watch-only wallets can't sign transactions.
        </p>

        <div className="p-4 rounded-2xl bg-card border border-border space-y-3">
          <label className="text-xs font-semibold text-muted-foreground">Ethereum Address (0x…)</label>
          <input
            className="w-full bg-muted/40 border border-border rounded-xl px-3 py-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 transition-colors"
            placeholder="0x..."
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={value}
            onChange={e => setValue(e.target.value)}
          />
          {trimmed.length > 0 && (
            <p className={`text-xs font-semibold ${isValid ? "text-green-500" : "text-muted-foreground"}`}>
              {isValid ? "✓ Valid address" : "Enter a valid 0x Ethereum address"}
            </p>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
            {error}
          </div>
        )}

        <button
          onClick={onSubmit}
          disabled={!isValid}
          className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base disabled:opacity-40 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
        >
          Watch Address
        </button>
      </div>
    </div>
  );
}
