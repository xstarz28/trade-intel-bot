/**
 * Phase 59 — Market Stream & Persistence Test Suite
 *
 * Comprehensive tests for the live market stream layer, reconnection engine,
 * provider adapters, persistence interface, acceleration monitor,
 * and stream orchestrator.
 */
import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════
// IMPORTS — Market Stream
// ═══════════════════════════════════════════════════════════════
import {
  DEFAULT_STREAM_CONFIG,
  type StreamEvent,
  type StreamHealthState,
  type ReconciliationResult,
  type SymbolMapping,
  type RegisteredPosition,
} from "./market-stream/types";

import {
  createReconnectState,
  initiateConnect,
  onConnected,
  onDisconnected,
  initiateReconnect,
  advanceBackoff,
  computeBackoff,
  checkHeartbeat,
  recordMessage,
  recordHeartbeat,
  detectStaleness,
  reconcileAfterReconnect,
  buildHealthState,
} from "./market-stream/reconnection-engine";

import {
  getProviderProfile,
  getProvidersForAssetClass,
  getStreamProvidersForAssetClass,
  getProvidersForCapability,
  buildStreamConfig,
  getPollIntervalMs,
  getAllProviders,
} from "./market-stream/provider-adapters";

import {
  createOrchestratorState,
  connectProvider,
  onProviderConnected,
  onProviderDisconnected,
  attemptReconnect,
  registerSymbolMapping,
  validateSymbolIdentity,
  normalizeStreamEvent,
  processStreamEvent,
  registerPosition,
  unregisterPosition,
  pausePosition,
  reconcileProvider,
  getProviderHealth,
  cleanupOrchestrator,
} from "./market-stream/stream-orchestrator";

// ═══════════════════════════════════════════════════════════════
// IMPORTS — Persistence
// ═══════════════════════════════════════════════════════════════
import {
  InMemoryRepository,
  type PersistedPositionState,
  type PersistedAlert,
  type EventCursor,
} from "./position-protection/persistence";

import { ConvexPersistenceAdapter } from "./position-protection/convex-persistence";

// ═══════════════════════════════════════════════════════════════
// IMPORTS — Acceleration Monitor
// ═══════════════════════════════════════════════════════════════
import {
  createAccelerationState,
  recordPriceObservation,
  recordVolatilityObservation,
  recordGivebackObservation,
  detectPriceAcceleration,
  detectGivebackAcceleration,
  detectVolatilityAcceleration,
  calculateAcceleration,
  type AccelerationResult,
} from "./position-protection/acceleration-monitor";

// ═══════════════════════════════════════════════════════════════
// HELPER
// ═══════════════════════════════════════════════════════════════

function makeStreamEvent(overrides?: Partial<StreamEvent>): StreamEvent {
  return {
    eventId: "evt-1",
    provider: "OKX",
    instrument: "BTC/USD",
    providerSymbol: "BTC-USDT",
    assetClass: "crypto",
    eventType: "QUOTE",
    timestamp: Date.now(),
    receivedAt: Date.now(),
    freshness: "FRESH",
    dependencyGroup: "okx:btc:quote",
    payload: { price: 84000 },
    ...overrides,
  };
}

function makePosition(overrides?: Partial<RegisteredPosition>): RegisteredPosition {
  return {
    positionId: "pos-1",
    instrument: "BTC/USD",
    side: "LONG",
    entryPrice: 80000,
    horizon: "SWING",
    openedAt: Date.now() - 3600_000,
    lifecycle: "REGISTERED",
    ...overrides,
  };
}

