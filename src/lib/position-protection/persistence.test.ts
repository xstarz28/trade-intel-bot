import { describe, it, expect } from "vitest";
import { InMemoryRepository } from "./persistence";
import type { PersistedPositionState, PersistedAlert, EventCursor } from "./persistence";

describe("InMemoryRepository", () => {
  describe("position state", () => {
    it("saves and retrieves position state", async () => {
      const repo = new InMemoryRepository();
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
      await repo.savePositionState(state);
      const retrieved = await repo.getPositionState("pos-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.positionId).toBe("pos-1");
      expect(retrieved!.instrument).toBe("BTC/USDT");
    });

    it("returns null for non-existent position", async () => {
      const repo = new InMemoryRepository();
      expect(await repo.getPositionState("non-existent")).toBeNull();
    });

    it("deletes position state", async () => {
      const repo = new InMemoryRepository();
      await repo.savePositionState({
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
      await repo.deletePositionState("pos-1");
      expect(await repo.getPositionState("pos-1")).toBeNull();
    });

    it("lists only MONITORING positions", async () => {
      const repo = new InMemoryRepository();
      await repo.savePositionState({
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
      await repo.savePositionState({
        positionId: "pos-2",
        instrument: "ETH/USDT",
        side: "SHORT",
        entryPrice: 3000,
        horizon: "INTRADAY",
        openedAt: Date.now(),
        currentSeverity: "NONE",
        lifecycleState: "CLOSED",
        monitoringLifecycle: "CLOSED",
        lastUpdateAt: Date.now(),
        lastAlertAt: 0,
        consecutiveSameSeverity: 0,
      });
      const active = await repo.listActivePositions();
      expect(active).toHaveLength(1);
      expect(active[0].positionId).toBe("pos-1");
    });
  });

  describe("alerts", () => {
    it("saves and lists alerts", async () => {
      const repo = new InMemoryRepository();
      const alert: PersistedAlert = {
        alertId: "alert-1",
        positionId: "pos-1",
        instrument: "BTC/USDT",
        severity: "CAUTION",
        notificationPriority: "WARNING",
        reason: "Thesis deteriorating.",
        action: "Monitor closely.",
        timestamp: Date.now(),
        acknowledged: false,
      };
      await repo.saveAlert(alert);
      const alerts = await repo.listAlertHistory("pos-1");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].alertId).toBe("alert-1");
    });

    it("returns empty for unknown position", async () => {
      const repo = new InMemoryRepository();
      const alerts = await repo.listAlertHistory("non-existent");
      expect(alerts).toEqual([]);
    });

    it("respects limit parameter", async () => {
      const repo = new InMemoryRepository();
      for (let i = 0; i < 10; i++) {
        await repo.saveAlert({
          alertId: `alert-${i}`,
          positionId: "pos-1",
          instrument: "BTC/USDT",
          severity: "WATCH",
          notificationPriority: "INFO",
          reason: "test",
          action: "monitor",
          timestamp: Date.now() + i,
          acknowledged: false,
        });
      }
      const alerts = await repo.listAlertHistory("pos-1", 3);
      expect(alerts).toHaveLength(3);
    });

    it("acknowledges alert", async () => {
      const repo = new InMemoryRepository();
      await repo.saveAlert({
        alertId: "alert-1",
        positionId: "pos-1",
        instrument: "BTC/USDT",
        severity: "HIGH_RISK",
        notificationPriority: "URGENT",
        reason: "test",
        action: "protect",
        timestamp: Date.now(),
        acknowledged: false,
      });
      const result = await repo.acknowledgeAlert("alert-1");
      expect(result).toBe(true);
      const alerts = await repo.listAlertHistory("pos-1");
      expect(alerts[0].acknowledged).toBe(true);
    });

    it("returns false for unknown alert", async () => {
      const repo = new InMemoryRepository();
      expect(await repo.acknowledgeAlert("unknown")).toBe(false);
    });
  });

  describe("event cursors", () => {
    it("saves and retrieves cursor", async () => {
      const repo = new InMemoryRepository();
      const cursor: EventCursor = {
        provider: "OKX",
        instrument: "BTC/USDT",
        lastEventId: "evt-123",
        lastTimestamp: Date.now(),
        lastSequence: 42,
      };
      await repo.saveEventCursor(cursor);
      const retrieved = await repo.getEventCursor("OKX", "BTC/USDT");
      expect(retrieved).not.toBeNull();
      expect(retrieved!.lastEventId).toBe("evt-123");
      expect(retrieved!.lastSequence).toBe(42);
    });

    it("returns null for unknown cursor", async () => {
      const repo = new InMemoryRepository();
      expect(await repo.getEventCursor("OKX", "ETH/USDT")).toBeNull();
    });

    it("overwrites existing cursor", async () => {
      const repo = new InMemoryRepository();
      await repo.saveEventCursor({
        provider: "OKX",
        instrument: "BTC/USDT",
        lastEventId: "evt-1",
        lastTimestamp: 1000,
      });
      await repo.saveEventCursor({
        provider: "OKX",
        instrument: "BTC/USDT",
        lastEventId: "evt-2",
        lastTimestamp: 2000,
      });
      const cursor = await repo.getEventCursor("OKX", "BTC/USDT");
      expect(cursor!.lastEventId).toBe("evt-2");
      expect(cursor!.lastTimestamp).toBe(2000);
    });
  });

  describe("health", () => {
    it("is always available", async () => {
      const repo = new InMemoryRepository();
      expect(await repo.isAvailable()).toBe(true);
    });
  });

  describe("alert history ordering", () => {
    it("returns alerts sorted by timestamp descending", async () => {
      const repo = new InMemoryRepository();
      await repo.saveAlert({
        alertId: "alert-1",
        positionId: "pos-1",
        instrument: "BTC",
        severity: "WATCH",
        notificationPriority: "INFO",
        reason: "a",
        action: "m",
        timestamp: 100,
        acknowledged: false,
      });
      await repo.saveAlert({
        alertId: "alert-2",
        positionId: "pos-1",
        instrument: "BTC",
        severity: "CAUTION",
        notificationPriority: "WARNING",
        reason: "b",
        action: "m",
        timestamp: 300,
        acknowledged: false,
      });
      await repo.saveAlert({
        alertId: "alert-3",
        positionId: "pos-1",
        instrument: "BTC",
        severity: "HIGH_RISK",
        notificationPriority: "URGENT",
        reason: "c",
        action: "p",
        timestamp: 200,
        acknowledged: false,
      });
      const alerts = await repo.listAlertHistory("pos-1");
      expect(alerts[0].timestamp).toBe(300);
      expect(alerts[1].timestamp).toBe(200);
      expect(alerts[2].timestamp).toBe(100);
    });
  });
});
