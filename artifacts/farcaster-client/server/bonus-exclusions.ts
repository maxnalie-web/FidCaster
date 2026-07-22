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

// One-time startup sweep: if any of the excluded accounts already minted the
// Pass or held the FasterTask NFT BEFORE this exclusion existed, their
// nft_holder_bonus/pass_mint_bonus ledger rows are still sitting there
// verified - and since scoring reads POINTS.<type>.pts live, those old rows
// would silently start scoring at the new 10,000 value too. This finds any
// such rows for the excluded usernames and marks them excluded=true so their
// score doesn't move because of this change. Safe to run on every boot -
// a no-op once already swept (excluded=false is required to match again).
export async function sweepExcludedBonusRows(): Promise<void> {
  const { getPool } = await import("./db/pool.js");
  const { fetchNeynarUsers } = await import("./mini-routes.js");
  const pool = getPool();
  if (!pool) return;
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT fid FROM user_actions
       WHERE action_type IN ('nft_holder_bonus', 'pass_mint_bonus') AND excluded = false`,
    );
    if (rows.length === 0) return;
    const fids = rows.map(r => Number(r.fid));
    const userMap = await fetchNeynarUsers(fids);
    const excludedFids = fids.filter(fid => {
      const username = userMap.get(fid)?.username?.toLowerCase();
      return !!username && EXCLUDED_BONUS_USERNAMES.has(username);
    });
    if (excludedFids.length === 0) return;
    await pool.query(
      `UPDATE user_actions SET excluded = true, excluded_reason = 'bonus_exclusion_sweep'
       WHERE fid = ANY($1::bigint[]) AND action_type IN ('nft_holder_bonus', 'pass_mint_bonus') AND excluded = false`,
      [excludedFids],
    );
    console.log(`[bonus-exclusions] swept ${excludedFids.length} excluded fid(s)' bonus rows`);
  } catch (e) {
    console.warn("[bonus-exclusions] sweep error:", (e as Error).message);
  }
}
