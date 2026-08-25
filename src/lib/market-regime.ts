/**
 * Phase 28 — MARKET REGIME ENGINE.
 *
 * Professional-grade market regime classification derived from existing
 * engine outputs. This module classifies the market into a regime and phase,
 * evaluates continuation quality, detects exhaustion, and distinguishes
 * correction from reversal — purely as informational context.
 *
 * CRITICAL: CURRENT DIRECTION ≠ FUTURE CONFIRMATION.
 * A bullish market may continue, consolidate, correct, or reverse.
 *
 * This module does NOT:
 * - modify bias / conviction / gates
 * - override structural hierarchy
 * - fabricate future levels
 * - create synthetic price targets
 * - bypass existing gates
 */

import type { AnalysisResult } from "@/types/analysis";
import type { EvidenceItem } from "@/lib/analyst-thesis";

// ── Types ────────────────────────────────────────────────────────

export type RegimeType =
  | "TRENDING_BULLISH"
  | "TRENDING_BEARISH"
  | "RANGE"
  | "ACCUMULATION"
  | "DISTRIBUTION"
  | "BREAKOUT_DEVELOPING"
  | "BREAKDOWN_DEVELOPING"
  | "REVERSAL_DEVELOPING"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "UNCONFIRMED";

export type MarketPhase =
  | "EARLY_TREND"
  | "TREND_MATURE"
  | "LATE_TREND"
  | "CORRECTION"
  | "RANGE_BALANCE"
  | "BREAKOUT_ATTEMPT"
  | "BREAKDOWN_ATTEMPT"
  | "REVERSAL_ATTEMPT"
  | "UNKNOWN";

export type ContinuationQuality =
  | "STRONG"
  | "HEALTHY"
  | "DEVELOPING"
  | "WEAK"
  | "EXHAUSTED"
  | "INVALIDATED"
  | "UNKNOWN";

export type ExhaustionSeverity = "weak" | "moderate" | "strong" | "structural";

export interface ExhaustionSignal {
  signal: string;
  severity: ExhaustionSeverity;
  source: string;
}

export type TransitionType =
  | "CONTINUATION"
  | "HEALTHY_CORRECTION"
  | "DEEP_CORRECTION"
  | "REVERSAL_ATTEMPT"
  | "REVERSAL_CONFIRMED"
  | "RANGE_TRANSITION"
  | "UNKNOWN";

export interface TrendTransition {
  currentTrend: "bullish" | "bearish" | "neutral";
  transitionType: TransitionType;
  confidenceLevel: "confirmed" | "developing" | "absent" | "not_applicable";
  evidence: EvidenceItem[];
  confirmationConditions: string[];
  invalidationConditions: string[];
}

export interface MarketRegimeContext {
  /** Current regime classification. */
  regime: RegimeType;
  /** Market phase within the cycle. */
  marketPhase: MarketPhase;
  /** Current structural direction. */
  currentDirection: "bullish" | "bearish" | "neutral";
  /** How healthy the continuation looks. */
  continuationQuality: ContinuationQuality;
  /** Detected exhaustion signals (informational). */
  exhaustionSignals: ExhaustionSignal[];
  /** Trend transition assessment. */
  trendTransition: TrendTransition;
  /** Primary scenario description. */
  primaryScenario: string;
  /** Alternate scenario description. */
  alternateScenario: string;
  /** Confirmation conditions for primary scenario. */
  confirmationConditions: string[];
  /** Invalidation conditions for primary scenario. */
  invalidationConditions: string[];
  /** Missing information that limits classification. */
  missingInformation: string[];
  /** Regime evidences for transparency. */
  evidences: string[];
}

// ── Helpers ──────────────────────────────────────────────────────

function dirBias(result: AnalysisResult): "bullish" | "bearish" | "neutral" {
  if (result.bias === "Bullish") return "bullish";
  if (result.bias === "Bearish") return "bearish";
  return "neutral";
}

function hasHtfAlignment(result: AnalysisResult, dir: "bullish" | "bearish"): boolean {
  if (!result.htfAlignment) return false;
  const struct = result.htfAlignment.htfStructure;
  if (dir === "bullish") return struct === "HH/HL";
  if (dir === "bearish") return struct === "LH/LL";
  return false;
}

function mtfAligned(result: AnalysisResult, dir: "bullish" | "bearish"): boolean {
  if (!result.mtfSummary) return false;
  if (dir === "bullish") return result.mtfSummary.alignment === "ALIGNED_BULLISH";
  if (dir === "bearish") return result.mtfSummary.alignment === "ALIGNED_BEARISH";
  return false;
}

function isRange(result: AnalysisResult): boolean {
  if (result.marketRegime?.regime === "RANGING") return true;
  const htfStruct = result.htfAlignment?.htfStructure;
  return htfStruct === "range";
}

function hasVolatilityExpansion(result: AnalysisResult): boolean {
  return result.marketRegime?.regime === "VOLATILITY_EXPANSION";
}

