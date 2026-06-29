import { useState, useEffect, useRef } from "react";

export interface MarketStats {
  activeListings: number;
  totalListings: number;
  totalVolumeEth: string;
  totalTrades: number;
  feePercent: string;
  avgPriceEth: string;
  minPriceEth: string;
  isReady: boolean;
  lastUpdated: number;
}

export interface FarcasterNetworkStats {
  userCount: number;
  dailyCasts: number | null;
}

export interface LandingStats {
  market: MarketStats | null;
  network: FarcasterNetworkStats | null;
  loading: boolean;
  error: string | null;
}

function formatUserCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K+`;
  return n > 0 ? `${n}+` : "—";
}

export function formatVolume(eth: string): string {
  const v = parseFloat(eth);
  if (isNaN(v) || v === 0) return "—";
  if (v >= 1000) return `${(v / 1000).toFixed(1)}K ETH`;
  if (v >= 100) return `${Math.floor(v)} ETH`;
  return `${v.toFixed(2)} ETH`;
}

export function formatCount(n: number): string {
  if (n === 0) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M+`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K+`;
  return `${n}+`;
}

export { formatUserCount };

export function useLandingStats(refreshIntervalMs = 60_000): LandingStats {
  const [state, setState] = useState<LandingStats>({
    market: null,
    network: null,
    loading: true,
    error: null,
  });
  const mounted = useRef(true);

  async function fetchAll() {
    try {
      const [marketRes, networkRes] = await Promise.allSettled([
        fetch("/api/fid-market/stats").then(r => r.ok ? r.json() : null),
        fetch("/api/farcaster/network-stats").then(r => r.ok ? r.json() : null),
      ]);

      if (!mounted.current) return;

      setState(prev => ({
        ...prev,
        loading: false,
        market: marketRes.status === "fulfilled" ? (marketRes.value as MarketStats | null) : prev.market,
        network: networkRes.status === "fulfilled" ? (networkRes.value as FarcasterNetworkStats | null) : prev.network,
        error: null,
      }));
    } catch (e) {
      if (!mounted.current) return;
      setState(prev => ({ ...prev, loading: false, error: "Failed to fetch stats" }));
    }
  }

  useEffect(() => {
    mounted.current = true;
    fetchAll();
    const interval = setInterval(fetchAll, refreshIntervalMs);
    return () => {
      mounted.current = false;
      clearInterval(interval);
    };
  }, [refreshIntervalMs]);

  return state;
}
