// PROVIDER-mode WalletConnect: lets external dApps (opened in another
// browser tab, or scanned via a wc:... QR/deeplink) connect TO this app as
// their wallet, and request account access / signatures / transactions that
// THIS app's active wallet signs.
//
// Deliberately a *separate* SDK integration from useMarketWallet.ts's
// @walletconnect/ethereum-provider usage, which is CONSUMER-mode (this app
// connecting OUT to an external wallet). Being the wallet requires the
// lower-level @walletconnect/sign-client package directly. Same WalletConnect
// Cloud project id is reused (VITE_WALLETCONNECT_PROJECT_ID), not duplicated.
import SignClient from "@walletconnect/sign-client";
import type { SignClientTypes } from "@walletconnect/types";
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";

export type SessionProposalEvent = SignClientTypes.EventArguments["session_proposal"];
export type SessionRequestEvent = SignClientTypes.EventArguments["session_request"];

export interface SessionInfo {
  topic: string;
  name: string;
  description: string;
  url: string;
  icon: string | undefined;
  accounts: string[];
  chains: string[];
  methods: string[];
  expiry: number;
}

// The eth_* methods this app is prepared to actually service -- see
// WalletConnectRequestModal.tsx for where these are handled.
export const SUPPORTED_METHODS = ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4"] as const;
const SUPPORTED_EVENTS = ["chainChanged", "accountsChanged"];

let client: SignClient | undefined;
let initPromise: Promise<SignClient> | undefined;

const proposalHandlers = new Set<(proposal: SessionProposalEvent) => void>();
const requestHandlers = new Set<(request: SessionRequestEvent) => void>();

// Idempotent -- safe to call multiple times; every caller after the first
// just awaits the same in-flight/completed init.
export async function initWalletConnectProvider(): Promise<void> {
  if (client) return;
  if (!initPromise) {
    const projectId = (import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? "").trim();
    if (!projectId) throw new Error("WalletConnect isn't configured (VITE_WALLETCONNECT_PROJECT_ID missing).");
    initPromise = SignClient.init({
      projectId,
      metadata: {
        name: "FidCaster",
        description:
          "The fastest, most focused way to grow and manage a Farcaster identity, crafted like a tool you'd actually want to open every day.",
        url: "https://fidcaster.xyz",
        icons: ["https://fidcaster.xyz/icon.png"],
      },
    }).then(c => {
      client = c;

      // These just fan out to whatever the UI has subscribed via
      // onSessionProposal/onSessionRequest below -- nothing here ever signs
      // or approves anything on its own. Every proposal and every
      // signing/tx request must round-trip through an explicit user click
      // (approveSession/rejectSession, approveRequest/rejectRequest).
      c.on("session_proposal", proposal => {
        proposalHandlers.forEach(h => h(proposal));
      });
      c.on("session_request", request => {
        requestHandlers.forEach(h => h(request));
      });

      return c;
    });
  }
  await initPromise;
}

function requireClient(): SignClient {
  if (!client) throw new Error("WalletConnect provider not initialized. Call initWalletConnectProvider() first.");
  return client;
}

export function onSessionProposal(handler: (proposal: SessionProposalEvent) => void): () => void {
  proposalHandlers.add(handler);
  return () => proposalHandlers.delete(handler);
}

export function onSessionRequest(handler: (request: SessionRequestEvent) => void): () => void {
  requestHandlers.add(handler);
  return () => requestHandlers.delete(handler);
}

// For QR-scanned or pasted WalletConnect URIs (wc:...). Pairing alone does
// not grant a dApp anything -- it just opens the encrypted channel; the dApp
// then sends a session proposal over it, which surfaces via
// onSessionProposal and still requires an explicit approveSession call.
export async function pairWithUri(uri: string): Promise<void> {
  const c = requireClient();
  await c.pair({ uri });
}

// Builds the approved namespaces from the proposal's required/optional
// namespaces, scoped to the single `address` being offered (this app's
// active wallet account) across the given EVM `chainIds`. Only ever call
// this in direct response to a user clicking "Approve" on a specific
// proposal -- see WalletConnectSessions.tsx.
export async function approveSession(proposalId: number, address: `0x${string}`, chainIds: number[]): Promise<void> {
  const c = requireClient();
  const proposal = c.proposal.get(proposalId);

  const chains = chainIds.map(id => `eip155:${id}`);
  const accounts = chains.map(chain => `${chain}:${address}`);

  const namespaces = buildApprovedNamespaces({
    proposal,
    supportedNamespaces: {
      eip155: {
        chains,
        methods: [...SUPPORTED_METHODS],
        events: SUPPORTED_EVENTS,
        accounts,
      },
    },
  });

  const { acknowledged } = await c.approve({ id: proposalId, namespaces });
  await acknowledged();
}

export async function rejectSession(proposalId: number): Promise<void> {
  const c = requireClient();
  await c.reject({ id: proposalId, reason: getSdkError("USER_REJECTED") });
}

// `result` is the signature hex / tx hash produced by the active wallet's
// WalletClient after the user approved -- see WalletConnectRequestModal.tsx
// for where the actual signing happens before this is called.
export async function approveRequest(requestId: number, topic: string, result: unknown): Promise<void> {
  const c = requireClient();
  await c.respond({ topic, response: { id: requestId, jsonrpc: "2.0", result } });
}

export async function rejectRequest(requestId: number, topic: string, reason: string): Promise<void> {
  const c = requireClient();
  await c.respond({
    topic,
    response: { id: requestId, jsonrpc: "2.0", error: { code: 5000, message: reason || "User rejected the request." } },
  });
}

export async function getActiveSessions(): Promise<SessionInfo[]> {
  const c = requireClient();
  const sessions = c.session.values;
  return sessions.map((session): SessionInfo => {
    const eip155 = session.namespaces.eip155;
    return {
      topic: session.topic,
      name: session.peer.metadata.name,
      description: session.peer.metadata.description,
      url: session.peer.metadata.url,
      icon: session.peer.metadata.icons?.[0],
      accounts: eip155?.accounts ?? [],
      chains: eip155?.chains ?? eip155?.accounts.map((a: string) => a.split(":").slice(0, 2).join(":")) ?? [],
      methods: eip155?.methods ?? [],
      expiry: session.expiry,
    };
  });
}

export async function disconnectSession(topic: string): Promise<void> {
  const c = requireClient();
  await c.disconnect({ topic, reason: getSdkError("USER_DISCONNECTED") });
}

// The single address a session's namespace was actually approved for -- used
// by WalletConnectRequestModal to verify an incoming request is being signed
// by the wallet the dApp was actually granted, not just whatever happens to
// be active right now -- those can silently diverge if the user switches
// wallets after approving.
export function getSessionAddress(topic: string): `0x${string}` | null {
  const c = requireClient();
  const session = c.session.get(topic);
  const account = session?.namespaces.eip155?.accounts?.[0];
  if (!account) return null;
  const address = account.split(":")[2];
  return address ? (address as `0x${string}`) : null;
}
