import React from "react";
import { X, ExternalLink, Repeat, ArrowLeftRight, TrendingUp, Layers, Droplets } from "lucide-react";
import { cn } from "@/lib/utils";

interface DeFiApp {
  name: string;
  desc: string;
  url: string;
  logo: string;
  category: "swap" | "bridge" | "earn" | "perps";
  networks: ("op" | "base")[];
  accent: string;
}

const APPS: DeFiApp[] = [
  {
    name: "Uniswap",
    desc: "Leading DEX",
    url: "https://app.uniswap.org/swap?chain=optimism",
    logo: "https://assets.coingecko.com/coins/images/12504/small/uni.jpg",
    category: "swap",
    networks: ["op", "base"],
    accent: "#ff007a",
  },
  {
    name: "Velodrome",
    desc: "Optimism DEX",
    url: "https://app.velodrome.finance/swap",
    logo: "https://assets.coingecko.com/coins/images/25783/small/velo.png",
    category: "swap",
    networks: ["op"],
    accent: "#ff0420",
  },
  {
    name: "Aerodrome",
    desc: "Base DEX",
    url: "https://aerodrome.finance/swap",
    logo: "https://assets.coingecko.com/coins/images/31745/small/token.png",
    category: "swap",
    networks: ["base"],
    accent: "#0052ff",
  },
  {
    name: "1inch",
    desc: "DEX Aggregator",
    url: "https://app.1inch.io/#/10/simple/swap/ETH",
    logo: "https://assets.coingecko.com/coins/images/13469/small/1inch-token.png",
    category: "swap",
    networks: ["op", "base"],
    accent: "#1b314f",
  },
  {
    name: "Across",
    desc: "Fast Bridge",
    url: "https://app.across.to/bridge",
    logo: "https://assets.coingecko.com/coins/images/26580/small/across.png",
    category: "bridge",
    networks: ["op", "base"],
    accent: "#6cf9d8",
  },
  {
    name: "Stargate",
    desc: "Cross-chain Bridge",
    url: "https://stargate.finance/bridge",
    logo: "https://assets.coingecko.com/coins/images/24413/small/STG_LOGO.png",
    category: "bridge",
    networks: ["op", "base"],
    accent: "#888",
  },
  {
    name: "Relay",
    desc: "Instant Bridge",
    url: "https://relay.link/bridge",
    logo: "https://relay.link/favicon.ico",
    category: "bridge",
    networks: ["op", "base"],
    accent: "#7c3aed",
  },
  {
    name: "Aave",
    desc: "Lend & Borrow",
    url: "https://app.aave.com/?marketName=proto_optimism_v3",
    logo: "https://assets.coingecko.com/coins/images/12645/small/AAVE.png",
    category: "earn",
    networks: ["op", "base"],
    accent: "#b6509e",
  },
  {
    name: "Compound",
    desc: "Money Markets",
    url: "https://app.compound.finance/?market=usdc-mainnet",
    logo: "https://assets.coingecko.com/coins/images/10775/small/COMP.png",
    category: "earn",
    networks: ["base"],
    accent: "#00d395",
  },
  {
    name: "Morpho",
    desc: "Optimized Lending",
    url: "https://app.morpho.org",
    logo: "https://assets.coingecko.com/coins/images/27531/small/morpho.png",
    category: "earn",
    networks: ["op", "base"],
    accent: "#2470ff",
  },
  {
    name: "Synthetix",
    desc: "Derivatives",
    url: "https://staking.synthetix.io",
    logo: "https://assets.coingecko.com/coins/images/3406/small/SNX.png",
    category: "perps",
    networks: ["op"],
    accent: "#5fcdf9",
  },
  {
    name: "Kwenta",
    desc: "Perps Trading",
    url: "https://app.kwenta.io/market/?asset=sETH",
    logo: "https://assets.coingecko.com/coins/images/27824/small/kwenta.png",
    category: "perps",
    networks: ["op"],
    accent: "#c9975b",
  },
];

const CATEGORIES: { id: DeFiApp["category"]; label: string; icon: typeof Repeat }[] = [
  { id: "swap", label: "Swap", icon: Repeat },
  { id: "bridge", label: "Bridge", icon: ArrowLeftRight },
  { id: "earn", label: "Earn", icon: TrendingUp },
  { id: "perps", label: "Perps", icon: Layers },
];

interface Props {
  onClose: () => void;
  walletColor: string;
  onOpenBrowser: (url: string) => void;
}

export function DeFiAppsSheet({ onClose, walletColor, onOpenBrowser }: Props) {
  const [activeCategory, setActiveCategory] = React.useState<DeFiApp["category"] | "all">("all");

  const filtered = activeCategory === "all" ? APPS : APPS.filter(a => a.category === activeCategory);

  function open(app: DeFiApp) {
    onOpenBrowser(app.url);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: `${walletColor}20` }}>
            <Droplets size={16} style={{ color: walletColor }} />
          </div>
          <span className="text-base font-bold text-foreground">DeFi Apps</span>
        </div>
        <button onClick={onClose} className="p-1 text-muted-foreground hover:text-foreground">
          <X size={20} />
        </button>
      </div>

      {/* Category pills */}
      <div className="flex items-center gap-2 px-4 pb-3 overflow-x-auto scrollbar-none shrink-0">
        <button
          onClick={() => setActiveCategory("all")}
          className={cn(
            "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all",
            activeCategory === "all"
              ? "text-white"
              : "bg-muted/60 text-muted-foreground hover:text-foreground"
          )}
          style={activeCategory === "all" ? { backgroundColor: walletColor } : {}}
        >
          All
        </button>
        {CATEGORIES.map(cat => {
          const CatIcon = cat.icon;
          const active = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={cn(
                "flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all",
                active
                  ? "text-white"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              )}
              style={active ? { backgroundColor: walletColor } : {}}
            >
              <CatIcon size={11} />
              {cat.label}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
        <div className="grid grid-cols-2 gap-3">
          {filtered.map(app => (
            <button
              key={app.name}
              onClick={() => open(app)}
              className="flex items-center gap-3 p-3.5 rounded-2xl bg-card border border-border/60 hover:border-border hover:bg-muted/30 active:scale-[0.97] transition-all text-left"
            >
              <div className="relative shrink-0">
                <div className="w-11 h-11 rounded-2xl overflow-hidden bg-muted flex items-center justify-center border border-border/40">
                  <img
                    src={app.logo}
                    alt={app.name}
                    className="w-full h-full object-cover"
                    onError={e => {
                      const el = e.target as HTMLImageElement;
                      el.style.display = "none";
                      if (el.parentElement) {
                        el.parentElement.innerHTML = `<span style="font-size:18px;font-weight:900;color:${app.accent}">${app.name[0]}</span>`;
                      }
                    }}
                  />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 flex gap-0.5">
                  {app.networks.map(net => (
                    <div
                      key={net}
                      className="w-3.5 h-3.5 rounded-full border border-card flex items-center justify-center"
                      style={{ backgroundColor: net === "op" ? "#ff0420" : "#0052ff" }}
                    >
                      <span className="text-[6px] font-black text-white leading-none">{net === "op" ? "O" : "B"}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <p className="text-sm font-bold text-foreground truncate">{app.name}</p>
                  <ExternalLink size={10} className="text-muted-foreground/60 shrink-0" />
                </div>
                <p className="text-[11px] text-muted-foreground truncate">{app.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
