import React, { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ExternalLink, ImageOff } from "lucide-react";

interface NftItem {
  identifier: string;
  collection: string;
  contract: string;
  token_standard: string;
  name: string | null;
  description: string | null;
  image_url: string | null;
  display_image_url: string | null;
  opensea_url: string | null;
}

interface OpenSeaResp {
  nfts: NftItem[];
  next?: string;
}

const CHAINS = ["optimism", "base", "arbitrum", "ethereum"] as const;
type Chain = typeof CHAINS[number];

const CHAIN_LABEL: Record<Chain, string> = {
  optimism: "Optimism",
  base: "Base",
  arbitrum: "Arbitrum",
  ethereum: "Ethereum",
};
const CHAIN_COLOR: Record<Chain, string> = {
  optimism: "#ff0420",
  base: "#0052ff",
  arbitrum: "#9945ff",
  ethereum: "#627eea",
};

const OPENSEA_KEY = (import.meta.env.VITE_OPENSEA_API_KEY as string | undefined) ?? "";

async function fetchNfts(chain: Chain, address: string, cursor?: string): Promise<OpenSeaResp> {
  if (OPENSEA_KEY) {
    const params = new URLSearchParams({ limit: "50" });
    if (cursor) params.set("next", cursor);
    const r = await fetch(
      `https://api.opensea.io/api/v2/chain/${chain}/account/${address}/nfts?${params}`,
      {
        headers: { "X-API-KEY": OPENSEA_KEY, "accept": "application/json" },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!r.ok) throw new Error(`OpenSea ${r.status}`);
    return r.json();
  }
  // Dev fallback: server proxy
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const r = await fetch(`/api/nfts/${chain}/${address}${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

interface Props {
  address: string;
}

type ChainNfts = { items: NftItem[]; next?: string; loading: boolean; error: string | null; loaded: boolean };

const emptyChain = (): ChainNfts => ({ items: [], loading: false, error: null, loaded: false, next: undefined });

export function NftGallery({ address }: Props) {
  const [selected, setSelected] = useState<(NftItem & { chain: Chain }) | null>(null);
  const [filter, setFilter]     = useState<Chain | "all">("all");
  const [chainData, setChainData] = useState<Record<Chain, ChainNfts>>({
    optimism: emptyChain(), base: emptyChain(), arbitrum: emptyChain(), ethereum: emptyChain(),
  });

  const loadChain = useCallback(async (chain: Chain, cursor?: string) => {
    setChainData(prev => ({ ...prev, [chain]: { ...prev[chain], loading: true, error: null } }));
    try {
      const data = await fetchNfts(chain, address, cursor);
      setChainData(prev => ({
        ...prev,
        [chain]: {
          items: cursor ? [...prev[chain].items, ...(data.nfts ?? [])] : (data.nfts ?? []),
          next: data.next,
          loading: false, error: null, loaded: true,
        },
      }));
    } catch (e) {
      setChainData(prev => ({ ...prev, [chain]: { ...prev[chain], loading: false, error: String(e), loaded: true } }));
    }
  }, [address]);

  useEffect(() => {
    CHAINS.forEach(c => loadChain(c));
  }, [loadChain]);

  const allItems: Array<NftItem & { chain: Chain }> = CHAINS.flatMap(c =>
    chainData[c].items.map(n => ({ ...n, chain: c }))
  );
  const displayed   = filter === "all" ? allItems : allItems.filter(n => n.chain === filter);
  const isLoading   = CHAINS.some(c => chainData[c].loading && !chainData[c].loaded);
  const totalCount  = allItems.length;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <Loader2 className="w-7 h-7 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading NFTs…</p>
      </div>
    );
  }

  if (totalCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 px-5 text-center">
        <ImageOff className="w-10 h-10 text-muted-foreground/30" />
        <p className="text-sm font-semibold text-foreground">No NFTs found</p>
        <p className="text-xs text-muted-foreground">
          {OPENSEA_KEY
            ? "No NFTs found across Optimism, Base, Arbitrum, and Ethereum."
            : "Set VITE_OPENSEA_API_KEY to enable NFT fetching in production."}
        </p>
        <button
          onClick={() => CHAINS.forEach(c => loadChain(c))}
          className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 space-y-3">
      {/* Chain filter */}
      <div className="flex gap-1.5 flex-wrap pt-2">
        {(["all", ...CHAINS] as const).map(c => {
          const count = c === "all" ? totalCount : chainData[c].items.length;
          if (c !== "all" && count === 0 && chainData[c].loaded) return null;
          return (
            <button
              key={c}
              onClick={() => setFilter(c)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                filter === c
                  ? "bg-primary/10 border-primary/30 text-primary"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {c === "all" ? "All" : CHAIN_LABEL[c]}
              {count > 0 && (
                <span className={`text-[9px] font-bold px-1 py-0.5 rounded-full ${
                  filter === c ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"
                }`}>{count}</span>
              )}
            </button>
          );
        })}
        <button
          onClick={() => CHAINS.forEach(c => loadChain(c))}
          className="ml-auto p-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
        </button>
      </div>

      {/* NFT grid */}
      <div className="grid grid-cols-2 gap-2.5">
        {displayed.map((nft, i) => {
          const img = nft.display_image_url || nft.image_url;
          const key = `${nft.chain}-${nft.contract}-${nft.identifier}-${i}`;
          return (
            <button
              key={key}
              onClick={() => setSelected(nft)}
              className="rounded-2xl overflow-hidden border border-border bg-card hover:border-primary/30 transition-all active:scale-[0.98] text-left"
            >
              <div className="aspect-square bg-muted relative overflow-hidden">
                {img ? (
                  <img
                    src={img}
                    alt={nft.name ?? "NFT"}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageOff className="w-8 h-8 text-muted-foreground/30" />
                  </div>
                )}
                <div
                  className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-full text-[8px] font-bold text-white"
                  style={{ backgroundColor: CHAIN_COLOR[nft.chain] }}
                >
                  {nft.chain === "optimism" ? "OP" : nft.chain === "base" ? "Base" : nft.chain === "arbitrum" ? "ARB" : "ETH"}
                </div>
              </div>
              <div className="p-2">
                <p className="text-[11px] font-bold text-foreground truncate">{nft.name || `#${nft.identifier}`}</p>
                <p className="text-[9px] text-muted-foreground truncate">{nft.collection}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Detail modal */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-end lg:items-center justify-center bg-black/60 backdrop-blur-sm lg:p-6"
          onClick={() => setSelected(null)}
        >
          <div
            className="relative bg-card rounded-t-[28px] lg:rounded-2xl w-full lg:max-w-sm max-h-[80vh] overflow-auto"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-border rounded-full mx-auto mt-3 mb-0 lg:hidden" />
            <div className="aspect-square bg-muted overflow-hidden rounded-t-[28px] lg:rounded-t-2xl">
              {(selected.display_image_url || selected.image_url) ? (
                <img src={selected.display_image_url || selected.image_url!} alt={selected.name ?? "NFT"} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageOff className="w-16 h-16 text-muted-foreground/20" />
                </div>
              )}
            </div>
            <div className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-black text-foreground truncate">{selected.name || `#${selected.identifier}`}</p>
                  <p className="text-xs text-muted-foreground truncate">{selected.collection}</p>
                </div>
                <div
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold text-white shrink-0"
                  style={{ backgroundColor: CHAIN_COLOR[selected.chain] }}
                >
                  {CHAIN_LABEL[selected.chain]}
                </div>
              </div>
              {selected.description && (
                <p className="text-xs text-muted-foreground line-clamp-3">{selected.description}</p>
              )}
              {selected.opensea_url && (
                <a
                  href={selected.opensea_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> View on OpenSea
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
