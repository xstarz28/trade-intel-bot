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
  const price = source.marketData?.price?.price;
  const candles = source.marketData?.candles ?? [];
  const hasPrice = Number.isFinite(price) && (price ?? 0) > 0;
  const hasUsableCandles = candles.length >= 30;
  const hasTechnicalStructure = !!(technicalData ?? source.technicalData);
  const hasPrimaryMarketEvidence = hasPrice && hasUsableCandles && hasTechnicalStructure;

  // Price, candles, and indicators are one OHLCV evidence family, not three
  // independent confirmations. Wrapper objects do not count as data.
  const domains = new Set<string>();
  const ar = source.analysisResult?.instrument === source.instrument ? source.analysisResult : undefined;
  const universal = source.universalIntelligence?.instrument === source.instrument
    ? source.universalIntelligence
    : undefined;
  if (ar?.fundamentalData?.available === true || universal?.equity?.fundamentals?.available === true) domains.add("fundamentals");
  if (ar?.sentimentData && ar.sentimentData.confidence !== "unavailable" && (ar.sentimentData.articleCount ?? 0) > 0) domains.add("sentiment");
  if (ar?.macroData && ar.macroData.confidence !== "unavailable" && !!ar.macroData.summary) domains.add("macro");
  if ((source.derivativesData?.openInterest?.current !== undefined || source.derivativesData?.fundingRate?.currentRate !== undefined) &&
      source.derivativesData?.freshness !== "unavailable") domains.add("derivatives");
  if (source.calendarData?.events?.some((event) => event.status === "upcoming" || event.status === "released")) domains.add("calendar");
  if (source.treasuryData?.available || source.cotData?.available || source.eiaData?.available) domains.add("macro-positioning");
  if (universal?.forex?.rates?.available || universal?.forex?.yields?.available) domains.add("rates");
  if (universal?.forex?.positioning?.available || universal?.commodity?.positioning?.available) domains.add("positioning");
  if (universal?.commodity?.inventory?.available) domains.add("inventory");
  if (universal?.crossAsset?.treasury?.available) domains.add("cross-asset");

  if (hasPrimaryMarketEvidence && domains.size >= 2) return "FULL";
  if (hasPrimaryMarketEvidence && domains.size >= 1) return "PARTIAL";
  if (hasPrimaryMarketEvidence) return "MINIMAL";
  if (hasPrice || candles.length > 0 || hasTechnicalStructure) return "MINIMAL";
  return "NONE";
}

function normalizeCandidateTimeframe(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase();
  const aliases: Record<string, string> = {
    "1M": "M1", "1MIN": "M1", "1MINUTE": "M1", "5M": "M5", "5MIN": "M5",
    "15M": "M15", "15MIN": "M15", "1H": "H1", "1HR": "H1",
    "4H": "H4", "4HR": "H4", "1D": "D1", "1DAY": "D1", "1W": "W1", "1WEEK": "W1",
  };
  return aliases[normalized] ?? normalized;
}

function deriveCryptoMarketType(instrument: string, providerInstrumentId?: string): "spot" | "perpetual" | "futures" | undefined {
  const id = (providerInstrumentId ?? instrument).trim().toUpperCase();
  if (id.endsWith("-SWAP") || id.endsWith("-FUTURES")) return "perpetual";
  if (/-[0-9]{6}$/.test(id)) return "futures";
  return id.includes("-") || id.includes("/") ? "spot" : undefined;
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
    tech.structure === "LH/LL" ? "short" :
    tech.structure === "range" ? "neutral" : undefined;
  const breakoutDirection =
    tech.bosDirection === "bullish" ? "long" :
    tech.bosDirection === "bearish" ? "short" : undefined;
  // The selected setup timeframe is authoritative for an actionable setup.
  // A range stays neutral even when the HTF is bullish; only a BOS on the
  // setup timeframe can break that neutral state. HTF direction is a fallback
  // only when setup structure itself is genuinely unavailable/unknown.
  const direction =
    structureDirection === "neutral"
      ? breakoutDirection ?? "neutral"
      : structureDirection ??
        breakoutDirection ??
        higherStructureDirection ??
        (tech.mtf?.htfBias === "long" || tech.mtf?.htfBias === "short"
          ? tech.mtf.htfBias
          : "neutral");
  if (direction === "neutral") {
    // A range is not a directional signal, but neutral candidates should still
    // be differentiated by their observed context instead of receiving a flat
    // strength/confluence value.
    let score = 16;
    let confirmations = 0;

    if (tech.rsi14 !== undefined && Number.isFinite(tech.rsi14)) {
      const distanceFromMidline = Math.abs(tech.rsi14 - 50);
      score += Math.min(10, Math.round(distanceFromMidline * 0.25));
      if (distanceFromMidline >= 12) confirmations++;
    }
    if (tech.volumeTrend === "increasing") { score += 6; confirmations++; }
    else if (tech.volumeTrend === "decreasing") score -= 3;

    const activePools = tech.smc?.liquidityPools?.filter((pool) => !pool.broken).length ?? 0;
    if (activePools > 0) { score += Math.min(8, activePools * 2); confirmations++; }

    const freshFvgs = tech.smc?.fvgs?.filter((zone) => zone.status === "fresh").length ?? 0;
    if (freshFvgs > 0) { score += Math.min(8, freshFvgs * 3); confirmations++; }

    if (tech.smc?.orderBlocks?.some((block) => block.status === "fresh")) {
      score += 5;
      confirmations++;
    }
    if (tech.smc?.recentSweep) { score += 5; confirmations++; }
    if (tech.smc?.displacement) { score += 4; confirmations++; }

    return {
      setupDirection: "neutral",
      setupStrength: Math.min(55, Math.max(8, score)),
      confluenceCount: confirmations,
    };
  }

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
    marketTimeframe: normalizeCandidateTimeframe(source.marketData?.timeframe ?? ar?.timeframe),
    marketType: source.assetClass === "crypto"
      ? deriveCryptoMarketType(source.instrument, source.providerNative?.providerInstrumentId)
      : undefined,
    analysisDecision: ar?.recommendation,
    analysisStyle: ar?.tradingStyle ? String(ar.tradingStyle).toUpperCase() as "SCALPING" | "INTRADAY" | "SWING" : undefined,
    hasQualifiedTradePlan: !!(ar?.tradePlan && ar.recommendation !== "NO_TRADE"),
    mtfSufficient: ar
      ? !!ar.mtfSummary?.alignment && ar.mtfSummary.alignment !== "INSUFFICIENT_DATA"
      : !!tech?.mtf?.alignment && tech.mtf.alignment !== "INSUFFICIENT_DATA",
    hasFreshExecutionQuality: !!(
      ar?.executionContext?.available &&
      ar.executionContext.freshness === "FRESH" &&
      source.instrument.toUpperCase().replace(/[\/_]/g, "-") === ar.executionContext.instrumentId.toUpperCase()
    ),
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
