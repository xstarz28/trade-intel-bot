/**
 * Phase 57 — Protection Engine
 *
 * Orchestrates position state, thesis health, shock detection,
 * and lifecycle into a unified profit protection alert.
 *
 * Pure functions — no side effects, no network calls.
 * Same inputs → same output (deterministic).
 */

import type {
  PositionContext,
  ProtectionAlert,
  AlertSeverity,
  ProfitMetrics,
  ShockAssessment,
  MonitoringState,
  ProfitProtectionUrgency,
  WhyTpNowExplanation,
} from "./types";
import { alertSeverityRank } from "./types";
import { calculateProfitMetrics } from "./profit-state";
import {
  evaluateThesisHealth,
  extractAllSignals,
  type MarketEvidence,
} from "./thesis-health";
import { detectShock } from "./shock-detector";
import { computeProtectionReference } from "./protection-reference";
import {
  createMonitoringState,
  shouldAlert,
  updateMonitoringState,
  deduplicateByDependencyGroup,
} from "./alert-lifecycle";

// ═══════════════════════════════════════════════════════════════
// ALERT SEVERITY DETERMINATION
// ═══════════════════════════════════════════════════════════════

function determineAlertSeverity(
  profit: ProfitMetrics,
  thesisHealth: { state: string; score: number; deteriorationCount: number },
  shock: ShockAssessment,
  givebackPct?: number,
): AlertSeverity {
  const isProfitable = profit.profitState === "PROFITABLE" || profit.profitState === "STRONGLY_PROFITABLE";

  // Thesis invalidated
  if (thesisHealth.state === "INVALIDATED") {
    return "INVALIDATED";
  }

  // Severe deterioration
  if (thesisHealth.state === "SEVERELY_DETERIORATING") {
    return isProfitable ? "HIGH_RISK" : "CAUTION";
  }

  // Active deterioration
  if (thesisHealth.state === "DETERIORATING") {
    // Profitable + deteriorating = CAUTION
    if (isProfitable && thesisHealth.deteriorationCount >= 3) {
      return "HIGH_RISK";
    }
    if (isProfitable) {
      return "CAUTION";
    }
    return "WATCH";
  }

  // Shock detected
  if (shock.state === "SHOCK" && isProfitable) {
    return "CAUTION";
  }
  if (shock.state === "ELEVATED" && isProfitable && thesisHealth.score < 70) {
    return "WATCH";
  }

  // Profit giveback with deterioration evidence
  if (givebackPct !== undefined && givebackPct > 30 && isProfitable && thesisHealth.deteriorationCount >= 2) {
    return "CAUTION";
  }

  // Stable but with some concern
  if (thesisHealth.state === "STABLE" && thesisHealth.deteriorationCount >= 1) {
    return "WATCH";
  }

  // Healthy
  if (thesisHealth.state === "HEALTHY") {
    return "NONE";
  }

  // Default: if profitable and thesis unknown, be cautious
  if (thesisHealth.state === "UNKNOWN" && !isProfitable) {
    return "NONE";
  }

  return "NONE";
}

// ═══════════════════════════════════════════════════════════════
// ACTION RECOMMENDATION
// ═══════════════════════════════════════════════════════════════

function determineAction(severity: AlertSeverity, profit: ProfitMetrics): string {
  switch (severity) {
    case "NONE":
      return "Hold and monitor.";
    case "WATCH":
      return "Monitor conditions closely.";
    case "CAUTION":
      if (profit.profitState === "STRONGLY_PROFITABLE") {
        return "Consider securing partial profit manually.";
      }
      return "Consider protecting existing profit.";
    case "HIGH_RISK":
      return "Consider manually securing part or all of the existing profit.";
    case "INVALIDATED":
      return "Original thesis is no longer supported. Consider closing or hedging manually.";
  }
}

// ═══════════════════════════════════════════════════════════════
// URGENCY DETERMINATION
// ═══════════════════════════════════════════════════════════════

function determineUrgency(
  severity: AlertSeverity,
  profit: ProfitMetrics,
  thesisHealth: { state: string; score: number; deteriorationCount: number; confirmingCount: number },
  shock: ShockAssessment,
  givebackPct?: number,
): { urgency: ProfitProtectionUrgency; reason: string } {
  const isProfitable = profit.profitState === "PROFITABLE" || profit.profitState === "STRONGLY_PROFITABLE";

  if (severity === "INVALIDATED") {
    return { urgency: "CRITICAL", reason: "Thesis invalidated — key conditions supporting the position are no longer present." };
  }

  if (severity === "HIGH_RISK") {
    const factors = thesisHealth.deteriorationCount;
    return {
      urgency: "HIGH",
      reason: `${factors} independent deterioration signals detected with significant thesis weakening. Profit giveback risk is materializing.`,
    };
  }

  if (severity === "CAUTION") {
    if (shock.state === "SHOCK") {
      return { urgency: "HIGH", reason: "Market shock detected while thesis is deteriorating. Rapid reversal risk increasing." };
    }
    if (givebackPct !== undefined && givebackPct > 40) {
      return { urgency: "MODERATE", reason: `Significant giveback (${givebackPct.toFixed(0)}%) combined with multiple deterioration signals.` };
    }
    return {
      urgency: "MODERATE",
      reason: `${thesisHealth.deteriorationCount} signals indicate increasing risk. Thesis health: ${thesisHealth.score}/100.`,
    };
  }

  if (severity === "WATCH") {
    return {
      urgency: "LOW",
      reason: "Early deterioration detected. Monitor conditions closely for potential escalation.",
    };
  }

  return { urgency: "NONE", reason: "No urgency — position thesis appears healthy." };
}

