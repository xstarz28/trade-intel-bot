/**
 * CoinGecko fallback provider for crypto price quotes.
 * Free tier: 10-30 calls/min, no API key required for basic endpoints.
 * Docs: https://www.coingecko.com/en/api/documentation
 *
 * Used as a fallback when Twelve Data doesn't return a crypto quote,
 * or for supplementary on-chain context.
 */

import type { PriceSnapshot } from "../market-types";
import { toCoinGeckoId } from "../symbols";

export async function fetchCryptoPrice(
  instrument: string,
): Promise<PriceSnapshot | null> {
  const coinId = toCoinGeckoId(instrument);
  if (!coinId) return null;

  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`;
    const res = await fetch(url);
    if (!res.ok) return null;

    const json = await res.json();
    const price = json[coinId]?.usd;
    if (price === undefined) return null;

    return {
      price,
      timestamp: Date.now(),
      source: "coingecko",
    };
  } catch {
    return null;
  }
}
