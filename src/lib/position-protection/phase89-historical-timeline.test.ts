/**
 * Phase 89 — Historical Intelligence Timeline Tests
 *
 * Tests:
 * - Snapshot creation
 * - Change detection
 * - Event classification
 * - Timeline building
 * - Historical summary
 * - Current vs previous comparison
 * - Position isolation
 * - Bounded memory
 * - No probability claims
 * - No auto-execution
 * - Determinism
 */

import { describe, it, expect } from "vitest";
import {
  createSnapshot,
  detectChanges,
  buildTimeline,
  compareSnapshots,
  MAX_HISTORY_EVENTS,
  type IntelligenceSnapshot,
} from "./historical-intelligence";

const now = Date.now();

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function makeSnapshot(overrides: Partial<IntelligenceSnapshot> = {}): IntelligenceSnapshot {
  return createSnapshot({
    positionId: "pos-1",
    instrument: "BTC/USDT",
    side: "LONG",
    thesisState: "HEALTHY",
    evidenceQuality: "MODERATE_EVIDENCE",
    marketRegime: "TRENDING_UP",
    h1Trend: "BULLISH",
    m15Trend: "BULLISH",
    m5Trend: "BULLISH",
    mtfAlignment: "ALIGNED",
    momentum: "POSITIVE",
    volatility: "NORMAL",
    structure: "HIGHER_HIGHS_HIGHER_LOWS",
    supportingCount: 3,
    conflictingCount: 1,
    invalidationCondition: "Price below 70000",
    watchNext: "M5 momentum continuation",
    dataAvailability: "SUFFICIENT",
    timestamp: now,
    ...overrides,
  });
}

// ═══════════════════════════════════════════════════════════════
// A. SNAPSHOT CREATION
// ═══════════════════════════════════════════════════════════════

