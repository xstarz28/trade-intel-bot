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
import type { MarketData, TechnicalData } from "./data/market-types";
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

/**
 * Look up only the exact requested instrument identity. Quote currency and
 * contract type are part of the instrument: BTC/USD must never silently use
 * BTC-USDT-SWAP (or any other same-base market) as a fallback snapshot.
 */
export function findLiveSnapshotForInstrument(
  liveSources: Map<string, LiveCandidateSource>,
  instrument: string,
): LiveCandidateSource | undefined {
  return liveSources.get(instrument);
}

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

type CandidateFreshness = "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";

const FRESHNESS_RANK: Record<CandidateFreshness, number> = {
  FRESH: 0,
  DELAYED: 1,
  STALE: 2,
  UNAVAILABLE: 3,
};

/**
 * A recent fetch does not make a provider's delayed/stale feed realtime.
 * Use the more conservative status from the observation timestamp and the
 * provider's explicit freshness declaration.
 */
function constrainByProviderFreshness(
  observed: CandidateFreshness,
  reported: MarketData["dataFreshness"] | undefined,
): CandidateFreshness {
  if (!reported) return observed;
  const providerStatus: Record<MarketData["dataFreshness"], CandidateFreshness> = {
    realtime: "FRESH",
    delayed: "DELAYED",
    stale: "STALE",
    unavailable: "UNAVAILABLE",
  };
  const declared = providerStatus[reported];
  return FRESHNESS_RANK[observed] >= FRESHNESS_RANK[declared] ? observed : declared;
}

function assessDataCompleteness(source: LiveCandidateSource, technicalData?: TechnicalData): DataCompletenessLevel {
  let count = 0;
  if (source.marketData?.price?.price) count++;
  if (source.marketData?.candles?.length) count++;
  if (technicalData ?? source.technicalData) count++;
  if (source.analysisResult?.instrument === source.instrument) count++;
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
  const structure = tech.htfContext?.structure ?? tech.structure;
  if (structure === "HH/HL") return "long";
  if (structure === "LH/LL") return "short";
  if (structure === "range") return "neutral";
  return "unknown";
}

function extractMarketRegime(tech: TechnicalData | undefined): string | undefined {
  if (!tech) return undefined;
  if (tech.structure === "HH/HL" || tech.structure === "LH/LL") return "TRENDING";
  if (tech.structure === "range") return "RANGING";
  return "UNKNOWN";
}

function extractMtfAlignment(
  tech: TechnicalData | undefined,
  ar: AnalysisResult | undefined,
): string | undefined {
  if (ar?.mtfSummary?.alignment) return ar.mtfSummary.alignment;
  if (tech?.mtf?.alignment) return tech.mtf.alignment;

  const primary = tech?.structure === "HH/HL" ? "long"
    : tech?.structure === "LH/LL" ? "short" : undefined;
  const higher = tech?.htfContext?.structure === "HH/HL" ? "long"
    : tech?.htfContext?.structure === "LH/LL" ? "short" : undefined;
  if (primary === "long" && higher === "long") return "ALIGNED_BULLISH";
  if (primary === "short" && higher === "short") return "ALIGNED_BEARISH";
  if (primary && higher && primary !== higher) return "COUNTER_TREND";
  return undefined;
}

function extractAtr(tech: TechnicalData | undefined): number | undefined {
  return tech?.atr14;
}
function extractSetupEvidence(tech: TechnicalData | undefined): Pick<CandidateInput, "setupDirection" | "setupStrength" | "confluenceCount"> {
  if (!tech) return { setupDirection: "unknown", setupStrength: 0, confluenceCount: 0 };
  const higherStructureDirection =
    tech.htfContext?.structure === "HH/HL" ? "long" :
    tech.htfContext?.structure === "LH/LL" ? "short" : undefined;
  const structureDirection =
    tech.structure === "HH/HL" ? "long" :
    tech.structure === "LH/LL" ? "short" : undefined;
  const breakoutDirection =
    tech.bosDirection === "bullish" ? "long" :
    tech.bosDirection === "bearish" ? "short" : undefined;
  // Explicit MTF bias is authoritative, followed by derived higher-timeframe
  // structure, setup-timeframe structure, and finally a confirmed BOS.
  const direction =
    tech.mtf?.htfBias === "long" || tech.mtf?.htfBias === "short"
      ? tech.mtf.htfBias
      : higherStructureDirection ?? structureDirection ?? breakoutDirection ?? "neutral";
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
  return {
    hasDerivatives: !!d,
    fundingRate: d?.fundingRate?.currentRate,
    openInterest: d?.openInterest?.current,
  };
}

function extractForexData(source: LiveCandidateSource): Partial<CandidateInput> {
  const fx = source.universalIntelligence?.forex;
  const crossAsset = source.universalIntelligence?.crossAsset;
  const cot = source.cotData;
  const cotAvailable = cot && cot.available ? cot : null;
  return {
    // Use only explicitly available intelligence; never infer rates from a
    // missing feed or let unavailable provider metadata become evidence.
    rateDifferential: fx?.rates?.available ? fx.rates.rateDifferential : undefined,
    yieldDifferential: fx?.yields?.available ? fx.yields.yieldDifferential : undefined,
    hasCOT: !!cotAvailable || !!(fx?.positioning?.available),
    cotNet: cotAvailable?.netNonCommercial ??
      (fx?.positioning?.available ? fx.positioning.nonCommercialNet : undefined),
    dxyTrend: crossAsset?.dxy?.available
      ? crossAsset.dxy.trend
      : fx?.crossAsset?.available ? fx.crossAsset.dxyTrend : undefined,
  };
}

