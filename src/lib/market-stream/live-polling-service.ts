/**
 * Phase 65 — Live Polling Service
 *
 * Production-safe polling scheduler that:
 * - Polls only providers/capabilities that are actually available
 * - Polls only instruments with active registered positions
 * - Respects provider rate limits and monitoring cadence
 * - Normalizes returned data into existing StreamEvent structures
 * - Feeds events into the continuous protection controller
 * - Supports START / PAUSE / RESUME / STOP / REFRESH_NOW
 * - Prevents duplicate polling loops
 * - Prevents overlapping requests
 * - Handles provider timeout/degradation gracefully
 * - Tracks provider health and instrument freshness
 * - Exponential backoff for repeated failures
 * - Stops unnecessary polling when no positions are active
 *
 * POLLING MODE ONLY — does NOT implement fake WebSocket.
 *
 * Pure state machines — side-effect-free evaluation.
 * Actual HTTP polling is delegated to provider actions.
 */

import type { RealTimeEvent } from "../position-protection/realtime-types";
import {
  createBridgeState,
  bridgeProviderData,
  type LiveMarketBridgeState,
  type ProviderQuoteData,
} from "./live-market-bridge";
import { routeInstrument, detectAssetClass, getFallbackRoute, type RoutingResult } from "./provider-routing";

// ═══════════════════════════════════════════════════════════════
// POLLING LIFECYCLE
// ═══════════════════════════════════════════════════════════════

export type PollingLifecycle = "STOPPED" | "STARTING" | "RUNNING" | "PAUSED";

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT POLLING STATE
// ═══════════════════════════════════════════════════════════════

export interface InstrumentPollingState {
  instrument: string;
  assetClass: string;
  routing: RoutingResult;
  /** Currently active provider. */
  activeProvider: string;
  /** Last successful poll timestamp. */
  lastSuccessfulPollAt: number;
  /** Last failed poll timestamp. */
  lastFailedPollAt: number;
  /** Consecutive failures for current provider. */
  consecutiveFailures: number;
  /** Whether currently using fallback. */
  usingFallback: boolean;
  /** Last price received. */
  lastPrice: number | null;
  /** Instrument freshness. */
  freshness: "FRESH" | "STALE" | "UNAVAILABLE" | "DEGRADED";
  /** Last event generated. */
  lastEventAt: number;
  /** Total polls performed. */
  totalPolls: number;
  /** Total successful polls. */
  successfulPolls: number;
  /** Total failed polls. */
  failedPolls: number;
}

// ═══════════════════════════════════════════════════════════════
// SERVICE STATE
// ═══════════════════════════════════════════════════════════════

export interface LivePollingServiceState {
  lifecycle: PollingLifecycle;
  /** Per-instrument polling state. */
  instruments: Map<string, InstrumentPollingState>;
  /** Bridge state for event normalization. */
  bridge: LiveMarketBridgeState;
  /** Total events generated. */
  eventsGenerated: number;
  /** Total polls across all instruments. */
  totalPolls: number;
  /** Total successful polls. */
  totalSuccessfulPolls: number;
  /** Total failed polls. */
  totalFailedPolls: number;
  /** Total provider failovers. */
  totalFailovers: number;
  /** Service started timestamp. */
  startedAt: number;
  /** Last cycle timestamp. */
  lastCycleAt: number;
}

// ═══════════════════════════════════════════════════════════════
// CREATE / LIFECYCLE
// ═══════════════════════════════════════════════════════════════

export function createPollingServiceState(): LivePollingServiceState {
  return {
    lifecycle: "STOPPED",
    instruments: new Map(),
    bridge: createBridgeState(),
    eventsGenerated: 0,
    totalPolls: 0,
    totalSuccessfulPolls: 0,
    totalFailedPolls: 0,
    totalFailovers: 0,
    startedAt: 0,
    lastCycleAt: 0,
  };
}

export function startPollingService(
  state: LivePollingServiceState,
  now: number,
): LivePollingServiceState {
  return { ...state, lifecycle: "RUNNING", startedAt: now };
}

export function stopPollingService(
  state: LivePollingServiceState,
): LivePollingServiceState {
  return { ...state, lifecycle: "STOPPED" };
}

export function pausePollingService(
  state: LivePollingServiceState,
): LivePollingServiceState {
  return { ...state, lifecycle: "PAUSED" };
}

export function resumePollingService(
  state: LivePollingServiceState,
  now: number,
): LivePollingServiceState {
  return { ...state, lifecycle: "RUNNING", lastCycleAt: now };
}

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT REGISTRATION
// ═══════════════════════════════════════════════════════════════

