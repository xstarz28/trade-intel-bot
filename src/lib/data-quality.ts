/**
 * Phase 25 — Data Quality Context.
 *
 * Provides explicit, analyst-visible data-quality transparency without
 * modifying the decision engine. Quality status is INFORMATIONAL ONLY:
 *   "bad/insufficient data → less evidence + transparent disclosure"
 *   NEVER: "bad data → artificial bearish/bearish penalty"
 *
 * Quality labels cannot create, flip, or suppress a directional thesis.
 */

import type { AnalysisInput } from "@/types/analysis";
import type { TechnicalData, MtfContext } from "@/lib/data/market-types";

// ── Types ────────────────────────────────────────────────────────

export type QualityStatus =
  | "GOOD"
  | "DEGRADED"
  | "INSUFFICIENT"
  | "STALE"
  | "UNAVAILABLE"
  | "INVALID";

export interface QualityItem {
  status: QualityStatus;
  reason: string;
  provider?: string;
  observationDate?: string;
  fetchedAt?: number;
  validCount?: number;
  expectedCount?: number;
}

export interface IndicatorQualityItem {
  status: "AVAILABLE" | "INSUFFICIENT_DATA" | "UNAVAILABLE";
  reason: string;
  minRequired?: number;
  actualCount?: number;
}

export interface DataQualityContext {
  /** Overall primary market-data quality. */
  primaryData: QualityItem;
  /** Per-indicator quality breakdown. */
  indicators: {
    sma: IndicatorQualityItem;
    rsi: IndicatorQualityItem;
    macd: IndicatorQualityItem;
    atr: IndicatorQualityItem;
    smc: IndicatorQualityItem;
  };
  /** MTF quality. */
  mtf: QualityItem;
  /** Optional provider quality map. */
  providers: {
    treasury?: QualityItem;
    cot?: QualityItem;
    eia?: QualityItem;
    execution?: QualityItem;
    sentiment?: QualityItem;
    fundamental?: QualityItem;
    calendar?: QualityItem;
    derivatives?: QualityItem;
    crossAsset?: QualityItem;
    fx?: QualityItem;
    okxSpec?: QualityItem;
  };
}

// ── Assessment Functions ─────────────────────────────────────────

const SMA_MIN = 50;
const RSI_MIN = 15;
const MACD_MIN = 35;
const ATR_MIN = 14;
const SMC_MIN = 20;

function assessPrimaryData(
  input: AnalysisInput,
): QualityItem {
  const md = input.marketData;
  const tech = input.technicalData;

  if (!md && !tech) {
    return { status: "UNAVAILABLE", reason: "No primary market data provided" };
  }

  // Check data freshness
  if (md) {
    if (md.dataFreshness === "stale") {
      return {
        status: "STALE",
        reason: `Provider flagged data as "${md.dataFreshness}"`,
        provider: md.provider,
        validCount: tech?.dataPoints,
        expectedCount: 200,
      };
    }
    if (md.dataFreshness === "unavailable") {
      return {
        status: "UNAVAILABLE",
        reason: `Provider flagged data as "${md.dataFreshness}"`,
        provider: md.provider,
      };
    }

    // Validate price
    const price = md.price?.price;
    if (price === undefined || !Number.isFinite(price) || price <= 0) {
      return {
        status: "INVALID",
        reason: "Price snapshot is non-finite, zero, or negative",
        provider: md.provider,
      };
    }

    // Validate timestamp
    const ts = md.price?.timestamp;
    if (ts !== undefined && (!Number.isFinite(ts) || ts <= 0 || ts > Date.now() + 90_000)) {
      return {
        status: "INVALID",
        reason: "Price timestamp is invalid or implausibly future",
        provider: md.provider,
      };
    }
  }

  // Check candle count
  const candleCount = tech?.dataPoints ?? 0;
  if (candleCount === 0) {
    return {
      status: "UNAVAILABLE",
      reason: "No usable candles available",
      provider: md?.provider,
    };
  }

  if (candleCount < SMC_MIN) {
    return {
      status: "INSUFFICIENT",
      reason: `Only ${candleCount} candles available — minimum ${SMC_MIN} needed for structural analysis`,
      provider: md?.provider,
      validCount: candleCount,
      expectedCount: SMC_MIN,
    };
  }

  // Check for degraded state (fewer than expected)
  if (candleCount < 100) {
    return {
      status: "DEGRADED",
      reason: `${candleCount} candles available — some indicators may be unreliable`,
      provider: md?.provider,
      validCount: candleCount,
      expectedCount: 200,
    };
  }

  return {
    status: "GOOD",
    reason: `${candleCount} usable candles`,
    provider: md?.provider,
    validCount: candleCount,
    expectedCount: 200,
  };
}

