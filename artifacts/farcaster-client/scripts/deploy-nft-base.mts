/**
 * Deploy FidCasterPass ERC-721 on Base Mainnet + verify on Basescan.
 * Run: npx tsx scripts/deploy-nft-base.mts
 *
 * Required env vars:
 *   NFT_MINT_PRIVATE_KYES  — deployer private key (0x-prefixed hex)
 * Optional:
 *   BASESCAN_API_KEY       — for contract verification (get free at basescan.org)
 */
import { createWalletClient, createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dir = dirname(fileURLToPath(import.meta.url));

// ── Env ───────────────────────────────────────────────────────────────────────
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

const contract  = output.contracts["FidCasterPass.sol"]["FidCasterPass"];
const abi       = contract.abi;
const bytecode  = `0x${contract.evm.bytecode.object}` as `0x${string}`;
const solcVer   = solc.version(); // e.g. "0.8.36+commit.8a079791.Emscripten.clang"
console.log(`✅  Compiled. Bytecode: ${bytecode.length / 2} bytes. Compiler: ${solcVer}`);

// ── Deploy ────────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(privateKey);
console.log(`🔑  Deployer: ${account.address}`);

const walletClient = createWalletClient({ account, chain: base, transport: http("https://mainnet.base.org") });
const publicClient = createPublicClient({ chain: base, transport: http("https://mainnet.base.org") });

const BASE_URI = "https://fidcaster.xyz/api/nft-pass/metadata/";

console.log("🚀  Deploying to Base Mainnet …");
const hash = await walletClient.deployContract({
  abi,
  bytecode,
  args: [account.address, BASE_URI],
});

console.log(`📡  Deploy tx: ${hash}`);
console.log("⏳  Waiting for confirmation …");

const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 2 });
const contractAddress = receipt.contractAddress!;

console.log(`\n🎉  FidCasterPass deployed on Base!`);
console.log(`    Address : ${contractAddress}`);
console.log(`    Tx      : ${hash}`);
console.log(`    Explorer: https://basescan.org/address/${contractAddress}`);

// ── Save config ───────────────────────────────────────────────────────────────
const config = { contractAddress, deployTx: hash, chain: "base", chainId: 8453, baseURI: BASE_URI, deployedAt: new Date().toISOString() };
writeFileSync(resolve(__dir, "../server/nft-pass-config.json"), JSON.stringify(config, null, 2));
writeFileSync(resolve(__dir, "../server/nft-pass-abi.json"), JSON.stringify(abi, null, 2));
console.log("💾  Config + ABI saved.");

// ── Verify on Basescan ────────────────────────────────────────────────────────
const apiKey = process.env.BASESCAN_API_KEY ?? "YourApiKeyToken";
const compilerTag = "v" + solcVer.replace(/\+.*/, "") + "+commit." +
  solcVer.replace(/.*\+commit\.([a-f0-9]+).*/, "$1");

console.log(`\n🔍  Submitting verification to Basescan …`);
console.log(`    Compiler tag: ${compilerTag}`);

const formData = new URLSearchParams({
  apikey:          apiKey,
  module:          "contract",
  action:          "verifysourcecode",
  contractaddress: contractAddress,
  sourceCode:      source,
  codeformat:      "solidity-single-file",
  contractname:    "FidCasterPass",
  compilerversion: compilerTag,
  optimizationUsed:"1",
  runs:            "200",
  constructorArguements: (account.address + BASE_URI).replace(/^0x/, ""),
  licenseType:     "3", // MIT
});

try {
  const verRes = await fetch("https://api.basescan.org/api", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData.toString(),
  });
  const verJson = await verRes.json() as any;
  console.log("    Basescan response:", verJson);

  if (verJson.status === "1") {
    console.log(`✅  Verification submitted! GUID: ${verJson.result}`);
    console.log(`    Check: https://basescan.org/address/${contractAddress}#code`);
  } else {
    console.log("⚠️   Verification not confirmed yet — may need BASESCAN_API_KEY secret.");
    console.log("    To verify manually: https://basescan.org/verifyContract");
    console.log(`    Compiler: ${compilerTag}  Optimization: ON  Runs: 200`);
  }
} catch (e) {
  console.log("⚠️   Verification request failed:", e);
}

console.log("\n✨  Done!");
