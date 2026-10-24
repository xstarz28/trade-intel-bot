/**
 * Phase 68 — Intelligence Calibration Model
 *
 * Deterministic calibration layer over existing signals.
 * Modifies interpretation/weighting only.
 * Does NOT create a second protection engine.
 */

import type {
  PositionContext,
  AlertSeverity,
  ProfitProtectionUrgency,
  ProfitMetrics,
} from "./types";
import type { MarketEvidence } from "./thesis-health";
import type { ShockAssessment } from "./types";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type EvidenceQuality =
  | "STRONG_EVIDENCE"
  | "MODERATE_EVIDENCE"
  | "WEAK_EVIDENCE"
  | "INSUFFICIENT_EVIDENCE";

export type ReversalStructure =
  | "NO_REVERSAL"
  | "POTENTIAL_REVERSAL"
  | "LIKELY_REVERSAL"
  | "CONFIRMED_REVERSAL";

export type PullbackClassification =
  | "NORMAL_PULLBACK"
  | "EARLY_CORRECTION"
  | "MEANINGFUL_DETERIORATION"
  | "STRUCTURAL_REVERSAL"
  | "SHOCK_REVERSAL"
  | "INSUFFICIENT_DATA";

export interface CalibrationResult {
  calibratedSeverity: AlertSeverity;
  calibratedUrgency: ProfitProtectionUrgency;
  evidenceQuality: EvidenceQuality;
  reversalStructure: ReversalStructure;
  pullbackClassification: PullbackClassification;
  independentSignalCount: number;
  reasons: string[];
  suppressionReason?: string;
  calibrationFlags: string[];
}

export interface CalibrationInput {
  position: PositionContext;
  evidence: MarketEvidence;
  severity: AlertSeverity;
  urgency: ProfitProtectionUrgency;
  profit: ProfitMetrics;
  thesisHealthScore: number;
  thesisHealthState: string;
  shock: ShockAssessment;
  givebackPct: number;
  accelerationLevel: "NORMAL" | "ELEVATED" | "HIGH" | "EXTREME";
  deteriorationCount: number;
  confirmingCount: number;
  missingData: string[];
  conflictingEvidence: string[];
  supportingEvidence: string[];
}

// ═══════════════════════════════════════════════════════════════
// SEVERITY RANK
// ═══════════════════════════════════════════════════════════════

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  NONE: 0,
  WATCH: 1,
  CAUTION: 2,
  HIGH_RISK: 3,
  INVALIDATED: 4,
};