function assessIndicator(
  tech: TechnicalData | undefined,
  key: "sma50" | "rsi14" | "macdHistogram" | "atr14",
  minRequired: number,
): IndicatorQualityItem {
  const dataPoints = tech?.dataPoints ?? 0;
  const available = tech?.[key] !== undefined;

  if (!available) {
    if (dataPoints < minRequired) {
      return {
        status: "INSUFFICIENT_DATA",
        reason: `Only ${dataPoints} candles — minimum ${minRequired} required`,
        minRequired,
        actualCount: dataPoints,
      };
    }
    return {
      status: "UNAVAILABLE",
      reason: "Indicator computation returned no value",
      minRequired,
      actualCount: dataPoints,
    };
  }

  return {
    status: "AVAILABLE",
    reason: "Computed from available candle data",
    minRequired,
    actualCount: dataPoints,
  };
}

function assessSmc(tech: TechnicalData | undefined): IndicatorQualityItem {
  const dataPoints = tech?.dataPoints ?? 0;
  const smc = tech?.smc;

  if (!smc) {
    if (dataPoints < SMC_MIN) {
      return {
        status: "INSUFFICIENT_DATA",
        reason: `Only ${dataPoints} candles — minimum ${SMC_MIN} required for SMC`,
        minRequired: SMC_MIN,
        actualCount: dataPoints,
      };
    }
    return {
      status: "UNAVAILABLE",
      reason: "SMC context computation returned no value",
      minRequired: SMC_MIN,
      actualCount: dataPoints,
    };
  }

  return {
    status: "AVAILABLE",
    reason: `SMC context available for ${smc.timeframe}`,
    minRequired: SMC_MIN,
    actualCount: dataPoints,
  };
}

function assessMtf(tech: TechnicalData | undefined): QualityItem {
  const mtf: MtfContext | undefined = tech?.mtf;
  if (!mtf) {
    return { status: "UNAVAILABLE", reason: "No multi-timeframe context provided" };
  }

  if (mtf.alignment === "INSUFFICIENT_DATA") {
    return {
      status: "INSUFFICIENT",
      reason: `No readable HTF structure — unavailable: ${mtf.unavailable.map((u) => u.timeframe).join(", ") || "chain"}`,
    };
  }

  const availableCount = mtf.chainUsed.length;
  const totalCount = mtf.timeframes.length;
  const unavailableCount = mtf.unavailable.length;

  if (unavailableCount > 0 && availableCount > 0) {
    return {
      status: "DEGRADED",
      reason: `${availableCount}/${totalCount} timeframes available — ${mtf.unavailable.map((u) => u.timeframe).join(", ")} unavailable`,
    };
  }

  if (unavailableCount === totalCount) {
    return { status: "UNAVAILABLE", reason: "All timeframes unavailable" };
  }

  return {
    status: "GOOD",
    reason: `${availableCount}/${totalCount} timeframes available — alignment: ${mtf.alignment}`,
  };
}

function assessProvider<T extends { available?: boolean; reason?: string }>(
  data: T | undefined | null,
  name: string,
): QualityItem | undefined {
  if (data === undefined || data === null) return undefined;

  const d = data as { available?: boolean; reason?: string; fetchedAt?: number; freshness?: string };

  if (d.available === false) {
    return {
      status: "UNAVAILABLE",
      reason: d.reason ?? `${name} provider returned no usable data`,
      provider: name,
      fetchedAt: d.fetchedAt,
    };
  }

  if (d.available === true) {
    const freshness = d.freshness;
    return {
      status: freshness === "STALE" ? "STALE" : "GOOD",
      reason: `${name} data available${freshness ? ` — ${freshness.toLowerCase()}` : ""}`,
      provider: name,
      fetchedAt: d.fetchedAt,
    };
  }

  return undefined;
}

// ── Public API ───────────────────────────────────────────────────

