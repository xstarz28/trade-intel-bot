import { describe, it, expect } from "vitest";
import { ConvexPersistenceAdapter } from "./convex-persistence";
import type { PersistedPositionState, PersistedAlert, EventCursor } from "./persistence";

describe("ConvexPersistenceAdapter (no client — fallback path)", () => {
  it("falls back to in-memory when client is null", async () => {
    const adapter = new ConvexPersistenceAdapter(null);
    const state: PersistedPositionState = {
      positionId: "pos-1",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 50000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
    };
    await adapter.savePositionState(state);
    const retrieved = await adapter.getPositionState("pos-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.positionId).toBe("pos-1");
  });

  it("is not degraded when client is null", () => {
    const adapter = new ConvexPersistenceAdapter(null);
    expect(adapter.isDegraded).toBe(false);
  });

  it("degrades when Convex mutation fails", async () => {
    const failingClient = {
      mutation: async () => { throw new Error("Convex unavailable"); },
      query: async () => { throw new Error("Convex unavailable"); },
    };
    const adapter = new ConvexPersistenceAdapter(failingClient);
    await adapter.savePositionState({
      positionId: "pos-1",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 50000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
    });
    expect(adapter.isDegraded).toBe(true);
    // But local fallback still works
    const retrieved = await adapter.getPositionState("pos-1");
    expect(retrieved).not.toBeNull();
  });

  it("lists active positions from local cache", async () => {
    const adapter = new ConvexPersistenceAdapter(null);
    await adapter.savePositionState({
      positionId: "pos-1",
      instrument: "BTC/USDT",
      side: "LONG",
      entryPrice: 50000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
    });
    const active = await adapter.listActivePositions();
    expect(active).toHaveLength(1);
  });

  it("saves and retrieves alerts locally", async () => {
    const adapter = new ConvexPersistenceAdapter(null);
    const alert: PersistedAlert = {
      alertId: "alert-1",
      positionId: "pos-1",
      instrument: "BTC/USDT",
      severity: "WATCH",
      notificationPriority: "INFO",
      reason: "test",
      action: "monitor",
      timestamp: Date.now(),
      acknowledged: false,
    };
    await adapter.saveAlert(alert);
    const alerts = await adapter.listAlertHistory("pos-1");
    expect(alerts).toHaveLength(1);
  });

  it("acknowledges alert locally", async () => {
    const adapter = new ConvexPersistenceAdapter(null);
    await adapter.saveAlert({
      alertId: "alert-1",
      positionId: "pos-1",
      instrument: "BTC",
      severity: "CAUTION",
      notificationPriority: "WARNING",
      reason: "test",
      action: "monitor",
      timestamp: Date.now(),
      acknowledged: false,
    });
    const result = await adapter.acknowledgeAlert("alert-1");
    expect(result).toBe(true);
    const alerts = await adapter.listAlertHistory("pos-1");
    expect(alerts[0].acknowledged).toBe(true);
  });

  it("saves and retrieves event cursors locally", async () => {
    const adapter = new ConvexPersistenceAdapter(null);
    const cursor: EventCursor = {
      provider: "OKX",
      instrument: "BTC/USDT",
      lastEventId: "evt-123",
      lastTimestamp: Date.now(),
    };
    await adapter.saveEventCursor(cursor);
    const retrieved = await adapter.getEventCursor("OKX", "BTC/USDT");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.lastEventId).toBe("evt-123");
  });

  it("deletes position state locally", async () => {
    const adapter = new ConvexPersistenceAdapter(null);
    await adapter.savePositionState({
      positionId: "pos-1",
      instrument: "BTC",
      side: "LONG",
      entryPrice: 50000,
      horizon: "SWING",
      openedAt: Date.now(),
      currentSeverity: "NONE",
      lifecycleState: "MONITORING",
      monitoringLifecycle: "MONITORING",
      lastUpdateAt: Date.now(),
      lastAlertAt: 0,
      consecutiveSameSeverity: 0,
    });
    await adapter.deletePositionState("pos-1");
    expect(await adapter.getPositionState("pos-1")).toBeNull();
  });

  it("isAvailable returns true", async () => {
    const adapter = new ConvexPersistenceAdapter(null);
    expect(await adapter.isAvailable()).toBe(true);
  });
});
