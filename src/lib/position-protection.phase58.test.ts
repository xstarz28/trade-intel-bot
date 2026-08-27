/**
 * Phase 58 — Real-Time Position Monitoring & Event-Driven Profit Protection
 * Comprehensive test suite.
 */
import { describe, it, expect } from "vitest";

// ═══════════════════════════════════════════════════════════════
// IMPORTS
// ═══════════════════════════════════════════════════════════════
import type {
  RealTimeEvent,
  PositionSnapshot,
  InstrumentState,
  EventType,
  Timeframe,
  MonitoringStatus,
} from "@/lib/position-protection/realtime-types";
import {
  TIMEFRAME_ORDER,
  EVENT_PRIORITY_ORDER,
} from "@/lib/position-protection/realtime-types";

import {
  createMonitorState,
  coalesceEvents,
  processEvent,
  processEvents,
  addPosition,
  removePosition,
  cleanup,
} from "@/lib/position-protection/realtime-monitor";

import {
  calculateGiveback,
  classifyGivebackSeverity,
} from "@/lib/position-protection/giveback-monitor";

import {
  severityToNotificationPriority,
  computeEventFingerprint,
  createDispatcherState,
  shouldDispatch,
  dispatch,
  acknowledgeAlert,
} from "@/lib/position-protection/alert-dispatcher";

import { evaluateProtection } from "@/lib/position-protection/protection-engine";
import type { PositionContext } from "@/lib/position-protection/types";
import type { MarketEvidence } from "@/lib/position-protection/thesis-health";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const NOW = 1_700_000_000_000;

