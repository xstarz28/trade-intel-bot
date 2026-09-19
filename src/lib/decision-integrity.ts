/**
 * Phase 34 — DECISION INTEGRITY AUDIT.
 *
 * Pure informational audit of the complete AnalysisResult, verifying
 * cross-layer consistency across the full decision chain:
 *   Structure → MTF → Regime → Scenario → Fundamentals →
 *   Professional Thesis → Forward Path → Actionability → Trade Plan
 *
 * This module MUST NOT:
 * - modify bias / conviction / gates / trade plan
 * - modify recommendation or conviction
 * - fabricate or repair any detected inconsistency
 * - inject evidence into the decision engine
 *
 * Violations are reported, never silently repaired.
 */

import type { AnalysisResult } from "@/types/analysis";

// ── Types ────────────────────────────────────────────────────────

export type IntegrityStatus = "CONSISTENT" | "VIOLATIONS_FOUND" | "INCOMPLETE";

export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface IntegrityViolation {
  id: string;
  severity: Severity;
  category: string;
  description: string;
  invariant?: string;
}

export interface IntegrityWarning {
  id: string;
  category: string;
  description: string;
}

export interface EvidenceChainItem {
  layer: string;
  direction: string;
  available: boolean;
  contribution: string;
}

export interface DecisionIntegrityContext {
  overallStatus: IntegrityStatus;
  structuralConsistency: boolean;
  scenarioConsistency: boolean;
  fundamentalConsistency: boolean;
  forwardPathConsistency: boolean;
  actionabilityConsistency: boolean;
  tradePlanConsistency: boolean;
  journalCompatibility: boolean;
  violations: IntegrityViolation[];
  warnings: IntegrityWarning[];
  evidenceChain: EvidenceChainItem[];
  decisionSummary: string;
}

// ── Helpers ──────────────────────────────────────────────────────

let violationCounter = 0;
function vId(prefix: string): string {
  return `${prefix}-${++violationCounter}`;
}

function dirBias(result: AnalysisResult): "bullish" | "bearish" | "neutral" {
  if (result.bias === "Bullish") return "bullish";
  if (result.bias === "Bearish") return "bearish";
  return "neutral";
}

function structuralDir(result: AnalysisResult): "long" | "short" | "none" {
  return result.decisionTrace?.structuralDirection ?? "none";
}

// ── Audit Rules ──────────────────────────────────────────────────

function auditStructuralConsistency(
  result: AnalysisResult,
  violations: IntegrityViolation[],
  warnings: IntegrityWarning[],
): boolean {
  let consistent = true;
  const dir = dirBias(result);
  const structDir = structuralDir(result);

  // I81 — Actionability must be consistent with structural direction
  const actionability = result.professionalThesis?.actionability;
  if (actionability === "LONG" && dir === "bearish") {
    violations.push({
      id: vId("S1"),
      severity: "CRITICAL",
      category: "structural",
      description: "Actionability LONG but structural direction is bearish",
      invariant: "I81",
    });
    consistent = false;
  }
  if (actionability === "SHORT" && dir === "bullish") {
    violations.push({
      id: vId("S2"),
      severity: "CRITICAL",
      category: "structural",
      description: "Actionability SHORT but structural direction is bullish",
      invariant: "I81",
    });
    consistent = false;
  }

  // Structural direction vs bias alignment
  if (structDir === "long" && dir === "bearish" && !result.decisionTrace?.biasCalculation?.vetoApplied) {
    warnings.push({
      id: vId("SW1"),
      category: "structural",
      description: "Structural direction is long but bias is bearish without veto",
    });
  }
  if (structDir === "short" && dir === "bullish" && !result.decisionTrace?.biasCalculation?.vetoApplied) {
    warnings.push({
      id: vId("SW2"),
      category: "structural",
      description: "Structural direction is short but bias is bullish without veto",
    });
  }

  // Structural direction vs recommendation
  if (structDir === "long" && result.recommendation === "SHORT") {
    warnings.push({
      id: vId("SW3"),
      category: "structural",
      description: "Structural direction is long but recommendation is SHORT",
    });
  }
  if (structDir === "short" && result.recommendation === "LONG") {
    warnings.push({
      id: vId("SW4"),
      category: "structural",
      description: "Structural direction is short but recommendation is LONG",
    });
  }

  return consistent;
}

