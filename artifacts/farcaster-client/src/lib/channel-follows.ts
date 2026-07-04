import type { NeynarChannel } from "@/lib/neynar";

/**
 * Farcaster channel membership (the "follow a channel" relationship shown in
 * Warpcast's sidebar) is not a hub protocol message · it only exists in
 * Warpcast/Neynar's own database, written through a Neynar-managed signer
 * (signer_uuid), which is a completely different auth model than this app's
 * local Ed25519 hub-submit signing. Since FidCaster never asks users to set
 * up a Neynar managed signer, there is no hub message we can sign to make a
 * channel follow show up on Warpcast too.
 *
 * This keeps a FidCaster-local list instead: follow/unfollow is instant, has
 * zero extra setup, and drives the app's own Channels sidebar exactly like a
 * real follow would · it just doesn't federate to Warpcast's copy.
 */

export type FollowedChannel = Pick<NeynarChannel, "id" | "name" | "image_url" | "follower_count" | "url">;

function storageKey(fid: number): string {
  return `fc_channels_${fid}`;
}

export function getFollowedChannels(fid: number): FollowedChannel[] {
  try {
    const raw = localStorage.getItem(storageKey(fid));
    return raw ? (JSON.parse(raw) as FollowedChannel[]) : [];
  } catch { return []; }
}

export function isChannelFollowed(fid: number, channelId: string): boolean {
  return getFollowedChannels(fid).some((c) => c.id === channelId);
}

export function followChannel(fid: number, channel: NeynarChannel): FollowedChannel[] {
  const list = getFollowedChannels(fid);
  if (list.some((c) => c.id === channel.id)) return list;
  const next = [
    { id: channel.id, name: channel.name, image_url: channel.image_url, follower_count: channel.follower_count, url: channel.url },
    ...list,
  ];
  try { localStorage.setItem(storageKey(fid), JSON.stringify(next)); } catch {}
  return next;
}

export function unfollowChannel(fid: number, channelId: string): FollowedChannel[] {
  const next = getFollowedChannels(fid).filter((c) => c.id !== channelId);
  try { localStorage.setItem(storageKey(fid), JSON.stringify(next)); } catch {}
  return next;
}
