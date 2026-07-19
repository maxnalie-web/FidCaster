/**
 * Deploy FidCasterPass ERC-721 on Optimism Mainnet.
 * Run: npx tsx scripts/deploy-nft.mts
 *
 * Required env vars:
 *   NFT_MINT_PRIVATE_KYES  — deployer / minter private key (hex, 0x-prefixed)
 */
import { createWalletClient, createPublicClient, http, parseGwei } from "viem";
import { optimism } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));

// ── Env ──────────────────────────────────────────────────────────────────────
const rawKey = process.env.NFT_MINT_PRIVATE_KYES;
if (!rawKey) throw new Error("NFT_MINT_PRIVATE_KYES env var is not set");
const privateKey = (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`;

// ── Compile ───────────────────────────────────────────────────────────────────
console.log("📦  Compiling FidCasterPass.sol …");
const solc = require("solc");

const contractPath = resolve(__dir, "../contracts/FidCasterPass.sol");
const source = readFileSync(contractPath, "utf-8");

const input = JSON.stringify({
  language: "Solidity",
  sources: { "FidCasterPass.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode"] } },
  },
});

const output = JSON.parse(solc.compile(input));
if (output.errors?.some((e: any) => e.severity === "error")) {
  console.error("Compilation errors:", output.errors);
  process.exit(1);
}

const contract = output.contracts["FidCasterPass.sol"]["FidCasterPass"];
const abi      = contract.abi;
const bytecode = `0x${contract.evm.bytecode.object}` as `0x${string}`;

console.log(`✅  Compiled. Bytecode size: ${bytecode.length / 2} bytes`);

// ── Deploy ────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(privateKey);
console.log(`🔑  Deployer: ${account.address}`);

const walletClient = createWalletClient({ account, chain: optimism, transport: http() });
const publicClient = createPublicClient({ chain: optimism, transport: http() });

// The baseURI for token metadata — served by the FidCaster app server
const BASE_URI = "https://fidcaster.xyz/api/nft-pass/metadata/";

console.log("🚀  Deploying to Optimism Mainnet …");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [account.address, BASE_URI],
});

console.log(`📡  Deploy tx: ${hash}`);
console.log("⏳  Waiting for confirmation …");

const receipt = await publicClient.waitForTransactionReceipt({ hash });
const contractAddress = receipt.contractAddress!;

console.log(`\n🎉  FidCasterPass deployed!`);
console.log(`    Address : ${contractAddress}`);
console.log(`    Tx      : ${hash}`);
console.log(`    Explorer: https://optimistic.etherscan.io/address/${contractAddress}`);

// ── Save config ───────────────────────────────────────────────────────────────
const configPath = resolve(__dir, "../server/nft-pass-config.json");
const config = {
  contractAddress,
  deployTx: hash,
  chain: "optimism",
  chainId: 10,
  baseURI: BASE_URI,
  deployedAt: new Date().toISOString(),
};
writeFileSync(configPath, JSON.stringify(config, null, 2));
console.log(`\n💾  Config saved to server/nft-pass-config.json`);

// ── Save ABI ──────────────────────────────────────────────────────────────────
const abiPath = resolve(__dir, "../server/nft-pass-abi.json");
writeFileSync(abiPath, JSON.stringify(abi, null, 2));
console.log(`💾  ABI saved to server/nft-pass-abi.json`);

console.log("\n✨  Done! Add CONTRACT_ADDRESS to your server env if needed.");
