/**
 * Phase 28 — FUNDAMENTAL THESIS.
 *
 * Pure derivation from existing engine output fields. This module evaluates
 * fundamental, macro, catalyst, and cross-asset context — and determines
 * whether they align with, contradict, or are neutral to the technical thesis.
 *
 * Unavailable fundamentals = NEUTRAL (never bearish/bullish by absence).
 * This module does NOT fabricate fundamental data.
 * This module does NOT modify the decision engine.
 */

import type { AnalysisResult } from "@/types/analysis";

// ── Types ────────────────────────────────────────────────────────

export type FundamentalAlignment =
  | "STRONGLY_ALIGNED"
  | "ALIGNED"
  | "MIXED"
  | "CONFLICTING"
  | "FUNDAMENTAL_UNAVAILABLE"
  | "TECHNICAL_UNAVAILABLE";

export type FundamentalDirection = "supportive" | "conflicting" | "neutral" | "unavailable";

export type EventRiskLevel = "LOW" | "MODERATE" | "ELEVATED" | "HIGH" | "UNKNOWN";

export interface FundamentalEvidence {
  source: string;
  direction: FundamentalDirection;
  explanation: string;
  quality?: "verified" | "degraded" | "insufficient" | "stale" | "unavailable";
}

export interface CatalystInfo {
  description: string;
  relevance: "high" | "moderate" | "low";
  direction: "potentially_bullish" | "potentially_bearish" | "neutral" | "unknown";
  volatilityImpact: "high" | "moderate" | "low" | "unknown";
}

export interface FundamentalThesis {
  /** Technical direction from the engine. */
  technicalDirection: "bullish" | "bearish" | "neutral";
  /** Overall fundamental/macro alignment with technicals. */
  alignment: FundamentalAlignment;
  /** Fundamental evidence items. */
  fundamentalEvidence: FundamentalEvidence[];
  /** Macro/cross-asset evidence items. */
  macroEvidence: FundamentalEvidence[];
  /** Positioning evidence. */
  positioningEvidence: FundamentalEvidence[];
  /** Upcoming/recent catalysts. */
  catalysts: CatalystInfo[];
  /** Event risk level. */
  eventRisk: EventRiskLevel;
  /** Why alignment is what it is. */
  alignmentReason: string;
  /** Missing fundamental information. */
  missingInformation: string[];
  /** Summary for analyst. */
  analystSummary: string;
}

// ── Helpers ──────────────────────────────────────────────────────

function dirBias(result: AnalysisResult): "bullish" | "bearish" | "neutral" {
  if (result.bias === "Bullish") return "bullish";
  if (result.bias === "Bearish") return "bearish";
  return "neutral";
}

function evaluateFundamentals(result: AnalysisResult, techDir: "bullish" | "bearish" | "neutral"): FundamentalEvidence[] {
  const evidence: FundamentalEvidence[] = [];

  // Treasury context
  if (result.treasuryContext?.available) {
    const freshness = result.treasuryContext.freshness;
    const quality = freshness === "FRESH" ? "verified" : freshness === "STALE" ? "stale" : undefined;
    evidence.push({
      source: "US Treasury yields",
      direction: "neutral", // Treasury alone is not directional per engine invariant
      explanation: "Treasury yield context available — informational only",
      quality,
    });
  } else {
    evidence.push({ source: "US Treasury yields", direction: "unavailable", explanation: "Treasury data not available" });
  }

  // COT context
  if (result.cotContext?.available) {
    const freshness = result.cotContext.freshness;
    const quality = freshness === "FRESH" ? "verified" : freshness === "STALE" ? "stale" : undefined;
    evidence.push({
      source: "CFTC COT positioning",
      direction: "neutral", // COT alone does not determine direction
      explanation: "Commitment of Traders positioning available — contextual",
      quality,
    });
  } else {
    evidence.push({ source: "CFTC COT positioning", direction: "unavailable", explanation: "COT data not available for this instrument" });
  }

  // EIA context
  if (result.eiaContext?.available) {
    const freshness = result.eiaContext.freshness;
    const quality = freshness === "FRESH" ? "verified" : freshness === "STALE" ? "stale" : undefined;
    evidence.push({
      source: "EIA inventory",
      direction: "neutral",
      explanation: "Energy inventory data available — contextual for commodities",
      quality,
    });
  }

  // Fundamental data
  if (result.fundamentalData) {
    evidence.push({
      source: "Fundamental intelligence",
      direction: "neutral",
      explanation: "Fundamental data available",
      quality: "verified",
    });
  }

  return evidence;
}

function evaluateMacro(result: AnalysisResult, _techDir: "bullish" | "bearish" | "neutral"): FundamentalEvidence[] {
  const evidence: FundamentalEvidence[] = [];

  if (result.macroData) {
    evidence.push({
      source: "Macro intelligence",
      direction: "neutral",
      explanation: "Macro context available — informational",
      quality: "verified",
    });
  }

  if (result.sentimentData) {
    evidence.push({
      source: "Sentiment intelligence",
      direction: "neutral",
      explanation: "Sentiment data available — informational",
      quality: "verified",
    });
  }

  if (result.derivativesData) {
    evidence.push({
      source: "Derivatives context",
      direction: "neutral",
      explanation: "Derivatives data available — contextual",
      quality: "verified",
    });
  }

  if (result.calendarData) {
    evidence.push({
      source: "Economic calendar",
      direction: "neutral",
      explanation: "Calendar events available — informational",
      quality: "verified",
    });
  }

  if (evidence.length === 0) {
    evidence.push({ source: "Macro/cross-asset", direction: "unavailable", explanation: "No macro data available" });
  }

  return evidence;
}

