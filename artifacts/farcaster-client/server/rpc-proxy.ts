/**
 * Server-side JSON-RPC proxy for Optimism & Base.
 *
 * Why: the browser hitting public RPCs directly runs into two walls -
 *   1. CORS: several public nodes reject browser POSTs → "Failed to fetch".
 *   2. Rate limits: free tiers (1rpc, ankr) cap per-IP; a busy user burns them.
 *
 * This proxy forwards each JSON-RPC call from the SERVER against a POOL of public
 * endpoints, racing several of them in parallel per request (Promise.any) instead
 * of trying one at a time - response time is the fastest node's latency, not the
 * sum of every slow/dead one tried in sequence. Reads (eth_getBalance, eth_call,
 * ...) race RACE_SIZE_READ nodes; eth_sendRawTransaction races RACE_SIZE_SEND
 * nodes so the tx also propagates to multiple mempools at once. If the whole race
 * loses, the remaining pool is tried sequentially as a last-resort fallback.
 *
 * Zero API keys, zero per-user limits from the browser's perspective: the pool is
 * effectively unlimited because load is spread and dead nodes are skipped.
 */
import type { Express, Request, Response } from "express";

const OP_POOL = [
  "https://optimism.llamarpc.com",
  "https://optimism-rpc.publicnode.com",
  "https://optimism.drpc.org",
  "https://op-pokt.nodies.app",
  "https://optimism.gateway.tenderly.co",
  "https://mainnet.optimism.io",
  "https://rpc.ankr.com/optimism",
  "https://1rpc.io/op",
];

const BASE_POOL = [
  "https://base.llamarpc.com",
  "https://base-rpc.publicnode.com",
  "https://base.drpc.org",
  "https://base-pokt.nodies.app",
  "https://base.gateway.tenderly.co",
  "https://mainnet.base.org",
  "https://rpc.ankr.com/base",
  "https://1rpc.io/base",
];

const ARB_POOL = [
  "https://arbitrum.llamarpc.com",
  "https://arbitrum-one.publicnode.com",
  "https://arbitrum.drpc.org",
  "https://arb1.arbitrum.io/rpc",
  "https://arbitrum.gateway.tenderly.co",
  "https://rpc.ankr.com/arbitrum",
  "https://1rpc.io/arb",
];

const ETH_POOL = [
  "https://eth.llamarpc.com",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.drpc.org",
  "https://ethereum.gateway.tenderly.co",
  "https://rpc.ankr.com/eth",
  "https://1rpc.io/eth",
  "https://cloudflare-eth.com",
];

// Per-endpoint cooldown after a rate-limit / failure so we stop hammering it.
const cooldownUntil = new Map<string, number>();
const COOLDOWN_MS = 30_000;

// Round-robin start offset per pool so load spreads across nodes over time.
const rrOffset = new Map<string, number>();

function healthyOrder(pool: string[], poolKey: string): string[] {
  const now = Date.now();
  const start = (rrOffset.get(poolKey) ?? 0) % pool.length;
  rrOffset.set(poolKey, start + 1);
  const rotated = [...pool.slice(start), ...pool.slice(0, start)];
  const healthy = rotated.filter((u) => (cooldownUntil.get(u) ?? 0) <= now);
  // If everything is cooling down, ignore cooldowns rather than fail outright.
  return healthy.length > 0 ? healthy : rotated;
}

type RpcBody = { jsonrpc?: string; id?: unknown; method?: string; params?: unknown[] };

// A JSON-RPC error that means "this node is unhealthy, try another".
function isRetriableRpcError(err: { code?: number; message?: string } | undefined): boolean {
  if (!err) return false;
  const msg = (err.message ?? "").toLowerCase();
  return (
    err.code === -32005 ||                    // limit exceeded (EIP-1474)
    err.code === -32603 ||                    // internal error
    msg.includes("rate") || msg.includes("limit") ||
    msg.includes("capacity") || msg.includes("timeout") ||
    msg.includes("try again") || msg.includes("upgrade")
  );
}