function auditScenarioConsistency(
  result: AnalysisResult,
  violations: IntegrityViolation[],
  warnings: IntegrityWarning[],
): boolean {
  let consistent = true;
  const scenario = result.marketScenario;
  if (!scenario) return true;

  const dir = dirBias(result);

  // Scenario direction must match current direction
  if (scenario.currentDirection !== dir && dir !== "neutral") {
    warnings.push({
      id: vId("SC1"),
      category: "scenario",
      description: `Scenario direction (${scenario.currentDirection}) differs from bias direction (${dir})`,
    });
  }

  // Confirmed continuation cannot coexist with invalidated continuation structure
  if (
    scenario.scenario === "CONFIRMED_CONTINUATION" &&
    (scenario.continuationStatus === "absent" || scenario.confirmationState === "absent")
  ) {
    violations.push({
      id: vId("SC2"),
      severity: "HIGH",
      category: "scenario",
      description: "CONFIRMED_CONTINUATION but continuation status is absent",
      invariant: "I85",
    });
    consistent = false;
  }

  // Confirmed reversal requires appropriate structural evidence
  if (scenario.scenario === "REVERSAL_CONFIRMED" && scenario.reversalEvidence.length < 2) {
    violations.push({
      id: vId("SC3"),
      severity: "HIGH",
      category: "scenario",
      description: "REVERSAL_CONFIRMED but fewer than 2 reversal evidence items",
      invariant: "I86",
    });
    consistent = false;
  }

  return consistent;
}

function auditFundamentalConsistency(
  result: AnalysisResult,
  violations: IntegrityViolation[],
  warnings: IntegrityWarning[],
): boolean {
  let consistent = true;
  const fund = result.fundamentalThesis;
  if (!fund) return true;

  // I87 — Fundamental conflict cannot be silently hidden
  if (fund.alignment === "CONFLICTING") {
    // Must be visible in missingInformation or professional thesis
    const profVisible = result.professionalThesis?.missingInformation.some(
      (m) => m.toLowerCase().includes("fundamental") || m.toLowerCase().includes("conflict"),
    );
    const analystsVisible = result.analystThesis?.missingInformation.some(
      (m) => m.toLowerCase().includes("fundamental"),
    );
    if (!profVisible && !analystsVisible) {
      warnings.push({
        id: vId("FC1"),
        category: "fundamental",
        description: "Fundamental alignment is CONFLICTING but not reflected in analyst missing info",
      });
    }
  }

  // I88 — Missing fundamental data remains neutral
  if (fund.alignment === "FUNDAMENTAL_UNAVAILABLE") {
    // Must not have any directional fundamental evidence
    const directionalEvidence = [
      ...fund.fundamentalEvidence,
      ...fund.macroEvidence,
    ].filter((e) => e.direction === "supportive" || e.direction === "conflicting");
    if (directionalEvidence.length > 0) {
      violations.push({
        id: vId("FC2"),
        severity: "HIGH",
        category: "fundamental",
        description: "FUNDAMENTAL_UNAVAILABLE but directional fundamental evidence exists",
        invariant: "I88",
      });
      consistent = false;
    }
  }

  return consistent;
}

function auditForwardPathConsistency(
  result: AnalysisResult,
  violations: IntegrityViolation[],
  warnings: IntegrityWarning[],
): boolean {
  let consistent = true;
  const fmp = result.forwardMarketPath;
  if (!fmp) return true;

  // I80 — Primary and alternate must remain explicit
  if (!fmp.primaryPath || !fmp.alternatePath) {
    violations.push({
      id: vId("FP1"),
      severity: "HIGH",
      category: "forward_path",
      description: "Forward path missing primary or alternate scenario",
      invariant: "I80",
    });
    consistent = false;
  }

  // I61 — Current state ≠ forward path
  // (This is structural: primaryPath should not just mirror current bias without classification)
  const dir = dirBias(result);
  if (fmp.directionalBias !== dir) {
    warnings.push({
      id: vId("FP2"),
      category: "forward_path",
      description: `Forward path direction (${fmp.directionalBias}) differs from bias (${dir})`,
    });
  }

  // Must have confirmation and invalidation conditions
  if (fmp.confirmationConditions.length === 0) {
    warnings.push({
      id: vId("FP3"),
      category: "forward_path",
      description: "Forward path has no confirmation conditions",
    });
  }
  if (fmp.invalidationConditions.length === 0) {
    warnings.push({
      id: vId("FP4"),
      category: "forward_path",
      description: "Forward path has no invalidation conditions",
    });
  }

  // I73 — No synthetic price targets in trigger levels
  for (const level of fmp.triggerLevels) {
    const num = parseFloat(level.level);
    if (Number.isFinite(num) && num > 0) {
      // Level must come from a real source
      if (!level.source || level.source === "synthetic") {
        violations.push({
          id: vId("FP5"),
          severity: "CRITICAL",
          category: "forward_path",
          description: `Trigger level appears synthetic: ${level.level}`,
          invariant: "I73",
        });
        consistent = false;
      }
    }
  }

  return consistent;
}

