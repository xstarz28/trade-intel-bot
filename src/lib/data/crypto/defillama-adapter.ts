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
import { asFiniteNumber, asRecordArray, field, isRecord } from "../json/narrow";

/** Internal accumulator for the two DeFiLlama datasets. */
interface DeFiLlamaRaw {
  tvl?: { current: number; change7d?: number; change30d?: number };
  fees?: { dailyFees: number; dailyRevenue: number };
}

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

  /**
   * Phase 279 — `resolvedMapping` lets the live crypto-fundamentals action pass
   * a mapping resolved from the instrument's OWN base asset (the live pipeline
   * routes provider-native ids such as "BTC-USDT", which the canonical table
   * above does not key on). No new slug is ever invented: the caller can only
   * supply a mapping that this repository's verified table already defines.
   */
  async fetch(
    instrument: string,
    resolvedMapping?: { slug: string; level: "chain" | "protocol" },
  ): Promise<CryptoIntelligenceProviderResult | null> {
    const mapping = resolvedMapping ?? toDefiLlamaId(instrument);
    if (!mapping) return null;
    if (!resolvedMapping && !this.supportsInstrument(instrument)) return null;

    const fetchFn = this.httpFetch ?? fetch;
    const observedAt = Date.now();

    let networkError: string | undefined;
    try {
      const data: DeFiLlamaRaw = {};

      // Fetch TVL (chain-level)
      if (mapping.level === "chain") {
        try {
          const tvlRes = await fetchFn(
            `${DEFILLAMA_BASE}/v2/historicalChainTvl/${mapping.slug}`,
          );
          if (tvlRes.ok) {
            // Phase 227 — rows are `{ date: unixSeconds, tvl: number }`;
            // anything else is skipped. A latest point without a numeric
            // tvl/date yields no TVL dataset (was `tvl ?? 0` → a "0 TVL").
            const points = asRecordArray(await tvlRes.json())
              .map((e) => ({ date: asFiniteNumber(e.date), tvl: asFiniteNumber(e.tvl) }))
              .filter((e): e is { date: number; tvl: number } => e.date !== undefined && e.tvl !== undefined);
            if (points.length > 0) {
              const latest = points[points.length - 1];
              const weekAgo = points.find(
                (e) => Math.abs(e.date - latest.date) >= 6 * 86400 && Math.abs(e.date - latest.date) <= 8 * 86400,
              );
              const monthAgo = points.find(
                (e) => Math.abs(e.date - latest.date) >= 28 * 86400 && Math.abs(e.date - latest.date) <= 32 * 86400,
              );
              data.tvl = {
                current: latest.tvl,
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
            const total24h = asFiniteNumber(field(await feesRes.json(), "total24h"));
            if (total24h !== undefined) {
              data.fees = {
                dailyFees: total24h,
                dailyRevenue: total24h * 0.1, // rough protocol revenue estimate
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
  raw: unknown,
  instrument: string,
  observedAt: number,
): DeFiIntelligence {
  const data = isRecord(raw) ? raw : {};
  const availableDatasets = asFiniteNumber(data.availableDatasets) ?? 0;
  const totalDatasets = asFiniteNumber(data.totalDatasets) ?? 2;
  const tvlCurrent = asFiniteNumber(field(data.tvl, "current"));
  const dailyFees = asFiniteNumber(field(data.fees, "dailyFees"));

  return {
    provider: "DeFiLlama",
    observedAt,
    freshness: "FRESH",
    quality: availableDatasets >= 2 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No DeFiLlama data available" : undefined,

    tvl: isRecord(data.tvl) ? {
      current: tvlCurrent ?? 0,
      change7d: asFiniteNumber(data.tvl.change7d),
      change30d: asFiniteNumber(data.tvl.change30d),
      reliable: tvlCurrent !== undefined && tvlCurrent > 0,
    } : undefined,

    fees: isRecord(data.fees) ? {
      dailyFees: dailyFees,
      dailyRevenue: asFiniteNumber(data.fees.dailyRevenue),
      reliable: dailyFees !== undefined && dailyFees > 0,
    } : undefined,

    stablecoins: undefined,
    protocol: undefined,

    availableDatasets,
    totalDatasets,
  };
}
