/**
 * Phase 61 — Early Profit Protection Engine
 *
 * Specific logic for detecting when a profitable position should
 * consider manual profit protection BEFORE hitting SL.
 *
 * Distinguishes between:
 * - NORMAL_PULLBACK — healthy retracement
 * - EARLY_DETERIORATION — first signs of weakness
 * - PROFIT_PROTECTION — profit at risk
 * - HIGH_RISK_REVERSAL — strong reversal risk
 * - THESIS_INVALIDATION — thesis no longer valid
 *
 * Pure functions — no side effects.
 */

import type { ProfitState, AlertSeverity, PositionSide } from "./types";
import type { GivebackState } from "./giveback-monitor";
import type { TimeframeAggregationResult } from "./multi-timeframe-engine";

// ═══════════════════════════════════════════════════════════════
// PROFIT PROTECTION CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

export type ProfitProtectionLevel =
  | "NORMAL_PULLBACK"
  | "EARLY_DETERIORATION"
  | "PROFIT_PROTECTION"
  | "HIGH_RISK_REVERSAL"
  | "THESIS_INVALIDATION";

export interface EarlyProtectionInput {
  /** Position side. */
  side: PositionSide;
  /** Current profit state. */
  profitState: ProfitState;
  /** Is the position currently profitable? */
  isProfitable: boolean;
  /** Current giveback state. */
  giveback: GivebackState;
  /** Multi-timeframe aggregation result. */
  multiTimeframe: TimeframeAggregationResult;
  /** Number of independent deterioration signals. */
  deteriorationCount: number;
  /** Thesis health score (0-100). */
  thesisHealthScore: number;
  /** Shock state: "NORMAL" | "ELEVATED" | "SHOCK". */
  shockState: "NORMAL" | "ELEVATED" | "SHOCK";
  /** Price ROC (rate of change per second). */
  priceRoc: number;
  /** Giveback ROC (rate of change per minute). */
  givebackRoc: number;
  /** Whether a high-impact event is approaching. */
  eventApproaching: boolean;
  /** Cross-asset divergence detected. */
  crossAssetDivergence: boolean;
}

export interface EarlyProtectionResult {
  /** Classified protection level. */
  level: ProfitProtectionLevel;
  /** Alert severity that should be applied. */
  severity: AlertSeverity;
  /** Action recommendation. */
  action: string;
  /** Confidence 0-100 in this classification. */
  confidence: number;
  /** List of reasons triggering this level. */
  reasons: string[];
  /** Human-readable explanation. */
  explanation: string;
}

// ═══════════════════════════════════════════════════════════════
// ADVERSE DIRECTION CHECK
// ═══════════════════════════════════════════════════════════════

/**
 * Check if price ROC is adverse to position direction.
 */
function isAdverseRoc(side: PositionSide, priceRoc: number): boolean {
  if (side === "LONG") return priceRoc < 0; // price dropping = adverse for long
  return priceRoc > 0; // price rising = adverse for short
}

/**
 * Check if giveback is accelerating in adverse direction.
 */
function isAdverseGivebackRoc(side: PositionSide, givebackRoc: number): boolean {
  // Giveback always increases = adverse (giveback goes up regardless of side)
  return givebackRoc > 0;
}

// ═══════════════════════════════════════════════════════════════
// EARLY PROTECTION CLASSIFIER
// ═══════════════════════════════════════════════════════════════

/**
 * Classify the early profit protection level based on all available evidence.
 */
