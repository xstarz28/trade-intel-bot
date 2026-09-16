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
import { asFiniteNumber, isRecord } from "../json/narrow";

/**
 * CoinGlass adapter — fetches derivatives intelligence.
 *
 * In production, this calls the Convex action `fetchDerivatives`.
 * In tests, the caller provides the thunk.
 */
/**
 * Envelope of the Convex `coinglass.fetchDerivatives` action as the adapter
 * consumes it. `data` is deliberately `unknown`: the adapter forwards it and
 * `parseCoinGlassResult` narrows it field by field.
 */
export interface CoinGlassThunkResult {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}
export type CoinGlassFetchThunk = () => Promise<CoinGlassThunkResult | null>;

export class CoinGlassAdapter implements CryptoIntelligenceProvider {
  readonly name = "CoinGlass";

  private fetchThunk?: CoinGlassFetchThunk;

  constructor(fetchThunk?: CoinGlassFetchThunk) {
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
          errorCode: toErrorCode(result?.errorCode),
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
const ERROR_CODES = ["API_UNAVAILABLE", "RATE_LIMIT", "AUTH_ERROR", "UNSUPPORTED_ASSET", "NO_DATA", "NETWORK_ERROR"] as const;
type ErrorCode = NonNullable<CryptoIntelligenceProviderResult["errorCode"]>;

function toErrorCode(raw: unknown): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(raw as string) ? (raw as ErrorCode) : "NO_DATA";
}

export function parseCoinGlassResult(
  raw: unknown,
  instrument: string,
  observedAt: number,
): DerivativesIntelligence {
  const data = isRecord(raw) ? raw : {};
  const avail = isRecord(data.availability) ? data.availability : {};
  const totalDatasets = 4;
  const availableDatasets = [
    avail.openInterest,
    avail.fundingRate,
    avail.longShort,
    avail.liquidations,
  ].filter((v) => v === true).length;

  const freshness = mapFreshness(data.freshness);
  const oi = isRecord(data.openInterest) ? data.openInterest : undefined;
  const fr = isRecord(data.fundingRate) ? data.fundingRate : undefined;
  const liq = isRecord(data.liquidations) ? data.liquidations : undefined;
  const ls = isRecord(data.longShort) ? data.longShort : undefined;
  const oiCurrent = asFiniteNumber(oi?.current);
  const frRate = asFiniteNumber(fr?.currentRate);
  const liqTotal = asFiniteNumber(liq?.totalVolume);
  const lsAccount = asFiniteNumber(ls?.accountRatio);
  const side = liq?.dominantSide;

  return {
    provider: "CoinGlass",
    observedAt,
    freshness,
    quality: availableDatasets >= 3 ? "VERIFIED" : availableDatasets >= 1 ? "DEGRADED" : "UNAVAILABLE",
    available: availableDatasets > 0,
    failureReason: availableDatasets === 0 ? "No CoinGlass datasets available" : undefined,

    openInterest: oi ? {
      current: oiCurrent ?? 0,
      change1h: asFiniteNumber(oi.change1h),
      change24h: asFiniteNumber(oi.change24h),
      reliable: oiCurrent !== undefined && oiCurrent > 0,
    } : undefined,

    fundingRate: fr ? {
      currentRate: frRate ?? 0,
      annualizedRate: asFiniteNumber(fr.annualizedRate),
      isExtreme: Math.abs(frRate ?? 0) > 0.001,
      reliable: frRate !== undefined,
    } : undefined,

    liquidation: liq ? {
      totalVolume: liqTotal,
      longVolume: asFiniteNumber(liq.longVolume),
      shortVolume: asFiniteNumber(liq.shortVolume),
      dominantSide: side === "longs" || side === "shorts" || side === "balanced" ? side : undefined,
      reliable: liqTotal !== undefined && liqTotal > 0,
    } : undefined,

    positioning: ls ? {
      accountRatio: lsAccount,
      topTraderRatio: asFiniteNumber(ls.topTraderRatio),
      takerRatio: asFiniteNumber(ls.takerRatio),
      reliable: lsAccount !== undefined,
    } : undefined,

    availableDatasets,
    totalDatasets,
  };
}

function mapFreshness(raw: unknown): "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" {
  if (typeof raw !== "string" || raw === "") return "UNAVAILABLE";
  const lower = raw.toLowerCase();
  if (lower === "realtime" || lower === "fresh") return "FRESH";
  if (lower === "delayed") return "DELAYED";
  if (lower === "stale") return "STALE";
  return "UNAVAILABLE";
}
