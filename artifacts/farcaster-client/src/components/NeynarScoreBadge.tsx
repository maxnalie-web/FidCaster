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

/** Farcaster's real arch mark (official Simple Icons path — the previous
 *  version here was a wrong/different glyph entirely, not the recognizable
 *  Farcaster symbol), in brand purple. */
export function FarcasterLogo({ size = 12, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} className={className} fill="#8A63D2" aria-hidden>
      <path d="M18.24.24H5.76C2.5789.24 0 2.8188 0 6v12c0 3.1811 2.5789 5.76 5.76 5.76h12.48c3.1812 0 5.76-2.5789 5.76-5.76V6C24 2.8188 21.4212.24 18.24.24m.8155 17.1662v.504c.2868-.0256.5458.1905.5439.479v.5688h-5.1437v-.5688c-.0019-.2885.2576-.5047.5443-.479v-.504c0-.22.1525-.402.358-.458l-.0095-4.3645c-.1589-1.7366-1.6402-3.0979-3.4435-3.0979-1.8038 0-3.2846 1.3613-3.4435 3.0979l-.0096 4.3578c.2276.0424.5318.2083.5395.4648v.504c.2863-.0256.5457.1905.5438.479v.5688H4.3915v-.5688c-.0019-.2885.2575-.5047.5438-.479v-.504c0-.2529.2011-.4548.4536-.4724v-7.895h-.4905L4.2898 7.008l2.6405-.0005V5.0419h9.9495v1.9656h2.8219l-.6091 2.0314h-.4901v7.8949c.2519.0177.453.2195.453.4724" />
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
