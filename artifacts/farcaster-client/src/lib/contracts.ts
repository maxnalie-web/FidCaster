import {
  createPublicClient,
  http,
  fallback,
  encodeAbiParameters,
  parseAbiParameters,
  type WalletClient,
} from "viem";
import { optimism, base, arbitrum, mainnet } from "viem/chains";

// PRIMARY transport is our server RPC proxy (/api/rpc/*): it forwards each call
// from the server across a rotating pool of public nodes, skipping any that are
// rate-limited or down · so from the browser it behaves like an unlimited,
// CORS-free endpoint. Direct public nodes stay as fallbacks for backend-less
// deployments. Index order is preserved (no rank) so the proxy is always tried first.
const RPC_PROXY_OP = typeof window !== "undefined" ? `${window.location.origin}/api/rpc/op` : "/api/rpc/op";
const RPC_PROXY_BASE = typeof window !== "undefined" ? `${window.location.origin}/api/rpc/base` : "/api/rpc/base";
const RPC_PROXY_ARB = typeof window !== "undefined" ? `${window.location.origin}/api/rpc/arb` : "/api/rpc/arb";
const RPC_PROXY_ETH = typeof window !== "undefined" ? `${window.location.origin}/api/rpc/eth` : "/api/rpc/eth";

export const publicClient = createPublicClient({
  chain: optimism,
  transport: fallback([
    http(RPC_PROXY_OP),
    http("https://optimism.llamarpc.com"),
    http("https://optimism-rpc.publicnode.com"),
    http("https://optimism.drpc.org"),
    http("https://mainnet.optimism.io"),
  ], { retryCount: 2 }),
});

export const basePublicClient = createPublicClient({
  chain: base,
  transport: fallback([
    http(RPC_PROXY_BASE),
    http("https://base.llamarpc.com"),
    http("https://base-rpc.publicnode.com"),
    http("https://base.drpc.org"),
    http("https://mainnet.base.org"),
  ], { retryCount: 2 }),
});

export const arbPublicClient = createPublicClient({
  chain: arbitrum,
  transport: fallback([
    http(RPC_PROXY_ARB),
    http("https://arbitrum.llamarpc.com"),
    http("https://arbitrum-one.publicnode.com"),
    http("https://arb1.arbitrum.io/rpc"),
    http("https://arbitrum.drpc.org"),
  ], { retryCount: 2 }),
});

export const ethPublicClient = createPublicClient({
  chain: mainnet,
  transport: fallback([
    http(RPC_PROXY_ETH),
    http("https://eth.llamarpc.com"),
    http("https://ethereum-rpc.publicnode.com"),
    http("https://mainnet.drpc.org"),
    http("https://cloudflare-eth.com"),
  ], { retryCount: 2 }),
});

export const USDC_BASE_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
export const USDC_OP_ADDRESS   = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85" as const;
export const USDC_ARB_ADDRESS  = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
export const USDC_ETH_ADDRESS  = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as const;

export const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "account", type: "address" as const }],
    outputs: [{ name: "", type: "uint256" as const }],
  },
  {
    name: "decimals",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint8" as const }],
  },
] as const;

export const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "amount", type: "uint256" as const },
    ],
    outputs: [{ name: "", type: "bool" as const }],
  },
] as const;

// ---------------------------------------------------------------------------
// Farcaster NameRegistry -- Optimism (fname ERC-721 registry)
// ---------------------------------------------------------------------------
export const NAME_REGISTRY_ADDRESS =
  "0xe3Be01D99bAa8dB9905b33a3cA391238234B79D1" as const;

export const NAME_REGISTRY_ABI = [
  {
    name: "changeName",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "fname", type: "bytes16" as const }],
    outputs: [],
  },
  {
    name: "transferAndChangeRecovery",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "recovery", type: "address" as const },
      { name: "fname", type: "bytes16" as const },
    ],
    outputs: [],
  },
  {
    name: "idOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "owner", type: "address" as const }],
    outputs: [{ name: "", type: "uint256" as const }],
  },
  {
    name: "nameOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "tokenId", type: "uint256" as const }],
    outputs: [{ name: "", type: "bytes16" as const }],
  },
] as const;

