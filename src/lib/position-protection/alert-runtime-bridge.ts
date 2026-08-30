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
  type RuleCondition,
} from "./alert-rule-engine";
import { buildNotification, type Notification } from "./notification-engine";
import type { PositionIntelligence } from "./market-intelligence-analyzer";
import type { PortfolioIntelligence } from "./portfolio-intelligence";

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

  // Filter to enabled rules only
  const activeRules = rules.filter((r) => r.enabled);
  if (activeRules.length === 0) {
    return {
      notifications: [],
      updatedTriggerRecords: triggerRecords,
      updatedPreviousSnapshots: new Map(previousState.snapshots),
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

  // Evaluate rules (Phase 93 engine — pure, handles cooldown/dedup)
  const { alerts, updatedRecords } = evaluateRules(
    activeRules,
    ctx,
    triggerRecords,
    now,
  );

  // Convert RuleAlerts → Notifications
  const notifications: Notification[] = [];
  for (const alert of alerts) {
    // Determine side from position
    let side: "LONG" | "SHORT" | "NONE" = "NONE";
    if (alert.positionId) {
      const intel = intelligenceMap.get(alert.positionId);
      if (intel) {
        side = intel.side;
      }
    }

    const notification = buildNotification(alert, side, now);
    notifications.push(notification);
  }

  // Update previous snapshots for next cycle
  const updatedSnapshots = new Map(previousState.snapshots);
  for (const [posId, intel] of intelligenceMap) {
    updatedSnapshots.set(posId, extractSnapshot(intel));
  }

  return {
    notifications,
    updatedTriggerRecords: updatedRecords,
    updatedPreviousSnapshots: updatedSnapshots,
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
