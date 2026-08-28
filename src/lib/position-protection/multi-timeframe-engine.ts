/**
 * Phase 61 — Multi-Timeframe Confirmation Engine
 *
 * Aggregates evidence across timeframes (M5 → M15 → H1 → H4 → D1)
 * to distinguish short-term noise from structural thesis invalidation.
 *
 * Pure functions — no side effects.
 */

import type { Timeframe, EventType } from "./realtime-types";

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME SEVERITY LEVEL
// ═══════════════════════════════════════════════════════════════

export type TimeframeSeverityLevel =
  | "NO_SIGNAL"
  | "NOISE"
  | "EMERGING"
  | "CONFIRMED"
  | "STRUCTURAL";

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME EVIDENCE
// ═══════════════════════════════════════════════════════════════

export interface TimeframeEvidence {
  /** The timeframe this evidence comes from. */
  timeframe: Timeframe;
  /** Is the trend adverse to position direction? */
  adverseTrend: boolean;
  /** Is market structure broken on this timeframe? */
  structureBroken: boolean;
  /** Is momentum adverse? */
  adverseMomentum: boolean;
  /** Confidence 0-100 that this timeframe confirms reversal. */
  confirmationConfidence: number;
  /** Timestamp of this observation. */
  observedAt: number;
  /** Source/provider. */
  source: string;
}

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME AGGREGATION RESULT
// ═══════════════════════════════════════════════════════════════

export interface TimeframeAggregationResult {
  /** Combined severity level across all timeframes. */
  level: TimeframeSeverityLevel;
  /** Number of timeframes with adverse evidence. */
  adverseCount: number;
  /** Total timeframes evaluated. */
  totalEvaluated: number;
  /** Whether higher timeframes confirm lower timeframe signals. */
  htfConfirmation: boolean;
  /** Highest timeframe that shows structural damage. */
  highestAdverseTimeframe: Timeframe | null;
  /** Aggregated confidence 0-100. */
  aggregatedConfidence: number;
  /** Description of the multi-timeframe picture. */
  description: string;
  /** Individual timeframe results for display. */
  timeframeResults: TimeframeResult[];
}

export interface TimeframeResult {
  timeframe: Timeframe;
  level: TimeframeSeverityLevel;
  adverseTrend: boolean;
  structureBroken: boolean;
  adverseMomentum: boolean;
  confidence: number;
}

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME RANKING
// ═══════════════════════════════════════════════════════════════

const TIMEFRAME_RANK: Record<Timeframe, number> = {
  TICK: 0,
  M1: 1,
  M5: 2,
  M15: 3,
  H1: 4,
  H4: 5,
  D1: 6,
};

