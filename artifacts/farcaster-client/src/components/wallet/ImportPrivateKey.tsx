import React, { useState } from "react";
import { isHex } from "viem";
import { useWalletStore } from "@/store/walletStore";

interface Props {
  onDone: () => void;
  onBack: () => void;
}

export function ImportPrivateKey({ onDone, onBack }: Props) {
  const importPrivateKeyWallet = useWalletStore(s => s.importPrivateKeyWallet);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const isValid = isHex(trimmed) && trimmed.length === 66;

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await importPrivateKeyWallet(trimmed);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <span className="text-base font-bold text-foreground">Import Private Key</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 font-medium">
          ⚠️ Never share your private key with anyone. This key gives full control over your wallet.
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border space-y-3">
          <label className="text-xs font-semibold text-muted-foreground">Private Key (0x…)</label>
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
              {isValid ? "✓ Valid private key" : `${trimmed.length}/66 chars · needs 0x + 64 hex chars`}
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
          disabled={!isValid || submitting}
          className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base disabled:opacity-40 hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
        >
          {submitting ? "Importing…" : "Import Private Key"}
        </button>
      </div>
    </div>
  );
}