function hasContraDirectionMtf(result: AnalysisResult, dir: "bullish" | "bearish"): boolean {
  if (!result.mtfSummary) return false;
  if (dir === "bullish") return result.mtfSummary.alignment === "ALIGNED_BEARISH" || result.mtfSummary.alignment === "COUNTER_TREND";
  if (dir === "bearish") return result.mtfSummary.alignment === "ALIGNED_BULLISH" || result.mtfSummary.alignment === "COUNTER_TREND";
  return false;
}

function hasMaterialContradiction(result: AnalysisResult): boolean {
  return (result.keyContradictions?.length ?? 0) > 0;
}

function dataQualityOk(result: AnalysisResult): boolean {
  if (!result.dataQualityContext) return true; // no quality data = no restriction
  return result.dataQualityContext.primaryData.status === "GOOD";
}

// ── Main builder ─────────────────────────────────────────────────

export function buildMarketRegime(result: AnalysisResult): MarketRegimeContext {
  const dir = dirBias(result);
  const evidences: string[] = [];
  const missingInfo: string[] = [];
  const confirmationConditions: string[] = [];
  const invalidationConditions: string[] = [];
  const exhaustionSignals: ExhaustionSignal[] = [];

  // ── Regime classification ──
  let regime: RegimeType = "UNCONFIRMED";
  let marketPhase: MarketPhase = "UNKNOWN";

  if (isRange(result)) {
    regime = "RANGE";
    marketPhase = "RANGE_BALANCE";
    evidences.push("HTF structure is range");
    confirmationConditions.push("Clear breakout or breakdown from range boundaries");
    invalidationConditions.push("Continued oscillation within range");
  } else if (dir === "bullish") {
    const htfAligned = hasHtfAlignment(result, "bullish");
    const mtfA = mtfAligned(result, "bullish");
    const contra = hasContraDirectionMtf(result, "bullish");
    const volExp = hasVolatilityExpansion(result);

    if (htfAligned && mtfA) {
      regime = "TRENDING_BULLISH";
      marketPhase = "TREND_MATURE";
      evidences.push("HTF bullish structure with MTF alignment");
      confirmationConditions.push("Continued HTF bullish structure", "Maintained MTF alignment");
    } else if (htfAligned && !mtfA) {
      regime = "TRENDING_BULLISH";
      marketPhase = "LATE_TREND";
      evidences.push("HTF bullish but MTF not aligned");
      confirmationConditions.push("MTF re-alignment bullish");
    } else if (volExp) {
      regime = "BREAKOUT_DEVELOPING";
      marketPhase = "BREAKOUT_ATTEMPT";
      evidences.push("Volatility expansion detected with bullish bias");
      confirmationConditions.push("Breakout confirmation with displacement");
    } else {
      regime = "TRENDING_BULLISH";
      marketPhase = "EARLY_TREND";
      evidences.push("Bullish bias without full HTF/MTF alignment");
      confirmationConditions.push("HTF structure confirmation", "MTF alignment");
    }

    if (contra) {
      marketPhase = "CORRECTION";
      regime = "REVERSAL_DEVELOPING";
      evidences.push("Counter-trend MTF evidence detected");
    }
  } else if (dir === "bearish") {
    const htfAligned = hasHtfAlignment(result, "bearish");
    const mtfA = mtfAligned(result, "bearish");
    const contra = hasContraDirectionMtf(result, "bearish");
    const volExp = hasVolatilityExpansion(result);

    if (htfAligned && mtfA) {
      regime = "TRENDING_BEARISH";
      marketPhase = "TREND_MATURE";
      evidences.push("HTF bearish structure with MTF alignment");
      confirmationConditions.push("Continued HTF bearish structure", "Maintained MTF alignment");
    } else if (htfAligned && !mtfA) {
      regime = "TRENDING_BEARISH";
      marketPhase = "LATE_TREND";
      evidences.push("HTF bearish but MTF not aligned");
      confirmationConditions.push("MTF re-alignment bearish");
    } else if (volExp) {
      regime = "BREAKDOWN_DEVELOPING";
      marketPhase = "BREAKDOWN_ATTEMPT";
      evidences.push("Volatility expansion detected with bearish bias");
      confirmationConditions.push("Breakdown confirmation with displacement");
    } else {
      regime = "TRENDING_BEARISH";
      marketPhase = "EARLY_TREND";
      evidences.push("Bearish bias without full HTF/MTF alignment");
      confirmationConditions.push("HTF structure confirmation", "MTF alignment");
    }

    if (contra) {
      marketPhase = "CORRECTION";
      regime = "REVERSAL_DEVELOPING";
      evidences.push("Counter-trend MTF evidence detected");
    }
  }

  // ── High/Low volatility override ──
  if (hasVolatilityExpansion(result)) {
    evidences.push("Market regime overlay: volatility expansion");
  }

  // ── Continuation Quality ──
  let continuationQuality: ContinuationQuality = "UNKNOWN";

  if (dir === "neutral") {
    continuationQuality = "UNKNOWN";
    missingInfo.push("No directional structure to evaluate continuation");
  } else {
    let score = 0;
    if (hasHtfAlignment(result, dir)) score += 2;
    if (mtfAligned(result, dir)) score += 2;
    if (result.marketRegime?.regime === "TRENDING" || regime === "TRENDING_BULLISH" || regime === "TRENDING_BEARISH") score += 1;
    if (hasContraDirectionMtf(result, dir)) score -= 2;
    if (hasMaterialContradiction(result)) score -= 1;
    if (!dataQualityOk(result)) score -= 1;

    if (score >= 4) continuationQuality = "STRONG";
    else if (score >= 3) continuationQuality = "HEALTHY";
    else if (score >= 1) continuationQuality = "DEVELOPING";
    else if (score >= 0) continuationQuality = "WEAK";
    else continuationQuality = "EXHAUSTED";
  }

  // ── Exhaustion signals ──
  if (continuationQuality === "EXHAUSTED" || continuationQuality === "WEAK") {
    if ((dir === "bullish" || dir === "bearish") && hasContraDirectionMtf(result, dir)) {
      exhaustionSignals.push({ signal: "Counter-trend MTF evidence", severity: "strong", source: "MTF" });
    }
    if (hasMaterialContradiction(result)) {
      exhaustionSignals.push({ signal: "Material cross-layer contradictions", severity: "moderate", source: "contradictions" });
    }
    evidences.push("Continuation quality degraded — exhaustion signals present");
  }

  if (hasVolatilityExpansion(result) && (dir === "bullish" || dir === "bearish")) {
    exhaustionSignals.push({ signal: "Volatility expansion during trend", severity: "weak", source: "market regime" });
  }

  // ── Trend Transition ──
  let transitionType: TransitionType = "UNKNOWN";
  let transitionConfidence: TrendTransition["confidenceLevel"] = "not_applicable";

  if (dir === "neutral") {
    transitionType = "RANGE_TRANSITION";
    transitionConfidence = "absent";
  } else {
    if (continuationQuality === "STRONG" || continuationQuality === "HEALTHY") {
      transitionType = "CONTINUATION";
      transitionConfidence = "confirmed";
    } else if (continuationQuality === "DEVELOPING") {
      transitionType = "HEALTHY_CORRECTION";
      transitionConfidence = "developing";
    } else if (continuationQuality === "WEAK") {
      transitionType = "DEEP_CORRECTION";
      transitionConfidence = "developing";
    } else if (continuationQuality === "EXHAUSTED") {
      transitionType = "REVERSAL_ATTEMPT";
      transitionConfidence = "absent";
    }
  }

  const trendTransition: TrendTransition = {
    currentTrend: dir,
    transitionType,
    confidenceLevel: transitionConfidence,
    evidence: [],
    confirmationConditions: [...confirmationConditions],
    invalidationConditions: [...invalidationConditions],
  };

  // ── Primary / Alternate scenario ──
  let primaryScenario = "";
  let alternateScenario = "";

  if (dir === "neutral") {
    primaryScenario = "Range — no clear directional bias";
    alternateScenario = "Breakout or breakdown developing";
    confirmationConditions.push("Clear breakout/breakdown with displacement");
  } else {
    const dirLabel = dir === "bullish" ? "bullish" : "bearish";
    if (transitionType === "CONTINUATION") {
      primaryScenario = `${dirLabel} continuation — structure intact, MTF aligned`;
      alternateScenario = `${dirLabel} correction if near-term resistance/support appears`;
    } else if (transitionType === "HEALTHY_CORRECTION" || transitionType === "DEEP_CORRECTION") {
      primaryScenario = `${dirLabel} correction — continuation intact but weakening`;
      alternateScenario = `Potential reversal if structural support/resistance breaks`;
      confirmationConditions.push("Successful hold of structural level");
      invalidationConditions.push("Break of protected swing");
    } else if (transitionType === "REVERSAL_ATTEMPT") {
      primaryScenario = `Reversal risk elevated — ${dirLabel} continuation exhausted`;
      alternateScenario = `Fresh ${dirLabel} continuation if structural level holds`;
      confirmationConditions.push("HTF structural break against current trend");
      invalidationConditions.push("Recovery of structural support/resistance");
    } else {
      primaryScenario = `${dirLabel} bias — regime unclear`;
      alternateScenario = "Regime clarification pending";
    }
  }

  // ── Missing information ──
  if (!result.htfAlignment) missingInfo.push("HTF alignment unavailable");
  if (!result.mtfSummary) missingInfo.push("MTF summary unavailable");
  if (!result.marketRegime) missingInfo.push("Market regime unavailable");
  if (!result.keyContradictions) missingInfo.push("Contradiction analysis unavailable");
  if (!dataQualityOk(result)) missingInfo.push("Market data quality degraded");

  // ── Invalidation from keyLevels ──
  if (result.keyLevels?.invalidation) {
    invalidationConditions.push(`Price reaching invalidation level (${result.keyLevels.invalidation})`);
  }

  return {
    regime,
    marketPhase,
    currentDirection: dir,
    continuationQuality,
    exhaustionSignals,
    trendTransition,
    primaryScenario,
    alternateScenario,
    confirmationConditions,
    invalidationConditions,
    missingInformation: missingInfo,
    evidences,
  };
}