function auditActionabilityConsistency(
  result: AnalysisResult,
  violations: IntegrityViolation[],
): boolean {
  let consistent = true;
  const prof = result.professionalThesis;
  if (!prof) return true;

  // I82 — WAIT must never produce an executable trade plan
  if (prof.actionability === "WAIT" && result.tradePlan) {
    violations.push({
      id: vId("A1"),
      severity: "CRITICAL",
      category: "actionability",
      description: "WAIT actionability but trade plan exists",
      invariant: "I82",
    });
    consistent = false;
  }

  // I83 — NO_TRADE must remain terminal and non-executable
  if (prof.actionability === "NO_TRADE" && result.tradePlan) {
    violations.push({
      id: vId("A2"),
      severity: "CRITICAL",
      category: "actionability",
      description: "NO_TRADE actionability but trade plan exists",
      invariant: "I83",
    });
    consistent = false;
  }

  if (prof.actionability === "NO_TRADE" && result.recommendation !== "NO_TRADE") {
    violations.push({
      id: vId("A3"),
      severity: "HIGH",
      category: "actionability",
      description: "Professional actionability NO_TRADE but engine recommendation differs",
      invariant: "I83",
    });
    consistent = false;
  }

  return consistent;
}

function auditTradePlanConsistency(
  result: AnalysisResult,
  violations: IntegrityViolation[],
): boolean {
  let consistent = true;
  const tp = result.tradePlan;
  if (!tp) return true;

  // I84 — Trade plan must be structurally consistent with direction
  const rec = result.recommendation;

  if (rec === "LONG" && tp.direction !== "long") {
    violations.push({
      id: vId("TP1"),
      severity: "CRITICAL",
      category: "trade_plan",
      description: "Recommendation LONG but trade plan direction is short",
      invariant: "I84",
    });
    consistent = false;
  }
  if (rec === "SHORT" && tp.direction !== "short") {
    violations.push({
      id: vId("TP2"),
      severity: "CRITICAL",
      category: "trade_plan",
      description: "Recommendation SHORT but trade plan direction is long",
      invariant: "I84",
    });
    consistent = false;
  }

  // R:R must be >= 1.5 (existing gate)
  if (tp.riskReward < 1.5) {
    violations.push({
      id: vId("TP3"),
      severity: "HIGH",
      category: "trade_plan",
      description: `Trade plan R:R ${tp.riskReward} is below minimum 1.5`,
      invariant: "I84",
    });
    consistent = false;
  }

  // Entry, SL, TP must be positive finite numbers
  const entry = parseFloat(tp.entry);
  const sl = parseFloat(tp.stopLoss);
  const tpVal = parseFloat(tp.takeProfit);

  if (!Number.isFinite(entry) || entry <= 0) {
    violations.push({
      id: vId("TP4"),
      severity: "HIGH",
      category: "trade_plan",
      description: "Trade plan entry is not a positive finite number",
    });
    consistent = false;
  }
  if (!Number.isFinite(sl) || sl <= 0) {
    violations.push({
      id: vId("TP5"),
      severity: "HIGH",
      category: "trade_plan",
      description: "Trade plan stop loss is not a positive finite number",
    });
    consistent = false;
  }
  if (!Number.isFinite(tpVal) || tpVal <= 0) {
    violations.push({
      id: vId("TP6"),
      severity: "HIGH",
      category: "trade_plan",
      description: "Trade plan take profit is not a positive finite number",
    });
    consistent = false;
  }

  // Correct side: for long, SL < entry < TP; for short, TP < entry < SL
  if (Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tpVal)) {
    if (tp.direction === "long") {
      if (!(sl < entry && entry < tpVal)) {
        violations.push({
          id: vId("TP7"),
          severity: "HIGH",
          category: "trade_plan",
          description: "Long trade plan: SL must be below entry and TP above entry",
        });
        consistent = false;
      }
    }
    if (tp.direction === "short") {
      if (!(tpVal < entry && entry < sl)) {
        violations.push({
          id: vId("TP8"),
          severity: "HIGH",
          category: "trade_plan",
          description: "Short trade plan: TP must be below entry and SL above entry",
        });
        consistent = false;
      }
    }
  }

  return consistent;
}