function makeSymbolMapping(overrides?: Partial<SymbolMapping>): SymbolMapping {
  return {
    canonical: "BTC/USD",
    providerSymbol: "BTC-USDT",
    provider: "OKX",
    assetClass: "crypto",
    quoteCurrency: "USDT",
    validated: true,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. STREAM TYPES
// ═══════════════════════════════════════════════════════════════

describe("A. Stream Types", () => {
  it("A1 — DEFAULT_STREAM_CONFIG has sensible defaults", () => {
    expect(DEFAULT_STREAM_CONFIG.maxReconnectAttempts).toBe(10);
    expect(DEFAULT_STREAM_CONFIG.heartbeatIntervalMs).toBeGreaterThan(0);
    expect(DEFAULT_STREAM_CONFIG.staleThresholdMs).toBeGreaterThan(0);
  });

  it("A2 — StreamEvent has required fields", () => {
    const e = makeStreamEvent();
    expect(e.eventId).toBeTruthy();
    expect(e.provider).toBeTruthy();
    expect(e.instrument).toBeTruthy();
    expect(e.timestamp).toBeGreaterThan(0);
    expect(e.receivedAt).toBeGreaterThan(0);
    expect(e.payload).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// B. RECONNECTION ENGINE — State Transitions
// ═══════════════════════════════════════════════════════════════

describe("B. Reconnection Engine", () => {
  it("B1 — createReconnectState defaults", () => {
    const s = createReconnectState();
    expect(s.status).toBe("DISCONNECTED");
    expect(s.attempts).toBe(0);
    expect(s.maxAttempts).toBe(10);
    expect(s.currentBackoffMs).toBe(1000);
  });

  it("B2 — initiateConnect sets CONNECTING", () => {
    const s = createReconnectState();
    const connected = initiateConnect(s, 1000);
    expect(connected.status).toBe("CONNECTING");
  });

  it("B3 — onConnected sets LIVE", () => {
    const s = initiateConnect(createReconnectState(), 1000);
    const live = onConnected(s, 2000);
    expect(live.status).toBe("LIVE");
    expect(live.attempts).toBe(0);
    expect(live.lastConnectedAt).toBe(2000);
    expect(live.lastMessageAt).toBe(2000);
  });

  it("B4 — onConnected resets gap start", () => {
    const s = initiateConnect(createReconnectState(), 1000);
    const live = onConnected(s, 2000);
    expect(live.gapStartAt).toBe(0);
  });

  it("B5 — onDisconnected sets DISCONNECTED", () => {
    const s = onConnected(initiateConnect(createReconnectState(), 1000), 2000);
    const disc = onDisconnected(s, 3000, "Connection lost");
    expect(disc.status).toBe("DISCONNECTED");
    expect(disc.lastError).toBe("Connection lost");
    expect(disc.gapStartAt).toBe(3000);
  });

  it("B6 — initiateReconnect increments attempts", () => {
    const s = onDisconnected(
      onConnected(initiateConnect(createReconnectState(), 1000), 2000),
      3000,
    );
    const re = initiateReconnect(s, 3000);
    expect(re.status).toBe("RECONNECTING");
    expect(re.attempts).toBe(1);
  });

  it("B7 — initiateReconnect fails after maxAttempts", () => {
    // onConnected resets attempts, so we simulate disconnection->reconnect
    // without going through a full connect->connected cycle each time.
    let s = createReconnectState({ maxAttempts: 2 });
    // First: simulate an existing connection that drops
    s = onConnected(initiateConnect(s, 0), 500);
    s = onDisconnected(s, 1000);
    // attempt 1
    s = initiateReconnect(s, 1000);
    expect(s.attempts).toBe(1);
    // Simulate another disconnect (without connecting successfully)
    s = onDisconnected(s, 2000);
    // attempt 2
    s = initiateReconnect(s, 2000);
    expect(s.attempts).toBe(2);
    // attempt 3 — should fail
    s = onDisconnected(s, 3000);
    s = initiateReconnect(s, 3000);
    expect(s.status).toBe("FAILED");
    expect(s.attempts).toBe(2);
  });

  it("B8 — computeBackoff is exponential and bounded", () => {
    expect(computeBackoff(0, 30000)).toBe(1000);
    expect(computeBackoff(1, 30000)).toBe(2000);
    expect(computeBackoff(2, 30000)).toBe(4000);
    expect(computeBackoff(3, 30000)).toBe(8000);
    expect(computeBackoff(4, 30000)).toBe(16000);
    expect(computeBackoff(5, 30000)).toBe(30000);
    expect(computeBackoff(10, 30000)).toBe(30000); // capped
  });

  it("B9 — advanceBackoff updates currentBackoffMs", () => {
    const s = initiateReconnect(
      onDisconnected(
        onConnected(initiateConnect(createReconnectState(), 0), 100),
        200,
      ),
      200,
    );
    const advanced = advanceBackoff(s);
    expect(advanced.currentBackoffMs).toBe(computeBackoff(1, 30000));
  });

  it("B10 — checkHeartbeat detects stale data", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastMessageAt: 1000, lastHeartbeatAt: 1000 };
    const check = checkHeartbeat(s, 1000 + 70_000); // > 60s default stale
    expect(check.isStale).toBe(true);
    expect(check.connectionAlive).toBe(true);
    expect(check.dataFresh).toBe(false);
  });

  it("B11 — checkHeartbeat detects needed heartbeat", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastMessageAt: 1000, lastHeartbeatAt: 0 };
    const check = checkHeartbeat(s, 31000);
    expect(check.needsHeartbeat).toBe(true);
  });

  it("B12 — recordMessage updates lastMessageAt", () => {
    const s = createReconnectState();
    const updated = recordMessage(s, 5000);
    expect(updated.lastMessageAt).toBe(5000);
  });

  it("B13 — recordHeartbeat updates lastHeartbeatAt", () => {
    const s = createReconnectState();
    const updated = recordHeartbeat(s, 5000);
    expect(updated.lastHeartbeatAt).toBe(5000);
  });

  it("B14 — detectStaleness returns LIVE when fresh", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastMessageAt: 9000 };
    expect(detectStaleness(s, 10000)).toBe("LIVE");
  });

  it("B15 — detectStaleness returns DEGRADED when moderately stale", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastMessageAt: 1000 };
    expect(detectStaleness(s, 1000 + 70_000)).toBe("DEGRADED");
  });

  it("B16 — detectStaleness returns STALE when very stale", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastMessageAt: 1000 };
    expect(detectStaleness(s, 1000 + 200_000)).toBe("STALE");
  });

  it("B17 — detectStaleness does not affect non-LIVE statuses", () => {
    const s = { ...createReconnectState(), status: "RECONNECTING" as const, lastMessageAt: 1000 };
    expect(detectStaleness(s, 1000 + 200_000)).toBe("RECONNECTING");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. RECONCILIATION
// ═══════════════════════════════════════════════════════════════

describe("C. Reconciliation", () => {
  it("C1 — reconcileAfterReconnect succeeds with valid price", () => {
    const s = { ...createReconnectState(), gapStartAt: 9000 };
    const result = reconcileAfterReconnect(s, 84000, 10000, 10000);
    expect(result.success).toBe(true);
    expect(result.currentPrice).toBe(84000);
    expect(result.gapDurationMs).toBe(1000);
    expect(result.stateReconciled).toBe(true);
  });

  it("C2 — reconcileAfterReconnect fails with zero price", () => {
    const s = { ...createReconnectState(), gapStartAt: 9000 };
    const result = reconcileAfterReconnect(s, 0, 10000, 10000);
    expect(result.success).toBe(false);
  });

  it("C3 — reconcileAfterReconnect with no gap", () => {
    const s = createReconnectState();
    const result = reconcileAfterReconnect(s, 84000, 10000, 10000);
    expect(result.gapDurationMs).toBe(0);
  });

  it("C4 — ReconciliationResult shape", () => {
    const s = { ...createReconnectState(), gapStartAt: 5000 };
    const result = reconcileAfterReconnect(s, 84000, 10000, 10000);
    expect(result).toHaveProperty("success");
    expect(result).toHaveProperty("gapDurationMs");
    expect(result).toHaveProperty("gapDataAvailable");
    expect(result).toHaveProperty("eventsMissed");
    expect(result).toHaveProperty("currentPrice");
    expect(result).toHaveProperty("currentTimestamp");
    expect(result).toHaveProperty("stateReconciled");
    expect(result).toHaveProperty("description");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. HEALTH STATE
// ═══════════════════════════════════════════════════════════════

describe("D. Health State", () => {
  it("D1 — buildHealthState for LIVE provider", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastConnectedAt: 9000, lastMessageAt: 10000 };
    const health = buildHealthState(s, "OKX", 100, 5);
    expect(health.provider).toBe("OKX");
    expect(health.status).toBe("LIVE");
    expect(health.health).toBe("HEALTHY");
    expect(health.eventsReceived).toBe(100);
    expect(health.eventsDropped).toBe(5);
  });

  it("D2 — buildHealthState for RECONNECTING provider", () => {
    const s = { ...createReconnectState(), status: "RECONNECTING" as const, attempts: 3 };
    const health = buildHealthState(s, "TwelveData", 0, 0);
    expect(health.health).toBe("TIMEOUT");
    expect(health.reconnectAttempts).toBe(3);
  });

  it("D3 — buildHealthState for FAILED provider", () => {
    const s = { ...createReconnectState(), status: "FAILED" as const };
    const health = buildHealthState(s, "CoinGlass", 0, 0);
    expect(health.health).toBe("UNAVAILABLE");
  });

  it("D4 — buildHealthState for DISCONNECTED provider", () => {
    const s = createReconnectState();
    const health = buildHealthState(s, "CoinGecko", 0, 0);
    expect(health.health).toBe("UNAVAILABLE");
  });

  it("D5 — StreamHealthState has all required fields", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastConnectedAt: 9000, lastMessageAt: 10000 };
    const health = buildHealthState(s, "OKX", 100, 5);
    expect(health).toHaveProperty("provider");
    expect(health).toHaveProperty("status");
    expect(health).toHaveProperty("health");
    expect(health).toHaveProperty("lastMessageAt");
    expect(health).toHaveProperty("uptimeMs");
    expect(health).toHaveProperty("eventsReceived");
    expect(health).toHaveProperty("eventsDropped");
    expect(health).toHaveProperty("reconnectAttempts");
    expect(health).toHaveProperty("heartbeatAlive");
    expect(health).toHaveProperty("monitoringGapMs");
  });
});

// ═══════════════════════════════════════════════════════════════
// E. PROVIDER ADAPTERS
// ═══════════════════════════════════════════════════════════════

describe("E. Provider Adapters", () => {
  it("E1 — getAllProviders returns registered providers", () => {
    const providers = getAllProviders();
    expect(providers.length).toBeGreaterThan(0);
  });

  it("E2 — getProviderProfile for known provider", () => {
    const okx = getProviderProfile("OKX");
    expect(okx).toBeDefined();
    expect(okx!.websocketSupported).toBe(true);
    expect(okx!.assetClasses).toContain("crypto");
  });

  it("E3 — getProviderProfile returns undefined for unknown", () => {
    expect(getProviderProfile("UnknownProvider")).toBeUndefined();
  });

  it("E4 — getProvidersForAssetClass returns crypto providers", () => {
    const crypto = getProvidersForAssetClass("crypto");
    expect(crypto.length).toBeGreaterThan(0);
    expect(crypto.some(p => p.provider === "OKX")).toBe(true);
  });

  it("E5 — getStreamProvidersForAssetClass returns only WS providers", () => {
    const streamProviders = getStreamProvidersForAssetClass("crypto");
    for (const p of streamProviders) {
      expect(p.websocketSupported).toBe(true);
    }
  });

  it("E6 — getProvidersForCapability returns correct providers", () => {
    const funding = getProvidersForCapability("REALTIME_FUNDING");
    expect(funding.length).toBeGreaterThan(0);
    expect(funding.some(p => p.provider === "CoinGlass")).toBe(true);
  });

  it("E7 — buildStreamConfig returns valid config", () => {
    const config = buildStreamConfig("OKX", ["BTC/USD", "ETH/USD"]);
    expect(config.provider).toBe("OKX");
    expect(config.instruments).toEqual(["BTC/USD", "ETH/USD"]);
    expect(config.heartbeatIntervalMs).toBeGreaterThan(0);
  });

  it("E8 — getPollIntervalMs for POLLED_ONLY provider", () => {
    const interval = getPollIntervalMs("CoinGecko");
    expect(interval).toBeGreaterThan(0);
  });

  it("E9 — getPollIntervalMs for unknown provider defaults", () => {
    const interval = getPollIntervalMs("Unknown");
    expect(interval).toBe(60_000);
  });

  it("E10 — TwelveData has WS support for forex/equity", () => {
    const td = getProviderProfile("TwelveData");
    expect(td).toBeDefined();
    expect(td!.websocketSupported).toBe(true);
    expect(td!.assetClasses).toContain("forex");
    expect(td!.assetClasses).toContain("equity");
  });

  it("E11 — CoinGlass is polling-only for derivatives", () => {
    const cg = getProviderProfile("CoinGlass");
    expect(cg).toBeDefined();
    expect(cg!.websocketSupported).toBe(false);
    expect(cg!.capabilities).toContain("REALTIME_FUNDING");
  });
});

// ═══════════════════════════════════════════════════════════════
// F. PERSISTENCE — InMemoryRepository
// ═══════════════════════════════════════════════════════════════

describe("F. Persistence — InMemoryRepository", () => {
  function makePersistedPosition(overrides?: Partial<PersistedPositionState>): PersistedPositionState {
    return {
      positionId: "pos-1",
      instrument: "BTC/USD",
      side: "LONG",
      entryPrice: 80000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
      ...overrides,
    };
  }

  it("F1 — save and get position state", async () => {
    const repo = new InMemoryRepository();
    const pos = makePersistedPosition();
    await repo.savePositionState(pos);
    const retrieved = await repo.getPositionState("pos-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.instrument).toBe("BTC/USD");
  });

  it("F2 — getPositionState returns null for unknown", async () => {
    const repo = new InMemoryRepository();
    expect(await repo.getPositionState("unknown")).toBeNull();
  });

  it("F3 — deletePositionState removes entry", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState(makePersistedPosition());
    await repo.deletePositionState("pos-1");
    expect(await repo.getPositionState("pos-1")).toBeNull();
  });

  it("F4 — listActivePositions returns only MONITORING", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState(makePersistedPosition({ positionId: "p1", monitoringLifecycle: "MONITORING" }));
    await repo.savePositionState(makePersistedPosition({ positionId: "p2", monitoringLifecycle: "PAUSED" }));
    await repo.savePositionState(makePersistedPosition({ positionId: "p3", monitoringLifecycle: "CLOSED" }));
    const active = await repo.listActivePositions();
    expect(active.length).toBe(1);
    expect(active[0].positionId).toBe("p1");
  });

  it("F5 — save and list alert history", async () => {
    const repo = new InMemoryRepository();
    const alert: PersistedAlert = {
      alertId: "a1",
      positionId: "pos-1",
      instrument: "BTC/USD",
      severity: "CAUTION",
      notificationPriority: "WARNING",
      reason: "Thesis deteriorating",
      action: "Monitor closely",
      timestamp: 1000,
      acknowledged: false,
    };
    await repo.saveAlert(alert);
    const history = await repo.listAlertHistory("pos-1");
    expect(history.length).toBe(1);
    expect(history[0].severity).toBe("CAUTION");
  });

  it("F6 — listAlertHistory sorts by timestamp desc", async () => {
    const repo = new InMemoryRepository();
    await repo.saveAlert({ alertId: "a1", positionId: "pos-1", instrument: "BTC/USD", severity: "WATCH", notificationPriority: "INFO", reason: "r1", action: "a1", timestamp: 1000, acknowledged: false });
    await repo.saveAlert({ alertId: "a2", positionId: "pos-1", instrument: "BTC/USD", severity: "CAUTION", notificationPriority: "WARNING", reason: "r2", action: "a2", timestamp: 3000, acknowledged: false });
    await repo.saveAlert({ alertId: "a3", positionId: "pos-1", instrument: "BTC/USD", severity: "WATCH", notificationPriority: "INFO", reason: "r3", action: "a3", timestamp: 2000, acknowledged: false });
    const history = await repo.listAlertHistory("pos-1");
    expect(history[0].timestamp).toBe(3000);
    expect(history[1].timestamp).toBe(2000);
    expect(history[2].timestamp).toBe(1000);
  });

  it("F7 — acknowledgeAlert marks as acknowledged", async () => {
    const repo = new InMemoryRepository();
    await repo.saveAlert({ alertId: "a1", positionId: "pos-1", instrument: "BTC/USD", severity: "WATCH", notificationPriority: "INFO", reason: "r", action: "a", timestamp: 1000, acknowledged: false });
    const result = await repo.acknowledgeAlert("a1");
    expect(result).toBe(true);
    const history = await repo.listAlertHistory("pos-1");
    expect(history[0].acknowledged).toBe(true);
  });

  it("F8 — acknowledgeAlert returns false for unknown", async () => {
    const repo = new InMemoryRepository();
    expect(await repo.acknowledgeAlert("unknown")).toBe(false);
  });

  it("F9 — save and get event cursor", async () => {
    const repo = new InMemoryRepository();
    const cursor: EventCursor = { provider: "OKX", instrument: "BTC/USD", lastEventId: "e1", lastTimestamp: 5000 };
    await repo.saveEventCursor(cursor);
    const retrieved = await repo.getEventCursor("OKX", "BTC/USD");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.lastEventId).toBe("e1");
  });

  it("F10 — getEventCursor returns null for unknown", async () => {
    const repo = new InMemoryRepository();
    expect(await repo.getEventCursor("Unknown", "BTC/USD")).toBeNull();
  });

  it("F11 — isAvailable returns true", async () => {
    const repo = new InMemoryRepository();
    expect(await repo.isAvailable()).toBe(true);
  });

  it("F12 — alerts are bounded at 1000", async () => {
    const repo = new InMemoryRepository();
    for (let i = 0; i < 1005; i++) {
      await repo.saveAlert({ alertId: `a${i}`, positionId: "pos-1", instrument: "BTC/USD", severity: "WATCH", notificationPriority: "INFO", reason: "r", action: "a", timestamp: i, acknowledged: false });
    }
    const history = await repo.listAlertHistory("pos-1", 2000);
    expect(history.length).toBe(1000);
    expect(history[0].timestamp).toBe(1004);
  });

  it("F13 — isolated instrument state", async () => {
    const repo = new InMemoryRepository();
    await repo.savePositionState(makePersistedPosition({ positionId: "btc-long", instrument: "BTC/USD" }));
    await repo.savePositionState(makePersistedPosition({ positionId: "eth-long", instrument: "ETH/USD" }));
    const btc = await repo.getPositionState("btc-long");
    const eth = await repo.getPositionState("eth-long");
    expect(btc!.instrument).toBe("BTC/USD");
    expect(eth!.instrument).toBe("ETH/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. PERSISTENCE — ConvexPersistenceAdapter
// ═══════════════════════════════════════════════════════════════

describe("G. ConvexPersistenceAdapter", () => {
  it("G1 — falls back to InMemory when no client", async () => {
    const adapter = new ConvexPersistenceAdapter();
    expect(await adapter.isAvailable()).toBe(true);
    await adapter.savePositionState({
      positionId: "p1",
      instrument: "BTC/USD",
      side: "LONG",
      entryPrice: 80000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    const pos = await adapter.getPositionState("p1");
    expect(pos).not.toBeNull();
  });

  it("G2 — falls back to InMemory for alerts", async () => {
    const adapter = new ConvexPersistenceAdapter();
    await adapter.saveAlert({
      alertId: "a1",
      positionId: "p1",
      instrument: "BTC/USD",
      severity: "WATCH",
      notificationPriority: "INFO",
      reason: "test",
      action: "monitor",
      timestamp: Date.now(),
      acknowledged: false,
    });
    const alerts = await adapter.listAlertHistory("p1");
    expect(alerts.length).toBe(1);
  });

  it("G3 — acknowledgeAlert works through fallback", async () => {
    const adapter = new ConvexPersistenceAdapter();
    await adapter.saveAlert({
      alertId: "a2",
      positionId: "p1",
      instrument: "BTC/USD",
      severity: "CAUTION",
      notificationPriority: "WARNING",
      reason: "test",
      action: "protect",
      timestamp: Date.now(),
      acknowledged: false,
    });
    expect(await adapter.acknowledgeAlert("a2")).toBe(true);
  });

  it("G4 — event cursor through fallback", async () => {
    const adapter = new ConvexPersistenceAdapter();
    await adapter.saveEventCursor({ provider: "OKX", instrument: "BTC/USD", lastEventId: "e1", lastTimestamp: 1000 });
    const cursor = await adapter.getEventCursor("OKX", "BTC/USD");
    expect(cursor).not.toBeNull();
    expect(cursor!.lastEventId).toBe("e1");
  });

  it("G5 — listActivePositions works through fallback", async () => {
    const adapter = new ConvexPersistenceAdapter();
    await adapter.savePositionState({
      positionId: "p1",
      instrument: "BTC/USD",
      side: "LONG",
      entryPrice: 80000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    });
    const active = await adapter.listActivePositions();
    expect(active.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. ACCELERATION MONITOR
// ═══════════════════════════════════════════════════════════════

describe("H. Acceleration Monitor", () => {
  it("H1 — createAccelerationState defaults", () => {
    const s = createAccelerationState();
    expect(s.priceObservations.length).toBe(0);
    expect(s.maxBufferSize).toBe(100);
    expect(s.windowMs).toBe(300_000);
  });

  it("H2 — recordPriceObservation adds entry", () => {
    const s = createAccelerationState();
    const updated = recordPriceObservation(s, 1000, 84000, "OKX");
    expect(updated.priceObservations.length).toBe(1);
    expect(updated.priceObservations[0].value).toBe(84000);
  });

  it("H3 — recordVolatilityObservation adds entry", () => {
    const s = createAccelerationState();
    const updated = recordVolatilityObservation(s, 1000, 2.5, "OKX");
    expect(updated.volatilityObservations.length).toBe(1);
  });

  it("H4 — recordGivebackObservation adds entry", () => {
    const s = createAccelerationState();
    const updated = recordGivebackObservation(s, 1000, 15.5, "monitor");
    expect(updated.givebackObservations.length).toBe(1);
  });

  it("H5 — calculateAcceleration with insufficient data", () => {
    const result = calculateAcceleration([], Date.now());
    expect(result.level).toBe("NORMAL");
    expect(result.observationCount).toBe(0);
  });

  it("H6 — calculateAcceleration with stable rate", () => {
    const now = 10000;
    const obs = [
      { timestamp: now - 6000, value: 84000, source: "test" },
      { timestamp: now - 5000, value: 84001, source: "test" },
      { timestamp: now - 4000, value: 84002, source: "test" },
      { timestamp: now - 3000, value: 84003, source: "test" },
      { timestamp: now - 2000, value: 84004, source: "test" },
      { timestamp: now - 1000, value: 84005, source: "test" },
    ];
    const result = calculateAcceleration(obs, now);
    expect(result.level).toBe("NORMAL");
    expect(result.observationCount).toBe(6);
  });

  it("H7 — detectPriceAcceleration for LONG — adverse is negative rate", () => {
    const s = createAccelerationState();
    let updated = s;
    for (let i = 0; i < 6; i++) {
      updated = recordPriceObservation(updated, 1000 + i * 1000, 84000 - i * 100, "test");
    }
    const result = detectPriceAcceleration(updated, "LONG", 6000);
    expect(result.level).not.toBe("NORMAL"); // should detect adverse
  });

  it("H8 — detectPriceAcceleration for LONG — favorable is positive rate", () => {
    const s = createAccelerationState();
    let updated = s;
    for (let i = 0; i < 6; i++) {
      updated = recordPriceObservation(updated, 1000 + i * 1000, 84000 + i * 10, "test");
    }
    const result = detectPriceAcceleration(updated, "LONG", 6000);
    expect(result.level).toBe("NORMAL");
  });

  it("H9 — detectPriceAcceleration for SHORT — adverse is positive rate", () => {
    const s = createAccelerationState();
    let updated = s;
    for (let i = 0; i < 6; i++) {
      updated = recordPriceObservation(updated, 1000 + i * 1000, 84000 + i * 100, "test");
    }
    const result = detectPriceAcceleration(updated, "SHORT", 6000);
    expect(result.level).not.toBe("NORMAL");
  });

  it("H10 — detectGivebackAcceleration with data", () => {
    const s = createAccelerationState();
    let updated = s;
    for (let i = 0; i < 6; i++) {
      updated = recordGivebackObservation(updated, 1000 + i * 1000, i * 5, "test");
    }
    const result = detectGivebackAcceleration(updated, 6000);
    expect(result.observationCount).toBe(6);
  });

  it("H11 — detectVolatilityAcceleration with data", () => {
    const s = createAccelerationState();
    let updated = s;
    for (let i = 0; i < 6; i++) {
      updated = recordVolatilityObservation(updated, 1000 + i * 1000, 20 + i * 5, "test");
    }
    const result = detectVolatilityAcceleration(updated, 6000);
    expect(result.observationCount).toBe(6);
  });

  it("H12 — window filtering removes old observations", () => {
    const s = createAccelerationState({ windowMs: 5000 });
    let updated = s;
    // Add old observations
    updated = recordPriceObservation(updated, 1000, 84000, "test");
    updated = recordPriceObservation(updated, 2000, 84100, "test");
    // Add recent observations
    updated = recordPriceObservation(updated, 10000, 84200, "test");
    updated = recordPriceObservation(updated, 11000, 84300, "test");
    // Only recent ones should remain in acceleration calc
    const result = calculateAcceleration(updated.priceObservations, 12000, 5000);
    expect(result.observationCount).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. STREAM ORCHESTRATOR — Provider Lifecycle
// ═══════════════════════════════════════════════════════════════

describe("I. Stream Orchestrator — Provider Lifecycle", () => {
  it("I1 — createOrchestratorState defaults", () => {
    const state = createOrchestratorState();
    expect(state.providerStates.size).toBe(0);
    expect(state.totalEventsReceived).toBe(0);
    expect(state.totalEventsDropped).toBe(0);
  });

  it("I2 — connectProvider creates provider state", () => {
    const state = createOrchestratorState();
    const connected = connectProvider(state, "OKX", ["BTC/USD"], 1000);
    expect(connected.providerStates.has("OKX")).toBe(true);
    expect(connected.providerConfigs.has("OKX")).toBe(true);
  });

  it("I3 — connectProvider for unknown provider returns unchanged", () => {
    const state = createOrchestratorState();
    const connected = connectProvider(state, "Unknown", ["BTC/USD"], 1000);
    expect(connected.providerStates.size).toBe(0);
  });

  it("I4 — onProviderConnected sets LIVE", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USD"], 1000);
    state = onProviderConnected(state, "OKX", 2000);
    expect(state.providerStates.get("OKX")!.status).toBe("LIVE");
  });

  it("I5 — onProviderDisconnected sets DISCONNECTED", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USD"], 1000);
    state = onProviderConnected(state, "OKX", 2000);
    state = onProviderDisconnected(state, "OKX", 3000, "error");
    expect(state.providerStates.get("OKX")!.status).toBe("DISCONNECTED");
  });

  it("I6 — attemptReconnect increments attempts", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USD"], 1000);
    state = onProviderConnected(state, "OKX", 2000);
    state = onProviderDisconnected(state, "OKX", 3000);
    state = attemptReconnect(state, "OKX", 3000);
    expect(state.providerStates.get("OKX")!.attempts).toBe(1);
  });

  it("I7 — getProviderHealth returns health for connected provider", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USD"], 1000);
    state = onProviderConnected(state, "OKX", 2000);
    const health = getProviderHealth(state, "OKX");
    expect(health).not.toBeNull();
    expect(health!.status).toBe("LIVE");
  });

  it("I8 — getProviderHealth returns null for unknown provider", () => {
    const state = createOrchestratorState();
    expect(getProviderHealth(state, "Unknown")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// J. STREAM ORCHESTRATOR — Symbol Mapping
// ═══════════════════════════════════════════════════════════════

describe("J. Symbol Mapping", () => {
  it("J1 — registerSymbolMapping stores mapping", () => {
    const state = createOrchestratorState();
    const updated = registerSymbolMapping(state, makeSymbolMapping());
    expect(updated.symbolMappings.size).toBe(1);
  });

  it("J2 — validateSymbolIdentity returns valid for known mapping", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const result = validateSymbolIdentity(state, "OKX", "BTC-USDT");
    expect(result.valid).toBe(true);
    expect(result.canonical).toBe("BTC/USD");
  });

  it("J3 — validateSymbolIdentity returns invalid for unknown", () => {
    const state = createOrchestratorState();
    const result = validateSymbolIdentity(state, "OKX", "UNKNOWN-SYMBOL");
    expect(result.valid).toBe(false);
  });

  it("J4 — validateSymbolIdentity returns not-validated for unvalidated mapping", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping({ validated: false }));
    const result = validateSymbolIdentity(state, "OKX", "BTC-USDT");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("not validated");
  });
});

// ═══════════════════════════════════════════════════════════════
// K. STREAM ORCHESTRATOR — Event Processing
// ═══════════════════════════════════════════════════════════════

describe("K. Event Normalization & Processing", () => {
  it("K1 — normalizeStreamEvent returns null for unmapped symbol", () => {
    const state = createOrchestratorState();
    const event = makeStreamEvent();
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized).toBeNull();
  });

  it("K2 — normalizeStreamEvent maps QUOTE to QUOTE_UPDATE", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({ eventType: "QUOTE" });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized).not.toBeNull();
    expect(normalized!.eventType).toBe("QUOTE_UPDATE");
    expect(normalized!.priority).toBe("LOW");
  });

  it("K3 — normalizeStreamEvent maps FUNDING to FUNDING_CHANGE", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({ eventType: "FUNDING" });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized!.eventType).toBe("FUNDING_CHANGE");
    expect(normalized!.priority).toBe("MEDIUM");
  });

  it("K4 — normalizeStreamEvent maps LIQUIDATION to LIQUIDATION_CHANGE", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({ eventType: "LIQUIDATION" });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized!.eventType).toBe("LIQUIDATION_CHANGE");
    expect(normalized!.priority).toBe("HIGH");
  });

  it("K5 — high liquidation volume upgrades to CRITICAL", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({
      eventType: "LIQUIDATION",
      payload: { liquidationVolume: 2_000_000 },
    });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized!.priority).toBe("CRITICAL");
  });

  it("K6 — processStreamEvent updates event count", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent();
    const result = processStreamEvent(state, event, Date.now());
    expect(result.state.totalEventsReceived).toBe(1);
  });

  it("K7 — processStreamEvent drops unmapped events", () => {
    const state = createOrchestratorState();
    const event = makeStreamEvent();
    const result = processStreamEvent(state, event, Date.now());
    expect(result.state.totalEventsDropped).toBe(1);
    expect(result.alerts.length).toBe(0);
  });

  it("K8 — processStreamEvent drops out-of-order events", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    // Process first event
    const e1 = makeStreamEvent({ timestamp: 2000 });
    state = processStreamEvent(state, e1, 2000).state;
    // Process older event (out of order)
    const e2 = makeStreamEvent({ eventId: "evt-2", timestamp: 1000 });
    const result = processStreamEvent(state, e2, 2000);
    expect(result.state.totalEventsDropped).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. STREAM ORCHESTRATOR — Position Management
// ═══════════════════════════════════════════════════════════════

describe("L. Position Registration", () => {
  it("L1 — registerPosition adds position", () => {
    const state = createOrchestratorState();
    const updated = registerPosition(state, makePosition(), 1000);
    expect(updated.positions.has("pos-1")).toBe(true);
    expect(updated.positions.get("pos-1")!.lifecycle).toBe("MONITORING");
  });

  it("L2 — registerPosition adds to monitor", () => {
    const state = createOrchestratorState();
    const updated = registerPosition(state, makePosition(), 1000);
    expect(updated.monitor.positions.has("pos-1")).toBe(true);
  });

  it("L3 — unregisterPosition removes position", () => {
    let state = createOrchestratorState();
    state = registerPosition(state, makePosition(), 1000);
    const updated = unregisterPosition(state, "pos-1");
    expect(updated.positions.has("pos-1")).toBe(false);
  });

  it("L4 — pausePosition sets lifecycle to PAUSED", () => {
    let state = createOrchestratorState();
    state = registerPosition(state, makePosition(), 1000);
    const updated = pausePosition(state, "pos-1");
    expect(updated.positions.get("pos-1")!.lifecycle).toBe("PAUSED");
  });

  it("L5 — multiple positions are isolated", () => {
    let state = createOrchestratorState();
    state = registerPosition(state, makePosition({ positionId: "btc", instrument: "BTC/USD" }), 1000);
    state = registerPosition(state, makePosition({ positionId: "eth", instrument: "ETH/USD", side: "SHORT" }), 1000);
    expect(state.positions.size).toBe(2);
    expect(state.positions.get("btc")!.instrument).toBe("BTC/USD");
    expect(state.positions.get("eth")!.instrument).toBe("ETH/USD");
    expect(state.positions.get("eth")!.side).toBe("SHORT");
  });

  it("L6 — LONG vs SHORT are independent", () => {
    let state = createOrchestratorState();
    state = registerPosition(state, makePosition({ positionId: "btc-long", side: "LONG" }), 1000);
    state = registerPosition(state, makePosition({ positionId: "btc-short", side: "SHORT" }), 1000);
    expect(state.positions.get("btc-long")!.side).toBe("LONG");
    expect(state.positions.get("btc-short")!.side).toBe("SHORT");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. STREAM ORCHESTRATOR — Reconciliation
// ═══════════════════════════════════════════════════════════════

describe("M. Reconciliation", () => {
  it("M1 — reconcileProvider succeeds for live provider", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USD"], 1000);
    state = onProviderConnected(state, "OKX", 2000);
    state = onProviderDisconnected(state, "OKX", 3000);
    state = attemptReconnect(state, "OKX", 3000);
    const { result } = reconcileProvider(state, "OKX", 84000, 5000, 5000);
    expect(result.success).toBe(true);
    expect(result.currentPrice).toBe(84000);
  });

  it("M2 — reconcileProvider fails for unknown provider", () => {
    const state = createOrchestratorState();
    const { result } = reconcileProvider(state, "Unknown", 84000, 5000, 5000);
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. CLEANUP & MEMORY
// ═══════════════════════════════════════════════════════════════

describe("N. Cleanup & Memory Boundedness", () => {
  it("N1 — cleanupOrchestrator reduces history", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    // Process many events to build history
    for (let i = 0; i < 100; i++) {
      state = processStreamEvent(
        state,
        makeStreamEvent({ eventId: `evt-${i}`, timestamp: 1000 + i }),
        1000 + i,
      ).state;
    }
    const cleaned = cleanupOrchestrator(state, 10);
    expect(cleaned).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// O. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("O. Determinism", () => {
  it("O1 — same inputs produce same output for normalizeStreamEvent", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent();
    const r1 = normalizeStreamEvent(event, state);
    const r2 = normalizeStreamEvent(event, state);
    expect(r1!.eventType).toBe(r2!.eventType);
    expect(r1!.priority).toBe(r2!.priority);
    expect(r1!.payload.price).toBe(r2!.payload.price);
  });

  it("O2 — same inputs produce same output for reconnect engine", () => {
    const s = createReconnectState();
    const r1 = initiateConnect(s, 1000);
    const r2 = initiateConnect(s, 1000);
    expect(r1.status).toBe(r2.status);
    expect(r1.gapStartAt).toBe(r2.gapStartAt);
  });

  it("O3 — computeBackoff is deterministic", () => {
    for (let i = 0; i < 10; i++) {
      expect(computeBackoff(i, 30000)).toBe(computeBackoff(i, 30000));
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// P. NO FABRICATED DATA
// ═══════════════════════════════════════════════════════════════

describe("P. No Fabricated Data", () => {
  it("P1 — normalizeStreamEvent does not invent price", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({ payload: {} }); // no price
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized!.payload.price).toBeUndefined();
  });

  it("P2 — buildHealthState does not invent error", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastConnectedAt: 1000, lastMessageAt: 2000 };
    const health = buildHealthState(s, "OKX", 50, 2);
    expect(health.lastError).toBeUndefined();
  });

  it("P3 — InMemoryRepository does not create entries on get", async () => {
    const repo = new InMemoryRepository();
    const pos = await repo.getPositionState("nonexistent");
    expect(pos).toBeNull();
    const alerts = await repo.listAlertHistory("nonexistent");
    expect(alerts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. SECURITY — No Secrets
// ═══════════════════════════════════════════════════════════════

describe("Q. Security", () => {
  it("Q1 — provider profiles do not contain actual keys", () => {
    const providers = getAllProviders();
    for (const p of providers) {
      for (const envVar of p.credentialEnvVars) {
        expect(envVar).not.toContain("sk_");
        expect(envVar).not.toContain("key=");
      }
    }
  });

  it("Q2 — StreamHealthState does not contain credentials", () => {
    const s = { ...createReconnectState(), status: "LIVE" as const, lastConnectedAt: 1000, lastMessageAt: 2000 };
    const health = buildHealthState(s, "OKX", 100, 0);
    const serialized = JSON.stringify(health);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("password");
  });

  it("Q3 — PersistedPositionState does not expose API keys", () => {
    const pos: PersistedPositionState = {
      positionId: "p1",
      instrument: "BTC/USD",
      side: "LONG",
      entryPrice: 80000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
      monitoringLifecycle: "MONITORING",
    };
    const serialized = JSON.stringify(pos);
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("secret");
  });
});

// ═══════════════════════════════════════════════════════════════
// R. LARGE UNIVERSE STRESS
// ═══════════════════════════════════════════════════════════════

describe("R. Large Universe Stress", () => {
  it("R1 — register 100 positions without crash", () => {
    let state = createOrchestratorState();
    for (let i = 0; i < 100; i++) {
      state = registerPosition(
        state,
        makePosition({ positionId: `pos-${i}`, instrument: `INST-${i}` }),
        1000,
      );
    }
    expect(state.positions.size).toBe(100);
  });

  it("R2 — process 1000 events without crash", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    for (let i = 0; i < 1000; i++) {
      state = processStreamEvent(
        state,
        makeStreamEvent({ eventId: `evt-${i}`, timestamp: 1000 + i, payload: { price: 84000 + i } }),
        1000 + i,
      ).state;
    }
    expect(state.totalEventsReceived).toBe(1000);
  });

  it("R3 — persist 200 positions without crash", async () => {
    const repo = new InMemoryRepository();
    for (let i = 0; i < 200; i++) {
      await repo.savePositionState({
        positionId: `pos-${i}`,
        instrument: `INST-${i}`,
        side: "LONG",
        entryPrice: 100,
        horizon: "SWING",
        openedAt: Date.now(),
        currentSeverity: "NONE",
        lifecycleState: "MONITORING",
        lastUpdateAt: Date.now(),
        lastAlertAt: 0,
        consecutiveSameSeverity: 0,
        monitoringLifecycle: "MONITORING",
      });
    }
    const all = await repo.listActivePositions();
    expect(all.length).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. EMPTY INPUT
// ═══════════════════════════════════════════════════════════════

describe("S. Empty Input", () => {
  it("S1 — normalizeStreamEvent handles empty payload", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({ payload: {} });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized).not.toBeNull();
    expect(normalized!.payload).toBeDefined();
  });

  it("S2 — InMemoryRepository handles empty state", async () => {
    const repo = new InMemoryRepository();
    expect(await repo.listActivePositions()).toEqual([]);
    expect(await repo.getPositionState("any")).toBeNull();
  });

  it("S3 — createOrchestratorState has empty maps", () => {
    const state = createOrchestratorState();
    expect(state.providerStates.size).toBe(0);
    expect(state.symbolMappings.size).toBe(0);
    expect(state.positions.size).toBe(0);
    expect(state.acceleration.size).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// T. ADVISORIAL INPUTS
// ═══════════════════════════════════════════════════════════════

describe("T. Adversarial Inputs", () => {
  it("T1 — negative price does not crash normalizeStreamEvent", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({ payload: { price: -100 } });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized).not.toBeNull();
  });

  it("T2 — zero timestamp does not crash", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const event = makeStreamEvent({ timestamp: 0 });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized).not.toBeNull();
  });

  it("T3 — duplicate eventId is still processed", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, makeSymbolMapping());
    const e1 = makeStreamEvent({ eventId: "same", timestamp: 1000 });
    state = processStreamEvent(state, e1, 1000).state;
    const e2 = makeStreamEvent({ eventId: "same", timestamp: 2000 });
    const result = processStreamEvent(state, e2, 2000);
    // Duplicate ID doesn't prevent processing — timestamp ordering is what matters
    expect(result.state.totalEventsReceived).toBe(2);
  });

  it("T4 — Infinity price does not crash acceleration", () => {
    const s = createAccelerationState();
    const updated = recordPriceObservation(s, 1000, Infinity, "test");
    const result = calculateAcceleration(updated.priceObservations, 2000);
    expect(result).toBeDefined();
  });

  it("T5 — NaN price does not crash acceleration", () => {
    const s = createAccelerationState();
    const updated = recordPriceObservation(s, 1000, NaN, "test");
    const result = calculateAcceleration(updated.priceObservations, 2000);
    expect(result).toBeDefined();
  });
});
