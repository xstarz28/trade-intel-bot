/**
 * Phase 109 — Decision Support & Evidence Quality
 *
 * Pure deterministic functions that derive decision-support context
 * from existing intelligence data.
 *
 * NO auto-execution.
 * NO probability claims.
 * NO fabricated data.
 * NO duplicate intelligence calculations.
 */

import type { PositionIntelligence, EvidenceItem } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type EvidenceClassification = "SUPPORTING" | "CONFLICTING" | "NEUTRAL" | "UNAVAILABLE";
export type ThesisTransition = "STABLE" | "IMPROVING" | "DETERIORATING" | "FLIPPED" | "INSUFFICIENT_DATA";
export type InvalidationStatus = "NOT_APPROACHING" | "APPROACHING" | "TRIGGERED" | "UNAVAILABLE";
export type WatchPriority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type DimensionAvailability = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE" | "INSUFFICIENT";

export interface EvidenceClassified {
  category: string;
  description: string;
  classification: EvidenceClassification;
  strength: "STRONG" | "MODERATE" | "WEAK";
  sourceDimension: string;
}

export interface InvalidationConditionDetailed {
  description: string;
  sourceDimension: string;
  currentState: string;
  invalidatingState: string;
  status: InvalidationStatus;
  /** Undefined when the distance could not be computed. */
  distancePct?: number;
}

export interface WatchItem {
  priority: WatchPriority;
  category: string;
  description: string;
  sourceDimension: string;
}

export interface ThesisChange {
  field: string;
  previous: string;
  current: string;
}

export interface DimensionStatus {
  dimension: string;
  status: DimensionAvailability;
  source: string;
}

export interface PositionDecisionSupport {
  positionId: string;
  instrument: string;
  side: string;
  thesis: string;
  thesisHealth: string;
  score: number;
  evidenceClassified: EvidenceClassified[];
  supportingEvidence: EvidenceClassified[];
  conflictingEvidence: EvidenceClassified[];
  neutralEvidence: EvidenceClassified[];
  invalidationConditions: InvalidationConditionDetailed[];
  watchItems: WatchItem[];
  dataQuality: string;
  availableDimensions: DimensionStatus[];
  unavailableDimensions: DimensionStatus[];
  marketContext: string;
  trendContext: string;
  generatedAt: number;
}

export interface DecisionSummary {
  thesis: string;
  thesisHealth: string;
  score: number;
  supportingCount: number;
  conflictingCount: number;
  neutralCount: number;
  highPriorityWatchCount: number;
  dataQuality: string;
  overallAssessment: string;
}

// ═══════════════════════════════════════════════════════════════
// THESIS SEVERITY RANKING (for transition detection)
// ═══════════════════════════════════════════════════════════════

const THESIS_RANK: Record<string, number> = {
  INVALIDATED: 7,
  SEVERELY_DETERIORATING: 6,
  DETERIORATING: 5,
  CAUTION: 4,
  STABLE: 3,
  HEALTHY: 2,
  INSUFFICIENT_DATA: 1,
  UNKNOWN: 0,
};

// ═══════════════════════════════════════════════════════════════
// CORE BUILDERS
// ═══════════════════════════════════════════════════════════════

/**
 * Build complete decision support for a single position.
 * Pure function — only reads existing intelligence, never computes new intelligence.
 */
export function buildDecisionSupport(
  positionId: string,
  intel: PositionIntelligence,
  now: number = Date.now(),
): PositionDecisionSupport {
  const evidenceClassified = classifyAllEvidence(intel);
  const supporting = evidenceClassified.filter((e) => e.classification === "SUPPORTING");
  const conflicting = evidenceClassified.filter((e) => e.classification === "CONFLICTING");
  const neutral = evidenceClassified.filter((e) => e.classification === "NEUTRAL");

  const invalidation = deriveInvalidationConditions(intel);
  const watchItems = deriveWatchItems(intel, evidenceClassified);
  const { available, unavailable } = deriveDimensionAvailability(intel);

  return {
    positionId,
    instrument: intel.instrument,
    side: intel.side,
    thesis: intel.thesisHealth,
    thesisHealth: intel.thesisHealth,
    score: intel.thesisHealthScore,
    evidenceClassified,
    supportingEvidence: supporting,
    conflictingEvidence: conflicting,
    neutralEvidence: neutral,
    invalidationConditions: invalidation,
    watchItems,
    dataQuality: intel.dataQuality,
    availableDimensions: available,
    unavailableDimensions: unavailable,
    marketContext: intel.shortTermContext,
    trendContext: intel.mediumTermContext,
    generatedAt: now,
  };
}

