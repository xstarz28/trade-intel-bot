/**
 * Phase 98 — Alert Pipeline Observability & Runtime Diagnostics
 *
 * Deterministic diagnostic types and helpers for the Phase 93→94→95→96→97
 * alert pipeline. Diagnostics describe what the system did — they never
 * create new trading conclusions, probabilities, or execution signals.
 */

import type { RuleCondition, RuleScope, RuleSeverity } from "./alert-rule-engine";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type DiagnosticEventType =
  | "RULE_EVALUATED"
  | "RULE_SKIPPED"
  | "RULE_TRIGGERED"
  | "RULE_COOLDOWN_BLOCKED"
  | "RULE_DEDUPLICATED"
  | "NOTIFICATION_CREATED"
  | "NOTIFICATION_DEDUPLICATED"
  | "NOTIFICATION_FAILED"
  | "POSITION_STATE_CLEANED"
  | "RULE_STATE_CLEANED"
  | "DATA_UNAVAILABLE"
  | "PIPELINE_CYCLE"
  | "PIPELINE_ERROR";

export type DiagnosticStatus =
  | "EVALUATED"
  | "SKIPPED"
  | "TRIGGERED"
  | "BLOCKED"
  | "DEDUPLICATED"
  | "CREATED"
  | "FAILED"
  | "CLEANED"
  | "UNAVAILABLE"
  | "ERROR"
  | "COMPLETED";

export type SkipReason =
  | "RULE_DISABLED"
  | "SCOPE_MISMATCH"
  | "MISSING_PREVIOUS_STATE"
  | "DATA_UNAVAILABLE"
  | "CONDITION_NOT_MET"
  | "COOLDOWN_ACTIVE"
  | "DUPLICATE_ALERT"
  | "POSITION_NOT_FOUND"
  | "PORTFOLIO_DATA_UNAVAILABLE"
  | "NO_POSITIONS"
  | "NO_RULES";

export type PipelineHealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC EVENT
// ═══════════════════════════════════════════════════════════════