export function assessDataQuality(input: AnalysisInput): DataQualityContext {
  const tech = input.technicalData;

  return {
    primaryData: assessPrimaryData(input),
    indicators: {
      sma: assessIndicator(tech, "sma50", SMA_MIN),
      rsi: assessIndicator(tech, "rsi14", RSI_MIN),
      macd: assessIndicator(tech, "macdHistogram", MACD_MIN),
      atr: assessIndicator(tech, "atr14", ATR_MIN),
      smc: assessSmc(tech),
    },
    mtf: assessMtf(tech),
    providers: {
      treasury: assessProvider(input.treasuryData, "Treasury"),
      cot: assessProvider(input.cotData, "COT"),
      eia: assessProvider(input.eiaData, "EIA"),
      execution: assessProvider(input.executionData, "Execution"),
      sentiment: input.sentimentData?.confidence !== "unavailable"
        ? { status: "GOOD", reason: "Sentiment data available", provider: "Alpha Vantage" }
        : input.sentimentData ? { status: "UNAVAILABLE", reason: "Sentiment provider returned unavailable", provider: "Alpha Vantage" } : undefined,
      fundamental: input.fundamentalData?.available
        ? { status: "GOOD", reason: "Fundamental data available", provider: "Alpha Vantage" }
        : input.fundamentalData ? { status: "UNAVAILABLE", reason: "Fundamental provider returned unavailable", provider: "Alpha Vantage" } : undefined,
      calendar: input.calendarData?.confidence !== "unavailable"
        ? { status: "GOOD", reason: "Calendar data available", provider: "Trading Economics" }
        : input.calendarData ? { status: "UNAVAILABLE", reason: "Calendar provider returned unavailable", provider: "Trading Economics" } : undefined,
      derivatives: input.derivativesData?.confidence !== "unavailable"
        ? { status: "GOOD", reason: "Derivatives data available", provider: "CoinGlass" }
        : input.derivativesData ? { status: "UNAVAILABLE", reason: "Derivatives provider returned unavailable", provider: "CoinGlass" } : undefined,
      crossAsset: tech?.crossAsset?.available
        ? { status: "GOOD", reason: `Cross-asset context available (${tech.crossAsset.comparatorSymbol})`, provider: tech.crossAsset.provider }
        : tech?.crossAsset ? { status: "UNAVAILABLE", reason: tech.crossAsset.unavailableReason ?? "Cross-asset provider returned unavailable" } : undefined,
      fx: input.fxRates?.direct
        ? { status: "GOOD", reason: "FX rate available for conversion" }
        : input.instrumentType === "forex" ? { status: "UNAVAILABLE", reason: "FX conversion rate unavailable" } : undefined,
      okxSpec: input.okxSpecData
        ? { status: "GOOD", reason: "OKX instrument specification available" }
        : input.instrumentType === "crypto" ? { status: "UNAVAILABLE", reason: "OKX specification unavailable for this instrument" } : undefined,
    },
  };
}

/**
 * Human-readable overall quality label for quick display.
 * Non-directional — purely informational.
 */
export function overallQualityLabel(q: DataQualityContext): { label: string; status: QualityStatus } {
  const primary = q.primaryData.status;
  if (primary === "INVALID") return { label: "INVALID — market data integrity failure", status: "INVALID" };
  if (primary === "UNAVAILABLE") return { label: "UNAVAILABLE — no market data", status: "UNAVAILABLE" };
  if (primary === "STALE") return { label: "STALE — price data exceeds freshness policy", status: "STALE" };
  if (primary === "INSUFFICIENT") return { label: `INSUFFICIENT — ${q.primaryData.reason}`, status: "INSUFFICIENT" };
  if (primary === "DEGRADED") return { label: `DEGRADED — ${q.primaryData.reason}`, status: "DEGRADED" };

  // Primary is GOOD — check indicator coverage
  const indicators = Object.values(q.indicators);
  const unavailableCount = indicators.filter((i) => i.status === "UNAVAILABLE").length;
  const insufficientCount = indicators.filter((i) => i.status === "INSUFFICIENT_DATA").length;
  if (insufficientCount > 0) {
    return { label: `DEGRADED — ${insufficientCount} indicator(s) have insufficient data`, status: "DEGRADED" };
  }
  if (unavailableCount > 0) {
    return { label: `DEGRADED — ${unavailableCount} indicator(s) unavailable`, status: "DEGRADED" };
  }

  return { label: "GOOD — sufficient data quality", status: "GOOD" };
}
