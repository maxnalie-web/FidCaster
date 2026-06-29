import { useState, useEffect } from "react";

let cachedPrice: number | null = null;
let cachedAt = 0;
const CACHE_MS = 5 * 60 * 1000;
const listeners = new Set<(p: number) => void>();

async function fetchEthPrice() {
  if (cachedPrice && Date.now() - cachedAt < CACHE_MS) return cachedPrice;
  try {
    const d = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd")
      .then(r => r.json());
    const price = d?.ethereum?.usd || null;
    if (price) {
      cachedPrice = price;
      cachedAt = Date.now();
      listeners.forEach(fn => fn(price));
    }
    return price;
  } catch {
    return cachedPrice;
  }
}

export function useEthPrice(): number | null {
  const [price, setPrice] = useState<number | null>(cachedPrice);

  useEffect(() => {
    fetchEthPrice().then(p => { if (p) setPrice(p); });
    listeners.add(setPrice);
    return () => { listeners.delete(setPrice); };
  }, []);

  return price;
}
