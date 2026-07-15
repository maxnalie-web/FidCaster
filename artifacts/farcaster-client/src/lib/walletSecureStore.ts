import { encryptPrivKey, decryptPrivKey } from "@/lib/session-crypto";

const MNEMONIC_PREFIX = "ws_mn_";
const PRIVKEY_PREFIX = "ws_pk_";

export async function saveWalletMnemonic(walletId: string, mnemonic: string): Promise<void> {
  const encrypted = await encryptPrivKey(mnemonic);
  localStorage.setItem(`${MNEMONIC_PREFIX}${walletId}`, encrypted);
}

export async function getWalletMnemonic(walletId: string): Promise<string | null> {
  const raw = localStorage.getItem(`${MNEMONIC_PREFIX}${walletId}`);
  if (!raw) return null;
  return decryptPrivKey(raw);
}

export async function clearWalletMnemonic(walletId: string): Promise<void> {
  localStorage.removeItem(`${MNEMONIC_PREFIX}${walletId}`);
}

export async function saveWalletPrivateKey(walletId: string, privateKeyHex: string): Promise<void> {
  const encrypted = await encryptPrivKey(privateKeyHex);
  localStorage.setItem(`${PRIVKEY_PREFIX}${walletId}`, encrypted);
}

export async function getWalletPrivateKey(walletId: string): Promise<string | null> {
  const raw = localStorage.getItem(`${PRIVKEY_PREFIX}${walletId}`);
  if (!raw) return null;
  return decryptPrivKey(raw);
}

export async function clearWalletPrivateKey(walletId: string): Promise<void> {
  localStorage.removeItem(`${PRIVKEY_PREFIX}${walletId}`);
}
