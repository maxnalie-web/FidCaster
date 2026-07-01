import { useState, useEffect, useCallback } from "react";
import { Loader2, ShieldCheck, Key, AlertTriangle, ExternalLink } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import {
  createNeynarSigner,
  getSignerStatus,
  approveSignerWithSignature,
  type NeynarSigner,
} from "@/lib/neynar";

const SIGNED_KEY_REQUEST_VALIDATOR = "0x00000000fc700472606ed4fa22623acf62c60553" as const;
const SIGNED_KEY_REQUEST_DOMAIN = {
  name: "Farcaster SignedKeyRequestValidator",
  version: "1",
  chainId: 10,
  verifyingContract: SIGNED_KEY_REQUEST_VALIDATOR,
} as const;
const SIGNED_KEY_REQUEST_TYPES = {
  SignedKeyRequest: [
    { name: "requestFid", type: "uint256" },
    { name: "key", type: "bytes" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

type State =
  | { id: "checking" }
  | { id: "no_signer" }
  | { id: "creating" }
  | { id: "approving"; signer: NeynarSigner; deadline: number }
  | { id: "registering" }
  | { id: "active"; publicKey: string }
  | { id: "error"; msg: string };

export function SignerSetup() {
  const { fid, walletClient, signerUuid, setSigner, neynarKey, localSigner } = useWallet();
  const [state, setState] = useState<State>({ id: "checking" });

  const checkExisting = useCallback(async () => {
    if (!signerUuid) {
      setState({ id: "no_signer" });
      return;
    }
    try {
      const s = await getSignerStatus(signerUuid, neynarKey);
      if (s.status === "approved") {
        setState({ id: "active", publicKey: s.public_key });
      } else if (s.status === "pending_approval") {
        setState({ id: "no_signer" });
      } else {
        setState({ id: "no_signer" });
      }
    } catch {
      setState({ id: "no_signer" });
    }
  }, [signerUuid, neynarKey]);

  useEffect(() => {
    checkExisting();
  }, [checkExisting]);

  async function handleCreate() {
    if (!fid || !walletClient) return;
    setState({ id: "creating" });
    try {
      const signer = await createNeynarSigner(neynarKey);
      const deadline = Math.floor(Date.now() / 1000) + 86400 * 365;
      setState({ id: "approving", signer, deadline });
    } catch (e: unknown) {
      setState({ id: "error", msg: e instanceof Error ? e.message : "Failed to create signer" });
    }
  }

  async function handleApprove(signer: NeynarSigner, deadline: number) {
    if (!fid || !walletClient) return;
    setState({ id: "registering" });
    try {
      const signature = await walletClient.signTypedData({
        account: walletClient.account!,
        domain: SIGNED_KEY_REQUEST_DOMAIN,
        types: SIGNED_KEY_REQUEST_TYPES,
        primaryType: "SignedKeyRequest",
        message: {
          requestFid: fid,
          key: signer.public_key as `0x${string}`,
          deadline: BigInt(deadline),
        },
      });

      const approved = await approveSignerWithSignature(
        signer.signer_uuid,
        Number(fid),
        deadline,
        signature,
        neynarKey
      );

      setSigner(approved.signer_uuid);
      setState({ id: "active", publicKey: approved.public_key });
    } catch (e: unknown) {
      setState({ id: "error", msg: e instanceof Error ? e.message : "Approval failed" });
    }
  }

  if (state.id === "checking") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Checking signer status...
      </div>
    );
  }

  if (state.id === "active") {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-3 p-4 rounded-xl bg-emerald-500/8 border border-emerald-500/20">
          <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-emerald-400">Signer active</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              You can publish casts, react, and follow.
            </p>
          </div>
        </div>
        {localSigner && (
          <div className="p-3 rounded-xl bg-muted/20 border border-border/50">
            <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
              Local Ed25519 key (HD path m/44'/60'/0'/0/1)
            </p>
            <code className="text-[11px] text-primary font-mono break-all">
              {localSigner.publicKeyHex}
            </code>
          </div>
        )}
      </div>
    );
  }

  if (state.id === "creating" || state.id === "registering") {
    return (
      <div className="flex items-center gap-2 p-4 rounded-xl bg-primary/5 border border-primary/15 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 text-primary shrink-0 animate-spin" />
        {state.id === "creating" ? "Creating signer key..." : "Registering on Farcaster..."}
      </div>
    );
  }

  if (state.id === "approving") {
    const { signer, deadline } = state;
    return (
      <div className="space-y-4">
        <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 text-sm leading-relaxed space-y-2">
          <p className="text-foreground/80 font-medium flex items-center gap-2">
            <Key className="w-4 h-4 text-primary" />
            Approve Farcaster Signer
          </p>
          <p className="text-muted-foreground text-xs">
            Sign with your custody wallet to register this signer key on Farcaster.
            No ETH is required · Neynar pays for gas.
          </p>
          <div className="pt-1 p-2.5 rounded-lg bg-muted/30 border border-border/50">
            <p className="text-[10px] text-muted-foreground mb-1 font-medium uppercase tracking-wide">
              Signer public key
            </p>
            <code className="text-[11px] text-primary font-mono break-all">
              {signer.public_key}
            </code>
          </div>
        </div>
        <button
          onClick={() => handleApprove(signer, deadline)}
          className="w-full py-3 rounded-xl text-primary-foreground font-semibold text-sm btn-luxury flex items-center justify-center gap-2"
        >
          Sign and Activate
        </button>
        <button
          onClick={() => setState({ id: "no_signer" })}
          className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-primary/5 border border-primary/15 text-sm text-muted-foreground leading-relaxed space-y-2">
        <p className="text-foreground/80 font-medium flex items-center gap-2">
          <Key className="w-4 h-4 text-primary" />
          Activate Signer
        </p>
        <p>
          A signer lets you publish casts, react to casts, and follow people · all via this
          client. No ETH required; Neynar handles onchain registration.
        </p>
        <a
          href="https://docs.neynar.com/docs/create-a-signer-managed-by-neynar"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-primary hover:underline"
        >
          Learn how signers work
          <ExternalLink className="w-3 h-3" />
        </a>
      </div>

      {state.id === "error" && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-destructive/8 border border-destructive/20 text-xs text-destructive">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{state.msg}</span>
        </div>
      )}

      <button
        onClick={handleCreate}
        className="w-full py-3 rounded-xl text-primary-foreground font-semibold text-sm btn-luxury flex items-center justify-center gap-2"
      >
        Create and Activate Signer
      </button>
    </div>
  );
}
