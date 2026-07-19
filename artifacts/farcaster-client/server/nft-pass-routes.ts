/**
 * NFT Pass routes — FidCaster Pass ERC-721 on Optimism
 *
 * GET  /api/nft-pass/metadata/:tokenId  — ERC-721 token metadata JSON
 * GET  /api/nft-pass/check/:address     — { hasMinted, balance }
 * POST /api/nft-pass/mint               — { fid, address } → { txHash, tokenId }
 */
import { Router } from "express";
import { createWalletClient, createPublicClient, http, isAddress } from "viem";
import { optimism } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));

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
    res.json({ deployed: true, contractAddress: cfg.contractAddress, chain: cfg.chain });
  });

  // ── GET /api/nft-pass/metadata/:tokenId ──────────────────────────────────
  router.get("/metadata/:tokenId", (req, res) => {
    const tokenId = parseInt(req.params.tokenId, 10);
    if (isNaN(tokenId) || tokenId < 0) return res.status(400).json({ error: "invalid tokenId" });

    res.json({
      name: `FidCaster Pass #${tokenId}`,
      description: "The official FidCaster Pass. Mint yours for free to access the FidCaster app and earn points toward the airdrop.",
      image: "https://fidcaster.xyz/nft-pass-v2.png",
      external_url: "https://fidcaster.xyz",
      attributes: [
        { trait_type: "Collection",  value: "FidCaster Pass" },
        { trait_type: "Access",      value: "Full App" },
        { trait_type: "Chain",       value: "Optimism" },
      ],
    });
  });

  // ── GET /api/nft-pass/check/:address ─────────────────────────────────────
  router.get("/check/:address", async (req, res) => {
    const { address } = req.params;
    if (!isAddress(address)) return res.status(400).json({ error: "invalid address" });

    const cfg = loadConfig();
    const abi = loadAbi();
    if (!cfg || !abi) return res.json({ hasMinted: false, balance: 0, deployed: false });

    try {
      const client = createPublicClient({ chain: optimism, transport: http() });
      const balance = await client.readContract({
        address: cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "balanceOf",
        args: [address],
      }) as bigint;
      res.json({ hasMinted: balance > 0n, balance: Number(balance), deployed: true });
    } catch (e) {
      res.status(500).json({ error: "check failed", detail: String(e) });
    }
  });

  // ── POST /api/nft-pass/mint ───────────────────────────────────────────────
  router.post("/mint", async (req, res) => {
    const { fid, address } = req.body as { fid?: number; address?: string };
    if (!address || !isAddress(address)) return res.status(400).json({ error: "invalid address" });
    if (!fid || typeof fid !== "number") return res.status(400).json({ error: "fid required" });

    const cfg = loadConfig();
    const abi = loadAbi();
    if (!cfg || !abi) return res.status(503).json({ error: "NFT contract not deployed yet" });

    const rawKey = process.env.NFT_MINT_PRIVATE_KYES;
    if (!rawKey) return res.status(503).json({ error: "mint key not configured" });
    const privateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

    try {
      const minterAccount = privateKeyToAccount(privateKey);
      const walletClient = createWalletClient({ account: minterAccount, chain: optimism, transport: http() });
      const publicClient = createPublicClient({ chain: optimism, transport: http() });

      // Check balance first — one pass per address
      const balance = await publicClient.readContract({
        address: cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "balanceOf",
        args: [address as `0x${string}`],
      }) as bigint;

      if (balance > 0n) {
        return res.json({ alreadyMinted: true, balance: Number(balance) });
      }

      // Simulate first
      await publicClient.simulateContract({
        address: cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "mint",
        args: [address as `0x${string}`],
        account: minterAccount,
      });

      // Send tx
      const hash = await walletClient.writeContract({
        address: cfg.contractAddress as `0x${string}`,
        abi,
        functionName: "mint",
        args: [address as `0x${string}`],
      });

      console.log(`[nft-pass] minted to ${address} (fid ${fid}) tx=${hash}`);
      res.json({ success: true, txHash: hash, explorerUrl: `https://optimistic.etherscan.io/tx/${hash}` });
    } catch (e) {
      console.error("[nft-pass] mint error:", e);
      res.status(500).json({ error: "mint failed", detail: String(e) });
    }
  });

  return router;
}
