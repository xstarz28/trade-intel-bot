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
const DEFILLAMA_REQUEST_TIMEOUT_MS = 4_000;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

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
      const data: {
        tvl?: { current: number; change7d?: number; change30d?: number };
        fees?: { dailyFees?: number };
      } = {};

      // Fetch TVL (chain-level)
      if (mapping.level === "chain") {
        try {
          const tvlRes = await fetchFn(
            `${DEFILLAMA_BASE}/v2/historicalChainTvl/${mapping.slug}`,
            { signal: AbortSignal.timeout(DEFILLAMA_REQUEST_TIMEOUT_MS) },
          );
          if (tvlRes.ok) {
            const payload: unknown = await tvlRes.json();
            const history = Array.isArray(payload) ? payload.filter(isRecord) : [];
            const validHistory = history.flatMap((entry) => {
              const date = finiteNumber(entry.date);
              const tvl = finiteNumber(entry.tvl);
              return date !== undefined && tvl !== undefined ? [{ date, tvl }] : [];
            });
            if (validHistory.length > 0) {
              const latest = validHistory[validHistory.length - 1];
              const weekAgo = validHistory.find((entry) => {
                const distance = Math.abs(entry.date - latest.date);
                return distance >= 6 * 86400 && distance <= 8 * 86400;
              });
              const monthAgo = validHistory.find((entry) => {
                const distance = Math.abs(entry.date - latest.date);
                return distance >= 28 * 86400 && distance <= 32 * 86400;
              });
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
            { signal: AbortSignal.timeout(DEFILLAMA_REQUEST_TIMEOUT_MS) },
          );
          if (feesRes.ok) {
            const feesPayload: unknown = await feesRes.json();
            if (isRecord(feesPayload)) {
              const total24h = finiteNumber(feesPayload.total24h);
              if (total24h !== undefined) data.fees = { dailyFees: total24h };
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
  data: Record<string, unknown>,
  instrument: string,
  observedAt: number,
): DeFiIntelligence {
  const availableDatasets = finiteNumber(data.availableDatasets) ?? 0;
  const totalDatasets = finiteNumber(data.totalDatasets) ?? 2;
  const tvl = isRecord(data.tvl) ? data.tvl : undefined;
  const fees = isRecord(data.fees) ? data.fees : undefined;
  const currentTvl = finiteNumber(tvl?.current);
  const dailyFees = finiteNumber(fees?.dailyFees);
  const dailyRevenue = finiteNumber(fees?.dailyRevenue);

  return {
    provider: "DeFiLlama",
    observedAt,
    freshness: "FRESH",
    quality: availableDatasets >= 2 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No DeFiLlama data available" : undefined,

    tvl: tvl ? {
      current: currentTvl ?? 0,
      change7d: finiteNumber(tvl.change7d),
      change30d: finiteNumber(tvl.change30d),
      reliable: currentTvl !== undefined && currentTvl > 0,
    } : undefined,

    fees: fees ? {
      dailyFees,
      dailyRevenue,
      reliable: dailyFees !== undefined && dailyFees > 0,
    } : undefined,

    stablecoins: undefined,
    protocol: undefined,

    availableDatasets,
    totalDatasets,
  };
}
