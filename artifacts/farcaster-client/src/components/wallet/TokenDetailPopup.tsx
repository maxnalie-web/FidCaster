import { useState, useEffect, useRef } from "react";
import { X, Send, Repeat, TrendingUp, TrendingDown, ExternalLink, Loader2, EyeOff, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

interface PricePoint { t: number; p: number }

interface Props {
  tokenKey: string;
  name: string;
  symbol: string;
  network: string;
  networkColor: string;
  balance: number;
  usdValue: number | null;
  icon: string;
  contractAddress?: string;
  onClose: () => void;
  onSend?: () => void;
  onSwap: () => void;
  hidden?: boolean;
  onToggleHide?: () => void;
}

const COINGECKO_IDS: Record<string, string> = {
  "op-eth": "ethereum",
  "base-eth": "ethereum",
  "arb-eth": "ethereum",
  "eth-eth": "ethereum",
};

const TIMEFRAMES: { label: string; days: number }[] = [
  { label: "1D", days: 1 },
  { label: "1W", days: 7 },
  { label: "1M", days: 30 },
];

function Sparkline({ points, color, up }: { points: PricePoint[]; color: string; up: boolean }) {
  if (points.length < 2) return null;
  const W = 320, H = 80;
  const prices = points.map(p => p.p);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const toX = (i: number) => (i / (points.length - 1)) * W;
  const toY = (p: number) => H - ((p - min) / range) * H * 0.8 - H * 0.1;

  const pathD = points.map((pt, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(pt.p).toFixed(1)}`).join(" ");
  const areaD = `${pathD} L ${W} ${H} L 0 ${H} Z`;
  const lineColor = up ? "#10b981" : "#ef4444";
  const gradId = `grad-${up ? "up" : "dn"}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-20 overflow-visible" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.3" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaD} fill={`url(#${gradId})`} />
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function TokenDetailPopup({ tokenKey, name, symbol, network, networkColor, balance, usdValue, icon, contractAddress, onClose, onSend, onSwap, hidden, onToggleHide }: Props) {
  const [price, setPrice] = useState<number | null>(usdValue && balance > 0 ? usdValue / balance : null);
  const [change24h, setChange24h] = useState<number | null>(null);
  const [chartPoints, setChartPoints] = useState<PricePoint[]>([]);
  const [tfIdx, setTfIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [dexPair, setDexPair] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const tf = TIMEFRAMES[tfIdx];
  const isUsdc = symbol === "USDC";
  const cgId = COINGECKO_IDS[tokenKey];

  useEffect(() => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setChartPoints([]);

    if (isUsdc) {
      setPrice(1);
      setChange24h(0);
      setChartPoints(Array.from({ length: 24 }, (_, i) => ({ t: i, p: 1 })));
      setLoading(false);
      return;
    }

    async function fetchData() {
      try {
        if (cgId) {
          const [chartRes, priceRes] = await Promise.all([
            fetch(`https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${tf.days}&interval=${tf.days === 1 ? "hourly" : "daily"}`, { signal: ac.signal }),
            fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`, { signal: ac.signal }),
          ]);
          if (chartRes.ok) {
            const { prices } = await chartRes.json();
            setChartPoints((prices as [number, number][]).map(([t, p]) => ({ t, p })));
          }
          if (priceRes.ok) {
            const data = await priceRes.json();
            setPrice(data[cgId]?.usd ?? null);
            setChange24h(data[cgId]?.usd_24h_change ?? null);
          }
        } else if (contractAddress) {
          const networkSlug = network === "Base" ? "base" : network === "Arbitrum" ? "arbitrum" : network === "Ethereum" ? "ethereum" : "optimism";
          const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`, { signal: ac.signal });
          if (res.ok) {
            const { pairs } = await res.json();
            const pair = (pairs as any[])?.find(p => p.chainId === networkSlug) ?? pairs?.[0];
            if (pair) {
              setPrice(parseFloat(pair.priceUsd ?? "0"));
              setChange24h(pair.priceChange?.h24 ?? null);
              setDexPair(pair.url);
              const hist = (pair.priceHistory?.m5 ?? pair.priceHistory?.h1 ?? []) as { timestamp: number; open: number }[];
              setChartPoints(hist.map(h => ({ t: h.timestamp, p: h.open })));
            }
          }
        }
      } catch { /* ignore abort */ }
      finally { setLoading(false); }
    }
    fetchData();
    return () => ac.abort();
  }, [tfIdx, cgId, contractAddress, isUsdc, network, symbol, tf.days]);

  const up = change24h !== null ? change24h >= 0 : true;
  const explorerChain = network === "Optimism" ? "optimism" : network === "Base" ? "base" : network === "Arbitrum" ? "arbitrum" : "ethereum";

  const formattedBalance = symbol === "USDC"
    ? balance.toFixed(2)
    : balance < 0.0001 && balance > 0 ? balance.toExponential(4) : balance.toFixed(4);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm bg-background rounded-3xl shadow-2xl border border-border flex flex-col max-h-[85vh] animate-in zoom-in-95 fade-in duration-200 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Colored header */}
        <div
          className="px-5 pt-5 pb-4 relative overflow-hidden"
          style={{ background: `linear-gradient(140deg, ${networkColor}30 0%, ${networkColor}10 100%)` }}
        >
          <div className="absolute -top-10 -right-10 w-32 h-32 rounded-full opacity-20" style={{ backgroundColor: networkColor, filter: "blur(30px)" }} />

          {/* Top row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="relative shrink-0">
                <img src={icon} alt={symbol} className="w-10 h-10 rounded-full bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
                <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-background flex items-center justify-center" style={{ backgroundColor: networkColor }}>
                  <span className="text-[7px] font-bold text-white">
                    {network === "Optimism" ? "OP" : network === "Base" ? "B" : network === "Arbitrum" ? "A" : "E"}
                  </span>
                </div>
              </div>
              <div>
                <p className="text-base font-black text-foreground">{symbol}</p>
                <p className="text-xs text-muted-foreground">{network}</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-muted/50 transition-colors">
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Price */}
          <div className="mb-1">
            {loading && price === null ? (
              <div className="flex items-center gap-2 h-9">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <p className="text-[32px] font-black text-foreground tabular-nums leading-tight">
                {price !== null ? `$${price < 0.01 ? price.toExponential(4) : price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
              </p>
            )}
            {change24h !== null && (
              <div className={cn("flex items-center gap-1 mt-0.5", up ? "text-emerald-500" : "text-red-500")}>
                {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                <span className="text-sm font-bold">{up ? "+" : ""}{change24h.toFixed(2)}% (24h)</span>
              </div>
            )}
          </div>
        </div>

        {/* Chart + timeframe */}
        <div className="px-4 pt-2 pb-1">
          {loading && chartPoints.length === 0 ? (
            <div className="h-20 flex items-center justify-center">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Sparkline points={chartPoints} color={networkColor} up={up} />
          )}
          <div className="flex gap-1.5 justify-end mt-1">
            {TIMEFRAMES.map((t, i) => (
              <button
                key={t.label}
                onClick={() => setTfIdx(i)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all",
                  i === tfIdx ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Balance */}
        <div className="mx-4 px-4 py-3 rounded-2xl bg-muted/40 border border-border/50 mb-4">
          <p className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Your Balance</p>
          <p className="text-xl font-black text-foreground tabular-nums">{formattedBalance} {symbol}</p>
          {usdValue !== null && (
            <p className="text-xs text-muted-foreground tabular-nums">
              ≈ ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2.5 px-4 pb-6" style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}>
          {onSend && (
            <button
              onClick={() => { onClose(); onSend(); }}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm transition-all active:scale-95 text-white"
              style={{ backgroundColor: networkColor }}
            >
              <Send className="w-4 h-4" />
              Send
            </button>
          )}
          <button
            onClick={() => { onClose(); onSwap(); }}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl font-bold text-sm bg-muted/60 text-foreground hover:bg-muted transition-all active:scale-95 border border-border"
          >
            <Repeat className="w-4 h-4" />
            Swap
          </button>
          {onToggleHide && (
            <button
              onClick={() => { onToggleHide(); onClose(); }}
              title={hidden ? "Unhide token" : "Hide token"}
              className="flex items-center justify-center w-12 rounded-2xl bg-muted/60 border border-border hover:bg-muted transition-all active:scale-95"
            >
              {hidden
                ? <Eye className="w-4 h-4 text-muted-foreground" />
                : <EyeOff className="w-4 h-4 text-muted-foreground" />}
            </button>
          )}
          {dexPair && (
            <a
              href={dexPair}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-center w-12 rounded-2xl bg-muted/60 border border-border hover:bg-muted transition-all active:scale-95"
            >
              <ExternalLink className="w-4 h-4 text-muted-foreground" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
