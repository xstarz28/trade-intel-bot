/**
 * Phase 93 — Custom Trader Alert Rules & Intelligence Triggers
 *
 * Deterministic rule evaluation engine.
 * Pure functions — no side effects, no network calls.
 * No fabrication, no probability, no auto-execution.
 */

import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type RuleScope = "POSITION" | "INSTRUMENT" | "PORTFOLIO" | "GLOBAL";

export type RuleSeverity = "INFO" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type RuleCondition =
  | "THESIS_STATE_CHANGED"
  | "THESIS_BECAME_DETERIORATING"
  | "THESIS_BECAME_INVALIDATED"
  | "REGIME_CHANGED"
  | "H1_TREND_CHANGED"
  | "M15_TREND_CHANGED"
  | "M5_TREND_CHANGED"
  | "STRUCTURE_CHANGED"
  | "MOMENTUM_CHANGED"
  | "VOLATILITY_CHANGED"
  | "EVIDENCE_QUALITY_CHANGED"
  | "SUPPORTING_EVIDENCE_CHANGED"
  | "CONFLICTING_EVIDENCE_CHANGED"
  | "NEWS_BECAME_CONFLICTING"
  | "NEWS_BECAME_SUPPORTING"
  | "MACRO_REGIME_CHANGED"
  | "CROSS_ASSET_CONFLICT"
  | "PORTFOLIO_CONCENTRATION_DETECTED"
  | "PORTFOLIO_CONFLICT_DETECTED"
  | "DATA_BECAME_UNAVAILABLE"
  | "DATA_RECOVERED";

/** Snapshot type used for previous-state comparison in rule evaluation. */
export interface RuleSnapshot {
  thesisState: string;
  marketRegime: string;
  evidenceQuality: string;
  structure?: string;
  momentum?: string;
  volatility?: string;
  h1Trend?: string;
  m15Trend?: string;
  m5Trend?: string;
  supportingCount: number;
  conflictingCount: number;
}

