import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";
import { createWalletClient, createPublicClient, fallback, http, type WalletClient, type PublicClient, type Account, type Chain } from "viem";
import { optimism, base, arbitrum, mainnet, polygon } from "viem/chains";
import { validateMnemonic, mnemonicToSeedSync, generateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { HDKey } from "@scure/bip32";
import { ed25519 } from "@noble/curves/ed25519.js";

// Farcaster signer HD path -- hardened at coin_type level, account index 1
// Reserved for Ed25519 signer (distinct from custody wallet at index 0)
const FARCASTER_SIGNER_PATH = "m/44'/60'/0'/0/1";

export type LocalSigner = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: `0x${string}`;
};

export type DerivedAccount = {
  address: `0x${string}`;
  walletClient: WalletClient;
  localSigner: LocalSigner;
};

export function validateMnemonicWords(words: string[]): boolean {
  if (words.length !== 12 && words.length !== 24) return false;
  return words.every((w) => w.length > 0 && wordlist.includes(w.toLowerCase().trim()));
}

export function validateWord(word: string): boolean {
  return wordlist.includes(word.toLowerCase().trim());
}

/**
 * Derive a deterministic Ed25519 keypair from a BIP-39 mnemonic.
 * Uses BIP-32 child key at FARCASTER_SIGNER_PATH as the Ed25519 seed.
 * The keypair is used to register a Farcaster signer on KeyRegistry (Optimism).
 */
export function deriveSignerKey(mnemonic: string): LocalSigner {
  const phrase = mnemonic.trim().toLowerCase();
  const seed = mnemonicToSeedSync(phrase);
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive(FARCASTER_SIGNER_PATH);
  if (!child.privateKey) { seed.fill(0); throw new Error("Failed to derive signer private key from mnemonic"); }

  const privateKey = child.privateKey.slice();
  seed.fill(0);
  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyHex = (
    "0x" + Array.from(publicKey).map((b: number) => b.toString(16).padStart(2, "0")).join("")
  ) as `0x${string}`;

  return { privateKey, publicKey, publicKeyHex };
}

/**
 * Create a LocalSigner from raw bytes (e.g. a wallet signature).
 * Takes the first 32 bytes as the Ed25519 private key seed.
 * Used for deterministic signer derivation in wallet-auth flow.
 */
export function signerFromBytes(rawBytes: Uint8Array): LocalSigner {
  const privateKey = rawBytes.slice(0, 32);
  const publicKey = ed25519.getPublicKey(privateKey);
  const publicKeyHex = (
    "0x" + Array.from(publicKey).map((b: number) => b.toString(16).padStart(2, "0")).join("")
  ) as `0x${string}`;
  return { privateKey, publicKey, publicKeyHex };
}

/** Generate a fresh random Ed25519 signer · used for seedless SIWF write access. */
export function randomSigner(): LocalSigner {
  return signerFromBytes(crypto.getRandomValues(new Uint8Array(32)));
}

/** Rehydrate a LocalSigner from a stored 32-byte private-key hex (session restore). */
export function signerFromPrivateKeyHex(hex: string): LocalSigner {
  const clean = hex.replace(/^0x/, "");
  if (clean.length !== 64) throw new Error("Invalid signer private key hex");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return signerFromBytes(bytes);
}

