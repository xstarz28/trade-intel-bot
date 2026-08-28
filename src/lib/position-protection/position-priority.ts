/**
 * Phase 64 — Position Priority
 *
 * Deterministic position priority ranking for multi-position monitoring.
 * Within the same severity, prioritizes by urgency, giveback, acceleration.
 *
 * Pure functions — no side effects.
 */

import type { AlertSeverity, ProfitProtectionUrgency, ProfitState } from "./types";
import { alertSeverityRank } from "./types";
import { urgencyRank } from "./types";

// ═══════════════════════════════════════════════════════════════
// PRIORITY RANK
// ═══════════════════════════════════════════════════════════════

export interface PositionPriorityRank {
  /** Numeric rank — higher = more urgent. */
  rank: number;
  /** Human-readable priority label. */
  label: string;
  /** Severity level. */
  severity: AlertSeverity;
  /** Urgency level. */
  urgency: ProfitProtectionUrgency;
}

// ═══════════════════════════════════════════════════════════════
// INPUT
// ═══════════════════════════════════════════════════════════════

export interface PositionPriorityInput {
  severity: AlertSeverity;
  urgency: ProfitProtectionUrgency;
  givebackPct: number;
  accelerationLevel: "NORMAL" | "ELEVATED" | "HIGH";
  profitState: ProfitState;
}

// ═══════════════════════════════════════════════════════════════
// PRIORITY COMPUTATION
// ═══════════════════════════════════════════════════════════════

/**
 * Compute deterministic position priority.
 * Higher rank = more urgent attention needed.
 */
export function computePositionPriority(input: PositionPriorityInput): PositionPriorityRank {
  // Base score from severity (0-40)
  const severityScore = alertSeverityRank(input.severity) * 10;

  // Urgency bonus (0-20)
  const urgencyScore = urgencyRank(input.urgency) * 5;

  // Giveback bonus (0-20): higher giveback = higher priority
  let givebackScore = 0;
  if (input.givebackPct > 70) givebackScore = 20;
  else if (input.givebackPct > 50) givebackScore = 15;
  else if (input.givebackPct > 30) givebackScore = 10;
  else if (input.givebackPct > 15) givebackScore = 5;

  // Acceleration bonus (0-10)
  let accelScore = 0;
  if (input.accelerationLevel === "HIGH") accelScore = 10;
  else if (input.accelerationLevel === "ELEVATED") accelScore = 5;

  // Profit state penalty (negative for losing positions)
  let profitAdjustment = 0;
  if (input.profitState === "STRONGLY_PROFITABLE") profitAdjustment = 5;
  else if (input.profitState === "PROFITABLE") profitAdjustment = 3;
  else if (input.profitState === "LOSING") profitAdjustment = -5;

  const totalScore = severityScore + urgencyScore + givebackScore + accelScore + profitAdjustment;

  // Label
  let label: string;
  if (totalScore >= 60) label = "CRITICAL";
  else if (totalScore >= 45) label = "HIGH";
  else if (totalScore >= 30) label = "MEDIUM";
  else if (totalScore >= 15) label = "LOW";
  else label = "MONITORING";

  return {
    rank: totalScore,
    label,
    severity: input.severity,
    urgency: input.urgency,
  };
}

/**
 * Compare two position priorities.
 * Returns positive if a should be evaluated first.
 */
export function comparePositionPriority(
  a: PositionPriorityRank,
  b: PositionPriorityRank,
): number {
  return a.rank - b.rank;
}

/**
 * Sort positions by priority (highest first).
 */
export function sortByPriority(positions: Array<{ positionId: string; priority: PositionPriorityRank }>): Array<{ positionId: string; priority: PositionPriorityRank }> {
  return [...positions].sort((a, b) => b.priority.rank - a.priority.rank);
}
