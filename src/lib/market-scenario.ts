/**
 * Phase 27 — MARKET SCENARIO: Continuation vs Reversal Analysis.
 *
 * Pure derivation from existing engine outputs. This is NOT a prediction
 * engine. Every field is assembled from already-computed result data.
 *
 * Core principle: CURRENT BIAS ≠ FUTURE CONFIRMATION.
 * A bullish structure may continue, consolidate, retrace, or reverse.
 *
 * This module sits ABOVE the existing decision hierarchy. It does NOT:
 * - modify bias / conviction / gates
 * - override structural hierarchy
 * - fabricate future levels
 * - create synthetic price targets
 * - modify risk calculations
 * - bypass existing gates
 */

import type { AnalysisResult } from "@/types/analysis";
import type { EvidenceItem } from "@/lib/analyst-thesis";

// ── Types ────────────────────────────────────────────────────────

export type ScenarioLabel =
  | "CONFIRMED_CONTINUATION"
  | "CONTINUATION_DEVELOPING"
  | "PULLBACK_OR_CONSOLIDATION"
  | "REVERSAL_DEVELOPING"
  | "REVERSAL_CONFIRMED"
  | "UNCONFIRMED"
  | "WAIT";

export type ConfirmationState =
  | "confirmed"
  | "developing"
  | "absent"
  | "not_applicable";

export type StructuralRisk =
  | "low"
  | "moderate"
  | "elevated"
  | "high";

export interface MarketScenarioContext {
  /** Current structural direction from the engine. */
  currentDirection: "bullish" | "bearish" | "neutral";
  /** Overall scenario classification. */
  scenario: ScenarioLabel;
  /** Continuation status. */
  continuationStatus: ConfirmationState;
  /** Reversal status. */
  reversalStatus: ConfirmationState;
  /** Confirmation state for the current trade direction. */
  confirmationState: ConfirmationState;
  /** Evidence supporting continuation. */
  continuationEvidence: EvidenceItem[];
  /** Evidence suggesting reversal risk. */
  reversalEvidence: EvidenceItem[];
  /** Conflicting evidence between continuation and reversal. */
  conflictingEvidence: EvidenceItem[];
  /** What would confirm continuation. */
  confirmationConditions: string[];
  /** What would invalidate the current thesis. */
  invalidationConditions: string[];
  /** Primary scenario description. */
  primaryScenario: string;
  /** Alternate scenario description. */
  alternateScenario: string;
  /** Why WAIT is recommended if applicable. */
  waitReason?: string;
  /** Structural extension risk assessment. */
  structuralRisk: StructuralRisk;
  /** Extension risk from displacement/distance. */
  extensionRisk: StructuralRisk;
  /** Liquidity risk assessment. */
  liquidityRisk: StructuralRisk;
}

// ── Builder ──────────────────────────────────────────────────────

