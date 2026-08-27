/**
 * Phase 59 — Stream Orchestrator
 *
 * Connects live market streams to the existing position protection engine.
 * Manages per-instrument stream state, event normalization, position registration,
 * and delegates to the Phase 58 RealTimeMonitor for protection evaluation.
 *
 * Pure state machines — side-effect-free evaluation.
 * Real connection/polling is managed by the platform layer.
 */

import type {
  StreamEvent,
  StreamStatus,
  StreamHealthState,
  ReconciliationResult,
  RegisteredPosition,
  PositionLifecycle,
  SymbolMapping,
  StreamConfig,
} from "./types";
import {
  createReconnectState,
  initiateConnect,
  onConnected,
  onDisconnected,
  initiateReconnect,
  advanceBackoff,
  detectStaleness,
  reconcileAfterReconnect,
  recordMessage,
  buildHealthState,
  type ReconnectState,
} from "./reconnection-engine";
import { getProviderProfile, buildStreamConfig } from "./provider-adapters";
import type { MonitorState, ProcessResult } from "../position-protection/realtime-monitor";
import type { PositionSnapshot } from "../position-protection/realtime-types";
import { processEvent, addPosition, removePosition, cleanup as monitorCleanup } from "../position-protection/realtime-monitor";
import type { RealTimeEvent, ProtectionEvent, MonitoringStatus } from "../position-protection/realtime-types";
import {
  createAccelerationState,
  recordPriceObservation,
  recordGivebackObservation,
  detectPriceAcceleration,
  detectGivebackAcceleration,
  type AccelerationState,
  type AccelerationResult,
} from "../position-protection/acceleration-monitor";
import type {
  MonitoringStateRepository,
  PersistedPositionState,
} from "../position-protection/persistence";

// ═══════════════════════════════════════════════════════════════
// ORCHESTRATOR STATE
// ═══════════════════════════════════════════════════════════════

export interface StreamOrchestratorState {
  /** Per-provider reconnect state. */
  providerStates: Map<string, ReconnectState>;
  /** Per-provider stream config. */
  providerConfigs: Map<string, StreamConfig>;
  /** Per-instrument symbol mappings. */
  symbolMappings: Map<string, SymbolMapping>;
  /** Core monitor state (Phase 58). */
  monitor: MonitorState;
  /** Per-instrument acceleration state. */
  acceleration: Map<string, AccelerationState>;
  /** Registered positions. */
  positions: Map<string, RegisteredPosition>;
  /** Position event cursors. */
  cursors: Map<string, { lastEventId: string; lastTimestamp: number }>;
  /** Persistence repository. */
  repository: MonitoringStateRepository;
  /** Total events received across all providers. */
  totalEventsReceived: number;
  /** Total events dropped. */
  totalEventsDropped: number;
}

export function createOrchestratorState(
  repository?: MonitoringStateRepository,
): StreamOrchestratorState {
  return {
    providerStates: new Map(),
    providerConfigs: new Map(),
    symbolMappings: new Map(),
    monitor: createMonitorStateProxy(),
    acceleration: new Map(),
    positions: new Map(),
    cursors: new Map(),
    repository: repository ?? createFallbackRepository(),
    totalEventsReceived: 0,
    totalEventsDropped: 0,
  };
}import { createMonitorState } from "../position-protection/realtime-monitor";
import { InMemoryRepository } from "../position-protection/persistence";

function createMonitorStateProxy(): MonitorState {
  return createMonitorState();
}

function createFallbackRepository(): InMemoryRepository {
  return new InMemoryRepository();
}

// ═══════════════════════════════════════════════════════════════
// PROVIDER LIFECYCLE
// ═══════════════════════════════════════════════════════════════