function rankToTimeframe(rank: number): Timeframe | null {
  for (const [tf, r] of Object.entries(TIMEFRAME_RANK)) {
    if (r === rank) return tf as Timeframe;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
// SINGLE TIMEFRAME CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

/**
 * Classify a single timeframe's evidence into a severity level.
 */
export function classifyTimeframeSeverity(
  evidence: TimeframeEvidence,
): TimeframeSeverityLevel {
  if (!evidence.adverseTrend && !evidence.structureBroken && !evidence.adverseMomentum) {
    return "NO_SIGNAL";
  }

  const tf = evidence.timeframe;
  const rank = TIMEFRAME_RANK[tf] ?? 0;

  // Structure break on H1+ is structural damage
  if (evidence.structureBroken && rank >= 4) {
    return "STRUCTURAL";
  }

  // Structure break on lower timeframes
  if (evidence.structureBroken) {
    return evidence.adverseMomentum ? "CONFIRMED" : "EMERGING";
  }

  // Adverse trend on H1+ is confirmed
  if (evidence.adverseTrend && rank >= 4) {
    return "CONFIRMED";
  }

  // Adverse trend on M15
  if (evidence.adverseTrend && rank >= 3) {
    return evidence.confirmationConfidence > 60 ? "CONFIRMED" : "EMERGING";
  }

  // Adverse trend on M5 or lower
  if (evidence.adverseTrend && rank >= 2) {
    return evidence.adverseMomentum ? "EMERGING" : "NOISE";
  }

  // Adverse momentum only on very low timeframe
  if (evidence.adverseMomentum && rank <= 1) {
    return "NOISE";
  }

  if (evidence.adverseMomentum) {
    return "EMERGING";
  }

  return "NO_SIGNAL";
}

// ═══════════════════════════════════════════════════════════════
// AGGREGATION
// ═══════════════════════════════════════════════════════════════

/**
 * Aggregate multi-timeframe evidence into a single confirmation result.
 *
 * Logic:
 * - M5 only → NOISE (short-term fluctuation)
 * - M5 + M15 → EMERGING (possible correction)
 * - M15 + H1 → CONFIRMED (structural risk increasing)
 * - H1 + H4 → STRUCTURAL (thesis may be invalid)
 * - H4 + D1 → STRUCTURAL (thesis invalidation candidate)
 */
export function aggregateTimeframeEvidence(
  evidences: TimeframeEvidence[],
): TimeframeAggregationResult {
  if (evidences.length === 0) {
    return {
      level: "NO_SIGNAL",
      adverseCount: 0,
      totalEvaluated: 0,
      htfConfirmation: false,
      highestAdverseTimeframe: null,
      aggregatedConfidence: 0,
      description: "No multi-timeframe evidence available.",
      timeframeResults: [],
    };
  }

  // Classify each timeframe
  const results: TimeframeResult[] = evidences.map(e => ({
    timeframe: e.timeframe,
    level: classifyTimeframeSeverity(e),
    adverseTrend: e.adverseTrend,
    structureBroken: e.structureBroken,
    adverseMomentum: e.adverseMomentum,
    confidence: e.confirmationConfidence,
  }));

  // Count adverse timeframes
  const adverseResults = results.filter(r => r.level !== "NO_SIGNAL");
  const adverseCount = adverseResults.length;
  const totalEvaluated = results.length;

  // Find highest adverse timeframe
  let highestAdverseRank = -1;
  let highestAdverseTimeframe: Timeframe | null = null;
  for (const r of adverseResults) {
    const rank = TIMEFRAME_RANK[r.timeframe] ?? 0;
    if (rank > highestAdverseRank) {
      highestAdverseRank = rank;
      highestAdverseTimeframe = r.timeframe;
    }
  }

  // HTF confirmation: at least one H1+ timeframe confirms lower timeframe signals
  const htfAdverse = adverseResults.some(r => TIMEFRAME_RANK[r.timeframe] >= 4);
  const ltfAdverse = adverseResults.some(r => TIMEFRAME_RANK[r.timeframe] < 4);
  const htfConfirmation = htfAdverse && ltfAdverse;

  // Check for structural confirmation
  const structuralResults = results.filter(r => r.level === "STRUCTURAL");
  const confirmedResults = results.filter(r => r.level === "CONFIRMED");

  // Determine combined level
  let level: TimeframeSeverityLevel;
  if (structuralResults.length >= 2) {
    level = "STRUCTURAL";
  } else if (structuralResults.length >= 1 && confirmedResults.length >= 1) {
    level = "STRUCTURAL";
  } else if (structuralResults.length >= 1) {
    level = "STRUCTURAL";
  } else if (confirmedResults.length >= 2) {
    level = "CONFIRMED";
  } else if (confirmedResults.length >= 1 && htfConfirmation) {
    level = "CONFIRMED";
  } else if (confirmedResults.length >= 1) {
    level = "EMERGING";
  } else {
    const emergingCount = results.filter(r => r.level === "EMERGING").length;
    const noiseCount = results.filter(r => r.level === "NOISE").length;
    if (emergingCount >= 2) {
      level = "EMERGING";
    } else if (emergingCount >= 1) {
      level = "NOISE";
    } else if (noiseCount >= 2) {
      level = "NOISE";
    } else {
      level = "NO_SIGNAL";
    }
  }

  // Aggregate confidence
  const maxConfidence = adverseResults.length > 0
    ? Math.max(...adverseResults.map(r => r.confidence))
    : 0;
  const aggregatedConfidence = Math.min(100, maxConfidence + (adverseCount - 1) * 10);

  // Build description
  let description: string;
  switch (level) {
    case "NO_SIGNAL":
      description = "All timeframes aligned with position direction.";
      break;
    case "NOISE":
      description = `Short-term fluctuation only (${adverseCount} timeframe${adverseCount > 1 ? "s" : ""}). Likely noise.`;
      break;
    case "EMERGING":
      description = `Early deterioration detected across ${adverseCount} timeframe${adverseCount > 1 ? "s" : ""}. Monitor closely.`;
      break;
    case "CONFIRMED":
      description = `Reversal risk confirmed across ${adverseCount} timeframe${adverseCount > 1 ? "s" : ""}${htfConfirmation ? " including higher timeframes" : ""}. Consider protecting profit.`;
      break;
    case "STRUCTURAL":
      description = `Structural damage on ${highestAdverseTimeframe ?? "H1+"} timeframe. Thesis may be compromised. Consider manual action.`;
      break;
  }

  return {
    level,
    adverseCount,
    totalEvaluated,
    htfConfirmation,
    highestAdverseTimeframe,
    aggregatedConfidence,
    description,
    timeframeResults: results,
  };
}

// ═══════════════════════════════════════════════════════════════
// TIMEFRAME EVIDENCE FROM EVENT
// ═══════════════════════════════════════════════════════════════

/**
 * Convert a RealTimeEvent's timeframe and payload into TimeframeEvidence.
 * Returns null if the event doesn't carry timeframe-relevant information.
 */
export function eventToTimeframeEvidence(
  eventType: EventType,
  timeframe: Timeframe | undefined,
  payload: Record<string, unknown>,
  source: string,
  now: number,
): TimeframeEvidence | null {
  if (!timeframe) return null;

  const adverseTrend = payload.adverseTrend === true
    || (typeof payload.trend === "string" && payload.trend === "bearish")
    || (typeof payload.trend === "string" && payload.trend === "bullish" && false);

  const structureBroken = payload.structureBroken === true
    || payload.broken === true
    || payload.bos === true;

  const adverseMomentum = typeof payload.momentumChange === "number"
    && payload.momentumChange < -10;

  const confidence = typeof payload.confirmationConfidence === "number"
    ? payload.confirmationConfidence
    : structureBroken ? 80
    : adverseTrend ? 50
    : adverseMomentum ? 40
    : 0;

  // Only return if there's actually an adverse signal
  if (!adverseTrend && !structureBroken && !adverseMomentum) {
    return null;
  }

  return {
    timeframe,
    adverseTrend,
    structureBroken,
    adverseMomentum,
    confirmationConfidence: confidence,
    observedAt: now,
    source,
  };
}
