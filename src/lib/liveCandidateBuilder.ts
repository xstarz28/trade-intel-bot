/**
 * Phase 50 — Live Candidate Builder
 *
 * Converts actual market data, analysis results, and universal intelligence
 * contexts into CandidateInput objects for the recommendation engine.
 *
 * CRITICAL:
 *   - Only builds candidates from data that actually exists.
 *   - Never fabricates data, prices, or evidence.
 *   - Provider availability NEVER becomes directional evidence.
 *   - Missing data is explicitly represented as unavailable.
 */

import type { CandidateInput, DataCompletenessLevel } from "./recommendation-engine";
import type { AssetClass } from "./data/universal/types";
import type { MarketData, TechnicalData, OhlcvCandle } from "./data/market-types";
import type { AnalysisResult } from "@/types/analysis";
import type { UniversalIntelligenceContext } from "./data/universal/types";
import type { CryptoDerivativesData } from "./data/derivatives-types";
import type { EconomicCalendarData } from "./data/calendar-types";
import type { TreasuryData } from "./data/treasury";
import type { CotData } from "./data/cot";
import type { EiaData } from "./data/eia";

// ═══════════════════════════════════════════════════════════════
// LIVE CANDIDATE INPUT
// ═══════════════════════════════════════════════════════════════

export interface LiveCandidateSource {
  /** Instrument canonical ID. */
  instrument: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** Market data from provider (if available). */
  marketData?: MarketData;
  /** Technical data computed from candles (if available). */
  technicalData?: TechnicalData;
  /** Analysis result from a previous run (if available). */
  analysisResult?: AnalysisResult;
  /** Universal intelligence context (if available). */
  universalIntelligence?: UniversalIntelligenceContext;
  /** Crypto derivatives data (if available). */
  derivativesData?: CryptoDerivativesData;
  /** Economic calendar (if available). */
  calendarData?: EconomicCalendarData;
  /** Treasury data (if available). */
  treasuryData?: TreasuryData;
  /** COT data (if available). */
  cotData?: CotData;
  /** EIA data (if available). */
  eiaData?: EiaData;
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS ASSESSMENT
// ═══════════════════════════════════════════════════════════════

function assessFreshness(
  timestamp: number | undefined,
  now: number,
): "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" {
  if (!timestamp) return "UNAVAILABLE";
  const ageMs = now - timestamp;
  if (ageMs < 5 * 60_000) return "FRESH";         // < 5 min
  if (ageMs < 60 * 60_000) return "DELAYED";      // < 1 hour
  if (ageMs < 24 * 60 * 60_000) return "STALE";   // < 24 hours
  return "UNAVAILABLE";
}

function assessDataCompleteness(source: LiveCandidateSource): DataCompletenessLevel {
  let count = 0;
  if (source.marketData?.price?.price) count++;
  if (source.marketData?.candles?.length) count++;
  if (source.technicalData) count++;
  if (source.analysisResult) count++;
  if (source.universalIntelligence) count++;
  if (source.derivativesData) count++;
  if (source.calendarData) count++;
  if (source.treasuryData?.available) count++;
  if (source.cotData?.available) count++;
  if (source.eiaData?.available) count++;

  if (count >= 5) return "FULL";
  if (count >= 3) return "PARTIAL";
  if (count >= 1) return "MINIMAL";
  return "NONE";
}

// ═══════════════════════════════════════════════════════════════
// STRUCTURE EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractHtfBias(tech: TechnicalData | undefined): "long" | "short" | "neutral" | "unknown" {
  if (!tech) return "unknown";
  if (tech.structure === "HH/HL") return "long";
  if (tech.structure === "LH/LL") return "short";
  if (tech.structure === "range") return "neutral";
  return "unknown";
}

function extractMarketRegime(tech: TechnicalData | undefined): string | undefined {
  if (!tech) return undefined;
  if (tech.structure === "HH/HL" || tech.structure === "LH/LL") return "TRENDING";
  if (tech.structure === "range") return "RANGING";
  return "UNKNOWN";
}

function extractMtfAlignment(ar: AnalysisResult | undefined): string | undefined {
  return ar?.mtfSummary?.alignment;
}

function extractAtr(tech: TechnicalData | undefined): number | undefined {
  return tech?.atr14;
}

function extractSpreadBps(source: LiveCandidateSource): number | undefined {
  if (source.marketData?.price?.bid && source.marketData?.price?.ask) {
    const mid = (source.marketData.price.bid + source.marketData.price.ask) / 2;
    const spread = source.marketData.price.ask - source.marketData.price.bid;
    if (mid > 0) return (spread / mid) * 10000;
  }
  return undefined;
}

