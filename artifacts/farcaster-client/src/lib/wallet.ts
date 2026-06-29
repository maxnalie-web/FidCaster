import { mnemonicToAccount } from "viem/accounts";
import { createWalletClient, fallback, http, type WalletClient, type Account } from "viem";
import { optimism, base } from "viem/chains";
import { validateMnemonic, mnemonicToSeedSync } from "@scure/bip39";
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

/** Generate a fresh random Ed25519 signer — used for seedless SIWF write access. */
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

// Wallet transports with fallback RPCs per chain
const opWalletTransport = fallback([
  http("https://mainnet.optimism.io"),
  http("https://rpc.ankr.com/optimism"),
  http("https://optimism.drpc.org"),
  http("https://1rpc.io/op"),
]);

const baseWalletTransport = fallback([
  http("https://mainnet.base.org"),
  http("https://rpc.ankr.com/base"),
  http("https://base.drpc.org"),
  http("https://1rpc.io/base"),
]);

/** Create a walletClient bound to the Base chain for an already-derived account. */
export function createBaseWalletClient(account: Account): WalletClient {
  return createWalletClient({
    account,
    chain: base,
    transport: baseWalletTransport,
  });
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