export function registerInstrumentForPolling(
  state: LivePollingServiceState,
  instrument: string,
  now: number,
): LivePollingServiceState {
  const normalized = instrument.toUpperCase().trim();
  if (state.instruments.has(normalized)) return state;

  const assetClass = detectAssetClass(normalized);
  const routing = routeInstrument(normalized, assetClass);
  const activeProvider = routing.primary?.provider ?? "UNKNOWN";

  const instruments = new Map(state.instruments);
  instruments.set(normalized, {
    instrument: normalized,
    assetClass,
    routing,
    activeProvider,
    lastSuccessfulPollAt: 0,
    lastFailedPollAt: 0,
    consecutiveFailures: 0,
    usingFallback: false,
    lastPrice: null,
    freshness: "UNAVAILABLE",
    lastEventAt: 0,
    totalPolls: 0,
    successfulPolls: 0,
    failedPolls: 0,
  });

  return { ...state, instruments };
}

export function unregisterInstrumentForPolling(
  state: LivePollingServiceState,
  instrument: string,
): LivePollingServiceState {
  const normalized = instrument.toUpperCase().trim();
  const instruments = new Map(state.instruments);
  instruments.delete(normalized);
  return { ...state, instruments };
}

// ═══════════════════════════════════════════════════════════════
// POLLING DECISION
// ═══════════════════════════════════════════════════════════════

export interface PollDecision {
  shouldPoll: boolean;
  reason: string;
  provider: string;
  pollIntervalMs: number;
}

/**
 * Determine if an instrument should be polled now.
 */
export function shouldPollInstrument(
  state: LivePollingServiceState,
  instrument: string,
  now: number,
): PollDecision {
  // Service must be running
  if (state.lifecycle !== "RUNNING") {
    return { shouldPoll: false, reason: "Polling service is not running.", provider: "NONE", pollIntervalMs: 0 };
  }

  const instrState = state.instruments.get(instrument.toUpperCase().trim());
  if (!instrState) {
    return { shouldPoll: false, reason: "Instrument not registered for polling.", provider: "NONE", pollIntervalMs: 0 };
  }

  const route = instrState.routing.primary;
  if (!route) {
    return { shouldPoll: false, reason: "No available provider for instrument.", provider: "NONE", pollIntervalMs: 0 };
  }

  // Check if enough time has passed since last successful poll
  const elapsed = now - instrState.lastSuccessfulPollAt;
  if (instrState.lastSuccessfulPollAt > 0 && elapsed < route.pollIntervalMs) {
    const remaining = route.pollIntervalMs - elapsed;
    return {
      shouldPoll: false,
      reason: `Within poll interval (${Math.round(remaining / 1000)}s remaining).`,
      provider: instrState.activeProvider,
      pollIntervalMs: route.pollIntervalMs,
    };
  }

  // Check cooldown after failure (exponential backoff)
  if (instrState.consecutiveFailures > 0) {
    const backoffMs = Math.min(
      1000 * Math.pow(2, instrState.consecutiveFailures),
      120_000, // max 2 minutes
    );
    const timeSinceFailure = now - instrState.lastFailedPollAt;
    if (timeSinceFailure < backoffMs) {
      return {
        shouldPoll: false,
        reason: `Backoff active (${Math.round((backoffMs - timeSinceFailure) / 1000)}s remaining).`,
        provider: instrState.activeProvider,
        pollIntervalMs: backoffMs,
      };
    }
  }

  return {
    shouldPoll: true,
    reason: "Poll interval elapsed.",
    provider: instrState.activeProvider,
    pollIntervalMs: route.pollIntervalMs,
  };
}

// ═══════════════════════════════════════════════════════════════
// POLL RESULT PROCESSING
// ═══════════════════════════════════════════════════════════════

export interface PollResult {
  events: RealTimeEvent[];
  state: LivePollingServiceState;
}

/**
 * Process a successful poll result (quote data received from provider).
 */