function evaluatePositioning(result: AnalysisResult): FundamentalEvidence[] {
  const evidence: FundamentalEvidence[] = [];

  if (result.executionContext?.available) {
    evidence.push({
      source: "OKX order book",
      direction: "neutral",
      explanation: "Order-book data available — execution context",
      quality: result.executionContext.freshness === "FRESH" ? "verified" : "stale",
    });
  } else {
    evidence.push({ source: "Order book", direction: "unavailable", explanation: "Order-book data unavailable" });
  }

  return evidence;
}

function detectCatalysts(result: AnalysisResult): CatalystInfo[] {
  const catalysts: CatalystInfo[] = [];

  if (result.calendarData) {
    // Calendar data exists — represent as contextual catalyst
    catalysts.push({
      description: "Economic calendar events available",
      relevance: "moderate",
      direction: "unknown",
      volatilityImpact: "moderate",
    });
  }

  return catalysts;
}

function assessEventRisk(catalysts: CatalystInfo[], result: AnalysisResult): EventRiskLevel {
  if (catalysts.length === 0) return "UNKNOWN";

  const hasHighImpact = catalysts.some((c) => c.volatilityImpact === "high");
  if (hasHighImpact) return "HIGH";

  const hasModerateImpact = catalysts.some((c) => c.volatilityImpact === "moderate");
  if (hasModerateImpact) return "MODERATE";

  return "LOW";
}

function computeAlignment(
  fundamentalEvidence: FundamentalEvidence[],
  macroEvidence: FundamentalEvidence[],
  techDir: "bullish" | "bearish" | "neutral",
): { alignment: FundamentalAlignment; reason: string } {
  if (techDir === "neutral") {
    return { alignment: "TECHNICAL_UNAVAILABLE", reason: "No directional technical thesis to align with" };
  }

  const allEvidence = [...fundamentalEvidence, ...macroEvidence];
  const unavailable = allEvidence.filter((e) => e.direction === "unavailable");
  const available = allEvidence.filter((e) => e.direction !== "unavailable");

  if (unavailable.length === allEvidence.length) {
    return { alignment: "FUNDAMENTAL_UNAVAILABLE", reason: "All fundamental/macro providers unavailable" };
  }

  if (available.length === 0) {
    return { alignment: "FUNDAMENTAL_UNAVAILABLE", reason: "No fundamental/macro data available" };
  }

  // All available evidence is neutral (by design — fundamentals don't create directional evidence)
  // Alignment is therefore determined by whether technical direction has support
  const neutral = available.filter((e) => e.direction === "neutral");
  const supportive = available.filter((e) => e.direction === "supportive");
  const conflicting = available.filter((e) => e.direction === "conflicting");

  if (conflicting.length > 0 && supportive.length === 0) {
    return { alignment: "CONFLICTING", reason: "Fundamental evidence conflicts with technical thesis" };
  }
  if (conflicting.length > 0 && supportive.length > 0) {
    return { alignment: "MIXED", reason: "Mixed fundamental signals — some supportive, some conflicting" };
  }
  if (supportive.length > 0 && neutral.length === 0) {
    return { alignment: "STRONGLY_ALIGNED", reason: "Fundamental evidence supports technical thesis" };
  }
  if (supportive.length > 0) {
    return { alignment: "ALIGNED", reason: "Fundamentals available with partial technical alignment" };
  }

  return { alignment: "FUNDAMENTAL_UNAVAILABLE", reason: "Fundamentals available but neutral — no directional confirmation" };
}

// ── Main builder ─────────────────────────────────────────────────

export function buildFundamentalThesis(result: AnalysisResult): FundamentalThesis {
  const techDir = dirBias(result);

  const fundamentalEvidence = evaluateFundamentals(result, techDir);
  const macroEvidence = evaluateMacro(result, techDir);
  const positioningEvidence = evaluatePositioning(result);
  const catalysts = detectCatalysts(result);
  const eventRisk = assessEventRisk(catalysts, result);

  const { alignment, reason } = computeAlignment(fundamentalEvidence, macroEvidence, techDir);

  const missingInfo: string[] = [];
  if (!result.treasuryContext) missingInfo.push("Treasury yield data");
  if (!result.cotContext) missingInfo.push("COT positioning data");
  if (!result.fundamentalData) missingInfo.push("Fundamental intelligence");
  if (!result.macroData) missingInfo.push("Macro intelligence");
  if (!result.sentimentData) missingInfo.push("Sentiment data");
  if (!result.derivativesData) missingInfo.push("Derivatives data");
  if (!result.calendarData) missingInfo.push("Economic calendar");

  let summary = "";
  if (alignment === "FUNDAMENTAL_UNAVAILABLE") {
    summary = "Fundamental/macro context unavailable — thesis is technical-led";
  } else if (alignment === "STRONGLY_ALIGNED") {
    summary = "Fundamentals support the technical thesis";
  } else if (alignment === "ALIGNED") {
    summary = "Fundamentals partially support the technical thesis";
  } else if (alignment === "MIXED") {
    summary = "Mixed fundamental signals — thesis requires technical confirmation";
  } else if (alignment === "CONFLICTING") {
    summary = "Fundamentals conflict with technical thesis — caution warranted";
  } else {
    summary = "Fundamental alignment undetermined";
  }

  return {
    technicalDirection: techDir,
    alignment,
    fundamentalEvidence,
    macroEvidence,
    positioningEvidence,
    catalysts,
    eventRisk,
    alignmentReason: reason,
    missingInformation: missingInfo,
    analystSummary: summary,
  };
}
