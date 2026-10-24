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

type CoinGlassPayload = Record<string, unknown>;

type CoinGlassFetchResult = {
  success: boolean;
  data?: CoinGlassPayload;
  error?: string;
  errorCode?: string;
} | null;

/**
 * CoinGlass adapter — fetches derivatives intelligence.
 *
 * In production, this calls the Convex action `fetchDerivatives`.
 * In tests, the caller provides the thunk.
 */
export class CoinGlassAdapter implements CryptoIntelligenceProvider {
  readonly name = "CoinGlass";

  private fetchThunk?: () => Promise<CoinGlassFetchResult>;

  constructor(fetchThunk?: () => Promise<CoinGlassFetchResult>) {
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
          errorCode: result?.errorCode && ["API_UNAVAILABLE", "RATE_LIMIT", "AUTH_ERROR", "UNSUPPORTED_ASSET", "NO_DATA", "NETWORK_ERROR"].includes(result.errorCode)
            ? result.errorCode as NonNullable<CryptoIntelligenceProviderResult["errorCode"]>
            : "NO_DATA",
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
  data: Record<string, unknown>,
  instrument: string,
  observedAt: number,
): DerivativesIntelligence {
  const availability = isRecord(data.availability) ? data.availability : {};
  const openInterest = isRecord(data.openInterest) ? data.openInterest : undefined;
  const fundingRate = isRecord(data.fundingRate) ? data.fundingRate : undefined;
  const liquidations = isRecord(data.liquidations) ? data.liquidations : undefined;
  const longShort = isRecord(data.longShort) ? data.longShort : undefined;
  const availableDatasets = [
    availability.openInterest,
    availability.fundingRate,
    availability.longShort,
    availability.liquidations,
  ].filter(Boolean).length;
  const freshness = mapFreshness(typeof data.freshness === "string" ? data.freshness : undefined);
  const openInterestCurrent = numeric(openInterest?.current);
  const fundingCurrent = numeric(fundingRate?.currentRate);
  const liquidationTotal = numeric(liquidations?.totalVolume);
  const accountRatio = numeric(longShort?.accountRatio);
  const provider = data.provider === "binance-public-futures"
    ? "Binance Futures (public)"
    : data.provider === "bybit-public-derivatives"
      ? "Bybit Futures (public)"
      : data.provider === "okx-public-derivatives"
        ? "OKX Swaps (public)"
        : "CoinGlass";

  return {
    provider,
    observedAt,
    freshness,
    quality: availableDatasets >= 3 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No CoinGlass datasets available" : undefined,
    openInterest: openInterest ? {
      current: openInterestCurrent ?? 0,
      change1h: numeric(openInterest.change1h),
      change24h: numeric(openInterest.change24h),
      reliable: openInterestCurrent !== undefined && openInterestCurrent > 0,
    } : undefined,
    fundingRate: fundingRate ? {
      currentRate: fundingCurrent ?? 0,
      annualizedRate: numeric(fundingRate.annualizedRate),
      isExtreme: Math.abs(fundingCurrent ?? 0) > 0.001,
      reliable: fundingCurrent !== undefined,
    } : undefined,
    liquidation: liquidations ? {
      totalVolume: liquidationTotal,
      longVolume: numeric(liquidations.longVolume),
      shortVolume: numeric(liquidations.shortVolume),
      dominantSide: liquidations.dominantSide === "longs" || liquidations.dominantSide === "shorts" || liquidations.dominantSide === "balanced"
        ? liquidations.dominantSide
        : undefined,
      reliable: liquidationTotal !== undefined && liquidationTotal > 0,
    } : undefined,
    positioning: longShort ? {
      accountRatio,
      topTraderRatio: numeric(longShort.topTraderRatio),
      takerRatio: numeric(longShort.takerRatio),
      reliable: accountRatio !== undefined,
    } : undefined,
    availableDatasets,
    totalDatasets: 4,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numeric(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function mapFreshness(raw: string | undefined): "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" {
  if (!raw) return "UNAVAILABLE";
  const lower = raw.toLowerCase();
  if (lower === "realtime" || lower === "fresh") return "FRESH";
  if (lower === "delayed") return "DELAYED";
  if (lower === "stale") return "STALE";
  return "UNAVAILABLE";
}