export function connectProvider(
  state: StreamOrchestratorState,
  provider: string,
  instruments: string[],
  now: number,
): StreamOrchestratorState {
  const profile = getProviderProfile(provider);
  if (!profile) return state;

  const existingState = state.providerStates.get(provider);
  const reconnectState = existingState
    ? initiateConnect(existingState, now)
    : initiateConnect(
        createReconnectState({
          maxAttempts: 10,
          maxBackoffMs: profile.defaultConfig.maxBackoffMs,
          heartbeatIntervalMs: profile.defaultConfig.heartbeatIntervalMs,
          staleThresholdMs: profile.defaultConfig.staleThresholdMs,
        }),
        now,
      );

  const config = buildStreamConfig(provider, instruments);
  const providerStates = new Map(state.providerStates);
  providerStates.set(provider, reconnectState);
  const providerConfigs = new Map(state.providerConfigs);
  providerConfigs.set(provider, config);

  return { ...state, providerStates, providerConfigs };
}

export function onProviderConnected(
  state: StreamOrchestratorState,
  provider: string,
  now: number,
): StreamOrchestratorState {
  const existing = state.providerStates.get(provider);
  if (!existing) return state;
  const providerStates = new Map(state.providerStates);
  providerStates.set(provider, onConnected(existing, now));
  return { ...state, providerStates };
}

export function onProviderDisconnected(
  state: StreamOrchestratorState,
  provider: string,
  now: number,
  error?: string,
): StreamOrchestratorState {
  const existing = state.providerStates.get(provider);
  if (!existing) return state;
  const providerStates = new Map(state.providerStates);
  providerStates.set(provider, onDisconnected(existing, now, error));
  return { ...state, providerStates };
}

export function attemptReconnect(
  state: StreamOrchestratorState,
  provider: string,
  now: number,
): StreamOrchestratorState {
  const existing = state.providerStates.get(provider);
  if (!existing) return state;
  let newState = initiateReconnect(existing, now);
  newState = advanceBackoff(newState);
  const providerStates = new Map(state.providerStates);
  providerStates.set(provider, newState);
  return { ...state, providerStates };
}

// ═══════════════════════════════════════════════════════════════
// SYMBOL MAPPING
// ═══════════════════════════════════════════════════════════════

export function registerSymbolMapping(
  state: StreamOrchestratorState,
  mapping: SymbolMapping,
): StreamOrchestratorState {
  const symbolMappings = new Map(state.symbolMappings);
  symbolMappings.set(`${mapping.provider}:${mapping.canonical}`, mapping);
  return { ...state, symbolMappings };
}

export function validateSymbolIdentity(
  state: StreamOrchestratorState,
  provider: string,
  providerSymbol: string,
): { valid: boolean; canonical?: string; reason: string } {
  const mapping = state.symbolMappings.get(`${provider}:${providerSymbol}`);
  if (mapping && mapping.validated) {
    return { valid: true, canonical: mapping.canonical, reason: "Mapping validated." };
  }
  // Check by provider symbol alone
  for (const m of state.symbolMappings.values()) {
    if (m.provider === provider && m.providerSymbol === providerSymbol) {
      return { valid: m.validated, canonical: m.canonical, reason: m.validated ? "Found mapping." : "Mapping exists but not validated." };
    }
  }
  return { valid: false, reason: "No symbol mapping found." };
}

// ═══════════════════════════════════════════════════════════════
// EVENT NORMALIZATION & PROCESSING
// ═══════════════════════════════════════════════════════════════

