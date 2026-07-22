/**
 * Shared exclusion list for the big one-time bonuses (Pass mint, FasterTask
 * holder) - these are the team/test accounts, they should never collect
 * either bonus regardless of what they actually mint or hold. Everything
 * else about these accounts (other action points, leaderboard rank from
 * real activity) is unaffected - this only gates the two specific bonuses.
 */
const EXCLUDED_BONUS_USERNAMES = new Set(
  ["amosiros", "m-", "fastertasks", "parvane"].map(u => u.toLowerCase()),
);

export async function isExcludedFromBonuses(fid: number): Promise<boolean> {
  const { fetchNeynarUsers } = await import("./mini-routes.js");
  const map = await fetchNeynarUsers([fid]);
  const username = map.get(fid)?.username?.toLowerCase();
  return !!username && EXCLUDED_BONUS_USERNAMES.has(username);
}