export function fnameToBytes16(name: string): `0x${string}` {
  const bytes = new TextEncoder().encode(name.slice(0, 16));
  const padded = new Uint8Array(16);
  padded.set(bytes);
  return (
    "0x" + Array.from(padded).map((b) => b.toString(16).padStart(2, "0")).join("")
  ) as `0x${string}`;
}

export async function changeNameOnchain(
  walletClient: WalletClient,
  fname: string
): Promise<`0x${string}`> {
  const account = walletClient.account!;
  const { request } = await publicClient.simulateContract({
    address: NAME_REGISTRY_ADDRESS,
    abi: NAME_REGISTRY_ABI,
    functionName: "changeName",
    args: [fnameToBytes16(fname)],
    account,
  });
  return walletClient.writeContract(request);
}

// ---------------------------------------------------------------------------
// Farcaster KeyRegistry -- read-only (state checks)
// Farcaster KeyGateway -- write (add signer keys)
// Both on Optimism Mainnet
// ---------------------------------------------------------------------------
export const KEY_REGISTRY_ADDRESS =
  "0x00000000fc1237824fb747abde0ff18990e59b7e" as const;

// KeyGateway is the correct entry-point for adding Ed25519 signer keys.
// Direct calls to KeyRegistry.add() revert; all writes must go through the Gateway.
// Address verified from on-chain KeyRegistry Add events (June 2026).
export const KEY_GATEWAY_ADDRESS =
  "0x00000000fc56947c7e7183f8ca4b62398caadf0b" as const;

// SignedKeyRequestValidator · used to generate EIP-712 SignedKeyRequest metadata (metadataType=1).
export const SIGNED_KEY_REQUEST_VALIDATOR_ADDRESS =
  "0x00000000FC700472606ED4fA22623Acf62c60553" as const;

const KEY_REGISTRY_READ_ABI = [
  {
    name: "keyDataOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [
      { name: "fid", type: "uint256" as const },
      { name: "key", type: "bytes" as const },
    ],
    outputs: [
      {
        name: "",
        type: "tuple" as const,
        components: [
          { name: "state", type: "uint8" as const },
          { name: "keyType", type: "uint32" as const },
        ],
      },
    ],
  },
] as const;

const KEY_GATEWAY_WRITE_ABI = [
  {
    name: "add",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "keyType", type: "uint32" as const },
      { name: "key", type: "bytes" as const },
      { name: "metadataType", type: "uint8" as const },
      { name: "metadata", type: "bytes" as const },
    ],
    outputs: [],
  },
] as const;

export async function getSignerState(
  fid: bigint,
  publicKeyHex: `0x${string}`
): Promise<number> {
  const data = await publicClient.readContract({
    address: KEY_REGISTRY_ADDRESS,
    abi: KEY_REGISTRY_READ_ABI,
    functionName: "keyDataOf",
    args: [fid, publicKeyHex],
  });
  return (data as { state: number; keyType: number }).state;
}

/**
 * Register an Ed25519 signer key on-chain via the Farcaster KeyGateway.
 * Uses metadataType=1 (SignedKeyRequestValidator) with an EIP-712 self-signed request.
 * The caller must be the custody address of the FID.
 *
 * Why metadataType=1: The old metadataType=0 path is now a no-op in the current
 * KeyGateway (0x...caadf0b). metadataType=1 requires a SignedKeyRequest EIP-712
 * signature from the FID custody wallet to authorise the key addition.
 */
/**
 * Whether `address` has at least enough ETH on Optimism to cover gas for
 * registerSignerOnchain's "add" call. ~150k gas is a safe overestimate
 * (actual usage is far lower); +30% headroom matches the margin used
 * elsewhere in this file. Shared by the pre-flight check below and by
 * WalletProvider's background poller (auto-retries once funds land).
 */
export async function hasSufficientBalanceForSignerRegistration(address: `0x${string}`): Promise<boolean> {
  const [balance, gasPrice] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.getGasPrice(),
  ]);
  const estimatedCost = (150_000n * gasPrice * 130n) / 100n;
  return balance >= estimatedCost;
}

