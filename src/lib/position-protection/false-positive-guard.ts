/**
 * Phase 68 — False-Positive Guard
 *
 * Prevents unnecessary protection alerts when evidence indicates normal pullback.
 * Must NEVER block genuine thesis invalidation, critical shock, or structural reversal.
 */

import type { AlertSeverity } from "./types";
import type { PullbackType } from "./pullback-classifier";
import type { EvidenceQuality } from "./intelligence-calibration";

export interface FalsePositiveGuardInput {
  severity: AlertSeverity;
  pullbackType: PullbackType;
  evidenceQuality: EvidenceQuality;
  shockState: string;
  thesisHealthState: string;
  independentSignalCount: number;
  givebackPct: number;
  accelerationLevel: "NORMAL" | "ELEVATED" | "HIGH" | "EXTREME";
}

export interface FalsePositiveGuardResult {
  shouldAlert: boolean;
  finalSeverity: AlertSeverity;
  suppressionReason?: string;
}

const SEVERITY_RANK: Record<string, number> = {
  NONE: 0,
  WATCH: 1,
  CAUTION: 2,
  HIGH_RISK: 3,
  INVALIDATED: 4,
};

/**
 * Determine if an alert should fire or be suppressed.
 */
export function guardAgainstFalsePositive(
  input: FalsePositiveGuardInput
): FalsePositiveGuardResult {
  const {
    severity,
    pullbackType,
    evidenceQuality,
    shockState,
    thesisHealthState,
    independentSignalCount,
    givebackPct,
  } = input;

  // NEVER block critical conditions
  if (thesisHealthState === "INVALIDATED") {
    return { shouldAlert: true, finalSeverity: severity };
  }
  if (shockState === "SHOCK" && SEVERITY_RANK[severity] >= SEVERITY_RANK["CAUTION"]) {
    return { shouldAlert: true, finalSeverity: severity };
  }

  // Never block extreme giveback + multiple signals
  if (givebackPct > 50 && independentSignalCount >= 3) {
    return { shouldAlert: true, finalSeverity: severity };
  }

  // Normal pullback suppression
  if (
    pullbackType === "NORMAL_PULLBACK" &&
    evidenceQuality === "WEAK_EVIDENCE" &&
    SEVERITY_RANK[severity] >= SEVERITY_RANK["HIGH_RISK"]
  ) {
    return {
      shouldAlert: false,
      finalSeverity: "CAUTION",
      suppressionReason: "Normal pullback with weak evidence — downgrading from HIGH_RISK to CAUTION",
    };
  }

  // Insufficient evidence suppression
  if (
    pullbackType === "NORMAL_PULLBACK" &&
    evidenceQuality === "INSUFFICIENT_EVIDENCE" &&
    SEVERITY_RANK[severity] >= SEVERITY_RANK["WATCH"]
  ) {
    return {
      shouldAlert: false,
      finalSeverity: "NONE",
      suppressionReason: "Insufficient evidence for any protection alert during normal pullback",
    };
  }

  // Single signal only — cap at CAUTION unless structural
  if (
    independentSignalCount <= 1 &&
    pullbackType !== "STRUCTURAL_REVERSAL" &&
    pullbackType !== "SHOCK_REVERSAL" &&
    SEVERITY_RANK[severity] >= SEVERITY_RANK["HIGH_RISK"] &&
    shockState !== "SHOCK"
  ) {
    return {
      shouldAlert: false,
      finalSeverity: "WATCH",
      suppressionReason: "Single deterioration signal insufficient for HIGH_RISK — downgrading to WATCH",
    };
  }

  // Default: allow alert
  return { shouldAlert: true, finalSeverity: severity };
}