export function normalizeStreamEvent(
  streamEvent: StreamEvent,
  state: StreamOrchestratorState,
): RealTimeEvent | null {
  // Validate identity
  const identity = validateSymbolIdentity(state, streamEvent.provider, streamEvent.providerSymbol);
  if (!identity.valid) return null;

  // Map stream event type to RealTimeEvent type
  let eventType: RealTimeEvent["eventType"];
  let priority: RealTimeEvent["priority"];

  switch (streamEvent.eventType) {
    case "QUOTE":
      eventType = "QUOTE_UPDATE";
      priority = "LOW";
      break;
    case "OHLCV":
      eventType = "CANDLE_UPDATE";
      priority = "LOW";
      break;
    case "FUNDING":
      eventType = "FUNDING_CHANGE";
      priority = "MEDIUM";
      break;
    case "OI":
      eventType = "OPEN_INTEREST_CHANGE";
      priority = "MEDIUM";
      break;
    case "LIQUIDATION":
      eventType = "LIQUIDATION_CHANGE";
      priority = "HIGH";
      break;
    case "NEWS":
      eventType = "NEWS_EVENT";
      priority = "HIGH";
      break;
    case "HEARTBEAT":
      eventType = "PRICE_UPDATE";
      priority = "LOW";
      break;
    case "ERROR":
      eventType = "PROVIDER_DEGRADED";
      priority = "MEDIUM";
      break;
    case "STATUS":
      eventType = "PRICE_UPDATE";
      priority = "LOW";
      break;
    default:
      eventType = "PRICE_UPDATE";
      priority = "LOW";
  }

  // Upgrade priority for critical payloads
  if (streamEvent.payload.liquidationVolume !== undefined && streamEvent.payload.liquidationVolume > 1_000_000) {
    priority = "CRITICAL";
  }

  return {
    eventId: streamEvent.eventId,
    instrument: identity.canonical!,
    timestamp: streamEvent.timestamp,
    source: streamEvent.provider,
    freshness: streamEvent.freshness,
    eventType,
    priority,
    dependencyGroup: streamEvent.dependencyGroup,
    payload: {
      price: streamEvent.payload.price,
      bid: streamEvent.payload.bid,
      ask: streamEvent.payload.ask,
      spread: streamEvent.payload.spread,
      volatility: streamEvent.payload.candle
        ? streamEvent.payload.candle.high - streamEvent.payload.candle.low
        : undefined,
      fundingRate: streamEvent.payload.fundingRate,
      oiChange: streamEvent.payload.oiChange,
      liquidationSpike: (streamEvent.payload.liquidationVolume ?? 0) > 500_000,
    },
  };
}

export function processStreamEvent(
  state: StreamOrchestratorState,
  streamEvent: StreamEvent,
  now: number,
): { state: StreamOrchestratorState; alerts: ProtectionEvent[] } {
  // Update provider message timestamp
  const providerState = state.providerStates.get(streamEvent.provider);
  if (providerState) {
    const providerStates = new Map(state.providerStates);
    providerStates.set(streamEvent.provider, recordMessage(providerState, now));
    state = { ...state, providerStates };
  }

  // Normalize
  const normalized = normalizeStreamEvent(streamEvent, state);
  if (!normalized) {
    return {
      state: { ...state, totalEventsDropped: state.totalEventsDropped + 1 },
      alerts: [],
    };
  }

  // Check for out-of-order via cursor
  const cursorKey = `${streamEvent.provider}:${normalized.instrument}`;
  const cursor = state.cursors.get(cursorKey);
  if (cursor) {
    if (normalized.timestamp < cursor.lastTimestamp) {
      // Out-of-order — drop
      return {
        state: { ...state, totalEventsDropped: state.totalEventsDropped + 1 },
        alerts: [],
      };
    }
  }

  // Update cursor
  const cursors = new Map(state.cursors);
  cursors.set(cursorKey, {
    lastEventId: normalized.eventId,
    lastTimestamp: normalized.timestamp,
  });

  // Update acceleration state
  const accState = state.acceleration.get(normalized.instrument) ?? createAccelerationState();
  let updatedAcc = accState;
  if (typeof normalized.payload.price === "number") {
    updatedAcc = recordPriceObservation(updatedAcc, now, normalized.payload.price, streamEvent.provider);
  }
  const acceleration = new Map(state.acceleration);
  acceleration.set(normalized.instrument, updatedAcc);

  // Process through Phase 58 monitor
  const { state: newMonitor, alerts } = processEvent(state.monitor, normalized, now);

  return {
    state: {
      ...state,
      monitor: newMonitor,
      acceleration,
      cursors,
      totalEventsReceived: state.totalEventsReceived + 1,
    },
    alerts,
  };
}

// ═══════════════════════════════════════════════════════════════
// POSITION REGISTRATION
// ═══════════════════════════════════════════════════════════════