/**
 * Classify a single evidence item relative to position side.
 * Evidence is classified deterministically based on position direction.
 */
export function classifyEvidence(
  evidence: EvidenceItem,
  side: string,
): EvidenceClassified {

  // Map raw direction to side-aware classification
  let classification: EvidenceClassification;
  let sourceDimension: string;

  switch (evidence.direction) {
    case "supporting":
      classification = "SUPPORTING";
      sourceDimension = evidence.category;
      break;
    case "conflicting":
      classification = "CONFLICTING";
      sourceDimension = evidence.category;
      break;
    case "neutral":
      classification = "NEUTRAL";
      sourceDimension = evidence.category;
      break;
    default:
      classification = "UNAVAILABLE";
      sourceDimension = evidence.category;
      break;
  }

  return {
    category: evidence.category,
    description: evidence.description,
    classification,
    strength: evidence.strength,
    sourceDimension,
  };
}

/**
 * Classify all evidence items from position intelligence.
 */
export function classifyAllEvidence(intel: PositionIntelligence): EvidenceClassified[] {
  return intel.evidence.map((e) => classifyEvidence(e, intel.side));
}

// ═══════════════════════════════════════════════════════════════
// THESIS CHANGE DETECTION
// ═══════════════════════════════════════════════════════════════

/**
 * Detect thesis transition between previous and current intelligence state.
 * Pure function — compares two states deterministically.
 */
export function detectThesisTransition(
  previousThesis: string | undefined,
  currentThesis: string,
): ThesisTransition {
  if (!previousThesis) return "INSUFFICIENT_DATA";

  const prevRank = THESIS_RANK[previousThesis] ?? 0;
  const currRank = THESIS_RANK[currentThesis] ?? 0;

  if (prevRank === currRank) return "STABLE";

  // Check for flip (e.g., HEALTHY → DETERIORATING involves a skip)
  const prevIsPositive = prevRank <= 3; // HEALTHY, STABLE
  const currIsNegative = currRank >= 4; // CAUTION+
  const prevIsNegative = prevRank >= 4;
  const currIsPositive = currRank <= 3;

  if ((prevIsPositive && currIsNegative) || (prevIsNegative && currIsPositive)) {
    // FLIP only for significant reversals across the HEALTHY ↔ DETERIORATING boundary
    if (prevRank <= 2 && currRank >= 5) return "FLIPPED";
    if (prevRank >= 5 && currRank <= 2) return "FLIPPED";
  }

  if (currRank > prevRank) return "DETERIORATING";
  if (currRank < prevRank) return "IMPROVING";

  return "STABLE";
}

/**
 * Build deterministic change list between two intelligence snapshots.
 * Only reports fields that actually changed.
 */
export function buildDecisionChanges(
  previous: PositionIntelligence | undefined,
  current: PositionIntelligence,
): ThesisChange[] {
  if (!previous) return [];

  const changes: ThesisChange[] = [];

  if (previous.thesisHealth !== current.thesisHealth) {
    changes.push({ field: "thesisHealth", previous: previous.thesisHealth, current: current.thesisHealth });
  }

  if (previous.thesisHealthScore !== current.thesisHealthScore) {
    changes.push({ field: "thesisHealthScore", previous: String(previous.thesisHealthScore), current: String(current.thesisHealthScore) });
  }

  if (previous.h1Analysis?.trend !== current.h1Analysis?.trend) {
    changes.push({ field: "h1Trend", previous: previous.h1Analysis?.trend ?? "UNKNOWN", current: current.h1Analysis?.trend ?? "UNKNOWN" });
  }

  if (previous.m15Analysis?.trend !== current.m15Analysis?.trend) {
    changes.push({ field: "m15Trend", previous: previous.m15Analysis?.trend ?? "UNKNOWN", current: current.m15Analysis?.trend ?? "UNKNOWN" });
  }

  if (previous.m5Analysis?.trend !== current.m5Analysis?.trend) {
    changes.push({ field: "m5Trend", previous: previous.m5Analysis?.trend ?? "UNKNOWN", current: current.m5Analysis?.trend ?? "UNKNOWN" });
  }

  if (previous.volatilityContext !== current.volatilityContext) {
    changes.push({ field: "volatility", previous: previous.volatilityContext, current: current.volatilityContext });
  }

  if (previous.confidence !== current.confidence) {
    changes.push({ field: "confidence", previous: previous.confidence, current: current.confidence });
  }

  if (previous.dataQuality !== current.dataQuality) {
    changes.push({ field: "dataQuality", previous: previous.dataQuality, current: current.dataQuality });
  }

  const prevSupporting = previous.evidence.filter((e) => e.direction === "supporting").length;
  const currSupporting = current.evidence.filter((e) => e.direction === "supporting").length;
  if (prevSupporting !== currSupporting) {
    changes.push({ field: "supportingEvidence", previous: String(prevSupporting), current: String(currSupporting) });
  }

  const prevConflicting = previous.evidence.filter((e) => e.direction === "conflicting").length;
  const currConflicting = current.evidence.filter((e) => e.direction === "conflicting").length;
  if (prevConflicting !== currConflicting) {
    changes.push({ field: "conflictingEvidence", previous: String(prevConflicting), current: String(currConflicting) });
  }

  return changes;
}

