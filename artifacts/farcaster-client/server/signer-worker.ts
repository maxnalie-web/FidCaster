/**
 * Farcaster Signing Worker
 *
 * Runs in a Node.js Worker Thread so ed25519 signing does NOT block the main
 * event loop.  Each worker handles multiple concurrent requests (async, non-blocking).
 *
 * Protocol: parentPort messages in / out.
 *   IN  { id, signerPrivateKeyHex, fid, action }
 *   OUT { id, ok: true,  bytes, hash }
 *       { id, ok: false, error }
 */

import { parentPort } from "worker_threads";
import {
  makeCastAdd,
  makeCastRemove,
  makeLinkAdd,
  makeLinkRemove,
  makeReactionAdd,
  makeReactionRemove,
  makeUserDataAdd,
  UserDataType,
  NobleEd25519Signer,
  FarcasterNetwork,
  Message,
} from "@farcaster/hub-nodejs";

type FarcasterAction =
  | { type: "like";            castHash: string; castAuthorFid: number }
  | { type: "unlike";          castHash: string; castAuthorFid: number }
  | { type: "recast";          castHash: string; castAuthorFid: number }
  | { type: "unrecast";        castHash: string; castAuthorFid: number }
  | { type: "follow";          targetFid: number }
  | { type: "unfollow";        targetFid: number }
  | { type: "cast";            text: string; parentHash?: string; parentFid?: number; parentUrl?: string }
  | { type: "delete-cast";     castHash: string }
  | { type: "update-user-data"; dataType: "pfp" | "display" | "bio" | "banner"; value: string };

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return b;
}

async function sign(
  signerPrivateKeyHex: string,
  fid: number,
  action: FarcasterAction,
): Promise<{ bytes: string; hash: string }> {
  const privateKeyBytes = hexToBytes(signerPrivateKeyHex);
  const signer = new NobleEd25519Signer(privateKeyBytes);
  const dataOptions = { fid, network: FarcasterNetwork.MAINNET };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let result: any;

  if (action.type === "like") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionAdd({ type: 1, targetCastId: { fid: action.castAuthorFid, hash } }, dataOptions, signer);
  } else if (action.type === "unlike") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionRemove({ type: 1, targetCastId: { fid: action.castAuthorFid, hash } }, dataOptions, signer);
  } else if (action.type === "recast") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionAdd({ type: 2, targetCastId: { fid: action.castAuthorFid, hash } }, dataOptions, signer);
  } else if (action.type === "unrecast") {
    const hash = hexToBytes(action.castHash);
    result = await makeReactionRemove({ type: 2, targetCastId: { fid: action.castAuthorFid, hash } }, dataOptions, signer);
  } else if (action.type === "follow") {
    result = await makeLinkAdd({ type: "follow", targetFid: action.targetFid }, dataOptions, signer);
  } else if (action.type === "unfollow") {
    result = await makeLinkRemove({ type: "follow", targetFid: action.targetFid }, dataOptions, signer);
  } else if (action.type === "delete-cast") {
    const hash = hexToBytes(action.castHash);
    result = await makeCastRemove({ targetHash: hash }, dataOptions, signer);
  } else if (action.type === "update-user-data") {
    const typeMap: Record<string, UserDataType> = {
      pfp: UserDataType.PFP, display: UserDataType.DISPLAY, bio: UserDataType.BIO,
      banner: UserDataType.BANNER,
    };
    result = await makeUserDataAdd(
      { type: typeMap[action.dataType], value: action.value }, dataOptions, signer,
    );
  } else {
    const cast = action as { type: "cast"; text: string; parentHash?: string; parentFid?: number; parentUrl?: string };
    result = await makeCastAdd({
      text: cast.text,
      embeds: [], embedsDeprecated: [], mentions: [], mentionsPositions: [],
      ...(cast.parentHash && cast.parentFid
        ? { parentCastId: { fid: cast.parentFid, hash: hexToBytes(cast.parentHash) } }
        : cast.parentUrl ? { parentUrl: cast.parentUrl } : {}),
    }, dataOptions, signer);
  }

  privateKeyBytes.fill(0); // zero out key ASAP
  if (!result || result.isErr()) {
    throw new Error(`Failed to build message: ${result?.error?.message ?? "unknown"}`);
  }

  const message = result.value as Message;
  return {
    bytes: Buffer.from(Message.encode(message).finish()).toString("base64"),
    hash: Buffer.from(message.hash).toString("hex"),
  };
}

parentPort?.on(
  "message",
  async (msg: { id: string; signerPrivateKeyHex: string; fid: number; action: FarcasterAction }) => {
    try {
      const result = await sign(msg.signerPrivateKeyHex, msg.fid, msg.action);
      parentPort?.postMessage({ id: msg.id, ok: true, ...result });
    } catch (e) {
      parentPort?.postMessage({ id: msg.id, ok: false, error: (e as Error).message });
    }
  },
);
