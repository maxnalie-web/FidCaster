import { useId } from "react";
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

/** Telegram's actual brand mark: two-tone blue circle + white paper plane
 *  (previously a flat currentColor glyph, which lost the recognizable blue
 *  circle and just looked like a generic/wrong icon next to the real X logo). */
export function TelegramLogo({ size = 12, className }: { size?: number; className?: string }) {
  const gid = `tg-grad-${useId()}`;
  return (
    <svg viewBox="0 0 240 240" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0.66" x2="0.42" y1="0.17" y2="0.75">
          <stop offset="0" stopColor="#37aee2" />
          <stop offset="1" stopColor="#1e96c8" />
        </linearGradient>
      </defs>
      <circle cx="120" cy="120" r="120" fill={`url(#${gid})`} />
      <path fill="#c8daea" d="M98 175c-3.888 0-3.227-1.468-4.568-5.17L82 132.207 152.667 82" />
      <path fill="#a9c9dd" d="M98 175c3 0 4.325-1.372 6-3l16-15.558-19.958-12.035" />
      <path fill="#fff" d="M100.04 144.41l48.36 35.729c5.519 3.045 9.501 1.468 10.876-5.123l19.685-92.774c2.015-8.08-3.08-11.746-8.36-9.31l-115.59 44.6c-7.89 3.157-7.843 7.548-1.438 9.5l29.663 9.259 68.673-43.325c3.226-1.966 6.184-.91 3.75 1.257" />
    </svg>
  );
}

/** Farcaster's app-icon mark (rounded square + wordmark glyph), in brand purple. */
export function FarcasterLogo({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="#8A63D2" aria-hidden>
      <path d="M18.24.24H5.76C2.5789.24 0 2.8188 0 6v12c0 3.1811 2.5789 5.76 5.76 5.76h12.48c3.1812 0 5.76-2.5789 5.76-5.76V6C24 2.8188 21.4212.24 18.24.24Zm.8759 17.1043v.5478a.8615.8615 0 0 1 .5688.8098v.6035h-4.2418v-.6035a.8615.8615 0 0 1 .5688-.8098v-.5478c0-.2242.1355-.4234.3395-.5041a.4788.4788 0 0 0 .2856-.4463v-2.4906c0-.2242.1355-.4234.3395-.5041.1355-.0517.2856-.0517.4211 0 .2039.0807.3395.2799.3395.5041v2.4906c0 .1889.1188.3562.2856.4463.204.0807.3395.2799.3395.5041ZM12.72 9.6H9.36v1.68h1.5228l-1.152 6.1949a.7202.7202 0 0 1-.708.5748.72.72 0 0 1-.708-.5748L6.7627 9.6H4.32l1.752 9.408c.156.8353.912 1.44 1.788 1.44.8759 0 1.632-.6047 1.788-1.44l.612-3.288.612 3.288c.156.8353.912 1.44 1.788 1.44.876 0 1.632-.6047 1.788-1.44L16.68 9.6H12.72Z" />
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