const URGENCY_RANK: Record<ProfitProtectionUrgency, number> = {
  NONE: 0,
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// ═══════════════════════════════════════════════════════════════
// EVIDENCE QUALITY
// ═══════════════════════════════════════════════════════════════

function assessEvidenceQuality(input: CalibrationInput): {
  quality: EvidenceQuality;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  // Independent deterioration signals
  if (input.deteriorationCount >= 4) {
    score += 4;
    reasons.push(`${input.deteriorationCount} independent deterioration signals`);
  } else if (input.deteriorationCount >= 2) {
    score += 3;
    reasons.push(`${input.deteriorationCount} deterioration signals present`);
  } else if (input.deteriorationCount >= 1) {
    score += 1;
    reasons.push(`${input.deteriorationCount} deterioration signal present`);
  }

  // Multi-timeframe confirmation
  if (input.evidence.shortTermTrend === "bearish" && input.evidence.mediumTermTrend === "bearish") {
    score += 1;
    reasons.push("Multi-timeframe trend confirmation");
  }

  // Structure break
  if (input.evidence.structureBroken) {
    score += 2;
    reasons.push("Structure break confirmed");
  }

  // Shock
  if (input.shock.state === "SHOCK") {
    score += 2;
    reasons.push("Market shock detected");
  } else if (input.shock.state === "ELEVATED") {
    score += 1;
    reasons.push("Elevated market stress");
  }

  // Giveback
  if (input.givebackPct > 40) {
    score += 2;
    reasons.push(`Significant giveback (${input.givebackPct.toFixed(0)}%)`);
  } else if (input.givebackPct > 20) {
    score += 1;
    reasons.push(`Moderate giveback (${input.givebackPct.toFixed(0)}%)`);
  }

  // Acceleration
  if (input.accelerationLevel === "HIGH" || input.accelerationLevel === "EXTREME") {
    score += 1;
    reasons.push("Adverse acceleration detected");
  }

  // Thesis health
  if (input.thesisHealthState === "INVALIDATED" || input.thesisHealthState === "SEVERELY_DETERIORATING") {
    score += 2;
    reasons.push("Thesis severely deteriorated");
  } else if (input.thesisHealthState === "DETERIORATING") {
    score += 1;
    reasons.push("Thesis deteriorating");
  }

  // Cross-asset / macro confirmation
  if (input.evidence.correlatedDivergence) {
    score += 1;
    reasons.push("Cross-asset divergence");
  }
  if (input.evidence.riskRegime === "risk_off") {
    score += 1;
    reasons.push("Risk-off regime");
  }

  // Data freshness penalty
  if (input.missingData.length > 3) {
    score -= 1;
    reasons.push(`${input.missingData.length} data sources missing`);
  }

  // Classify
  let quality: EvidenceQuality;
  if (score >= 6) {
    quality = "STRONG_EVIDENCE";
  } else if (score >= 3) {
    quality = "MODERATE_EVIDENCE";
  } else if (score >= 1) {
    quality = "WEAK_EVIDENCE";
  } else {
    quality = "INSUFFICIENT_EVIDENCE";
  }

  return { quality, reasons };
}

// ═══════════════════════════════════════════════════════════════
// REVERSAL STRUCTURE
// ═══════════════════════════════════════════════════════════════

function assessReversalStructure(input: CalibrationInput): ReversalStructure {
  const isLong = input.position.side === "LONG";

  // Adverse trend detection
  const sttBearish = isLong
    ? input.evidence.shortTermTrend === "bearish"
    : input.evidence.shortTermTrend === "bullish";
  const mttBearish = isLong
    ? input.evidence.mediumTermTrend === "bearish"
    : input.evidence.mediumTermTrend === "bullish";

  // Structure break is strongest signal
  if (input.evidence.structureBroken && sttBearish && mttBearish) {
    return "CONFIRMED_REVERSAL";
  }

  // Multi-timeframe adverse + acceleration
  if (sttBearish && mttBearish) {
    if (input.accelerationLevel === "HIGH" || input.accelerationLevel === "EXTREME") {
      return "LIKELY_REVERSAL";
    }
    return "POTENTIAL_REVERSAL";
  }

  // Single timeframe adverse
  if (sttBearish) {
    if (input.accelerationLevel === "HIGH") {
      return "POTENTIAL_REVERSAL";
    }
  }

  // Shock may bypass normal confirmation
  if (input.shock.state === "SHOCK" && input.givebackPct > 20) {
    return "LIKELY_REVERSAL";
  }

  return "NO_REVERSAL";
}

// ═══════════════════════════════════════════════════════════════
// SEVERITY CALIBRATION
// ═══════════════════════════════════════════════════════════════

function calibrateSeverity(
  input: CalibrationInput,
  evidenceQuality: EvidenceQuality,
  reversalStructure: ReversalStructure
): { severity: AlertSeverity; suppressionReason?: string } {
  let severity = input.severity;
  const flags: string[] = [];

  // Upscale when strong independent evidence exists
  if (
    evidenceQuality === "STRONG_EVIDENCE" &&
    reversalStructure === "CONFIRMED_REVERSAL" &&
    SEVERITY_RANK[severity] < SEVERITY_RANK["HIGH_RISK"]
  ) {
    severity = "HIGH_RISK";
    flags.push("UPSCALED_STRONG_REVERSAL");
  }

  // Downgrade when evidence is weak but not when critical shock
  if (
    evidenceQuality === "WEAK_EVIDENCE" &&
    input.shock.state !== "SHOCK" &&
    input.thesisHealthState !== "INVALIDATED" &&
    SEVERITY_RANK[severity] >= SEVERITY_RANK["HIGH_RISK"]
  ) {
    // Don't downgrade if giveback is large
    if (input.givebackPct < 25) {
      severity = "CAUTION";
      flags.push("DOWNGRADED_WEAK_EVIDENCE");
    }
  }

  // Suppress if insufficient evidence for any non-NONE alert
  if (
    evidenceQuality === "INSUFFICIENT_EVIDENCE" &&
    SEVERITY_RANK[severity] >= SEVERITY_RANK["WATCH"] &&
    input.shock.state !== "SHOCK"
  ) {
    return {
      severity: "NONE",
      suppressionReason: "Insufficient evidence for protection alert",
    };
  }

  return { severity };
}

// ═══════════════════════════════════════════════════════════════
// URGENCY CALIBRATION
// ═══════════════════════════════════════════════════════════════

function calibrateUrgency(
  input: CalibrationInput,
  evidenceQuality: EvidenceQuality,
  reversalStructure: ReversalStructure
): ProfitProtectionUrgency {
  let urgency = input.urgency;

  // Strong evidence + confirmed reversal → at least HIGH
  if (
    evidenceQuality === "STRONG_EVIDENCE" &&
    reversalStructure === "CONFIRMED_REVERSAL" &&
    URGENCY_RANK[urgency] < URGENCY_RANK["HIGH"]
  ) {
    urgency = "HIGH";
  }

  // Shock always pushes urgency up
  if (input.shock.state === "SHOCK" && URGENCY_RANK[urgency] < URGENCY_RANK["MODERATE"]) {
    urgency = "MODERATE";
  }

  // Weak evidence caps urgency at MODERATE unless thesis invalidated
  if (
    evidenceQuality === "WEAK_EVIDENCE" &&
    input.thesisHealthState !== "INVALIDATED" &&
    URGENCY_RANK[urgency] > URGENCY_RANK["MODERATE"]
  ) {
    urgency = "MODERATE";
  }

  return urgency;
}

// ═══════════════════════════════════════════════════════════════
// PULLBACK CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

function classifyPullback(
  input: CalibrationInput,
  reversalStructure: ReversalStructure
): PullbackClassification {
  // No meaningful pullback
  if (input.givebackPct < 5) {
    return "NORMAL_PULLBACK";
  }

  // Shock override
  if (input.shock.state === "SHOCK" && input.givebackPct > 15) {
    return "SHOCK_REVERSAL";
  }

  // Structural reversal
  if (reversalStructure === "CONFIRMED_REVERSAL") {
    return "STRUCTURAL_REVERSAL";
  }

  // Meaningful deterioration
  if (
    reversalStructure === "LIKELY_REVERSAL" ||
    (input.givebackPct > 30 && input.accelerationLevel === "HIGH")
  ) {
    return "MEANINGFUL_DETERIORATION";
  }

  // Early correction
  if (
    input.givebackPct > 15 ||
    (input.givebackPct > 10 && input.accelerationLevel === "ELEVATED")
  ) {
    return "EARLY_CORRECTION";
  }

  return "NORMAL_PULLBACK";
}

// ═══════════════════════════════════════════════════════════════
// MAIN CALIBRATION
// ═══════════════════════════════════════════════════════════════

export function calibrateIntelligence(
  input: CalibrationInput
): CalibrationResult {
  const flags: string[] = [];
  const reasons: string[] = [];

  // 1. Assess evidence quality
  const { quality: evidenceQuality, reasons: qualityReasons } =
    assessEvidenceQuality(input);
  reasons.push(...qualityReasons);

  // 2. Assess reversal structure
  const reversalStructure = assessReversalStructure(input);
  if (reversalStructure !== "NO_REVERSAL") {
    reasons.push(`Reversal structure: ${reversalStructure}`);
  }

  // 3. Classify pullback
  const pullbackClassification = classifyPullback(input, reversalStructure);
  if (pullbackClassification !== "NORMAL_PULLBACK") {
    reasons.push(`Pullback: ${pullbackClassification}`);
  }

  // 4. Calibrate severity
  const { severity: calibratedSeverity, suppressionReason } = calibrateSeverity(
    input,
    evidenceQuality,
    reversalStructure
  );

  // 5. Calibrate urgency
  const calibratedUrgency = calibrateUrgency(
    input,
    evidenceQuality,
    reversalStructure
  );

  // 6. Count independent signals
  const independentSignalCount = input.deteriorationCount;

  // 7. Add flags
  if (evidenceQuality === "STRONG_EVIDENCE") flags.push("STRONG_EVIDENCE");
  if (reversalStructure === "CONFIRMED_REVERSAL") flags.push("CONFIRMED_REVERSAL");
  if (input.shock.state === "SHOCK") flags.push("MARKET_SHOCK");
  if (input.givebackPct > 30) flags.push("SIGNIFICANT_GIVEBACK");
  if (input.accelerationLevel === "HIGH" || input.accelerationLevel === "EXTREME")
    flags.push("HIGH_ACCELERATION");
  if (input.missingData.length > 2) flags.push("PARTIAL_DATA");
  if (input.conflictingEvidence.length > 0) flags.push("CONFLICTING_EVIDENCE");

  return {
    calibratedSeverity,
    calibratedUrgency,
    evidenceQuality,
    reversalStructure,
    pullbackClassification,
    independentSignalCount,
    reasons,
    suppressionReason,
    calibrationFlags: flags,
  };
}
