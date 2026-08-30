/**
 * Phase 95 — Runtime Alert Evaluation & Notification Bridge
 *
 * Connects the existing Phase 93 alert-rule engine to the Phase 94 notification
 * persistence layer. This module is pure except for the notification persistence
 * callback — no network calls, no market data fetching.
 *
 * Architecture:
 *   Intelligence update (useMemo in dashboard)
 *   → evaluate applicable rules (Phase 93 engine, pure)
 *   → generate RuleAlerts when transitions detected
 *   → convert to Notifications (Phase 94 engine, pure)
 *   → persist via Convex (callback, async)
 *   → NotificationCenter reactively displays
 */

import type {
  AlertRule,
  RuleAlert,
  RuleEvaluationContext,
  RuleSnapshot,
  RuleTriggerRecord,
} from "./alert-rule-engine";
import {
  evaluateRules,
  evaluateRule,
  shouldTriggerAlert,
  alertIdentity,
  type RuleCondition,
} from "./alert-rule-engine";
import { buildNotification, type Notification } from "./notification-engine";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";
import {
  type AlertDiagnosticEvent,
  buildSkipDiagnostic,
  buildCooldownDiagnostic,
  buildTriggerDiagnostic,
  buildNotificationDiagnostic,
  buildPipelineCycleDiagnostic,
  buildPipelineErrorDiagnostic,
  buildCleanupDiagnostic,
  type SkipReason,
} from "./alert-observability";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface RuntimeBridgeInput {
  /** User's active alert rules from Convex */
  rules: AlertRule[];
  /** Current intelligence per position, keyed by positionId */
  intelligenceMap: Map<string, PositionIntelligence>;
  /** Optional portfolio-level intelligence */
  portfolioIntelligence?: PortfolioIntelligence;
  /** Previous macro regime for transition detection */
  previousMacroRegime?: string;
  /** Current macro regime */
  macroRegime?: string;
}

export interface RuntimeBridgeResult {
  /** Notifications to persist to Convex */
  notifications: Notification[];
  /** Updated trigger records (caller must store for next cycle) */
  updatedTriggerRecords: Map<string, RuleTriggerRecord>;
  /** Updated previous snapshots (caller must store for next cycle) */
  updatedPreviousSnapshots: Map<string, RuleSnapshot>;
  /** Diagnostic events describing what the pipeline did */
  diagnostics: AlertDiagnosticEvent[];
}

export interface PreviousStateStore {
  /** Previous intelligence snapshots keyed by positionId */
  snapshots: Map<string, RuleSnapshot>;
  /** Previous news stance per instrument */
  newsStance: Map<string, "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE">;
  /** Previous data availability per instrument */
  dataAvailability: Map<string, string>;
  /** Previous portfolio snapshot for portfolio-scope transition detection */
  portfolioSnapshot?: PortfolioSnapshot;
}

/**
 * Deterministic portfolio state snapshot.
 * Contains only fields derived from PortfolioIntelligence.
 */
