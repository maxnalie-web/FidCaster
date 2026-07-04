/**
 * Neynar JSON write API · no protobuf needed.
 * Requires a valid Neynar API key + approved signer_uuid.
 */

const BASE = "https://api.neynar.com/v2/farcaster";

async function neynarPost(path: string, body: unknown, key: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api_key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return;
  const txt = await res.text().catch(() => "");
  throw new Error(`Neynar ${path}: HTTP ${res.status} · ${txt}`);
}

async function neynarDelete(path: string, body: unknown, key: string): Promise<void> {
  const res = await fetch(`${BASE}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", "api_key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (res.ok) return;
  const txt = await res.text().catch(() => "");
  throw new Error(`Neynar ${path}: HTTP ${res.status} · ${txt}`);
}

export async function neynarPublishCast(
  signerUuid: string,
  text: string,
  key: string,
  opts?: {
    embeds?: Array<{ url: string }>;
    parent?: string;
    channelId?: string;
  },
): Promise<void> {
  const body: Record<string, unknown> = { signer_uuid: signerUuid, text };
  if (opts?.embeds?.length) body.embeds = opts.embeds;
  if (opts?.parent) body.parent = opts.parent;
  if (opts?.channelId) body.channel_id = opts.channelId;
  await neynarPost("/cast", body, key);
}

export async function neynarReact(
  signerUuid: string,
  castHash: string,
  type: "like" | "recast",
  key: string,
  action: "create" | "delete" = "create",
): Promise<void> {
  const body = { signer_uuid: signerUuid, reaction_type: type, target: castHash };
  if (action === "delete") {
    await neynarDelete("/reaction", body, key);
  } else {
    await neynarPost("/reaction", body, key);
  }
}

export async function neynarFollow(
  signerUuid: string,
  targetFid: number,
  key: string,
  unfollow = false,
): Promise<void> {
  const body = { signer_uuid: signerUuid, target_fids: [targetFid] };
  if (unfollow) {
    await neynarDelete("/follow", body, key);
  } else {
    await neynarPost("/follow", body, key);
  }
}