// ═══════════════════════════════════════════════════════════════
// ASSET-SPECIFIC EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractCryptoData(source: LiveCandidateSource): Partial<CandidateInput> {
  const d = source.derivativesData;
  const ci = source.universalIntelligence?.equity ?? source.universalIntelligence;
  return {
    hasDerivatives: !!d,
    fundingRate: d?.fundingRate?.currentRate,
    openInterest: d?.openInterest?.current,
  };
}

function extractForexData(source: LiveCandidateSource): Partial<CandidateInput> {
  const t = source.treasuryData;
  const cot = source.cotData;
  const cotAvailable = cot && cot.available ? cot : null;
  return {
    rateDifferential: undefined, // Would need central bank rate data
    yieldDifferential: undefined,
    hasCOT: !!cotAvailable,
    cotNet: cotAvailable?.netNonCommercial,
    dxyTrend: undefined,
  };
}

function extractEquityData(source: LiveCandidateSource): Partial<CandidateInput> {
  const ar = source.analysisResult;
  return {
    hasFundamentals: !!ar?.fundamentalData?.available,
    peRatio: ar?.fundamentalData?.peRatio,
    revenueGrowth: undefined, // FundamentalData doesn't expose revenueGrowth directly
    profitMargin: ar?.fundamentalData?.profitMargin,
    marketCap: ar?.fundamentalData?.marketCap,
  };
}

function extractCommodityData(source: LiveCandidateSource): Partial<CandidateInput> {
  const eia = source.eiaData;
  const cot = source.cotData;
  return {
    inventory: eia && eia.available ? eia.series[0]?.latestValue : undefined,
    inventoryChange: eia && eia.available ? eia.series[0]?.change : undefined,
    hasCOT: !!(cot && cot.available),
    cotNet: cot && cot.available ? cot.netNonCommercial : undefined,
    futuresStructure: undefined, // Would need futures curve data
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildCandidateFromSource(source: LiveCandidateSource): CandidateInput {
  const now = Date.now();
  const tech = source.technicalData;
  const ar = source.analysisResult;
  const price = source.marketData?.price?.price ?? ar?.priceSnapshot?.price ?? 0;

  // Data freshness from market data timestamp
  const freshness = assessFreshness(source.marketData?.price?.timestamp ?? ar?.priceSnapshot?.timestamp, now);

  // Data completeness
  const dataCompleteness = assessDataCompleteness(source);

  // Data points from candles
  const dataPoints = source.marketData?.candles?.length ?? tech?.dataPoints ?? 0;

  // Live data availability
  const hasLiveData = freshness === "FRESH" || freshness === "DELAYED";

  // Provider coverage
  const providerCoverage = dataPoints > 0 ? "PARTIAL" : "MINIMAL";

  // Asset-specific extraction
  let assetSpecific: Partial<CandidateInput> = {};
  switch (source.assetClass) {
    case "crypto": assetSpecific = extractCryptoData(source); break;
    case "forex": assetSpecific = extractForexData(source); break;
    case "equity": assetSpecific = extractEquityData(source); break;
    case "commodity": assetSpecific = extractCommodityData(source); break;
  }

  return {
    instrument: source.instrument,
    assetClass: source.assetClass,
    currentPrice: price,
    dataCompleteness,
    dataPoints,
    hasLiveData,
    freshness,
    providerCoverage,

    // Structure
    htfBias: extractHtfBias(tech),
    marketRegime: extractMarketRegime(tech),
    mtfAlignment: extractMtfAlignment(ar),
    keySupport: undefined,
    keyResistance: undefined,
    riskReward: ar?.tradePlan?.riskReward,
    spreadBps: extractSpreadBps(source),
    atr: extractAtr(tech),

    // Cross-asset
    dxyTrend: undefined,
    riskRegime: undefined,

    // Dedup
    dependencyGroupsUsed: [],

    // Analysis metadata
    analysisConfidence: ar?.confidence,
    hasAnalysis: !!ar,
    hasLongHorizonThesis: !!ar?.longHorizonThesis,
    hasMacro: !!source.treasuryData?.available || !!source.calendarData,
    hasExecutionQuality: false,

    // Asset-specific
    ...assetSpecific,
  };
}

// ═══════════════════════════════════════════════════════════════
// BATCH BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildCandidatesFromSources(
  sources: LiveCandidateSource[],
): CandidateInput[] {
  return sources.map(buildCandidateFromSource);
}