/** Serialize a LocalSigner's private key to hex for session persistence. */
export function signerPrivateKeyHex(signer: LocalSigner): `0x${string}` {
  return ("0x" + Array.from(signer.privateKey).map((b: number) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

// Wallet transports. PRIMARY is our server RPC proxy (/api/rpc/*), which broadcasts
// from the server across a rotating node pool · no browser CORS, no per-user rate
// limit, and it transparently skips any exhausted endpoint. Direct public nodes are
// kept as fallbacks for deployments where the proxy isn't reachable (e.g. a static
// host with no backend). `rank: false` keeps the proxy first (index order).
const RPC_PROXY_OP = typeof window !== "undefined" ? `${window.location.origin}/api/rpc/op` : "/api/rpc/op";
const RPC_PROXY_BASE = typeof window !== "undefined" ? `${window.location.origin}/api/rpc/base` : "/api/rpc/base";

const opWalletTransport = fallback([
  http(RPC_PROXY_OP),
  http("https://optimism.llamarpc.com"),
  http("https://optimism-rpc.publicnode.com"),
  http("https://optimism.drpc.org"),
  http("https://mainnet.optimism.io"),
], { retryCount: 2 });

const baseWalletTransport = fallback([
  http(RPC_PROXY_BASE),
  http("https://base.llamarpc.com"),
  http("https://base-rpc.publicnode.com"),
  http("https://base.drpc.org"),
  http("https://mainnet.base.org"),
], { retryCount: 2 });

const arbWalletTransport = fallback([
  http("https://arbitrum.llamarpc.com"),
  http("https://arbitrum-one.publicnode.com"),
  http("https://arb1.arbitrum.io/rpc"),
  http("https://arbitrum.drpc.org"),
], { retryCount: 2 });

/** Create a walletClient bound to the Base chain for an already-derived account. */
export function createBaseWalletClient(account: Account): WalletClient {
  return createWalletClient({ account, chain: base, transport: baseWalletTransport });
}

/** Create a walletClient bound to the Arbitrum One chain for an already-derived account. */
export function createArbWalletClient(account: Account): WalletClient {
  return createWalletClient({ account, chain: arbitrum, transport: arbWalletTransport });
}

const ethWalletTransport = fallback([
  http("https://eth.llamarpc.com"),
  http("https://ethereum-rpc.publicnode.com"),
  http("https://mainnet.drpc.org"),
], { retryCount: 2 });

/** Create a walletClient bound to Ethereum Mainnet for an already-derived account. */
export function createEthWalletClient(account: Account): WalletClient {
  return createWalletClient({ account, chain: mainnet, transport: ethWalletTransport });
}

export async function deriveAccount(mnemonic: string): Promise<DerivedAccount> {
  const phrase = mnemonic.trim().toLowerCase();
  if (!validateMnemonic(phrase, wordlist)) {
    throw new Error("Invalid mnemonic phrase. Please check all words are correct BIP39 words.");
  }

  const account = mnemonicToAccount(phrase);

  const client = createWalletClient({
    account,
    chain: optimism,
    transport: opWalletTransport,
  });

  const localSigner = deriveSignerKey(phrase);

  return {
    address: account.address,
    walletClient: client,
    localSigner,
  };
}

/** Generate a fresh BIP-39 mnemonic (12 words). */
export function generateWalletMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

export type WalletAccountDerived = {
  address: `0x${string}`;
  walletClient: WalletClient;
  baseWalletClient: WalletClient;
};

/** Derive a wallet account at BIP-44 addressIndex (m/44'/60'/0'/0/<index>). */
export async function deriveWalletAccount(mnemonic: string, index: number): Promise<WalletAccountDerived> {
  const phrase = mnemonic.trim().toLowerCase();
  const account = mnemonicToAccount(phrase, { addressIndex: index });
  return {
    address: account.address,
    walletClient: createWalletClient({ account, chain: optimism, transport: opWalletTransport }),
    baseWalletClient: createBaseWalletClient(account),
  };
}

/** Derive walletClient from a raw private key hex. */
export function deriveWalletAccountFromKey(privateKeyHex: string): WalletAccountDerived {
  const account = privateKeyToAccount(privateKeyHex as `0x${string}`);
  return {
    address: account.address,
    walletClient: createWalletClient({ account, chain: optimism, transport: opWalletTransport }),
    baseWalletClient: createBaseWalletClient(account),
  };
}

/** Export the raw private key hex for a BIP-44 account at a given index. */
export function exportPrivateKeyHex(mnemonic: string, accountIndex: number): string {
  const phrase = mnemonic.trim().toLowerCase();
  const seed = mnemonicToSeedSync(phrase);
  const hdKey = HDKey.fromMasterSeed(seed);
  const child = hdKey.derive(`m/44'/60'/0'/0/${accountIndex}`);
  if (!child.privateKey) { seed.fill(0); throw new Error("Failed to derive private key"); }
  const hex = "0x" + Array.from(child.privateKey).map((b: number) => b.toString(16).padStart(2, "0")).join("");
  seed.fill(0);
  return hex;
}

/** Create an Optimism walletClient (counterpart to createBaseWalletClient). */
export function createOpWalletClient(account: Account): WalletClient {
  return createWalletClient({ account, chain: optimism, transport: opWalletTransport });
}

const polygonWalletTransport = fallback([
  http("https://polygon-rpc.com"),
  http("https://polygon-bor-rpc.publicnode.com"),
  http("https://polygon.drpc.org"),
], { retryCount: 2 });

const CHAIN_TRANSPORTS: Record<number, { chain: Chain; transport: ReturnType<typeof fallback> }> = {
  10:    { chain: optimism, transport: opWalletTransport },
  8453:  { chain: base,     transport: baseWalletTransport },
  1:     { chain: mainnet,  transport: ethWalletTransport },
  42161: { chain: arbitrum, transport: arbWalletTransport },
  137:   { chain: polygon,  transport: polygonWalletTransport },
};

/**
 * Create a walletClient bound to an arbitrary supported chain. Signing AND
 * broadcasting both happen against this chain's RPC, so a transaction built
 * for e.g. Base can never end up broadcast on Optimism.
 */
export function createChainWalletClient(account: Account, chainId: number): WalletClient {
  const cfg = CHAIN_TRANSPORTS[chainId];
  if (!cfg) throw new Error(`Unsupported chain id ${chainId}`);
  return createWalletClient({ account, chain: cfg.chain, transport: cfg.transport });
}

const chainPublicClients = new Map<number, PublicClient>();

/** Get (and cache) a publicClient for any supported chain — used for tx simulation. */
export function getPublicClientForChain(chainId: number): PublicClient {
  const cached = chainPublicClients.get(chainId);
  if (cached) return cached;
  const cfg = CHAIN_TRANSPORTS[chainId];
  if (!cfg) throw new Error(`Unsupported chain id ${chainId}`);
  const client = createPublicClient({ chain: cfg.chain, transport: cfg.transport });
  chainPublicClients.set(chainId, client);
  return client;
}
