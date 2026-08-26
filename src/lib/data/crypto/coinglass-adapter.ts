/**
 * Phase 41 — CoinGlass Provider Adapter
 *
 * Wraps the existing CoinGlass Convex action into the clean
 * CryptoIntelligenceProvider interface.
 *
 * NON-NEGOTIABLE:
 *   - API keys are NEVER exposed.
 *   - Provider availability NEVER becomes directional evidence.
 *   - All failures surface explicitly.
 *   - No fabricated values.
 */

import type {
  CryptoIntelligenceProvider,
  CryptoIntelligenceProviderResult,
  DerivativesIntelligence,
} from "./types";
import { toCoinGlassSymbol } from "./symbols";

/**
 * CoinGlass adapter — fetches derivatives intelligence.
 *
 * In production, this calls the Convex action `fetchDerivatives`.
 * In tests, the caller provides the thunk.
 */
export class CoinGlassAdapter implements CryptoIntelligenceProvider {
  readonly name = "CoinGlass";

  private fetchThunk?: () => Promise<{
    success: boolean;
    data?: {
      openInterest?: { current: number; change1h?: number; change24h?: number };
      fundingRate?: { currentRate: number; annualizedRate?: number };
      liquidations?: { totalVolume?: number; longVolume?: number; shortVolume?: number; dominantSide?: "longs" | "shorts" | "balanced" };
      longShort?: { accountRatio?: number; topTraderRatio?: number; takerRatio?: number };
      availability: { openInterest: boolean; fundingRate: boolean; longShort: boolean; liquidations: boolean };
      confidence: string;
      freshness: string;
    };
    error?: string;
    errorCode?: string;
  } | null>;

  constructor(fetchThunk?: () => Promise<any>) {
    this.fetchThunk = fetchThunk;
  }

  supportsInstrument(instrument: string): boolean {
    return toCoinGlassSymbol(instrument) !== null;
  }

  async fetch(instrument: string): Promise<CryptoIntelligenceProviderResult | null> {
    if (!this.supportsInstrument(instrument)) return null;
    if (!this.fetchThunk) {
      return {
        success: false,
        provider: this.name,
        observedAt: Date.now(),
        error: "CoinGlass fetch thunk not provided",
        errorCode: "API_UNAVAILABLE",
      };
    }
    try {
      const result = await this.fetchThunk();
      if (!result || !result.success || !result.data) {
        return {
          success: false,
          provider: this.name,
          observedAt: Date.now(),
          error: result?.error ?? "CoinGlass returned no data",
          errorCode: (result?.errorCode as any) ?? "NO_DATA",
        };
      }
      return {
        success: true,
        provider: this.name,
        observedAt: Date.now(),
        data: result.data,
      };
    } catch (err) {
      return {
        success: false,
        provider: this.name,
        observedAt: Date.now(),
        error: err instanceof Error ? err.message : "CoinGlass fetch failed",
        errorCode: "NETWORK_ERROR",
      };
    }
  }
}

/**
 * Parse CoinGlass provider result into DerivativesIntelligence.
 * Pure function — no side effects.
 */
export function parseCoinGlassResult(
  data: Record<string, any>,
  instrument: string,
  observedAt: number,
): DerivativesIntelligence {
  const avail = data.availability ?? {};
  const totalDatasets = 4;
  const availableDatasets = [
    avail.openInterest,
    avail.fundingRate,
    avail.longShort,
    avail.liquidations,
  ].filter(Boolean).length;

  const freshness = mapFreshness(data.freshness);

  return {
    provider: "CoinGlass",
    observedAt,
    freshness,
    quality: availableDatasets >= 3 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No CoinGlass datasets available" : undefined,

    openInterest: data.openInterest ? {
      current: data.openInterest.current ?? 0,
      change1h: data.openInterest.change1h,
      change24h: data.openInterest.change24h,
      reliable: typeof data.openInterest.current === "number" && !Number.isNaN(data.openInterest.current) && data.openInterest.current > 0,
    } : undefined,

    fundingRate: data.fundingRate ? {
      currentRate: data.fundingRate.currentRate ?? 0,
      annualizedRate: data.fundingRate.annualizedRate,
      isExtreme: Math.abs(data.fundingRate.currentRate ?? 0) > 0.001,
      reliable: typeof data.fundingRate.currentRate === "number" && !Number.isNaN(data.fundingRate.currentRate),
    } : undefined,

    liquidation: data.liquidations ? {
      totalVolume: data.liquidations.totalVolume,
      longVolume: data.liquidations.longVolume,
      shortVolume: data.liquidations.shortVolume,
      dominantSide: data.liquidations.dominantSide,
      reliable: typeof data.liquidations.totalVolume === "number" && !Number.isNaN(data.liquidations.totalVolume) && data.liquidations.totalVolume > 0,
    } : undefined,

    positioning: data.longShort ? {
      accountRatio: data.longShort.accountRatio,
      topTraderRatio: data.longShort.topTraderRatio,
      takerRatio: data.longShort.takerRatio,
      reliable: typeof data.longShort.accountRatio === "number" && !Number.isNaN(data.longShort.accountRatio),
    } : undefined,

    availableDatasets,
    totalDatasets,
  };
}

function mapFreshness(raw: string | undefined): "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" {
  if (!raw) return "UNAVAILABLE";
  const lower = raw.toLowerCase();
  if (lower === "realtime" || lower === "fresh") return "FRESH";
  if (lower === "delayed") return "DELAYED";
  if (lower === "stale") return "STALE";
  return "UNAVAILABLE";
}
