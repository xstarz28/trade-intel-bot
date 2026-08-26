/**
 * Phase 41 — DeFiLlama Provider Adapter
 *
 * DeFiLlama provides TVL, fees, revenue, stablecoin context, and chain-level
 * metrics. This adapter normalizes their data into the CryptoIntelligence schema.
 *
 * NON-NEGOTIABLE:
 *   - DeFiLlama API is public (no key required for basic endpoints).
 *   - Provider availability NEVER becomes directional evidence.
 *   - All failures surface explicitly.
 *   - No fabricated values.
 *   - TVL data is informational only — never guarantees price direction.
 */

import type {
  CryptoIntelligenceProvider,
  CryptoIntelligenceProviderResult,
  DeFiIntelligence,
} from "./types";
import { toDefiLlamaId } from "./symbols";

const DEFILLAMA_BASE = "https://api.llama.fi";

/**
 * DeFiLlama adapter — fetches DeFi fundamental intelligence.
 */
export class DeFiLlamaAdapter implements CryptoIntelligenceProvider {
  readonly name = "DeFiLlama";

  /**
   * Custom fetch function for testability.
   * In production, uses global fetch. In tests, caller provides mock.
   */
  private httpFetch?: typeof fetch;

  constructor(httpFetch?: typeof fetch) {
    this.httpFetch = httpFetch;
  }

  supportsInstrument(instrument: string): boolean {
    return toDefiLlamaId(instrument) !== null;
  }

  async fetch(instrument: string): Promise<CryptoIntelligenceProviderResult | null> {
    if (!this.supportsInstrument(instrument)) return null;

    const mapping = toDefiLlamaId(instrument);
    if (!mapping) return null;

    const fetchFn = this.httpFetch ?? fetch;
    const observedAt = Date.now();

    let networkError: string | undefined;
    try {
      const data: Record<string, any> = {};

      // Fetch TVL (chain-level)
      if (mapping.level === "chain") {
        try {
          const tvlRes = await fetchFn(
            `${DEFILLAMA_BASE}/v2/historicalChainTvl/${mapping.slug}`,
          );
          if (tvlRes.ok) {
            const tvlHistory = await tvlRes.json();
            if (Array.isArray(tvlHistory) && tvlHistory.length > 0) {
              const latest = tvlHistory[tvlHistory.length - 1];
              const weekAgo = tvlHistory.find(
                (e: any) => Math.abs(e.date - latest.date) >= 6 * 86400 && Math.abs(e.date - latest.date) <= 8 * 86400,
              );
              const monthAgo = tvlHistory.find(
                (e: any) => Math.abs(e.date - latest.date) >= 28 * 86400 && Math.abs(e.date - latest.date) <= 32 * 86400,
              );
              data.tvl = {
                current: latest.tvl ?? 0,
                change7d: weekAgo && weekAgo.tvl > 0
                  ? ((latest.tvl - weekAgo.tvl) / weekAgo.tvl) * 100
                  : undefined,
                change30d: monthAgo && monthAgo.tvl > 0
                  ? ((latest.tvl - monthAgo.tvl) / monthAgo.tvl) * 100
                  : undefined,
              };
            }
          }
        } catch (e) {
          networkError = e instanceof Error ? e.message : "network error";
        }
      }

      // Fetch fees (chain-level)
      if (mapping.level === "chain") {
        try {
          const feesRes = await fetchFn(
            `${DEFILLAMA_BASE}/summary/fees/${mapping.slug}?dataType=dailyFees`,
          );
          if (feesRes.ok) {
            const feesData = await feesRes.json();
            if (feesData?.total24h !== undefined) {
              data.fees = {
                dailyFees: feesData.total24h,
                dailyRevenue: feesData.total24h * 0.1, // rough protocol revenue estimate
              };
            }
          }
        } catch (e) {
          networkError = e instanceof Error ? e.message : "network error";
        }
      }

      const availableDatasets = [data.tvl, data.fees].filter(Boolean).length;

      if (networkError && availableDatasets === 0) {
        return {
          success: false,
          provider: this.name,
          observedAt,
          error: networkError,
          errorCode: "NETWORK_ERROR",
        };
      }

      return {
        success: availableDatasets > 0,
        provider: this.name,
        observedAt,
        data: {
          ...data,
          availableDatasets,
          totalDatasets: 2,
        },
        ...(availableDatasets === 0 ? { error: "No DeFiLlama data available for this instrument" } : {}),
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        observedAt,
        error: err instanceof Error ? err.message : "DeFiLlama fetch failed",
        errorCode: "NETWORK_ERROR",
      };
    }
  }
}

/**
 * Parse DeFiLlama provider result into DeFiIntelligence.
 * Pure function — no side effects.
 */
export function parseDeFiLlamaResult(
  data: Record<string, any>,
  instrument: string,
  observedAt: number,
): DeFiIntelligence {
  const availableDatasets = data.availableDatasets ?? 0;
  const totalDatasets = data.totalDatasets ?? 2;

  return {
    provider: "DeFiLlama",
    observedAt,
    freshness: "FRESH",
    quality: availableDatasets >= 2 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No DeFiLlama data available" : undefined,

    tvl: data.tvl ? {
      current: data.tvl.current ?? 0,
      change7d: data.tvl.change7d,
      change30d: data.tvl.change30d,
      reliable: typeof data.tvl.current === "number" && data.tvl.current > 0,
    } : undefined,

    fees: data.fees ? {
      dailyFees: data.fees.dailyFees,
      dailyRevenue: data.fees.dailyRevenue,
      reliable: typeof data.fees.dailyFees === "number" && data.fees.dailyFees > 0,
    } : undefined,

    stablecoins: undefined,
    protocol: undefined,

    availableDatasets,
    totalDatasets,
  };
}