// ═══════════════════════════════════════════════════════════════
// INVALIDATION MODEL
// ═══════════════════════════════════════════════════════════════

/**
 * Derive detailed invalidation conditions from intelligence.
 * Adds status classification to each condition.
 */
export function deriveInvalidationConditions(
  intel: PositionIntelligence,
): InvalidationConditionDetailed[] {
  return intel.invalidationConditions.map((ic) => {
    let status: InvalidationStatus;
    if (ic.distancePct === 0 && ic.approaching) {
      status = "TRIGGERED";
    } else if (ic.approaching) {
      status = "APPROACHING";
    } else {
      status = "NOT_APPROACHING";
    }

    return {
      description: ic.description,
      sourceDimension: "PROTECTION",
      currentState:
        ic.distancePct === undefined
          ? "Distance: unavailable"
          : `Distance: ${ic.distancePct.toFixed(2)}%`,
      invalidatingState: ic.description,
      status,
      distancePct: ic.distancePct,
    };
  });
}

// ═══════════════════════════════════════════════════════════════
// WATCH ITEMS
// ═══════════════════════════════════════════════════════════════

/**
 * Derive prioritized watch items from intelligence and classified evidence.
 * Pure function — deterministic prioritization.
 */
export function deriveWatchItems(
  intel: PositionIntelligence,
  evidenceClassified: EvidenceClassified[],
): WatchItem[] {
  const items: WatchItem[] = [];

  // Timeframe disagreement
  const h1 = intel.h1Analysis?.trend;
  const m15 = intel.m15Analysis?.trend;
  const m5 = intel.m5Analysis?.trend;
  if (h1 && m15 && m5 && h1 !== "UNKNOWN" && m15 !== "UNKNOWN" && m5 !== "UNKNOWN") {
    if (h1 !== m15 || m15 !== m5) {
      items.push({
        priority: "MEDIUM",
        category: "TIMEFRAME_DISAGREEMENT",
        description: `Timeframes disagree: H1=${h1}, M15=${m15}, M5=${m5}`,
        sourceDimension: "MTF",
      });
    }
  }

  // Worsening thesis health
  if (intel.thesisHealth === "DETERIORATING" || intel.thesisHealth === "SEVERELY_DETERIORATING") {
    items.push({
      priority: intel.thesisHealth === "SEVERELY_DETERIORATING" ? "CRITICAL" : "HIGH",
      category: "THESIS_HEALTH",
      description: `Thesis health: ${intel.thesisHealth.replace(/_/g, " ")}`,
      sourceDimension: "THESIS",
    });
  }

  // Conflicting evidence
  const conflictingCount = evidenceClassified.filter((e) => e.classification === "CONFLICTING").length;
  if (conflictingCount >= 2) {
    items.push({
      priority: conflictingCount >= 3 ? "HIGH" : "MEDIUM",
      category: "CONFLICTING_EVIDENCE",
      description: `${conflictingCount} conflicting evidence signals detected`,
      sourceDimension: "EVIDENCE",
    });
  }

  // Unavailable critical data
  if (intel.dataQuality === "UNAVAILABLE" || intel.dataQuality === "INSUFFICIENT_EVIDENCE") {
    items.push({
      priority: "HIGH",
      category: "DATA_QUALITY",
      description: `Data quality: ${intel.dataQuality.replace(/_/g, " ")}`,
      sourceDimension: "DATA",
    });
  }

  // Abnormal volatility
  if (intel.volatilityContext.includes("elevated") || intel.volatilityContext.includes("Elevated")) {
    items.push({
      priority: "MEDIUM",
      category: "VOLATILITY",
      description: intel.volatilityContext,
      sourceDimension: "VOLATILITY",
    });
  }

  // Approaching invalidation
  const approachingInvalidations = intel.invalidationConditions.filter((ic) => ic.approaching);
  if (approachingInvalidations.length > 0) {
    items.push({
      priority: "HIGH",
      category: "INVALIDATION",
      description: `${approachingInvalidations.length} invalidation condition(s) approaching`,
      sourceDimension: "PROTECTION",
    });
  }

  // Structure broken
  const structureEvidence = evidenceClassified.find(
    (e) => e.sourceDimension === "STRUCTURE" && e.classification === "CONFLICTING",
  );
  if (structureEvidence) {
    items.push({
      priority: "HIGH",
      category: "STRUCTURE_BREAK",
      description: structureEvidence.description,
      sourceDimension: "STRUCTURE",
    });
  }

  // Sort by priority
  const priorityOrder: Record<WatchPriority, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return items;
}

