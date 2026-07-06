import { cn } from "@/lib/utils";

/** Neynar's ringed-planet mark, reproduced in brand purple. */
export function NeynarLogo({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} aria-hidden>
      <ellipse cx="12" cy="12" rx="10.5" ry="4" transform="rotate(-20 12 12)" fill="none" stroke="#8A63D2" strokeWidth="1.9" />
      <circle cx="12.6" cy="11.2" r="6.6" fill="#8A63D2" />
    </svg>
  );
}

/** The real X (formerly Twitter) wordmark · angular bird-shape, not a generic "X" glyph. */
export function XLogo({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

/** Telegram's paper-plane-in-circle mark. */
export function TelegramLogo({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="currentColor" aria-hidden>
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0Zm5.568 8.16-1.61 8.63c-.036.19-.185.243-.376.183-.19-.06-.94-.53-1.48-.923-.253-.185-.61-.402-.976-.634-.53-.34-.85-.55-1.34-.878-.548-.365-.19-.567.117-.895.08-.086 1.474-1.35 1.502-1.464.004-.014.007-.067-.025-.095-.032-.028-.08-.018-.114-.01-.049.011-.826.526-2.33 1.545-.221.15-.42.224-.598.22-.197-.004-.575-.108-.856-.198-.345-.11-.62-.169-.596-.357.012-.098.148-.198.407-.301 1.596-.694 2.66-1.152 3.19-1.372 1.52-.632 1.834-.741 2.04-.744.045 0 .146.01.211.062.055.043.07.101.077.142.007.041.016.134.009.207Z" />
    </svg>
  );
}

/**
 * Compact Neynar quality-score pill (0–100). Tone reflects reputation:
 * green = high/human, amber = middling, rose = likely spam/low quality.
 */
export function NeynarScoreBadge({ score, className }: { score: number; className?: string }) {
  const pct = Math.round(score * 100);
  const tone =
    score >= 0.85 ? "text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-emerald-500/25" :
    score >= 0.5  ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/25" :
                    "text-rose-600 dark:text-rose-400 bg-rose-500/10 border-rose-500/25";
  return (
    <span
      title={`Neynar quality score ${score.toFixed(2)} · higher = more reputable (spam scores are low)`}
      className={cn(
        // Fixed h-4 (matches the 16px line-height of sibling text/link items in the
        // profile meta row) instead of padding-driven height · otherwise this pill's
        // own line-height + padding made it taller than its row neighbors and it
        // visibly stuck out top and bottom instead of sitting flush in the row.
        "inline-flex items-center h-4 gap-1 px-1.5 rounded-full text-[11px] font-bold border tabular-nums leading-none",
        tone, className
      )}
    >
      <NeynarLogo size={11} className="shrink-0" />
      {pct}
    </span>
  );
}
