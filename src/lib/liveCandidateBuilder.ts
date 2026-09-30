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
import type { TreasuryData } from "./data/treasury";
import type { CotData } from "./data/cot";
import type { EiaData } from "./data/eia";

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
  /**
   * Phase 158 — correlation grouping key derived from provider-native
   * metadata (asset class + base asset).
   *
   * Used ONLY to cap how many correlated instruments surface together.
   * It is never directional evidence and never merges two identities.
   */
  correlationKey?: string;
  /**
   * Phase 165 — venue/region as reported by the PROVIDER during discovery.
   *
   * Exists so the UI never has to infer region by pattern-matching symbol
   * names (which is a hidden whitelist: any instrument not in the pattern
   * list gets mislabelled, and new listings are silently wrong).
   * Undefined means "the provider did not tell us", not "global".
   */
  region?: string;
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

/**
 * Tolerance for benign clock skew between our clock and a provider's.
 * A few seconds of drift is normal; more than this is not trustworthy.
 */
const FUTURE_TIMESTAMP_TOLERANCE_MS = 60_000;

function assessFreshness(
  timestamp: number | undefined,
  now: number,
): "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" {
  if (!timestamp) return "UNAVAILABLE";
  const ageMs = now - timestamp;

  // A timestamp meaningfully in the future cannot be verified as live data.
  // Treating it as FRESH would let clock skew or a malformed provider
  // payload promote unverifiable data into the scanner. Refuse it instead.
  if (ageMs < -FUTURE_TIMESTAMP_TOLERANCE_MS) return "UNAVAILABLE";

  // Within tolerance, treat mild skew as "just now" rather than negative age.
  if (ageMs < 0) return "FRESH";
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

/**
 * Phase 290-A — the HTF bias comes from the CONFIRMED structural event read
 * when it exists (an actual close beyond a confirmed swing level), and only
 * falls back to the structure label otherwise. The label can sit above an old
 * swing for many candles; the event cannot.
 */
function extractHtfBias(tech: TechnicalData | undefined): "long" | "short" | "neutral" | "unknown" {
  if (!tech) return "unknown";
  const evidence = tech.smc?.structural?.external;
  if (evidence) {
    if (evidence.direction === "bullish") return "long";
    if (evidence.direction === "bearish") return "short";
    if (evidence.regime === "range") return "neutral";
    return "unknown";
  }
  if (tech.structure === "HH/HL") return "long";
  if (tech.structure === "LH/LL") return "short";
  if (tech.structure === "range") return "neutral";
  return "unknown";
}

/** Phase 290-A — deterministic structural facts for the candidate. */
function extractStructuralFields(tech: TechnicalData | undefined): {
  structuralDirection?: "bullish" | "bearish" | "none";
  structuralEvent?: {
    kind: "BOS" | "CHOCH";
    direction: "bullish" | "bearish";
    brokenLevel: number;
    candleTime: number;
    timeframe: string;
  };
  structuralInvalidation?: { level: number; timeframe: string; swingKind: "high" | "low" };
  structuralPairState?: string;
  structuralReason?: string;
} {
  const pair = tech?.smc?.structural;
  if (!pair) return {};
  const external = pair.external;
  return {
    structuralDirection: external.direction,
    ...(external.lastEvent
      ? {
          structuralEvent: {
            kind: external.lastEvent.kind,
            direction: external.lastEvent.direction,
            brokenLevel: external.lastEvent.brokenLevel,
            candleTime: external.lastEvent.candleTime,
            timeframe: external.timeframe,
          },
        }
      : {}),
    ...(external.invalidation
      ? {
          structuralInvalidation: {
            level: external.invalidation.level,
            timeframe: external.timeframe,
            swingKind: external.invalidation.swingKind,
          },
        }
      : {}),
    structuralPairState: pair.state,
    structuralReason: pair.reason,
  };
}

/**
 * Phase 291 — trade-location / setup-context evidence.
 *
 * Read straight from the analysis result (which assembled it from the SMC
 * objects and the confirmed structural pair). The facts are the engine's own
 * deterministic lines; nothing is re-derived here and no score is invented.
 */
function extractSetupEvidence(ar: AnalysisResult | undefined): {
  setupContextState?: string;
  setupDirection?: "bullish" | "bearish" | "none";
  zoneContext?: {
    kind: "FVG" | "OB" | "FVG+OB" | "none";
    direction: "bullish" | "bearish" | "none";
    lower?: number;
    upper?: number;
    position: string;
    status?: string;
    timeframe: string;
  };
  fvgState?: {
    direction: "bullish" | "bearish";
    upper: number;
    lower: number;
    status: string;
    position: string;
    timeframe: string;
    createdAt: number;
  };
  obState?: {
    direction: "bullish" | "bearish";
    upper: number;
    lower: number;
    status: string;
    position: string;
    timeframe: string;
    validatedAt: number;
  };
  liquidityEvent?: {
    side: string;
    level: number;
    candleTime: number;
    timeframe: string;
    ageCandles: number;
  };
  setupFacts?: string[];
  /** One deterministic context line per other timeframe, keyed by timeframe. */
  setupEvidenceByTimeframe?: Record<string, string>;
} {
  const tl = ar?.tradeLocation;
  if (!tl) return {};

  const fvg = tl.zones.find((z) => z.kind === "FVG");
  const ob = tl.zones.find((z) => z.kind === "OB");
  const nearest = tl.zones[0];
  const kind: "FVG" | "OB" | "FVG+OB" | "none" =
    fvg && ob ? "FVG+OB" : fvg ? "FVG" : ob ? "OB" : "none";
  const sweep = tl.liquidity.sweep;

  return {
    setupContextState: tl.context.state,
    setupDirection: tl.context.direction,
    ...(nearest
      ? {
          zoneContext: {
            kind,
            direction: nearest.direction,
            lower: nearest.lower,
            upper: nearest.upper,
            position: nearest.position,
            status: nearest.status,
            timeframe: tl.setupTimeframe,
          },
        }
      : { zoneContext: { kind: "none" as const, direction: "none" as const, position: "outside", timeframe: tl.setupTimeframe } }),
    ...(fvg
      ? {
          fvgState: {
            direction: fvg.direction,
            upper: fvg.upper,
            lower: fvg.lower,
            status: fvg.status,
            position: fvg.position,
            timeframe: tl.setupTimeframe,
            createdAt: fvg.createdAt,
          },
        }
      : {}),
    ...(ob
      ? {
          obState: {
            direction: ob.direction,
            upper: ob.upper,
            lower: ob.lower,
            status: ob.status,
            position: ob.position,
            timeframe: tl.setupTimeframe,
            validatedAt: 0,
          },
        }
      : {}),
    ...(sweep
      ? {
          liquidityEvent: {
            side: sweep.side,
            level: sweep.level,
            candleTime: sweep.candleTime,
            timeframe: tl.setupTimeframe,
            ageCandles: sweep.ageCandles,
          },
        }
      : {}),
    // The digest is small and deterministic; the setup-timeframe facts are the
    // ones that describe THIS candidate's location.
    // The setup timeframe's own facts describe THIS candidate's location; every
    // other timeframe contributes exactly one context line of its own.
    setupFacts: tl.setupFacts,
    setupEvidenceByTimeframe: Object.fromEntries(
      tl.timeframes
        .filter((row) => row.timeframe !== tl.setupTimeframe)
        .map((row) => [
          row.timeframe,
          `${row.timeframe} (${row.role}): structure ${row.externalStructure}, location ${row.location}, setup ${row.setupState}`,
        ]),
    ),
  };
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
  return {
    hasDerivatives: !!d,
    fundingRate: d?.fundingRate?.currentRate,
    openInterest: d?.openInterest?.current,
  };
}

function extractForexData(source: LiveCandidateSource): Partial<CandidateInput> {
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

/**
 * @param now Evaluation timestamp. Callers that need deterministic results
 *   (the scanner, tests, replay) MUST pass this; otherwise freshness is
 *   assessed against the wall clock and results are not reproducible.
 */
export function buildCandidateFromSource(
  source: LiveCandidateSource,
  now: number = Date.now(),
): CandidateInput {
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
    ...(source.correlationKey ? { correlationKey: source.correlationKey } : {}),
    // Preserve the exact provider-native identity end to end.
    ...(source.providerNative ? { providerNative: source.providerNative } : {}),
    ...(source.region ? { region: source.region } : {}),

    // Structure — the confirmed event record first, the label only as fallback.
    htfBias: extractHtfBias(tech),
    marketRegime: extractMarketRegime(tech),
    mtfAlignment: extractMtfAlignment(ar),
    ...extractStructuralFields(tech),
    // Trade location / setup context (Phase 291) — evidence, never a new score.
    ...extractSetupEvidence(ar),
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
