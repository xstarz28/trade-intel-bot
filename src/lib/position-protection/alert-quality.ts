/**
 * Phase 68 — Alert Quality
 *
 * Evaluates alert quality based on factual characteristics.
 * This is NOT probability — it measures evidence strength.
 */

export type AlertQualityLevel =
  | "EXCELLENT"
  | "STRONG"
  | "MODERATE"
  | "WEAK"
  | "INSUFFICIENT";

export interface AlertQualityInput {
  independentSignalCount: number;
  dependencyDiversity: number;
  freshness: "FRESH" | "STALE" | "UNAVAILABLE";
  multiTimeframeConfirmation: boolean;
  shockConfirmation: boolean;
  givebackConfirmation: boolean;
  accelerationConfirmation: boolean;
  structuralConfirmation: boolean;
  conflictingEvidenceCount: number;
  missingEvidenceCount: number;
}

export interface AlertQualityResult {
  quality: AlertQualityLevel;
  score: number;
  maxScore: number;
  factors: string[];
}

/**
 * Evaluate alert quality on a 0-10 scale.
 */
export function evaluateAlertQuality(
  input: AlertQualityInput
): AlertQualityResult {
  const factors: string[] = [];
  let score = 0;
  const maxScore = 10;

  // Independent signals (0-3)
  if (input.independentSignalCount >= 4) {
    score += 3;
    factors.push(`${input.independentSignalCount} independent signals`);
  } else if (input.independentSignalCount >= 2) {
    score += 2;
    factors.push(`${input.independentSignalCount} independent signals`);
  } else if (input.independentSignalCount >= 1) {
    score += 1;
    factors.push(`${input.independentSignalCount} signal`);
  }

  // Dependency diversity (0-1)
  if (input.dependencyDiversity >= 3) {
    score += 1;
    factors.push(`${input.dependencyDiversity} diverse dependency groups`);
  }

  // Freshness (0-1)
  if (input.freshness === "FRESH") {
    score += 1;
    factors.push("Fresh data");
  } else if (input.freshness === "STALE") {
    factors.push("Stale data — reduced quality");
  } else {
    factors.push("Unavailable data — minimal quality");
  }

  // Multi-timeframe (0-1)
  if (input.multiTimeframeConfirmation) {
    score += 1;
    factors.push("Multi-timeframe confirmation");
  }

  // Shock (0-1)
  if (input.shockConfirmation) {
    score += 1;
    factors.push("Shock confirmed");
  }

  // Giveback (0-1)
  if (input.givebackConfirmation) {
    score += 1;
    factors.push("Giveback confirmed");
  }

  // Structural (0-1)
  if (input.structuralConfirmation) {
    score += 1;
    factors.push("Structural confirmation");
  }

  // Acceleration (0-1)
  if (input.accelerationConfirmation) {
    score += 1;
    factors.push("Acceleration confirmed");
  }

  // Penalties
  if (input.conflictingEvidenceCount > 2) {
    score = Math.max(0, score - 1);
    factors.push(`${input.conflictingEvidenceCount} conflicting signals`);
  }
  if (input.missingEvidenceCount > 3) {
    score = Math.max(0, score - 1);
    factors.push(`${input.missingEvidenceCount} missing data sources`);
  }

  // Classify
  let quality: AlertQualityLevel;
  if (score >= 8) {
    quality = "EXCELLENT";
  } else if (score >= 6) {
    quality = "STRONG";
  } else if (score >= 4) {
    quality = "MODERATE";
  } else if (score >= 2) {
    quality = "WEAK";
  } else {
    quality = "INSUFFICIENT";
  }

  return { quality, score, maxScore, factors };
}
