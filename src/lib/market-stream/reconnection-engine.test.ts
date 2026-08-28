import { describe, it, expect } from "vitest";
import {
  createReconnectState,
  initiateConnect,
  onConnected,
  onDisconnected,
  initiateReconnect,
  computeBackoff,
  advanceBackoff,
  checkHeartbeat,
  recordMessage,
  detectStaleness,
  reconcileAfterReconnect,
  buildHealthState,
} from "./reconnection-engine";

describe("createReconnectState", () => {
  it("creates default state", () => {
    const state = createReconnectState();
    expect(state.status).toBe("DISCONNECTED");
    expect(state.attempts).toBe(0);
    expect(state.maxAttempts).toBe(10);
    expect(state.currentBackoffMs).toBe(1000);
    expect(state.maxBackoffMs).toBe(30_000);
  });

  it("accepts custom config", () => {
    const state = createReconnectState({
      maxAttempts: 5,
      maxBackoffMs: 16_000,
      heartbeatIntervalMs: 15_000,
      staleThresholdMs: 30_000,
    });
    expect(state.maxAttempts).toBe(5);
    expect(state.maxBackoffMs).toBe(16_000);
    expect(state.heartbeatIntervalMs).toBe(15_000);
    expect(state.staleThresholdMs).toBe(30_000);
  });
});

describe("state transitions", () => {
  it("initiateConnect sets CONNECTING", () => {
    const state = createReconnectState();
    const connected = initiateConnect(state, Date.now());
    expect(connected.status).toBe("CONNECTING");
  });

  it("onConnected sets LIVE and resets", () => {
    const state = createReconnectState();
    let s = initiateConnect(state, Date.now());
    s = onConnected(s, Date.now() + 1000);
    expect(s.status).toBe("LIVE");
    expect(s.attempts).toBe(0);
    expect(s.lastConnectedAt).toBe(Date.now() + 1000);
  });

  it("onDisconnected sets DISCONNECTED", () => {
    const state = createReconnectState();
    const s = onDisconnected(state, Date.now(), "timeout");
    expect(s.status).toBe("DISCONNECTED");
    expect(s.lastError).toBe("timeout");
  });

  it("initiateReconnect sets RECONNECTING and increments attempts", () => {
    const state = createReconnectState();
    const s = initiateReconnect(state, Date.now());
    expect(s.status).toBe("RECONNECTING");
    expect(s.attempts).toBe(1);
  });

  it("initiateReconnect sets FAILED after max attempts", () => {
    let state = createReconnectState({ maxAttempts: 3 });
    state = initiateReconnect(state, Date.now());
    state = initiateReconnect(state, Date.now());
    state = initiateReconnect(state, Date.now());
    const s = initiateReconnect(state, Date.now());
    expect(s.status).toBe("FAILED");
    expect(s.lastError).toContain("Max");
  });
});

describe("computeBackoff", () => {
  it("returns 1s for attempt 0", () => {
    expect(computeBackoff(0, 30_000)).toBe(1000);
  });

  it("doubles each attempt", () => {
    expect(computeBackoff(1, 30_000)).toBe(2000);
    expect(computeBackoff(2, 30_000)).toBe(4000);
    expect(computeBackoff(3, 30_000)).toBe(8000);
    expect(computeBackoff(4, 30_000)).toBe(16000);
  });

  it("caps at maxBackoff", () => {
    expect(computeBackoff(5, 30_000)).toBe(30000);
    expect(computeBackoff(10, 30_000)).toBe(30000);
  });
});

describe("advanceBackoff", () => {
  it("updates currentBackoffMs based on attempts", () => {
    let state = createReconnectState();
    state = initiateReconnect(state, Date.now()); // attempts=1
    state = advanceBackoff(state);
    expect(state.currentBackoffMs).toBe(2000);
  });
});

describe("heartbeat / staleness", () => {
  it("checkHeartbeat detects staleness", () => {
    const state = createReconnectState({ staleThresholdMs: 60_000 });
    const s = {
      ...state,
      status: "LIVE" as const,
      lastMessageAt: Date.now() - 70_000,
      lastHeartbeatAt: Date.now(),
    };
    const result = checkHeartbeat(s, Date.now());
    expect(result.isStale).toBe(true);
    expect(result.dataFresh).toBe(false);
  });

  it("checkHeartbeat detects need for heartbeat", () => {
    const state = createReconnectState({ heartbeatIntervalMs: 30_000 });
    const s = {
      ...state,
      lastHeartbeatAt: Date.now() - 35_000,
      lastMessageAt: Date.now(),
    };
    const result = checkHeartbeat(s, Date.now());
    expect(result.needsHeartbeat).toBe(true);
  });

  it("detectStaleness returns DEGRADED when slightly stale", () => {
    const state = createReconnectState({ staleThresholdMs: 60_000 });
    const s = {
      ...state,
      status: "LIVE" as const,
      lastMessageAt: Date.now() - 65_000,
    };
    expect(detectStaleness(s, Date.now())).toBe("DEGRADED");
  });

  it("detectStaleness returns STALE when very stale", () => {
    const state = createReconnectState({ staleThresholdMs: 60_000 });
    const s = {
      ...state,
      status: "LIVE" as const,
      lastMessageAt: Date.now() - 130_000,
    };
    expect(detectStaleness(s, Date.now())).toBe("STALE");
  });

  it("detectStaleness returns LIVE when fresh", () => {
    const state = createReconnectState({ staleThresholdMs: 60_000 });
    const s = {
      ...state,
      status: "LIVE" as const,
      lastMessageAt: Date.now() - 10_000,
    };
    expect(detectStaleness(s, Date.now())).toBe("LIVE");
  });
});

describe("recordMessage", () => {
  it("updates lastMessageAt", () => {
    const state = createReconnectState();
    const now = Date.now();
    const s = recordMessage(state, now);
    expect(s.lastMessageAt).toBe(now);
  });
});

describe("reconcileAfterReconnect", () => {
  it("succeeds with valid price and timestamp", () => {
    const state = createReconnectState();
    const result = reconcileAfterReconnect(state, 52000, Date.now(), Date.now());
    expect(result.success).toBe(true);
    expect(result.currentPrice).toBe(52000);
    expect(result.stateReconciled).toBe(true);
  });

  it("fails with invalid price", () => {
    const state = createReconnectState();
    const result = reconcileAfterReconnect(state, 0, 0, Date.now());
    expect(result.success).toBe(false);
  });
});

describe("buildHealthState", () => {
  it("builds healthy state for LIVE connection", () => {
    const state = {
      ...createReconnectState(),
      status: "LIVE" as const,
      lastMessageAt: Date.now(),
      lastConnectedAt: Date.now(),
    };
    const health = buildHealthState(state, "OKX", 100, 2);
    expect(health.status).toBe("LIVE");
    expect(health.health).toBe("HEALTHY");
    expect(health.eventsReceived).toBe(100);
    expect(health.eventsDropped).toBe(2);
  });

  it("builds unhealthy state for FAILED connection", () => {
    const state = {
      ...createReconnectState(),
      status: "FAILED" as const,
      lastError: "Max attempts exceeded",
    };
    const health = buildHealthState(state, "OKX", 50, 10);
    expect(health.health).toBe("UNAVAILABLE");
    expect(health.lastError).toBe("Max attempts exceeded");
  });
});
