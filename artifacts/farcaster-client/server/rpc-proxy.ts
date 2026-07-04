/**
 * Server-side JSON-RPC proxy for Optimism & Base.
 *
 * Why: the browser hitting public RPCs directly runs into two walls —
 *   1. CORS: several public nodes reject browser POSTs → "Failed to fetch".
 *   2. Rate limits: free tiers (1rpc, ankr) cap per-IP; a busy user burns them.
 *
 * This proxy forwards each JSON-RPC call from the SERVER, rotating across a large
 * pool of public endpoints. On a rate-limit / network error it transparently
 * advances to the next node, so a single exhausted endpoint never surfaces to the
 * user. eth_sendRawTransaction is broadcast to nodes in turn until one accepts
 * (or reports the tx already known / nonce consumed — both mean it landed).
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
async function forwardOnce(url: string, body: RpcBody): Promise<any> {
  const r = await fetch(`${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
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

async function handleRpc(pool: string[], poolKey: string, req: Request, res: Response): Promise<void> {
  const body = req.body as RpcBody;
  if (!body || typeof body.method !== "string") {
    res.status(400).json({ jsonrpc: "2.0", id: body?.id ?? null, error: { code: -32600, message: "Invalid request" } });
    return;
  }

  const isSend = body.method === "eth_sendRawTransaction";
  const order = healthyOrder(pool, poolKey);
  let lastErr: unknown;

  for (const url of order) {
    try {
      const json = await forwardOnce(url, body);

      // JSON-RPC-level error inside a 200 response.
      if (json && typeof json === "object" && "error" in json && json.error) {
        const rpcErr = json.error as { code?: number; message?: string };
        // For broadcasts, "already known"/"nonce too low" == success; return it so
        // the client's wallet lib resolves instead of erroring.
        if (isSend && isAlreadyBroadcast(rpcErr)) { res.json(json); return; }
        // Retriable node error → cool it down and try the next node.
        if (isRetriableRpcError(rpcErr)) {
          cooldownUntil.set(url, Date.now() + COOLDOWN_MS);
          lastErr = new Error(rpcErr.message ?? "rpc error");
          continue;
        }
        // Deterministic error (revert, bad params, real nonce error): it will be
        // identical on every node — return it as the authoritative answer.
        res.json(json);
        return;
      }

      // Success.
      res.json(json);
      return;
    } catch (e) {
      // Network/CORS/timeout/HTTP error → cool the node down, advance.
      cooldownUntil.set(url, Date.now() + COOLDOWN_MS);
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
}
