/**
 * Phase 67 — Diagnostics / Observability
 *
 * Lightweight internal diagnostics for the position protection system.
 * Tracks events, alerts, provider health, and monitoring state.
 * All data is bounded — no unbounded growth.
 * No sensitive infrastructure details are exposed.
 */

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTICS STATE
// ═══════════════════════════════════════════════════════════════

export interface ProviderHealthEntry {
  provider: string;
  status: "CONNECTED" | "DEGRADED" | "UNAVAILABLE" | "UNKNOWN";
  lastSuccessAt: number;
  lastFailureAt: number;
  consecutiveFailures: number;
  totalFailures: number;
  totalSuccesses: number;
  instrumentsServed: string[];
  freshness: "FRESH" | "STALE" | "UNAVAILABLE";
}

export interface DiagnosticsState {
  /** Total events received from all providers. */
  eventsReceived: number;
  /** Total events processed by protection engine. */
  eventsProcessed: number;
  /** Total events dropped (invalid, stale, duplicate). */
  eventsDropped: number;
  /** Total events deduplicated. */
  eventsDeduplicated: number;
  /** Total alerts emitted. */
  alertsEmitted: number;
  /** Total alerts suppressed by dedup fingerprint. */
  alertsSuppressedByDedup: number;
  /** Total alerts suppressed by cooldown. */
  alertsSuppressedByCooldown: number;
  /** Total critical events received. */
  criticalEventsReceived: number;
  /** Total stale events received. */
  staleEventsReceived: number;
  /** Total provider failures. */
  providerFailures: number;
  /** Total provider recoveries. */
  providerRecoveries: number;
  /** Per-provider health. */
  providerHealth: Map<string, ProviderHealthEntry>;
  /** Currently monitored positions count. */
  monitoredPositions: number;
  /** Positions with active alerts. */
  positionsWithAlerts: number;
  /** Timestamp of last event received. */
  lastEventReceivedAt: number;
  /** Timestamp of last alert emitted. */
  lastAlertEmittedAt: number;
  /** Timestamp of last provider failure. */
  lastProviderFailureAt: number;
  /** Timestamp of last recovery. */
  lastRecoveryAt: number;
}

