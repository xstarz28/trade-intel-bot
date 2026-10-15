import type { TokenomicsIntelligence } from "./types";

function positiveFinite(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parse CoinGecko's public coin-detail response as a SUPPLY-only fallback.
 * It intentionally never invents an unlock schedule: this fallback can fill
 * circulating/total/max supply fields, but upcoming unlock events stay absent.
 */
export function parseCoinGeckoSupplyFallback(
  payload: unknown,
  fetchedAt = Date.now(),
): TokenomicsIntelligence | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const marketData = root.market_data;
  if (!marketData || typeof marketData !== "object") return null;
  const md = marketData as Record<string, unknown>;
  const circulatingSupply = positiveFinite(md.circulating_supply);
  const totalSupply = positiveFinite(md.total_supply);
  const maxSupply = positiveFinite(md.max_supply);
  if (circulatingSupply === undefined && totalSupply === undefined && maxSupply === undefined) return null;

  const denominator = maxSupply ?? totalSupply;
  const updated = typeof md.last_updated === "string" ? Date.parse(md.last_updated) : Number.NaN;
  const observedAt = Number.isFinite(updated) && updated > 0 ? updated : fetchedAt;
  const supply: NonNullable<TokenomicsIntelligence["supply"]> = {
    reliable: circulatingSupply !== undefined,
    ...(circulatingSupply !== undefined ? { circulatingSupply } : {}),
    ...(totalSupply !== undefined ? { totalSupply } : {}),
    ...(maxSupply !== undefined ? { maxSupply } : {}),
    ...(circulatingSupply !== undefined && denominator !== undefined
      ? { circulatingPercent: Math.min(100, circulatingSupply / denominator * 100) }
      : {}),
  };

  return {
    provider: "CoinGecko public API",
    observedAt,
    freshness: fetchedAt - observedAt > 24 * 60 * 60_000 ? "STALE" : "FRESH",
    quality: "DEGRADED",
    available: true,
    failureReason: "Supply metrics use CoinGecko as a fallback. This source does not provide a verified upcoming unlock calendar; unlock events remain unconfirmed.",
    supply,
    availableDatasets: 1,
    totalDatasets: 2,
  };
}
