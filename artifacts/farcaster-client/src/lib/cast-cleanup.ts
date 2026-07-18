// Fetches "your most recent N casts/replies/likes/recasts" for the Purge
// tool (CleanupCastsPanel). The actual bulk delete/unlike/un-recast execution
// lives in CleanupOpContext; this module only answers "which items would a
// cleanup of N act on," which the panel needs up front to show a confirm
// dialog before handing the list off to the context.
import {
  getUserCasts,
  getUserReplies,
  getUserLikes,
  getUserRecasts,
  type NeynarCast,
} from "@/lib/neynar";

export type CleanupKind = "casts" | "replies" | "unlike" | "unrecast";

async function fetchPage(
  fid: number,
  kind: CleanupKind,
  neynarKey: string,
  cursor: string | undefined,
): Promise<{ items: NeynarCast[]; next?: string }> {
  // Bulk-scan pages (replies/likes/recasts) always use the server's fast,
  // uncached direct-passthrough route, which transparently rotates through
  // however many Neynar keys are configured server-side (env vars) - no
  // client-side pool/config of any kind.
  if (kind === "casts") {
    const r = await getUserCasts(fid, fid, neynarKey, cursor, 150);
    return { items: r.casts, next: r.next?.cursor };
  }
  if (kind === "replies") {
    const r = await getUserReplies(fid, fid, neynarKey, cursor, true);
    return { items: r.casts, next: r.next?.cursor };
  }
  if (kind === "unlike") {
    const r = await getUserLikes(fid, fid, neynarKey, cursor, true);
    return { items: r.reactions.map(x => x.cast), next: r.next?.cursor };
  }
  const r = await getUserRecasts(fid, fid, neynarKey, cursor, true);
  return { items: r.reactions.map(x => x.cast), next: r.next?.cursor };
}

// Absolute cap on pages scanned when a targetUsername filter is narrow
// (e.g. a user with 1 recast of @someone buried 40 pages back) - without
// this, a filter that never reaches N matches would page through the
// account's entire history.
const MAX_PAGES = 200;

function matchesTarget(cast: NeynarCast, kind: CleanupKind, targetUsername: string): boolean {
  const target = targetUsername.replace(/^@/, "").trim().toLowerCase();
  if (!target) return true;
  if (kind === "unlike" || kind === "unrecast") {
    return (cast.author.username ?? "").toLowerCase() === target;
  }
  // For my own casts/replies, approximate "for @username" as mentioning them.
  const mentioned = cast.mentioned_profiles?.some(p => (p.username ?? "").toLowerCase() === target) ?? false;
  const tagged = cast.text.toLowerCase().includes(`@${target}`);
  return mentioned || tagged;
}

// Fetches the most recent N items (optionally narrowed to ones involving
// targetUsername) for the given kind, newest first, paginating until N
// matches are found or the account's history is exhausted.
export async function fetchRecentForCleanup(
  fid: number,
  kind: CleanupKind,
  n: number,
  neynarKey: string,
  onLoaded?: (loaded: number) => void,
  targetUsername?: string,
): Promise<NeynarCast[]> {
  let items: NeynarCast[] = [];
  let cursor: string | undefined;
  let pages = 0;
  while (items.length < n && pages < MAX_PAGES) {
    const r = await fetchPage(fid, kind, neynarKey, cursor);
    pages++;
    const matched = targetUsername
      ? r.items.filter(c => matchesTarget(c, kind, targetUsername))
      : r.items;
    items = [...items, ...matched];
    onLoaded?.(Math.min(items.length, n));
    if (!r.next) break;
    cursor = r.next;
  }
  return items.slice(0, n);
}