export interface AlertDiagnosticEvent {
  timestamp: number;
  eventType: DiagnosticEventType;
  ruleId?: string;
  ruleName?: string;
  scope?: RuleScope;
  condition?: RuleCondition;
  positionId?: string;
  instrument?: string;
  side?: "LONG" | "SHORT" | "NONE";
  severity?: RuleSeverity;
  status: DiagnosticStatus;
  reason?: SkipReason | string;
  alertIdentity?: string;
  notificationIdentity?: string;
  source: "ALERT_PIPELINE";
  dataAvailability?: string;
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE HEALTH
// ═══════════════════════════════════════════════════════════════

export interface AlertPipelineHealth {
  totalRules: number;
  enabledRules: number;
  evaluatedRules: number;
  skippedRules: number;
  triggeredRules: number;
  cooldownBlocked: number;
  deduplicated: number;
  notificationsCreated: number;
  notificationDeduplicated: number;
  dataUnavailable: number;
  errors: number;
  lastCycleTimestamp: number;
  lastSuccessfulCycleTimestamp: number;
  status: PipelineHealthStatus;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

export const MAX_DIAGNOSTIC_EVENTS = 100;

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTIC BUILDERS (pure functions)
// ═══════════════════════════════════════════════════════════════

export function buildRuleDiagnostic(
  rule: { ruleId: string; name: string; scope: RuleScope; condition: RuleCondition; severity: RuleSeverity; enabled: boolean },
  status: DiagnosticStatus,
  reason?: string,
  overrides: Partial<AlertDiagnosticEvent> = {},
): AlertDiagnosticEvent {
  return {
    timestamp: Date.now(),
    eventType: "RULE_EVALUATED",
    ruleId: rule.ruleId,
    ruleName: rule.name,
    scope: rule.scope,
    condition: rule.condition,
    severity: rule.severity,
    status,
    reason,
    source: "ALERT_PIPELINE",
    ...overrides,
  };
}

export function buildSkipDiagnostic(
  rule: { ruleId: string; name: string; scope: RuleScope; condition: RuleCondition; severity: RuleSeverity },
  reason: SkipReason,
  overrides: Partial<AlertDiagnosticEvent> = {},
): AlertDiagnosticEvent {
  return {
    timestamp: Date.now(),
    eventType: "RULE_SKIPPED",
    ruleId: rule.ruleId,
    ruleName: rule.name,
    scope: rule.scope,
    condition: rule.condition,
    severity: rule.severity,
    status: "SKIPPED",
    reason,
    source: "ALERT_PIPELINE",
    ...overrides,
  };
}

export function buildCooldownDiagnostic(
  rule: { ruleId: string; name: string; scope: RuleScope; condition: RuleCondition; severity: RuleSeverity },
  overrides: Partial<AlertDiagnosticEvent> = {},
): AlertDiagnosticEvent {
  return {
    timestamp: Date.now(),
    eventType: "RULE_COOLDOWN_BLOCKED",
    ruleId: rule.ruleId,
    ruleName: rule.name,
    scope: rule.scope,
    condition: rule.condition,
    severity: rule.severity,
    status: "BLOCKED",
    reason: "COOLDOWN_ACTIVE",
    source: "ALERT_PIPELINE",
    ...overrides,
  };
}

export function buildTriggerDiagnostic(
  rule: { ruleId: string; name: string; scope: RuleScope; condition: RuleCondition; severity: RuleSeverity },
  alertIdentity: string,
  overrides: Partial<AlertDiagnosticEvent> = {},
): AlertDiagnosticEvent {
  return {
    timestamp: Date.now(),
    eventType: "RULE_TRIGGERED",
    ruleId: rule.ruleId,
    ruleName: rule.name,
    scope: rule.scope,
    condition: rule.condition,
    severity: rule.severity,
    status: "TRIGGERED",
    alertIdentity,
    source: "ALERT_PIPELINE",
    ...overrides,
  };
}

export function buildNotificationDiagnostic(
  alertIdentity: string,
  notificationIdentity: string,
  status: "CREATED" | "DEDUPLICATED" | "FAILED",
  overrides: Partial<AlertDiagnosticEvent> = {},
): AlertDiagnosticEvent {
  return {
    timestamp: Date.now(),
    eventType: status === "CREATED" ? "NOTIFICATION_CREATED" : status === "DEDUPLICATED" ? "NOTIFICATION_DEDUPLICATED" : "NOTIFICATION_FAILED",
    alertIdentity,
    notificationIdentity,
    status,
    source: "ALERT_PIPELINE",
    ...overrides,
  };
}

export function buildCleanupDiagnostic(
  eventType: "POSITION_STATE_CLEANED" | "RULE_STATE_CLEANED",
  reason: string,
  overrides: Partial<AlertDiagnosticEvent> = {},
): AlertDiagnosticEvent {
  return {
    timestamp: Date.now(),
    eventType,
    status: "CLEANED",
    reason,
    source: "ALERT_PIPELINE",
    ...overrides,
  };
}

export function buildPipelineCycleDiagnostic(
  totalRules: number,
  evaluatedRules: number,
  triggeredRules: number,
  now: number,
): AlertDiagnosticEvent {
  return {
    timestamp: now,
    eventType: "PIPELINE_CYCLE",
    status: "COMPLETED",
    reason: `${evaluatedRules}/${totalRules} rules evaluated, ${triggeredRules} triggered`,
    source: "ALERT_PIPELINE",
  };
}

export function buildPipelineErrorDiagnostic(
  error: string,
  now: number,
): AlertDiagnosticEvent {
  return {
    timestamp: now,
    eventType: "PIPELINE_ERROR",
    status: "ERROR",
    reason: error,
    source: "ALERT_PIPELINE",
  };
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE HEALTH
// ═══════════════════════════════════════════════════════════════

export function computePipelineHealth(
  events: AlertDiagnosticEvent[],
  now: number,
): AlertPipelineHealth {
  const cycleEvents = events.filter((e) => e.eventType === "PIPELINE_CYCLE");
  const lastCycle = cycleEvents.length > 0 ? cycleEvents[cycleEvents.length - 1].timestamp : 0;
  const errorCount = events.filter((e) => e.eventType === "PIPELINE_ERROR").length;
  const dataUnavailableCount = events.filter((e) => e.eventType === "DATA_UNAVAILABLE").length;
  const triggeredCount = events.filter((e) => e.eventType === "RULE_TRIGGERED").length;
  const cooldownCount = events.filter((e) => e.eventType === "RULE_COOLDOWN_BLOCKED").length;
  const dedupCount = events.filter((e) => e.eventType === "RULE_DEDUPLICATED").length;
  const skippedCount = events.filter((e) => e.eventType === "RULE_SKIPPED").length;
  const evaluatedCount = events.filter((e) => e.eventType === "RULE_EVALUATED").length;
  const notifCreated = events.filter((e) => e.eventType === "NOTIFICATION_CREATED").length;
  const notifDedup = events.filter((e) => e.eventType === "NOTIFICATION_DEDUPLICATED").length;

  // Derive rule counts from most recent cycle or cumulative
  const lastCycleEvent = cycleEvents.length > 0 ? cycleEvents[cycleEvents.length - 1] : null;
  const totalRules = lastCycleEvent ? parseInt(lastCycleEvent.reason?.split("/")[0] ?? "0", 10) : 0;
  const enabledRules = totalRules; // approximate from last cycle

  // Health classification
  let status: PipelineHealthStatus = "HEALTHY";
  if (errorCount > 0 || dataUnavailableCount > 0) {
    status = "DEGRADED";
  }
  if (totalRules === 0 && evaluatedCount === 0) {
    status = "UNAVAILABLE";
  }

  const lastSuccessfulCycle = errorCount > 0
    ? (cycleEvents.length > 1 ? cycleEvents[cycleEvents.length - 2]?.timestamp ?? 0 : 0)
    : lastCycle;

  return {
    totalRules,
    enabledRules,
    evaluatedRules: evaluatedCount,
    skippedRules: skippedCount,
    triggeredRules: triggeredCount,
    cooldownBlocked: cooldownCount,
    deduplicated: dedupCount,
    notificationsCreated: notifCreated,
    notificationDeduplicated: notifDedup,
    dataUnavailable: dataUnavailableCount,
    errors: errorCount,
    lastCycleTimestamp: lastCycle,
    lastSuccessfulCycleTimestamp: lastSuccessfulCycle,
    status,
  };
}

// ═══════════════════════════════════════════════════════════════
// RETENTION
// ═══════════════════════════════════════════════════════════════

export function applyDiagnosticRetention(
  events: AlertDiagnosticEvent[],
  maxCount: number = MAX_DIAGNOSTIC_EVENTS,
): AlertDiagnosticEvent[] {
  if (events.length <= maxCount) return events;
  // Keep newest events
  return events.slice(events.length - maxCount);
}