// ═══════════════════════════════════════════════════════════════
// WHY TP NOW? EXPLANATION
// ═══════════════════════════════════════════════════════════════

function buildWhyTpNow(
  severity: AlertSeverity,
  profit: ProfitMetrics,
  thesisHealth: { state: string; score: number; deteriorationCount: number; confirmingCount: number },
  shock: ShockAssessment,
  supportingEvidence: string[],
  conflictingEvidence: string[],
  missingData: string[],
  givebackPct?: number,
): WhyTpNowExplanation {
  const rStr = profit.rMultiple !== undefined ? `${profit.rMultiple >= 0 ? "+" : ""}${profit.rMultiple.toFixed(2)}R` : `${profit.distanceFromEntryPct.toFixed(1)}%`;
  const profitStatus = `${rStr} unrealized ${profit.profitState.toLowerCase().replace("_", " ")}`;

  // What changed — list conflicting evidence
  const whatChanged = conflictingEvidence.slice(0, 5);

  // Confirmations — independent evidence groups
  const independentGroups = conflictingEvidence.length;
  const confirmations: string[] = [];
  if (independentGroups >= 4) {
    confirmations.push(`${independentGroups} independent evidence groups deteriorated — strong confirmation of reversal risk.`);
  } else if (independentGroups >= 2) {
    confirmations.push(`${independentGroups} independent evidence groups deteriorated.`);
  }
  if (thesisHealth.state === "SEVERELY_DETERIORATING") {
    confirmations.push(`Thesis health severely deteriorating (${thesisHealth.score}/100).`);
  }
  if (shock.state === "SHOCK") {
    confirmations.push(`Market shock detected — ${shock.description}`);
  }

  // Still supporting
  const stillSupporting = supportingEvidence.slice(0, 5);

  // Missing evidence
  const missingEvidence = missingData.slice(0, 3);

  // Urgency and action
  let urgencyIncreased = "";
  let suggestedAction = "";

  switch (severity) {
    case "WATCH":
      urgencyIncreased = "Early deterioration detected — monitoring conditions closely.";
      suggestedAction = "No immediate action needed. Continue monitoring.";
      break;
    case "CAUTION":
      urgencyIncreased = "Multiple signals indicate increasing risk. Thesis health is weakening.";
      suggestedAction = "Consider securing partial profit manually if position remains strong.";
      break;
    case "HIGH_RISK":
      urgencyIncreased = "Significant thesis deterioration combined with profit giveback. Risk of further adverse movement is materializing.";
      suggestedAction = "Consider manually securing part or all of the existing profit.";
      break;
    case "INVALIDATED":
      urgencyIncreased = "Original thesis is no longer supported by market evidence.";
      suggestedAction = "Consider closing or hedging the position manually.";
      break;
    default:
      urgencyIncreased = "No urgency.";
      suggestedAction = "Hold and monitor.";
  }

  return {
    profitStatus,
    whatChanged,
    confirmations,
    stillSupporting,
    missingEvidence,
    urgencyIncreased,
    suggestedAction,
    disclaimer: "This is an informational risk-protection alert, not an automatic trade instruction. Classification confidence ≠ likelihood of price movement.",
  };
}

// ═══════════════════════════════════════════════════════════════
// ALERT MESSAGE
// ═══════════════════════════════════════════════════════════════

