/**
 * NFT Pass routes — FidCaster Pass ERC-721 on Base Mainnet
 *
 * GET  /api/nft-pass/status              — contract deployment info
 * GET  /api/nft-pass/metadata/:tokenId   — ERC-721 token metadata (OpenSea standard)
 * GET  /api/nft-pass/contract-metadata   — collection-level metadata for OpenSea
 * GET  /api/nft-pass/check/:address      — { hasMinted, balance }
 * POST /api/nft-pass/mint                — { fid, address } → { txHash, tokenId }
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createWalletClient, createPublicClient, http, isAddress } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db/pool.js";

// Real gas is spent from a server-held wallet on every mint attempt, and the
// only per-call anti-repeat check (on-chain balanceOf) is keyed on the
// caller-supplied address, which costs nothing to regenerate. So this route
// needs its own tight limits, independent of the generic app-wide limiter.
const mintLimiter = rateLimit({ windowMs: 10 * 60_000, max: 5, standardHeaders: true, legacyHeaders: false });
const MAX_MINT_ATTEMPTS_PER_FID_24H = 3;

const __dir = dirname(fileURLToPath(import.meta.url));

// Permanent CDN URL for the NFT pass image (Cloudinary)
const NFT_IMAGE_URL =
  "https://res.cloudinary.com/cmcfqv66/image/upload/v1784435712/fidcaster/nft-pass-v2.png";

// ── Config ────────────────────────────────────────────────────────────────────
function loadConfig() {
  const p = resolve(__dir, "nft-pass-config.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

function loadAbi() {
  const p = resolve(__dir, "nft-pass-abi.json");
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf-8")); } catch { return null; }
}

export function createNftPassRouter(): Router {
  const router = Router();

  // ── GET /api/nft-pass/status — contract info ─────────────────────────────
  router.get("/status", (_req, res) => {
    const cfg = loadConfig();
    if (!cfg) return res.json({ deployed: false });
    res.json({
      deployed: true,
      contractAddress: cfg.contractAddress,
      chain: cfg.chain,
      chainId: cfg.chainId,
      explorerUrl: `https://basescan.org/address/${cfg.contractAddress}`,
    });
  });

  // ── GET /api/nft-pass/contract-metadata — OpenSea collection-level metadata
  // OpenSea fetches this from the contractURI() return value.
  // Since our deployed contract doesn't have contractURI(), we expose it here
  // and it can be set on the OpenSea collection page via "Edit collection".
  router.get("/contract-metadata", (_req, res) => {
    res.json({
      name:              "FidCaster Pass",
      description:       "The official FidCaster Pass. Mint yours for free to access the FidCaster app and earn points toward the $FCAST airdrop.",
      image:             NFT_IMAGE_URL,
      external_link:     "https://fidcaster.xyz",
      seller_fee_basis_points: 0,
      fee_recipient:     "0x0000000000000000000000000000000000000000",
    });
  });

  // ── GET /api/nft-pass/metadata/:tokenId — token metadata (OpenSea standard)
  router.get("/metadata/:tokenId", (req, res) => {
    const tokenId = parseInt(req.params.tokenId, 10);
    if (isNaN(tokenId) || tokenId < 0)
      return res.status(400).json({ error: "invalid tokenId" });

    // Set Cache-Control so OpenSea re-fetches when we update
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.json({
      name:         `FidCaster Pass #${tokenId}`,
      description:  "The official FidCaster Pass. Mint yours for free to access the FidCaster app and earn points toward the $FCAST airdrop.",
      image:        NFT_IMAGE_URL,
      external_url: "https://fidcaster.xyz",
      background_color: "06011A",   // matches app dark background (no #)
      attributes: [
        { trait_type: "Collection",  value: "FidCaster Pass" },
        { trait_type: "Access",      value: "Full App"        },
        { trait_type: "Chain",       value: "Base"            },
        { trait_type: "Mint Type",   value: "Free"            },
      ],
    });
  });

  // ── GET /api/nft-pass/check/:address ─────────────────────────────────────
  router.get("/check/:address", async (req, res) => {
    const { address } = req.params;
    if (!isAddress(address))
      return res.status(400).json({ error: "invalid address" });

    const cfg = loadConfig();
    const abi = loadAbi();
    if (!cfg || !abi) return res.json({ hasMinted: false, balance: 0, deployed: false });

    try {
      const client = createPublicClient({
        chain: base,
        transport: http("https://mainnet.base.org"),
      });
      const balance = await client.readContract({
        address:      cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "balanceOf",
        args:         [address as `0x${string}`],
      }) as bigint;
      res.json({ hasMinted: balance > 0n, balance: Number(balance), deployed: true });
    } catch (e) {
      res.status(500).json({ error: "check failed", detail: String(e) });
    }
  });

  // ── POST /api/nft-pass/mint ───────────────────────────────────────────────
  router.post("/mint", mintLimiter, async (req, res) => {
    const { fid, address } = req.body as { fid?: number; address?: string };
    if (!address || !isAddress(address))
      return res.status(400).json({ error: "invalid address" });
    if (!fid || typeof fid !== "number" || !Number.isInteger(fid) || fid <= 0)
      return res.status(400).json({ error: "fid required" });

    const cfg = loadConfig();
    const abi = loadAbi();
    if (!cfg || !abi)
      return res.status(503).json({ error: "NFT contract not deployed yet" });

    // Per-fid attempt cap — a legitimate user mints once; this only exists to
    // stop a script from cycling fresh throwaway addresses to drain the
    // server-funded mint wallet (balanceOf alone can't catch that, since it's
    // keyed on the address, not the fid).
    const pool = getPool();
    if (pool) {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS n FROM nft_pass_mint_log WHERE fid = $1 AND created_at > now() - INTERVAL '24 hours'`,
        [fid],
      );
      if (Number(rows[0]?.n ?? 0) >= MAX_MINT_ATTEMPTS_PER_FID_24H) {
        return res.status(429).json({ error: "Too many mint attempts for this FID today. Try again later." });
      }
    }

    const rawKey = process.env.NFT_MINT_PRIVATE_KYES;
    if (!rawKey) return res.status(503).json({ error: "mint key not configured" });
    const privateKey = (
      rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`
    ) as `0x${string}`;

    try {
      const minterAccount = privateKeyToAccount(privateKey);
      const walletClient  = createWalletClient({
        account:   minterAccount,
        chain:     base,
        transport: http("https://mainnet.base.org"),
      });
      const publicClient  = createPublicClient({
        chain:     base,
        transport: http("https://mainnet.base.org"),
      });

      // One pass per address
      const balance = await publicClient.readContract({
        address:      cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "balanceOf",
        args:         [address as `0x${string}`],
      }) as bigint;

      if (balance > 0n)
        return res.json({ alreadyMinted: true, balance: Number(balance) });

      // Record the attempt against this fid's 24h cap before spending any gas.
      if (pool) {
        await pool.query(
          `INSERT INTO nft_pass_mint_log (fid, address) VALUES ($1, $2)`,
          [fid, address],
        ).catch(() => {}); // non-fatal — never block a mint on a logging failure
      }

      // Simulate first (catches reverts cheaply)
      await publicClient.simulateContract({
        address:      cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "mint",
        args:         [address as `0x${string}`],
        account:      minterAccount,
      });

      const hash = await walletClient.writeContract({
        address:      cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "mint",
        args:         [address as `0x${string}`],
      });

      console.log(`[nft-pass] minted → ${address} (fid ${fid}) tx=${hash}`);
      res.json({
        success:     true,
        txHash:      hash,
        explorerUrl: `https://basescan.org/tx/${hash}`,
      });
    } catch (e) {
      console.error("[nft-pass] mint error:", e);
      res.status(500).json({ error: "mint failed", detail: String(e) });
    }
  });

  return router;
}
