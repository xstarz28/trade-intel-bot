/**
 * Phase 51 — Radar Candidate Builder
 *
 * Builds CandidateInput objects directly from market snapshots and
 * provider data, WITHOUT requiring analysis history.
 *
 * Analysis history is ONE source of evidence, not the primary source.
 * Missing components remain missing — never fabricated.
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { CandidateInput, DataCompletenessLevel } from "@/lib/recommendation-engine";
import type { MarketSnapshot, FreshnessLevel } from "./types";
import type { UniverseEntry } from "./types";
import { assessFreshness } from "./freshness";
import type { LiveCandidateSource } from "../liveCandidateBuilder";
import { deriveMacroYieldEvidence } from "@/lib/data/treasury";

// ═══════════════════════════════════════════════════════════════
// RADAR CANDIDATE SOURCE
// ═══════════════════════════════════════════════════════════════

export interface RadarCandidateSource {
  /** Instrument universe entry. */
  universe: UniverseEntry;
  /** Market snapshot from provider (if available). */
  snapshot?: MarketSnapshot | null;
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
export function toRadarCandidateSource(source: LiveCandidateSource): RadarCandidateSource {
  const market = source.marketData?.instrument === source.instrument
    ? source.marketData
    : undefined;
  const matchingAnalysis = source.analysisResult?.instrument === source.instrument
    ? source.analysisResult
    : undefined;
  const technical = source.technicalData ?? matchingAnalysis?.technicalData;
  const analysis = matchingAnalysis;
  const intelligence = source.universalIntelligence?.instrument === source.instrument
    ? source.universalIntelligence
    : undefined;
  const expectedProviderSymbol = source.providerNative?.providerInstrumentId ?? source.instrument;
  const derivativesData = source.derivativesData?.symbol === expectedProviderSymbol
    ? source.derivativesData
    : undefined;
  const cotData = source.cotData?.requestedInstrument === source.instrument
    ? source.cotData
    : undefined;

  const htf = technical?.mtf?.htfBias;
  const htfBias: NonNullable<MarketSnapshot["htfBias"]> =
    htf === "long" || htf === "short" ? htf :
    technical?.structure === "HH/HL" ? "long" :
    technical?.structure === "LH/LL" ? "short" :
    technical?.structure === "range" ? "neutral" : "unknown";
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
  const inventory = (source.eiaData?.available ? source.eiaData.series[0]?.latestValue : undefined)
    ?? (universalCommodity?.inventory?.available ? universalCommodity.inventory.currentInventory : undefined);
  const inventoryChange = (source.eiaData?.available ? source.eiaData.series[0]?.change : undefined)
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

  const snapshot: MarketSnapshot | null = market ? {
    instrument: market.instrument,
    assetClass: source.assetClass,
    price: market.price?.price ?? 0,
    ohlcvAvailable: (market.candles?.length ?? 0) > 0,
    dataPoints: market.candles?.length ?? 0,
    availableTimeframes: (market.candles?.length ?? 0) > 0 ? [market.timeframe] : [],
    htfBias,
    marketRegime,
    mtfAlignment: technical?.mtf?.alignment ?? analysis?.mtfSummary?.alignment,
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
    ...(derivatives ? { derivatives } : {}),
    ...(Object.values(fundamentals).some((value) => value !== undefined) ? { fundamentals } : {}),
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
          analysis.fundamentalData?.available === true ||
          analysis.macroData?.confidence === "high" ||
          analysis.macroData?.confidence === "medium" ||
          !!analysis.calendarData?.events?.some(
            (event) => event.status === "released" && event.actual !== undefined && event.forecast !== undefined,
          ),
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
  if (source.snapshot?.price && source.snapshot.price > 0) count++;
  if (source.snapshot?.ohlcvAvailable) count++;
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
  if (source.analysisResult) count++;

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
  let total = source.universe.requiredCapabilities.length;
  if (total === 0) return "FULL";
  let available = 0;
  if (source.snapshot?.price && source.snapshot.price > 0) available++;
  if (source.snapshot?.ohlcvAvailable) available++;
  if (source.derivatives) available++;
  if (source.fundamentals) available++;
  if (source.cot) available++;
  if (source.eia) available++;
  if (source.treasury) available++;

  const ratio = available / total;
  if (ratio >= 0.8) return "FULL";
  if (ratio >= 0.5) return "PARTIAL";
  if (ratio >= 0.2) return "MINIMAL";
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
    ? assessFreshness(snapshot.observedAt, timestamp)
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
