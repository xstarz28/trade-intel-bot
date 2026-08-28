/**
 * Phase 68 — Pullback Classifier
 *
 * Classifies pullbacks/reversals for LONG and SHORT symmetrically.
 * Single weak M5 signal must not become structural reversal.
 * Requires stronger confirmation for structural classifications.
 * Critical market shocks may bypass normal confirmation.
 */

import type { PositionContext } from "./types";
import type { MarketEvidence } from "./thesis-health";
import type { ShockAssessment } from "./types";

export type PullbackType =
  | "NORMAL_PULLBACK"
  | "EARLY_CORRECTION"
  | "MEANINGFUL_DETERIORATION"
  | "STRUCTURAL_REVERSAL"
  | "SHOCK_REVERSAL"
  | "INSUFFICIENT_DATA";

export interface PullbackClassificationInput {
  position: PositionContext;
  evidence: MarketEvidence;
  shock: ShockAssessment;
  givebackPct: number;
  accelerationLevel: "NORMAL" | "ELEVATED" | "HIGH" | "EXTREME";
}

/**
 * Classify pullback type based on evidence.
 * Symmetric for LONG and SHORT.
 */
export function classifyPullbackType(
  input: PullbackClassificationInput
): PullbackType {
  const { position, evidence, shock, givebackPct, accelerationLevel } = input;
  const isLong = position.side === "LONG";

  // Insufficient data — check first before any classification
  if (!evidence.shortTermTrend && !evidence.mediumTermTrend) {
    return "INSUFFICIENT_DATA";
  }

  // Determine adverse direction
  const sttAdverse = isLong
    ? evidence.shortTermTrend === "bearish"
    : evidence.shortTermTrend === "bullish";
  const mttAdverse = isLong
    ? evidence.mediumTermTrend === "bearish"
    : evidence.mediumTermTrend === "bullish";

  // No meaningful pullback
  if (givebackPct < 5) {
    return "NORMAL_PULLBACK";
  }

  // Shock override — bypass normal confirmation
  if (shock.state === "SHOCK" && givebackPct > 15) {
    return "SHOCK_REVERSAL";
  }

  // Structural reversal requires strong multi-timeframe confirmation
  if (evidence.structureBroken && sttAdverse && mttAdverse) {
    if (givebackPct > 15 || accelerationLevel === "HIGH") {
      return "STRUCTURAL_REVERSAL";
    }
  }

  // Meaningful deterioration
  if (sttAdverse && mttAdverse) {
    if (givebackPct > 25 || accelerationLevel === "HIGH") {
      return "MEANINGFUL_DETERIORATION";
    }
  }

  // Early correction
  if (givebackPct > 15 || (givebackPct > 10 && accelerationLevel !== "NORMAL")) {
    return "EARLY_CORRECTION";
  }

  return "NORMAL_PULLBACK";
}
