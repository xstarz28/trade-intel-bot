/**
 * Phase 59 — Reconnection Engine
 *
 * Handles stream lifecycle, exponential backoff, heartbeat/watchdog,
 * monitoring gap detection, and reconnection recovery.
 *
 * Pure state machines — no side effects in evaluation functions.
 */

import type { StreamStatus, StreamHealthState, ReconciliationResult } from "./types";

// ═══════════════════════════════════════════════════════════════
// RECONNECTION STATE
// ═══════════════════════════════════════════════════════════════

export interface ReconnectState {
  /** Current stream status. */
  status: StreamStatus;
  /** Number of consecutive reconnection attempts. */
  attempts: number;
  /** Maximum attempts before giving up. */
  maxAttempts: number;
  /** Current backoff duration (ms). */
  currentBackoffMs: number;
  /** Maximum backoff duration (ms). */
  maxBackoffMs: number;
  /** Timestamp of last connection. */
  lastConnectedAt: number;
  /** Timestamp of last disconnect. */
  lastDisconnectedAt: number;
  /** Timestamp of last message received. */
  lastMessageAt: number;
  /** Timestamp of last heartbeat sent. */
  lastHeartbeatAt: number;
  /** Heartbeat interval (ms). */
  heartbeatIntervalMs: number;
  /** Stale threshold (ms). */
  staleThresholdMs: number;
  /** Monitoring gap start timestamp. */
  gapStartAt: number;
  /** Total monitoring gap accumulated (ms). */
  totalGapMs: number;
  /** Last error. */
  lastError?: string;
}