export interface PortfolioSnapshot {
  dominantThesisState: string;
  riskContext: string;
  evidenceQuality: string;
  alignmentCount: number;
  conflictCount: number;
  strongConflictCount: number;
  totalPositions: number;
  healthyPositions: number;
  deterioratingPositions: number;
  invalidatedPositions: number;
  dataAvailability: string;
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT EXTRACTION
// ═══════════════════════════════════════════════════════════════

/**
 * Extract a RuleSnapshot from PositionIntelligence.
 * This is the "current" snapshot used for transition detection.
 * Pure function — no side effects.
 */
/**
 * Extract a deterministic PortfolioSnapshot from PortfolioIntelligence.
 * Used for portfolio-scope transition detection.
 */
export function extractPortfolioSnapshot(portfolio: PortfolioIntelligence): PortfolioSnapshot {
  return {
    dominantThesisState: portfolio.summary.dominantPortfolioState,
    riskContext: portfolio.riskContext,
    evidenceQuality: portfolio.summary.portfolioEvidenceQuality,
    alignmentCount: portfolio.alignments.length,
    conflictCount: portfolio.conflicts.length,
    strongConflictCount: portfolio.conflicts.filter((c) => c.strength === "STRONG").length,
    totalPositions: portfolio.summary.totalPositions,
    healthyPositions: portfolio.summary.healthyPositions,
    deterioratingPositions: portfolio.summary.deterioratingPositions,
    invalidatedPositions: portfolio.summary.invalidatedPositions,
    dataAvailability: portfolio.dataAvailability.technical,
  };
}

export function extractSnapshot(intel: PositionIntelligence): RuleSnapshot {
  return {
    thesisState: intel.thesisHealth,
    marketRegime: intel.ohlcvRegime ?? "UNKNOWN",
    evidenceQuality: intel.confidence,
    structure: intel.ohlcvRegime ?? "UNKNOWN",
    momentum: intel.shortTermContext ?? "UNKNOWN",
    volatility: intel.volatilityContext ?? "UNKNOWN",
    h1Trend: intel.h1Analysis?.trend ?? "UNKNOWN",
    m15Trend: intel.m15Analysis?.trend ?? "UNKNOWN",
    m5Trend: intel.m5Analysis?.trend ?? "UNKNOWN",
    supportingCount: intel.evidence.filter((e) => e.direction === "supporting").length,
    conflictingCount: intel.evidence.filter((e) => e.direction === "conflicting").length,
  };
}

// ═══════════════════════════════════════════════════════════════
// CORE RUNTIME BRIDGE
// ═══════════════════════════════════════════════════════════════

/**
 * Core deterministic evaluation bridge.
 *
 * Given rules + current intelligence + previous state:
 * 1. Builds RuleEvaluationContext from intelligence
 * 2. Evaluates all active rules with cooldown/dedup
 * 3. Converts triggered RuleAlerts to Notifications
 * 4. Updates previous state for next cycle
 *
 * Pure function — all side effects are in the caller.
 */
export function evaluateAlertRuntimeBridge(
  input: RuntimeBridgeInput,
  previousState: PreviousStateStore,
  triggerRecords: Map<string, RuleTriggerRecord>,
  now: number,
): RuntimeBridgeResult {
  const { rules, intelligenceMap, portfolioIntelligence, previousMacroRegime, macroRegime } = input;
  const diagnostics: AlertDiagnosticEvent[] = [];

  // Filter to enabled rules only
  const disabledRules = rules.filter((r) => !r.enabled);
  for (const rule of disabledRules) {
    diagnostics.push(buildSkipDiagnostic(rule, "RULE_DISABLED"));
  }

  const activeRules = rules.filter((r) => r.enabled);
  if (activeRules.length === 0) {
    diagnostics.push(buildPipelineCycleDiagnostic(rules.length, 0, 0, now));
    return {
      notifications: [],
      updatedTriggerRecords: triggerRecords,
      updatedPreviousSnapshots: new Map(previousState.snapshots),
      diagnostics,
    };
  }

  // Build RuleEvaluationContext from current intelligence
  const ctx: RuleEvaluationContext = {
    positionIntelligence: intelligenceMap,
    portfolioIntelligence,
    previousSnapshots: previousState.snapshots,
    previousNewsStance: previousState.newsStance,
    newsStance: extractCurrentNewsStance(intelligenceMap),
    previousMacroRegime,
    macroRegime,
    previousDataAvailability: previousState.dataAvailability,
  };

  // Per-rule evaluation with diagnostics
  let updatedRecords = new Map(triggerRecords);
  const triggeredAlerts: Array<{ rule: typeof activeRules[0]; alertId: string; positionId?: string; instrument?: string }> = [];
  let evaluatedCount = 0;
  let cooldownBlockedCount = 0;
  let dedupCount = 0;
  let triggeredCount = 0;

  for (const rule of activeRules) {
    evaluatedCount++;

    // Check cooldown
    const cooldownOk = shouldTriggerAlert(rule, updatedRecords, now);
    if (!cooldownOk) {
      diagnostics.push(buildCooldownDiagnostic(rule));
      cooldownBlockedCount++;
      continue;
    }

    // Evaluate rule conditions
    const evalResults = evaluateRule(rule, ctx);

    if (evalResults.length === 0) {
      // Condition not met — no diagnostic needed (normal)
      continue;
    }

    // Rule triggered — determine position context
    for (const er of evalResults) {
      let posId: string | undefined;
      let inst: string | undefined;
      let side: "LONG" | "SHORT" | "NONE" = "NONE";

      if (rule.scope === "POSITION" && rule.positionId) {
        posId = rule.positionId;
        const intel = intelligenceMap.get(rule.positionId);
        inst = intel?.instrument;
        side = intel?.side ?? "NONE";
      } else if (rule.scope === "INSTRUMENT" && rule.instrument) {
        inst = rule.instrument;
        for (const [pid, i] of intelligenceMap) {
          if (i.instrument === rule.instrument) {
            posId = pid;
            side = i.side;
            break;
          }
        }
      }

      const identity = alertIdentity(rule.ruleId, posId, rule.condition, now);
      diagnostics.push(buildTriggerDiagnostic(rule, identity, { positionId: posId, instrument: inst, side }));
      triggeredAlerts.push({ rule, alertId: identity, positionId: posId, instrument: inst });
      triggeredCount++;

      // Update trigger record
      const key = `${rule.ruleId}:${rule.positionId ?? "global"}`;
      updatedRecords = new Map(updatedRecords);
      updatedRecords.set(key, {
        ruleId: rule.ruleId,
        positionId: rule.positionId,
        lastTriggeredAt: now,
        lastConditionTrue: true,
      });
    }
  }

  // Convert triggered alerts → notifications
  const notifications: Notification[] = [];
  for (const ta of triggeredAlerts) {
    let side: "LONG" | "SHORT" | "NONE" = "NONE";
    if (ta.positionId) {
      const intel = intelligenceMap.get(ta.positionId);
      if (intel) side = intel.side;
    }

    // Reconstruct RuleAlert for buildNotification
    const alert = {
      alertId: ta.alertId,
      ruleId: ta.rule.ruleId,
      ruleName: ta.rule.name,
      userId: ta.rule.userId,
      positionId: ta.positionId,
      instrument: ta.instrument,
      condition: ta.rule.condition,
      severity: ta.rule.severity,
      description: `${ta.rule.name} triggered`,
      timestamp: now,
      source: "CUSTOM_RULE" as const,
    };

    const notification = buildNotification(alert, side, now);
    notifications.push(notification);
    diagnostics.push(buildNotificationDiagnostic(ta.alertId, notification.notificationId, "CREATED", {
      instrument: ta.instrument,
      positionId: ta.positionId,
      side,
      severity: ta.rule.severity,
    }));
  }

  // Pipeline cycle summary
  diagnostics.push(buildPipelineCycleDiagnostic(rules.length, evaluatedCount, triggeredCount, now));

  // Update previous snapshots for next cycle
  const updatedSnapshots = new Map(previousState.snapshots);
  for (const [posId, intel] of intelligenceMap) {
    updatedSnapshots.set(posId, extractSnapshot(intel));
  }

  return {
    notifications,
    updatedTriggerRecords: updatedRecords,
    updatedPreviousSnapshots: updatedSnapshots,
    diagnostics,
  };
}

// ═══════════════════════════════════════════════════════════════
// NEWS STANCE EXTRACTION
// ═══════════════════════════════════════════════════════════════

function extractCurrentNewsStance(
  intelligenceMap: Map<string, PositionIntelligence>,
): Map<string, "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE"> {
  const stance = new Map<string, "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE">();
  for (const [, intel] of intelligenceMap) {
    const instrument = intel.instrument;
    if (!stance.has(instrument)) {
      // Derive news stance from evidence if available
      const hasConflicting = intel.evidence.some(
        (e) => e.direction === "conflicting" && e.category === "NEWS",
      );
      const hasSupporting = intel.evidence.some(
        (e) => e.direction === "supporting" && e.category === "NEWS",
      );

      if (intel.dataQuality === "UNAVAILABLE" || intel.dataQuality === "INSUFFICIENT") {
        stance.set(instrument, "UNAVAILABLE");
      } else if (hasConflicting && hasSupporting) {
        stance.set(instrument, "NEUTRAL");
      } else if (hasConflicting) {
        stance.set(instrument, "CONFLICTING");
      } else if (hasSupporting) {
        stance.set(instrument, "SUPPORTING");
      } else {
        stance.set(instrument, "NEUTRAL");
      }
    }
  }
  return stance;
}

// ═══════════════════════════════════════════════════════════════
// RULE SNAPSHOT BUILDER (for initial state without transition)
// ═══════════════════════════════════════════════════════════════

/**
 * Build initial previous state store from current intelligence.
 * Used on first load to seed the state without generating false transitions.
 * The key insight: if previousSnapshots is empty, transition rules
 * (THESIS_STATE_CHANGED, REGIME_CHANGED, etc.) return triggered=false
 * because the Phase 93 engine checks `if (!prev) return { triggered: false }`.
 */
export function buildInitialStateStore(
  intelligenceMap: Map<string, PositionIntelligence>,
): PreviousStateStore {
  const snapshots = new Map<string, RuleSnapshot>();
  const newsStance = new Map<string, "CONFLICTING" | "SUPPORTING" | "NEUTRAL" | "UNAVAILABLE">();
  const dataAvailability = new Map<string, string>();

  for (const [posId, intel] of intelligenceMap) {
    // Seed current state as "previous" — next cycle will detect real transitions
    snapshots.set(posId, extractSnapshot(intel));
    newsStance.set(intel.instrument, "NEUTRAL");
    dataAvailability.set(intel.instrument, intel.dataQuality);
  }

  return { snapshots, newsStance, dataAvailability };
}

// ═══════════════════════════════════════════════════════════════
// POSITION REMOVAL HANDLER
// ═══════════════════════════════════════════════════════════════

/**
 * Clean up previous state when a position is removed.
 * Prevents stale transition alerts from removed positions.
 */
export function removePositionFromState(
  state: PreviousStateStore,
  positionId: string,
): PreviousStateStore {
  const snapshots = new Map(state.snapshots);
  snapshots.delete(positionId);
  return { ...state, snapshots };
}

/**
 * Clean up all trigger records related to a specific position.
 * Removes both position-scoped and global-scoped trigger records.
 */
export function removePositionTriggerRecords(
  triggerRecords: Map<string, RuleTriggerRecord>,
  positionId: string,
): Map<string, RuleTriggerRecord> {
  const cleaned = new Map(triggerRecords);
  for (const key of cleaned.keys()) {
    if (key.endsWith(":" + positionId) || key.includes(":" + positionId + ":") || key === positionId + ":global") {
      cleaned.delete(key);
    }
  }
  return cleaned;
}

/**
 * Clean up stale previous state entries for instruments no longer tracked.
 * Removes newsStance and dataAvailability entries for removed instruments.
 */
export function cleanStaleInstrumentState(
  state: PreviousStateStore,
  activeInstruments: Set<string>,
): PreviousStateStore {
  const newsStance = new Map(state.newsStance);
  const dataAvailability = new Map(state.dataAvailability);

  for (const key of newsStance.keys()) {
    if (!activeInstruments.has(key)) {
      newsStance.delete(key);
    }
  }
  for (const key of dataAvailability.keys()) {
    if (!activeInstruments.has(key)) {
      dataAvailability.delete(key);
    }
  }

  return { ...state, newsStance, dataAvailability };
}

/**
 * Clean up trigger records for rules that no longer exist.
 * Removes trigger records whose ruleId prefix is not in the active rules set.
 */
export function cleanStaleRuleTriggerRecords(
  triggerRecords: Map<string, RuleTriggerRecord>,
  activeRuleIds: Set<string>,
): Map<string, RuleTriggerRecord> {
  const cleaned = new Map(triggerRecords);
  for (const [key, record] of cleaned) {
    if (!activeRuleIds.has(record.ruleId)) {
      cleaned.delete(key);
    }
  }
  return cleaned;
}