export function registerPosition(
  state: StreamOrchestratorState,
  position: RegisteredPosition,
  now: number,
): StreamOrchestratorState {
  const positions = new Map(state.positions);
  positions.set(position.positionId, { ...position, lifecycle: "MONITORING" });

  // Add to Phase 58 monitor
  const snapshot: PositionSnapshot = {
    positionId: position.positionId,
    instrument: position.instrument,
    side: position.side,
    entryPrice: position.entryPrice,
    currentPrice: position.entryPrice, // Will be updated with first quote
    stopLoss: position.stopLoss,
    takeProfit: position.takeProfit,
    leverage: position.leverage,
    horizon: position.horizon,
    openedAt: position.openedAt,
    lastUpdateAt: now,
    monitoringStatus: "LIVE",
  };

  const newMonitor = addPosition(state.monitor, snapshot);

  return { ...state, positions, monitor: newMonitor };
}

export function unregisterPosition(
  state: StreamOrchestratorState,
  positionId: string,
): StreamOrchestratorState {
  const positions = new Map(state.positions);
  const pos = positions.get(positionId);
  if (pos) {
    positions.set(positionId, { ...pos, lifecycle: "CLOSED" });
  }
  positions.delete(positionId);
  const newMonitor = removePosition(state.monitor, positionId);
  return { ...state, positions, monitor: newMonitor };
}

export function pausePosition(
  state: StreamOrchestratorState,
  positionId: string,
): StreamOrchestratorState {
  const positions = new Map(state.positions);
  const pos = positions.get(positionId);
  if (pos) {
    positions.set(positionId, { ...pos, lifecycle: "PAUSED" });
  }
  return { ...state, positions };
}

// ═══════════════════════════════════════════════════════════════
// RECONCILIATION
// ═══════════════════════════════════════════════════════════════

export function reconcileProvider(
  state: StreamOrchestratorState,
  provider: string,
  currentPrice: number,
  currentTimestamp: number,
  now: number,
): { state: StreamOrchestratorState; result: ReconciliationResult } {
  const providerState = state.providerStates.get(provider);
  if (!providerState) {
    return {
      state,
      result: {
        success: false,
        gapDurationMs: 0,
        gapDataAvailable: false,
        eventsMissed: 0,
        currentPrice,
        currentTimestamp,
        stateReconciled: false,
        description: "No reconnect state for provider.",
      },
    };
  }

  const result = reconcileAfterReconnect(providerState, currentPrice, currentTimestamp, now);

  // Update provider state
  const providerStates = new Map(state.providerStates);
  providerStates.set(provider, onConnected(providerState, now));

  return {
    state: { ...state, providerStates },
    result,
  };
}

// ═══════════════════════════════════════════════════════════════
// HEALTH & MONITORING STATUS
// ═══════════════════════════════════════════════════════════════

export function getProviderHealth(
  state: StreamOrchestratorState,
  provider: string,
): StreamHealthState | null {
  const providerState = state.providerStates.get(provider);
  if (!providerState) return null;
  return buildHealthState(providerState, provider, state.totalEventsReceived, state.totalEventsDropped);
}

export function getMonitoringStatus(
  state: StreamOrchestratorState,
  instrument: string,
): StreamStatus {
  // Check if any provider for this instrument is live
  for (const [provider, providerState] of state.providerStates) {
    const config = state.providerConfigs.get(provider);
    if (config && config.instruments.includes(instrument)) {
      return detectStaleness(providerState, Date.now());
    }
  }
  return "DISCONNECTED";
}

// ═══════════════════════════════════════════════════════════════
// ACCELERATION ACCESS
// ═══════════════════════════════════════════════════════════════

export function getPriceAcceleration(
  state: StreamOrchestratorState,
  instrument: string,
  side: "LONG" | "SHORT",
  now: number,
): AccelerationResult | null {
  const acc = state.acceleration.get(instrument);
  if (!acc) return null;
  return detectPriceAcceleration(acc, side, now);
}

export function getGivebackAcceleration(
  state: StreamOrchestratorState,
  instrument: string,
  now: number,
): AccelerationResult | null {
  const acc = state.acceleration.get(instrument);
  if (!acc) return null;
  return detectGivebackAcceleration(acc, now);
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════

export function cleanupOrchestrator(
  state: StreamOrchestratorState,
  maxHistory: number = 500,
): StreamOrchestratorState {
  return {
    ...state,
    monitor: monitorCleanup(state.monitor, maxHistory),
  };
}