// ═══════════════════════════════════════════════════════════════
// DIMENSION AVAILABILITY
// ═══════════════════════════════════════════════════════════════

/**
 * Derive dimension availability from intelligence data.
 * Explicitly surfaces what is available vs unavailable.
 */
export function deriveDimensionAvailability(
  intel: PositionIntelligence,
): { available: DimensionStatus[]; unavailable: DimensionStatus[] } {
  const available: DimensionStatus[] = [];
  const unavailable: DimensionStatus[] = [];

  // Price/OHLCV
  if (intel.currentPrice > 0) {
    available.push({ dimension: "PRICE", status: "AVAILABLE", source: "LIVE" });
  } else {
    unavailable.push({ dimension: "PRICE", status: "UNAVAILABLE", source: "LIVE" });
  }

  // H1 timeframe
  if (intel.h1Analysis) {
    available.push({ dimension: "H1_TREND", status: "AVAILABLE", source: "OHLCV" });
  } else {
    unavailable.push({ dimension: "H1_TREND", status: "UNAVAILABLE", source: "OHLCV" });
  }

  // M15 timeframe
  if (intel.m15Analysis) {
    available.push({ dimension: "M15_TREND", status: "AVAILABLE", source: "OHLCV" });
  } else {
    unavailable.push({ dimension: "M15_TREND", status: "UNAVAILABLE", source: "OHLCV" });
  }

  // M5 timeframe
  if (intel.m5Analysis) {
    available.push({ dimension: "M5_TREND", status: "AVAILABLE", source: "OHLCV" });
  } else {
    unavailable.push({ dimension: "M5_TREND", status: "UNAVAILABLE", source: "OHLCV" });
  }

  // Evidence
  if (intel.evidence.length > 0) {
    available.push({ dimension: "TECHNICAL_EVIDENCE", status: "AVAILABLE", source: "ANALYSIS" });
  } else {
    unavailable.push({ dimension: "TECHNICAL_EVIDENCE", status: "INSUFFICIENT", source: "ANALYSIS" });
  }

  // Invalidation
  available.push({
    dimension: "INVALIDATION",
    status: intel.invalidationConditions.length > 0 ? "AVAILABLE" : "PARTIAL",
    source: "PROTECTION",
  });

  // News stance — available if intelligence engine provided it
  // PositionIntelligence does not carry news/macro fields directly;
  // those come from the multi-dimensional intelligence overlay.
  // We surface them as PARTIAL/UNAVAILABLE based on dataQuality.
  const hasNews = intel.dataQuality !== "UNAVAILABLE" && intel.dataQuality !== "INSUFFICIENT_EVIDENCE";
  if (hasNews) {
    available.push({ dimension: "NEWS", status: "PARTIAL", source: "INTELLIGENCE" });
  } else {
    unavailable.push({ dimension: "NEWS", status: "UNAVAILABLE", source: "NEWS_PROVIDER" });
  }

  // Macro
  if (hasNews) {
    available.push({ dimension: "MACRO", status: "PARTIAL", source: "INTELLIGENCE" });
  } else {
    unavailable.push({ dimension: "MACRO", status: "UNAVAILABLE", source: "MACRO_PROVIDER" });
  }

  return { available, unavailable };
}

// ═══════════════════════════════════════════════════════════════
// SUMMARY
// ═══════════════════════════════════════════════════════════════

/**
 * Get a concise decision-support summary.
 */
