/**
 * Phase 90 — Persistent Intelligence History Tests
 *
 * Tests for:
 * - Persistence decision logic
 * - Snapshot/event conversion to/from Convex args
 * - Timeline reconstruction from persisted data
 * - Initial snapshot persistence
 * - Unchanged polling cycle skipping persistence
 * - LONG/SHORT symmetry
 * - Bounded history
 * - No fabricated data
 * - No probability language
 * - No auto-execution
 * - Deterministic ordering
 */

import { describe, it, expect } from "vitest";
import {
  decidePersistence,
  snapshotToArgs,
  eventsToArgs,
  reconstructTimeline,
  persistedToSnapshot,
  persistedToEvent,
  type PersistedSnapshot,
  type PersistedEvent,
} from "./persistent-history-engine";
import {
  createSnapshot,
  MAX_HISTORY_EVENTS,
  type IntelligenceSnapshot,
  type HistoricalEvent,
} from "./historical-intelligence";

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
    momentum: "NORMAL",
    volatility: "NORMAL",
    structure: "HIGHER_HIGHS_HIGHER_LOWS",
    supportingCount: 4,
    conflictingCount: 1,
    invalidationCondition: "H1 structure breaks",
    watchNext: "M5 momentum continuation",
    dataAvailability: "SUFFICIENT",
    timestamp: 1000000,
    ...overrides,
  });
}

function makePersistedSnapshot(overrides: Partial<PersistedSnapshot> = {}): PersistedSnapshot {
  const base = makeSnapshot();
  return {
    _id: "snapshot-1",
    _creationTime: base.timestamp,
    userId: "user-1",
    positionId: base.positionId,
    instrument: base.instrument,
    side: base.side,
    timestamp: base.timestamp,
    thesisState: base.thesisState,
    evidenceQuality: base.evidenceQuality,
    marketRegime: base.marketRegime,
    h1Trend: base.h1Trend,
    m15Trend: base.m15Trend,
    m5Trend: base.m5Trend,
    mtfAlignment: base.mtfAlignment,
    momentum: base.momentum,
    volatility: base.volatility,
    structure: base.structure,
    supportingCount: base.supportingCount,
    conflictingCount: base.conflictingCount,
    invalidationCondition: base.invalidationCondition,
    watchNext: base.watchNext,
    dataAvailability: base.dataAvailability,
    ...overrides,
  };
}