export function classifyEarlyProtection(
  input: EarlyProtectionInput,
): EarlyProtectionResult {
  const reasons: string[] = [];
  let confidence = 50;
  let level: ProfitProtectionLevel = "NORMAL_PULLBACK";

  // === THESIS INVALIDATION ===
  if (input.thesisHealthScore < 15 || input.multiTimeframe.level === "STRUCTURAL") {
    level = "THESIS_INVALIDATION";
    reasons.push("Thesis structurally invalidated");
    confidence = Math.max(confidence, 90);
  }

  // === HIGH RISK REVERSAL ===
  if (level !== "THESIS_INVALIDATION") {
    const highRiskFactors = [
      input.shockState === "SHOCK",
      input.multiTimeframe.level === "CONFIRMED" && input.thesisHealthScore < 40,
      input.deteriorationCount >= 4,
      input.isProfitable && input.giveback.givebackPct > 60,
      input.multiTimeframe.htfConfirmation && input.multiTimeframe.level !== "NO_SIGNAL",
    ].filter(Boolean).length;

    if (highRiskFactors >= 2) {
      level = "HIGH_RISK_REVERSAL";
      reasons.push(`${highRiskFactors} high-risk factors detected`);
      confidence = Math.max(confidence, 80);
    }
  }

  // === PROFIT PROTECTION ===
  if (level === "NORMAL_PULLBACK") {
    const profitProtectionFactors = [
      input.isProfitable && input.giveback.givebackPct > 30,
      input.deteriorationCount >= 2,
      input.multiTimeframe.level === "EMERGING",
      input.shockState === "ELEVATED",
      input.isProfitable && isAdverseRoc(input.side, input.priceRoc),
      input.isProfitable && isAdverseGivebackRoc(input.side, input.givebackRoc),
      input.eventApproaching && input.isProfitable,
      input.crossAssetDivergence,
    ].filter(Boolean).length;

    if (profitProtectionFactors >= 3) {
      level = "PROFIT_PROTECTION";
      reasons.push(`${profitProtectionFactors} profit protection signals`);
      confidence = Math.max(confidence, 70);
    }
  }

  // === EARLY DETERIORATION ===
  if (level === "NORMAL_PULLBACK") {
    const earlyFactors = [
      input.deteriorationCount >= 1,
      input.multiTimeframe.level === "NOISE" || input.multiTimeframe.level === "EMERGING",
      input.shockState === "ELEVATED",
      input.isProfitable && input.giveback.givebackPct > 15,
      input.isProfitable && isAdverseRoc(input.side, input.priceRoc),
    ].filter(Boolean).length;

    if (earlyFactors >= 2) {
      level = "EARLY_DETERIORATION";
      reasons.push(`${earlyFactors} early deterioration signals`);
      confidence = Math.max(confidence, 55);
    }
  }

  // === Build reasons for NON-NORMAL levels ===
  if (level !== "NORMAL_PULLBACK") {
    if (input.isProfitable) {
      reasons.push(`Position is profitable (${input.profitState})`);
    }
    if (input.giveback.givebackPct > 0) {
      reasons.push(`Giveback at ${input.giveback.givebackPct.toFixed(1)}%`);
    }
    if (input.multiTimeframe.adverseCount > 0) {
      reasons.push(`${input.multiTimeframe.adverseCount} adverse timeframe(s)`);
    }
    if (input.shockState !== "NORMAL") {
      reasons.push(`Shock state: ${input.shockState}`);
    }
    if (input.eventApproaching) {
      reasons.push("High-impact event approaching");
    }
    if (input.crossAssetDivergence) {
      reasons.push("Cross-asset divergence detected");
    }
    if (isAdverseRoc(input.side, input.priceRoc)) {
      reasons.push(`Price moving against position (ROC: ${input.priceRoc.toFixed(4)}/s)`);
    }
  }

  // === DETERMINE SEVERITY ===
  let severity: AlertSeverity;
  switch (level) {
    case "NORMAL_PULLBACK":
      severity = "NONE";
      break;
    case "EARLY_DETERIORATION":
      severity = "WATCH";
      break;
    case "PROFIT_PROTECTION":
      severity = input.isProfitable ? "CAUTION" : "WATCH";
      break;
    case "HIGH_RISK_REVERSAL":
      severity = input.isProfitable ? "HIGH_RISK" : "CAUTION";
      break;
    case "THESIS_INVALIDATION":
      severity = "INVALIDATED";
      break;
  }

  // === DETERMINE ACTION ===
  let action: string;
  switch (level) {
    case "NORMAL_PULLBACK":
      action = "HOLD_AND_MONITOR";
      break;
    case "EARLY_DETERIORATION":
      action = "HOLD_AND_MONITOR";
      break;
    case "PROFIT_PROTECTION":
      action = input.profitState === "STRONGLY_PROFITABLE"
        ? "CONSIDER_PARTIAL_TP"
        : "CONSIDER_MANUAL_TP";
      break;
    case "HIGH_RISK_REVERSAL":
      action = "PROTECT_PROFIT_NOW";
      break;
    case "THESIS_INVALIDATION":
      action = "THESIS_INVALIDATED";
      break;
  }

  // === EXPLANATION ===
  const explanation = buildExplanation(level, input, reasons);

  return {
    level,
    severity,
    action,
    confidence: Math.min(95, confidence),
    reasons: reasons.length > 0 ? reasons : ["No adverse signals detected."],
    explanation,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPLANATION BUILDER
// ═══════════════════════════════════════════════════════════════

function buildExplanation(
  level: ProfitProtectionLevel,
  input: EarlyProtectionInput,
  reasons: string[],
): string {
  switch (level) {
    case "NORMAL_PULLBACK":
      return "No profit protection action needed. Position thesis appears intact.";

    case "EARLY_DETERIORATION":
      return `Early deterioration detected: ${reasons.slice(0, 2).join("; ")}. Monitor conditions closely.`;

    case "PROFIT_PROTECTION":
      return `Profit protection recommended: ${reasons.slice(0, 3).join("; ")}. Consider securing partial or full profit manually.`;

    case "HIGH_RISK_REVERSAL":
      return `High risk of reversal: ${reasons.slice(0, 3).join("; ")}. Consider protecting existing profit immediately.`;

    case "THESIS_INVALIDATION":
      return `Thesis invalidated: ${reasons.join("; ")}. Original trade conditions are no longer supported. Consider closing or hedging manually.`;
  }
}
