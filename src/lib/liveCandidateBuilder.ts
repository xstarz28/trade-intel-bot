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
import { deriveMacroYieldEvidence, type TreasuryData } from "./data/treasury";
import type { CotData } from "./data/cot";
import type { EiaData } from "./data/eia";
import { calculateTechnical } from "./data/technical";

// ═══════════════════════════════════════════════════════════════
// LIVE CANDIDATE INPUT
// ═══════════════════════════════════════════════════════════════

export interface LiveCandidateSource {
  /** Candidate/display instrument identifier. For provider-native candidates this is the exact provider instrument ID. */
  instrument: string;
  /** Asset class. */
  assetClass: AssetClass;
  /** Exact provider-native identity when the source came from native discovery. */
  providerNative?: {
    provider: string;
    providerInstrumentId: string;
  };
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

function assessDataCompleteness(source: LiveCandidateSource, technicalData?: TechnicalData): DataCompletenessLevel {
  let count = 0;
  if (source.marketData?.price?.price) count++;
  if (source.marketData?.candles?.length) count++;
  if (technicalData ?? source.technicalData) count++;
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
function extractSetupEvidence(tech: TechnicalData | undefined): Pick<CandidateInput, "setupDirection" | "setupStrength" | "confluenceCount"> {
  if (!tech) return { setupDirection: "unknown", setupStrength: 0, confluenceCount: 0 };
  const structureDirection =
    tech.structure === "HH/HL" ? "long" :
    tech.structure === "LH/LL" ? "short" : undefined;
  const breakoutDirection =
    tech.bosDirection === "bullish" ? "long" :
    tech.bosDirection === "bearish" ? "short" : undefined;
  // HTF bias remains authoritative, followed by confirmed directional
  // structure. When structure is ranging, a real BOS can still provide
  // directional evidence instead of collapsing every breakout to Neutral.
  const direction =
    tech.mtf?.htfBias === "long" || tech.mtf?.htfBias === "short"
      ? tech.mtf.htfBias
      : structureDirection ?? breakoutDirection ?? "neutral";
  if (direction === "neutral") return { setupDirection: "neutral", setupStrength: 20, confluenceCount: 0 };

  let score = 35, confirmations = 1;
  const bullish = direction === "long";
  const aligned = (bullish ? "ALIGNED_BULLISH" : "ALIGNED_BEARISH");
  const alignedStructure = bullish ? "bullish" : "bearish";
  if (tech.mtf?.alignment === aligned) { score += 18; confirmations++; }
  if (tech.bosDirection === alignedStructure) { score += 15; confirmations++; }
  if (tech.chochDirection === alignedStructure) { score += 8; confirmations++; }
  if (tech.smc?.recentSweep && tech.smc.recentSweep.side === (bullish ? "sell_side" : "buy_side")) { score += 10; confirmations++; }
  if (tech.smc?.displacement?.direction === alignedStructure) { score += 8; confirmations++; }
  if (tech.smc?.orderBlocks?.some(ob => ob.status === "fresh" && ob.direction === alignedStructure)) { score += 7; confirmations++; }
  if (tech.smc?.fvgs?.some(f => f.status === "fresh" && f.direction === alignedStructure)) { score += 5; confirmations++; }

  // Provider OHLCV must produce differentiated opportunity quality, not a
  // flat score for every instrument with merely "some" structure. These are
  // confirmations from the actual candles, not invented probabilities.
  if (tech.rsi14 !== undefined) {
    const rsi = tech.rsi14;
    if (bullish) {
      if (rsi >= 52 && rsi <= 68) score += 8;
      else if (rsi > 72) score -= 4;
      else if (rsi < 42) score -= 6;
    } else {
      if (rsi >= 32 && rsi <= 48) score += 8;
      else if (rsi < 28) score -= 4;
      else if (rsi > 58) score -= 6;
    }
  }
  if (tech.macdHistogram !== undefined && Number.isFinite(tech.macdHistogram)) {
    if ((bullish && tech.macdHistogram > 0) || (!bullish && tech.macdHistogram < 0)) score += 6;
    else if (tech.macdHistogram !== 0) score -= 4;
  }
  if (tech.volumeTrend === "increasing") { score += 5; confirmations++; }
  if (tech.volumeTrend === "decreasing") score -= 2;

  return { setupDirection: direction, setupStrength: Math.min(100, Math.max(0, score)), confluenceCount: confirmations };
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
  // Derive technical evidence from verified provider OHLCV when the source
  // did not already carry a richer technical analysis. Without this bridge,
  // provider-native discovery supplied price/candles but every candidate
  // remained MINIMAL with no direction, collapsing the ranking to identical
  // scores. Explicit upstream technicalData remains authoritative.
  const tech = source.technicalData ?? (
    source.marketData?.candles && source.marketData.candles.length > 0
      ? calculateTechnical(source.marketData.candles)
      : undefined
  );
  const ar = source.analysisResult;
  const price = source.marketData?.price?.price ?? ar?.priceSnapshot?.price ?? 0;

  // Freshness must describe when the market observation occurred, not when we fetched it.
  // Provider fetchTimestamp can be "now" even when the quoted price itself is old.
  const latestCandleTimestamp = source.marketData?.candles?.reduce<number | undefined>(
    (latest, candle) =>
      latest === undefined || candle.timestamp > latest ? candle.timestamp : latest,
    undefined,
  );
  const observationTimestamp =
    source.marketData?.price?.timestamp ??
    latestCandleTimestamp ??
    ar?.priceSnapshot?.timestamp ??
    source.marketData?.fetchTimestamp;
  const freshness = assessFreshness(observationTimestamp, now);

  // Data completeness
  const dataCompleteness = assessDataCompleteness(source, tech);

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
    htfBias: tech?.mtf?.htfBias === "long" || tech?.mtf?.htfBias === "short" ? tech.mtf?.htfBias : extractHtfBias(tech),
    marketRegime: extractMarketRegime(tech),
    mtfAlignment: tech?.mtf?.alignment ?? extractMtfAlignment(ar),
    keySupport: tech?.supportLevels?.[0],
    keyResistance: tech?.resistanceLevels?.[0],
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
    hasExecutionQuality: extractSpreadBps(source) !== undefined,

    ...extractSetupEvidence(tech),

    // Directional evidence bridge: use the analysis engine's signed
    // fundamental/positioning factors instead of reconstructing them in UI.
    fundamentalScore: ar?.breakdown?.fundamental,
    positioningScore: ar?.breakdown?.sentiment,
    fundamentalEvidenceAvailable:
      ar?.fundamentalData?.available === true ||
      ar?.macroData?.confidence === "high" ||
      ar?.macroData?.confidence === "medium" ||
      !!ar?.calendarData?.events?.some(
        (event) => event.status === "released" && event.actual !== undefined && event.forecast !== undefined,
      ),
    macroScore: (() => {
      if (source.treasuryData?.available && source.assetClass === "commodity") {
        const evidence = deriveMacroYieldEvidence(source.treasuryData);
        if (/XAU|GOLD/i.test(source.instrument)) return evidence.goldLongEffect * 2;
      }
      return undefined;
    })(),

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