export function createReconnectState(config?: {
  maxAttempts?: number;
  maxBackoffMs?: number;
  heartbeatIntervalMs?: number;
  staleThresholdMs?: number;
}): ReconnectState {
  return {
    status: "DISCONNECTED",
    attempts: 0,
    maxAttempts: config?.maxAttempts ?? 10,
    currentBackoffMs: 1_000,
    maxBackoffMs: config?.maxBackoffMs ?? 30_000,
    lastConnectedAt: 0,
    lastDisconnectedAt: 0,
    lastMessageAt: 0,
    lastHeartbeatAt: 0,
    heartbeatIntervalMs: config?.heartbeatIntervalMs ?? 30_000,
    staleThresholdMs: config?.staleThresholdMs ?? 60_000,
    gapStartAt: 0,
    totalGapMs: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// STATE TRANSITIONS
// ═══════════════════════════════════════════════════════════════

export function initiateConnect(state: ReconnectState, now: number): ReconnectState {
  return {
    ...state,
    status: "CONNECTING",
    gapStartAt: state.gapStartAt || now,
    lastError: undefined,
  };
}

export function onConnected(state: ReconnectState, now: number): ReconnectState {
  const gapDuration = state.gapStartAt > 0 ? now - state.gapStartAt : 0;
  return {
    ...state,
    status: "LIVE",
    attempts: 0,
    currentBackoffMs: 1_000,
    lastConnectedAt: now,
    lastMessageAt: now,
    totalGapMs: state.totalGapMs + gapDuration,
    gapStartAt: 0,
    lastError: undefined,
  };
}

export function onDisconnected(state: ReconnectState, now: number, error?: string): ReconnectState {
  return {
    ...state,
    status: "DISCONNECTED",
    lastDisconnectedAt: now,
    gapStartAt: state.gapStartAt || now,
    lastError: error,
  };
}

export function initiateReconnect(state: ReconnectState, _now: number): ReconnectState {
  if (state.attempts >= state.maxAttempts) {
    return { ...state, status: "FAILED", lastError: "Max reconnect attempts exceeded." };
  }
  return {
    ...state,
    status: "RECONNECTING",
    attempts: state.attempts + 1,
    lastError: undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// EXPONENTIAL BACKOFF
// ═══════════════════════════════════════════════════════════════

export function computeBackoff(attempt: number, maxBackoffMs: number): number {
  // Bounded exponential backoff: 1s, 2s, 4s, 8s, 16s, 30s cap
  const base = 1_000;
  const backoff = base * Math.pow(2, Math.min(attempt, 15));
  return Math.min(backoff, maxBackoffMs);
}

export function advanceBackoff(state: ReconnectState): ReconnectState {
  return {
    ...state,
    currentBackoffMs: computeBackoff(state.attempts, state.maxBackoffMs),
  };
}

// ═══════════════════════════════════════════════════════════════
// HEARTBEAT / WATCHDOG
// ═══════════════════════════════════════════════════════════════

export function checkHeartbeat(state: ReconnectState, now: number): {
  needsHeartbeat: boolean;
  isStale: boolean;
  connectionAlive: boolean;
  dataFresh: boolean;
  gapDurationMs: number;
} {
  const timeSinceLastMessage = now - state.lastMessageAt;
  const timeSinceLastHeartbeat = now - state.lastHeartbeatAt;
  const needsHeartbeat = timeSinceLastHeartbeat >= state.heartbeatIntervalMs;
  const isStale = timeSinceLastMessage >= state.staleThresholdMs;
  const connectionAlive = state.status === "LIVE" || state.status === "DEGRADED";
  const dataFresh = connectionAlive && !isStale;
  const gapDurationMs = state.gapStartAt > 0 ? now - state.gapStartAt : 0;

  return { needsHeartbeat, isStale, connectionAlive, dataFresh, gapDurationMs };
}

export function recordMessage(state: ReconnectState, now: number): ReconnectState {
  return { ...state, lastMessageAt: now };
}

export function recordHeartbeat(state: ReconnectState, now: number): ReconnectState {
  return { ...state, lastHeartbeatAt: now };
}

// ═══════════════════════════════════════════════════════════════
// STALE DETECTION
// ═══════════════════════════════════════════════════════════════

export function detectStaleness(state: ReconnectState, now: number): StreamStatus {
  if (state.status !== "LIVE" && state.status !== "DEGRADED") return state.status;
  const timeSinceMessage = now - state.lastMessageAt;
  if (timeSinceMessage >= state.staleThresholdMs * 2) return "STALE";
  if (timeSinceMessage >= state.staleThresholdMs) return "DEGRADED";
  return "LIVE";
}

// ═══════════════════════════════════════════════════════════════
// RECONCILIATION AFTER RECONNECT
// ═══════════════════════════════════════════════════════════════

export function reconcileAfterReconnect(
  state: ReconnectState,
  currentPrice: number,
  currentTimestamp: number,
  now: number,
): ReconciliationResult {
  const gapDurationMs = state.gapStartAt > 0 ? now - state.gapStartAt : 0;
  // We cannot determine how many events were missed without a sequence model
  const eventsMissed = 0;

  const success = currentPrice > 0 && currentTimestamp > 0;

  return {
    success,
    gapDurationMs,
    gapDataAvailable: false, // We don't infer missed events
    eventsMissed,
    currentPrice,
    currentTimestamp,
    stateReconciled: success,
    description: success
      ? gapDurationMs > 0
        ? `Monitoring gap: ${(gapDurationMs / 1000).toFixed(0)}s. State reconciled at price ${currentPrice.toFixed(2)}.`
        : "State reconciled."
      : "Reconciliation incomplete — data unavailable.",
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH STATE BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildHealthState(
  state: ReconnectState,
  provider: string,
  eventsReceived: number,
  eventsDropped: number,
): StreamHealthState {
  let health: StreamHealthState["health"];
  switch (state.status) {
    case "LIVE":
      health = "HEALTHY";
      break;
    case "DEGRADED":
      health = "DEGRADED";
      break;
    case "RECONNECTING":
      health = "TIMEOUT";
      break;
    case "FAILED":
      health = "UNAVAILABLE";
      break;
    case "STALE":
      health = "TIMEOUT";
      break;
    default:
      health = "UNAVAILABLE";
  }

  const heartbeatCheck = checkHeartbeat(state, Date.now());

  return {
    provider,
    status: state.status,
    health,
    lastMessageAt: state.lastMessageAt,
    uptimeMs: state.lastConnectedAt > 0 ? Date.now() - state.lastConnectedAt : 0,
    eventsReceived,
    eventsDropped,
    reconnectAttempts: state.attempts,
    lastError: state.lastError,
    heartbeatAlive: heartbeatCheck.connectionAlive,
    monitoringGapMs: heartbeatCheck.gapDurationMs,
  };
}
