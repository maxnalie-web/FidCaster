/**
 * Farcaster Signing Worker Pool
 *
 * Spawns N Worker threads (default: min(cpuCount, 4)) that each run
 * signer-worker.ts.  Signing is CPU-bound (ed25519); offloading it to worker
 * threads frees the main event loop and multiplies throughput by N.
 *
 * Round-robin dispatch: each signing request goes to the next worker in rotation.
 * Workers are async - each handles many concurrent requests without blocking.
 *
 * Graceful fallback: if worker creation fails (e.g. tsx/ESM not available in
 * the environment), the pool reports as unavailable and callers fall back to
 * main-thread signing.
 */

import { Worker } from "worker_threads";
import { cpus } from "os";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import type { FarcasterAction } from "./farcaster-submit.js";

type Pending = {
  resolve: (r: { bytes: string; hash: string }) => void;
  reject:  (e: Error) => void;
};

const WORKER_COUNT  = Math.max(1, Math.min(cpus().length, 4));
const REQUEST_TIMEOUT_MS = 20_000; // per-sign timeout in worker

let pool: Worker[]                    = [];
let roundRobin                        = 0;
const pending = new Map<string, Pending>();
let available                         = false;

function makeWorker(scriptPath: string): Worker {
  // tsx/esm registers the TypeScript loader so the worker can import .ts files
  const w = new Worker(scriptPath, {
    execArgv: ["--import", "tsx/esm"],
  });

  w.on("message", (msg: { id: string; ok: boolean; bytes?: string; hash?: string; error?: string }) => {
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok && msg.bytes && msg.hash) {
      p.resolve({ bytes: msg.bytes, hash: msg.hash });
    } else {
      p.reject(new Error(msg.error ?? "Signing failed in worker"));
    }
  });

  w.on("error", err => {
    console.warn("[sign-pool] worker error - disabling pool, falling back to main thread:", err.message);
    available = false; // any worker crash → whole pool marked unavailable
  });

  return w;
}

export function initSignPool(): boolean {
  if (available) return true;
  try {
    const __dir     = dirname(fileURLToPath(import.meta.url));
    const workerPath = resolve(__dir, "signer-worker.ts");

    for (let i = 0; i < WORKER_COUNT; i++) {
      pool.push(makeWorker(workerPath));
    }
    available = true;
    console.log(`[sign-pool] started ${WORKER_COUNT} signing workers`);
    return true;
  } catch (e) {
    console.warn("[sign-pool] could not start workers, falling back to main thread:", (e as Error).message);
    pool = [];
    available = false;
    return false;
  }
}

/** Returns false if pool is not running - caller should fall back to main thread. */
export function poolAvailable(): boolean {
  return available && pool.length > 0;
}

/** Dispatch a signing job to the next worker in round-robin rotation. */
export function signInPool(
  signerPrivateKeyHex: string,
  fid: number,
  action: FarcasterAction,
): Promise<{ bytes: string; hash: string }> {
  if (!available) return Promise.reject(new Error("Pool not available"));

  const worker = pool[roundRobin % pool.length];
  roundRobin++;

  return new Promise((resolve, reject) => {
    const id = randomUUID();
    pending.set(id, { resolve, reject });

    // Per-request timeout so a stuck worker doesn't hold pending promises forever
    const t = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error("Signing worker timeout"));
      }
    }, REQUEST_TIMEOUT_MS);

    pending.set(id, {
      resolve(r) { clearTimeout(t); resolve(r); },
      reject(e)  { clearTimeout(t); reject(e); },
    });

    worker.postMessage({ id, signerPrivateKeyHex, fid, action });
  });
}

export function poolStats() {
  return { workers: pool.length, pending: pending.size, available };
}
