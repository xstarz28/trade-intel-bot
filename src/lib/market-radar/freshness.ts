/**
 * Phase 51 — Freshness Assessment
 *
 * Horizon-aware freshness evaluation, transitions, and eligibility checks.
 */

import type { FreshnessLevel, FreshnessGate, OpportunityLifecycle } from "./types";
import { meetsFreshness, HORIZON_FRESHNESS_GATES } from "./types";

// ═══════════════════════════════════════════════════════════════
// FRESHNESS FROM TIMESTAMP
// ═══════════════════════════════════════════════════════════════

export function assessFreshness(
  timestamp: number | undefined,
  now: number,
): FreshnessLevel {
  if (!timestamp) return "UNAVAILABLE";
  const ageMs = now - timestamp;
  if (ageMs < 0) return "UNAVAILABLE"; // future timestamp
  if (ageMs < 5 * 60_000) return "FRESH";         // < 5 min
  if (ageMs < 60 * 60_000) return "DELAYED";      // < 1 hour
  if (ageMs < 24 * 60 * 60_000) return "STALE";   // < 24 hours
  return "UNAVAILABLE";
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS ELIGIBILITY
// ═══════════════════════════════════════════════════════════════

export interface FreshnessEligibility {
  eligible: boolean;
  reason: string;
  gate: FreshnessGate;
  actualFreshness: FreshnessLevel;
}

export function checkFreshnessEligibility(
  freshness: FreshnessLevel,
  hasLiveData: boolean,
  horizon: string,
): FreshnessEligibility {
  const gate = HORIZON_FRESHNESS_GATES[horizon as keyof typeof HORIZON_FRESHNESS_GATES]
    ?? HORIZON_FRESHNESS_GATES["INTRADAY"];

  if (!meetsFreshness(freshness, gate.maxFreshness)) {
    return {
      eligible: false,
      reason: `freshness ${freshness} exceeds ${horizon} gate (${gate.maxFreshness} max)`,
      gate,
      actualFreshness: freshness,
    };
  }

  if (gate.requireLiveData && !hasLiveData) {
    return {
      eligible: false,
      reason: `${horizon} requires live data but not available`,
      gate,
      actualFreshness: freshness,
    };
  }

  return {
    eligible: true,
    reason: `freshness ${freshness} meets ${horizon} gate`,
    gate,
    actualFreshness: freshness,
  };
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS TRANSITION
// ═══════════════════════════════════════════════════════════════

export function shouldTransitionLifecycle(
  currentLifecycle: OpportunityLifecycle,
  currentFreshness: FreshnessLevel,
  hasLiveData: boolean,
  dataCompleteness: string,
  horizon: string,
): { shouldTransition: boolean; newLifecycle?: OpportunityLifecycle; reason?: string } {
  const eligibility = checkFreshnessEligibility(currentFreshness, hasLiveData, horizon);

  // ACTIVE → DEGRADED when freshness expires
  if (currentLifecycle === "ACTIVE" && !eligibility.eligible) {
    return {
      shouldTransition: true,
      newLifecycle: "DEGRADED",
      reason: eligibility.reason,
    };
  }

  // DEGRADED → EXPIRED when data is UNAVAILABLE
  if (currentLifecycle === "DEGRADED" && currentFreshness === "UNAVAILABLE") {
    return {
      shouldTransition: true,
      newLifecycle: "EXPIRED",
      reason: "data completely unavailable",
    };
  }

  // DEGRADED → ACTIVE when freshness recovers
  if (currentLifecycle === "DEGRADED" && eligibility.eligible) {
    return {
      shouldTransition: true,
      newLifecycle: "ACTIVE",
      reason: "freshness recovered",
    };
  }

  // QUALIFIED → ACTIVE when data quality is sufficient
  if (currentLifecycle === "QUALIFIED" && eligibility.eligible && dataCompleteness !== "NONE") {
    return {
      shouldTransition: true,
      newLifecycle: "ACTIVE",
      reason: "data quality sufficient for active status",
    };
  }

  // Any state → INVALIDATED when no data at all
  if (dataCompleteness === "NONE" && currentLifecycle !== "INVALIDATED" && currentLifecycle !== "EXPIRED") {
    return {
      shouldTransition: true,
      newLifecycle: "INVALIDATED",
      reason: "no data available",
    };
  }

  return { shouldTransition: false };
}

// ═══════════════════════════════════════════════════════════════
// FRESHNESS CLASSIFICATION SUMMARY
// ═══════════════════════════════════════════════════════════════

export interface FreshnessSummary {
  fresh: number;
  delayed: number;
  stale: number;
  unavailable: number;
}

export function summarizeFreshness(levels: FreshnessLevel[]): FreshnessSummary {
  const summary: FreshnessSummary = { fresh: 0, delayed: 0, stale: 0, unavailable: 0 };
  for (const l of levels) {
    if (l === "FRESH") summary.fresh++;
    else if (l === "DELAYED") summary.delayed++;
    else if (l === "STALE") summary.stale++;
    else summary.unavailable++;
  }
  return summary;
}
