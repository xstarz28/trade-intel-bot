/**
 * Phase 51 — Radar Candidate Builder
 *
 * Builds CandidateInput objects directly from market snapshots and
 * provider data, WITHOUT requiring analysis history.
 *
 * Analysis history is ONE source of evidence, not the primary source.
 * Missing components remain missing — never fabricated.
 */

import type { CandidateInput, DataCompletenessLevel } from "@/lib/recommendation-engine";
import type { MarketSnapshot, FreshnessLevel, InvestorOpportunityProjection } from "./types";
import type { UniverseEntry } from "./types";
import type { TechnicalData, TimeframeStructureContext } from "../data/market-types";
import { buildInvestorFundamentalOutlook } from "../investor-fundamental-outlook";
import { assessFreshness } from "./freshness";
import { extractSetupEvidence, type LiveCandidateSource } from "../liveCandidateBuilder";
import { calculateTechnical } from "../data/technical";
import { buildConditionalEntryScenariosFromMarketData, type ConditionalEntryScenario } from "../conditional-entry-scenarios";
import { deriveMacroYieldEvidence } from "@/lib/data/treasury";
import { matchesDerivativeSymbol } from "@/lib/data/derivatives-symbol";

// ═══════════════════════════════════════════════════════════════
// RADAR CANDIDATE SOURCE
// ═══════════════════════════════════════════════════════════════

export interface RadarCandidateSource {
  /** Instrument universe entry. */
  universe: UniverseEntry;
  /** Market snapshot from provider (if available). */
  snapshot?: MarketSnapshot | null;
  /** Verified setup evidence derived from provider candles/technical analysis. */
  setupDirection?: CandidateInput["setupDirection"];
  setupStrength?: number;
  confluenceCount?: number;
  /** Conditional entry/invalidations/targets derived from this exact candle snapshot. */
  conditionalScenarios?: ConditionalEntryScenario[];
  /** Structural and valuation-backed price plan for investment horizons only. */
  investmentProjection?: Omit<InvestorOpportunityProjection, "horizon">;
  /** Optional additional intelligence. */
  derivatives?: {
    fundingRate?: number;
    openInterest?: number;
    liquidationVolume?: number;
  };
  /** Optional fundamentals (equity). */
  fundamentals?: {
    peRatio?: number;
    profitMargin?: number;
    marketCap?: number;
    revenueGrowth?: number;
  };
  /** Raw rate/yield context; not directional evidence by itself. */
  rateDifferential?: number;
  yieldDifferential?: number;
  /** Signed gold macro effect derived from actual Treasury observations. */
  macroScore?: number;
  /** Optional COT data (forex/commodity). */
  cot?: {
    netNonCommercial?: number;
  };
  /** Optional EIA data (commodity). */
  eia?: {
    inventory?: number;
    inventoryChange?: number;
    futuresStructure?: string;
  };
  /** Optional treasury/macro data. */
  treasury?: {
    tenYearYield?: number;
    dxyTrend?: "rising" | "falling" | "stable";
    riskRegime?: string;
  };
  /** Analysis result if available (optional, not required). */
  analysisResult?: {
    confidence?: string;
    bias?: string;
    recommendation?: string;
    fundamentalScore?: number;
    positioningScore?: number;
    fundamentalEvidenceAvailable?: boolean;
    technicalData?: {
      htfBias?: string;
      mtfAlignment?: string;
      marketRegime?: string;
      atr?: number;
    };
  };
  /** Phase 55 — Analytical depth context (informational only, never modifies decision engine). */
  analyticalDepth?: {
    regime?: string;
    supportingEvidence?: string[];
    conflictingEvidence?: string[];
    missingInformation?: string[];
    dimensionsAvailable?: number;
    dimensionsTotal?: number;
    relativeValue?: string;
  };
}

/**
 * Adapt the verified runtime source into the radar contract without losing
 * provider-backed technical or asset-specific context. History-only records
 * never create a market snapshot or get promoted to live evidence.
 */
function isPetroleumInstrument(instrument: string): boolean {
  return /(?:WTI|CRUDE|USOIL|UKOIL|BRENT|XTIUSD|XBRUSD|CL=F|BZ=F)/i.test(instrument);
}

function normalizeRadarSourceTimeframe(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toUpperCase().replace(/\s+/g, "");
  const aliases: Record<string, string> = {
    "1M": "M1", "1MIN": "M1", "5M": "M5", "5MIN": "M5",
    "15M": "M15", "15MIN": "M15", "1H": "H1", "1HR": "H1",
    "4H": "H4", "4HR": "H4", "1D": "D1", "1DAY": "D1",
    "1W": "W1", "1WEEK": "W1",
  };
  return aliases[normalized] ?? normalized;
}