describe("A. Snapshot Creation", () => {
  it("creates valid snapshot with all fields", () => {
    const snap = makeSnapshot();
    expect(snap.positionId).toBe("pos-1");
    expect(snap.instrument).toBe("BTC/USDT");
    expect(snap.side).toBe("LONG");
    expect(snap.thesisState).toBe("HEALTHY");
    expect(snap.timestamp).toBeGreaterThan(0);
  });

  it("snapshot is deterministic", () => {
    const s1 = makeSnapshot();
    const s2 = makeSnapshot();
    expect(s1.thesisState).toBe(s2.thesisState);
    expect(s1.h1Trend).toBe(s2.h1Trend);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. CHANGE DETECTION
// ═══════════════════════════════════════════════════════════════

describe("B. Change Detection", () => {
  it("no previous → INITIAL_ANALYSIS", () => {
    const snap = makeSnapshot();
    const events = detectChanges(null, snap);
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("INITIAL_ANALYSIS");
  });

  it("same state → no events", () => {
    const prev = makeSnapshot({ timestamp: now - 60_000 });
    const curr = makeSnapshot();
    const events = detectChanges(prev, curr);
    expect(events.length).toBe(0);
  });

  it("thesis change detected", () => {
    const prev = makeSnapshot({ thesisState: "HEALTHY" });
    const curr = makeSnapshot({ thesisState: "CAUTION" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "THESIS_CHANGE")).toBe(true);
  });

  it("regime change detected", () => {
    const prev = makeSnapshot({ marketRegime: "TRENDING_UP" });
    const curr = makeSnapshot({ marketRegime: "PULLBACK" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "REGIME_CHANGE")).toBe(true);
  });

  it("H1 trend change detected", () => {
    const prev = makeSnapshot({ h1Trend: "BULLISH" });
    const curr = makeSnapshot({ h1Trend: "BEARISH" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "TIMEFRAME_CHANGE" && e.category === "H1")).toBe(true);
  });

  it("M15 trend change detected", () => {
    const prev = makeSnapshot({ m15Trend: "BULLISH" });
    const curr = makeSnapshot({ m15Trend: "BEARISH" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "TIMEFRAME_CHANGE" && e.category === "M15")).toBe(true);
  });

  it("M5 trend change detected", () => {
    const prev = makeSnapshot({ m5Trend: "BEARISH" });
    const curr = makeSnapshot({ m5Trend: "BULLISH" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "TIMEFRAME_CHANGE" && e.category === "M5")).toBe(true);
  });

  it("momentum change detected", () => {
    const prev = makeSnapshot({ momentum: "POSITIVE" });
    const curr = makeSnapshot({ momentum: "NEGATIVE" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "MOMENTUM_CHANGE")).toBe(true);
  });

  it("volatility change detected", () => {
    const prev = makeSnapshot({ volatility: "NORMAL" });
    const curr = makeSnapshot({ volatility: "EXPANDED" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "VOLATILITY_CHANGE")).toBe(true);
  });

  it("structure change detected", () => {
    const prev = makeSnapshot({ structure: "HIGHER_HIGHS_HIGHER_LOWS" });
    const curr = makeSnapshot({ structure: "LOWER_HIGHS_LOWER_LOWS" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "STRUCTURE_CHANGE")).toBe(true);
  });

  it("evidence quality change detected", () => {
    const prev = makeSnapshot({ evidenceQuality: "STRONG_EVIDENCE" });
    const curr = makeSnapshot({ evidenceQuality: "WEAK_EVIDENCE" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "EVIDENCE_CHANGE")).toBe(true);
  });

  it("significant evidence count change detected", () => {
    const prev = makeSnapshot({ supportingCount: 5, conflictingCount: 1 });
    const curr = makeSnapshot({ supportingCount: 2, conflictingCount: 4 });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "EVIDENCE_CHANGE")).toBe(true);
  });

  it("data quality change detected", () => {
    const prev = makeSnapshot({ dataAvailability: "SUFFICIENT" });
    const curr = makeSnapshot({ dataAvailability: "UNAVAILABLE" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "DATA_QUALITY_CHANGE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// C. TIMELINE BUILDING
// ═══════════════════════════════════════════════════════════════

describe("C. Timeline Building", () => {
  it("builds timeline from first snapshot", () => {
    const snap = makeSnapshot();
    const timeline = buildTimeline(null, snap);
    expect(timeline.positionId).toBe("pos-1");
    expect(timeline.events.length).toBe(1);
    expect(timeline.latestSnapshot).toBeTruthy();
    expect(timeline.summary).toBeTruthy();
  });

  it("accumulates events over time", () => {
    const snap1 = makeSnapshot({ thesisState: "HEALTHY" });
    let timeline = buildTimeline(null, snap1);

    const snap2 = makeSnapshot({ thesisState: "CAUTION", timestamp: now + 60_000 });
    timeline = buildTimeline(timeline, snap2);
    expect(timeline.events.length).toBe(2); // INITIAL + THESIS_CHANGE
  });

  it("detects multiple simultaneous changes", () => {
    const prev = makeSnapshot({
      thesisState: "HEALTHY",
      h1Trend: "BULLISH",
      marketRegime: "TRENDING_UP",
    });
    let timeline = buildTimeline(null, prev);

    const curr = makeSnapshot({
      thesisState: "CAUTION",
      h1Trend: "BEARISH",
      marketRegime: "PULLBACK",
    });
    timeline = buildTimeline(timeline, curr);

    const types = timeline.events.map(e => e.eventType);
    expect(types).toContain("THESIS_CHANGE");
    expect(types).toContain("TIMEFRAME_CHANGE");
    expect(types).toContain("REGIME_CHANGE");
  });
});

// ═══════════════════════════════════════════════════════════════
// D. COMPARISON
// ═══════════════════════════════════════════════════════════════

describe("D. Comparison", () => {
  it("detects changed fields", () => {
    const prev = makeSnapshot({ h1Trend: "BULLISH", m15Trend: "BULLISH" });
    const curr = makeSnapshot({ h1Trend: "BEARISH", m15Trend: "BULLISH" });
    const fields = compareSnapshots(prev, curr);
    expect(fields.length).toBeGreaterThan(0);
    const h1 = fields.find(f => f.label === "H1 Trend");
    expect(h1).toBeTruthy();
    expect(h1!.changed).toBe(true);
  });

  it("no previous → all changed", () => {
    const curr = makeSnapshot();
    const fields = compareSnapshots(null, curr);
    expect(fields.length).toBe(1);
    expect(fields[0].changed).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. HISTORICAL SUMMARY
// ═══════════════════════════════════════════════════════════════

describe("E. Historical Summary", () => {
  it("generates summary with interpretation", () => {
    const snap1 = makeSnapshot({ thesisState: "HEALTHY", h1Trend: "BULLISH" });
    let timeline = buildTimeline(null, snap1);
    const snap2 = makeSnapshot({ thesisState: "CAUTION", h1Trend: "BEARISH" });
    timeline = buildTimeline(timeline, snap2);
    expect(timeline.summary).toBeTruthy();
    expect(timeline.summary!.currentThesis).toBe("CAUTION");
    expect(timeline.summary!.previousThesis).toBe("HEALTHY");
    expect(timeline.summary!.interpretation.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. BOUNDED MEMORY
// ═══════════════════════════════════════════════════════════════

describe("F. Bounded Memory", () => {
  it("events bounded to MAX_HISTORY_EVENTS", () => {
    let timeline = buildTimeline(null, makeSnapshot({ thesisState: "HEALTHY" }));
    for (let i = 0; i < 120; i++) {
      const snap = makeSnapshot({
        thesisState: i % 2 === 0 ? "CAUTION" : "HEALTHY",
        timestamp: now + (i + 1) * 60_000,
      });
      timeline = buildTimeline(timeline, snap);
    }
    expect(timeline.events.length).toBeLessThanOrEqual(MAX_HISTORY_EVENTS);
  });
});

// ═══════════════════════════════════════════════════════════════
// G. POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("G. Position Isolation", () => {
  it("different position IDs produce separate timelines", () => {
    const snap1 = makeSnapshot({ positionId: "pos-1", instrument: "BTC/USDT" });
    const snap2 = makeSnapshot({ positionId: "pos-2", instrument: "ETH/USDT" });

    let t1 = buildTimeline(null, snap1);
    let t2 = buildTimeline(null, snap2);

    t1 = buildTimeline(t1, makeSnapshot({ positionId: "pos-1", thesisState: "CAUTION" }));
    t2 = buildTimeline(t2, makeSnapshot({ positionId: "pos-2", thesisState: "INVALIDATED" }));

    expect(t1.latestSnapshot?.thesisState).toBe("CAUTION");
    expect(t2.latestSnapshot?.thesisState).toBe("INVALIDATED");
  });
});

// ═══════════════════════════════════════════════════════════════
// H. LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("H. LONG/SHORT Symmetry", () => {
  it("LONG and SHORT produce separate independent timelines", () => {
    const longSnap = makeSnapshot({ positionId: "long-1", side: "LONG", thesisState: "HEALTHY" });
    const shortSnap = makeSnapshot({ positionId: "short-1", side: "SHORT", thesisState: "HEALTHY" });

    let longTl = buildTimeline(null, longSnap);
    let shortTl = buildTimeline(null, shortSnap);

    longTl = buildTimeline(longTl, makeSnapshot({ positionId: "long-1", side: "LONG", thesisState: "CAUTION" }));
    shortTl = buildTimeline(shortTl, makeSnapshot({ positionId: "short-1", side: "SHORT", thesisState: "INVALIDATED" }));

    expect(longTl.latestSnapshot?.thesisState).toBe("CAUTION");
    expect(longTl.latestSnapshot?.side).toBe("LONG");
    expect(shortTl.latestSnapshot?.thesisState).toBe("INVALIDATED");
    expect(shortTl.latestSnapshot?.side).toBe("SHORT");
  });
});

// ═══════════════════════════════════════════════════════════════
// I. EMPTY / UNAVAILABLE STATE
// ═══════════════════════════════════════════════════════════════

describe("I. Empty / Unavailable State", () => {
  it("null timeline → no crash", () => {
    const snap = makeSnapshot();
    const timeline = buildTimeline(null, snap);
    expect(timeline.events.length).toBe(1);
  });

  it("data quality change recorded", () => {
    const prev = makeSnapshot({ dataAvailability: "SUFFICIENT" });
    const curr = makeSnapshot({ dataAvailability: "UNAVAILABLE" });
    const events = detectChanges(prev, curr);
    expect(events.some(e => e.eventType === "DATA_QUALITY_CHANGE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("J. Determinism", () => {
  it("same inputs → same events", () => {
    const prev = makeSnapshot({ thesisState: "HEALTHY" });
    const curr = makeSnapshot({ thesisState: "CAUTION" });
    const e1 = detectChanges(prev, curr);
    const e2 = detectChanges(prev, curr);
    expect(e1.length).toBe(e2.length);
    expect(e1[0].eventType).toBe(e2[0].eventType);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. NO PROBABILITY CLAIMS
// ═══════════════════════════════════════════════════════════════

describe("K. No Probability Claims", () => {
  it("timeline has no probability language", () => {
    const snap1 = makeSnapshot({ thesisState: "HEALTHY" });
    let tl = buildTimeline(null, snap1);
    tl = buildTimeline(tl, makeSnapshot({ thesisState: "CAUTION" }));
    const json = JSON.stringify(tl).toLowerCase();
    expect(json).not.toContain("probability");
    expect(json).not.toContain("chance");
  });
});

// ═══════════════════════════════════════════════════════════════
// L. NO AUTO-EXECUTION
// ═══════════════════════════════════════════════════════════════

describe("L. No Auto-Execution", () => {
  it("no execution language", () => {
    const snap = makeSnapshot();
    const tl = buildTimeline(null, snap);
    const json = JSON.stringify(tl).toLowerCase();
    expect(json).not.toContain("execute");
    expect(json).not.toContain("buy now");
    expect(json).not.toContain("sell now");
  });
});

// ═══════════════════════════════════════════════════════════════
// M. THESIS TRANSITION STRENGTH
// ═══════════════════════════════════════════════════════════════

describe("M. Thesis Transition Strength", () => {
  it("HEALTHY → INVALIDATED is STRONG", () => {
    const prev = makeSnapshot({ thesisState: "HEALTHY" });
    const curr = makeSnapshot({ thesisState: "INVALIDATED" });
    const events = detectChanges(prev, curr);
    const thesisEvent = events.find(e => e.eventType === "THESIS_CHANGE");
    expect(thesisEvent?.strength).toBe("STRONG");
  });

  it("HEALTHY → WATCH is MODERATE", () => {
    const prev = makeSnapshot({ thesisState: "HEALTHY" });
    const curr = makeSnapshot({ thesisState: "WATCH" });
    const events = detectChanges(prev, curr);
    const thesisEvent = events.find(e => e.eventType === "THESIS_CHANGE");
    expect(thesisEvent?.strength).toBe("MODERATE");
  });
});

// ═══════════════════════════════════════════════════════════════
// N. MULTI-POSITION HISTORY
// ═══════════════════════════════════════════════════════════════

describe("N. Multi-Position History", () => {
  it("3 positions produce 3 independent timelines", () => {
    const snaps = [
      makeSnapshot({ positionId: "p1", instrument: "BTC/USDT" }),
      makeSnapshot({ positionId: "p2", instrument: "ETH/USDT" }),
      makeSnapshot({ positionId: "p3", instrument: "EUR/USD" }),
    ];
    let timelines = snaps.map(s => buildTimeline(null, s));
    // Evolve each differently
    timelines[0] = buildTimeline(timelines[0], makeSnapshot({ positionId: "p1", thesisState: "CAUTION" }));
    timelines[1] = buildTimeline(timelines[1], makeSnapshot({ positionId: "p2", thesisState: "INVALIDATED" }));
    timelines[2] = buildTimeline(timelines[2], makeSnapshot({ positionId: "p3", thesisState: "HEALTHY" }));

    expect(timelines[0].latestSnapshot?.thesisState).toBe("CAUTION");
    expect(timelines[1].latestSnapshot?.thesisState).toBe("INVALIDATED");
    expect(timelines[2].latestSnapshot?.thesisState).toBe("HEALTHY");
  });
});