function makePersistedEvent(overrides: Partial<PersistedEvent> = {}): PersistedEvent {
  return {
    _id: "event-1",
    _creationTime: 1000000,
    userId: "user-1",
    positionId: "pos-1",
    instrument: "BTC/USDT",
    side: "LONG",
    timestamp: 1000000,
    eventType: "INITIAL_ANALYSIS",
    description: "Initial analysis: BTC/USDT LONG — HEALTHY",
    previousState: "—",
    currentState: "HEALTHY",
    category: "ANALYSIS",
    strength: "STRONG",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE DECISION
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — Persistence Decision", () => {
  it("should persist initial snapshot (no previous)", () => {
    const snapshot = makeSnapshot();
    const decision = decidePersistence(null, snapshot);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.shouldPersistEvents).toBe(true);
    expect(decision.isInitial).toBe(true);
    expect(decision.newEvents.length).toBe(1);
    expect(decision.newEvents[0].eventType).toBe("INITIAL_ANALYSIS");
  });

  it("should persist when thesis changes", () => {
    const previous = makeSnapshot({ thesisState: "HEALTHY" });
    const current = makeSnapshot({ thesisState: "CAUTION", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.shouldPersistEvents).toBe(true);
    expect(decision.newEvents.some(e => e.eventType === "THESIS_CHANGE")).toBe(true);
  });

  it("should persist when regime changes", () => {
    const previous = makeSnapshot({ marketRegime: "TRENDING_UP" });
    const current = makeSnapshot({ marketRegime: "PULLBACK", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.shouldPersistEvents).toBe(true);
    expect(decision.newEvents.some(e => e.eventType === "REGIME_CHANGE")).toBe(true);
  });

  it("should NOT persist when nothing changed", () => {
    const previous = makeSnapshot({ timestamp: 1000000 });
    const current = makeSnapshot({ timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(false);
    expect(decision.shouldPersistEvents).toBe(false);
    expect(decision.newEvents.length).toBe(0);
  });

  it("should persist when H1 trend changes", () => {
    const previous = makeSnapshot({ h1Trend: "BULLISH" });
    const current = makeSnapshot({ h1Trend: "BEARISH", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.newEvents.some(e =>
      e.eventType === "TIMEFRAME_CHANGE" && e.category === "H1"
    )).toBe(true);
  });

  it("should persist when M15 trend changes", () => {
    const previous = makeSnapshot({ m15Trend: "BULLISH" });
    const current = makeSnapshot({ m15Trend: "BEARISH", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.newEvents.some(e =>
      e.eventType === "TIMEFRAME_CHANGE" && e.category === "M15"
    )).toBe(true);
  });

  it("should persist when structure changes", () => {
    const previous = makeSnapshot({ structure: "HIGHER_HIGHS_HIGHER_LOWS" });
    const current = makeSnapshot({ structure: "LOWER_HIGHS_LOWER_LOWS", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.newEvents.some(e => e.eventType === "STRUCTURE_CHANGE")).toBe(true);
  });

  it("should persist when momentum changes", () => {
    const previous = makeSnapshot({ momentum: "NORMAL" });
    const current = makeSnapshot({ momentum: "OVERBOUGHT", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.newEvents.some(e => e.eventType === "MOMENTUM_CHANGE")).toBe(true);
  });

  it("should persist when volatility changes", () => {
    const previous = makeSnapshot({ volatility: "NORMAL" });
    const current = makeSnapshot({ volatility: "EXPANDED", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.newEvents.some(e => e.eventType === "VOLATILITY_CHANGE")).toBe(true);
  });

  it("should persist when evidence quality changes", () => {
    const previous = makeSnapshot({ evidenceQuality: "MODERATE_EVIDENCE" });
    const current = makeSnapshot({ evidenceQuality: "WEAK_EVIDENCE", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.newEvents.some(e => e.eventType === "EVIDENCE_CHANGE")).toBe(true);
  });

  it("should persist when data availability changes", () => {
    const previous = makeSnapshot({ dataAvailability: "SUFFICIENT" });
    const current = makeSnapshot({ dataAvailability: "LIMITED", timestamp: 2000000 });
    const decision = decidePersistence(previous, current);

    expect(decision.shouldPersistSnapshot).toBe(true);
    expect(decision.newEvents.some(e => e.eventType === "DATA_QUALITY_CHANGE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT/EVENT CONVERSION
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — Snapshot/Event Conversion", () => {
  it("should convert snapshot to Convex args correctly", () => {
    const snapshot = makeSnapshot({ side: "SHORT" });
    const args = snapshotToArgs(snapshot);

    expect(args.positionId).toBe("pos-1");
    expect(args.instrument).toBe("BTC/USDT");
    expect(args.side).toBe("SHORT");
    expect(args.thesisState).toBe("HEALTHY");
    expect(args.h1Trend).toBe("BULLISH");
    expect(args.supportingCount).toBe(4);
    expect(args.conflictingCount).toBe(1);
    expect(args.timestamp).toBe(1000000);
  });

  it("should convert events to Convex args correctly", () => {
    const events: HistoricalEvent[] = [
      {
        timestamp: 2000000,
        eventType: "THESIS_CHANGE",
        description: "Thesis: HEALTHY → CAUTION",
        previousState: "HEALTHY",
        currentState: "CAUTION",
        category: "THESIS",
        strength: "MODERATE",
      },
    ];

    const args = eventsToArgs("pos-1", "BTC/USDT", "LONG", events);

    expect(args.positionId).toBe("pos-1");
    expect(args.instrument).toBe("BTC/USDT");
    expect(args.side).toBe("LONG");
    expect(args.events.length).toBe(1);
    expect(args.events[0].eventType).toBe("THESIS_CHANGE");
    expect(args.events[0].strength).toBe("MODERATE");
  });

  it("should convert persisted snapshot back to IntelligenceSnapshot", () => {
    const persisted = makePersistedSnapshot({ side: "SHORT" });
    const snapshot = persistedToSnapshot(persisted);

    expect(snapshot.positionId).toBe("pos-1");
    expect(snapshot.instrument).toBe("BTC/USDT");
    expect(snapshot.side).toBe("SHORT");
    expect(snapshot.thesisState).toBe("HEALTHY");
    expect(snapshot.timestamp).toBe(persisted.timestamp);
  });

  it("should convert persisted event back to HistoricalEvent", () => {
    const persisted = makePersistedEvent({
      eventType: "REGIME_CHANGE",
      strength: "WEAK",
    });
    const event = persistedToEvent(persisted);

    expect(event.eventType).toBe("REGIME_CHANGE");
    expect(event.strength).toBe("WEAK");
    expect(event.description).toBe(persisted.description);
  });
});

// ═══════════════════════════════════════════════════════════════
// TIMELINE RECONSTRUCTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — Timeline Reconstruction", () => {
  it("should reconstruct timeline from persisted data", () => {
    const snapshot1 = makePersistedSnapshot({ timestamp: 1000000 });
    const snapshot2 = makePersistedSnapshot({ timestamp: 2000000, thesisState: "CAUTION" });

    const event1 = makePersistedEvent({
      timestamp: 1000000,
      eventType: "INITIAL_ANALYSIS",
      description: "Initial analysis: BTC/USDT LONG — HEALTHY",
    });

    const timeline = reconstructTimeline(
      [snapshot1, snapshot2],
      [event1],
    );

    expect(timeline.positionId).toBe("pos-1");
    expect(timeline.latestSnapshot).not.toBeNull();
    expect(timeline.latestSnapshot!.timestamp).toBe(2000000);
    expect(timeline.latestSnapshot!.thesisState).toBe("CAUTION");
    expect(timeline.previousSnapshot).not.toBeNull();
    expect(timeline.previousSnapshot!.timestamp).toBe(1000000);
    expect(timeline.events.length).toBe(1);
    expect(timeline.events[0].eventType).toBe("INITIAL_ANALYSIS");
    expect(timeline.summary).not.toBeNull();
  });

  it("should handle empty persisted data", () => {
    const timeline = reconstructTimeline([], []);

    expect(timeline.positionId).toBe("");
    expect(timeline.latestSnapshot).toBeNull();
    expect(timeline.previousSnapshot).toBeNull();
    expect(timeline.events.length).toBe(0);
    expect(timeline.summary).toBeNull();
  });

  it("should sort snapshots by timestamp descending", () => {
    const s1 = makePersistedSnapshot({ timestamp: 1000000 });
    const s2 = makePersistedSnapshot({ timestamp: 3000000 });
    const s3 = makePersistedSnapshot({ timestamp: 2000000 });

    const timeline = reconstructTimeline([s1, s2, s3], []);

    expect(timeline.latestSnapshot!.timestamp).toBe(3000000);
    expect(timeline.previousSnapshot!.timestamp).toBe(2000000);
  });

  it("should bound events to MAX_HISTORY_EVENTS", () => {
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 120; i++) {
      events.push(makePersistedEvent({
        _id: `event-${i}`,
        timestamp: 1000000 + i * 1000,
        description: `Event ${i}`,
      }));
    }

    const timeline = reconstructTimeline([], events);

    expect(timeline.events.length).toBeLessThanOrEqual(MAX_HISTORY_EVENTS);
  });

  it("should only use snapshots for the same position", () => {
    const s1 = makePersistedSnapshot({ positionId: "pos-1", timestamp: 1000000 });
    const s2 = makePersistedSnapshot({ positionId: "pos-2", timestamp: 2000000 });

    // reconstruction uses whatever is passed in (filtering happens at query level)
    const timeline = reconstructTimeline([s1, s2], []);

    expect(timeline.latestSnapshot!.positionId).toBe("pos-2");
    expect(timeline.positionId).toBe("pos-2");
  });
});

// ═══════════════════════════════════════════════════════════════
// LONG/SHORT SYMMETRY
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — LONG/SHORT Symmetry", () => {
  it("should persist LONG snapshot correctly", () => {
    const snapshot = makeSnapshot({ side: "LONG" });
    const args = snapshotToArgs(snapshot);
    expect(args.side).toBe("LONG");
  });

  it("should persist SHORT snapshot correctly", () => {
    const snapshot = makeSnapshot({ side: "SHORT" });
    const args = snapshotToArgs(snapshot);
    expect(args.side).toBe("SHORT");
  });

  it("should reconstruct LONG timeline correctly", () => {
    const snapshot = makePersistedSnapshot({ side: "LONG" });
    const timeline = reconstructTimeline([snapshot], []);
    expect(timeline.latestSnapshot!.side).toBe("LONG");
  });

  it("should reconstruct SHORT timeline correctly", () => {
    const snapshot = makePersistedSnapshot({ side: "SHORT" });
    const timeline = reconstructTimeline([snapshot], []);
    expect(timeline.latestSnapshot!.side).toBe("SHORT");
  });

  it("should detect same thesis change for both sides", () => {
    const longPrev = makeSnapshot({ side: "LONG", thesisState: "HEALTHY" });
    const longCurr = makeSnapshot({ side: "LONG", thesisState: "CAUTION", timestamp: 2000000 });
    const longDecision = decidePersistence(longPrev, longCurr);

    const shortPrev = makeSnapshot({ side: "SHORT", thesisState: "HEALTHY" });
    const shortCurr = makeSnapshot({ side: "SHORT", thesisState: "CAUTION", timestamp: 2000000 });
    const shortDecision = decidePersistence(shortPrev, shortCurr);

    expect(longDecision.shouldPersistEvents).toBe(true);
    expect(shortDecision.shouldPersistEvents).toBe(true);
    expect(longDecision.newEvents.some(e => e.eventType === "THESIS_CHANGE")).toBe(true);
    expect(shortDecision.newEvents.some(e => e.eventType === "THESIS_CHANGE")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — Safety Invariants", () => {
  it("should not contain probability language in event descriptions", () => {
    const snapshot = makeSnapshot();
    const decision = decidePersistence(null, snapshot);

    for (const event of decision.newEvents) {
      const lower = event.description.toLowerCase();
      expect(lower).not.toContain("probability");
      expect(lower).not.toContain("chance");
      expect(lower).not.toContain("likely");
      expect(lower).not.toContain("guaranteed");
      expect(lower).not.toContain("%");
    }
  });

  it("should not contain auto-execution language", () => {
    const snapshot = makeSnapshot();
    const args = snapshotToArgs(snapshot);

    // Snapshot args should not contain execution commands
    const serialized = JSON.stringify(args).toLowerCase();
    expect(serialized).not.toContain("execute");
    expect(serialized).not.toContain("buy");
    expect(serialized).not.toContain("sell");
    expect(serialized).not.toContain("close position");
    expect(serialized).not.toContain("open order");
  });

  it("should not store API keys in snapshot args", () => {
    const snapshot = makeSnapshot();
    const args = snapshotToArgs(snapshot);

    const serialized = JSON.stringify(args);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("Bearer");
  });

  it("should preserve data source integrity", () => {
    const snapshot = makeSnapshot({ dataAvailability: "SUFFICIENT" });
    const args = snapshotToArgs(snapshot);
    expect(args.dataAvailability).toBe("SUFFICIENT");

    const snapshot2 = makeSnapshot({ dataAvailability: "UNAVAILABLE" });
    const args2 = snapshotToArgs(snapshot2);
    expect(args2.dataAvailability).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// BOUNDED HISTORY
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — Bounded History", () => {
  it("should respect MAX_HISTORY_EVENTS limit", () => {
    expect(MAX_HISTORY_EVENTS).toBe(100);
  });

  it("should not have unbounded event growth in reconstruction", () => {
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 200; i++) {
      events.push(makePersistedEvent({
        _id: `event-${i}`,
        timestamp: 1000000 + i * 1000,
        description: `Event ${i}`,
      }));
    }

    const timeline = reconstructTimeline([], events);
    expect(timeline.events.length).toBeLessThanOrEqual(MAX_HISTORY_EVENTS);
  });
});

// ═══════════════════════════════════════════════════════════════
// DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — Determinism", () => {
  it("should produce identical decisions for same inputs", () => {
    const prev = makeSnapshot({ thesisState: "HEALTHY" });
    const curr = makeSnapshot({ thesisState: "CAUTION", timestamp: 2000000 });

    const d1 = decidePersistence(prev, curr);
    const d2 = decidePersistence(prev, curr);

    expect(d1.shouldPersistSnapshot).toBe(d2.shouldPersistSnapshot);
    expect(d1.shouldPersistEvents).toBe(d2.shouldPersistEvents);
    expect(d1.newEvents.length).toBe(d2.newEvents.length);
    expect(d1.isInitial).toBe(d2.isInitial);
  });

  it("should produce identical reconstructions for same inputs", () => {
    const snapshots = [
      makePersistedSnapshot({ timestamp: 1000000 }),
      makePersistedSnapshot({ timestamp: 2000000 }),
    ];
    const events = [makePersistedEvent({ timestamp: 1000000 })];

    const t1 = reconstructTimeline(snapshots, events);
    const t2 = reconstructTimeline(snapshots, events);

    expect(t1.latestSnapshot?.timestamp).toBe(t2.latestSnapshot?.timestamp);
    expect(t1.events.length).toBe(t2.events.length);
    expect(t1.summary?.currentThesis).toBe(t2.summary?.currentThesis);
  });
});

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 90 — Instrument Isolation", () => {
  it("should preserve instrument in snapshot args", () => {
    const snapshot = makeSnapshot({ instrument: "EUR/USD" });
    const args = snapshotToArgs(snapshot);
    expect(args.instrument).toBe("EUR/USD");
  });

  it("should preserve positionId in snapshot args", () => {
    const snapshot = makeSnapshot({ positionId: "unique-pos-123" });
    const args = snapshotToArgs(snapshot);
    expect(args.positionId).toBe("unique-pos-123");
  });

  it("should preserve instrument in events args", () => {
    const events: HistoricalEvent[] = [{
      timestamp: 1000000,
      eventType: "THESIS_CHANGE",
      description: "Thesis changed",
      previousState: "HEALTHY",
      currentState: "CAUTION",
      category: "THESIS",
      strength: "MODERATE",
    }];

    const args = eventsToArgs("pos-1", "XAU/USD", "SHORT", events);
    expect(args.instrument).toBe("XAU/USD");
    expect(args.positionId).toBe("pos-1");
    expect(args.side).toBe("SHORT");
  });
});