export function getDecisionSupportSummary(
  ds: PositionDecisionSupport,
): DecisionSummary {
  const highPriority = ds.watchItems.filter(
    (w) => w.priority === "CRITICAL" || w.priority === "HIGH",
  ).length;

  let overallAssessment: string;
  if (ds.dataQuality === "UNAVAILABLE" || ds.dataQuality === "INSUFFICIENT_EVIDENCE") {
    overallAssessment = "INSUFFICIENT_DATA";
  } else if (ds.conflictingEvidence.length > ds.supportingEvidence.length) {
    overallAssessment = "COUNT_CONFLICTING";
  } else if (ds.supportingEvidence.length > ds.conflictingEvidence.length) {
    overallAssessment = "COUNT_SUPPORTING";
  } else {
    overallAssessment = "MIXED_EVIDENCE";
  }

  return {
    thesis: ds.thesis,
    thesisHealth: ds.thesisHealth,
    score: ds.score,
    supportingCount: ds.supportingEvidence.length,
    conflictingCount: ds.conflictingEvidence.length,
    neutralCount: ds.neutralEvidence.length,
    highPriorityWatchCount: highPriority,
    dataQuality: ds.dataQuality,
    overallAssessment,
  };
}

// ═══════════════════════════════════════════════════════════════
// PORTFOLIO DECISION CONTEXT
// ═══════════════════════════════════════════════════════════════

export interface PortfolioDecisionContext {
  dominantThesis: string;
  thesisConflicts: string[];
  alignedPositions: string[];
  conflictingPositions: string[];
  sharedInstruments: string[];
  highestPriorityWatchItems: WatchItem[];
  dataQualityWarnings: string[];
  positionCount: number;
}

/**
 * Build portfolio-level decision context from existing PortfolioIntelligence.
 * Pure function — reuses existing portfolio data, no new calculations.
 */
export function buildPortfolioDecisionContext(
  portfolioIntel: PortfolioIntelligence,
): PortfolioDecisionContext {
  const thesisConflicts = (portfolioIntel.conflicts ?? []).map(
    (c) => c.description ?? `${c.positionA} vs ${c.positionB}`,
  );

  const alignedPositions: string[] = [];
  const conflictingPositions: string[] = [];

  for (const alignment of portfolioIntel.alignments ?? []) {
    for (const inst of alignment.instruments) {
      if (!alignedPositions.includes(inst)) alignedPositions.push(inst);
    }
  }

  for (const conflict of portfolioIntel.conflicts ?? []) {
    const partsA = conflict.positionA?.split(" ");
    const partsB = conflict.positionB?.split(" ");
    if (partsA?.[0] && !conflictingPositions.includes(partsA[0])) conflictingPositions.push(partsA[0]);
    if (partsB?.[0] && !conflictingPositions.includes(partsB[0])) conflictingPositions.push(partsB[0]);
  }

  // Shared instruments across conflicting positions
  const sharedInstruments = alignedPositions.filter((inst) => conflictingPositions.includes(inst));

  // Highest priority watch items (max 5)
  const watchItems: WatchItem[] = (portfolioIntel.watchItems ?? []).slice(0, 5).map((w) => ({
    priority: (w.priority as WatchPriority) ?? "LOW",
    category: w.category ?? "PORTFOLIO",
    description: w.reason ?? "Monitor",
    sourceDimension: "PORTFOLIO",
  }));

  // Data quality warnings
  const dataQualityWarnings: string[] = [];
  if (portfolioIntel.dataAvailability?.news === "UNAVAILABLE") {
    dataQualityWarnings.push("News data unavailable");
  }
  if (portfolioIntel.dataAvailability?.macro === "UNAVAILABLE") {
    dataQualityWarnings.push("Macro data unavailable");
  }
  if (portfolioIntel.dataAvailability?.derivatives === "UNAVAILABLE") {
    dataQualityWarnings.push("Derivatives data unavailable");
  }
  if (portfolioIntel.summary?.unavailablePositions > 0) {
    dataQualityWarnings.push(`${portfolioIntel.summary.unavailablePositions} position(s) with insufficient data`);
  }

  return {
    dominantThesis: portfolioIntel.summary?.dominantPortfolioState ?? "UNKNOWN",
    thesisConflicts,
    alignedPositions,
    conflictingPositions,
    sharedInstruments,
    highestPriorityWatchItems: watchItems,
    dataQualityWarnings,
    positionCount: portfolioIntel.summary?.totalPositions ?? 0,
  };
}
