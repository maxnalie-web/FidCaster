/**
 * Lightweight event bridge for propagating external-wallet account changes
 * (WalletConnect, injected) into WalletProvider without creating circular
 * import dependencies between hooks.
 *
 * Usage:
 *  - WalletProvider registers a callback with setWalletAccountChangeCallback()
 *    whenever wallet-auth becomes active, and clears it on logout.
 *  - useMarketWallet (or any wallet adapter) calls notifyWalletAccountChange()
 *    whenever the connected account changes in a live WC session.
 */

import type { WalletClient } from "viem";

type WalletAccountChangeHandler = (
  newWalletClient: WalletClient,
  newAddress: `0x${string}`,
) => void;

let _handler: WalletAccountChangeHandler | null = null;

/** Register the handler that WalletProvider wants called on account change. */
export function setWalletAccountChangeCallback(cb: WalletAccountChangeHandler | null) {
  _handler = cb;
}

/** Called by wallet adapters (useMarketWallet) when the live account changes. */
export function notifyWalletAccountChange(
  newWalletClient: WalletClient,
  newAddress: `0x${string}`,
) {
  _handler?.(newWalletClient, newAddress);
}
