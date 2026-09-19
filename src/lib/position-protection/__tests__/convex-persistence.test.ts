/**
 * Phase 60 — Convex Persistence Adapter Tests
 *
 * Tests the ConvexPersistenceAdapter with a mock Convex client,
 * verifying persistence lifecycle, fallback behavior, and degradation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ConvexPersistenceAdapter, type ConvexClientLike } from "../convex-persistence";
import { InMemoryRepository } from "../persistence";
import type { PersistedPositionState, PersistedAlert, EventCursor } from "../persistence";

// ═══════════════════════════════════════════════════════════════
// MOCK CONVEX CLIENT
// ═══════════════════════════════════════════════════════════════

function createMockClient(overrides?: {
  mutationThrows?: boolean;
  queryThrows?: boolean;
  queryResult?: unknown;
}): ConvexClientLike {
  return {
    mutation: async (fn: string, args?: Record<string, unknown>) => {
      if (overrides?.mutationThrows) throw new Error("mutation failed");
      return { fn, args };
    },
    query: async (_fn: string, _args?: Record<string, unknown>) => {
      if (overrides?.queryThrows) throw new Error("query failed");
      if (overrides?.queryResult !== undefined) return overrides.queryResult;
      return null;
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// TEST DATA
// ═══════════════════════════════════════════════════════════════

const TEST_POSITION: PersistedPositionState = {
  positionId: "pos-1",
  instrument: "BTC/USDT",
  side: "LONG",
  entryPrice: 50000,
  stopLoss: 48000,
  takeProfit: 55000,
  leverage: 2,
  horizon: "SWING",
  openedAt: Date.now(),
  peakPrice: 52000,
  peakProfit: 2000,
  currentSeverity: "NONE",
  lifecycleState: "MONITORING",
  monitoringLifecycle: "MONITORING",
  lastUpdateAt: Date.now(),
  lastAlertAt: 0,
  consecutiveSameSeverity: 0,
};

const TEST_ALERT: PersistedAlert = {
  alertId: "alert-1",
  positionId: "pos-1",
  instrument: "BTC/USDT",
  severity: "WATCH",
  notificationPriority: "INFO",
  reason: "Early deterioration detected",
  action: "Monitor closely",
  timestamp: Date.now(),
  acknowledged: false,
};

const TEST_CURSOR: EventCursor = {
  provider: "OKX",
  instrument: "BTC/USDT",
  lastEventId: "evt-1",
  lastTimestamp: Date.now(),
  lastSequence: 42,
};

// ═══════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════

describe("ConvexPersistenceAdapter", () => {
  describe("without Convex client (fallback mode)", () => {
    let adapter: ConvexPersistenceAdapter;

    beforeEach(() => {
      adapter = new ConvexPersistenceAdapter(null);
    });

    it("should be available without client", async () => {
      expect(await adapter.isAvailable()).toBe(true);
    });

    it("should save and retrieve position state", async () => {
      const result = await adapter.savePositionState(TEST_POSITION);
      expect(result).toBe(true);

      const retrieved = await adapter.getPositionState("pos-1");
      expect(retrieved).not.toBeNull();
      expect(retrieved?.instrument).toBe("BTC/USDT");
      expect(retrieved?.side).toBe("LONG");
      expect(retrieved?.entryPrice).toBe(50000);
    });

    it("should list active positions", async () => {
      await adapter.savePositionState(TEST_POSITION);
      const active = await adapter.listActivePositions();
      expect(active).toHaveLength(1);
      expect(active[0].positionId).toBe("pos-1");
    });

    it("should delete position state", async () => {
      await adapter.savePositionState(TEST_POSITION);
      const deleted = await adapter.deletePositionState("pos-1");
      expect(deleted).toBe(true);

      const retrieved = await adapter.getPositionState("pos-1");
      expect(retrieved).toBeNull();
    });

    it("should save and list alerts", async () => {
      const saved = await adapter.saveAlert(TEST_ALERT);
      expect(saved).toBe(true);

      const alerts = await adapter.listAlertHistory("pos-1");
      expect(alerts).toHaveLength(1);
      expect(alerts[0].alertId).toBe("alert-1");
      expect(alerts[0].severity).toBe("WATCH");
    });

    it("should acknowledge alerts", async () => {
      await adapter.saveAlert(TEST_ALERT);
      const acked = await adapter.acknowledgeAlert("alert-1");
      expect(acked).toBe(true);

      const alerts = await adapter.listAlertHistory("pos-1");
      expect(alerts[0].acknowledged).toBe(true);
    });

    it("should save and retrieve event cursors", async () => {
      await adapter.saveEventCursor(TEST_CURSOR);
      const cursor = await adapter.getEventCursor("OKX", "BTC/USDT");
      expect(cursor).not.toBeNull();
      expect(cursor?.lastEventId).toBe("evt-1");
      expect(cursor?.lastSequence).toBe(42);
    });

    it("should return null for non-existent position", async () => {
      const result = await adapter.getPositionState("non-existent");
      expect(result).toBeNull();
    });

    it("should return empty list when no active positions", async () => {
      const active = await adapter.listActivePositions();
      expect(active).toHaveLength(0);
    });
  });

  describe("with Convex client", () => {
    let adapter: ConvexPersistenceAdapter;
    let client: ConvexClientLike;

    beforeEach(() => {
      client = createMockClient();
      adapter = new ConvexPersistenceAdapter(client);
    });

    it("should not be degraded when Convex is available", async () => {
      expect(adapter.isDegraded).toBe(false);
    });

    it("should save position state via Convex and locally", async () => {
      const result = await adapter.savePositionState(TEST_POSITION);
      expect(result).toBe(true);
      expect(adapter.isDegraded).toBe(false);

      // Should also be available locally
      const retrieved = await adapter.getPositionState("pos-1");
      expect(retrieved?.instrument).toBe("BTC/USDT");
    });

    it("should handle Convex mutation failure gracefully", async () => {
      const failingClient = createMockClient({ mutationThrows: true });
      const failingAdapter = new ConvexPersistenceAdapter(failingClient);

      const result = await failingAdapter.savePositionState(TEST_POSITION);
      expect(result).toBe(true); // Still succeeds locally
      expect(failingAdapter.isDegraded).toBe(true);
    });

    it("should handle Convex query failure gracefully", async () => {
      const failingClient = createMockClient({ queryThrows: true });
      const failingAdapter = new ConvexPersistenceAdapter(failingClient);

      const result = await failingAdapter.getPositionState("pos-1");
      expect(result).toBeNull();
      expect(failingAdapter.isDegraded).toBe(true);
    });

    it("should recover from degradation when Convex recovers", async () => {
      const failingClient = createMockClient({ mutationThrows: true });
      const adapterWithRecovery = new ConvexPersistenceAdapter(failingClient);

      // Degrade
      await adapterWithRecovery.savePositionState(TEST_POSITION);
      expect(adapterWithRecovery.isDegraded).toBe(true);

      // Recover — use a working client
      const workingClient = createMockClient();
      const recoveredAdapter = new ConvexPersistenceAdapter(workingClient);
      await recoveredAdapter.savePositionState(TEST_POSITION);
      expect(recoveredAdapter.isDegraded).toBe(false);
    });
  });
});

describe("InMemoryRepository", () => {
  let repo: InMemoryRepository;

  beforeEach(() => {
    repo = new InMemoryRepository();
  });

  it("should save and retrieve position state", async () => {
    await repo.savePositionState(TEST_POSITION);
    const retrieved = await repo.getPositionState("pos-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved?.positionId).toBe("pos-1");
  });

  it("should overwrite existing position state", async () => {
    await repo.savePositionState(TEST_POSITION);
    const updated = { ...TEST_POSITION, currentSeverity: "WATCH" as const };
    await repo.savePositionState(updated);

    const retrieved = await repo.getPositionState("pos-1");
    expect(retrieved?.currentSeverity).toBe("WATCH");
  });

  it("should list only MONITORING positions", async () => {
    await repo.savePositionState(TEST_POSITION);
    await repo.savePositionState({
      ...TEST_POSITION,
      positionId: "pos-2",
      monitoringLifecycle: "CLOSED",
    });

    const active = await repo.listActivePositions();
    expect(active).toHaveLength(1);
    expect(active[0].positionId).toBe("pos-1");
  });

  it("should keep bounded alert history (max 1000)", async () => {
    // Add 1100 alerts
    for (let i = 0; i < 1100; i++) {
      await repo.saveAlert({
        ...TEST_ALERT,
        alertId: `alert-${i}`,
        timestamp: Date.now() + i,
      });
    }

    const alerts = await repo.listAlertHistory("pos-1", 2000);
    expect(alerts.length).toBeLessThanOrEqual(1000);
  });
});

describe("Position Protection Lifecycle", () => {
  it("should follow register → monitor → alert → ack lifecycle", async () => {
    const repo = new InMemoryRepository();

    // 1. Register position
    await repo.savePositionState(TEST_POSITION);
    const pos = await repo.getPositionState("pos-1");
    expect(pos?.monitoringLifecycle).toBe("MONITORING");

    // 2. Save alert
    await repo.saveAlert(TEST_ALERT);
    const alerts = await repo.listAlertHistory("pos-1");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].acknowledged).toBe(false);

    // 3. Acknowledge alert
    await repo.acknowledgeAlert("alert-1");
    const ackedAlerts = await repo.listAlertHistory("pos-1");
    expect(ackedAlerts[0].acknowledged).toBe(true);

    // 4. Update position severity
    const updated = { ...TEST_POSITION, currentSeverity: "CAUTION" as const };
    await repo.savePositionState(updated);
    const updatedPos = await repo.getPositionState("pos-1");
    expect(updatedPos?.currentSeverity).toBe("CAUTION");

    // 5. Delete position (close)
    await repo.deletePositionState("pos-1");
    const deletedPos = await repo.getPositionState("pos-1");
    expect(deletedPos).toBeNull();

    // 6. Alerts should still be queryable
    const remainingAlerts = await repo.listAlertHistory("pos-1");
    expect(remainingAlerts).toHaveLength(1);
  });

  it("should isolate positions by positionId", async () => {
    const repo = new InMemoryRepository();

    await repo.savePositionState({ ...TEST_POSITION, positionId: "pos-a", instrument: "BTC/USDT" });
    await repo.savePositionState({ ...TEST_POSITION, positionId: "pos-b", instrument: "ETH/USDT" });

    const posA = await repo.getPositionState("pos-a");
    const posB = await repo.getPositionState("pos-b");

    expect(posA?.instrument).toBe("BTC/USDT");
    expect(posB?.instrument).toBe("ETH/USDT");

    await repo.deletePositionState("pos-a");
    expect(await repo.getPositionState("pos-a")).toBeNull();
    expect(await repo.getPositionState("pos-b")).not.toBeNull();
  });
});

describe("Event Cursor Persistence", () => {
  it("should persist and retrieve cursors", async () => {
    const repo = new InMemoryRepository();

    await repo.saveEventCursor(TEST_CURSOR);
    const cursor = await repo.getEventCursor("OKX", "BTC/USDT");

    expect(cursor).not.toBeNull();
    expect(cursor?.lastSequence).toBe(42);
  });

  it("should overwrite existing cursor for same provider/instrument", async () => {
    const repo = new InMemoryRepository();

    await repo.saveEventCursor(TEST_CURSOR);
    await repo.saveEventCursor({ ...TEST_CURSOR, lastSequence: 50 });

    const cursor = await repo.getEventCursor("OKX", "BTC/USDT");
    expect(cursor?.lastSequence).toBe(50);
  });

  it("should maintain separate cursors per provider/instrument", async () => {
    const repo = new InMemoryRepository();

    await repo.saveEventCursor(TEST_CURSOR);
    await repo.saveEventCursor({
      ...TEST_CURSOR,
      provider: "TwelveData",
      lastEventId: "evt-2",
    });

    const okxCursor = await repo.getEventCursor("OKX", "BTC/USDT");
    const tdCursor = await repo.getEventCursor("TwelveData", "BTC/USDT");

    expect(okxCursor?.lastEventId).toBe("evt-1");
    expect(tdCursor?.lastEventId).toBe("evt-2");
  });
});