export async function registerSignerOnchain(
  walletClient: WalletClient,
  fid: bigint,
  address: `0x${string}`,
  publicKeyHex: `0x${string}`
): Promise<`0x${string}`> {
  const localAccount = walletClient.account!;

  // Pre-flight balance check, before any wallet popup: registering a signer
  // costs a small amount of gas on Optimism. Some wallets (seen with mobile
  // WalletConnect sessions) show their own "insufficient funds" warning
  // internally with no explicit reject, leaving the signTypedData/writeContract
  // promise pending forever · so if we can already tell the balance can't
  // cover gas, fail fast here with a clear message instead of ever prompting.
  try {
    if (!(await hasSufficientBalanceForSignerRegistration(address))) {
      throw new Error(`INSUFFICIENT_FUNDS:${address}`);
    }
  } catch (preflightErr) {
    if (preflightErr instanceof Error && preflightErr.message.startsWith("INSUFFICIENT_FUNDS:")) throw preflightErr;
    // Any other pre-flight error (RPC hiccup) · don't block, let the normal
    // simulate/estimate/send path below try for real.
  }

  // Build EIP-712 SignedKeyRequest signed by the custody wallet (self-registration).
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400 * 365); // 1 year
  const domain = {
    name: "Farcaster SignedKeyRequestValidator",
    version: "1",
    chainId: 10,
    verifyingContract: SIGNED_KEY_REQUEST_VALIDATOR_ADDRESS,
  } as const;
  const types = {
    SignedKeyRequest: [
      { name: "requestFid", type: "uint256" },
      { name: "key", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
  } as const;

  const sig = await walletClient.signTypedData({
    account: localAccount,
    domain,
    types,
    primaryType: "SignedKeyRequest",
    message: { requestFid: fid, key: publicKeyHex, deadline },
  });

  // Encode metadata: (requestFid, requestSigner, sig, deadline)
  const metadata = encodeAbiParameters(
    parseAbiParameters(
      "(uint256 requestFid, address requestSigner, bytes sig, uint256 deadline)"
    ),
    [{ requestFid: fid, requestSigner: address, sig, deadline }]
  );

  // Pre-check: if key is already active on-chain, skip the tx entirely.
  try {
    const existingState = await getSignerState(fid, publicKeyHex);
    if (existingState === 1) {
      throw new Error("ALREADY_REGISTERED");
    }
  } catch (preCheckErr) {
    if (preCheckErr instanceof Error && preCheckErr.message === "ALREADY_REGISTERED") throw preCheckErr;
    // Ignore RPC errors on pre-check and proceed with registration attempt.
  }

  // Try simulation first so the wallet shows accurate gas estimates.
  // If simulation fails (e.g. RPC quirk, stale state), fall back to a direct
  // writeContract call · the wallet (Rainbow, MetaMask, etc.) will do its own
  // simulation and surface any real revert to the user.
  try {
    const { request } = await publicClient.simulateContract({
      address: KEY_GATEWAY_ADDRESS,
      abi: KEY_GATEWAY_WRITE_ABI,
      functionName: "add",
      args: [1, publicKeyHex, 1, metadata],
      account: localAccount,
    });
    return walletClient.writeContract(request);
  } catch (simErr) {
    const simMsg = simErr instanceof Error ? simErr.message : String(simErr);
    // Surface already-registered errors immediately.
    if (/already|InvalidKeyState|KeyAlreadyAdded/i.test(simMsg)) {
      const recheck = await getSignerState(fid, publicKeyHex).catch(() => 0);
      if (recheck === 1) throw new Error("ALREADY_REGISTERED");
    }
    // For any other simulation error, skip pre-flight and let the wallet decide.
    console.warn("simulateContract failed, falling back to direct writeContract:", simMsg);

    // Still try to attach an explicit gas limit even though the simulation
    // itself failed: without one, some wallets (seen with Rainbow over
    // WalletConnect) run their own conservative client-side gas estimate for
    // an unsimulated call and show a false "this transaction is likely to
    // fail" warning even though it succeeds once actually broadcast. A real
    // on-chain estimate with headroom avoids that false alarm; if the
    // estimate itself fails too, fall through and let the wallet decide with
    // no gas hint at all (unchanged prior behavior).
    let gas: bigint | undefined;
    try {
      const estimated = await publicClient.estimateContractGas({
        address: KEY_GATEWAY_ADDRESS,
        abi: KEY_GATEWAY_WRITE_ABI,
        functionName: "add",
        args: [1, publicKeyHex, 1, metadata],
        account: localAccount,
      });
      gas = (estimated * 130n) / 100n; // +30% headroom
    } catch { /* leave gas unset · wallet estimates on its own */ }

    return walletClient.writeContract({
      address: KEY_GATEWAY_ADDRESS,
      abi: KEY_GATEWAY_WRITE_ABI,
      functionName: "add",
      args: [1, publicKeyHex, 1, metadata],
      account: localAccount,
      chain: optimism,
      ...(gas !== undefined ? { gas } : {}),
    });
  }
}

export const ID_REGISTRY_ADDRESS =
  "0x00000000fc6c5f01fc30151999387bb99a9f489b" as const;

export const ID_REGISTRY_ABI = [
  {
    name: "idOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "owner", type: "address" as const }],
    outputs: [{ name: "", type: "uint256" as const }],
  },
  {
    name: "custodyOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "fid", type: "uint256" as const }],
    outputs: [{ name: "", type: "address" as const }],
  },
  {
    name: "recoveryOf",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "fid", type: "uint256" as const }],
    outputs: [{ name: "", type: "address" as const }],
  },
  {
    name: "idCounter",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [],
    outputs: [{ name: "", type: "uint256" as const }],
  },
  {
    name: "nonces",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [{ name: "owner", type: "address" as const }],
    outputs: [{ name: "", type: "uint256" as const }],
  },
  {
    name: "verifyFidSignature",
    type: "function" as const,
    stateMutability: "view" as const,
    inputs: [
      { name: "custodyAddress", type: "address" as const },
      { name: "fid", type: "uint256" as const },
      { name: "digest", type: "bytes32" as const },
      { name: "sig", type: "bytes" as const },
    ],
    outputs: [{ name: "isValid", type: "bool" as const }],
  },
  {
    name: "changeRecoveryAddress",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [{ name: "recovery", type: "address" as const }],
    outputs: [],
  },
  {
    name: "transfer",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "deadline", type: "uint256" as const },
      { name: "sig", type: "bytes" as const },
    ],
    outputs: [],
  },
  {
    name: "transferAndChangeRecovery",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "to", type: "address" as const },
      { name: "recovery", type: "address" as const },
      { name: "deadline", type: "uint256" as const },
      { name: "sig", type: "bytes" as const },
    ],
    outputs: [],
  },
  {
    name: "recover",
    type: "function" as const,
    stateMutability: "nonpayable" as const,
    inputs: [
      { name: "from", type: "address" as const },
      { name: "to", type: "address" as const },
      { name: "deadline", type: "uint256" as const },
      { name: "sig", type: "bytes" as const },
    ],
    outputs: [],
  },
] as const;

export async function lookupFid(owner: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: ID_REGISTRY_ABI,
    functionName: "idOf",
    args: [owner],
  });
}

export async function getCustodyAddress(fid: bigint): Promise<`0x${string}`> {
  return publicClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: ID_REGISTRY_ABI,
    functionName: "custodyOf",
    args: [fid],
  });
}

export async function getRecoveryAddress(fid: bigint): Promise<`0x${string}`> {
  return publicClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: ID_REGISTRY_ABI,
    functionName: "recoveryOf",
    args: [fid],
  });
}

export async function getIdCounter(): Promise<bigint> {
  return publicClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: ID_REGISTRY_ABI,
    functionName: "idCounter",
    args: [],
  });
}

export async function getNonce(owner: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: ID_REGISTRY_ADDRESS,
    abi: ID_REGISTRY_ABI,
    functionName: "nonces",
    args: [owner],
  });
}
