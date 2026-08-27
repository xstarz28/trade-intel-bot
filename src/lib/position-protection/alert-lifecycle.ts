/**
 * Phase 57 — Alert Lifecycle Manager
 *
 * Manages state transitions, cooldowns, hysteresis, and duplicate suppression.
 * Pure functions — no side effects.
 */

import type { AlertSeverity, AlertLifecycleState, AlertLifecycleEntry, MonitoringState } from "./types";
import { ALERT_SEVERITY_ORDER, alertSeverityRank } from "./types";

// ═══════════════════════════════════════════════════════════════
// COOLDOWN PERIODS (ms)
// ═══════════════════════════════════════════════════════════════

const COOLDOWN_MS: Record<AlertSeverity, number> = {
  NONE: 60_000,
  WATCH: 30_000,
  CAUTION: 15_000,
  HIGH_RISK: 5_000,
  INVALIDATED: 0, // always fire
};

// ═══════════════════════════════════════════════════════════════
// SEVERITY → LIFECYCLE MAPPING
// ═══════════════════════════════════════════════════════════════

function severityToLifecycle(s: AlertSeverity): AlertLifecycleState {
  switch (s) {
    case "NONE": return "MONITORING";
    case "WATCH": return "WATCH";
    case "CAUTION": return "CAUTION";
    case "HIGH_RISK": return "HIGH_RISK";
    case "INVALIDATED": return "INVALIDATED";
  }
}

// ═══════════════════════════════════════════════════════════════
// INITIAL STATE
// ═══════════════════════════════════════════════════════════════

export function createMonitoringState(instrument: string): MonitoringState {
  return {
    instrument,
    currentSeverity: "NONE",
    lifecycleState: "MONITORING",
    nextAlertAllowedAt: 0,
    lastAlertAt: 0,
    consecutiveSameSeverity: 0,
    history: [],
  };
}

// ═══════════════════════════════════════════════════════════════
// DETERMINE IF ALERT SHOULD FIRE
// ═══════════════════════════════════════════════════════════════

export function shouldAlert(
  state: MonitoringState,
  newSeverity: AlertSeverity,
  now: number,
): { shouldFire: boolean; reason: string } {
  // Always fire INVALIDATED
  if (newSeverity === "INVALIDATED") {
    return { shouldFire: true, reason: "Thesis invalidated — always alert." };
  }

  // Always fire on state transition (escalation or recovery)
  const isTransition = newSeverity !== state.currentSeverity;
  if (isTransition) {
    // Check cooldown for escalations
    if (alertSeverityRank(newSeverity) > alertSeverityRank(state.currentSeverity)) {
      // Escalation — respect cooldown unless severity warrants immediate
      if (now < state.nextAlertAllowedAt && newSeverity !== "INVALIDATED") {
        return { shouldFire: false, reason: `Cooldown active until ${new Date(state.nextAlertAllowedAt).toISOString()}.` };
      }
      return { shouldFire: true, reason: `Escalation: ${state.currentSeverity} → ${newSeverity}.` };
    }
    // Recovery (severity decreased)
    return { shouldFire: true, reason: `Recovery: ${state.currentSeverity} → ${newSeverity}.` };
  }

  // Same severity — check consecutive count for hysteresis
  // Only re-alert if enough time has passed and we haven't already alerted recently
  if (now < state.nextAlertAllowedAt) {
    return { shouldFire: false, reason: "Same severity, within cooldown." };
  }

  // After long enough at same severity, allow one periodic re-alert for HIGH_RISK+
  if (newSeverity === "HIGH_RISK" && state.consecutiveSameSeverity >= 3) {
    return { shouldFire: true, reason: "Periodic re-alert for HIGH_RISK." };
  }

  return { shouldFire: false, reason: "Same severity, no escalation." };
}

// ═══════════════════════════════════════════════════════════════
// UPDATE STATE AFTER ALERT
// ═══════════════════════════════════════════════════════════════

export function updateMonitoringState(
  state: MonitoringState,
  newSeverity: AlertSeverity,
  now: number,
): MonitoringState {
  const isSame = newSeverity === state.currentSeverity;
  const cooldown = COOLDOWN_MS[newSeverity] ?? 30_000;

  const lifecycleEntry: AlertLifecycleEntry | undefined = newSeverity !== state.currentSeverity
    ? {
        instrument: state.instrument,
        from: severityToLifecycle(state.currentSeverity),
        to: severityToLifecycle(newSeverity),
        timestamp: now,
        reason: `${state.currentSeverity} → ${newSeverity}`,
      }
    : undefined;

  return {
    ...state,
    currentSeverity: newSeverity,
    lifecycleState: severityToLifecycle(newSeverity),
    nextAlertAllowedAt: now + cooldown,
    lastAlertAt: now,
    consecutiveSameSeverity: isSame ? state.consecutiveSameSeverity + 1 : 0,
    history: lifecycleEntry
      ? [...state.history, lifecycleEntry]
      : state.history,
  };
}

// ═══════════════════════════════════════════════════════════════
// DEDUPLICATE DEPENDENCY GROUPS
// ═══════════════════════════════════════════════════════════════

export function deduplicateByDependencyGroup<T extends { dependencyGroup: string }>(
  signals: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const sig of signals) {
    const existing = seen.get(sig.dependencyGroup);
    // Keep the higher-severity one
    if (!existing || (sig as any).severity > (existing as any).severity) {
      seen.set(sig.dependencyGroup, sig);
    }
  }
  return Array.from(seen.values());
}
