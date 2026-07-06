import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import {
  getRecoveryAddress,
  getCustodyAddress,
  ID_REGISTRY_ADDRESS,
  ID_REGISTRY_ABI,
  publicClient,
} from "@/lib/contracts";
import { Loader2, ShieldAlert, ShieldCheck, ExternalLink, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { isAddress } from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function shortAddr(addr: string) {
  return `${addr.slice(0, 10)}...${addr.slice(-8)}`;
}

export function RecoveryPanel() {
  const { fid, address, walletClient } = useWallet();

  const [recoveryAddr, setRecoveryAddr] = useState<`0x${string}` | null>(null);
  const [custodyAddr, setCustodyAddr] = useState<`0x${string}` | null>(null);
  const [loading, setLoading] = useState(true);

  const [newRecovery, setNewRecovery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fid) return;
    setLoading(true);
    Promise.all([getRecoveryAddress(fid), getCustodyAddress(fid)])
      .then(([rec, cust]) => {
        setRecoveryAddr(rec);
        setCustodyAddr(cust);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [fid]);

  async function handleChangeRecovery(e: React.FormEvent) {
    e.preventDefault();
    if (!walletClient || !address || !isAddress(newRecovery)) return;

    setSubmitting(true);
    setError(null);
    setTxHash(null);

    try {
      // Explicit gas hint (see contracts.ts) avoids a false "likely to fail"
      // warning some wallets show on an unsimulated writeContract call.
      let gas: bigint | undefined;
      try {
        const estimated = await publicClient.estimateContractGas({
          address: ID_REGISTRY_ADDRESS,
          abi: ID_REGISTRY_ABI,
          functionName: "changeRecoveryAddress",
          args: [newRecovery as `0x${string}`],
          account: address,
        });
        gas = (estimated * 130n) / 100n;
      } catch { /* leave gas unset · wallet estimates on its own */ }

      const hash = await walletClient.writeContract({
        address: ID_REGISTRY_ADDRESS,
        abi: ID_REGISTRY_ABI,
        functionName: "changeRecoveryAddress",
        args: [newRecovery as `0x${string}`],
        account: address,
        chain: undefined,
        ...(gas !== undefined ? { gas } : {}),
      });
      setTxHash(hash);
      setNewRecovery("");
      setRecoveryAddr(newRecovery as `0x${string}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setSubmitting(false);
    }
  }

  const isZeroRecovery =
    !recoveryAddr || recoveryAddr.toLowerCase() === ZERO_ADDRESS;

  const inputIsValid = isAddress(newRecovery) && newRecovery.toLowerCase() !== address?.toLowerCase();

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 p-3.5 rounded-xl bg-primary/5 border border-primary/15">
        <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground leading-relaxed">
          The recovery address can transfer your FID if you lose access to your
          custody wallet. This calls{" "}
          <code className="text-foreground/75 font-mono text-[11px]">
            changeRecoveryAddress(address)
          </code>{" "}
          directly on the{" "}
          <a
            href={`https://optimistic.etherscan.io/address/${ID_REGISTRY_ADDRESS}`}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline inline-flex items-center gap-0.5"
          >
            IdRegistry contract
            <ExternalLink className="w-2.5 h-2.5" />
          </a>{" "}
          on Optimism.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="p-3.5 rounded-xl bg-card/60 border border-border/60 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Custody address</span>
              <span className="font-mono text-foreground/80">
                {custodyAddr ? shortAddr(custodyAddr) : "unknown"}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1.5">
                {isZeroRecovery ? (
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                )}
                Recovery address
              </span>
              <span
                className={cn(
                  "font-mono",
                  isZeroRecovery ? "text-amber-400" : "text-foreground/80"
                )}
              >
                {isZeroRecovery ? "not set" : shortAddr(recoveryAddr!)}
              </span>
            </div>
          </div>

          <form onSubmit={handleChangeRecovery} className="space-y-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1.5">
                New recovery address
              </label>
              <input
                type="text"
                value={newRecovery}
                onChange={(e) => setNewRecovery(e.target.value.trim())}
                placeholder="0x..."
                className="input-luxury w-full py-3 px-3.5 text-sm font-mono"
              />
              {newRecovery && !isAddress(newRecovery) && (
                <p className="text-xs text-destructive mt-1">
                  Invalid Ethereum address
                </p>
              )}
            </div>

            {txHash && (
              <div className="p-3.5 rounded-xl text-sm border bg-emerald-500/8 text-emerald-400 border-emerald-500/20 space-y-1">
                <p className="font-medium">Recovery address updated</p>
                <a
                  href={`https://optimistic.etherscan.io/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-mono hover:underline flex items-center gap-1"
                >
                  {shortAddr(txHash)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            )}

            {error && (
              <div className="p-3.5 rounded-xl text-sm border bg-destructive/8 text-destructive border-destructive/20">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!inputIsValid || submitting}
              className="w-full py-3 rounded-xl text-primary-foreground font-semibold text-sm btn-luxury"
            >
              {submitting ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Sending transaction...
                </span>
              ) : (
                "Change Recovery Address"
              )}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
