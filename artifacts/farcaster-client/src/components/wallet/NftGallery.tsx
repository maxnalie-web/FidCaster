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

// Always route through the server proxy - keeps the OpenSea API key off the
// client bundle and lets the server handle CORS + rate limiting.
async function fetchNfts(chain: Chain, address: string, cursor?: string): Promise<OpenSeaResp> {
  const params = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const r = await fetch(`/api/nfts/${chain}/${address}${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

// Collection-level enrichment (verification + floor price) via the generic
// OpenSea proxy (/api/opensea/*, same backend, no client-side key) - our
// `Chain` values already match OpenSea's own chain slugs 1:1, no mapping
// needed. Distinct from fetchNfts above, which lists an account's owned
// NFTs; this resolves one collection's metadata, called once per unique
// held contract and cached for the session.
interface CollectionInfo { verified: boolean; floorPriceEth: number | null }
const collectionCache = new Map<string, CollectionInfo | null>();

async function openseaFetch(path: string): Promise<any | null> {
  try {
    const r = await fetch(`/api/opensea${path}`, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

async function fetchCollectionInfo(chain: Chain, contractAddress: string): Promise<CollectionInfo | null> {
  const cacheKey = `${chain}:${contractAddress.toLowerCase()}`;
  if (collectionCache.has(cacheKey)) return collectionCache.get(cacheKey) ?? null;

  const contract = await openseaFetch(`/chain/${chain}/contract/${contractAddress}`);
  const slug: string | undefined = contract?.collection;
  if (!slug) {
    collectionCache.set(cacheKey, null);
    return null;
  }
  const stats = await openseaFetch(`/collections/${slug}/stats`);
  const info: CollectionInfo = {
    verified: contract?.safelist_request_status === "verified" || contract?.safelist_request_status === "approved",
    floorPriceEth: stats?.total?.floor_price ?? null,
  };
  collectionCache.set(cacheKey, info);
  return info;
}

interface Props {
  address: string;
}

type ChainNfts = { items: NftItem[]; next?: string; loading: boolean; loadingMore: boolean; error: string | null; loaded: boolean };

const emptyChain = (): ChainNfts => ({ items: [], loading: false, loadingMore: false, error: null, loaded: false, next: undefined });

export function NftGallery({ address }: Props) {
  const [selected, setSelected] = useState<(NftItem & { chain: Chain }) | null>(null);
  const [filter, setFilter]     = useState<Chain | "all">("all");
  const [chainData, setChainData] = useState<Record<Chain, ChainNfts>>({
    optimism: emptyChain(), base: emptyChain(), arbitrum: emptyChain(), ethereum: emptyChain(),
  });
  const [showHidden, setShowHidden] = useState(false);
  const [collectionInfo, setCollectionInfo] = useState<Map<string, CollectionInfo | null>>(new Map());

  const loadChain = useCallback(async (chain: Chain, cursor?: string) => {
    setChainData(prev => ({
      ...prev,
      [chain]: { ...prev[chain], loading: !cursor, loadingMore: !!cursor, error: null },
    }));
    try {
      const data = await fetchNfts(chain, address, cursor);
      setChainData(prev => ({
        ...prev,
        [chain]: {
          items: cursor ? [...prev[chain].items, ...(data.nfts ?? [])] : (data.nfts ?? []),
          next: data.next,
          loading: false, loadingMore: false, error: null, loaded: true,
        },
      }));
    } catch (e) {
      setChainData(prev => ({ ...prev, [chain]: { ...prev[chain], loading: false, loadingMore: false, error: String(e), loaded: true } }));
    }
  }, [address]);

  const loadMore = useCallback((chain: Chain) => {
    const cursor = chainData[chain].next;
    if (cursor) loadChain(chain, cursor);
  }, [chainData, loadChain]);

  // "Load more" for the currently-filtered chain(s) - in the "all" view this
  // pages every chain that still has more, so the grid keeps growing evenly.
  const chainsWithMore = (filter === "all" ? CHAINS : [filter]).filter(
    c => chainData[c].next && !chainData[c].loading && !chainData[c].loadingMore
  );
  const anyLoadingMore = CHAINS.some(c => chainData[c].loadingMore);

  useEffect(() => {
    CHAINS.forEach(c => loadChain(c));
  }, [loadChain]);

  const allItems: Array<NftItem & { chain: Chain }> = CHAINS.flatMap(c =>
    chainData[c].items.map(n => ({ ...n, chain: c }))
  );

  // Resolve each unique held collection's real OpenSea data in the
  // background (verification + floor price) - cached per contract, so this
  // never re-fetches the same collection twice across renders.
  useEffect(() => {
    if (allItems.length === 0) return;
    const unique = new Map<string, { chain: Chain; contract: string }>();
    for (const item of allItems) {
      const key = `${item.chain}:${item.contract.toLowerCase()}`;
      if (!collectionInfo.has(key) && !unique.has(key)) unique.set(key, { chain: item.chain, contract: item.contract });
    }
    if (unique.size === 0) return;
    let cancelled = false;
    (async () => {
      for (const { chain, contract } of unique.values()) {
        const info = await fetchCollectionInfo(chain, contract);
        if (cancelled) return;
        setCollectionInfo(prev => new Map(prev).set(`${chain}:${contract.toLowerCase()}`, info));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allItems.length]);

  const infoFor = (n: NftItem & { chain: Chain }) => collectionInfo.get(`${n.chain}:${n.contract.toLowerCase()}`);
  // Real OpenSea verification (when available) overrides the local
  // heuristic in both directions: a collection OpenSea confirms verified is
  // never hidden even without an image, and - the more common case - a
  // collection OpenSea has no record of at all (most airdropped spam) is
  // hidden even if it has a plausible-looking image/name.
  const isJunk = (n: NftItem & { chain: Chain }): boolean => {
    const info = infoFor(n);
    if (info) return !info.verified;
    return !(n.display_image_url || n.image_url) || !n.collection;
  };
  const byFloorDesc = (a: NftItem & { chain: Chain }, b: NftItem & { chain: Chain }) =>
    (infoFor(b)?.floorPriceEth ?? -1) - (infoFor(a)?.floorPriceEth ?? -1);

  const filteredItems = filter === "all" ? allItems : allItems.filter(n => n.chain === filter);
  const visibleItems  = filteredItems.filter(n => !isJunk(n)).sort(byFloorDesc);
  const hiddenItems   = filteredItems.filter(isJunk);
  const displayed     = showHidden ? [...visibleItems, ...hiddenItems] : visibleItems;
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
          No NFTs found across Optimism, Base, Arbitrum, and Ethereum.
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
                <p className="text-[9px] text-muted-foreground truncate">
                  {nft.collection}
                  {infoFor(nft)?.floorPriceEth != null ? ` · Floor ${infoFor(nft)!.floorPriceEth!.toFixed(3)} ETH` : ""}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Unverified/spam collections - display only, never blocks an item
          from being seen, just collapsed by default so a wallet full of
          airdropped junk doesn't bury the real holdings. */}
      {hiddenItems.length > 0 && (
        <button
          onClick={() => setShowHidden(v => !v)}
          className="w-full flex items-center justify-center py-2.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          {showHidden ? "Hide" : `${hiddenItems.length} hidden collection${hiddenItems.length === 1 ? "" : "s"}`}
        </button>
      )}

      {/* Load more - pages whichever chain(s) still have a next cursor */}
      {chainsWithMore.length > 0 && (
        <button
          onClick={() => chainsWithMore.forEach(c => loadMore(c))}
          disabled={anyLoadingMore}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-border text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-60"
        >
          {anyLoadingMore ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
          {anyLoadingMore ? "Loading more…" : "Load more"}
        </button>
      )}

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