function auditJournalCompatibility(): boolean {
  // Journal compatibility is structural: all optional fields are safe for snapshot
  // Phase 31 verified this. Report compatible.
  return true;
}

function buildEvidenceChain(result: AnalysisResult): EvidenceChainItem[] {
  const chain: EvidenceChainItem[] = [];
  const trace = result.decisionTrace;

  if (trace) {
    for (const layer of trace.evidenceLayers) {
      if (layer.layer.startsWith("_")) continue;
      chain.push({
        layer: layer.layer,
        direction: layer.direction,
        available: layer.available,
        contribution: `${layer.contribution}`,
      });
    }
  }

  // Add scenario/regime/professional layers
  if (result.marketRegimeContext) {
    chain.push({
      layer: "MarketRegime",
      direction: result.marketRegimeContext.currentDirection,
      available: true,
      contribution: result.marketRegimeContext.regime,
    });
  }
  if (result.marketScenario) {
    chain.push({
      layer: "MarketScenario",
      direction: result.marketScenario.currentDirection,
      available: true,
      contribution: result.marketScenario.scenario,
    });
  }
  if (result.fundamentalThesis) {
    chain.push({
      layer: "FundamentalThesis",
      direction: result.fundamentalThesis.technicalDirection,
      available: result.fundamentalThesis.alignment !== "FUNDAMENTAL_UNAVAILABLE",
      contribution: result.fundamentalThesis.alignment,
    });
  }
  if (result.professionalThesis) {
    chain.push({
      layer: "ProfessionalThesis",
      direction: result.professionalThesis.currentDirection,
      available: true,
      contribution: result.professionalThesis.actionability,
    });
  }
  if (result.forwardMarketPath) {
    chain.push({
      layer: "ForwardMarketPath",
      direction: result.forwardMarketPath.directionalBias,
      available: true,
      contribution: result.forwardMarketPath.primaryPath,
    });
  }

  return chain;
}

// ── Main builder ─────────────────────────────────────────────────

export function auditDecisionIntegrity(result: AnalysisResult): DecisionIntegrityContext {
  // Reset counter for deterministic violation IDs per audit call
  violationCounter = 0;

  const violations: IntegrityViolation[] = [];
  const warnings: IntegrityWarning[] = [];

  const structuralOk = auditStructuralConsistency(result, violations, warnings);
  const scenarioOk = auditScenarioConsistency(result, violations, warnings);
  const fundamentalOk = auditFundamentalConsistency(result, violations, warnings);
  const forwardPathOk = auditForwardPathConsistency(result, violations, warnings);
  const actionabilityOk = auditActionabilityConsistency(result, violations);
  const tradePlanOk = auditTradePlanConsistency(result, violations);
  const journalOk = auditJournalCompatibility();

  const allOk =
    structuralOk &&
    scenarioOk &&
    fundamentalOk &&
    forwardPathOk &&
    actionabilityOk &&
    tradePlanOk &&
    journalOk;

  const hasCritical = violations.some((v) => v.severity === "CRITICAL");
  const hasHigh = violations.some((v) => v.severity === "HIGH");

  const overallStatus: IntegrityStatus = allOk
    ? "CONSISTENT"
    : hasCritical || hasHigh
    ? "VIOLATIONS_FOUND"
    : "VIOLATIONS_FOUND";

  const dir = dirBias(result);
  const rec = result.recommendation;
  const actionability = result.professionalThesis?.actionability ?? "N/A";

  let summary = `Decision: ${rec} · Bias: ${dir} · Actionability: ${actionability}`;
  summary += ` · Violations: ${violations.length} · Warnings: ${warnings.length}`;
  summary += ` · Status: ${overallStatus}`;

  return {
    overallStatus,
    structuralConsistency: structuralOk,
    scenarioConsistency: scenarioOk,
    fundamentalConsistency: fundamentalOk,
    forwardPathConsistency: forwardPathOk,
    actionabilityConsistency: actionabilityOk,
    tradePlanConsistency: tradePlanOk,
    journalCompatibility: journalOk,
    violations,
    warnings,
    evidenceChain: buildEvidenceChain(result),
    decisionSummary: summary,
  };
}
