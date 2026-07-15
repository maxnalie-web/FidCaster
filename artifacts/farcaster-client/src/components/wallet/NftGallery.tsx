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

const CHAINS = ["optimism", "base"] as const;
type Chain = typeof CHAINS[number];

const CHAIN_LABEL: Record<Chain, string> = { optimism: "Optimism", base: "Base" };
const CHAIN_COLOR: Record<Chain, string> = { optimism: "#ff0420", base: "#0052ff" };

async function fetchNfts(chain: Chain, address: string, cursor?: string): Promise<OpenSeaResp> {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const r = await fetch(`/api/nfts/${chain}/${address}${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

interface Props {
  address: string;
}

type ChainNfts = { items: NftItem[]; next?: string; loading: boolean; error: string | null; loaded: boolean };

export function NftGallery({ address }: Props) {
  const [selected, setSelected] = useState<NftItem | null>(null);
  const [filter, setFilter] = useState<Chain | "all">("all");
  const [chainData, setChainData] = useState<Record<Chain, ChainNfts>>({
    optimism: { items: [], loading: false, error: null, loaded: false, next: undefined },
    base:     { items: [], loading: false, error: null, loaded: false, next: undefined },
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

  const allItems: Array<NftItem & { chain: Chain }> = [
    ...chainData.optimism.items.map(n => ({ ...n, chain: "optimism" as Chain })),
    ...chainData.base.items.map(n => ({ ...n, chain: "base" as Chain })),
  ];
  const displayed = filter === "all" ? allItems : allItems.filter(n => n.chain === filter);
  const isLoading = CHAINS.some(c => chainData[c].loading && !chainData[c].loaded);
  const totalCount = allItems.length;

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
      <div className="flex flex-col items-center justify-center py-16 px-5 gap-3 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
          <ImageOff className="w-8 h-8 text-muted-foreground/40" />
        </div>
        <p className="text-sm font-bold text-foreground">No NFTs found</p>
        <p className="text-xs text-muted-foreground">NFTs on Optimism and Base will appear here</p>
        <button onClick={() => CHAINS.forEach(c => loadChain(c))} className="mt-1 flex items-center gap-1.5 text-xs text-primary font-semibold">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>
    );
  }

  return (
    <>
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-end justify-center p-4" onClick={() => setSelected(null)}>
          <div className="bg-card rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
            {(selected.display_image_url || selected.image_url) ? (
              <img
                src={selected.display_image_url || selected.image_url!}
                alt={selected.name ?? "NFT"}
                className="w-full aspect-square object-cover"
                onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <div className="w-full aspect-square bg-muted/40 flex items-center justify-center">
                <ImageOff className="w-12 h-12 text-muted-foreground/40" />
              </div>
            )}
            <div className="p-4 space-y-2">
              <p className="text-base font-bold text-foreground">{selected.name ?? `#${selected.identifier}`}</p>
              <p className="text-xs text-muted-foreground">{selected.collection}</p>
              {selected.description && (
                <p className="text-xs text-muted-foreground line-clamp-3">{selected.description}</p>
              )}
              {selected.opensea_url && (
                <a href={selected.opensea_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs text-primary font-semibold mt-1">
                  <ExternalLink size={12} /> View on OpenSea
                </a>
              )}
            </div>
            <button onClick={() => setSelected(null)} className="w-full py-3 border-t border-border text-sm font-bold text-muted-foreground">Close</button>
          </div>
        </div>
      )}

      <div className="px-4 pt-2 pb-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 p-1 rounded-xl bg-muted/40 border border-border/40">
            {(["all", ...CHAINS] as const).map(c => (
              <button key={c} onClick={() => setFilter(c)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${filter === c ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                {c === "all" ? `All (${totalCount})` : CHAIN_LABEL[c]}
              </button>
            ))}
          </div>
          <button onClick={() => CHAINS.forEach(c => loadChain(c))} className="p-2 text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw size={14} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          {displayed.map((nft, i) => (
            <button key={`${nft.chain}-${nft.contract}-${nft.identifier}-${i}`}
              onClick={() => setSelected(nft)}
              className="rounded-2xl overflow-hidden border border-border/50 bg-card hover:bg-muted/30 transition-all text-left active:scale-95"
            >
              <div className="relative aspect-square bg-muted/40">
                {(nft.display_image_url || nft.image_url) ? (
                  <img src={nft.display_image_url || nft.image_url!} alt={nft.name ?? "NFT"}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <ImageOff className="w-8 h-8 text-muted-foreground/30" />
                  </div>
                )}
                <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded-md text-[8px] font-bold text-white"
                  style={{ backgroundColor: CHAIN_COLOR[nft.chain] }}>
                  {CHAIN_LABEL[nft.chain] === "Optimism" ? "OP" : "Base"}
                </div>
              </div>
              <div className="p-2.5">
                <p className="text-xs font-bold text-foreground truncate">{nft.name ?? `#${nft.identifier}`}</p>
                <p className="text-[10px] text-muted-foreground truncate">{nft.collection}</p>
              </div>
            </button>
          ))}
        </div>

        {CHAINS.map(c => chainData[c].next && (
          <button key={c} onClick={() => loadChain(c, chainData[c].next)}
            disabled={chainData[c].loading}
            className="w-full py-3 rounded-xl border border-border/40 text-xs font-semibold text-muted-foreground hover:bg-muted/30 disabled:opacity-40"
          >
            {chainData[c].loading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : `Load more ${CHAIN_LABEL[c]} NFTs`}
          </button>
        ))}
      </div>
    </>
  );
}