export function buildMarketScenario(result: AnalysisResult): MarketScenarioContext {
  const trace = result.decisionTrace;
  const tech = result.technicalData;
  const mtf = result.mtfSummary;
  const dq = result.dataQualityContext;

  const structDir = trace?.structuralDirection ?? "none";
  const vetoApplied = trace?.biasCalculation?.vetoApplied ?? false;
  const contradictions = result.keyContradictions ?? [];

  // ── Current direction ──
  const currentDirection: MarketScenarioContext["currentDirection"] =
    structDir === "long" ? "bullish" : structDir === "short" ? "bearish" : "neutral";

  // ── Evidence collection ──
  const continuationEvidence: EvidenceItem[] = [];
  const reversalEvidence: EvidenceItem[] = [];
  const conflictingEvidence: EvidenceItem[] = [];

  // Structure evidence
  if (structDir !== "none") {
    continuationEvidence.push({
      category: "structure",
      explanation: `External structure is ${structDir} (${tech?.smc?.internalExternal?.external?.structure ?? tech?.structure ?? "unknown"})`,
      timeframe: mtf?.setupTimeframe,
    });
  }

  // MTF alignment
  if (mtf) {
    if (
      (currentDirection === "bullish" && mtf.alignment === "ALIGNED_BULLISH") ||
      (currentDirection === "bearish" && mtf.alignment === "ALIGNED_BEARISH")
    ) {
      continuationEvidence.push({
        category: "mtf",
        explanation: `MTF alignment supports ${currentDirection} direction (${mtf.alignment})`,
        timeframe: mtf.setupTimeframe,
      });
    } else if (mtf.alignment === "COUNTER_TREND") {
      reversalEvidence.push({
        category: "mtf",
        explanation: `MTF counter-trend detected — HTF structure conflicts with LTF direction`,
        timeframe: mtf.setupTimeframe,
      });
    } else if (mtf.alignment === "MIXED") {
      conflictingEvidence.push({
        category: "mtf",
        explanation: `MTF alignment mixed — higher and lower timeframes disagree`,
      });
    }
  }

  // BOS confirmation
  const bosDir = tech?.bosDirection;
  if (bosDir && bosDir !== "none") {
    if (
      (currentDirection === "bullish" && bosDir === "bullish") ||
      (currentDirection === "bearish" && bosDir === "bearish")
    ) {
      continuationEvidence.push({
        category: "bos",
        explanation: `Bullish BOS confirms continuation` ,
        timeframe: tech?.smc?.timeframe,
      });
    } else {
      reversalEvidence.push({
        category: "bos",
        explanation: `BOS direction opposes current structure — potential structural shift`,
      });
    }
  }

  // CHoCH
  const chochDir = tech?.chochDirection;
  if (chochDir && chochDir !== "none") {
    if (
      (currentDirection === "bullish" && chochDir === "bearish") ||
      (currentDirection === "bearish" && chochDir === "bullish")
    ) {
      reversalEvidence.push({
        category: "choch",
        explanation: `CHoCH opposes current structure — character change detected (LTF trigger context only)`,
      });
    } else {
      continuationEvidence.push({
        category: "choch",
        explanation: `CHoCH supports current direction`,
      });
    }
  }

  // Liquidity sweep
  const smc = tech?.smc;
  if (smc) {
    const sweep = smc.recentSweep;
    if (sweep) {
      const sweepAgainstCurrent =
        (currentDirection === "bullish" && sweep.side === "buy_side") ||
        (currentDirection === "bearish" && sweep.side === "sell_side");
      if (sweepAgainstCurrent) {
        reversalEvidence.push({
          category: "liquidity",
          explanation: `Liquidity sweep against ${currentDirection} direction at ${sweep.level.toFixed(4)} — potential exhaustion signal`,
        });
      } else {
        continuationEvidence.push({
          category: "liquidity",
          explanation: `Liquidity sweep in favor of ${currentDirection} direction — resting liquidity absorbed`,
        });
      }
    }

    // Displacement
    if (smc.displacement) {
      const dispAligns =
        (currentDirection === "bullish" && smc.displacement.direction === "bullish") ||
        (currentDirection === "bearish" && smc.displacement.direction === "bearish");
      if (dispAligns) {
        continuationEvidence.push({
          category: "displacement",
          explanation: `Displacement aligned with ${currentDirection} direction`,
        });
      } else {
        reversalEvidence.push({
          category: "displacement",
          explanation: `Displacement opposes current direction — strong momentum against trend`,
        });
      }
    }
  }

  // Contradictions
  for (const c of contradictions) {
    if (c.severity === "MINOR") continue;
    conflictingEvidence.push({
      category: "contradiction",
      explanation: c.description,
    });
  }

  // Data quality limitations
  if (dq) {
    if (dq.mtf.status === "UNAVAILABLE" || dq.mtf.status === "INSUFFICIENT") {
      conflictingEvidence.push({
        category: "data_quality",
        explanation: `MTF data quality: ${dq.mtf.status} — continuation/reversal assessment incomplete`,
      });
    }
    if (dq.primaryData.status === "STALE" || dq.primaryData.status === "INSUFFICIENT") {
      conflictingEvidence.push({
        category: "data_quality",
        explanation: `Primary data quality: ${dq.primaryData.status} — structural assessment unreliable`,
      });
    }
  }

  // ── Scenario classification ──
  let scenario: ScenarioLabel;
  let continuationStatus: ConfirmationState;
  let reversalStatus: ConfirmationState;
  let confirmationState: ConfirmationState;
  let primaryScenario: string;
  let alternateScenario: string;
  let waitReason: string | undefined;

  const hasContinuation = continuationEvidence.length >= 2;
  const hasReversal = reversalEvidence.length >= 1;
  const hasConflict = conflictingEvidence.length > 0;
  const dataReliable = dq?.primaryData.status !== "STALE" && dq?.primaryData.status !== "INSUFFICIENT" && dq?.primaryData.status !== "INVALID";

  if (currentDirection === "neutral") {
    scenario = "UNCONFIRMED";
    continuationStatus = "not_applicable";
    reversalStatus = "not_applicable";
    confirmationState = "absent";
    primaryScenario = "No clear directional structure — continuation and reversal are not applicable";
    alternateScenario = "Wait for directional structure to develop";
  } else if (hasReversal && reversalEvidence.length >= 2) {
    scenario = "REVERSAL_CONFIRMED";
    continuationStatus = "absent";
    reversalStatus = "confirmed";
    confirmationState = "absent";
    primaryScenario = `${currentDirection} reversal confirmed — structural evidence supports trend change`;
    alternateScenario = `${currentDirection} continuation still possible if structural support holds`;
  } else if (hasReversal) {
    scenario = "REVERSAL_DEVELOPING";
    continuationStatus = "developing";
    reversalStatus = "developing";
    confirmationState = "developing";
    primaryScenario = `${currentDirection} trend intact but reversal risk developing — confirmation required`;
    alternateScenario = `${currentDirection} continuation remains primary if structural support holds`;
    waitReason = `Reversal signals detected against ${currentDirection} structure — continuation not yet confirmed. Wait for structural confirmation before acting.`;
  } else if (hasContinuation && !hasConflict && dataReliable) {
    scenario = "CONFIRMED_CONTINUATION";
    continuationStatus = "confirmed";
    reversalStatus = "absent";
    confirmationState = "confirmed";
    primaryScenario = `${currentDirection} continuation confirmed — multiple evidence layers support the trend`;
    alternateScenario = "No material alternate scenario at this time";
  } else if (hasContinuation && (hasConflict || !dataReliable)) {
    scenario = "CONTINUATION_DEVELOPING";
    continuationStatus = "developing";
    reversalStatus = "absent";
    confirmationState = "developing";
    primaryScenario = `${currentDirection} continuation developing — evidence supports trend but conflicts or data gaps remain`;
    alternateScenario = hasConflict ? "Conflicting evidence may resolve against the trend" : "Data quality limitations prevent full confirmation";
    waitReason = hasConflict ? "Conflicting evidence present — continuation developing but not confirmed" : "Data quality insufficient for confident continuation assessment";
  } else {
    scenario = "UNCONFIRMED";
    continuationStatus = "absent";
    reversalStatus = "absent";
    confirmationState = "absent";
    primaryScenario = `${currentDirection} structure exists but continuation confirmation is insufficient`;
    alternateScenario = "Trend may continue, consolidate, or reverse — insufficient evidence to classify";
    waitReason = `Insufficient evidence to confirm ${currentDirection} continuation — more structural confirmation needed`;
  }

  // ── Confirmation conditions ──
  const confirmationConditions: string[] = [];
  const invalidationConditions: string[] = [];

  if (currentDirection === "bullish") {
    confirmationConditions.push("Bullish BOS above recent structural high");
    confirmationConditions.push("Successful pullback hold above key support");
    if (mtf?.alignment !== "ALIGNED_BULLISH") {
      confirmationConditions.push("MTF alignment shift to ALIGNED_BULLISH");
    }
    invalidationConditions.push("Price breaks below structural support / invalidation level");
    if (result.tradePlan) {
      invalidationConditions.push(`Trade invalid if price trades through ${result.tradePlan.stopLoss}`);
    }
  } else if (currentDirection === "bearish") {
    confirmationConditions.push("Bearish BOS below recent structural low");
    confirmationConditions.push("Failed reclaim of key resistance");
    if (mtf?.alignment !== "ALIGNED_BEARISH") {
      confirmationConditions.push("MTF alignment shift to ALIGNED_BEARISH");
    }
    invalidationConditions.push("Price breaks above structural resistance / invalidation level");
    if (result.tradePlan) {
      invalidationConditions.push(`Trade invalid if price trades through ${result.tradePlan.stopLoss}`);
    }
  } else {
    confirmationConditions.push("Valid directional structure must develop (HH/HL or LH/LL)");
    confirmationConditions.push("At least 2 core factors must agree on direction");
    invalidationConditions.push("No active thesis — no invalidation applicable");
  }

  if (result.keyLevels.invalidation) {
    invalidationConditions.push(`Primary invalidation level: ${result.keyLevels.invalidation}`);
  }

  // ── Risk assessment ──
  const structuralRisk: StructuralRisk =
    structDir === "none" ? "high" :
    vetoApplied ? "elevated" :
    hasReversal ? "elevated" :
    hasConflict ? "moderate" : "low";

  const extensionRisk: StructuralRisk =
    (smc?.displacement && Math.abs(smc.displacement.rangeAtrMultiple) > 3) ? "elevated" :
    hasReversal ? "moderate" : "low";

  const liquidityRisk: StructuralRisk =
    (smc?.recentSweep) ? "elevated" :
    conflictingEvidence.some((e) => e.category === "liquidity") ? "moderate" : "low";

  return {
    currentDirection,
    scenario,
    continuationStatus,
    reversalStatus,
    confirmationState,
    continuationEvidence,
    reversalEvidence,
    conflictingEvidence,
    confirmationConditions,
    invalidationConditions,
    primaryScenario,
    alternateScenario,
    waitReason,
    structuralRisk,
    extensionRisk,
    liquidityRisk,
  };
}