// eth_sendRawTransaction: these "errors" actually mean the tx is already in flight
// (a sibling node already accepted it), so the broadcast effectively succeeded.
function isAlreadyBroadcast(err: { message?: string } | undefined): boolean {
  const msg = (err?.message ?? "").toLowerCase();
  return (
    msg.includes("already known") ||
    msg.includes("alreadyknown") ||
    msg.includes("known transaction") ||
    msg.includes("already imported") ||
    msg.includes("nonce too low")
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function forwardOnce(url: string, body: RpcBody, timeoutMs: number): Promise<any> {
  const r = await fetch(`${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) {
    // HTTP-level failure (429/5xx/403) → node unhealthy
    const text = await r.text().catch(() => "");
    const e = new Error(`HTTP ${r.status}: ${text.slice(0, 100)}`) as Error & { httpStatus: number };
    e.httpStatus = r.status;
    throw e;
  }
  return r.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Attempted = { json: any; url: string };

/**
 * One node attempt, shaped for Promise.any: resolves for anything that's an
 * AUTHORITATIVE answer (real success, or a deterministic error that would be
 * identical on every node), rejects for anything that just means "this node
 * is unhealthy, another one in the race might still come back clean".
 */
async function attempt(url: string, body: RpcBody, isSend: boolean, timeoutMs: number): Promise<Attempted> {
  try {
    const json = await forwardOnce(url, body, timeoutMs);
    if (json && typeof json === "object" && "error" in json && json.error) {
      const rpcErr = json.error as { code?: number; message?: string };
      if (isSend && isAlreadyBroadcast(rpcErr)) return { json, url };
      if (isRetriableRpcError(rpcErr)) {
        cooldownUntil.set(url, Date.now() + COOLDOWN_MS);
        throw new Error(rpcErr.message ?? "rpc error");
      }
      return { json, url }; // deterministic error (revert, bad params, ...)
    }
    return { json, url };
  } catch (e) {
    cooldownUntil.set(url, Date.now() + COOLDOWN_MS);
    throw e;
  }
}

// How many nodes to fire in parallel per request. Reads race a wide field -
// latency = the fastest responder, not a sum of sequential timeouts. Sends
// race a smaller field (broadcasting to N mempools at once is enough; no
// need to hit every node for a write).
const RACE_SIZE_READ = 4;
const RACE_SIZE_SEND = 3;
const READ_TIMEOUT_MS = 6_000;
const SEND_TIMEOUT_MS = 12_000;

async function handleRpc(pool: string[], poolKey: string, req: Request, res: Response): Promise<void> {
  const body = req.body as RpcBody;
  if (!body || typeof body.method !== "string") {
    res.status(400).json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid request" } });
    return;
  }

  const isSend = body.method === "eth_sendRawTransaction";
  const raceSize = isSend ? RACE_SIZE_SEND : RACE_SIZE_READ;
  const timeoutMs = isSend ? SEND_TIMEOUT_MS : READ_TIMEOUT_MS;
  const order = healthyOrder(pool, poolKey);
  const primary = order.slice(0, raceSize);
  const rest = order.slice(raceSize);
  let lastErr: unknown;

  // Race the primary batch - first authoritative answer wins.
  try {
    const { json } = await Promise.any(primary.map((url) => attempt(url, body, isSend, timeoutMs)));
    res.json(json);
    return;
  } catch (aggErr) {
    lastErr = (aggErr as AggregateError).errors?.[0] ?? aggErr;
  }

  // Whole race lost (all primary nodes down/rate-limited) → sequential
  // fallback through whatever's left in the pool, as a last resort.
  for (const url of rest) {
    try {
      const { json } = await attempt(url, body, isSend, timeoutMs);
      res.json(json);
      return;
    } catch (e) {
      lastErr = e;
    }
  }

  res.status(502).json({
    jsonrpc: "2.0",
    id: body.id ?? null,
    error: { code: -32603, message: `All RPC nodes failed: ${lastErr instanceof Error ? lastErr.message : "unknown"}` },
  });
}

export function registerRpcProxy(app: Express): void {
  app.post("/api/rpc/op", (req, res) => { void handleRpc(OP_POOL, "op", req, res); });
  app.post("/api/rpc/base", (req, res) => { void handleRpc(BASE_POOL, "base", req, res); });
  app.post("/api/rpc/arb", (req, res) => { void handleRpc(ARB_POOL, "arb", req, res); });
  app.post("/api/rpc/eth", (req, res) => { void handleRpc(ETH_POOL, "eth", req, res); });
}