export interface AlertRule {
  ruleId: string;
  userId: string;
  name: string;
  enabled: boolean;
  scope: RuleScope;
  instrument?: string;
  positionId?: string;
  condition: RuleCondition;
  severity: RuleSeverity;
  cooldownMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface RuleAlert {
  alertId: string;
  ruleId: string;
  ruleName: string;
  userId: string;
  positionId?: string;
  instrument?: string;
  condition: RuleCondition;
  severity: RuleSeverity;
  description: string;
  previousState?: string;
  currentState?: string;
  timestamp: number;
  source: "CUSTOM_RULE";
}

export interface RuleEvaluationContext {
  positionIntelligence: Map<string, PositionIntelligence>;
  portfolioIntelligence?: PortfolioIntelligence;
  previousSnapshots?: Map<string, RuleSnapshot>;
  previousNewsStance?: Map<string, "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE">;
  newsStance?: Map<string, "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE">;
  previousMacroRegime?: string;
  macroRegime?: string;
  previousDataAvailability?: Map<string, string>;
}

export interface RuleTriggerRecord {
  ruleId: string;
  positionId?: string;
  lastTriggeredAt: number;
  lastConditionTrue: boolean;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const MAX_RULES_PER_USER = 50;
export const MAX_ALERTS_PER_EVALUATION = 20;

const SEVERITY_ORDER: RuleSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

// ═══════════════════════════════════════════════════════════════
// ALERT IDENTITY
// ═══════════════════════════════════════════════════════════════

export function alertIdentity(
  ruleId: string,
  positionId: string | undefined,
  condition: RuleCondition,
  stateTimestamp: number,
): string {
  return `${ruleId}:${positionId ?? "global"}:${condition}:${stateTimestamp}`;
}

// ═══════════════════════════════════════════════════════════════
// COOLDOWN / DEDUP
// ═══════════════════════════════════════════════════════════════

export function shouldTriggerAlert(
  rule: AlertRule,
  triggerRecords: Map<string, RuleTriggerRecord>,
  now: number,
): boolean {
  if (!rule.enabled) return false;

  const key = `${rule.ruleId}:${rule.positionId ?? "global"}`;
  const record = triggerRecords.get(key);

  if (!record) return true; // Never triggered before

  const cooldownElapsed = now - record.lastTriggeredAt >= rule.cooldownMs;
  return cooldownElapsed;
}

export function updateTriggerRecord(
  existing: Map<string, RuleTriggerRecord>,
  rule: AlertRule,
  now: number,
): Map<string, RuleTriggerRecord> {
  const updated = new Map(existing);
  const key = `${rule.ruleId}:${rule.positionId ?? "global"}`;
  updated.set(key, {
    ruleId: rule.ruleId,
    positionId: rule.positionId,
    lastTriggeredAt: now,
    lastConditionTrue: true,
  });
  return updated;
}

// ═══════════════════════════════════════════════════════════════
// CONDITION EVALUATION
// ═══════════════════════════════════════════════════════════════

interface EvalResult {
  triggered: boolean;
  description: string;
  previousState?: string;
  currentState?: string;
}

function evalThesisStateChanged(
  intel: PositionIntelligence,
  prev: { thesisState: string } | undefined,
): EvalResult {
  if (!prev) return { triggered: false, description: "" };
  const changed = prev.thesisState !== intel.thesisHealth;
  return {
    triggered: changed,
    description: changed
      ? `Thesis state changed from ${prev.thesisState} to ${intel.thesisHealth}`
      : "",
    previousState: prev.thesisState,
    currentState: intel.thesisHealth,
  };
}

function evalThesisBecameDeteriorating(
  intel: PositionIntelligence,
  prev: { thesisState: string } | undefined,
): EvalResult {
  if (!prev) return { triggered: false, description: "" };
  const isDeteriorating =
    intel.thesisHealth === "DETERIORATING" ||
    intel.thesisHealth === "SEVERELY_DETERIORATING" ||
    intel.thesisHealth === "INVALIDATED";
  const wasNotDeteriorating =
    prev.thesisState !== "DETERIORATING" &&
    prev.thesisState !== "SEVERELY_DETERIORATING" &&
    prev.thesisState !== "INVALIDATED";
  const triggered = isDeteriorating && wasNotDeteriorating;
  return {
    triggered,
    description: triggered
      ? `Thesis deteriorated from ${prev.thesisState} to ${intel.thesisHealth}`
      : "",
    previousState: prev.thesisState,
    currentState: intel.thesisHealth,
  };
}

function evalThesisBecameInvalidated(
  intel: PositionIntelligence,
  prev: { thesisState: string } | undefined,
): EvalResult {
  if (!prev) return { triggered: false, description: "" };
  const triggered = intel.thesisHealth === "INVALIDATED" && prev.thesisState !== "INVALIDATED";
  return {
    triggered,
    description: triggered
      ? `Thesis invalidated (was ${prev.thesisState})`
      : "",
    previousState: prev.thesisState,
    currentState: "INVALIDATED",
  };
}

function evalRegimeChanged(
  intel: PositionIntelligence,
  prev: { marketRegime: string } | undefined,
): EvalResult {
  const currentRegime = (typeof intel.ohlcvRegime === "string" ? intel.ohlcvRegime : "UNKNOWN") ?? "UNKNOWN";
  if (!prev) return { triggered: false, description: "" };
  const triggered = prev.marketRegime !== currentRegime;
  return {
    triggered,
    description: triggered
      ? `Market regime changed from ${prev.marketRegime} to ${currentRegime}`
      : "",
    previousState: prev.marketRegime,
    currentState: currentRegime,
  };
}

function evalTrendChanged(
  intel: PositionIntelligence,
  prev: RuleSnapshot | undefined,
  tf: "h1" | "m15" | "m5",
  condition: RuleCondition,
): EvalResult {
  const tfKey = `${tf}Analysis` as keyof PositionIntelligence;
  const analysis = intel[tfKey] as { trend?: string } | undefined;
  const currentTrend = analysis?.trend ?? "UNKNOWN";
  if (!prev) return { triggered: false, description: "" };
  const prevKey = `${tf}Trend` as keyof RuleSnapshot;
  const prevTrend = (prev[prevKey] as string | undefined) ?? "UNKNOWN";
  const triggered = prevTrend !== currentTrend;
  const tfLabel = tf.toUpperCase();
  return {
    triggered,
    description: triggered
      ? `${tfLabel} trend changed from ${prevTrend} to ${currentTrend}`
      : "",
    previousState: prevTrend,
    currentState: currentTrend,
  };
}

function evalStructureChanged(
  intel: PositionIntelligence,
  prev: RuleSnapshot | undefined,
): EvalResult {
  const currentStructure = (typeof intel.ohlcvRegime === "string" ? intel.ohlcvRegime : "UNKNOWN") ?? "UNKNOWN";
  if (!prev) return { triggered: false, description: "" };
  const triggered = prev.structure !== undefined && prev.structure !== currentStructure;
  return {
    triggered,
    description: triggered
      ? `Structure changed from ${prev.structure} to ${currentStructure}`
      : "",
    previousState: prev.structure,
    currentState: currentStructure,
  };
}

function evalMomentumChanged(
  intel: PositionIntelligence,
  prev: RuleSnapshot | undefined,
): EvalResult {
  const currentMomentum = intel.shortTermContext ?? "UNKNOWN";
  if (!prev) return { triggered: false, description: "" };
  const triggered = prev.momentum !== undefined && prev.momentum !== currentMomentum;
  return {
    triggered,
    description: triggered
      ? `Momentum context changed`
      : "",
    previousState: prev.momentum,
    currentState: currentMomentum,
  };
}

function evalVolatilityChanged(
  intel: PositionIntelligence,
  prev: RuleSnapshot | undefined,
): EvalResult {
  const currentVol = intel.volatilityContext ?? "UNKNOWN";
  if (!prev) return { triggered: false, description: "" };
  const triggered = prev.volatility !== undefined && prev.volatility !== currentVol;
  return {
    triggered,
    description: triggered ? `Volatility context changed` : "",
    previousState: prev.volatility,
    currentState: currentVol,
  };
}

function evalEvidenceQualityChanged(
  intel: PositionIntelligence,
  prev: { evidenceQuality: string } | undefined,
): EvalResult {
  if (!prev) return { triggered: false, description: "" };
  const triggered = prev.evidenceQuality !== intel.confidence;
  return {
    triggered,
    description: triggered
      ? `Evidence quality changed from ${prev.evidenceQuality} to ${intel.confidence}`
      : "",
    previousState: prev.evidenceQuality,
    currentState: intel.confidence,
  };
}

function evalSupportingChanged(
  intel: PositionIntelligence,
  prev: { supportingCount: number } | undefined,
): EvalResult {
  if (!prev) return { triggered: false, description: "" };
  const current = intel.evidence.filter((e) => e.direction === "supporting").length;
  const triggered = Math.abs(current - prev.supportingCount) >= 2;
  return {
    triggered,
    description: triggered
      ? `Supporting evidence changed from ${prev.supportingCount} to ${current}`
      : "",
    previousState: String(prev.supportingCount),
    currentState: String(current),
  };
}

function evalConflictingChanged(
  intel: PositionIntelligence,
  prev: { conflictingCount: number } | undefined,
): EvalResult {
  if (!prev) return { triggered: false, description: "" };
  const current = intel.evidence.filter((e) => e.direction === "conflicting").length;
  const triggered = Math.abs(current - prev.conflictingCount) >= 2;
  return {
    triggered,
    description: triggered
      ? `Conflicting evidence changed from ${prev.conflictingCount} to ${current}`
      : "",
    previousState: String(prev.conflictingCount),
    currentState: String(current),
  };
}

function evalNewsChange(
  instrument: string,
  current: "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE" | undefined,
  previous: "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE" | undefined,
  target: "CONFLICTING" | "SUPPORTING",
): EvalResult {
  if (!current || !previous) return { triggered: false, description: "" };
  const triggered = current === target && previous !== target;
  return {
    triggered,
    description: triggered
      ? `News for ${instrument} became ${target.toLowerCase()}`
      : "",
    previousState: previous,
    currentState: current,
  };
}

function evalMacroRegimeChanged(
  current: string | undefined,
  previous: string | undefined,
): EvalResult {
  if (!current || !previous) return { triggered: false, description: "" };
  const triggered = previous !== current;
  return {
    triggered,
    description: triggered
      ? `Macro regime changed from ${previous} to ${current}`
      : "",
    previousState: previous,
    currentState: current,
  };
}

function evalPortfolioConcentration(
  portfolio: PortfolioIntelligence | undefined,
): EvalResult {
  if (!portfolio) return { triggered: false, description: "" };
  const hasConcentration = portfolio.alignments.some(
    (a) => a.alignmentType.includes("CONCENTRATION") && a.strength === "STRONG",
  );
  return {
    triggered: hasConcentration,
    description: hasConcentration
      ? `Portfolio concentration detected: ${portfolio.alignments.find((a) => a.alignmentType.includes("CONCENTRATION"))?.description ?? ""}`
      : "",
  };
}

function evalPortfolioConflict(
  portfolio: PortfolioIntelligence | undefined,
): EvalResult {
  if (!portfolio) return { triggered: false, description: "" };
  const hasConflict = portfolio.conflicts.some((c) => c.strength === "STRONG");
  return {
    triggered: hasConflict,
    description: hasConflict
      ? `Portfolio conflict detected: ${portfolio.conflicts.find((c) => c.strength === "STRONG")?.description ?? ""}`
      : "",
  };
}

function evalDataUnavailable(
  intel: PositionIntelligence,
  prev: { dataAvailability?: string } | undefined,
): EvalResult {
  const current = intel.dataQuality;
  const isUnavailable = current === "UNAVAILABLE" || current === "INSUFFICIENT";
  if (!prev) return { triggered: isUnavailable, description: isUnavailable ? `Data became unavailable for ${intel.instrument}` : "" };
  const wasAvailable = prev.dataAvailability !== "UNAVAILABLE" && prev.dataAvailability !== "INSUFFICIENT";
  const triggered = isUnavailable && wasAvailable;
  return {
    triggered,
    description: triggered ? `Data became unavailable for ${intel.instrument}` : "",
    previousState: prev.dataAvailability,
    currentState: current,
  };
}

function evalDataRecovered(
  intel: PositionIntelligence,
  prev: { dataAvailability?: string } | undefined,
): EvalResult {
  const current = intel.dataQuality;
  const isAvailable = current !== "UNAVAILABLE" && current !== "INSUFFICIENT";
  if (!prev) return { triggered: false, description: "" };
  const wasUnavailable = prev.dataAvailability === "UNAVAILABLE" || prev.dataAvailability === "INSUFFICIENT";
  const triggered = isAvailable && wasUnavailable;
  return {
    triggered,
    description: triggered ? `Data recovered for ${intel.instrument}` : "",
    previousState: prev.dataAvailability,
    currentState: current,
  };
}

// ═══════════════════════════════════════════════════════════════
// MAIN EVALUATION
// ═══════════════════════════════════════════════════════════════

export function evaluateRule(
  rule: AlertRule,
  ctx: RuleEvaluationContext,
): EvalResult[] {
  const results: EvalResult[] = [];

  if (!rule.enabled) return results;

  // Get position intelligence for POSITION/INSTRUMENT scope
  if (rule.scope === "POSITION" || rule.scope === "INSTRUMENT") {
    for (const [posId, intel] of ctx.positionIntelligence) {
      const matchesInstrument =
        rule.scope === "INSTRUMENT"
          ? rule.instrument === undefined || rule.instrument === intel.instrument
          : true;
      const matchesPosition =
        rule.scope === "POSITION"
          ? rule.positionId === undefined || rule.positionId === posId
          : true;

      if (!matchesInstrument || !matchesPosition) continue;

      const prev = ctx.previousSnapshots?.get(posId);
      const prevNews = ctx.previousNewsStance?.get(intel.instrument);
      const news = ctx.newsStance?.get(intel.instrument);
      const prevData = ctx.previousDataAvailability?.get(intel.instrument);

      const evalResult = evaluatePositionCondition(
        rule.condition,
        intel,
        prev,
        prevNews,
        news,
        prevData,
      );
      if (evalResult.triggered) {
        results.push(evalResult);
      }
    }
  }

  // PORTFOLIO scope
  if (rule.scope === "PORTFOLIO") {
    const portfolioResults = evaluatePortfolioCondition(
      rule.condition,
      ctx.portfolioIntelligence,
      ctx.previousMacroRegime,
      ctx.macroRegime,
    );
    results.push(...portfolioResults);
  }

  // GLOBAL scope — evaluate against all positions
  if (rule.scope === "GLOBAL") {
    for (const [posId, intel] of ctx.positionIntelligence) {
      const prev = ctx.previousSnapshots?.get(posId);
      const evalResult = evaluatePositionCondition(
        rule.condition,
        intel,
        prev,
        ctx.previousNewsStance?.get(intel.instrument),
        ctx.newsStance?.get(intel.instrument),
        ctx.previousDataAvailability?.get(intel.instrument),
      );
      if (evalResult.triggered) {
        results.push(evalResult);
      }
    }
    // Also evaluate portfolio-level
    const portfolioResults = evaluatePortfolioCondition(
      rule.condition,
      ctx.portfolioIntelligence,
      ctx.previousMacroRegime,
      ctx.macroRegime,
    );
    results.push(...portfolioResults);
  }

  return results;
}

function evaluatePositionCondition(
  condition: RuleCondition,
  intel: PositionIntelligence,
  prev: RuleSnapshot | undefined,
  prevNews?: "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE",
  news?: "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE",
  prevData?: string,
): EvalResult {
  switch (condition) {
    case "THESIS_STATE_CHANGED":
      return evalThesisStateChanged(intel, prev);
    case "THESIS_BECAME_DETERIORATING":
      return evalThesisBecameDeteriorating(intel, prev);
    case "THESIS_BECAME_INVALIDATED":
      return evalThesisBecameInvalidated(intel, prev);
    case "REGIME_CHANGED":
      return evalRegimeChanged(intel, prev);
    case "H1_TREND_CHANGED":
      return evalTrendChanged(intel, prev, "h1", condition);
    case "M15_TREND_CHANGED":
      return evalTrendChanged(intel, prev, "m15", condition);
    case "M5_TREND_CHANGED":
      return evalTrendChanged(intel, prev, "m5", condition);
    case "STRUCTURE_CHANGED":
      return evalStructureChanged(intel, prev);
    case "MOMENTUM_CHANGED":
      return evalMomentumChanged(intel, prev);
    case "VOLATILITY_CHANGED":
      return evalVolatilityChanged(intel, prev);
    case "EVIDENCE_QUALITY_CHANGED":
      return evalEvidenceQualityChanged(intel, prev);
    case "SUPPORTING_EVIDENCE_CHANGED":
      return evalSupportingChanged(intel, prev);
    case "CONFLICTING_EVIDENCE_CHANGED":
      return evalConflictingChanged(intel, prev);
    case "NEWS_BECAME_CONFLICTING":
      return evalNewsChange(intel.instrument, news, prevNews, "CONFLICTING");
    case "NEWS_BECAME_SUPPORTING":
      return evalNewsChange(intel.instrument, news, prevNews, "SUPPORTING");
    case "DATA_BECAME_UNAVAILABLE":
      return evalDataUnavailable(intel, prevData ? { dataAvailability: prevData } : undefined);
    case "DATA_RECOVERED":
      return evalDataRecovered(intel, prevData ? { dataAvailability: prevData } : undefined);
    default:
      return { triggered: false, description: "" };
  }
}

function evaluatePortfolioCondition(
  condition: RuleCondition,
  portfolio: PortfolioIntelligence | undefined,
  prevMacro?: string,
  macro?: string,
): EvalResult[] {
  const results: EvalResult[] = [];

  if (condition === "PORTFOLIO_CONCENTRATION_DETECTED") {
    const r = evalPortfolioConcentration(portfolio);
    if (r.triggered) results.push(r);
  }

  if (condition === "PORTFOLIO_CONFLICT_DETECTED") {
    const r = evalPortfolioConflict(portfolio);
    if (r.triggered) results.push(r);
  }

  if (condition === "MACRO_REGIME_CHANGED") {
    const r = evalMacroRegimeChanged(macro, prevMacro);
    if (r.triggered) results.push(r);
  }

  if (condition === "CROSS_ASSET_CONFLICT" && portfolio) {
    const hasConflict = portfolio.conflicts.some(
      (c) => c.conflictType === "CROSS_ASSET",
    );
    if (hasConflict) {
      results.push({
        triggered: true,
        description: "Cross-asset conflict detected in portfolio",
      });
    }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════════
// BUILD RULE ALERT
// ═══════════════════════════════════════════════════════════════

export function buildRuleAlert(
  rule: AlertRule,
  evalResult: EvalResult,
  positionId?: string,
  instrument?: string,
): RuleAlert {
  const ts = Date.now();
  return {
    alertId: `custom-${rule.ruleId}-${ts}-${Math.random().toString(36).slice(2, 8)}`,
    ruleId: rule.ruleId,
    ruleName: rule.name,
    userId: rule.userId,
    positionId: positionId ?? rule.positionId,
    instrument: instrument ?? rule.instrument,
    condition: rule.condition,
    severity: rule.severity,
    description: evalResult.description,
    previousState: evalResult.previousState,
    currentState: evalResult.currentState,
    timestamp: ts,
    source: "CUSTOM_RULE",
  };
}

// ═══════════════════════════════════════════════════════════════
// BATCH EVALUATION
// ═══════════════════════════════════════════════════════════════

export function evaluateRules(
  rules: AlertRule[],
  ctx: RuleEvaluationContext,
  triggerRecords: Map<string, RuleTriggerRecord>,
  now: number,
): { alerts: RuleAlert[]; updatedRecords: Map<string, RuleTriggerRecord> } {
  const alerts: RuleAlert[] = [];
  let records = new Map(triggerRecords);

  for (const rule of rules) {
    if (alerts.length >= MAX_ALERTS_PER_EVALUATION) break;

    if (!shouldTriggerAlert(rule, records, now)) continue;

    const evalResults = evaluateRule(rule, ctx);

    for (const er of evalResults) {
      if (alerts.length >= MAX_ALERTS_PER_EVALUATION) break;

      // Find matching position
      let posId: string | undefined;
      let inst: string | undefined;
      if (rule.scope === "POSITION" && rule.positionId) {
        posId = rule.positionId;
        const intel = ctx.positionIntelligence.get(rule.positionId);
        inst = intel?.instrument;
      } else if (rule.scope === "INSTRUMENT" && rule.instrument) {
        inst = rule.instrument;
        for (const [pid, i] of ctx.positionIntelligence) {
          if (i.instrument === rule.instrument) {
            posId = pid;
            break;
          }
        }
      }

      alerts.push(buildRuleAlert(rule, er, posId, inst));
      records = updateTriggerRecord(records, rule, now);
    }
  }

  return { alerts, updatedRecords: records };
}

// ═══════════════════════════════════════════════════════════════
// POSITION-AWARE FEED INTEGRATION
// ═══════════════════════════════════════════════════════════════

export function classifyAlertImpact(
  alert: RuleAlert,
  positionSide: "LONG" | "SHORT",
): "SUPPORTING" | "CONFLICTING" | "NEUTRAL" {
  const positiveConditions: RuleCondition[] = [
    "NEWS_BECAME_SUPPORTING",
    "DATA_RECOVERED",
    "PORTFOLIO_CONFLICT_DETECTED",
  ];
  const negativeConditions: RuleCondition[] = [
    "THESIS_BECAME_DETERIORATING",
    "THESIS_BECAME_INVALIDATED",
    "NEWS_BECAME_CONFLICTING",
    "DATA_BECAME_UNAVAILABLE",
    "PORTFOLIO_CONCENTRATION_DETECTED",
  ];

  if (positiveConditions.includes(alert.condition)) {
    return positionSide === "LONG" ? "SUPPORTING" : "CONFLICTING";
  }
  if (negativeConditions.includes(alert.condition)) {
    return positionSide === "LONG" ? "CONFLICTING" : "SUPPORTING";
  }
  return "NEUTRAL";
}

// ═══════════════════════════════════════════════════════════════
// RULE DESCRIPTION HELPER
// ═══════════════════════════════════════════════════════════════

export const CONDITION_LABELS: Record<RuleCondition, string> = {
  THESIS_STATE_CHANGED: "Thesis state changed",
  THESIS_BECAME_DETERIORATING: "Thesis became deteriorating",
  THESIS_BECAME_INVALIDATED: "Thesis invalidated",
  REGIME_CHANGED: "Market regime changed",
  H1_TREND_CHANGED: "H1 trend changed",
  M15_TREND_CHANGED: "M15 trend changed",
  M5_TREND_CHANGED: "M5 trend changed",
  STRUCTURE_CHANGED: "Structure changed",
  MOMENTUM_CHANGED: "Momentum changed",
  VOLATILITY_CHANGED: "Volatility changed",
  EVIDENCE_QUALITY_CHANGED: "Evidence quality changed",
  SUPPORTING_EVIDENCE_CHANGED: "Supporting evidence changed",
  CONFLICTING_EVIDENCE_CHANGED: "Conflicting evidence changed",
  NEWS_BECAME_CONFLICTING: "News became conflicting",
  NEWS_BECAME_SUPPORTING: "News became supporting",
  MACRO_REGIME_CHANGED: "Macro regime changed",
  CROSS_ASSET_CONFLICT: "Cross-asset conflict",
  PORTFOLIO_CONCENTRATION_DETECTED: "Portfolio concentration",
  PORTFOLIO_CONFLICT_DETECTED: "Portfolio conflict",
  DATA_BECAME_UNAVAILABLE: "Data became unavailable",
  DATA_RECOVERED: "Data recovered",
};

export const SEVERITY_COLORS: Record<RuleSeverity, string> = {
  INFO: "text-blue-400",
  LOW: "text-cyan-400",
  MEDIUM: "text-amber-400",
  HIGH: "text-orange-400",
  CRITICAL: "text-red-400",
};

export const SEVERITY_BG: Record<RuleSeverity, string> = {
  INFO: "bg-blue-500/10",
  LOW: "bg-cyan-500/10",
  MEDIUM: "bg-amber-500/10",
  HIGH: "bg-orange-500/10",
  CRITICAL: "bg-red-500/10",
};
