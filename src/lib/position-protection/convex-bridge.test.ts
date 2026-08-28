import { describe, it, expect } from "vitest";
import { ConvexPersistenceBridge } from "./convex-bridge";
import type { PersistedPositionState, PersistedAlert, EventCursor } from "./persistence";

describe("ConvexPersistenceBridge (no client — fallback path)", () => {
  it("saves and retrieves position state locally", async () => {
    const bridge = new ConvexPersistenceBridge(null);
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
    await bridge.savePositionState(state);
    const retrieved = await bridge.getPositionState("pos-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.positionId).toBe("pos-1");
  });

  it("deletes position state", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.savePositionState({
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
    await bridge.deletePositionState("pos-1");
    expect(await bridge.getPositionState("pos-1")).toBeNull();
  });

  it("lists active positions", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.savePositionState({
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
    const active = await bridge.listActivePositions();
    expect(active).toHaveLength(1);
  });

  it("saves and lists alerts", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    const alert: PersistedAlert = {
      alertId: "alert-1",
      positionId: "pos-1",
      instrument: "BTC",
      severity: "CAUTION",
      notificationPriority: "WARNING",
      reason: "test",
      action: "monitor",
      timestamp: Date.now(),
      acknowledged: false,
    };
    await bridge.saveAlert(alert);
    const alerts = await bridge.listAlertHistory("pos-1");
    expect(alerts).toHaveLength(1);
  });

  it("acknowledges alert", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    await bridge.saveAlert({
      alertId: "alert-1",
      positionId: "pos-1",
      instrument: "BTC",
      severity: "WATCH",
      notificationPriority: "INFO",
      reason: "test",
      action: "m",
      timestamp: Date.now(),
      acknowledged: false,
    });
    await bridge.acknowledgeAlert("alert-1");
    const alerts = await bridge.listAlertHistory("pos-1");
    expect(alerts[0].acknowledged).toBe(true);
  });

  it("saves and retrieves cursor", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    const cursor: EventCursor = {
      provider: "OKX",
      instrument: "BTC/USDT",
      lastEventId: "evt-1",
      lastTimestamp: Date.now(),
    };
    await bridge.saveEventCursor(cursor);
    const retrieved = await bridge.getEventCursor("OKX", "BTC/USDT");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.lastEventId).toBe("evt-1");
  });

  it("not degraded without client", () => {
    const bridge = new ConvexPersistenceBridge(null);
    expect(bridge.isDegraded()).toBe(false);
  });

  it("isAvailable returns true", async () => {
    const bridge = new ConvexPersistenceBridge(null);
    expect(await bridge.isAvailable()).toBe(true);
  });
});