const RADAR_SOURCE_TIMEFRAME_MS: Record<string, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
  W1: 7 * 24 * 60 * 60_000,
};

const RADAR_SOURCE_TIMEFRAME_RANK: Record<string, number> = {
  M1: 1, M5: 2, M15: 3, H1: 4, H4: 5, D1: 6, W1: 7,
};

function getInvestorStructure(technical?: TechnicalData): TimeframeStructureContext | undefined {
  const candidates = [
    technical?.htfContext,
    ...(technical?.mtf?.timeframes ?? [])
      .filter((item) => item.available && (item.role === "macro" || item.role === "structure"))
      .map((item) => item.smc?.internalExternal.external),
    technical?.smc?.internalExternal.external,
  ].filter((item): item is TimeframeStructureContext =>
    !!item && (item.structure === "HH/HL" || item.structure === "LH/LL"),
  );
  return candidates.sort((a, b) =>
    (RADAR_SOURCE_TIMEFRAME_RANK[b.timeframe] ?? 0) -
    (RADAR_SOURCE_TIMEFRAME_RANK[a.timeframe] ?? 0),
  )[0];
}

function getInvestorAccumulationZone(
  technical: TechnicalData | undefined,
  currentTimeframe: string | undefined,
  spot: number,
  asOf: number,
): InvestorOpportunityProjection["accumulationZone"] {
  const currentRank = RADAR_SOURCE_TIMEFRAME_RANK[currentTimeframe ?? ""] ?? 0;
  const candidates = (technical?.mtf?.timeframes ?? [])
    .filter((item) =>
      item.available &&
      (item.role === "macro" || item.role === "structure") &&
      (RADAR_SOURCE_TIMEFRAME_RANK[item.timeframe] ?? 0) > currentRank &&
      item.smc,
    )
    .flatMap((item) => (item.smc?.orderBlocks ?? []).flatMap((block) => {
      if (
        block.direction !== "bullish" ||
        block.status !== "fresh" ||
        !block.evidence.precedingOpposingCandle ||
        !block.evidence.displacementAfter ||
        !block.evidence.structuralBreakAfter ||
        !Number.isFinite(block.createdAt) ||
        block.createdAt <= 0 ||
        block.createdAt > asOf ||
        !Number.isFinite(block.lower) ||
        !Number.isFinite(block.upper) ||
        block.lower <= 0 ||
        block.upper <= block.lower ||
        block.lower >= spot
      ) return [];
      return [{
        lower: block.lower,
        upper: block.upper,
        timeframe: item.timeframe,
        createdAt: block.createdAt,
        source: "validated_bullish_order_block" as const,
      }];
    }));
  return candidates.sort((a, b) =>
    (RADAR_SOURCE_TIMEFRAME_RANK[b.timeframe] ?? 0) - (RADAR_SOURCE_TIMEFRAME_RANK[a.timeframe] ?? 0) ||
    Math.max(0, spot - a.upper) - Math.max(0, spot - b.upper),
  )[0];
}