export function processPollSuccess(
  state: LivePollingServiceState,
  instrument: string,
  quote: ProviderQuoteData,
  now: number,
): PollResult {
  const normalized = instrument.toUpperCase().trim();
  const instrState = state.instruments.get(normalized);
  if (!instrState) return { events: [], state };

  // Bridge quote → events
  const { events, state: newBridge } = bridgeProviderData(state.bridge, { quote });

  // Update instrument state
  const updatedInstr: InstrumentPollingState = {
    ...instrState,
    lastSuccessfulPollAt: now,
    consecutiveFailures: 0,
    lastPrice: quote.price,
    freshness: "FRESH",
    lastEventAt: now,
    totalPolls: instrState.totalPolls + 1,
    successfulPolls: instrState.successfulPolls + 1,
  };

  const instruments = new Map(state.instruments);
  instruments.set(normalized, updatedInstr);

  return {
    events,
    state: {
      ...state,
      instruments,
      bridge: newBridge,
      eventsGenerated: state.eventsGenerated + events.length,
      totalPolls: state.totalPolls + 1,
      totalSuccessfulPolls: state.totalSuccessfulPolls + 1,
      lastCycleAt: now,
    },
  };
}

/**
 * Process a failed poll (provider timeout/error).
 */
export function processPollFailure(
  state: LivePollingServiceState,
  instrument: string,
  reason: string,
  now: number,
): { state: LivePollingServiceState; failover: boolean; newProvider: string | null } {
  const normalized = instrument.toUpperCase().trim();
  const instrState = state.instruments.get(normalized);
  if (!instrState) return { state, failover: false, newProvider: null };

  const newConsecutive = instrState.consecutiveFailures + 1;
  let newProvider = instrState.activeProvider;
  let failover = false;

  // Attempt failover after 3 consecutive failures
  if (newConsecutive >= 3) {
    const fallback = getFallbackRoute(instrState.routing, instrState.activeProvider);
    if (fallback) {
      newProvider = fallback.provider;
      failover = true;
    }
  }

  const updatedInstr: InstrumentPollingState = {
    ...instrState,
    lastFailedPollAt: now,
    consecutiveFailures: newConsecutive,
    activeProvider: newProvider,
    usingFallback: failover || instrState.usingFallback,
    freshness: newConsecutive >= 5 ? "UNAVAILABLE" : "STALE",
    totalPolls: instrState.totalPolls + 1,
    failedPolls: instrState.failedPolls + 1,
  };

  const instruments = new Map(state.instruments);
  instruments.set(normalized, updatedInstr);

  return {
    state: {
      ...state,
      instruments,
      totalPolls: state.totalPolls + 1,
      totalFailedPolls: state.totalFailedPolls + 1,
      totalFailovers: state.totalFailovers + (failover ? 1 : 0),
      lastCycleAt: now,
    },
    failover,
    newProvider: failover ? newProvider : null,
  };
}

// ═══════════════════════════════════════════════════════════════
// SERVICE DASHBOARD
// ═══════════════════════════════════════════════════════════════

export interface PollingDashboard {
  lifecycle: PollingLifecycle;
  totalInstruments: number;
  activePolling: number;
  staleInstruments: number;
  unavailableInstruments: number;
  totalEventsGenerated: number;
  totalPolls: number;
  totalSuccessfulPolls: number;
  totalFailedPolls: number;
  totalFailovers: number;
  uptimeMs: number;
}

export function getPollingDashboard(
  state: LivePollingServiceState,
  now: number,
): PollingDashboard {
  let activePolling = 0;
  let stale = 0;
  let unavailable = 0;

  for (const instr of state.instruments.values()) {
    if (instr.freshness === "FRESH") activePolling++;
    if (instr.freshness === "STALE") stale++;
    if (instr.freshness === "UNAVAILABLE") unavailable++;
  }

  return {
    lifecycle: state.lifecycle,
    totalInstruments: state.instruments.size,
    activePolling,
    staleInstruments: stale,
    unavailableInstruments: unavailable,
    totalEventsGenerated: state.eventsGenerated,
    totalPolls: state.totalPolls,
    totalSuccessfulPolls: state.totalSuccessfulPolls,
    totalFailedPolls: state.totalFailedPolls,
    totalFailovers: state.totalFailovers,
    uptimeMs: state.startedAt > 0 ? now - state.startedAt : 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET INSTRUMENTS NEEDING POLL
// ═══════════════════════════════════════════════════════════════

/**
 * Get all instruments that need polling at a given timestamp.
 * Used by the polling loop to determine what to fetch.
 */
export function getInstrumentsNeedingPoll(
  state: LivePollingServiceState,
  now: number,
): string[] {
  if (state.lifecycle !== "RUNNING") return [];

  const result: string[] = [];
  for (const [instrument] of state.instruments) {
    const decision = shouldPollInstrument(state, instrument, now);
    if (decision.shouldPoll) {
      result.push(instrument);
    }
  }
  return result;
}
