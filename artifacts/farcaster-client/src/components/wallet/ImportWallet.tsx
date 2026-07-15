import React, { useState } from "react";
import { Eye, EyeOff, ClipboardPaste } from "lucide-react";
import { validateMnemonicWords, validateWord } from "@/lib/wallet";
import { useWalletStore } from "@/store/walletStore";

interface Props {
  onDone: () => void;
  onBack: () => void;
}

function parsePaste(raw: string): string[] {
  return raw
    .trim()
    .toLowerCase()
    .split(/[\s,\n\r\t]+/)
    .map(w => w.replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

export function ImportWallet({ onDone, onBack }: Props) {
  const importSeedWallet = useWalletStore(s => s.importSeedWallet);

  const [mode, setMode] = useState<"grid" | "paste">("grid");
  const [wordCount, setWordCount] = useState<12 | 24>(12);
  const [words, setWords] = useState<string[]>(Array(12).fill(""));
  const [rawText, setRawText] = useState("");
  const [showWords, setShowWords] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setWordCountReset = (n: 12 | 24) => {
    setWordCount(n);
    setWords(Array(n).fill(""));
    setShowWords(false);
  };

  const textWords = parsePaste(rawText);
  const isGridValid = validateMnemonicWords(words);
  const isTextValid = (textWords.length === 12 || textWords.length === 24) && textWords.every(validateWord);
  const isValid = mode === "grid" ? isGridValid : isTextValid;

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const phrase = mode === "grid" ? words.join(" ").toLowerCase().trim() : textWords.join(" ");
      await importSeedWallet(phrase);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePaste = (e: React.ClipboardEvent, startIdx: number) => {
    const pasted = parsePaste(e.clipboardData.getData("text"));
    if (pasted.length > 1) {
      e.preventDefault();
      const next = [...words];
      pasted.slice(0, wordCount).forEach((w, i) => {
        if (startIdx + i < wordCount) next[startIdx + i] = w;
      });
      setWords(next);
      setShowWords(true);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 pt-5 pb-4">
        <button onClick={onBack} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
          ← Back
        </button>
        <span className="text-base font-bold text-foreground">Import Wallet</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">
        <div className="flex items-center gap-1.5 p-1.5 rounded-xl bg-muted/40 border border-border/40 w-fit">
          {(["grid", "paste"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${mode === m ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
            >
              {m === "paste" && <ClipboardPaste size={12} />}
              {m === "grid" ? "Grid" : "Paste"}
            </button>
          ))}
        </div>

        <div className="p-4 rounded-2xl bg-card border border-border space-y-4">
          {mode === "grid" ? (
            <>
              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-muted/40 border border-border/40 w-fit">
                {([12, 24] as const).map(n => (
                  <button
                    key={n}
                    onClick={() => setWordCountReset(n)}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${wordCount === n ? "bg-primary text-white" : "text-muted-foreground"}`}
                  >
                    {n} words
                  </button>
                ))}
              </div>

              <div className="relative">
                <div
                  className={`grid grid-cols-3 gap-2 transition-all ${!showWords ? "blur-sm pointer-events-none" : ""}`}
                >
                  {words.map((w, i) => (
                    <div key={i} className="flex items-center gap-1 bg-muted/40 rounded-lg px-2 py-1.5">
                      <span className="text-[10px] text-muted-foreground w-4 font-mono">{i + 1}.</span>
                      <input
                        className="flex-1 bg-transparent text-xs font-semibold text-foreground outline-none min-w-0 placeholder:text-muted-foreground/40"
                        placeholder="word"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        value={w}
                        onChange={e => {
                          const next = [...words];
                          next[i] = e.target.value.trim().toLowerCase();
                          setWords(next);
                        }}
                        onPaste={e => handlePaste(e, i)}
                      />
                    </div>
                  ))}
                </div>
                {!showWords && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      onClick={() => setShowWords(true)}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary/10 border border-primary/30 text-primary text-sm font-semibold"
                    >
                      <Eye size={14} /> Tap to enter words
                    </button>
                  </div>
                )}
              </div>

              {showWords && (
                <button
                  onClick={() => setShowWords(false)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground mx-auto"
                >
                  <EyeOff size={12} /> Hide words
                </button>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Paste your 12- or 24-word phrase separated by spaces.</p>
              <textarea
                className="w-full bg-muted/40 border border-border rounded-xl p-3 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 outline-none resize-none"
                rows={4}
                placeholder="word1 word2 word3 ..."
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={rawText}
                onChange={e => setRawText(e.target.value)}
              />
              {rawText.length > 0 && (
                <p className={`text-xs font-semibold ${isTextValid ? "text-green-500" : "text-muted-foreground"}`}>
                  {textWords.length} words{isTextValid ? " · ready ✓" : " entered"}
                </p>
              )}
            </>
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
          {submitting ? "Importing…" : "Import Wallet"}
        </button>
      </div>
    </div>
  );
}
