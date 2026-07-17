// Wallet parity item: lists supported EVM chains (defaults + custom) and
// lets the user add a custom one by RPC URL/chainId, or remove one they
// added. Custom networks get a delete action; default networks don't (no
// affordance shown). Ported from the native app's NetworksScreen.tsx /
// AddNetworkScreen.tsx -- same chainsStore shape, same validation rules.
import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useChainsStore, type EvmChain } from "@/store/chainsStore";

function AddNetworkForm({ onClose }: { onClose: () => void }) {
  const chains = useChainsStore(s => s.chains);
  const addCustomChain = useChainsStore(s => s.addCustomChain);

  const [name, setName] = useState("");
  const [chainId, setChainId] = useState("");
  const [rpcUrl, setRpcUrl] = useState("");
  const [symbol, setSymbol] = useState("");
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const trimmedRpc = rpcUrl.trim();
  const trimmedSymbol = symbol.trim();
  const parsedChainId = parseInt(chainId, 10);
  const chainIdValid = Number.isInteger(parsedChainId) && parsedChainId > 0 && String(parsedChainId) === chainId.trim();
  const chainIdExists = chainIdValid && chains.some(c => c.id === parsedChainId);
  const rpcValid = trimmedRpc.startsWith("http://") || trimmedRpc.startsWith("https://");
  const isValid = trimmedName.length > 0 && chainIdValid && !chainIdExists && rpcValid && trimmedSymbol.length > 0;

  function onSubmit() {
    if (!isValid) return;
    setError(null);
    try {
      addCustomChain({
        id: parsedChainId,
        name: trimmedName,
        rpcUrl: trimmedRpc,
        nativeSymbol: trimmedSymbol,
        explorerTxBase: "",
        color: "#8b5cf6",
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border p-5 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-base font-bold text-foreground">Add Network</p>
            <p className="text-xs text-muted-foreground">Add a custom EVM network by RPC URL.</p>
          </div>
          <button onClick={onClose} className="p-1"><X className="w-4 h-4 text-muted-foreground" /></button>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Network Name</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="My Network"
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Chain ID</label>
            <input value={chainId} onChange={e => setChainId(e.target.value)} placeholder="8453" inputMode="numeric"
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50" />
            {chainIdExists && <p className="text-xs text-destructive">A network with this Chain ID already exists</p>}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">RPC URL</label>
            <input value={rpcUrl} onChange={e => setRpcUrl(e.target.value)} placeholder="https://..." autoCapitalize="none" autoCorrect="off"
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm font-mono text-foreground outline-none focus:border-primary/50" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">Currency Symbol</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value)} placeholder="ETH"
              className="w-full rounded-xl border border-border bg-muted/30 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary/50" />
          </div>
        </div>

        {error && <p className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-2.5">{error}</p>}

        <button onClick={onSubmit} disabled={!isValid}
          className="w-full py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50">
          Add Network
        </button>
      </div>
    </div>
  );
}

export function NetworksSettings({ onClose }: { onClose: () => void }) {
  const chains = useChainsStore(s => s.chains);
  const hydrate = useChainsStore(s => s.hydrate);
  const removeCustomChain = useChainsStore(s => s.removeCustomChain);
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<EvmChain | null>(null);

  useEffect(() => { hydrate(); }, [hydrate]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border flex flex-col max-h-[85vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <span className="text-base font-bold text-foreground">Networks</span>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted/50 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
          {chains.map(chain => (
            <div key={chain.id} className="flex items-center gap-3 p-3.5 rounded-2xl border border-border bg-card">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: chain.color }} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{chain.name}</p>
                <p className="text-xs text-muted-foreground">{chain.nativeSymbol}</p>
              </div>
              {chain.isCustom && (
                <button onClick={() => setRemoveTarget(chain)} className="p-2 -mr-1">
                  <Trash2 className="w-4 h-4 text-destructive" />
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="px-4 pb-5 pt-1 border-t border-border">
          <button onClick={() => setAddOpen(true)}
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold">
            <Plus className="w-4 h-4" /> Add Network
          </button>
        </div>
      </div>

      {addOpen && <AddNetworkForm onClose={() => setAddOpen(false)} />}

      {removeTarget && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" onClick={() => setRemoveTarget(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border p-5 space-y-4" onClick={e => e.stopPropagation()}>
            <p className="text-base font-bold text-foreground">Remove Network?</p>
            <p className="text-sm text-muted-foreground">Remove {removeTarget.name} from your networks?</p>
            <div className="flex gap-2">
              <button onClick={() => setRemoveTarget(null)} className="flex-1 py-3 rounded-xl border border-border text-sm font-bold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors">
                Cancel
              </button>
              <button
                onClick={() => { removeCustomChain(removeTarget.id); setRemoveTarget(null); }}
                className="flex-1 py-3 rounded-xl bg-destructive text-destructive-foreground text-sm font-bold"
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
