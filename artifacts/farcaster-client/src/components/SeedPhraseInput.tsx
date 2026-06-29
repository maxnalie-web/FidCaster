import { useState, useRef, useCallback } from "react";
import { validateWord } from "@/lib/wallet";
import { cn } from "@/lib/utils";

type Props = {
  wordCount: 12 | 24;
  onChange: (words: string[]) => void;
};

export function SeedPhraseInput({ wordCount, onChange }: Props) {
  const [words, setWords] = useState<string[]>(Array(wordCount).fill(""));
  const [touched, setTouched] = useState<boolean[]>(Array(wordCount).fill(false));
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const updateWord = useCallback(
    (index: number, value: string) => {
      const cleaned = value.toLowerCase().replace(/[^a-z]/g, "");
      const newWords = [...words];
      newWords[index] = cleaned;
      setWords(newWords);
      onChange(newWords);
    },
    [words, onChange]
  );

  const handleBlur = useCallback(
    (index: number) => {
      setTouched((prev) => {
        const next = [...prev];
        next[index] = true;
        return next;
      });
    },
    []
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent, startIndex: number) => {
      e.preventDefault();
      const text = e.clipboardData.getData("text");
      const pasted = text
        .trim()
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);

      if (pasted.length >= wordCount) {
        const newWords = pasted.slice(0, wordCount);
        setWords(newWords);
        setTouched(Array(wordCount).fill(true));
        onChange(newWords);
        inputRefs.current[wordCount - 1]?.focus();
        return;
      }

      const newWords = [...words];
      pasted.forEach((word, i) => {
        const idx = startIndex + i;
        if (idx < wordCount) newWords[idx] = word;
      });
      setWords(newWords);
      onChange(newWords);
      const nextIdx = Math.min(startIndex + pasted.length, wordCount - 1);
      inputRefs.current[nextIdx]?.focus();
    },
    [words, wordCount, onChange]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>, index: number) => {
      if (e.key === " " || e.key === "Tab") {
        e.preventDefault();
        inputRefs.current[index + 1]?.focus();
      } else if (e.key === "Backspace" && words[index] === "" && index > 0) {
        const prev = inputRefs.current[index - 1];
        if (prev) {
          prev.focus();
          const len = words[index - 1].length;
          prev.setSelectionRange(len, len);
        }
      }
    },
    [words]
  );

  const cols = wordCount === 24 ? 6 : 4;
  const isWordInvalid = (i: number) =>
    touched[i] && words[i].length > 1 && !validateWord(words[i]);

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {Array.from({ length: wordCount }, (_, i) => (
        <div
          key={i}
          className={cn(
            "word-input-wrapper",
            isWordInvalid(i) && "invalid",
            touched[i] && words[i].length > 1 && validateWord(words[i]) && "valid"
          )}
        >
          <span className="absolute top-1 left-1.5 text-[9px] font-bold text-muted-foreground/60 select-none leading-none">
            {i + 1}
          </span>
          <input
            ref={(el) => { inputRefs.current[i] = el; }}
            type="text"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={words[i]}
            className="w-full pt-4 pb-1.5 px-1.5 text-xs font-mono bg-transparent text-foreground outline-none"
            onChange={(e) => updateWord(i, e.target.value)}
            onBlur={() => handleBlur(i)}
            onPaste={(e) => handlePaste(e, i)}
            onKeyDown={(e) => handleKeyDown(e, i)}
          />
        </div>
      ))}
    </div>
  );
}