function extractEquityData(source: LiveCandidateSource): Partial<CandidateInput> {
  const ar = source.analysisResult;
  const fundamentals = source.universalIntelligence?.equity?.fundamentals;
  const fundamentalsAvailable = fundamentals?.available === true;
  return {
    hasFundamentals: !!ar?.fundamentalData?.available || fundamentalsAvailable,
    peRatio: fundamentalsAvailable ? fundamentals.peRatio : ar?.fundamentalData?.peRatio,
    revenueGrowth: fundamentalsAvailable ? fundamentals.revenueGrowth : undefined,
    profitMargin: fundamentalsAvailable ? fundamentals.profitMargin : ar?.fundamentalData?.profitMargin,
    marketCap: fundamentalsAvailable ? fundamentals.marketCap : ar?.fundamentalData?.marketCap,
  };
}

function isPetroleumInstrument(instrument: string): boolean {
  return /(?:WTI|CRUDE|USOIL|UKOIL|BRENT|XTIUSD|XBRUSD|CL=F|BZ=F)/i.test(instrument);
}

function extractCommodityData(source: LiveCandidateSource): Partial<CandidateInput> {
  const eia = isPetroleumInstrument(source.instrument) ? source.eiaData : undefined;
  const cot = source.cotData;
  const intelligence = source.universalIntelligence?.commodity;
  const inventory = intelligence?.inventory?.available ? intelligence.inventory : undefined;
  const positioning = intelligence?.positioning?.available ? intelligence.positioning : undefined;
  const futures = intelligence?.futuresStructure?.available ? intelligence.futuresStructure : undefined;
  return {
    inventory: inventory?.currentInventory ?? (eia?.available ? eia.series[0]?.latestValue : undefined),
    inventoryChange: inventory?.changeWeekly ?? (eia?.available ? eia.series[0]?.change : undefined),
    hasCOT: !!(cot?.available || positioning),
    cotNet: cot?.available && cot.netNonCommercial !== undefined
      ? cot.netNonCommercial
      : positioning?.managedMoneyNet,
    futuresStructure: futures?.structure,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildCandidateFromSource(source: LiveCandidateSource): CandidateInput {
  // Never mix evidence across instrument identities. Remove mismatched
  // analysis/intelligence payloads before they can affect price, confidence,
  // completeness, or asset-specific recommendation inputs.
  source = {
    ...source,
    marketData: source.marketData?.instrument === source.instrument
      ? source.marketData
      : undefined,
    analysisResult: source.analysisResult?.instrument === source.instrument
      ? source.analysisResult
      : undefined,
    universalIntelligence: source.universalIntelligence?.instrument === source.instrument &&
      source.universalIntelligence.assetClass === source.assetClass
      ? source.universalIntelligence
      : undefined,
    derivativesData: source.derivativesData?.symbol ===
      (source.providerNative?.providerInstrumentId ?? source.instrument)
      ? source.derivativesData
      : undefined,
    cotData: source.cotData?.requestedInstrument === source.instrument
      ? source.cotData
      : undefined,
  };
  const now = Date.now();
  // Derive technical evidence from verified provider OHLCV when the source
  // did not already carry a richer technical analysis. Without this bridge,
  // provider-native discovery supplied price/candles but every candidate
  // remained MINIMAL with no direction, collapsing the ranking to identical
  // scores. Explicit upstream technicalData remains authoritative.
  const orderedCandles = source.marketData?.candles
    ?.slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  const orderedHigherTimeframeCandles = source.marketData?.higherTimeframeCandles
    ?.slice()
    .sort((a, b) => a.timestamp - b.timestamp);
  const tech = source.technicalData ?? (
    orderedCandles && orderedCandles.length > 0
      ? calculateTechnical(
          orderedCandles,
          orderedHigherTimeframeCandles,
          source.marketData?.higherTimeframe ?? "HTF",
        )
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
  const freshness = constrainByProviderFreshness(
    assessFreshness(observationTimestamp, now),
    source.marketData?.dataFreshness,
  );

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
    mtfAlignment: tech?.mtf?.alignment ?? extractMtfAlignment(tech, ar),
    keySupport: tech?.supportLevels?.[0],
    keyResistance: tech?.resistanceLevels?.[0],
    riskReward: ar?.tradePlan?.riskReward,
    spreadBps: extractSpreadBps(source),
    atr: extractAtr(tech),

    // Cross-asset context is informational unless the provider explicitly
    // marks it available. Preserve absence instead of guessing a regime.
    dxyTrend: source.universalIntelligence?.crossAsset?.dxy?.available
      ? source.universalIntelligence.crossAsset.dxy.trend
      : source.universalIntelligence?.forex?.crossAsset?.available
        ? source.universalIntelligence.forex.crossAsset.dxyTrend
        : undefined,
    riskRegime: source.universalIntelligence?.crossAsset?.riskRegime?.available
      ? source.universalIntelligence.crossAsset.riskRegime.regime
      : undefined,

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
      ar?.breakdown?.fundamental !== undefined &&
      Number.isFinite(ar.breakdown.fundamental),
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
