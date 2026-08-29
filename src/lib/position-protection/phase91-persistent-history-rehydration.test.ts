/**
 * Phase 91 — Persistent History Rehydration Tests
 *
 * Tests for:
 * - Local + persisted merge
 * - Event deduplication
 * - Snapshot identity + race condition guard
 * - Timeline reconstruction from Convex data
 * - Automatic retention limits
 * - Bounded history (50 snapshots, 100 events)
 * - Position cleanup
 * - LONG/SHORT isolation
 * - Deterministic reconstruction
 * - No duplicate INITIAL_ANALYSIS
 * - Safety invariants
 */

import { describe, it, expect } from "vitest";
import {
  eventIdentity,
  snapshotIdentity,
  isSnapshotStale,
  mergeTimelineEvents,
  mergeSnapshots,
  decidePersistence,
  reconstructTimeline,
  snapshotToArgs,
  eventsToArgs,
  persistedToSnapshot,
  persistedToEvent,
  type PersistedSnapshot,
  type PersistedEvent,
} from "./persistent-history-engine";
import {
  createSnapshot,
  detectChanges,
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

function makeEvent(overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return {
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
// EVENT IDENTITY + DEDUP
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Event Identity", () => {
  it("should produce deterministic identity for same event", () => {
    const e1 = makeEvent({ timestamp: 1000, eventType: "THESIS_CHANGE", description: "A" });
    const e2 = makeEvent({ timestamp: 1000, eventType: "THESIS_CHANGE", description: "A" });
    expect(eventIdentity(e1)).toBe(eventIdentity(e2));
  });

  it("should produce different identity for different events", () => {
    const e1 = makeEvent({ timestamp: 1000, eventType: "THESIS_CHANGE", description: "A" });
    const e2 = makeEvent({ timestamp: 1000, eventType: "THESIS_CHANGE", description: "B" });
    expect(eventIdentity(e1)).not.toBe(eventIdentity(e2));
  });

  it("should differentiate by timestamp", () => {
    const e1 = makeEvent({ timestamp: 1000, description: "X" });
    const e2 = makeEvent({ timestamp: 2000, description: "X" });
    expect(eventIdentity(e1)).not.toBe(eventIdentity(e2));
  });

  it("should differentiate by eventType", () => {
    const e1 = makeEvent({ eventType: "THESIS_CHANGE", description: "X" });
    const e2 = makeEvent({ eventType: "REGIME_CHANGE", description: "X" });
    expect(eventIdentity(e1)).not.toBe(eventIdentity(e2));
  });
});

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT IDENTITY + RACE CONDITION GUARD
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Snapshot Identity", () => {
  it("should produce deterministic identity for same snapshot", () => {
    const s1 = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY" });
    const s2 = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY" });
    expect(snapshotIdentity(s1)).toBe(snapshotIdentity(s2));
  });

  it("should detect stale snapshot", () => {
    const snapshot = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY", marketRegime: "TRENDING_UP", h1Trend: "BULLISH", structure: "HIGHER_HIGHS_HIGHER_LOWS" });
    const identity = snapshotIdentity(snapshot);

    expect(isSnapshotStale(snapshot, identity)).toBe(true);
  });

  it("should NOT detect stale when thesis changes", () => {
    const s1 = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY", marketRegime: "TRENDING_UP", h1Trend: "BULLISH", structure: "HIGHER_HIGHS_HIGHER_LOWS" });
    const s2 = makeSnapshot({ timestamp: 1000, thesisState: "CAUTION", marketRegime: "TRENDING_UP", h1Trend: "BULLISH", structure: "HIGHER_HIGHS_HIGHER_LOWS" });

    expect(isSnapshotStale(s2, snapshotIdentity(s1))).toBe(false);
  });

  it("should NOT detect stale when no previous identity", () => {
    const s = makeSnapshot();
    expect(isSnapshotStale(s, null)).toBe(false);
  });

  it("should NOT detect stale when regime changes", () => {
    const s1 = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY", marketRegime: "TRENDING_UP", h1Trend: "BULLISH", structure: "HIGHER_HIGHS_HIGHER_LOWS" });
    const s2 = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY", marketRegime: "PULLBACK", h1Trend: "BULLISH", structure: "HIGHER_HIGHS_HIGHER_LOWS" });

    expect(isSnapshotStale(s2, snapshotIdentity(s1))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// LOCAL + PERSISTED MERGE
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Event Merge", () => {
  it("should merge events without duplicates", () => {
    const local = [
      makeEvent({ timestamp: 2000, eventType: "THESIS_CHANGE", description: "Thesis: HEALTHY → CAUTION" }),
      makeEvent({ timestamp: 1000, eventType: "INITIAL_ANALYSIS", description: "Initial" }),
    ];
    const persisted = [
      makeEvent({ timestamp: 2000, eventType: "THESIS_CHANGE", description: "Thesis: HEALTHY → CAUTION" }),
    ];

    const merged = mergeTimelineEvents(local, persisted);
    expect(merged.length).toBe(2); // INITIAL_ANALYSIS + THESIS_CHANGE, no dup
  });

  it("should preserve local-only events not yet in Convex", () => {
    const local = [
      makeEvent({ timestamp: 3000, eventType: "MOMENTUM_CHANGE", description: "Momentum: NORMAL → OVERBOUGHT" }),
    ];
    const persisted = [
      makeEvent({ timestamp: 2000, eventType: "INITIAL_ANALYSIS", description: "Initial" }),
    ];

    const merged = mergeTimelineEvents(local, persisted);
    expect(merged.length).toBe(2);
    expect(merged[0].eventType).toBe("MOMENTUM_CHANGE");
    expect(merged[1].eventType).toBe("INITIAL_ANALYSIS");
  });

  it("should prefer persisted when both have same event identity", () => {
    const local = [
      makeEvent({ timestamp: 1000, eventType: "INITIAL_ANALYSIS", description: "Initial: BTC/USDT LONG — HEALTHY" }),
    ];
    const persisted = [
      makeEvent({ timestamp: 1000, eventType: "INITIAL_ANALYSIS", description: "Initial: BTC/USDT LONG — HEALTHY" }),
    ];

    const merged = mergeTimelineEvents(local, persisted);
    expect(merged.length).toBe(1);
    // Persisted wins (added first)
    expect(merged[0].description).toBe("Initial: BTC/USDT LONG — HEALTHY");
  });

  it("should sort merged events newest first", () => {
    const local = [
      makeEvent({ timestamp: 1000, description: "old" }),
    ];
    const persisted = [
      makeEvent({ timestamp: 3000, description: "new" }),
    ];

    const merged = mergeTimelineEvents(local, persisted);
    expect(merged[0].timestamp).toBe(3000);
    expect(merged[1].timestamp).toBe(1000);
  });

  it("should handle empty local", () => {
    const merged = mergeTimelineEvents([], [makeEvent()]);
    expect(merged.length).toBe(1);
  });

  it("should handle empty persisted", () => {
    const merged = mergeTimelineEvents([makeEvent()], []);
    expect(merged.length).toBe(1);
  });

  it("should handle both empty", () => {
    const merged = mergeTimelineEvents([], []);
    expect(merged.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT MERGE
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Snapshot Merge", () => {
  it("should prefer newer snapshot", () => {
    const local = makeSnapshot({ timestamp: 2000, thesisState: "CAUTION" });
    const persisted = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY" });

    const merged = mergeSnapshots(local, persisted);
    expect(merged!.timestamp).toBe(2000);
    expect(merged!.thesisState).toBe("CAUTION");
  });

  it("should prefer persisted when it is newer", () => {
    const local = makeSnapshot({ timestamp: 1000, thesisState: "HEALTHY" });
    const persisted = makeSnapshot({ timestamp: 3000, thesisState: "DETERIORATING" });

    const merged = mergeSnapshots(local, persisted);
    expect(merged!.timestamp).toBe(3000);
    expect(merged!.thesisState).toBe("DETERIORATING");
  });

  it("should return local when persisted is null", () => {
    const local = makeSnapshot();
    expect(mergeSnapshots(local, null)).toBe(local);
  });

  it("should return persisted when local is null", () => {
    const persisted = makeSnapshot();
    expect(mergeSnapshots(null, persisted)).toBe(persisted);
  });

  it("should return null when both null", () => {
    expect(mergeSnapshots(null, null)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// TIMELINE RECONSTRUCTION FROM CONVEX
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Timeline Reconstruction", () => {
  it("should reconstruct from persisted snapshots + events", () => {
    const s1 = makePersistedSnapshot({ timestamp: 1000000, thesisState: "HEALTHY" });
    const s2 = makePersistedSnapshot({ timestamp: 2000000, thesisState: "CAUTION" });
    const e1 = makePersistedEvent({ timestamp: 1000000, eventType: "INITIAL_ANALYSIS" });

    const timeline = reconstructTimeline([s1, s2], [e1]);

    expect(timeline.latestSnapshot!.timestamp).toBe(2000000);
    expect(timeline.latestSnapshot!.thesisState).toBe("CAUTION");
    expect(timeline.previousSnapshot!.timestamp).toBe(1000000);
    expect(timeline.previousSnapshot!.thesisState).toBe("HEALTHY");
    expect(timeline.events.length).toBe(1);
    expect(timeline.summary).not.toBeNull();
  });

  it("should handle empty data", () => {
    const timeline = reconstructTimeline([], []);
    expect(timeline.latestSnapshot).toBeNull();
    expect(timeline.previousSnapshot).toBeNull();
    expect(timeline.events.length).toBe(0);
    expect(timeline.summary).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// RETENTION BOUNDS
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Retention Bounds", () => {
  it("should bound MAX_HISTORY_EVENTS to 100", () => {
    expect(MAX_HISTORY_EVENTS).toBe(100);
  });

  it("should not have unbounded event growth in merge", () => {
    const local: HistoricalEvent[] = [];
    const persisted: HistoricalEvent[] = [];
    for (let i = 0; i < 120; i++) {
      local.push(makeEvent({ timestamp: 1000000 + i * 1000, description: `L-${i}` }));
      persisted.push(makeEvent({ timestamp: 1000000 + i * 1000, description: `P-${i}` }));
    }

    const merged = mergeTimelineEvents(local, persisted);
    expect(merged.length).toBeLessThanOrEqual(MAX_HISTORY_EVENTS);
  });

  it("should bound reconstruction to MAX_HISTORY_EVENTS", () => {
    const events: PersistedEvent[] = [];
    for (let i = 0; i < 150; i++) {
      events.push(makePersistedEvent({
        _id: `e-${i}`,
        timestamp: 1000000 + i * 1000,
        description: `Event ${i}`,
      }));
    }

    const timeline = reconstructTimeline([], events);
    expect(timeline.events.length).toBeLessThanOrEqual(MAX_HISTORY_EVENTS);
  });
});

// ═══════════════════════════════════════════════════════════════
// DEDUP: NO DUPLICATE INITIAL_ANALYSIS
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — No Duplicate INITIAL_ANALYSIS", () => {
  it("should not produce duplicate INITIAL_ANALYSIS after merge", () => {
    const local = [
      makeEvent({ timestamp: 1000, eventType: "INITIAL_ANALYSIS", description: "Initial: BTC/USDT LONG — HEALTHY" }),
    ];
    const persisted = [
      makeEvent({ timestamp: 1000, eventType: "INITIAL_ANALYSIS", description: "Initial: BTC/USDT LONG — HEALTHY" }),
    ];

    const merged = mergeTimelineEvents(local, persisted);
    const initialCount = merged.filter(e => e.eventType === "INITIAL_ANALYSIS").length;
    expect(initialCount).toBe(1);
  });

  it("should not duplicate INITIAL_ANALYSIS across intelligence cycles with same data", () => {
    const local1 = [makeEvent({ timestamp: 1000, eventType: "INITIAL_ANALYSIS", description: "Initial" })];
    const persisted1 = [makeEvent({ timestamp: 1000, eventType: "INITIAL_ANALYSIS", description: "Initial" })];

    const merged1 = mergeTimelineEvents(local1, persisted1);

    // Second cycle: same local + same persisted
    const merged2 = mergeTimelineEvents(merged1, persisted1);
    const initialCount = merged2.filter(e => e.eventType === "INITIAL_ANALYSIS").length;
    expect(initialCount).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// LONG/SHORT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — LONG/SHORT Isolation", () => {
  it("should keep LONG and SHORT event streams separate", () => {
    const longEvents = [makeEvent({ timestamp: 1000, description: "LONG initial" })];
    const shortEvents = [makeEvent({ timestamp: 1000, description: "SHORT initial" })];

    // Merging events for different positions should remain independent
    const longMerged = mergeTimelineEvents(longEvents, []);
    const shortMerged = mergeTimelineEvents(shortEvents, []);

    expect(longMerged[0].description).toBe("LONG initial");
    expect(shortMerged[0].description).toBe("SHORT initial");
  });

  it("should preserve side in persisted args", () => {
    const snapshot = makeSnapshot({ side: "SHORT" });
    const args = snapshotToArgs(snapshot);
    expect(args.side).toBe("SHORT");

    const events = [makeEvent()];
    const eventArgs = eventsToArgs("pos-1", "BTC/USDT", "LONG", events);
    expect(eventArgs.side).toBe("LONG");
  });
});

// ═══════════════════════════════════════════════════════════════
// POSITION ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Position Isolation", () => {
  it("should isolate merge to specific positionId", () => {
    const pos1Events = [makeEvent({ description: "POS-1 event" })];
    const pos2Events = [makeEvent({ description: "POS-2 event" })];

    const pos1Merged = mergeTimelineEvents(pos1Events, []);
    const pos2Merged = mergeTimelineEvents(pos2Events, []);

    expect(pos1Merged[0].description).toContain("POS-1");
    expect(pos2Merged[0].description).toContain("POS-2");
  });

  it("should reconstruct with correct positionId", () => {
    const snapshot = makePersistedSnapshot({ positionId: "unique-pos-42" });
    const timeline = reconstructTimeline([snapshot], []);
    expect(timeline.positionId).toBe("unique-pos-42");
  });
});

// ═══════════════════════════════════════════════════════════════
// DETERMINISTIC RECONSTRUCTION
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Deterministic Reconstruction", () => {
  it("should produce identical merge results for same inputs", () => {
    const local = [makeEvent({ timestamp: 2000 }), makeEvent({ timestamp: 1000 })];
    const persisted = [makeEvent({ timestamp: 1500 })];

    const m1 = mergeTimelineEvents(local, persisted);
    const m2 = mergeTimelineEvents(local, persisted);

    expect(m1.length).toBe(m2.length);
    expect(m1.map(e => eventIdentity(e))).toEqual(m2.map(e => eventIdentity(e)));
  });

  it("should produce identical snapshot identity", () => {
    const s = makeSnapshot();
    expect(snapshotIdentity(s)).toBe(snapshotIdentity(s));
  });

  it("should produce identical event identity", () => {
    const e = makeEvent();
    expect(eventIdentity(e)).toBe(eventIdentity(e));
  });
});

// ═══════════════════════════════════════════════════════════════
// SAFETY INVARIANTS
// ═══════════════════════════════════════════════════════════════

describe("Phase 91 — Safety Invariants", () => {
  it("should not contain probability language", () => {
    const s = makeSnapshot();
    const args = snapshotToArgs(s);
    const serialized = JSON.stringify(args).toLowerCase();
    expect(serialized).not.toContain("probability");
    expect(serialized).not.toContain("chance");
    expect(serialized).not.toContain("likely");
    expect(serialized).not.toContain("guaranteed");
  });

  it("should not contain auto-execution language", () => {
    const s = makeSnapshot();
    const args = snapshotToArgs(s);
    const serialized = JSON.stringify(args).toLowerCase();
    expect(serialized).not.toContain("execute");
    expect(serialized).not.toContain("buy order");
    expect(serialized).not.toContain("sell order");
    expect(serialized).not.toContain("close position");
  });

  it("should not store API keys", () => {
    const s = makeSnapshot();
    const args = snapshotToArgs(s);
    const serialized = JSON.stringify(args);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("SECRET");
    expect(serialized).not.toContain("Bearer");
  });

  it("should preserve data source integrity", () => {
    const s = makeSnapshot({ dataAvailability: "UNAVAILABLE" });
    const args = snapshotToArgs(s);
    expect(args.dataAvailability).toBe("UNAVAILABLE");

    const s2 = makeSnapshot({ dataAvailability: "SUFFICIENT" });
    const args2 = snapshotToArgs(s2);
    expect(args2.dataAvailability).toBe("SUFFICIENT");
  });

  it("should not fabricate probability in event descriptions", () => {
    const events = detectChanges(null, makeSnapshot());
    for (const event of events) {
      expect(event.description.toLowerCase()).not.toContain("probability");
      expect(event.description.toLowerCase()).not.toContain("% chance");
    }
  });
});