function buildInvestmentProjection(
  market: LiveCandidateSource["marketData"],
  technical: TechnicalData | undefined,
  analysis: LiveCandidateSource["analysisResult"],
): Omit<InvestorOpportunityProjection, "horizon"> | undefined {
  if (!market) return undefined;
  const spot = market.price?.price;
  const asOf = market.price?.timestamp;
  const empty: Omit<InvestorOpportunityProjection, "horizon"> = {
    status: "UNAVAILABLE",
    direction: "neutral",
    evidence: [],
    limitations: [],
  };
  if (!Number.isFinite(spot) || (spot ?? 0) <= 0 || !Number.isFinite(asOf) || (asOf ?? 0) <= 0 || (asOf ?? 0) > market.fetchTimestamp) {
    return { ...empty, limitations: ["A valid exact-instrument price and non-future source timestamp are required."] };
  }
  if (market.dataFreshness === "stale" || market.dataFreshness === "unavailable") {
    return {
      ...empty,
      status: "BLOCKED_DATA_QUALITY",
      limitations: ["Primary market data is stale or unavailable; investment price levels are suppressed."],
    };
  }

  const price = spot!;
  const observedAt = asOf!;
  const structure = getInvestorStructure(technical);
  const structuralDirection = structure?.structure === "HH/HL"
    ? "bullish"
    : structure?.structure === "LH/LL"
      ? "bearish"
      : "neutral";
  const mtfDirection = technical?.mtf?.htfBias === "long"
    ? "bullish"
    : technical?.mtf?.htfBias === "short"
      ? "bearish"
      : "neutral";
  // A disagreement between the MTF bias and the selected external structure
  // blocks a directional investment plan instead of choosing the convenient side.
  const direction = structuralDirection !== "neutral" &&
    (mtfDirection === "neutral" || mtfDirection === structuralDirection)
    ? structuralDirection
    : "neutral";
  const structuralObjective = direction === "bullish"
    ? structure?.lastSwingHigh
    : direction === "bearish"
      ? structure?.lastSwingLow
      : undefined;
  const structuralInvalidation = direction === "bullish"
    ? structure?.lastSwingLow
    : direction === "bearish"
      ? structure?.lastSwingHigh
      : undefined;
  const validObjective = Number.isFinite(structuralObjective) && (
    direction === "bullish" ? structuralObjective! > price : direction === "bearish" ? structuralObjective! < price : false
  ) ? structuralObjective : undefined;
  const validInvalidation = Number.isFinite(structuralInvalidation) && (
    direction === "bullish" ? structuralInvalidation! < price : direction === "bearish" ? structuralInvalidation! > price : false
  ) ? structuralInvalidation : undefined;

  const fundamentalOutlook = analysis
    ? buildInvestorFundamentalOutlook(analysis, price)
    : undefined;
  const valuationReference = fundamentalOutlook?.valuationReference;
  const valuationObjective = valuationReference && (
    direction === "bullish" ? valuationReference.price > price :
    direction === "bearish" ? valuationReference.price < price : false
  ) ? valuationReference : undefined;
  const objective = valuationObjective?.price ?? validObjective;
  const invalidation = validInvalidation;
  const risk = invalidation === undefined ? undefined : Math.abs(price - invalidation);
  const reward = objective === undefined ? undefined : Math.abs(objective - price);
  const rewardRiskRatio = reward !== undefined && risk !== undefined && reward > 0 && risk > 0
    ? reward / risk
    : undefined;
  const accumulationZone = direction === "bullish"
    ? getInvestorAccumulationZone(technical, market.timeframe, price, observedAt)
    : undefined;
  const evidence = direction === "neutral"
    ? []
    : [
        "Direction is derived from the available higher-timeframe external structure.",
        ...(valuationObjective ? ["Objective uses the exact-instrument " + valuationObjective.kind.toLowerCase() + " reference from " + valuationObjective.source + "."] : validObjective !== undefined ? ["Objective is an observed higher-timeframe swing level, not a guaranteed target."] : []),
        ...(invalidation !== undefined ? ["Invalidation is the opposing observed higher-timeframe swing level."] : []),
        ...(accumulationZone ? ["Accumulation zone is a fresh higher-timeframe bullish order block with verified displacement and structural-break evidence."] : []),
      ];
  const limitations = [
    "Investment projection is informational, not an order or a calibrated probability forecast.",
    "Structural reward/risk is a price-distance ratio before fees, slippage, funding, borrow, dividends, and corporate actions.",
    ...(objective === undefined ? ["No directionally valid valuation or higher-timeframe objective is available."] : []),
    ...(invalidation === undefined ? ["No directionally valid higher-timeframe invalidation is available."] : []),
    ...(!accumulationZone && direction === "bullish" ? ["No validated higher-timeframe bullish order-block accumulation zone is available."] : []),
  ];
  return {
    status: direction !== "neutral" && objective !== undefined && invalidation !== undefined && rewardRiskRatio !== undefined
      ? "CONDITIONAL"
      : "UNAVAILABLE",
    direction,
    entryReference: price,
    accumulationZone,
    objective: objective === undefined ? undefined : {
      price: objective,
      source: valuationObjective?.kind ?? "higher_timeframe_external_swing",
      meaning: valuationObjective?.description ?? "Observed structural objective; not fair value",
    },
    invalidation: invalidation === undefined ? undefined : {
      price: invalidation,
      source: "higher_timeframe_external_swing",
      meaning: "Observed opposing structural invalidation",
    },
    rewardRiskRatio,
    evidence,
    limitations,
  };
}

