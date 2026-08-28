/**
 * Phase 64 — Monitoring Cadence
 *
 * Configurable monitoring cadence profiles per trading horizon.
 * Distinguishes event-driven, scheduled, and critical evaluation.
 *
 * Pure functions — no side effects.
 */

import type { EventPriorityLevel } from "./event-priority";

// ═══════════════════════════════════════════════════════════════
// CADENCE PROFILE
// ═══════════════════════════════════════════════════════════════

export interface MonitoringCadenceProfile {
  /** Minimum interval between scheduled evaluations (ms). */
  scheduledIntervalMs: number;
  /** Minimum interval between event-driven evaluations (ms). */
  eventDrivenIntervalMs: number;
  /** Interval for periodic re-evaluation even without events (ms). */
  periodicIntervalMs: number;
  /** Description of this profile. */
  description: string;
}

const CADENCE_PROFILES: Record<string, MonitoringCadenceProfile> = {
  SCALPING: {
    scheduledIntervalMs: 2_000,      // 2s
    eventDrivenIntervalMs: 1_000,    // 1s
    periodicIntervalMs: 5_000,       // 5s
    description: "Very frequent — rapid market changes",
  },
  INTRADAY: {
    scheduledIntervalMs: 10_000,     // 10s
    eventDrivenIntervalMs: 5_000,    // 5s
    periodicIntervalMs: 30_000,      // 30s
    description: "Frequent — intraday monitoring",
  },
  SWING: {
    scheduledIntervalMs: 30_000,     // 30s
    eventDrivenIntervalMs: 15_000,   // 15s
    periodicIntervalMs: 60_000,      // 1m
    description: "Moderate — swing trading",
  },
  INVESTING: {
    scheduledIntervalMs: 120_000,    // 2m
    eventDrivenIntervalMs: 60_000,   // 1m
    periodicIntervalMs: 300_000,     // 5m
    description: "Slow — long-term monitoring",
  },
};

export function getCadenceForHorizon(horizon: string): MonitoringCadenceProfile {
  return CADENCE_PROFILES[horizon] ?? CADENCE_PROFILES.SWING;
}

// ═══════════════════════════════════════════════════════════════
// EVALUATION DECISION
// ═══════════════════════════════════════════════════════════════

/**
 * Determine if evaluation should happen now based on cadence.
 */
export function shouldEvaluateNow(
  lastEvaluationAt: number,
  now: number,
  cadence: MonitoringCadenceProfile,
  eventPriority: EventPriorityLevel,
): { shouldEvaluate: boolean; reason: string } {
  const elapsed = now - lastEvaluationAt;

  // Critical/High events use event-driven interval
  if (eventPriority === "CRITICAL") {
    return { shouldEvaluate: true, reason: "Critical event — immediate evaluation." };
  }
  if (eventPriority === "HIGH") {
    if (elapsed >= cadence.eventDrivenIntervalMs) {
      return { shouldEvaluate: true, reason: "High-priority event meets event-driven cadence." };
    }
    return { shouldEvaluate: false, reason: `High-priority event — cooldown (${Math.round((cadence.eventDrivenIntervalMs - elapsed) / 1000)}s remaining).` };
  }

  // Medium events use scheduled interval
  if (eventPriority === "MEDIUM") {
    if (elapsed >= cadence.scheduledIntervalMs) {
      return { shouldEvaluate: true, reason: "Medium-priority event meets scheduled cadence." };
    }
    return { shouldEvaluate: false, reason: `Medium-priority event — cooldown (${Math.round((cadence.scheduledIntervalMs - elapsed) / 1000)}s remaining).` };
  }

  // Low events use periodic interval
  if (elapsed >= cadence.periodicIntervalMs) {
    return { shouldEvaluate: true, reason: "Periodic evaluation." };
  }
  return { shouldEvaluate: false, reason: `Low-priority event — periodic interval (${Math.round((cadence.periodicIntervalMs - elapsed) / 1000)}s remaining).` };
}

/**
 * Get all cadence profiles.
 */
export function getAllCadenceProfiles(): Record<string, MonitoringCadenceProfile> {
  return { ...CADENCE_PROFILES };
}