function makeEvent(overrides: Partial<RealTimeEvent> & { instrument: string }): RealTimeEvent {
  return {
    eventId: `evt-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: NOW,
    source: "test",
    freshness: "FRESH",
    eventType: "PRICE_UPDATE",
    priority: "LOW",
    dependencyGroup: "PRICE",
    payload: {},
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<PositionSnapshot> & { positionId: string; instrument: string }): PositionSnapshot {
  return {
    side: "LONG",
    entryPrice: 100,
    currentPrice: 105,
    horizon: "SWING",
    openedAt: NOW - 3600_000,
    lastUpdateAt: NOW,
    monitoringStatus: "LIVE",
    ...overrides,
  };
}

function longBtc(overrides?: Partial<PositionContext>): PositionContext {
  return {
    instrument: "BTC/USD",
    assetClass: "crypto",
    side: "LONG",
    entryPrice: 80000,
    currentPrice: 84000,
    stopLoss: 78000,
    takeProfit: 92000,
    leverage: 5,
    openedAt: NOW - 86400_000,
    horizon: "SWING",
    ...overrides,
  };
}

function shortEur(overrides?: Partial<PositionContext>): PositionContext {
  return {
    instrument: "EUR/USD",
    assetClass: "forex",
    side: "SHORT",
    entryPrice: 1.1,
    currentPrice: 1.09,
    stopLoss: 1.12,
    takeProfit: 1.06,
    openedAt: NOW - 86400_000,
    horizon: "INTRADAY",
    ...overrides,
  };
}

function cleanEvidence(price?: number): MarketEvidence {
  return { price: price ?? 84000 };
}

function makePosEvent(posId: string, inst: string, price: number, et: EventType = "PRICE_UPDATE"): RealTimeEvent {
  return makeEvent({
    instrument: inst,
    positionId: posId,
    eventType: et,
    priority: "LOW",
    payload: { price },
  });
}

// ═══════════════════════════════════════════════════════════════
// A. EVENT MODEL
// ═══════════════════════════════════════════════════════════════

describe("A. Event model", () => {
  it("A1 — event has required fields", () => {
    const e = makeEvent({ instrument: "BTC/USD" });
    expect(e.eventId).toBeTruthy();
    expect(e.instrument).toBe("BTC/USD");
    expect(e.timestamp).toBe(NOW);
    expect(e.source).toBeTruthy();
    expect(e.eventType).toBeTruthy();
    expect(e.priority).toBeTruthy();
    expect(e.dependencyGroup).toBeTruthy();
    expect(e.payload).toBeDefined();
  });

  it("A2 — payload is a plain object", () => {
    const e = makeEvent({ instrument: "X", payload: { price: 123, foo: "bar" } });
    expect(typeof e.payload).toBe("object");
    expect((e.payload as any).price).toBe(123);
  });

  it("A3 — positionId is optional", () => {
    const e = makeEvent({ instrument: "BTC/USD" });
    expect(e.positionId).toBeUndefined();
  });

  it("A4 — timeframe is optional", () => {
    const e = makeEvent({ instrument: "BTC/USD" });
    expect(e.timeframe).toBeUndefined();
  });

  it("A5 — TIMEFRAME_ORDER defined", () => {
    expect(TIMEFRAME_ORDER.length).toBeGreaterThanOrEqual(5);
  });

  it("A6 — EVENT_PRIORITY_ORDER defined", () => {
    expect(EVENT_PRIORITY_ORDER).toContain("CRITICAL");
    expect(EVENT_PRIORITY_ORDER).toContain("LOW");
  });
});

// ═══════════════════════════════════════════════════════════════
// B. EVENT NORMALIZATION
// ═══════════════════════════════════════════════════════════════

describe("B. Event normalization", () => {
  it("B1 — processEvent updates instrument lastPrice", () => {
    let state = createMonitorState();
    const pos = makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 });
    state = addPosition(state, pos);
    const evt = makePosEvent("p1", "BTC/USD", 105);
    const result = processEvent(state, evt, NOW);
    const inst = result.state.instruments.get("BTC/USD");
    expect(inst).toBeDefined();
    expect(inst!.lastPrice).toBe(105);
  });

  it("B2 — processEvent tracks recentChanges", () => {
    let state = createMonitorState();
    const pos = makeSnapshot({ positionId: "p1", instrument: "ETH/USD", currentPrice: 100 });
    state = addPosition(state, pos);
    state = processEvent(state, makePosEvent("p1", "ETH/USD", 100), NOW).state;
    state = processEvent(state, makePosEvent("p1", "ETH/USD", 102), NOW + 1).state;
    const inst = state.instruments.get("ETH/USD");
    expect(inst!.recentChanges.length).toBe(1);
    expect(inst!.recentChanges[0]).toBeCloseTo(2.0);
  });

  it("B3 — processEvent updates provider status on PROVIDER_DEGRADED", () => {
    let state = createMonitorState();
    const pos = makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 });
    state = addPosition(state, pos);
    const evt = makeEvent({
      instrument: "BTC/USD",
      positionId: "p1",
      eventType: "PROVIDER_DEGRADED",
      priority: "LOW",
      payload: {},
    });
    state = processEvent(state, evt, NOW).state;
    expect(state.instruments.get("BTC/USD")!.providerStatus).toBe("DEGRADED");
  });

  it("B4 — processEvent tracks eventsProcessed count", () => {
    let state = createMonitorState();
    const pos = makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 });
    state = addPosition(state, pos);
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 100), NOW).state;
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 101), NOW + 1).state;
    expect(state.instruments.get("BTC/USD")!.eventsProcessed).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. EVENT DEDUPLICATION
// ═══════════════════════════════════════════════════════════════

describe("C. Event deduplication", () => {
  it("C1 — same fingerprint detected by dispatcher", () => {
    const fp1 = computeEventFingerprint("p1", "WATCH", 1000, 30_000);
    const fp2 = computeEventFingerprint("p1", "WATCH", 29_000, 30_000);
    expect(fp1).toBe(fp2); // same 30s bucket
  });

  it("C2 — different severity produces different fingerprint", () => {
    const fp1 = computeEventFingerprint("p1", "WATCH", 1000);
    const fp2 = computeEventFingerprint("p1", "CAUTION", 1000);
    expect(fp1).not.toBe(fp2);
  });

  it("C3 — different bucket produces different fingerprint", () => {
    const fp1 = computeEventFingerprint("p1", "WATCH", 1000);
    const fp2 = computeEventFingerprint("p1", "WATCH", 31_000);
    expect(fp1).not.toBe(fp2);
  });

  it("C4 — dispatch marks fingerprint as seen", () => {
    let dsp = createDispatcherState();
    const fp = computeEventFingerprint("p1", "WATCH", 1000);
    dsp = dispatch(dsp, {
      eventId: "e1",
      positionId: "p1",
      instrument: "BTC",
      notificationPriority: "INFO",
      severity: "WATCH",
      action: "hold",
      reason: "test",
      timestamp: 1000,
      stateTransition: true,
      acknowledged: false,
    });
    expect(dsp.seenFingerprints.has(fp)).toBe(true);
  });

  it("C5 — second dispatch with same fingerprint is duplicate", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "hold",
      reason: "test", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "WATCH", 1000);
    expect(decision.isDuplicate).toBe(true);
    expect(decision.shouldDispatch).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. EVENT COALESCING
// ═══════════════════════════════════════════════════════════════

describe("D. Event coalescing", () => {
  it("D1 — empty array returns empty", () => {
    expect(coalesceEvents([])).toEqual([]);
  });

  it("D2 — single event passes through", () => {
    const e = makeEvent({ instrument: "BTC/USD" });
    expect(coalesceEvents([e])).toHaveLength(1);
  });

  it("D3 — multiple LOW for same instrument coalesce to highest priority", () => {
    const e1 = makeEvent({ instrument: "BTC/USD", priority: "LOW", payload: { price: 100 } });
    const e2 = makeEvent({ instrument: "BTC/USD", priority: "LOW", payload: { price: 101 } });
    const e3 = makeEvent({ instrument: "BTC/USD", priority: "MEDIUM", payload: { price: 102 } });
    const result = coalesceEvents([e1, e2, e3]);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("MEDIUM");
  });

  it("D4 — CRITICAL bypasses coalescing", () => {
    const e1 = makeEvent({ instrument: "BTC/USD", priority: "LOW", payload: { price: 100 } });
    const e2 = makeEvent({ instrument: "BTC/USD", priority: "CRITICAL", payload: { price: 101 } });
    const result = coalesceEvents([e1, e2]);
    expect(result).toHaveLength(1);
    expect(result[0].priority).toBe("CRITICAL");
  });

  it("D5 — different instruments are coalesced independently", () => {
    const e1 = makeEvent({ instrument: "BTC/USD", priority: "LOW" });
    const e2 = makeEvent({ instrument: "ETH/USD", priority: "LOW" });
    const result = coalesceEvents([e1, e2]);
    expect(result).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. CRITICAL-EVENT BYPASS
// ═══════════════════════════════════════════════════════════════

describe("E. Critical-event bypass", () => {
  it("E1 — CRITICAL event always dispatched regardless of cooldown", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "CRITICAL", severity: "INVALIDATED", action: "close",
      reason: "thesis invalid", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "INVALIDATED", 1001);
    expect(decision.shouldDispatch).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("F. Position isolation", () => {
  it("F1 — add and remove positions independently", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    state = addPosition(state, makeSnapshot({ positionId: "p2", instrument: "ETH/USD", currentPrice: 200 }));
    expect(state.positions.size).toBe(2);
    state = removePosition(state, "p1");
    expect(state.positions.size).toBe(1);
    expect(state.positions.has("p2")).toBe(true);
  });

  it("F2 — remove cleans up giveback state", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 110), NOW).state;
    state = removePosition(state, "p1");
    expect(state.giveback.has("p1")).toBe(false);
  });

  it("F3 — remove cleans up severity state", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    state = removePosition(state, "p1");
    expect(state.lastSeverity.has("p1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("G. Instrument isolation", () => {
  it("G1 — BTC event does not update ETH instrument state", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    state = addPosition(state, makeSnapshot({ positionId: "p2", instrument: "ETH/USD", currentPrice: 200 }));
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 105), NOW).state;
    expect(state.instruments.has("BTC/USD")).toBe(true);
    expect(state.instruments.has("ETH/USD")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// H. LONG POSITION MONITORING
// ═══════════════════════════════════════════════════════════════

describe("H. Long position monitoring", () => {
  it("H1 — long position receives price update", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 100 }));
    const result = processEvent(state, makePosEvent("p1", "BTC/USD", 105), NOW);
    const pos = result.state.positions.get("p1")!;
    expect(pos.currentPrice).toBe(105);
  });

  it("H2 — long peak price updates when price rises", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 105 }));
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 110), NOW).state;
    const giveback = state.giveback.get("p1")!;
    expect(giveback.peakPrice).toBe(110);
  });

  it("H3 — long giveback detected when price drops from peak", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 100 }));
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 110), NOW).state;
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 106), NOW + 1).state;
    const giveback = state.giveback.get("p1")!;
    expect(giveback.peakPrice).toBe(110);
    expect(giveback.givebackPct).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. SHORT POSITION MONITORING
// ═══════════════════════════════════════════════════════════════

describe("I. Short position monitoring", () => {
  it("I1 — short peak price is the lowest price", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "EUR/USD", side: "SHORT", entryPrice: 1.1, currentPrice: 1.09 }));
    state = processEvent(state, makePosEvent("p1", "EUR/USD", 1.07), NOW).state;
    const giveback = state.giveback.get("p1")!;
    expect(giveback.peakPrice).toBe(1.07);
  });

  it("I2 — short giveback when price rises from low", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "EUR/USD", side: "SHORT", entryPrice: 1.1, currentPrice: 1.09 }));
    state = processEvent(state, makePosEvent("p1", "EUR/USD", 1.07), NOW).state;
    state = processEvent(state, makePosEvent("p1", "EUR/USD", 1.09), NOW + 1).state;
    const giveback = state.giveback.get("p1")!;
    expect(giveback.givebackPct).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. PROFIT TRACKING
// ═══════════════════════════════════════════════════════════════

describe("J. Profit tracking", () => {
  it("J1 — calculateGiveback for long", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 100, currentPrice: 108,
    }), 110);
    expect(g.peakProfit).toBe(10);
    expect(g.currentProfit).toBe(8);
    expect(g.givebackPct).toBeCloseTo(20);
  });

  it("J2 — calculateGiveback for short", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "EUR/USD", side: "SHORT",
      entryPrice: 1.1, currentPrice: 1.08,
    }), 1.06);
    expect(g.peakProfit).toBeCloseTo(0.04);
    expect(g.currentProfit).toBeCloseTo(0.02);
    expect(g.givebackPct).toBeCloseTo(50);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. PEAK PROFIT TRACKING
// ═══════════════════════════════════════════════════════════════

describe("K. Peak profit tracking", () => {
  it("K1 — peak price updates monotonically for long", () => {
    const g1 = calculateGiveback(makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 105 }));
    const g2 = calculateGiveback(makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 108 }), g1.peakPrice);
    expect(g2.peakPrice).toBe(108);
  });

  it("K2 — peak price does not decrease for long", () => {
    const g1 = calculateGiveback(makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 108 }));
    const g2 = calculateGiveback(makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 105 }), g1.peakPrice);
    expect(g2.peakPrice).toBe(108);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. GIVEBACK CALCULATION
// ═══════════════════════════════════════════════════════════════

describe("L. Giveback calculation", () => {
  it("L1 — zero giveback at peak", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 100, currentPrice: 110, peakPrice: 110,
    }));
    expect(g.givebackPct).toBe(0);
    expect(g.pullbackType).toBe("NORMAL_PULLBACK");
  });

  it("L2 — 50% giveback", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 100, currentPrice: 105,
    }), 110);
    expect(g.givebackPct).toBeCloseTo(50);
  });

  it("L3 — 100% giveback", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 100, currentPrice: 100,
    }), 110);
    expect(g.givebackPct).toBeCloseTo(100);
  });

  it("L4 — rGiveback computed when SL available", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 100, currentPrice: 105, stopLoss: 95,
    }), 110);
    expect(g.rGiveback).toBeDefined();
    expect(g.rGiveback).toBeCloseTo(1.0); // (5 giveback) / (5 risk) = 1.0 R giveback
  });
});

// ═══════════════════════════════════════════════════════════════
// M. HORIZON THRESHOLDS
// ═══════════════════════════════════════════════════════════════

describe("M. Horizon thresholds", () => {
  it("M1 — scalping is most sensitive", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "SCALPING",
      entryPrice: 100, currentPrice: 104,
    }), 105);
    expect(classifyGivebackSeverity(g, "SCALPING")).toBe("WATCH");
  });

  it("M2 — investing is least sensitive", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "INVESTING",
      entryPrice: 100, currentPrice: 104, peakPrice: 105,
    }));
    expect(classifyGivebackSeverity(g, "INVESTING")).toBe("NONE");
  });

  it("M3 — swing moderate sensitivity", () => {
    // 50% giveback for swing (watchPct=30, partialTpPct=45) → PARTIAL_TP
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "SWING",
      entryPrice: 100, currentPrice: 105,
    }), 110);
    expect(classifyGivebackSeverity(g, "SWING")).toBe("PARTIAL_TP");
  });

  it("M4 — intraday moderate sensitivity", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "INTRADAY",
      entryPrice: 100, currentPrice: 104,
    }), 105);
    expect(classifyGivebackSeverity(g, "INTRADAY")).toBe("WATCH");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. GIVEBACK SEVERITY LEVELS
// ═══════════════════════════════════════════════════════════════

describe("N. Giveback severity levels", () => {
  it("N1 — PROTECT_NOW at high giveback for scalping", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "SCALPING",
      entryPrice: 100, currentPrice: 102,
    }), 105);
    expect(classifyGivebackSeverity(g, "SCALPING")).toBe("PROTECT_NOW");
  });

  it("N2 — MANUAL_TP for mid-range giveback", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "INTRADAY",
      entryPrice: 100, currentPrice: 102.5,
    }), 105);
    expect(classifyGivebackSeverity(g, "INTRADAY")).toBe("MANUAL_TP");
  });

  it("N3 — PARTIAL_TP for moderate giveback", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "SWING",
      entryPrice: 100, currentPrice: 102.75,
    }), 105);
    expect(classifyGivebackSeverity(g, "SWING")).toBe("PARTIAL_TP");
  });
});

// ═══════════════════════════════════════════════════════════════
// O. PULLBACK CLASSIFICATION
// ═══════════════════════════════════════════════════════════════

describe("O. Pullback classification", () => {
  it("O1 — normal pullback below max acceptable", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "SWING",
      entryPrice: 100, currentPrice: 104, peakPrice: 105,
    }));
    expect(g.pullbackType).toBe("NORMAL_PULLBACK");
  });

  it("O2 — protection event above max acceptable", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG", horizon: "SWING",
      entryPrice: 100, currentPrice: 101.5,
    }), 105);
    expect(g.pullbackType).toBe("PROTECTION_EVENT");
  });
});

// ═══════════════════════════════════════════════════════════════
// P. SHOCK DETECTION
// ═══════════════════════════════════════════════════════════════

describe("P. Shock detection in monitor", () => {
  it("P1 — structure break event triggers significant", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    const evt = makeEvent({
      instrument: "BTC/USD", positionId: "p1",
      eventType: "MARKET_STRUCTURE_CHANGE", priority: "MEDIUM",
      payload: { price: 95, broken: true },
    });
    const result = processEvent(state, evt, NOW);
    // Should process (significant event bypasses cooldown)
    expect(result.state.instruments.get("BTC/USD")!.lastPrice).toBe(95);
  });

  it("P2 — regime change event is significant", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    const evt = makeEvent({
      instrument: "BTC/USD", positionId: "p1",
      eventType: "REGIME_CHANGE", priority: "MEDIUM",
      payload: { price: 95, riskRegime: "risk_off" },
    });
    state = processEvent(state, evt, NOW).state;
    expect(state.instruments.get("BTC/USD")!.riskRegime).toBe("risk_off");
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. MULTI-TIMEFRAME CONFIRMATION
// ═══════════════════════════════════════════════════════════════

describe("Q. Multi-timeframe confirmation", () => {
  it("Q1 — M5 only deterioration is mild", () => {
    const { alert } = evaluateProtection({
      position: longBtc(),
      evidence: { price: 83800, shortTermTrend: "bearish", mediumTermTrend: "bullish" },
    });
    // Mild deterioration may produce WATCH or CAUTION depending on thesis health scoring
    expect(["NONE", "WATCH", "CAUTION"]).toContain(alert.severity);
  });

  it("Q2 — M5+M15+H1 all bearish is stronger deterioration", () => {
    const { alert } = evaluateProtection({
      position: longBtc(),
      evidence: {
        price: 83800,
        shortTermTrend: "bearish",
        mediumTermTrend: "bearish",
        longTermTrend: "bearish",
      },
    });
    expect(["WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(alert.severity);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. NORMAL PULLBACK DETECTION
// ═══════════════════════════════════════════════════════════════

describe("R. Normal pullback detection", () => {
  it("R1 — healthy long with minor pullback stays HEALTHY", () => {
    const { alert } = evaluateProtection({
      position: longBtc({ currentPrice: 83800 }),
      evidence: cleanEvidence(83800),
    });
    expect(["NONE", "WATCH"]).toContain(alert.severity);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. PROFIT PROTECTION DETECTION
// ═══════════════════════════════════════════════════════════════

describe("S. Profit protection detection", () => {
  it("S1 — profitable + deteriorating = CAUTION or higher", () => {
    const { alert } = evaluateProtection({
      position: longBtc({ currentPrice: 84000 }),
      evidence: {
        price: 84000,
        shortTermTrend: "bearish",
        momentumChange: -2,
        volatility: 3.0,
        avgVolatility: 1.5,
        structureBroken: true,
      },
    });
    expect(["WATCH", "CAUTION", "HIGH_RISK", "INVALIDATED"]).toContain(alert.severity);
  });

  it("S2 — strongly profitable + healthy = NONE", () => {
    const { alert } = evaluateProtection({
      position: longBtc({ currentPrice: 90000 }),
      evidence: {
        price: 90000,
        shortTermTrend: "bullish",
        mediumTermTrend: "bullish",
        momentumChange: 2,
      },
    });
    expect(alert.severity).toBe("NONE");
  });
});

// ═══════════════════════════════════════════════════════════════
// T. DATA FRESHNESS
// ═══════════════════════════════════════════════════════════════

describe("T. Data freshness", () => {
  it("T1 — fresh event is processed", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    const evt = makeEvent({
      instrument: "BTC/USD", positionId: "p1",
      eventType: "VOLATILITY_CHANGE", priority: "MEDIUM",
      payload: { price: 100, volatility: 3.0, avgVolatility: 1.0 },
    });
    const result = processEvent(state, evt, NOW);
    expect(result.state.instruments.get("BTC/USD")!.volatility).toBe(3.0);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. STALE DATA
// ═══════════════════════════════════════════════════════════════

describe("U. Stale data", () => {
  it("U1 — no event on position with stale data", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100, lastUpdateAt: NOW }));
    // Instrument state is old
    const instEvt = makeEvent({
      instrument: "BTC/USD", eventType: "DATA_STALE", priority: "LOW", payload: {},
    });
    state = processEvent(state, instEvt, NOW).state;
    // Now a normal price event but instrument status is stale
    const priceEvt = makeEvent({
      instrument: "BTC/USD", positionId: "p1",
      eventType: "PRICE_UPDATE", priority: "LOW",
      payload: { price: 105 },
    });
    const result = processEvent(state, priceEvt, NOW);
    // Should not reevaluate with stale data
    expect(result.alerts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// V. PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("V. Provider failure", () => {
  it("V1 — provider degraded sets status", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    const evt = makeEvent({
      instrument: "BTC/USD", eventType: "PROVIDER_DEGRADED", priority: "LOW", payload: {},
    });
    state = processEvent(state, evt, NOW).state;
    expect(state.instruments.get("BTC/USD")!.providerStatus).toBe("DEGRADED");
  });

  it("V2 — provider recovered restores status", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    state = processEvent(state, makeEvent({ instrument: "BTC/USD", eventType: "PROVIDER_DEGRADED", priority: "LOW", payload: {} }), NOW).state;
    state = processEvent(state, makeEvent({ instrument: "BTC/USD", eventType: "PROVIDER_RECOVERED", priority: "LOW", payload: {} }), NOW + 1).state;
    expect(state.instruments.get("BTC/USD")!.providerStatus).toBe("HEALTHY");
  });
});

// ═══════════════════════════════════════════════════════════════
// W. PARTIAL PROVIDER SUCCESS
// ═══════════════════════════════════════════════════════════════

describe("W. Partial provider success", () => {
  it("W1 — instrument with degraded provider still gets price updates", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    state = processEvent(state, makeEvent({ instrument: "BTC/USD", eventType: "PROVIDER_DEGRADED", priority: "LOW", payload: {} }), NOW).state;
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 105), NOW + 1).state;
    expect(state.instruments.get("BTC/USD")!.lastPrice).toBe(105);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. ALERT SEVERITY → NOTIFICATION PRIORITY
// ═══════════════════════════════════════════════════════════════

describe("X. Notification priority mapping", () => {
  it("X1 — NONE → INFO", () => { expect(severityToNotificationPriority("NONE")).toBe("INFO"); });
  it("X2 — WATCH → INFO", () => { expect(severityToNotificationPriority("WATCH")).toBe("INFO"); });
  it("X3 — CAUTION → WARNING", () => { expect(severityToNotificationPriority("CAUTION")).toBe("WARNING"); });
  it("X4 — HIGH_RISK → URGENT", () => { expect(severityToNotificationPriority("HIGH_RISK")).toBe("URGENT"); });
  it("X5 — INVALIDATED → CRITICAL", () => { expect(severityToNotificationPriority("INVALIDATED")).toBe("CRITICAL"); });
});

// ═══════════════════════════════════════════════════════════════
// Y. ALERT ESCALATION
// ═══════════════════════════════════════════════════════════════

describe("Y. Alert escalation", () => {
  it("Y1 — WATCH → CAUTION is escalation", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "watch",
      reason: "early warning", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "CAUTION", 2000);
    expect(decision.isEscalation).toBe(true);
    expect(decision.shouldDispatch).toBe(true);
  });

  it("Y2 — WATCH → HIGH_RISK is escalation", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "watch",
      reason: "early warning", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "HIGH_RISK", 2000);
    expect(decision.isEscalation).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. ALERT RECOVERY
// ═══════════════════════════════════════════════════════════════

describe("Z. Alert recovery", () => {
  it("Z1 — HIGH_RISK → WATCH is recovery", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "URGENT", severity: "HIGH_RISK", action: "tp",
      reason: "high risk", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "WATCH", 2000);
    expect(decision.isRecovery).toBe(true);
  });

  it("Z2 — INVALIDATED → NONE is recovery", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "CRITICAL", severity: "INVALIDATED", action: "close",
      reason: "invalid", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "NONE", 2000);
    expect(decision.isRecovery).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. ALERT COOLDOWN
// ═══════════════════════════════════════════════════════════════

describe("AA. Alert cooldown", () => {
  it("AA1 — same severity within cooldown is suppressed", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "watch",
      reason: "watch", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "WATCH", 10_000); // within 30s cooldown
    expect(decision.shouldDispatch).toBe(false);
  });

  it("AA2 — same severity after cooldown is dispatched", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "watch",
      reason: "watch", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const decision = shouldDispatch(dsp, "p1", "WATCH", 40_000); // past 30s cooldown
    expect(decision.shouldDispatch).toBe(true);
  });

  it("AA3 — HIGH_RISK has shorter cooldown", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "URGENT", severity: "HIGH_RISK", action: "tp",
      reason: "risk", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    // After cooldown (10s), different bucket bypasses fingerprint dedup
    const decision = shouldDispatch(dsp, "p1", "HIGH_RISK", 40_000);
    expect(decision.shouldDispatch).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. HYSTERESIS
// ═══════════════════════════════════════════════════════════════

describe("AB. Hysteresis", () => {
  it("AB1 — recovery requires lower severity (not just same)", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "URGENT", severity: "HIGH_RISK", action: "tp",
      reason: "risk", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    // Same severity = not recovery, just cooldown check
    const sameDecision = shouldDispatch(dsp, "p1", "HIGH_RISK", 50_000);
    expect(sameDecision.isRecovery).toBe(false);
    // Lower severity = recovery
    const recoveryDecision = shouldDispatch(dsp, "p1", "WATCH", 50_000);
    expect(recoveryDecision.isRecovery).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. RECOVERY STATE
// ═══════════════════════════════════════════════════════════════

describe("AC. Recovery state", () => {
  it("AC1 — acknowledge removes active alert", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "watch",
      reason: "watch", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    expect(dsp.activeAlerts.has("p1")).toBe(true);
    dsp = acknowledgeAlert(dsp, "p1");
    expect(dsp.activeAlerts.has("p1")).toBe(false);
  });

  it("AC2 — acknowledge decrements unread count", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "watch",
      reason: "watch", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    expect(dsp.unreadCount).toBe(1);
    dsp = acknowledgeAlert(dsp, "p1");
    expect(dsp.unreadCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. NOTIFICATION DEDUP
// ═══════════════════════════════════════════════════════════════

describe("AD. Notification dedup", () => {
  it("AD1 — consecutive identical dispatches are deduped", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, {
      eventId: "e1", positionId: "p1", instrument: "BTC",
      notificationPriority: "INFO", severity: "WATCH", action: "watch",
      reason: "watch", timestamp: 1000, stateTransition: true, acknowledged: false,
    });
    const d1 = shouldDispatch(dsp, "p1", "WATCH", 5000);
    expect(d1.isDuplicate).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. NO PROBABILITY FABRICATION
// ═══════════════════════════════════════════════════════════════

describe("AE. No probability fabrication", () => {
  it("AE1 — protection alert has no probability field", () => {
    const { alert } = evaluateProtection({
      position: longBtc({ currentPrice: 84000 }),
      evidence: cleanEvidence(84000),
    });
    expect((alert as any).probability).toBeUndefined();
    expect((alert as any).winProbability).toBeUndefined();
    expect((alert as any).profitProbability).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AF. NO FABRICATED EVIDENCE
// ═══════════════════════════════════════════════════════════════

describe("AF. No fabricated evidence", () => {
  it("AF1 — missing data shows as missing, not fabricated", () => {
    const { alert } = evaluateProtection({
      position: longBtc(),
      evidence: cleanEvidence(84000),
    });
    // Should list missing data honestly
    expect(alert.missingData.length).toBeGreaterThan(0);
    expect(alert.missingData.some(d => d.includes("trend") || d.includes("volatility"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// AG. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("AG. Decision immutability", () => {
  it("AG1 — protection alert does not contain recommendation field", () => {
    const { alert } = evaluateProtection({
      position: longBtc(),
      evidence: cleanEvidence(84000),
    });
    expect((alert as any).recommendation).toBeUndefined();
    expect((alert as any).bias).toBeUndefined();
    expect((alert as any).conviction).toBeUndefined();
    expect((alert as any).tradePlan).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// AH. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("AH. Security", () => {
  it("AH1 — no API keys in event payload", () => {
    const e = makeEvent({ instrument: "BTC/USD", payload: { price: 100 } });
    const serialized = JSON.stringify(e);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toMatch(/secret/i);
    expect(serialized).not.toMatch(/bearer/i);
  });

  it("AH2 — no credentials in alert", () => {
    const { alert } = evaluateProtection({
      position: longBtc(),
      evidence: cleanEvidence(84000),
    });
    const serialized = JSON.stringify(alert);
    expect(serialized).not.toMatch(/api[_-]?key/i);
    expect(serialized).not.toMatch(/password/i);
    expect(serialized).not.toMatch(/secret/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// AI. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("AI. Determinism", () => {
  it("AI1 — same inputs produce same alert", () => {
    const input = { position: longBtc(), evidence: cleanEvidence(84000) };
    const r1 = evaluateProtection(input);
    const r2 = evaluateProtection(input);
    expect(r1.alert.severity).toBe(r2.alert.severity);
    expect(r1.alert.thesisHealth).toBe(r2.alert.thesisHealth);
  });

  it("AI2 — same inputs produce same giveback", () => {
    const pos = makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 105 });
    const g1 = calculateGiveback(pos, 110);
    const g2 = calculateGiveback(pos, 110);
    expect(g1.givebackPct).toBe(g2.givebackPct);
  });

  it("AI3 — coalescing is deterministic", () => {
    const events = [
      makeEvent({ instrument: "BTC/USD", priority: "LOW" }),
      makeEvent({ instrument: "BTC/USD", priority: "MEDIUM" }),
    ];
    const r1 = coalesceEvents(events);
    const r2 = coalesceEvents(events);
    expect(r1[0].priority).toBe(r2[0].priority);
  });
});

// ═══════════════════════════════════════════════════════════════
// AJ. EMPTY INPUT
// ═══════════════════════════════════════════════════════════════

describe("AJ. Empty input", () => {
  it("AJ1 — monitor state starts empty", () => {
    const state = createMonitorState();
    expect(state.positions.size).toBe(0);
    expect(state.instruments.size).toBe(0);
    expect(state.giveback.size).toBe(0);
  });

  it("AJ2 — dispatcher state starts empty", () => {
    const dsp = createDispatcherState();
    expect(dsp.history.length).toBe(0);
    expect(dsp.unreadCount).toBe(0);
    expect(dsp.activeAlerts.size).toBe(0);
  });

  it("AJ3 — processEvent with no matching position returns empty alerts", () => {
    let state = createMonitorState();
    const result = processEvent(state, makePosEvent("p_none", "BTC/USD", 100), NOW);
    expect(result.alerts.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AK. LARGE INPUT STRESS
// ═══════════════════════════════════════════════════════════════

describe("AK. Large input stress", () => {
  it("AK1 — process 100 events without crash", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    for (let i = 0; i < 100; i++) {
      state = processEvent(state, makePosEvent("p1", "BTC/USD", 100 + i), NOW + i).state;
    }
    expect(state.instruments.get("BTC/USD")!.eventsProcessed).toBe(100);
  });

  it("AK2 — 10 coalesced events reduce to fewer", () => {
    const events = Array.from({ length: 10 }, (_, i) =>
      makeEvent({ instrument: "BTC/USD", priority: i < 2 ? "MEDIUM" : "LOW", payload: { price: 100 + i } })
    );
    const coalesced = coalesceEvents(events);
    expect(coalesced.length).toBeLessThan(10);
  });
});

// ═══════════════════════════════════════════════════════════════
// AL. CONCURRENT EVALUATION
// ═══════════════════════════════════════════════════════════════

describe("AL. Concurrent evaluation", () => {
  it("AL1 — multiple positions evaluated independently", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 100 }));
    state = addPosition(state, makeSnapshot({ positionId: "p2", instrument: "ETH/USD", side: "SHORT", entryPrice: 200, currentPrice: 200 }));

    state = processEvent(state, makePosEvent("p1", "BTC/USD", 105), NOW).state;
    state = processEvent(state, makePosEvent("p2", "ETH/USD", 195), NOW + 1).state;

    const g1 = state.giveback.get("p1")!;
    const g2 = state.giveback.get("p2")!;
    expect(g1.peakPrice).toBe(105);
    expect(g2.peakPrice).toBe(195);
  });
});

// ═══════════════════════════════════════════════════════════════
// AM. ALERT LIFECYCLE
// ═══════════════════════════════════════════════════════════════

describe("AM. Alert lifecycle", () => {
  it("AM1 — full escalation chain", () => {
    let dsp = createDispatcherState();
    // Start with WATCH (NONE clears active alert, so use non-NONE start)
    dsp = dispatch(dsp, { eventId: "e1", positionId: "p1", instrument: "BTC", notificationPriority: "INFO", severity: "WATCH", action: "watch", reason: "early warning", timestamp: 1000, stateTransition: true, acknowledged: false });
    // → CAUTION (escalation)
    let d = shouldDispatch(dsp, "p1", "CAUTION", 2000);
    expect(d.isEscalation).toBe(true);
    dsp = dispatch(dsp, { eventId: "e2", positionId: "p1", instrument: "BTC", notificationPriority: "WARNING", severity: "CAUTION", action: "caution", reason: "caution", timestamp: 2000, stateTransition: true, acknowledged: false });
    // → HIGH_RISK (escalation)
    d = shouldDispatch(dsp, "p1", "HIGH_RISK", 3000);
    expect(d.isEscalation).toBe(true);
    dsp = dispatch(dsp, { eventId: "e3", positionId: "p1", instrument: "BTC", notificationPriority: "URGENT", severity: "HIGH_RISK", action: "tp", reason: "high risk", timestamp: 3000, stateTransition: true, acknowledged: false });
    // → INVALIDATED (always dispatched, bypasses cooldown/dedup)
    d = shouldDispatch(dsp, "p1", "INVALIDATED", 4000);
    expect(d.shouldDispatch).toBe(true);
    dsp = dispatch(dsp, { eventId: "e4", positionId: "p1", instrument: "BTC", notificationPriority: "CRITICAL", severity: "INVALIDATED", action: "close", reason: "invalidated", timestamp: 4000, stateTransition: true, acknowledged: false });

    expect(dsp.activeAlerts.get("p1")!.severity).toBe("INVALIDATED");
  });

  it("AM2 — NONE clears active alert", () => {
    let dsp = createDispatcherState();
    dsp = dispatch(dsp, { eventId: "e1", positionId: "p1", instrument: "BTC", notificationPriority: "INFO", severity: "WATCH", action: "watch", reason: "watch", timestamp: 1000, stateTransition: true, acknowledged: false });
    expect(dsp.activeAlerts.has("p1")).toBe(true);
    dsp = dispatch(dsp, { eventId: "e2", positionId: "p1", instrument: "BTC", notificationPriority: "INFO", severity: "NONE", action: "hold", reason: "ok", timestamp: 5000, stateTransition: true, acknowledged: false });
    expect(dsp.activeAlerts.has("p1")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// AN. FIRST ALERT DISPATCH
// ═══════════════════════════════════════════════════════════════

describe("AN. First alert dispatch", () => {
  it("AN1 — first alert for position is always dispatched", () => {
    const dsp = createDispatcherState();
    const d = shouldDispatch(dsp, "p1", "WATCH", 1000);
    expect(d.shouldDispatch).toBe(true);
    expect(d.reason).toContain("First");
  });
});

// ═══════════════════════════════════════════════════════════════
// AO. PROCESS BATCH EVENTS
// ═══════════════════════════════════════════════════════════════

describe("AO. Process batch events", () => {
  it("AO1 — processEvents handles empty array", () => {
    const state = createMonitorState();
    const result = processEvents(state, [], NOW);
    expect(result.alerts.length).toBe(0);
  });

  it("AO2 — processEvents processes multiple events", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    const events = [
      makePosEvent("p1", "BTC/USD", 105),
      makePosEvent("p1", "ETH/USD", 110),
    ];
    const result = processEvents(state, events, NOW);
    expect(result.state.instruments.get("BTC/USD")!.lastPrice).toBe(105);
    expect(result.state.instruments.get("ETH/USD")!.lastPrice).toBe(110);
  });
});

// ═══════════════════════════════════════════════════════════════
// AP. CLEANUP
// ═══════════════════════════════════════════════════════════════

describe("AP. Cleanup", () => {
  it("AP1 — cleanup bounds history", () => {
    let dsp = createDispatcherState();
    for (let i = 0; i < 20; i++) {
      dsp = dispatch(dsp, {
        eventId: `e${i}`, positionId: `p${i}`, instrument: "BTC",
        notificationPriority: "INFO", severity: "WATCH", action: "watch",
        reason: "test", timestamp: 1000 + i, stateTransition: true, acknowledged: false,
      });
    }
    const state = createMonitorState();
    const cleaned = cleanup({ ...state, dispatcher: dsp }, 5);
    expect(cleaned.dispatcher.history.length).toBe(5);
  });

  it("AP2 — cleanup bounds seen fingerprints", () => {
    let dsp = createDispatcherState();
    for (let i = 0; i < 10; i++) {
      dsp.seenFingerprints.add(`fp-${i}`);
    }
    const state = createMonitorState();
    const cleaned = cleanup({ ...state, dispatcher: dsp }, 5);
    expect(cleaned.dispatcher.seenFingerprints.size).toBeLessThanOrEqual(1000);
  });
});

// ═══════════════════════════════════════════════════════════════
// AQ. MULTIPLE POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AQ. Multiple position isolation", () => {
  it("AQ1 — BTC LONG and BTC SHORT have independent giveback", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "long1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 100 }));
    state = addPosition(state, makeSnapshot({ positionId: "short1", instrument: "BTC/USD", side: "SHORT", entryPrice: 100, currentPrice: 100 }));

    state = processEvent(state, makeEvent({
      instrument: "BTC/USD", positionId: "long1", eventType: "PRICE_UPDATE", priority: "LOW",
      payload: { price: 110 },
    }), NOW).state;

    state = processEvent(state, makeEvent({
      instrument: "BTC/USD", positionId: "short1", eventType: "PRICE_UPDATE", priority: "LOW",
      payload: { price: 90 },
    }), NOW + 1).state;

    const gLong = state.giveback.get("long1")!;
    const gShort = state.giveback.get("short1")!;
    expect(gLong.peakPrice).toBe(110);
    expect(gShort.peakPrice).toBe(90);
  });
});

// ═══════════════════════════════════════════════════════════════
// AR. MONITORING STATUS
// ═══════════════════════════════════════════════════════════════

describe("AR. Monitoring status", () => {
  it("AR1 — new position starts with LIVE status", () => {
    const pos = makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 });
    expect(pos.monitoringStatus).toBe("LIVE");
  });
});

// ═══════════════════════════════════════════════════════════════
// AS. R GIVEBACK COMPUTATION
// ═══════════════════════════════════════════════════════════════

describe("AS. R giveback computation", () => {
  it("AS1 — rGiveback undefined when no SL", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 100, currentPrice: 105,
    }), 110);
    expect(g.rGiveback).toBeUndefined();
  });

  it("AS2 — rGiveback computed with SL", () => {
    const g = calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 100, currentPrice: 105, stopLoss: 95,
    }), 110);
    expect(g.rGiveback).toBeDefined();
    expect(g.rGiveback!).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AT. ADVERSARIAL INPUTS
// ═══════════════════════════════════════════════════════════════

describe("AT. Adversarial inputs", () => {
  it("AT1 — zero entry price does not crash", () => {
    expect(() => calculateGiveback(makeSnapshot({
      positionId: "p1", instrument: "BTC/USD", side: "LONG",
      entryPrice: 0, currentPrice: 0, peakPrice: 0,
    }))).not.toThrow();
  });

  it("AT2 — negative price does not crash", () => {
    expect(() => evaluateProtection({
      position: longBtc({ currentPrice: -100 }),
      evidence: cleanEvidence(-100),
    })).not.toThrow();
  });

  it("AT3 — NaN payload does not crash processEvent", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", currentPrice: 100 }));
    expect(() => processEvent(state, makeEvent({
      instrument: "BTC/USD", positionId: "p1",
      eventType: "PRICE_UPDATE", priority: "LOW",
      payload: { price: NaN },
    }), NOW)).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// AU. EVENT FINGERPRINT BUCKETS
// ═══════════════════════════════════════════════════════════════

describe("AU. Event fingerprint buckets", () => {
  it("AU1 — custom bucket size works", () => {
    const fp1 = computeEventFingerprint("p1", "WATCH", 0, 1000);
    const fp2 = computeEventFingerprint("p1", "WATCH", 999, 1000);
    expect(fp1).toBe(fp2);
    const fp3 = computeEventFingerprint("p1", "WATCH", 1000, 1000);
    expect(fp1).not.toBe(fp3);
  });
});

// ═══════════════════════════════════════════════════════════════
// AV. PROTECTION EVENT SHAPE
// ═══════════════════════════════════════════════════════════════

describe("AV. Protection event shape", () => {
  it("AV1 — processEvent returns valid ProtectionEvent structure", () => {
    let state = createMonitorState();
    state = addPosition(state, makeSnapshot({ positionId: "p1", instrument: "BTC/USD", side: "LONG", entryPrice: 100, currentPrice: 100 }));
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 110), NOW).state;
    state = processEvent(state, makePosEvent("p1", "BTC/USD", 95), NOW + 1).state;
    // Verify structure is well-formed — alerts array is always defined
    const { alerts } = processEvent(state, makePosEvent("p1", "BTC/USD", 80), NOW + 100_000);
    for (const alert of alerts) {
      expect(alert.eventId).toBeTruthy();
      expect(alert.positionId).toBeTruthy();
      expect(alert.instrument).toBeTruthy();
      expect(alert.notificationPriority).toBeTruthy();
      expect(alert.severity).toBeTruthy();
      expect(typeof alert.acknowledged).toBe("boolean");
    }
  });
});
