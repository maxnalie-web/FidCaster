import { neynarScore, type NeynarUser } from "@/lib/neynar";
import { getSpamLabelsFor, getCachedSpamLabel } from "@/lib/spam-labels";

export type SpamLabelFilter = "any" | "not-spam" | "spam-only";

export interface CustomFeed {
  id: string;
  name: string;
  /** Optional square logo, validated at upload time · shown on the feed tab/dropdown. */
  logoUrl?: string;
  /** Accounts whose casts should appear. Every filter below (including this
   *  one) is independent and optional · any combination is valid, and none
   *  of them require another to be set. */
  accountFids: number[];
  /** Cached label/avatar for each fid above, so the builder UI doesn't need to
   *  re-fetch every profile just to render the picked-accounts list. */
  accounts: { fid: number; username: string; pfp_url?: string }[];
  /** Only show casts containing at least one of these (case-insensitive). Empty = no keyword filter. */
  keywords: string[];
  /** 0-99, mirrors Grow's "min Neynar score" filter. 0 = no filter. */
  minNeynarScore: number;
  /** Minimum author follower count. 0 = no filter. */
  minFollowers: number;
  /** Farcaster's real published spam label (0 = spam, 2 = not spam) · see src/lib/spam-labels.ts. */
  spamLabel: SpamLabelFilter;
}

function storageKey(fid: number): string {
  return `fc_custom_feeds_${fid}`;
}

export const DEFAULT_CUSTOM_FEED_FILTERS = {
  minNeynarScore: 0,
  minFollowers: 0,
  spamLabel: "any" as SpamLabelFilter,
};

/** Migrates feeds saved before the score/follower/spam-label filters existed. */
function withDefaults(feed: Partial<CustomFeed>): CustomFeed {
  return {
    minNeynarScore: 0,
    minFollowers: 0,
    spamLabel: "any",
    ...feed,
  } as CustomFeed;
}

export function getCustomFeeds(fid: number): CustomFeed[] {
  try {
    const raw = localStorage.getItem(storageKey(fid));
    const parsed = raw ? (JSON.parse(raw) as Partial<CustomFeed>[]) : [];
    return parsed.map(withDefaults);
  } catch { return []; }
}

function save(fid: number, feeds: CustomFeed[]): void {
  try { localStorage.setItem(storageKey(fid), JSON.stringify(feeds)); } catch {}
}

export function saveCustomFeed(fid: number, feed: CustomFeed): CustomFeed[] {
  const feeds = getCustomFeeds(fid);
  const idx = feeds.findIndex((f) => f.id === feed.id);
  const next = idx >= 0 ? feeds.map((f, i) => (i === idx ? feed : f)) : [...feeds, feed];
  save(fid, next);
  return next;
}

export function deleteCustomFeed(fid: number, id: string): CustomFeed[] {
  const next = getCustomFeeds(fid).filter((f) => f.id !== id);
  save(fid, next);
  return next;
}

export function matchesKeywords(text: string, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const lower = text.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase()));
}

/** Prefetches the real spam-label dataset for a batch of authors, so `matchesAuthorFilters`
 *  below can filter synchronously afterward. Only needed when a feed's spamLabel filter is on. */
export async function prefetchSpamLabels(fids: number[]): Promise<void> {
  await getSpamLabelsFor(fids);
}

/** Applies the score/follower/spam-label author filters · each is independent and optional. */
export function matchesAuthorFilters(author: NeynarUser, feed: CustomFeed): boolean {
  if (feed.minFollowers > 0 && (author.follower_count ?? 0) < feed.minFollowers) return false;
  if (feed.minNeynarScore > 0) {
    const s = neynarScore(author);
    if (s !== undefined && s * 100 < feed.minNeynarScore) return false;
  }
  if (feed.spamLabel !== "any") {
    const label = getCachedSpamLabel(author.fid);
    // Unlabelled FIDs ("unknown" in the real dataset) are kept rather than
    // dropped · absence isn't evidence either way.
    if (label !== undefined) {
      if (feed.spamLabel === "not-spam" && label !== 2) return false;
      if (feed.spamLabel === "spam-only" && label !== 0) return false;
    }
  }
  return true;
}

const MAX_LOGO_BYTES = 1_000_000; // 1MB
const MIN_LOGO_DIM = 64;
const MAX_LOGO_DIM = 1024;
const MAX_ASPECT_SKEW = 1.15; // must be roughly square

export async function validateFeedLogo(file: File): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/")) return { ok: false, error: "Logo must be an image file." };
  if (file.size > MAX_LOGO_BYTES) return { ok: false, error: "Logo must be smaller than 1MB." };
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
  const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("Not a valid image"));
    img.src = dataUrl;
  }).catch(() => null);
  if (!dims) return { ok: false, error: "Couldn't read that image." };
  if (dims.w < MIN_LOGO_DIM || dims.h < MIN_LOGO_DIM) return { ok: false, error: `Logo must be at least ${MIN_LOGO_DIM}×${MIN_LOGO_DIM}px.` };
  if (dims.w > MAX_LOGO_DIM || dims.h > MAX_LOGO_DIM) return { ok: false, error: `Logo must be at most ${MAX_LOGO_DIM}×${MAX_LOGO_DIM}px.` };
  const skew = Math.max(dims.w, dims.h) / Math.min(dims.w, dims.h);
  if (skew > MAX_ASPECT_SKEW) return { ok: false, error: "Logo must be roughly square." };
  return { ok: true, dataUrl };
}
