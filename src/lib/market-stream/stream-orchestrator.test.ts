import { describe, it, expect } from "vitest";
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
  reconcileProvider,
  getProviderHealth,
  getMonitoringStatus,
  getPriceAcceleration,
  getGivebackAcceleration,
} from "./stream-orchestrator";
import type { StreamEvent } from "./types";
import { InMemoryRepository } from "../position-protection/persistence";

function makeStreamEvent(overrides: Partial<StreamEvent> = {}): StreamEvent {
  return {
    eventId: `evt-${Date.now()}-${Math.random()}`,
    provider: "OKX",
    instrument: "BTC/USDT",
    providerSymbol: "BTC-USDT",
    assetClass: "crypto",
    eventType: "QUOTE",
    timestamp: Date.now(),
    receivedAt: Date.now(),
    freshness: "FRESH",
    dependencyGroup: "PRICE",
    payload: { price: 52000 },
    ...overrides,
  };
}

describe("createOrchestratorState", () => {
  it("creates empty state", () => {
    const state = createOrchestratorState();
    expect(state.providerStates.size).toBe(0);
    expect(state.positions.size).toBe(0);
    expect(state.totalEventsReceived).toBe(0);
    expect(state.totalEventsDropped).toBe(0);
  });

  it("accepts custom repository", () => {
    const repo = new InMemoryRepository();
    const state = createOrchestratorState(repo);
    expect(state.repository).toBe(repo);
  });
});

describe("provider lifecycle", () => {
  it("connectProvider adds provider state", () => {
    const state = createOrchestratorState();
    const now = Date.now();
    const updated = connectProvider(state, "OKX", ["BTC/USDT"], now);
    expect(updated.providerStates.has("OKX")).toBe(true);
    expect(updated.providerConfigs.has("OKX")).toBe(true);
    expect(updated.providerConfigs.get("OKX")!.instruments).toContain("BTC/USDT");
  });

  it("onProviderConnected transitions to LIVE", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USDT"], Date.now());
    const updated = onProviderConnected(state, "OKX", Date.now());
    expect(updated.providerStates.get("OKX")!.status).toBe("LIVE");
  });

  it("onProviderDisconnected transitions to DISCONNECTED", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USDT"], Date.now());
    state = onProviderConnected(state, "OKX", Date.now());
    const updated = onProviderDisconnected(state, "OKX", Date.now(), "timeout");
    expect(updated.providerStates.get("OKX")!.status).toBe("DISCONNECTED");
  });

  it("attemptReconnect increments attempts", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USDT"], Date.now());
    const updated = attemptReconnect(state, "OKX", Date.now());
    expect(updated.providerStates.get("OKX")!.attempts).toBe(1);
  });
});

describe("symbol mapping", () => {
  it("registers and validates symbol mapping", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, {
      canonical: "BTC/USDT",
      providerSymbol: "BTC-USDT",
      provider: "OKX",
      assetClass: "crypto",
      quoteCurrency: "USDT",
      validated: true,
    });
    const result = validateSymbolIdentity(state, "OKX", "BTC-USDT");
    expect(result.valid).toBe(true);
    expect(result.canonical).toBe("BTC/USDT");
  });

  it("rejects unknown symbol", () => {
    const state = createOrchestratorState();
    const result = validateSymbolIdentity(state, "OKX", "UNKNOWN-USDT");
    expect(result.valid).toBe(false);
  });
});

describe("normalizeStreamEvent", () => {
  it("normalizes QUOTE event with valid mapping", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, {
      canonical: "BTC/USDT",
      providerSymbol: "BTC-USDT",
      provider: "OKX",
      assetClass: "crypto",
      quoteCurrency: "USDT",
      validated: true,
    });
    const event = makeStreamEvent();
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized).not.toBeNull();
    expect(normalized!.eventType).toBe("QUOTE_UPDATE");
    expect(normalized!.instrument).toBe("BTC/USDT");
  });

  it("returns null for unmapped symbol", () => {
    const state = createOrchestratorState();
    const event = makeStreamEvent();
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized).toBeNull();
  });

  it("maps FUNDING event type correctly", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, {
      canonical: "BTC/USDT",
      providerSymbol: "BTC-USDT",
      provider: "OKX",
      assetClass: "crypto",
      quoteCurrency: "USDT",
      validated: true,
    });
    const event = makeStreamEvent({ eventType: "FUNDING", payload: { fundingRate: 0.001 } });
    const normalized = normalizeStreamEvent(event, state);
    expect(normalized!.eventType).toBe("FUNDING_CHANGE");
  });
});

