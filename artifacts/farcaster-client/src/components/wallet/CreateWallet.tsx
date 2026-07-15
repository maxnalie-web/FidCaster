import React, { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { wordlist } from "@scure/bip39/wordlists/english";
import { useWalletStore } from "@/store/walletStore";

type Step = "generate" | "reveal" | "confirm";

function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildChallenge(words: string[]) {
  const indices = shuffle(words.map((_, i) => i)).slice(0, 3).sort((a, b) => a - b);
  const correct = indices.map(i => words[i]);
  const used = new Set(words);
  const decoys: string[] = [];
  while (decoys.length < 6) {
    const c = wordlist[Math.floor(Math.random() * wordlist.length)];
    if (!used.has(c) && !decoys.includes(c)) decoys.push(c);
  }
  return { indices, correct, bank: shuffle([...correct, ...decoys]) };
}

interface Props {
  onDone: () => void;
  onBack: () => void;
}

export function CreateWallet({ onDone, onBack }: Props) {
  const beginWalletCreation = useWalletStore(s => s.beginWalletCreation);
  const finalizeWalletCreation = useWalletStore(s => s.finalizeWalletCreation);
  const discardPendingWallet = useWalletStore(s => s.discardPendingWallet);

  const [step, setStep] = useState<Step>("generate");
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWords, setShowWords] = useState(false);

  const pendingRef = useRef<{ walletId: string; address: `0x${string}` } | null>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    return () => {
      if (pendingRef.current && !confirmedRef.current) {
        discardPendingWallet(pendingRef.current.walletId).catch(() => {});
      }
    };
  }, [discardPendingWallet]);

  const words = useMemo(() => (mnemonic ? mnemonic.split(" ") : []), [mnemonic]);
  const challenge = useMemo(() => (words.length === 12 ? buildChallenge(words) : null), [words]);
  const [picked, setPicked] = useState<string[]>([]);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const onGenerate = async () => {
    setError(null);
    setGenerating(true);
    try {
      const { walletId, mnemonic: phrase, address } = await beginWalletCreation();
      pendingRef.current = { walletId, address };
      setMnemonic(phrase);
      setStep("reveal");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const onConfirm = () => {
    if (!challenge || !pendingRef.current) return;
    const ok = challenge.correct.every((w, i) => picked[i] === w);
    if (ok) {
      confirmedRef.current = true;
      finalizeWalletCreation(pendingRef.current.walletId, pendingRef.current.address);
      onDone();
    } else {
      setConfirmError("That doesn't match. Try again.");
      setPicked([]);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <span className="text-base font-bold text-foreground">Create Wallet</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {step === "generate" && (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl bg-primary/5 border border-primary/20 space-y-2">
              <div className="flex items-center gap-2">
                <ShieldCheck size={18} className="text-primary" />
                <span className="text-sm font-bold text-foreground">Your keys, your funds</span>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">
                We'll generate a 12-word recovery phrase. Write it down and store it somewhere safe —
                it's the only way to recover your wallet if you lose this device.
              </p>
            </div>

            {error && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-sm text-destructive">
                {error}
              </div>
            )}

            <button
              onClick={onGenerate}
              disabled={generating}
              className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base hover:bg-primary/90 disabled:opacity-50 transition-all shadow-lg shadow-primary/20"
            >
              {generating ? "Generating…" : "Generate Wallet"}
            </button>
          </div>
        )}

        {step === "reveal" && mnemonic && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 font-medium">
              ⚠️ Never share this phrase. Anyone with it has full access to your funds.
            </div>

            <div className="relative">
              <div
                className={`p-4 rounded-2xl bg-card border border-border grid grid-cols-3 gap-2 transition-all ${!showWords ? "blur-sm select-none" : ""}`}
                style={{ userSelect: showWords ? "text" : "none" }}
              >
                {words.map((w, i) => (
                  <div key={i} className="flex items-center gap-1.5 bg-muted/40 rounded-lg px-2.5 py-2">
                    <span className="text-[10px] text-muted-foreground w-4 font-mono">{i + 1}.</span>
                    <span className="text-xs font-semibold text-foreground">{w}</span>
                  </div>
                ))}
              </div>
              {!showWords && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    onClick={() => setShowWords(true)}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-semibold hover:bg-primary/20 transition-colors"
                  >
                    <Eye size={15} />
                    Tap to reveal phrase
                  </button>
                </div>
              )}
            </div>

            {showWords && (
              <button
                onClick={() => setShowWords(false)}
                className="flex items-center gap-1.5 text-xs text-muted-foreground mx-auto"
              >
                <EyeOff size={12} /> Hide phrase
              </button>
            )}

            <button
              onClick={() => setStep("confirm")}
              className="w-full py-4 rounded-2xl bg-primary text-white font-bold text-base hover:bg-primary/90 transition-all shadow-lg shadow-primary/20"
            >
              I've Written It Down →
            </button>
          </div>
        )}

        {step === "confirm" && challenge && (
          <div className="space-y-4">
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-foreground">Confirm your backup</h3>
              <p className="text-xs text-muted-foreground">
                Tap the words in order: {challenge.indices.map(i => `#${i + 1}`).join(", ")}
              </p>
            </div>

            <div className="flex gap-2">
              {challenge.correct.map((_, i) => (
                <div
                  key={i}
                  className="flex-1 min-h-[40px] rounded-xl border border-border bg-muted/40 flex items-center justify-center"
                >
                  <span className="text-xs font-semibold text-foreground">{picked[i] ?? ""}</span>
                </div>
              ))}
            </div>

            {confirmError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                {confirmError}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {challenge.bank.map((w, i) => {
                const used = picked.includes(w);
                return (
                  <button
                    key={`${w}-${i}`}
                    disabled={used}
                    onClick={() => {
                      if (picked.length < challenge.correct.length) {
                        setConfirmError(null);
                        setPicked(p => [...p, w]);
                      }
                    }}
                    className={`px-3.5 py-2 rounded-full text-xs font-semibold border transition-all ${used ? "opacity-30 bg-muted border-border" : "bg-card border-border hover:bg-muted/60 text-foreground"}`}
                  >
                    {w}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPicked(p => p.slice(0, -1))}
                disabled={picked.length === 0}
                className="flex-1 py-3.5 rounded-2xl border border-border bg-muted/40 text-sm font-bold text-muted-foreground disabled:opacity-40"
              >
                Undo
              </button>
              <button
                onClick={onConfirm}
                disabled={picked.length !== challenge.correct.length}
                className="flex-[2] py-3.5 rounded-2xl bg-primary text-white font-bold text-sm disabled:opacity-40 shadow-lg shadow-primary/20"
              >
                Confirm Backup
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