export function toRadarCandidateSource(
  source: LiveCandidateSource,
  relatedSources: LiveCandidateSource[] = [],
): RadarCandidateSource {
  const market = source.marketData?.instrument === source.instrument
    ? source.marketData
    : undefined;
  const instrumentAnalysis = source.analysisResult?.instrument === source.instrument
    ? source.analysisResult
    : undefined;
  const marketTimeframe = normalizeRadarSourceTimeframe(market?.timeframe);
  const analysisTimeframe = normalizeRadarSourceTimeframe(instrumentAnalysis?.timeframe);
  const analysisPrice = instrumentAnalysis?.priceSnapshot;
  const marketPrice = market?.price;
  const sameObservedPriceSnapshot = !!analysisPrice && !!marketPrice &&
    analysisPrice.price === marketPrice.price &&
    analysisPrice.timestamp === marketPrice.timestamp;
  // Technical data is reusable only for the exact market observation and
  // timeframe that produced it. Same-instrument fundamentals remain valid
  // context, but a different-timeframe technical read must not leak into setup evidence.
  const matchingAnalysis = instrumentAnalysis &&
    !!marketTimeframe &&
    analysisTimeframe === marketTimeframe &&
    sameObservedPriceSnapshot
    ? instrumentAnalysis
    : undefined;
  const candleSeries = market?.candles?.slice().sort((a, b) => a.timestamp - b.timestamp);
  const currentDuration = marketTimeframe ? RADAR_SOURCE_TIMEFRAME_MS[marketTimeframe] : undefined;
  const siblingHigherTimeframe = currentDuration === undefined
    ? undefined
    : relatedSources
        .filter((candidate) => candidate !== source && candidate.instrument === source.instrument)
        .map((candidate) => ({
          market: candidate.marketData?.instrument === source.instrument ? candidate.marketData : undefined,
          timeframe: normalizeRadarSourceTimeframe(candidate.marketData?.timeframe),
        }))
        .filter((candidate) =>
          !!candidate.market &&
          !!candidate.timeframe &&
          (RADAR_SOURCE_TIMEFRAME_MS[candidate.timeframe] ?? 0) > currentDuration &&
          (candidate.market.candles?.length ?? 0) >= 30,
        )
        .sort((a, b) =>
          (RADAR_SOURCE_TIMEFRAME_MS[a.timeframe!] ?? Number.POSITIVE_INFINITY) -
          (RADAR_SOURCE_TIMEFRAME_MS[b.timeframe!] ?? Number.POSITIVE_INFINITY),
        )[0];
  const suppliedHigherCandles = (market?.higherTimeframeCandles?.length ?? 0) >= 30
    ? market?.higherTimeframeCandles
    : undefined;
  const higherTimeframeCandles = suppliedHigherCandles ??
    siblingHigherTimeframe?.market?.candles?.slice().sort((a, b) => a.timestamp - b.timestamp);
  const higherTimeframeLabel = market?.higherTimeframe ?? siblingHigherTimeframe?.timeframe ?? "HTF";
  const technical = source.technicalData ?? matchingAnalysis?.technicalData ?? (
    candleSeries && candleSeries.length >= 30
      ? calculateTechnical(candleSeries, higherTimeframeCandles, higherTimeframeLabel)
      : undefined
  );
  const conditionalScenarios = market && candleSeries && technical
    ? buildConditionalEntryScenariosFromMarketData({
        candles: candleSeries,
        technicalData: technical,
        primaryQuality: market.dataFreshness === "stale"
          ? "STALE"
          : market.dataFreshness === "unavailable"
            ? "UNAVAILABLE"
            : undefined,
      })
    : [];

  const setupEvidence = extractSetupEvidence(technical, market?.price?.price);
  const analysis = instrumentAnalysis;
  const intelligence = source.universalIntelligence?.instrument === source.instrument &&
    source.universalIntelligence.assetClass === source.assetClass
    ? source.universalIntelligence
    : undefined;
  const derivativesData = source.derivativesData &&
    matchesDerivativeSymbol(
      source.instrument,
      source.providerNative?.providerInstrumentId,
      source.derivativesData.symbol,
    )
    ? source.derivativesData
    : undefined;
  const cotData = source.cotData?.requestedInstrument === source.instrument
    ? source.cotData
    : undefined;

  const htf = technical?.mtf?.htfBias;
  const htfStructure = technical?.htfContext?.structure;
  const htfBias: NonNullable<MarketSnapshot["htfBias"]> =
    htf === "long" || htf === "short" ? htf :
    htfStructure === "HH/HL" ? "long" :
    htfStructure === "LH/LL" ? "short" :
    htfStructure === "range" ? "neutral" : "unknown";
  const primaryStructureDirection =
    technical?.structure === "HH/HL" ? "long" :
    technical?.structure === "LH/LL" ? "short" : undefined;
  const higherStructureDirection =
    htfStructure === "HH/HL" ? "long" :
    htfStructure === "LH/LL" ? "short" : undefined;
  const derivedMtfAlignment = primaryStructureDirection && higherStructureDirection
    ? primaryStructureDirection === higherStructureDirection
      ? primaryStructureDirection === "long" ? "ALIGNED_BULLISH" : "ALIGNED_BEARISH"
      : "MIXED"
    : undefined;
  const mtfAlignment = technical?.mtf?.alignment ??
    matchingAnalysis?.mtfSummary?.alignment ??
    derivedMtfAlignment;
  const marketRegime =
    technical?.structure === "HH/HL" || technical?.structure === "LH/LL" ? "TRENDING" :
    technical?.structure === "range" ? "RANGING" : "UNKNOWN";

  const latestCandleTimestamp = market?.candles?.reduce<number | undefined>(
    (latest, candle) => latest === undefined || candle.timestamp > latest ? candle.timestamp : latest,
    undefined,
  );
  const observedAt = market?.price?.timestamp ?? latestCandleTimestamp ?? market?.fetchTimestamp ?? 0;

  const sourceFundamentals = analysis?.fundamentalData?.available
    ? analysis.fundamentalData
    : undefined;
  const universalFundamentals = intelligence?.equity?.fundamentals;
  const universalForex = intelligence?.forex;
  const universalCommodity = intelligence?.commodity;
  const fundingRate = derivativesData?.availability.fundingRate
    ? derivativesData.fundingRate?.currentRate
    : undefined;
  const openInterest = derivativesData?.availability.openInterest
    ? derivativesData.openInterest?.current
    : undefined;
  const liquidationVolume = derivativesData?.availability.liquidations
    ? derivativesData.liquidations?.totalVolume
    : undefined;
  const eiaApplicable = isPetroleumInstrument(source.instrument);
  const inventory = (eiaApplicable && source.eiaData?.available ? source.eiaData.series[0]?.latestValue : undefined)
    ?? (universalCommodity?.inventory?.available ? universalCommodity.inventory.currentInventory : undefined);
  const inventoryChange = (eiaApplicable && source.eiaData?.available ? source.eiaData.series[0]?.change : undefined)
    ?? (universalCommodity?.inventory?.available ? universalCommodity.inventory.changeWeekly : undefined);
  const futuresStructure = universalCommodity?.futuresStructure?.available
    ? universalCommodity.futuresStructure.structure
    : undefined;
  const tenYearYield = source.treasuryData?.available
    ? source.treasuryData.latest.nominal.nominal["10Y"]
    : undefined;
  const cotNet = (cotData?.available ? cotData.netNonCommercial : undefined)
    ?? (universalForex?.positioning?.available ? universalForex.positioning.nonCommercialNet : undefined)
    ?? (universalCommodity?.positioning?.available ? universalCommodity.positioning.managedMoneyNet : undefined);
  const rateDifferential = universalForex?.rates?.available
    ? universalForex.rates.rateDifferential
    : undefined;
  const yieldDifferential = universalForex?.yields?.available
    ? universalForex.yields.yieldDifferential
    : undefined;
  const macroScore = source.treasuryData?.available &&
      source.assetClass === "commodity" &&
      /XAU|GOLD/i.test(source.instrument)
    ? deriveMacroYieldEvidence(source.treasuryData).goldLongEffect * 2
    : undefined;
  const investmentProjection = buildInvestmentProjection(market, technical, analysis);

  const snapshot: MarketSnapshot | null = market ? {
    instrument: market.instrument,
    assetClass: source.assetClass,
    price: market.price?.price ?? 0,
    ohlcvAvailable: (market.candles?.length ?? 0) > 0,
    dataPoints: market.candles?.length ?? 0,
    availableTimeframes: (market.candles?.length ?? 0) > 0 ? [market.timeframe] : [],
    htfBias,
    marketRegime,
    mtfAlignment,
    volatility: technical?.atr14,
    provider: market.provider,
    observedAt,
    freshness:
      market.dataFreshness === "realtime" ? "FRESH" :
      market.dataFreshness === "delayed" ? "DELAYED" :
      market.dataFreshness === "stale" ? "STALE" : "UNAVAILABLE",
    quality: market.dataFreshness === "unavailable" ? "UNAVAILABLE" : "VERIFIED",
  } : null;

  const derivatives = fundingRate !== undefined || openInterest !== undefined || liquidationVolume !== undefined
    ? { fundingRate, openInterest, liquidationVolume }
    : undefined;
  const fundamentals = {
    peRatio: sourceFundamentals?.peRatio ?? universalFundamentals?.peRatio,
    profitMargin: sourceFundamentals?.profitMargin ?? universalFundamentals?.profitMargin,
    marketCap: sourceFundamentals?.marketCap ?? universalFundamentals?.marketCap,
    revenueGrowth: universalFundamentals?.revenueGrowth,
  };
  const cot = cotNet !== undefined
    ? { netNonCommercial: cotNet }
    : undefined;
  const eia = inventory !== undefined || inventoryChange !== undefined || futuresStructure !== undefined
    ? { inventory, inventoryChange, futuresStructure }
    : undefined;
  const treasury = tenYearYield !== undefined ||
      intelligence?.crossAsset?.dxy?.trend !== undefined ||
      intelligence?.crossAsset?.riskRegime?.regime !== undefined
    ? {
        tenYearYield,
        dxyTrend: intelligence?.crossAsset?.dxy?.trend,
        riskRegime: intelligence?.crossAsset?.riskRegime?.regime,
      }
    : undefined;

  return {
    universe: {
      instrument: source.instrument,
      assetClass: source.assetClass,
      region: source.assetClass === "equity"
        ? (/(?:BBCA|BBRI|TLKM|BMRI|BBNI|GOTO)/i.test(source.instrument) ? "idx" : "us")
        : "global",
      requiredCapabilities: ["ohlcv", "quote"],
      priority: 1,
      refreshIntervalMs: 300_000,
    },
    snapshot,
    ...(conditionalScenarios.length > 0 ? { conditionalScenarios } : {}),
    ...(investmentProjection ? { investmentProjection } : {}),
    ...(derivatives ? { derivatives } : {}),
    ...(Object.values(fundamentals).some((value) => value !== undefined) ? { fundamentals } : {}),
    ...(setupEvidence ? setupEvidence : {}),
    ...(rateDifferential !== undefined ? { rateDifferential } : {}),
    ...(yieldDifferential !== undefined ? { yieldDifferential } : {}),
    ...(macroScore !== undefined ? { macroScore } : {}),
    ...(cot ? { cot } : {}),
    ...(eia ? { eia } : {}),
    ...(treasury ? { treasury } : {}),
    ...(analysis ? {
      analysisResult: {
        confidence: String(analysis.confidence),
        bias: analysis.bias,
        recommendation: analysis.recommendation,
        fundamentalScore: analysis.breakdown?.fundamental,
        positioningScore: analysis.breakdown?.sentiment,
        fundamentalEvidenceAvailable:
          analysis.breakdown?.fundamental !== undefined &&
          Number.isFinite(analysis.breakdown.fundamental),
        technicalData: {
          htfBias,
          mtfAlignment: technical?.mtf?.alignment ?? analysis.mtfSummary?.alignment,
          marketRegime,
          atr: technical?.atr14,
        },
      },
    } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════
// DATA COMPLETENESS ASSESSMENT
// ═══════════════════════════════════════════════════════════════

function assessDataCompleteness(source: RadarCandidateSource): DataCompletenessLevel {
  let count = 0;
  if (Number.isFinite(source.snapshot?.price) && (source.snapshot?.price ?? 0) > 0) count++;
  // OHLCV is evidence only when the provider reports a usable candle sample.
  // A boolean availability flag with zero/unknown rows must not satisfy the
  // market-history completeness gate.
  if (
    source.snapshot?.ohlcvAvailable === true &&
    Number.isFinite(source.snapshot.dataPoints) &&
    (source.snapshot.dataPoints ?? 0) >= 20
  ) count++;
  if (source.snapshot?.htfBias && source.snapshot.htfBias !== "unknown") count++;
  if (
    source.snapshot?.mtfAlignment &&
    source.snapshot.mtfAlignment !== "INSUFFICIENT_DATA" &&
    source.snapshot.mtfAlignment.toUpperCase() !== "UNKNOWN"
  ) count++;
  if (source.snapshot?.marketRegime && source.snapshot.marketRegime.toUpperCase() !== "UNKNOWN") count++;
  if (source.derivatives?.fundingRate !== undefined) count++;
  if (source.derivatives?.openInterest !== undefined) count++;
  if (source.fundamentals?.peRatio !== undefined) count++;
  if (source.cot?.netNonCommercial !== undefined) count++;
  if (source.eia?.inventory !== undefined) count++;
  if (source.treasury?.tenYearYield !== undefined) count++;

  // Market snapshot fields and prior analysis metadata are not independent
  // contextual intelligence. FULL completeness requires at least one actual
  // asset-relevant context field, not just a dense technical snapshot.
  const hasContextEvidence =
    source.derivatives?.fundingRate !== undefined ||
    source.derivatives?.openInterest !== undefined ||
    source.derivatives?.liquidationVolume !== undefined ||
    source.fundamentals?.peRatio !== undefined ||
    source.fundamentals?.profitMargin !== undefined ||
    source.fundamentals?.marketCap !== undefined ||
    source.fundamentals?.revenueGrowth !== undefined ||
    source.cot?.netNonCommercial !== undefined ||
    source.eia?.inventory !== undefined ||
    source.eia?.inventoryChange !== undefined ||
    source.eia?.futuresStructure !== undefined ||
    source.treasury?.tenYearYield !== undefined ||
    source.treasury?.dxyTrend !== undefined ||
    source.treasury?.riskRegime !== undefined;

  if (count >= 6 && hasContextEvidence) return "FULL";
  if (count >= 4) return "PARTIAL";
  if (count >= 2) return "MINIMAL";
  if (count >= 1) return "MINIMAL";
  return "NONE";
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER COVERAGE ASSESSMENT
// ═══════════════════════════════════════════════════════════════

function assessProviderCoverage(source: RadarCandidateSource): CandidateInput["providerCoverage"] {
  // Coverage measures the universe entry's REQUIRED capabilities, not the
  // total number of unrelated payloads. Optional derivatives/fundamentals
  // must never compensate for a missing required quote or candle history.
  const required = source.universe.requiredCapabilities;
  if (required.length === 0) return "FULL";

  const hasUsableQuote = Number.isFinite(source.snapshot?.price) &&
    (source.snapshot?.price ?? 0) > 0;
  const hasUsableOhlcv = source.snapshot?.ohlcvAvailable === true &&
    Number.isFinite(source.snapshot.dataPoints) &&
    (source.snapshot.dataPoints ?? 0) >= 20;
  const hasDerivatives = source.derivatives !== undefined && (
    source.derivatives.fundingRate !== undefined ||
    source.derivatives.openInterest !== undefined ||
    source.derivatives.liquidationVolume !== undefined
  );
  const hasFundamentals = source.fundamentals !== undefined &&
    Object.values(source.fundamentals).some((value) =>
      value !== undefined && Number.isFinite(value)
    );
  const capabilityAvailable: Record<string, boolean> = {
    quote: hasUsableQuote,
    ohlcv: hasUsableOhlcv,
    derivatives: hasDerivatives,
    fundamentals: hasFundamentals,
    cot: source.cot?.netNonCommercial !== undefined &&
      Number.isFinite(source.cot.netNonCommercial),
    eia: source.eia !== undefined && (
      source.eia.inventory !== undefined ||
      source.eia.inventoryChange !== undefined ||
      source.eia.futuresStructure !== undefined
    ),
    macro: source.treasury !== undefined && (
      source.treasury.tenYearYield !== undefined ||
      source.treasury.dxyTrend !== undefined ||
      source.treasury.riskRegime !== undefined
    ),
    treasury: source.treasury?.tenYearYield !== undefined &&
      Number.isFinite(source.treasury.tenYearYield),
  };
  const available = required.filter((capability) => capabilityAvailable[capability] === true).length;
  const ratio = available / required.length;
  if (ratio >= 0.8) return "FULL";
  if (ratio >= 0.5) return "PARTIAL";
  if (ratio > 0) return "MINIMAL";
  return "NONE";
}

// ═══════════════════════════════════════════════════════════════
// CANDIDATE BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildRadarCandidate(
  source: RadarCandidateSource,
  now?: number,
): CandidateInput {
  const timestamp = now ?? Date.now();
  const snapshot = source.snapshot;
  const freshness: FreshnessLevel = snapshot
    ? assessFreshness(snapshot.observedAt, timestamp, snapshot.freshness)
    : "UNAVAILABLE";

  const dataCompleteness = assessDataCompleteness(source);
  const providerCoverage = assessProviderCoverage(source);

  const price = snapshot?.price ?? 0;
  const hasLiveData = freshness === "FRESH" || freshness === "DELAYED";

  // Build candidate from available data — never fabricate
  const candidate: CandidateInput = {
    instrument: source.universe.instrument,
    assetClass: source.universe.assetClass,
    currentPrice: price,
    dataCompleteness,
    // Only a provider-reported candle count can increase data-quality scoring.
    // An OHLCV availability flag is not evidence that 50 rows were returned.
    dataPoints: snapshot?.dataPoints ?? 0,
    hasLiveData,
    freshness,
    providerCoverage,
  };

  // Verified setup evidence from the same source used to build this candidate.
  if (source.setupDirection !== undefined) candidate.setupDirection = source.setupDirection;
  if (source.setupStrength !== undefined && Number.isFinite(source.setupStrength)) candidate.setupStrength = source.setupStrength;
  if (source.confluenceCount !== undefined && Number.isFinite(source.confluenceCount)) candidate.confluenceCount = source.confluenceCount;

  // Market structure (only from real data)
  if (snapshot?.htfBias) {
    candidate.htfBias = snapshot.htfBias as CandidateInput["htfBias"];
  }
  if (snapshot?.marketRegime) {
    candidate.marketRegime = snapshot.marketRegime;
  }
  if (snapshot?.mtfAlignment) {
    candidate.mtfAlignment = snapshot.mtfAlignment;
  }
  if (snapshot?.volatility) {
    candidate.atr = snapshot.volatility;
  }
  if (snapshot?.spreadBps) {
    candidate.spreadBps = snapshot.spreadBps;
  }

  // Analysis-derived structure (if available, additive only)
  if (source.analysisResult?.technicalData) {
    const tech = source.analysisResult.technicalData;
    if (tech.htfBias && !candidate.htfBias) {
      candidate.htfBias = tech.htfBias as CandidateInput["htfBias"];
    }
    if (tech.mtfAlignment && !candidate.mtfAlignment) {
      candidate.mtfAlignment = tech.mtfAlignment;
    }
    if (tech.marketRegime && !candidate.marketRegime) {
      candidate.marketRegime = tech.marketRegime;
    }
    if (tech.atr && !candidate.atr) {
      candidate.atr = tech.atr;
    }
  }

  // ── Asset-class-specific data ──

  // Crypto
  if (source.derivatives) {
    candidate.hasDerivatives = true;
    candidate.fundingRate = source.derivatives.fundingRate;
    candidate.openInterest = source.derivatives.openInterest;
  }

  // Equity
  if (source.fundamentals) {
    candidate.hasFundamentals = true;
    candidate.peRatio = source.fundamentals.peRatio;
    candidate.profitMargin = source.fundamentals.profitMargin;
    candidate.marketCap = source.fundamentals.marketCap;
    candidate.revenueGrowth = source.fundamentals.revenueGrowth;
  }

  // Rate/yield differentials are context fields, not signed alpha by themselves.
  if (source.rateDifferential !== undefined) candidate.rateDifferential = source.rateDifferential;
  if (source.yieldDifferential !== undefined) candidate.yieldDifferential = source.yieldDifferential;
  if (source.macroScore !== undefined) candidate.macroScore = source.macroScore;

  // Forex / Commodity — COT
  if (source.cot) {
    candidate.hasCOT = true;
    candidate.cotNet = source.cot.netNonCommercial;
  }

  // Commodity — EIA
  if (source.eia) {
    candidate.inventory = source.eia.inventory;
    candidate.inventoryChange = source.eia.inventoryChange;
    candidate.futuresStructure = source.eia.futuresStructure;
  }

  // Macro
  if (source.treasury) {
    candidate.hasMacro = true;
    candidate.dxyTrend = source.treasury.dxyTrend;
    candidate.riskRegime = source.treasury.riskRegime;
  }

  // Analysis metadata (additive)
  if (source.analysisResult) {
    candidate.hasAnalysis = true;
    const confStr = source.analysisResult.confidence;
    if (confStr) {
      const num = parseInt(confStr, 10);
      if (!isNaN(num)) candidate.analysisConfidence = num;
    }
    if (source.analysisResult.fundamentalScore !== undefined) {
      candidate.fundamentalScore = source.analysisResult.fundamentalScore;
    }
    if (source.analysisResult.positioningScore !== undefined) {
      candidate.positioningScore = source.analysisResult.positioningScore;
    }
    if (source.analysisResult.fundamentalEvidenceAvailable !== undefined) {
      candidate.fundamentalEvidenceAvailable = source.analysisResult.fundamentalEvidenceAvailable;
    }
  }

  return candidate;
}
