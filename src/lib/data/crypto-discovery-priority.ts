/**
 * Prioritize a balanced, real-data discovery batch across crypto spot,
 * perpetual swaps, and dated futures.
 *
 * OKX includes USD-margined contracts whose IDs differ from the more common
 * USDT/USDC format (for example, 0G-USD_UM_XPERP-310905). Do not discard
 * these valid contracts merely because their quote/settlement suffix differs.
 */
export type DiscoveredCryptoInstrument = { instId: string; instType?: string };
export type CryptoMarketType = "spot" | "perpetual" | "futures";

const DEFAULT_CRYPTO_PRIORITY = [
  "BTC/USD", "BTC-USDT", "BTC-USDT-SWAP", "ETH/USD", "ETH-USDT", "ETH-USDT-SWAP",
  "SOL-USDT", "SOL-USDT-SWAP", "XRP-USDT", "XRP-USDT-SWAP", "BNB-USDT-SWAP",
  "DOGE-USDT-SWAP", "ADA-USDT-SWAP", "AVAX-USDT-SWAP", "LINK-USDT-SWAP",
  "SUI-USDT-SWAP", "AAVE-USDT-SWAP", "LTC-USDT-SWAP", "DOT-USDT-SWAP",
  "UNI-USDT-SWAP", "NEAR-USDT-SWAP", "APT-USDT-SWAP",
];

export function cryptoMarketType(instId: string, instType?: string): CryptoMarketType {
  const type = (instType ?? "").toUpperCase();
  if (type === "SWAP" || /(?:-SWAP|_XPERP)$/i.test(instId)) return "perpetual";
  if (type === "FUTURES" || /-[0-9]{6}$/.test(instId.toUpperCase())) return "futures";
  return "spot";
}

export function prioritizeCryptoDiscovery<T extends DiscoveredCryptoInstrument>(instruments: readonly T[]): T[] {
  const priority = new Map(DEFAULT_CRYPTO_PRIORITY.map((id, index) => [id, index]));
  const quoteRank = (id: string) =>
    /-USDT-SWAP$/i.test(id) ? 0 :
    /-USDC-SWAP$/i.test(id) ? 1 :
    /-(?:USDT|USDC)-[0-9]{6}$/i.test(id) ? 2 :
    // Standard OKX USD-margined dated futures and normalized UM IDs.
    /-USD(?:_UM_XPERP)?-[0-9]{6}$/i.test(id) ? 2 :
    /-USD(?:_UM_XPERP)?-SWAP$/i.test(id) ? 1 :
    /-USDT$/i.test(id) ? 3 :
    /-USDC$/i.test(id) ? 4 : 9;
  const typeRank = (type?: string) =>
    type?.toUpperCase() === "SWAP" ? 0 :
    type?.toUpperCase() === "FUTURES" ? 1 : 2;
  const sorted = [...instruments]
    .filter((item) => !/^1000/i.test(item.instId))
    .filter((item) => !/(?:-3L|-3S|-5L|-5S)-/i.test(item.instId))
    .filter((item) => quoteRank(item.instId) < 9)
    .sort((a, b) => {
      const pa = priority.get(a.instId) ?? 1000;
      const pb = priority.get(b.instId) ?? 1000;
      if (pa !== pb) return pa - pb;
      const qa = quoteRank(a.instId), qb = quoteRank(b.instId);
      if (qa !== qb) return qa - qb;
      const ta = typeRank(a.instType), tb = typeRank(b.instType);
      if (ta !== tb) return ta - tb;
      return a.instId.localeCompare(b.instId);
    });
  const spot = sorted.filter((item) => cryptoMarketType(item.instId, item.instType) === "spot");
  const swaps = sorted.filter((item) => cryptoMarketType(item.instId, item.instType) === "perpetual");
  const futures = sorted.filter((item) => cryptoMarketType(item.instId, item.instType) === "futures");
  const balanced: T[] = [];
  for (let i = 0; i < Math.max(spot.length, swaps.length, futures.length); i++) {
    if (spot[i]) balanced.push(spot[i]);
    if (swaps[i]) balanced.push(swaps[i]);
    if (futures[i]) balanced.push(futures[i]);
  }
  return balanced;
}
