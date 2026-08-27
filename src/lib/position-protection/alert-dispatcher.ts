/**
 * Phase 58 — Alert Dispatcher
 *
 * Classifies alerts into notification priorities, manages dedup,
 * cooldown, escalation, recovery, and unread state.
 * Pure functions — no side effects.
 */

import type { AlertSeverity } from "./types";
import type {
  ProtectionEvent,
  NotificationPriority,
  AlertHistoryEntry,
} from "./realtime-types";
import { alertSeverityRank } from "./types";

// ═══════════════════════════════════════════════════════════════
// SEVERITY → NOTIFICATION PRIORITY
// ═══════════════════════════════════════════════════════════════

export function severityToNotificationPriority(severity: AlertSeverity): NotificationPriority {
  switch (severity) {
    case "NONE": return "INFO";
    case "WATCH": return "INFO";
    case "CAUTION": return "WARNING";
    case "HIGH_RISK": return "URGENT";
    case "INVALIDATED": return "CRITICAL";
  }
}

// ═══════════════════════════════════════════════════════════════
// EVENT FINGERPRINT (deterministic dedup key)
// ═══════════════════════════════════════════════════════════════

export function computeEventFingerprint(
  positionId: string,
  severity: AlertSeverity,
  timestamp: number,
  bucketMs: number = 30_000,
): string {
  const bucket = Math.floor(timestamp / bucketMs);
  return `${positionId}:${severity}:${bucket}`;
}

// ═══════════════════════════════════════════════════════════════
// DISPATCHER STATE
// ═══════════════════════════════════════════════════════════════

export interface DispatcherState {
  /** Seen fingerprints (for dedup). */
  seenFingerprints: Set<string>;
  /** Alert history. */
  history: AlertHistoryEntry[];
  /** Unread alerts count. */
  unreadCount: number;
  /** Last dispatch timestamp per position. */
  lastDispatchAt: Map<string, number>;
  /** Active alerts per position. */
  activeAlerts: Map<string, ProtectionEvent>;
}

export function createDispatcherState(): DispatcherState {
  return {
    seenFingerprints: new Set(),
    history: [],
    unreadCount: 0,
    lastDispatchAt: new Map(),
    activeAlerts: new Map(),
  };
}

// ═══════════════════════════════════════════════════════════════
// DISPATCH DECISION
// ═══════════════════════════════════════════════════════════════

export interface DispatchDecision {
  shouldDispatch: boolean;
  reason: string;
  isEscalation: boolean;
  isRecovery: boolean;
  isDuplicate: boolean;
}

export function shouldDispatch(
  state: DispatcherState,
  positionId: string,
  severity: AlertSeverity,
  now: number,
): DispatchDecision {
  // Always dispatch INVALIDATED
  if (severity === "INVALIDATED") {
    return { shouldDispatch: true, reason: "Thesis invalidated.", isEscalation: false, isRecovery: false, isDuplicate: false };
  }

  const active = state.activeAlerts.get(positionId);
  const fingerprint = computeEventFingerprint(positionId, severity, now);

  // Duplicate detection
  if (state.seenFingerprints.has(fingerprint)) {
    return { shouldDispatch: false, reason: "Duplicate fingerprint.", isEscalation: false, isRecovery: false, isDuplicate: true };
  }

  if (!active) {
    // No active alert — first alert for this position
    return { shouldDispatch: true, reason: "First alert for position.", isEscalation: false, isRecovery: false, isDuplicate: false };
  }

  const prevRank = alertSeverityRank(active.severity);
  const newRank = alertSeverityRank(severity);

  // Escalation
  if (newRank > prevRank) {
    return { shouldDispatch: true, reason: `Escalation: ${active.severity} → ${severity}.`, isEscalation: true, isRecovery: false, isDuplicate: false };
  }

  // Recovery
  if (newRank < prevRank) {
    return { shouldDispatch: true, reason: `Recovery: ${active.severity} → ${severity}.`, isEscalation: false, isRecovery: true, isDuplicate: false };
  }

  // Same severity — check cooldown
  const lastDispatch = state.lastDispatchAt.get(positionId) ?? 0;
  const cooldown = severity === "HIGH_RISK" ? 10_000 : 30_000;
  if (now - lastDispatch < cooldown) {
    return { shouldDispatch: false, reason: "Same severity within cooldown.", isEscalation: false, isRecovery: false, isDuplicate: false };
  }

  return { shouldDispatch: true, reason: "Periodic re-alert.", isEscalation: false, isRecovery: false, isDuplicate: false };
}

// ═══════════════════════════════════════════════════════════════
// DISPATCH (update state)
// ═══════════════════════════════════════════════════════════════

export function dispatch(
  state: DispatcherState,
  event: ProtectionEvent,
): DispatcherState {
  const fingerprint = computeEventFingerprint(event.positionId, event.severity, event.timestamp);
  const newSeen = new Set(state.seenFingerprints);
  newSeen.add(fingerprint);

  const newActive = new Map(state.activeAlerts);
  if (event.severity === "NONE") {
    newActive.delete(event.positionId);
  } else {
    newActive.set(event.positionId, event);
  }

  const newLastDispatch = new Map(state.lastDispatchAt);
  newLastDispatch.set(event.positionId, event.timestamp);

  const entry: AlertHistoryEntry = {
    positionId: event.positionId,
    instrument: event.instrument,
    severity: event.severity,
    notificationPriority: event.notificationPriority,
    reason: event.reason,
    action: event.action,
    timestamp: event.timestamp,
    acknowledged: false,
  };

  return {
    seenFingerprints: newSeen,
    history: [...state.history, entry],
    unreadCount: state.unreadCount + 1,
    lastDispatchAt: newLastDispatch,
    activeAlerts: newActive,
  };
}

// ═══════════════════════════════════════════════════════════════
// ACKNOWLEDGE
// ═══════════════════════════════════════════════════════════════

export function acknowledgeAlert(
  state: DispatcherState,
  positionId: string,
): DispatcherState {
  const newHistory = state.history.map(e =>
    e.positionId === positionId ? { ...e, acknowledged: true } : e,
  );
  const removed = state.activeAlerts.get(positionId);
  const newActive = new Map(state.activeAlerts);
  newActive.delete(positionId);
  return {
    ...state,
    history: newHistory,
    activeAlerts: newActive,
    unreadCount: removed ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
  };
}