function buildAlertMessage(
  severity: AlertSeverity,
  thesisHealth: { state: string; score: number; deteriorationCount: number },
  profit: ProfitMetrics,
  shock: ShockAssessment,
  supportingCount: number,
): string {
  switch (severity) {
    case "NONE":
      return "Position thesis appears healthy. No protection action needed.";
    case "WATCH":
      return `Watch: early deterioration detected (thesis score: ${thesisHealth.score}/100). Monitor conditions.`;
    case "CAUTION":
      return `Caution: multiple signals indicate increasing risk. Thesis health: ${thesisHealth.state} (${thesisHealth.score}/100). Consider protecting existing profit.`;
    case "HIGH_RISK":
      return `High risk: significant thesis deterioration detected. ${thesisHealth.deteriorationCount} adverse signals. Current profit: ${profit.rMultiple !== undefined ? `${profit.rMultiple.toFixed(1)}R` : `${profit.distanceFromEntryPct.toFixed(2)}%`}. Consider securing profit.`;
    case "INVALIDATED":
      return `Thesis invalidated: key conditions supporting this position are no longer present. Original thesis score: ${thesisHealth.score}/100.`;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN ENGINE
// ═══════════════════════════════════════════════════════════════

export interface ProtectionEngineInput {
  position: PositionContext;
  evidence: MarketEvidence;
  monitoringState?: MonitoringState;
  now?: number;
}

export interface ProtectionEngineResult {
  alert: ProtectionAlert;
  updatedMonitoringState: MonitoringState;
}

export function evaluateProtection(input: ProtectionEngineInput): ProtectionEngineResult {
  const { position, evidence, now } = input;
  const timestamp = now ?? Date.now();

  // 1. Calculate profit metrics
  const profit = calculateProfitMetrics(position);

  // 2. Update peak profit for giveback tracking
  const isProfit = profit.profitState === "PROFITABLE" || profit.profitState === "STRONGLY_PROFITABLE";
  const currentProfit = profit.unrealizedPnL;

  // When the live P/L is unknown, the previously recorded peak must be left
  // untouched. Overwriting or comparing against an unknown value would either
  // erase a real peak or silently skip the giveback check — note that every
  // comparison against NaN is false, which is exactly how this failed before.
  let peakProfitSeen = input.monitoringState?.peakProfitSeen;
  if (
    currentProfit !== undefined &&
    isProfit &&
    (peakProfitSeen === undefined || currentProfit > peakProfitSeen)
  ) {
    peakProfitSeen = currentProfit;
  }

  // Recalculate giveback if we have peak
  if (
    currentProfit !== undefined &&
    peakProfitSeen !== undefined &&
    peakProfitSeen > 0 &&
    currentProfit < peakProfitSeen
  ) {
    profit.peakProfit = peakProfitSeen;
    profit.givebackPct = ((peakProfitSeen - currentProfit) / peakProfitSeen) * 100;
  }

  // 3. Evaluate thesis health
  const thesisHealth = evaluateThesisHealth(position, evidence);

  // 4. Extract and deduplicate signals
  const { deterioration, confirming } = extractAllSignals(position, evidence);
  const deduplicated = deduplicateByDependencyGroup(deterioration);

  // 5. Detect shock
  const shock = detectShock(evidence);

  // 6. Compute protection reference
  const protectionRef = computeProtectionReference(position, evidence);

  // 7. Determine alert severity
  const severity = determineAlertSeverity(
    profit,
    thesisHealth,
    shock,
    profit.givebackPct,
  );

  // 8. Build supporting/conflicting/missing evidence lists
  const supportingEvidence: string[] = [];
  const conflictingEvidence: string[] = [];
  const missingData: string[] = [];

  for (const sig of deduplicated) {
    conflictingEvidence.push(`${sig.description} [${sig.category}]`);
  }
  for (const c of confirming) {
    supportingEvidence.push(c);
  }
  // Check for missing data
  if (!evidence.shortTermTrend) missingData.push("short-term trend");
  if (!evidence.mediumTermTrend) missingData.push("medium-term trend");
  if (evidence.volatility === undefined) missingData.push("volatility data");
  if (evidence.riskRegime === undefined) missingData.push("risk regime");
  if (evidence.momentumChange === undefined) missingData.push("momentum data");

  // 9. Lifecycle check
  const state = input.monitoringState ?? createMonitoringState(position.instrument);
  const alertDecision = shouldAlert(state, severity, timestamp);

  // 10. Update monitoring state
  let updatedState: MonitoringState;
  if (alertDecision.shouldFire) {
    updatedState = updateMonitoringState(state, severity, timestamp);
  } else {
    updatedState = { ...state, peakProfitSeen };
  }
  updatedState.peakProfitSeen = peakProfitSeen;

  // 11. Compute urgency
  const { urgency, reason: urgencyReason } = determineUrgency(
    severity, profit, thesisHealth, shock, profit.givebackPct,
  );

  // 12. Build "Why TP Now?" explanation
  const whyTpNow = buildWhyTpNow(
    severity, profit, thesisHealth, shock, supportingEvidence, conflictingEvidence, missingData, profit.givebackPct,
  );

  // 13. Build the alert
  const alert: ProtectionAlert = {
    instrument: position.instrument,
    side: position.side,
    severity,
    urgency,
    urgencyReason,
    whyTpNow,
    thesisHealth: thesisHealth.state as any,
    thesisHealthScore: thesisHealth.score,
    profit,
    shock,
    supportingEvidence,
    conflictingEvidence,
    missingData,
    alertMessage: buildAlertMessage(severity, thesisHealth, profit, shock, supportingEvidence.length),
    actionRecommendation: determineAction(severity, profit),
    protectionReference: protectionRef.available ? protectionRef.level : undefined,
    deteriorationSignals: deduplicated,
    timestamp,
    previousSeverity: state.currentSeverity,
    stateTransition: severity !== state.currentSeverity,
  };

  return { alert, updatedMonitoringState: updatedState };
}
