import type { NeynarUser } from "./neynar";

/**
 * Stash of the last full profile object seen for a FID, so opening that
 * profile from a cast/list can render instantly (avatar, name, bio, counts)
 * from already-known data while a fresh copy loads in the background,
 * instead of always starting from a blank loading state.
 */
const cache = new Map<number, NeynarUser>();
const TTL_MS = 5 * 60_000;
const timestamps = new Map<number, number>();

export function setRecentProfile(user: NeynarUser): void {
  if (!user?.fid) return;
  cache.set(user.fid, user);
  timestamps.set(user.fid, Date.now());
}

export function getRecentProfile(fid: number): NeynarUser | undefined {
  const ts = timestamps.get(fid);
  if (ts === undefined || Date.now() - ts > TTL_MS) return undefined;
  return cache.get(fid);
}

export function bumpFollowingCount(fid: number, delta: 1 | -1): void {
  const user = cache.get(fid);
  if (!user) return;
  cache.set(fid, { ...user, following_count: Math.max(0, (user.following_count ?? 0) + delta) });
}
