/**
 * Phase 94 — Intelligence Notification & Alert Delivery
 *
 * Persistent trader-facing notification layer.
 * Pure functions — no side effects, no network calls.
 * No fabrication, no probability claims, no auto-execution.
 */

import type { RuleAlert, RuleCondition, RuleSeverity } from "./alert-rule-engine";

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export type NotificationCategory =
  | "THESIS"
  | "REGIME"
  | "TREND"
  | "STRUCTURE"
  | "MOMENTUM"
  | "VOLATILITY"
  | "EVIDENCE"
  | "NEWS"
  | "MACRO"
  | "CROSS_ASSET"
  | "PORTFOLIO"
  | "DATA_QUALITY"
  | "SYSTEM";

export type NotificationSeverity = RuleSeverity;

export type NotificationImpact = "SUPPORTING" | "CONFLICTING" | "NEUTRAL";

export type NotificationFilter =
  | "ALL"
  | "UNREAD"
  | "CRITICAL"
  | "HIGH"
  | "MEDIUM"
  | "LOW";

/**
 * Persistent notification record.
 * Designed for Convex storage and reactive queries.
 */
export interface Notification {
  /** Deterministic stable identity for dedup — not random */
  notificationId: string;
  /** Authenticated user scope */
  userId: string;
  /** Reference to originating alert identity */
  alertIdentity: string;
  /** Phase 93 rule that generated this notification */
  ruleId: string;
  /** Rule name for trader display */
  ruleName: string;
  /** Event timestamp from the alert */
  timestamp: number;
  /** Convex persistence creation time */
  createdAt: number;
  /** Instrument context if position/instrument scoped */
  instrument?: string;
  /** Position ID if position scoped */
  positionId?: string;
  /** Position side for LONG/SHORT symmetry */
  side?: "LONG" | "SHORT" | "NONE";
  /** Severity level */
  severity: NotificationSeverity;
  /** Concise trader-oriented title */
  title: string;
  /** Detailed message derived from alert */
  message: string;
  /** Normalized category */
  category: NotificationCategory;
  /** Impact classification */
  impact: NotificationImpact;
  /** Read state — new notifications are unread */
  read: boolean;
  /** Dismissed state */
  dismissed: boolean;
  /** Source tag for filtering */
  source: "CUSTOM_RULE";
  /** Original rule condition */
  condition: RuleCondition;
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

/** Maximum notifications per user in persistence */
export const MAX_NOTIFICATIONS_PER_USER = 200;

/** Severity ordering for priority preservation during retention */
export const SEVERITY_ORDER: Record<NotificationSeverity, number> = {
  INFO: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC CATEGORY MAPPING
// ═══════════════════════════════════════════════════════════════

const CONDITION_TO_CATEGORY: Record<RuleCondition, NotificationCategory> = {
  THESIS_STATE_CHANGED: "THESIS",
  THESIS_BECAME_DETERIORATING: "THESIS",
  THESIS_BECAME_INVALIDATED: "THESIS",
  REGIME_CHANGED: "REGIME",
  H1_TREND_CHANGED: "TREND",
  M15_TREND_CHANGED: "TREND",
  M5_TREND_CHANGED: "TREND",
  STRUCTURE_CHANGED: "STRUCTURE",
  MOMENTUM_CHANGED: "MOMENTUM",
  VOLATILITY_CHANGED: "VOLATILITY",
  EVIDENCE_QUALITY_CHANGED: "EVIDENCE",
  SUPPORTING_EVIDENCE_CHANGED: "EVIDENCE",
  CONFLICTING_EVIDENCE_CHANGED: "EVIDENCE",
  NEWS_BECAME_CONFLICTING: "NEWS",
  NEWS_BECAME_SUPPORTING: "NEWS",
  MACRO_REGIME_CHANGED: "MACRO",
  CROSS_ASSET_CONFLICT: "CROSS_ASSET",
  PORTFOLIO_CONCENTRATION_DETECTED: "PORTFOLIO",
  PORTFOLIO_CONFLICT_DETECTED: "PORTFOLIO",
  DATA_BECAME_UNAVAILABLE: "DATA_QUALITY",
  DATA_RECOVERED: "DATA_QUALITY",
};

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC TITLE GENERATION
// ═══════════════════════════════════════════════════════════════

function buildNotificationTitle(alert: RuleAlert): string {
  const inst = alert.instrument ?? "";
  const side = alert.positionId ? "" : "";

  switch (alert.condition) {
    case "THESIS_STATE_CHANGED":
      return `${inst} thesis changed`;
    case "THESIS_BECAME_DETERIORATING":
      return `${inst} evidence deteriorating`;
    case "THESIS_BECAME_INVALIDATED":
      return `${inst} thesis invalidated`;
    case "REGIME_CHANGED":
      return `Regime changed for ${inst}`;
    case "H1_TREND_CHANGED":
      return `H1 trend changed for ${inst}`;
    case "M15_TREND_CHANGED":
      return `M15 trend changed for ${inst}`;
    case "M5_TREND_CHANGED":
      return `M5 trend changed for ${inst}`;
    case "STRUCTURE_CHANGED":
      return `Structure changed for ${inst}`;
    case "MOMENTUM_CHANGED":
      return `Momentum changed for ${inst}`;
    case "VOLATILITY_CHANGED":
      return `Volatility changed for ${inst}`;
    case "EVIDENCE_QUALITY_CHANGED":
      return `Evidence quality changed for ${inst}`;
    case "SUPPORTING_EVIDENCE_CHANGED":
      return `Supporting evidence shifted for ${inst}`;
    case "CONFLICTING_EVIDENCE_CHANGED":
      return `Conflicting evidence shifted for ${inst}`;
    case "NEWS_BECAME_CONFLICTING":
      return `News became conflicting for ${inst}`;
    case "NEWS_BECAME_SUPPORTING":
      return `News became supporting for ${inst}`;
    case "MACRO_REGIME_CHANGED":
      return `Macro regime changed`;
    case "CROSS_ASSET_CONFLICT":
      return `Cross-asset conflict detected`;
    case "PORTFOLIO_CONCENTRATION_DETECTED":
      return `Portfolio concentration detected`;
    case "PORTFOLIO_CONFLICT_DETECTED":
      return `Portfolio conflict detected`;
    case "DATA_BECAME_UNAVAILABLE":
      return `Data unavailable for ${inst}`;
    case "DATA_RECOVERED":
      return `Data recovered for ${inst}`;
    default:
      return `${alert.condition}`;
  }
}

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC NOTIFICATION IDENTITY
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic notification identity.
 * Same RuleAlert → same identity → prevents duplicates.
 *
 * Identity = userId + alertIdentity
 * alertIdentity is already stable from Phase 93 (ruleId:positionId:condition:timestamp)
 */
export function notificationIdentity(
  userId: string,
  alertId: string,
): string {
  return `${userId}:${alertId}`;
}

// ═══════════════════════════════════════════════════════════════
// BUILD NOTIFICATION FROM RULE ALERT
// ═══════════════════════════════════════════════════════════════

/**
 * Pure deterministic normalization.
 * Same RuleAlert input → identical Notification output.
 *
 * No market data fabrication.
 * No probability claims.
 * No execution language.
 */
export function buildNotification(
  alert: RuleAlert,
  side?: "LONG" | "SHORT" | "NONE",
  now?: number,
): Notification {
  const category = CONDITION_TO_CATEGORY[alert.condition] ?? "SYSTEM";
  const title = buildNotificationTitle(alert);
  const impact = deriveImpact(alert.condition, side ?? "NONE");

  const id = notificationIdentity(alert.userId, alert.alertId);
  const ts = now ?? Date.now();

  return {
    notificationId: id,
    userId: alert.userId,
    alertIdentity: alert.alertId,
    ruleId: alert.ruleId,
    ruleName: alert.ruleName,
    timestamp: alert.timestamp,
    createdAt: ts,
    instrument: alert.instrument,
    positionId: alert.positionId,
    side: side ?? "NONE",
    severity: alert.severity,
    title,
    message: alert.description,
    category,
    impact,
    read: false,
    dismissed: false,
    source: "CUSTOM_RULE",
    condition: alert.condition,
  };
}

// ═══════════════════════════════════════════════════════════════
// IMPACT DERIVATION (LONG/SHORT SYMMETRIC)
// ═══════════════════════════════════════════════════════════════

function deriveImpact(
  condition: RuleCondition,
  side: "LONG" | "SHORT" | "NONE",
): NotificationImpact {
  if (side === "NONE") return "NEUTRAL";

  const positiveConditions: RuleCondition[] = [
    "NEWS_BECAME_SUPPORTING",
    "DATA_RECOVERED",
  ];

  const negativeConditions: RuleCondition[] = [
    "THESIS_BECAME_DETERIORATING",
    "THESIS_BECAME_INVALIDATED",
    "NEWS_BECAME_CONFLICTING",
    "DATA_BECAME_UNAVAILABLE",
  ];

  if (positiveConditions.includes(condition)) {
    return side === "LONG" ? "SUPPORTING" : "CONFLICTING";
  }
  if (negativeConditions.includes(condition)) {
    return side === "LONG" ? "CONFLICTING" : "SUPPORTING";
  }
  return "NEUTRAL";
}

// ═══════════════════════════════════════════════════════════════
// FILTERING
// ═══════════════════════════════════════════════════════════════

/**
 * Pure deterministic filter.
 * Does not modify input array or persisted data.
 */
export function filterNotifications(
  notifications: Notification[],
  filter: NotificationFilter,
): Notification[] {
  switch (filter) {
    case "ALL":
      return notifications;
    case "UNREAD":
      return notifications.filter((n) => !n.read);
    case "CRITICAL":
      return notifications.filter((n) => n.severity === "CRITICAL");
    case "HIGH":
      return notifications.filter((n) => n.severity === "HIGH");
    case "MEDIUM":
      return notifications.filter((n) => n.severity === "MEDIUM");
    case "LOW":
      return notifications.filter((n) => n.severity === "LOW");
    default:
      return notifications;
  }
}

// ═══════════════════════════════════════════════════════════════
// RETENTION
// ═══════════════════════════════════════════════════════════════

/**
 * Deterministic retention policy.
 * Preserves highest-severity notifications first.
 * When severities are equal, keeps newest.
 * Never deletes unread CRITICAL notifications unless over hard limit.
 */
export function applyRetention(
  notifications: Notification[],
  maxCount: number = MAX_NOTIFICATIONS_PER_USER,
): Notification[] {
  if (notifications.length <= maxCount) return notifications;

  // Sort by severity desc, then by timestamp desc
  const sorted = [...notifications].sort((a, b) => {
    const sevDiff =
      (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0);
    if (sevDiff !== 0) return sevDiff;
    return b.createdAt - a.createdAt;
  });

  return sorted.slice(0, maxCount);
}

// ═══════════════════════════════════════════════════════════════
// SEVERITY & CATEGORY DISPLAY HELPERS
// ═══════════════════════════════════════════════════════════════

export const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  INFO: "text-blue-400",
  LOW: "text-cyan-400",
  MEDIUM: "text-amber-400",
  HIGH: "text-orange-400",
  CRITICAL: "text-red-400",
};

export const SEVERITY_BG: Record<NotificationSeverity, string> = {
  INFO: "bg-blue-500/10",
  LOW: "bg-cyan-500/10",
  MEDIUM: "bg-amber-500/10",
  HIGH: "bg-orange-500/10",
  CRITICAL: "bg-red-500/10",
};

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  THESIS: "Thesis",
  REGIME: "Regime",
  TREND: "Trend",
  STRUCTURE: "Structure",
  MOMENTUM: "Momentum",
  VOLATILITY: "Volatility",
  EVIDENCE: "Evidence",
  NEWS: "News",
  MACRO: "Macro",
  CROSS_ASSET: "Cross-Asset",
  PORTFOLIO: "Portfolio",
  DATA_QUALITY: "Data",
  SYSTEM: "System",
};
