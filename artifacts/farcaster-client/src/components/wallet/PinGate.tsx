import React, { useEffect, useState } from "react";
import { Lock, X, ShieldCheck } from "lucide-react";
import {
  hasWalletPin, setWalletPin, verifyWalletPin,
  pinLockRemainingMs, recordPinFailure, recordPinSuccess,
} from "@/lib/walletPin";

interface Props {
  open: boolean;
  title?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Gates a sensitive action (revealing a seed phrase / private key) behind a
 * local PIN. First use walks the user through setting one; afterwards it's a
 * straightforward verify prompt. See lib/walletPin.ts for what this does and
 * doesn't protect against.
 */
export function PinGate({ open, title, onSuccess, onCancel }: Props) {
  const [mode, setMode] = useState<"verify" | "create" | "confirm">("verify");
  const [pin, setPin] = useState("");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockMs, setLockMs] = useState(0);

  useEffect(() => {
    if (!open) return;
    setPin(""); setFirstPin(""); setError(null); setBusy(false);
    setMode(hasWalletPin() ? "verify" : "create");
    setLockMs(pinLockRemainingMs());
  }, [open]);

  useEffect(() => {
    if (lockMs <= 0) return;
    const t = setInterval(() => {
      const rem = pinLockRemainingMs();
      setLockMs(rem);
      if (rem <= 0) clearInterval(t);
    }, 500);
    return () => clearInterval(t);
  }, [lockMs]);

  if (!open) return null;

  async function submit() {
    if (busy) return;
    setError(null);

    if (mode === "create") {
      if (pin.length < 4) { setError("PIN must be at least 4 characters."); return; }
      setFirstPin(pin);
      setPin("");
      setMode("confirm");
      return;
    }

    if (mode === "confirm") {
      if (pin !== firstPin) {
        setError("PINs didn't match. Try again.");
        setPin(""); setFirstPin(""); setMode("create");
        return;
      }
      setBusy(true);
      try {
        await setWalletPin(pin);
        onSuccess();
      } finally {
        setBusy(false);
      }
      return;
    }

    // verify
    const remaining = pinLockRemainingMs();
    if (remaining > 0) {
      setError(`Too many attempts. Try again in ${Math.ceil(remaining / 1000)}s.`);
      return;
    }
    setBusy(true);
    try {
      const ok = await verifyWalletPin(pin);
      if (ok) {
        recordPinSuccess();
        onSuccess();
      } else {
        recordPinFailure();
        const rem = pinLockRemainingMs();
        setLockMs(rem);
        setError(rem > 0 ? `Too many attempts. Try again in ${Math.ceil(rem / 1000)}s.` : "Wrong PIN.");
        setPin("");
      }
    } finally {
      setBusy(false);
    }
  }

  const heading =
    mode === "create" ? "Set a PIN" :
    mode === "confirm" ? "Confirm your PIN" :
    "Enter your PIN";
  const subtext =
    mode === "create" ? "This PIN protects your recovery phrase and private keys — you'll need it every time you reveal or export one." :
    mode === "confirm" ? "Enter it again to confirm." :
    (title ?? "Required to continue.");

  const locked = lockMs > 0;

  return (
    <div className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm flex items-center justify-center px-5" onClick={onCancel}>
      <div className="bg-card border border-border rounded-2xl p-5 w-full max-w-sm space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              {mode === "create" || mode === "confirm" ? <ShieldCheck size={16} className="text-primary" /> : <Lock size={16} className="text-primary" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-foreground">{heading}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{subtext}</p>
            </div>
          </div>
          <button onClick={onCancel} className="p-1 text-muted-foreground hover:text-foreground shrink-0">
            <X size={18} />
          </button>
        </div>

        <input
          autoFocus
          type="password"
          inputMode="numeric"
          value={pin}
          disabled={busy || locked}
          onChange={e => setPin(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          placeholder={mode === "verify" ? "PIN" : "At least 4 characters"}
          className="w-full bg-muted/40 border border-border rounded-xl px-3 py-3 text-center text-lg tracking-[0.3em] font-bold text-foreground outline-none focus:border-primary/50 disabled:opacity-50"
        />

        {error && <p className="text-xs text-destructive font-semibold text-center">{error}</p>}

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 py-3 rounded-xl border border-border text-sm font-bold text-muted-foreground">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || locked || pin.length < 4}
            className="flex-1 py-3 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-40"
          >
            {busy ? "…" : mode === "create" ? "Next" : mode === "confirm" ? "Confirm" : "Unlock"}
          </button>
        </div>
      </div>
    </div>
  );
}