export function createDiagnosticsState(): DiagnosticsState {
  return {
    eventsReceived: 0,
    eventsProcessed: 0,
    eventsDropped: 0,
    eventsDeduplicated: 0,
    alertsEmitted: 0,
    alertsSuppressedByDedup: 0,
    alertsSuppressedByCooldown: 0,
    criticalEventsReceived: 0,
    staleEventsReceived: 0,
    providerFailures: 0,
    providerRecoveries: 0,
    providerHealth: new Map(),
    monitoredPositions: 0,
    positionsWithAlerts: 0,
    lastEventReceivedAt: 0,
    lastAlertEmittedAt: 0,
    lastProviderFailureAt: 0,
    lastRecoveryAt: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// RECORD EVENTS
// ═══════════════════════════════════════════════════════════════

export function recordEventReceived(
  state: DiagnosticsState,
  isCritical: boolean,
  isStale: boolean,
  now: number,
): DiagnosticsState {
  return {
    ...state,
    eventsReceived: state.eventsReceived + 1,
    criticalEventsReceived: state.criticalEventsReceived + (isCritical ? 1 : 0),
    staleEventsReceived: state.staleEventsReceived + (isStale ? 1 : 0),
    lastEventReceivedAt: now,
  };
}

export function recordEventProcessed(state: DiagnosticsState): DiagnosticsState {
  return { ...state, eventsProcessed: state.eventsProcessed + 1 };
}

export function recordEventDropped(state: DiagnosticsState): DiagnosticsState {
  return { ...state, eventsDropped: state.eventsDropped + 1 };
}

export function recordEventDeduplicated(state: DiagnosticsState): DiagnosticsState {
  return { ...state, eventsDeduplicated: state.eventsDeduplicated + 1 };
}

// ═══════════════════════════════════════════════════════════════
// RECORD ALERTS
// ═══════════════════════════════════════════════════════════════

export function recordAlertEmitted(state: DiagnosticsState, now: number): DiagnosticsState {
  return {
    ...state,
    alertsEmitted: state.alertsEmitted + 1,
    lastAlertEmittedAt: now,
  };
}

export function recordAlertSuppressedByDedup(state: DiagnosticsState): DiagnosticsState {
  return { ...state, alertsSuppressedByDedup: state.alertsSuppressedByDedup + 1 };
}

export function recordAlertSuppressedByCooldown(state: DiagnosticsState): DiagnosticsState {
  return { ...state, alertsSuppressedByCooldown: state.alertsSuppressedByCooldown + 1 };
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER HEALTH
// ═══════════════════════════════════════════════════════════════

export function recordProviderFailure(
  state: DiagnosticsState,
  provider: string,
  instrument: string,
  now: number,
): DiagnosticsState {
  const existing = state.providerHealth.get(provider) ?? {
    provider,
    status: "UNKNOWN" as const,
    lastSuccessAt: 0,
    lastFailureAt: 0,
    consecutiveFailures: 0,
    totalFailures: 0,
    totalSuccesses: 0,
    instrumentsServed: [],
    freshness: "UNAVAILABLE" as const,
  };

  const updated: ProviderHealthEntry = {
    ...existing,
    status: existing.consecutiveFailures + 1 >= 3 ? "DEGRADED" : existing.status,
    lastFailureAt: now,
    consecutiveFailures: existing.consecutiveFailures + 1,
    totalFailures: existing.totalFailures + 1,
    instrumentsServed: existing.instrumentsServed.includes(instrument)
      ? existing.instrumentsServed
      : [...existing.instrumentsServed, instrument],
    freshness: existing.consecutiveFailures + 1 >= 5 ? "UNAVAILABLE" : existing.freshness,
  };

  const providerHealth = new Map(state.providerHealth);
  providerHealth.set(provider, updated);

  return {
    ...state,
    providerHealth,
    providerFailures: state.providerFailures + 1,
    lastProviderFailureAt: now,
  };
}

export function recordProviderRecovery(
  state: DiagnosticsState,
  provider: string,
  now: number,
): DiagnosticsState {
  const existing = state.providerHealth.get(provider);
  if (!existing) return state;

  const updated: ProviderHealthEntry = {
    ...existing,
    status: "CONNECTED",
    consecutiveFailures: 0,
    lastSuccessAt: now,
    totalSuccesses: existing.totalSuccesses + 1,
    freshness: "FRESH",
  };

  const providerHealth = new Map(state.providerHealth);
  providerHealth.set(provider, updated);

  return {
    ...state,
    providerHealth,
    providerRecoveries: state.providerRecoveries + 1,
    lastRecoveryAt: now,
  };
}

export function recordProviderSuccess(
  state: DiagnosticsState,
  provider: string,
  now: number,
): DiagnosticsState {
  const existing = state.providerHealth.get(provider);
  if (!existing) return state;

  const updated: ProviderHealthEntry = {
    ...existing,
    status: "CONNECTED",
    consecutiveFailures: 0,
    lastSuccessAt: now,
    totalSuccesses: existing.totalSuccesses + 1,
    freshness: "FRESH",
  };

  const providerHealth = new Map(state.providerHealth);
  providerHealth.set(provider, updated);

  return { ...state, providerHealth };
}

// ═══════════════════════════════════════════════════════════════
// POSITION COUNTS
// ═══════════════════════════════════════════════════════════════

export function updatePositionCounts(
  state: DiagnosticsState,
  totalPositions: number,
  positionsWithAlerts: number,
): DiagnosticsState {
  return { ...state, monitoredPositions: totalPositions, positionsWithAlerts };
}

// ═══════════════════════════════════════════════════════════════
// DIAGNOSTICS SNAPSHOT
// ═══════════════════════════════════════════════════════════════

export interface DiagnosticsSnapshot {
  eventsReceived: number;
  eventsProcessed: number;
  eventsDropped: number;
  eventsDeduplicated: number;
  alertsEmitted: number;
  alertsSuppressedByDedup: number;
  alertsSuppressedByCooldown: number;
  criticalEventsReceived: number;
  staleEventsReceived: number;
  providerFailures: number;
  providerRecoveries: number;
  monitoredPositions: number;
  positionsWithAlerts: number;
  lastEventReceivedAt: number;
  lastAlertEmittedAt: number;
  providers: ProviderHealthEntry[];
}

export function snapshot(state: DiagnosticsState): DiagnosticsSnapshot {
  return {
    eventsReceived: state.eventsReceived,
    eventsProcessed: state.eventsProcessed,
    eventsDropped: state.eventsDropped,
    eventsDeduplicated: state.eventsDeduplicated,
    alertsEmitted: state.alertsEmitted,
    alertsSuppressedByDedup: state.alertsSuppressedByDedup,
    alertsSuppressedByCooldown: state.alertsSuppressedByCooldown,
    criticalEventsReceived: state.criticalEventsReceived,
    staleEventsReceived: state.staleEventsReceived,
    providerFailures: state.providerFailures,
    providerRecoveries: state.providerRecoveries,
    monitoredPositions: state.monitoredPositions,
    positionsWithAlerts: state.positionsWithAlerts,
    lastEventReceivedAt: state.lastEventReceivedAt,
    lastAlertEmittedAt: state.lastAlertEmittedAt,
    providers: Array.from(state.providerHealth.values()),
  };
}