describe("processStreamEvent", () => {
  it("processes event and updates state", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, {
      canonical: "BTC/USDT",
      providerSymbol: "BTC-USDT",
      provider: "OKX",
      assetClass: "crypto",
      quoteCurrency: "USDT",
      validated: true,
    });
    state = connectProvider(state, "OKX", ["BTC/USDT"], Date.now());
    state = onProviderConnected(state, "OKX", Date.now());
    const event = makeStreamEvent();
    const result = processStreamEvent(state, event, Date.now());
    expect(result.state.totalEventsReceived).toBe(1);
  });

  it("drops out-of-order events", () => {
    let state = createOrchestratorState();
    state = registerSymbolMapping(state, {
      canonical: "BTC/USDT",
      providerSymbol: "BTC-USDT",
      provider: "OKX",
      assetClass: "crypto",
      quoteCurrency: "USDT",
      validated: true,
    });
    state = connectProvider(state, "OKX", ["BTC/USDT"], Date.now());
    state = onProviderConnected(state, "OKX", Date.now());
    const now = Date.now();
    const e1 = makeStreamEvent({ timestamp: now + 1000 });
    state = processStreamEvent(state, e1, now).state;
    const e2 = makeStreamEvent({ timestamp: now }); // older
    const result = processStreamEvent(state, e2, now + 100);
    expect(result.state.totalEventsDropped).toBe(1);
  });

  it("drops events with unmapped symbols", () => {
    const state = createOrchestratorState();
    const event = makeStreamEvent();
    const result = processStreamEvent(state, event, Date.now());
    expect(result.state.totalEventsDropped).toBe(1);
  });
});

describe("position registration", () => {
  it("registers position with MONITORING lifecycle", () => {
    const state = createOrchestratorState();
    const updated = registerPosition(state, {
      positionId: "pos-1",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 50000,
      horizon: "SWING",
      openedAt: Date.now(),
      lifecycle: "REGISTERED",
    }, Date.now());
    expect(updated.positions.has("pos-1")).toBe(true);
    expect(updated.positions.get("pos-1")!.lifecycle).toBe("MONITORING");
  });

  it("unregisters position", () => {
    let state = createOrchestratorState();
    state = registerPosition(state, {
      positionId: "pos-1",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 50000,
      horizon: "SWING",
      openedAt: Date.now(),
      lifecycle: "REGISTERED",
    }, Date.now());
    const updated = unregisterPosition(state, "pos-1");
    expect(updated.positions.has("pos-1")).toBe(false);
  });
});

describe("reconciliation", () => {
  it("reconciles with valid data", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USDT"], Date.now());
    state = onProviderConnected(state, "OKX", Date.now());
    const result = reconcileProvider(state, "OKX", 52000, Date.now(), Date.now());
    expect(result.result.success).toBe(true);
    expect(result.result.currentPrice).toBe(52000);
  });

  it("fails reconciliation without provider state", () => {
    const state = createOrchestratorState();
    const result = reconcileProvider(state, "OKX", 52000, Date.now(), Date.now());
    expect(result.result.success).toBe(false);
  });
});

describe("provider health", () => {
  it("returns health for known provider", () => {
    let state = createOrchestratorState();
    state = connectProvider(state, "OKX", ["BTC/USDT"], Date.now());
    state = onProviderConnected(state, "OKX", Date.now());
    const health = getProviderHealth(state, "OKX");
    expect(health).not.toBeNull();
    expect(health!.provider).toBe("OKX");
    expect(health!.status).toBe("LIVE");
  });

  it("returns null for unknown provider", () => {
    const state = createOrchestratorState();
    expect(getProviderHealth(state, "OKX")).toBeNull();
  });
});

describe("monitoring status", () => {
  it("returns DISCONNECTED when no providers", () => {
    const state = createOrchestratorState();
    expect(getMonitoringStatus(state, "BTC/USDT")).toBe("DISCONNECTED");
  });
});

describe("acceleration access", () => {
  it("returns null when no acceleration state", () => {
    const state = createOrchestratorState();
    expect(getPriceAcceleration(state, "BTC/USDT", "LONG", Date.now())).toBeNull();
    expect(getGivebackAcceleration(state, "BTC/USDT", Date.now())).toBeNull();
  });
});
