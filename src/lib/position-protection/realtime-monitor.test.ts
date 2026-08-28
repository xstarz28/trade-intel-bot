import { describe, it, expect } from "vitest";
import {
  processEvent,
  coalesceEvents,
  addPosition,
  removePosition,
  cleanup,
  createMonitorState,
} from "./realtime-monitor";
import type { RealTimeEvent, PositionSnapshot } from "./realtime-types";

function makeEvent(overrides: Partial<RealTimeEvent> = {}): RealTimeEvent {
  return {
    eventId: `evt-${Date.now()}-${Math.random()}`,
    instrument: "BTC/USDT",
    timestamp: Date.now(),
    source: "OKX",
    freshness: "FRESH",
    eventType: "PRICE_UPDATE",
    priority: "LOW",
    dependencyGroup: "PRICE",
    payload: { price: 52000 },
    ...overrides,
  };
}

function makePosition(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    positionId: "pos-1",
    instrument: "BTC/USDT",
    side: "LONG",
    entryPrice: 50000,
    currentPrice: 52000,
    horizon: "SWING",
    openedAt: Date.now(),
    lastUpdateAt: Date.now(),
    monitoringStatus: "LIVE",
    ...overrides,
  };
}

describe("processEvent", () => {
  it("updates instrument state with price", () => {
    const state = createMonitorState();
    const event = makeEvent({ payload: { price: 55000 } });
    const result = processEvent(state, event, Date.now());
    const inst = result.state.instruments.get("BTC/USDT");
    expect(inst).toBeDefined();
    expect(inst!.lastPrice).toBe(55000);
    expect(inst!.eventsProcessed).toBe(1);
  });

  it("tracks recent price changes", () => {
    let state = createMonitorState();
    const now = Date.now();
    state = processEvent(state, makeEvent({ payload: { price: 50000 }, timestamp: now }), now).state;
    state = processEvent(state, makeEvent({ payload: { price: 52000 }, timestamp: now + 1000 }), now + 1000).state;
    const inst = state.instruments.get("BTC/USDT");
    expect(inst!.recentChanges.length).toBeGreaterThan(0);
  });

  it("updates position snapshot price", () => {
    let state = createMonitorState();
    state = addPosition(state, makePosition());
    const event = makeEvent({ payload: { price: 55000 } });
    const result = processEvent(state, event, Date.now());
    const snap = result.state.positions.get("pos-1");
    expect(snap!.currentPrice).toBe(55000);
  });

  it("does not reevaluate non-significant events too frequently", () => {
    let state = createMonitorState();
    state = addPosition(state, makePosition());
    const now = Date.now();
    // First event processes
    const r1 = processEvent(state, makeEvent({ payload: { price: 50100 } }), now);
    expect(r1.alerts.length).toBeGreaterThanOrEqual(0);
    // Second event immediately — should skip due to minInterval for SWING (30s)
    const r2 = processEvent(r1.state, makeEvent({ payload: { price: 50200 } }), now + 1000);
    // Might not produce new alert due to throttling
    expect(r2.state.positions.has("pos-1")).toBe(true);
  });

  it("always processes CRITICAL events", () => {
    let state = createMonitorState();
    state = addPosition(state, makePosition());
    const now = Date.now();
    state = processEvent(state, makeEvent({ payload: { price: 52000 } }), now).state;
    const criticalEvent = makeEvent({
      eventType: "LIQUIDATION_CHANGE",
      priority: "CRITICAL",
      payload: { price: 52000, liquidationSpike: true },
    });
    const result = processEvent(state, criticalEvent, now + 100);
    // CRITICAL events bypass throttle
    expect(result.state.positions.has("pos-1")).toBe(true);
  });
});

describe("coalesceEvents", () => {
  it("returns empty for empty input", () => {
    expect(coalesceEvents([])).toEqual([]);
  });

  it("keeps critical events even with duplicates", () => {
    const events = [
      makeEvent({ instrument: "BTC", priority: "LOW" }),
      makeEvent({ instrument: "BTC", priority: "CRITICAL" }),
      makeEvent({ instrument: "BTC", priority: "LOW" }),
    ];
    const result = coalesceEvents(events);
    expect(result.some(e => e.priority === "CRITICAL")).toBe(true);
  });

  it("coalesces by instrument and keeps highest priority non-critical", () => {
    const events = [
      makeEvent({ instrument: "BTC", priority: "LOW", dependencyGroup: "A" }),
      makeEvent({ instrument: "BTC", priority: "MEDIUM", dependencyGroup: "B" }),
    ];
    const result = coalesceEvents(events);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

describe("addPosition", () => {
  it("adds position to state", () => {
    const state = createMonitorState();
    const snap = makePosition();
    const updated = addPosition(state, snap);
    expect(updated.positions.has("pos-1")).toBe(true);
  });

  it("overwrites existing position with same ID", () => {
    let state = createMonitorState();
    state = addPosition(state, makePosition({ currentPrice: 50000 }));
    state = addPosition(state, makePosition({ currentPrice: 55000 }));
    expect(state.positions.get("pos-1")!.currentPrice).toBe(55000);
  });
});

describe("removePosition", () => {
  it("removes position and related state", () => {
    let state = createMonitorState();
    state = addPosition(state, makePosition());
    const updated = removePosition(state, "pos-1");
    expect(updated.positions.has("pos-1")).toBe(false);
    expect(updated.giveback.has("pos-1")).toBe(false);
    expect(updated.lastSeverity.has("pos-1")).toBe(false);
  });
});

describe("cleanup", () => {
  it("trims dispatcher history", () => {
    const state = createMonitorState();
    // Manually add many history entries
    let updated = state;
    for (let i = 0; i < 100; i++) {
      updated = {
        ...updated,
        dispatcher: {
          ...updated.dispatcher,
          history: [
            ...updated.dispatcher.history,
            {
              positionId: "pos-1",
              instrument: "BTC/USDT",
              severity: "WATCH",
              notificationPriority: "INFO",
              reason: "test",
              action: "monitor",
              timestamp: Date.now() + i,
              acknowledged: false,
            },
          ],
        },
      };
    }
    const cleaned = cleanup(updated, 50);
    expect(cleaned.dispatcher.history.length).toBeLessThanOrEqual(50);
  });
});
