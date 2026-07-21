/**
 * NFT Pass routes — FidCaster Pass ERC-721 on Base Mainnet
 *
 * mint(address) has no access restriction on-chain, so the connected wallet
 * signs and pays its own gas to mint directly — the server never holds a
 * minting key or submits the transaction itself. It only ever independently
 * re-verifies balanceOf() before recording a mint in the log, so nothing
 * here can be spoofed by a client claiming a mint that didn't happen.
 *
 * GET  /api/nft-pass/status              — contract deployment info
 * GET  /api/nft-pass/metadata/:tokenId   — ERC-721 token metadata (OpenSea standard)
 * GET  /api/nft-pass/contract-metadata   — collection-level metadata for OpenSea
 * GET  /api/nft-pass/check/:address      — { hasMinted, balance }
 * POST /api/nft-pass/record-mint         — { fid, address, txHash } → logs a confirmed mint
 */
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { createPublicClient, http, isAddress } from "viem";
import { base } from "viem/chains";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db/pool.js";
import { getTrustedFid } from "./auth.js";

const recordLimiter = rateLimit({ windowMs: 10 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

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
      description:       "The official FidCaster Pass. Mint yours for free to access the FidCaster app and earn points toward the airdrop.",
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
      description:  "The official FidCaster Pass. Mint yours for free to access the FidCaster app and earn points toward the airdrop.",
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

  // ── GET /api/nft-pass/check-fid/:fid ──────────────────────────────────────
  // Fallback for when the caller has no verified eth address to check against
  // (e.g. they minted through a wallet Farcaster never verified) — looks up
  // whether this fid has a recorded mint, keyed by fid rather than address.
  router.get("/check-fid/:fid", async (req, res) => {
    const fid = Number(req.params.fid);
    if (!Number.isInteger(fid) || fid <= 0)
      return res.status(400).json({ error: "invalid fid" });

    const pool = getPool();
    if (!pool) return res.json({ hasMinted: false, address: null });

    const { rows } = await pool.query(
      `SELECT address FROM nft_pass_mint_log WHERE fid = $1 ORDER BY created_at DESC LIMIT 1`,
      [fid],
    );
    if (rows.length === 0) return res.json({ hasMinted: false, address: null });
    res.json({ hasMinted: true, address: rows[0].address });
  });

  // ── POST /api/nft-pass/record-mint ────────────────────────────────────────
  // Called by the client after its own wallet has already signed and
  // submitted a mint(address) transaction directly to the contract. This
  // endpoint spends no gas and holds no key — it only logs the mint for our
  // own visibility (leaderboard/admin), and only after independently
  // confirming on-chain that the address really does hold a token. A client
  // claiming a mint that never happened (wrong/fake txHash, reverted tx)
  // simply gets rejected by the balanceOf check below.
  router.post("/record-mint", recordLimiter, async (req, res) => {
    const { fid, address } = req.body as { fid?: number; address?: string; txHash?: string };
    if (!address || !isAddress(address))
      return res.status(400).json({ error: "invalid address" });
    if (!fid || typeof fid !== "number" || !Number.isInteger(fid) || fid <= 0)
      return res.status(400).json({ error: "fid required" });

    const trusted = await getTrustedFid(req);
    if (trusted.fid === null || trusted.fid !== fid)
      return res.status(401).json({ error: "Valid auth token required and must match fid" });

    const cfg = loadConfig();
    const abi = loadAbi();
    if (!cfg || !abi)
      return res.status(503).json({ error: "NFT contract not deployed yet" });

    try {
      const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });
      const balance = await publicClient.readContract({
        address:      cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "balanceOf",
        args:         [address as `0x${string}`],
      }) as bigint;

      if (balance === 0n) {
        return res.status(409).json({ error: "not_minted_yet", detail: "This address doesn't hold a token yet — the transaction may still be confirming." });
      }

      const pool = getPool();
      if (pool) {
        await pool.query(
          `INSERT INTO nft_pass_mint_log (fid, address, tx_hash) VALUES ($1, $2, $3)`,
          [fid, address, req.body.txHash ?? null],
        ).catch(() => {}); // best-effort log — never fail the response over it
      }

      res.json({ ok: true, balance: Number(balance) });
    } catch (e) {
      console.error("[nft-pass] record-mint error:", e);
      res.status(500).json({ error: "verification failed", detail: String(e) });
    }
  });

  return router;
}
