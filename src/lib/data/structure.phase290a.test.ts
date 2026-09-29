/**
 * Phase 290-A — event-based structural intelligence (focused tests A–K).
 *
 * A. swing confirmation          F. internal/external separation
 * B. BOS timing                  G. MTF confluence
 * C. CHoCH timing                H. missing timeframe
 * D. broken-level identity       I. conflicting timeframes
 * E. invalidation                J. no lookahead
 *                                K. deterministic repeat
 *
 * Every fixture below is explicit OHLCV — no mocks of production values, no
 * synthetic prices presented as live data. The candles are hand-built so the
 * expected swing indices, broken levels and event candles can be verified by
 * reading the fixture itself.
 */
import { describe, it, expect } from "vitest";
import {
  ANOMALY_RANGE_ATR_MULT,
  detectConfirmedSwings,
  detectStructureEvents,
  readStructure,
  readStructurePair,
  scanConfirmedSwings,
  structuralConfluence,
  structureDigest,
} from "./structure";
import { buildMtfContext } from "./mtf";
import type { OhlcvCandle } from "./market-types";

// ── Fixture helpers ───────────────────────────────────────────────

/** [open, high, low, close] */
type Row = [number, number, number, number];

function mk(rows: Row[], startTime = 1_700_000_000_000, tfMs = 3_600_000): OhlcvCandle[] {
  return rows.map(([open, high, low, close], i) => ({
    timestamp: startTime + i * tfMs,
    open,
    high,
    low,
    close,
    volume: 1000,
  }));
}

/** Bar in the mtf.test.ts style: high/low derived from body + fixed wick. */
function legSeries(start: number, legs: Array<[number, number]>, wick = 0.15): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let price = start;
  for (const [bars, step] of legs) {
    for (let b = 0; b < bars; b += 1) {
      const o = price;
      price += step;
      out.push({
        timestamp: 1_700_000_000_000 + out.length * 3_600_000,
        open: o,
        high: Math.max(o, price) + wick,
        low: Math.min(o, price) - wick,
        close: price,
        volume: 1000,
      });
    }
  }
  return out;
}

/** Monotone rise: no fractal swing exists at all. */
const MONOTONE_UP = () => legSeries(100, [[30, 1]]);

/** Clean higher-high / higher-low uptrend, ending on a rising leg. */
const TREND_UP = () => legSeries(100, [[12, 1], [6, -0.5], [12, 1], [6, -0.5], [12, 1]]);

/** Clean lower-high / lower-low downtrend, ending on a falling leg. */
const TREND_DOWN = () => legSeries(200, [[12, -1], [6, 0.5], [12, -1], [6, 0.5], [12, -1]]);

/**
 * Ascending staircase: 2-bar dips spaced 5 bars apart, each dip HIGHER than the
 * previous one. The spacing is deliberate — each dip is a valid 3-bar fractal
 * low but NOT a valid 5-bar one (the lower low 5 bars earlier sits inside the
 * wider window), so this series separates the internal read (which can be
 * broken) from the external read (whose structural low is the older, deeper
 * one).
 */
const STAIRCASE = () =>
  legSeries(100, [
    [10, 1], [6, -1], [8, 0.8],
    [2, -0.4], [3, 0.8], [2, -0.4], [3, 0.8], [2, -0.4], [3, 0.8],
    [2, -0.4], [3, 0.8], [8, -0.9],
  ]);

/** Converging oscillation: descending tops + ascending bottoms → range. */
function CONVERGING_RANGE(cycles = 4): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let price = 96;
  const go = (target: number) => {
    const steps = 7;
    const delta = (target - price) / steps;
    for (let b = 0; b < steps; b += 1) {
      const o = price;
      price += delta;
      out.push({
        timestamp: 1_700_000_000_000 + out.length * 3_600_000,
        open: o,
        high: Math.max(o, price) + 0.1,
        low: Math.min(o, price) - 0.1,
        close: price,
        volume: 1000,
      });
    }
  };
  for (let k = 0; k < cycles; k += 1) {
    go(104 - k * 0.8);
    go(96 + k * 0.8);
  }
  return out;
}

/** Canonical confirmed-event series (lookback 1, hand-verified). */
const EVENTS: Row[] = [
  [100.0, 100.4, 99.6, 100.0], // 0
  [100.0, 101.5, 99.9, 101.0], // 1
  [101.0, 103.0, 100.9, 102.0], // 2  swing HIGH 103.0 → confirmed at 3
  [102.0, 102.2, 100.0, 100.5], // 3  swing LOW 100.0  → confirmed at 4
  [100.5, 101.4, 100.2, 101.0], // 4
  [101.0, 102.4, 100.9, 102.0], // 5
  [102.0, 103.9, 101.9, 103.5], // 6  BOS bullish (close 103.5 > 103.0)
  [103.5, 104.6, 103.2, 104.4], // 7
  [104.4, 104.9, 103.0, 103.4], // 8  swing HIGH 104.9 → confirmed at 9
  [103.4, 103.6, 102.2, 102.6], // 9
  [102.6, 103.0, 101.6, 102.0], // 10
  [102.0, 102.2, 100.8, 101.2], // 11 swing LOW 100.8 → confirmed at 12
  [101.2, 102.6, 101.0, 102.4], // 12
  [102.4, 102.8, 100.9, 101.3], // 13
  [101.3, 101.5, 100.2, 100.4], // 14 CHoCH bearish (close 100.4 < 100.8)
];

// ══════════════════════════════════════════════════════════════════
// A — swing confirmation
// ══════════════════════════════════════════════════════════════════

describe("A — confirmed swings", () => {
  const candles = mk(EVENTS);

  it("a swing needs candles on BOTH sides and records when it became knowable", () => {
    const swings = detectConfirmedSwings(candles, 1);
    expect(swings.map((s) => [s.kind, s.index, s.price])).toEqual([
      ["high", 2, 103.0],
      ["low", 3, 100.0],
      ["high", 8, 104.9],
      ["low", 11, 100.8],
      ["high", 13, 102.8],
    ]);
    // confirmation lag = the lookback: known at close of index + lookback
    for (const s of swings) expect(s.confirmedAtIndex).toBe(s.index + 1);
    expect(swings[0].timestamp).toBe(candles[2].timestamp);
  });

  it("the live edge never becomes a swing by assuming candles that do not exist", () => {
    // Truncate right at the peak: candle 2 cannot be a swing without candle 3.
    expect(detectConfirmedSwings(candles.slice(0, 3), 1).map((s) => s.index)).toEqual([]);
    // Re-adding the confirming candle promotes it — no earlier, no later.
    expect(detectConfirmedSwings(candles.slice(0, 4), 1).map((s) => s.index)).toEqual([2]);
  });

  it("too little history produces no swings at all (never a fabricated one)", () => {
    expect(detectConfirmedSwings(candles.slice(0, 2), 1)).toEqual([]);
    expect(detectConfirmedSwings(candles, 20)).toEqual([]);
  });

  it("exposes the outward confirmation index for a wider window", () => {
    const swings = detectConfirmedSwings(candles, 3);
    for (const s of swings) expect(s.confirmedAtIndex).toBe(s.index + 3);
  });
});

// ══════════════════════════════════════════════════════════════════
// B — BOS timing
// ══════════════════════════════════════════════════════════════════

describe("B — BOS timing", () => {
  const candles = mk(EVENTS);
  const swings = detectConfirmedSwings(candles, 1);

  it("fires on the candle whose CLOSE broke the level, not earlier", () => {
    const { events } = detectStructureEvents(candles, swings);
    const bos = events.find((e) => e.kind === "BOS")!;
    expect(bos.direction).toBe("bullish");
    expect(bos.candleIndex).toBe(6);
    expect(bos.confirmedAtIndex).toBe(6);
    expect(bos.candleTime).toBe(candles[6].timestamp);

    // The swing's own candle closed BELOW the level: no event there.
    expect(candles[2].close).toBeLessThan(bos.brokenLevel);
    // The candle before the event closed below it too.
    expect(candles[5].close).toBeLessThan(bos.brokenLevel);
  });

  it("a bullish BOS does NOT fire while price merely sits above an old level", () => {
    // Same series truncated just before the breaking candle.
    const partial = mk(EVENTS.slice(0, 6));
    const { events } = detectStructureEvents(partial, detectConfirmedSwings(partial, 1));
    expect(events).toEqual([]);
  });

  it("a level already broken cannot fire a second BOS on a later pullback", () => {
    const swings2 = detectConfirmedSwings(candles, 1);
    const { events } = detectStructureEvents(candles, swings2);
    const bullish = events.filter((e) => e.direction === "bullish");
    expect(bullish.map((e) => e.brokenLevel)).toEqual([103.0]);
  });

  it("wick-only break is a rejection, never an event (false breakout)", () => {
    const rows: Row[] = [
      [100.0, 100.4, 99.6, 100.0],
      [100.0, 101.5, 99.9, 101.0],
      [101.0, 103.0, 100.9, 102.0], // swing HIGH 103.0 → confirmed at 3
      [102.0, 102.2, 100.0, 100.5],
      [100.5, 103.8, 100.4, 102.2], // pierces 103.0, CLOSES 102.2 → rejection
      [102.2, 102.6, 101.6, 102.4], // confirms the rejection high as a swing
      [102.4, 103.2, 102.0, 103.2], // close above the ORIGINAL level, below the spike
      [103.2, 104.2, 103.0, 104.0], // close above the rejection high → BOS
    ];
    const c = mk(rows);
    const { events, wickOnlyRejections } = detectStructureEvents(
      c,
      detectConfirmedSwings(c, 1),
    );
    expect(wickOnlyRejections).toBe(1);
    // Candle 6 closed above 103.0 but not through the confirmed high → no event.
    expect(events).toHaveLength(1);
    expect(events[0].candleIndex).toBe(7);
    expect(events[0].brokenLevel).toBe(103.8);
    expect(events[0].brokenSwingIndex).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════
// C — CHoCH timing
// ══════════════════════════════════════════════════════════════════

describe("C — CHoCH timing", () => {
  const candles = mk(EVENTS);
  const swings = detectConfirmedSwings(candles, 1);
  const { events } = detectStructureEvents(candles, swings);

  it("is the FIRST valid close against an established direction", () => {
    const choch = events.find((e) => e.kind === "CHOCH")!;
    expect(choch.direction).toBe("bearish");
    expect(choch.candleIndex).toBe(14);
    expect(choch.brokenLevel).toBe(100.8);
    // It is the LAST event and it flipped the regime.
    expect(events[events.length - 1]).toBe(choch);
    expect(readStructure(candles, "H1", { lookback: 1 }).direction).toBe("bearish");
  });

  it("the FIRST break with no prior direction is a BOS, never a CHoCH", () => {
    const partial = mk(EVENTS.slice(0, 7)); // ends on the first break
    const { events: e } = detectStructureEvents(partial, detectConfirmedSwings(partial, 1));
    expect(e).toHaveLength(1);
    expect(e[0].kind).toBe("BOS");
    expect(e[0].direction).toBe("bullish");
  });

  it("counter-moves that never close through a confirmed level are not CHoCH", () => {
    const rows: Row[] = [
      [100.0, 100.4, 99.6, 100.0],
      [100.0, 101.5, 99.9, 101.0],
      [101.0, 103.0, 100.9, 102.0], // swing HIGH 103.0
      [102.0, 102.2, 100.0, 100.5], // swing LOW 100.0
      [100.5, 102.8, 99.2, 102.4], // close 102.4 > 103.0? NO → no event
      [102.4, 103.6, 101.8, 103.4], // BOS bullish
      [103.4, 103.6, 100.6, 101.0], // deep pullback but close 101.0 > 100.0
      [101.0, 101.4, 100.3, 100.9], // still above the confirmed swing low
    ];
    const c = mk(rows);
    const { events: e } = detectStructureEvents(c, detectConfirmedSwings(c, 1));
    expect(e.map((x) => x.kind)).toEqual(["BOS"]);
    expect(readStructure(c, "H1", { lookback: 1 }).direction).toBe("bullish");
  });
});

// ══════════════════════════════════════════════════════════════════
// D — broken-level identity
// ══════════════════════════════════════════════════════════════════

describe("D — broken-level identity", () => {
  it("names the exact confirmed swing level, its candle and its time", () => {
    const candles = mk(EVENTS);
    const read = readStructure(candles, "H4", { lookback: 1 });
    const bos = read.events[0];
    expect(bos.brokenLevel).toBe(candles[2].high);
    expect(bos.brokenSwingIndex).toBe(2);
    expect(bos.brokenSwingKind).toBe("high");
    expect(bos.brokenSwingTime).toBe(candles[2].timestamp);
    expect(bos.candleTime).not.toBe(bos.brokenSwingTime);

    const choch = read.events[1];
    expect(choch.brokenLevel).toBe(candles[11].low);
    expect(choch.brokenSwingKind).toBe("low");
    expect(choch.brokenSwingIndex).toBe(11);
  });

  it("broken-level identity holds for equal highs (latest equal swing owns it)", () => {
    const rows: Row[] = [
      [100.0, 100.4, 99.6, 100.0],
      [100.0, 102.0, 99.9, 101.5],
      [101.5, 103.0, 101.4, 102.5], // swing HIGH 103.0 @2
      [102.5, 102.6, 101.8, 102.0],
      [102.0, 103.0, 101.9, 102.4], // EQUAL high 103.0 @4
      [102.4, 102.5, 101.5, 102.0],
      [102.0, 104.0, 101.9, 103.6], // close 103.6 > 103.0 → BOS
      [103.6, 104.0, 103.2, 103.8], // level consumed → no repeat
    ];
    const c = mk(rows);
    const read = readStructure(c, "H1", { lookback: 1 });
    expect(read.events).toHaveLength(1);
    expect(read.events[0].brokenLevel).toBe(103.0);
    // the LATEST equal swing owns the level (one event for one level)
    expect(read.events[0].brokenSwingIndex).toBe(4);
    expect(read.events[0].candleIndex).toBe(6);
  });

  it("broken-level identity holds for equal lows", () => {
    const rows: Row[] = [
      [103.0, 103.4, 102.6, 103.0],
      [103.0, 103.1, 101.0, 101.5],
      [101.5, 101.6, 100.0, 100.5], // swing LOW 100.0 @2
      [100.5, 101.4, 100.2, 101.2],
      [101.2, 101.3, 100.0, 100.6], // EQUAL low 100.0 @4
      [100.6, 101.8, 100.1, 101.6],
      [101.6, 101.7, 99.2, 99.5], // close 99.5 < 100.0 → single bearish BOS
      [99.5, 100.2, 99.0, 99.2], // level consumed → no repeat
    ];
    const c = mk(rows);
    const read = readStructure(c, "H1", { lookback: 1 });
    expect(read.events).toHaveLength(1);
    expect(read.events[0].kind).toBe("BOS");
    expect(read.events[0].direction).toBe("bearish");
    expect(read.events[0].brokenLevel).toBe(100.0);
    expect(read.events[0].brokenSwingIndex).toBe(4);
  });
});

// ══════════════════════════════════════════════════════════════════
// E — invalidation from real structure
// ══════════════════════════════════════════════════════════════════

describe("E — structural invalidation", () => {
  it("bullish → the relevant CONFIRMED structural low (never an R:R pick)", () => {
    const candles = mk(EVENTS.slice(0, 7)); // ends on the bullish BOS
    const read = readStructure(candles, "H4", { lookback: 1 });
    expect(read.direction).toBe("bullish");
    expect(read.invalidation).toBeDefined();
    expect(read.invalidation!.level).toBe(100.0); // candle 3 low — the protected low
    expect(read.invalidation!.swingIndex).toBe(3);
    expect(read.invalidation!.swingKind).toBe("low");
    expect(read.invalidation!.timestamp).toBe(candles[3].timestamp);
    expect(read.invalidation!.distance).toBeCloseTo(Math.abs(candles[6].close - 100.0), 10);
  });

  it("bearish → the relevant CONFIRMED structural high", () => {
    const read = readStructure(TREND_DOWN(), "D1", { lookback: 3 });
    expect(read.direction).toBe("bearish");
    expect(read.invalidation).toBeDefined();
    expect(read.invalidation!.swingKind).toBe("high");
    const highs = read.swings.filter((s) => s.kind === "high");
    expect(read.invalidation!.level).toBe(highs[highs.length - 1].price);
  });

  it("no direction → no invalidation level is invented", () => {
    const read = readStructure(CONVERGING_RANGE(), "D1", { lookback: 3 });
    expect(read.direction).toBe("none");
    expect(read.invalidation).toBeUndefined();
    expect(read.majorInvalidation).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// F — internal / external separation
// ══════════════════════════════════════════════════════════════════

describe("F — internal vs external structure", () => {
  const candles = STAIRCASE();

  it("they use different windows and answer different questions", () => {
    const pair = readStructurePair(candles, "H4", {
      externalLookback: 5,
      internalLookback: 3,
    });
    expect(pair.external.lookback).toBe(5);
    expect(pair.internal.lookback).toBe(3);
    expect(pair.external.direction).toBe("bullish");
    expect(pair.internal.direction).toBe("bearish");
    expect(pair.state).toBe("INTERNAL_COUNTERTREND");
    expect(pair.disagreement).toBe(true);
  });

  it("an internal break NEVER redefines the external regime", () => {
    const pair = readStructurePair(candles, "H4", {
      externalLookback: 5,
      internalLookback: 3,
    });
    // The internal leg broke down; the external event history has no bearish break.
    expect(pair.internal.lastEvent!.direction).toBe("bearish");
    expect(pair.external.events.some((e) => e.direction === "bearish")).toBe(false);
    expect(pair.external.lastEvent!.direction).toBe("bullish");
    // …and the reason says so explicitly.
    expect(pair.reason).toContain("counter-trend");
    expect(pair.reason).toContain("external regime is unchanged");
  });

  it("an internal countertrend stays countertrend while the external holds", () => {
    const pair = readStructurePair(candles, "H4", {
      externalLookback: 5,
      internalLookback: 3,
    });
    expect(pair.external.evidenceState).toBe("confirmed_event");
    expect(pair.external.direction).toBe("bullish");
    expect(pair.state).not.toBe("ALIGNED");
  });

  it("reports both sides unknown when neither window produced an event", () => {
    const pair = readStructurePair(MONOTONE_UP(), "H1", {
      externalLookback: 5,
      internalLookback: 3,
    });
    expect(pair.external.direction).toBe("none");
    expect(pair.internal.direction).toBe("none");
    expect(pair.state).toBe("BOTH_UNKNOWN");
    expect(pair.disagreement).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// G — MTF structural confluence
// ══════════════════════════════════════════════════════════════════

describe("G — MTF structural confluence", () => {
  const read = (dir: "up" | "down" | "flat", tf: string) =>
    readStructurePair(
      dir === "up" ? TREND_UP() : dir === "down" ? TREND_DOWN() : CONVERGING_RANGE(),
      tf,
      { externalLookback: 5, internalLookback: 3 },
    ).external;

  it("HTF + setup aligned → ALIGNED (a deterministic state, not a score)", () => {
    const c = structuralConfluence([
      { role: "structure", read: read("up", "H4") },
      { role: "setup", read: read("up", "H1") },
    ]);
    expect(c.state).toBe("ALIGNED_BULLISH");
    expect(c.htfDirection).toBe("bullish");
    expect(c.triggerPullback).toBe(false);
  });

  it("bearish HTF + bearish setup → ALIGNED_BEARISH", () => {
    const c = structuralConfluence([
      { role: "structure", read: read("down", "H4") },
      { role: "setup", read: read("down", "H1") },
    ]);
    expect(c.state).toBe("ALIGNED_BEARISH");
  });

  it("bullish HTF + bearish trigger → pullback inside the intact structure", () => {
    const c = structuralConfluence([
      { role: "structure", read: read("up", "H4") },
      { role: "setup", read: read("up", "H1") },
      { role: "trigger", read: read("down", "M15") },
    ]);
    expect(c.state).toBe("ALIGNED_BULLISH");
    expect(c.triggerDirection).toBe("bearish");
    expect(c.triggerPullback).toBe(true);
    expect(c.detail).toContain("pullback");
  });

  it("bullish HTF + bearish setup is NOT an alignment", () => {
    const c = structuralConfluence([
      { role: "structure", read: read("up", "H4") },
      { role: "setup", read: read("down", "H1") },
    ]);
    expect(c.state).toBe("COUNTER_TREND");
  });

  it("setup with no structural event → INCOMPLETE, never a forced direction", () => {
    const c = structuralConfluence([
      { role: "structure", read: read("up", "H4") },
      { role: "setup", read: read("flat", "H1") },
    ]);
    expect(c.state).toBe("INCOMPLETE");
    expect(c.setupDirection).toBe("none");
    expect(c.unresolvedRoles).toContain("setup");
  });

  it("macro and structure disagreeing → MIXED", () => {
    const c = structuralConfluence([
      { role: "macro", read: read("up", "D1") },
      { role: "structure", read: read("down", "H4") },
      { role: "setup", read: read("down", "H1") },
    ]);
    expect(c.state).toBe("MIXED");
    expect(c.detail).toContain("mixed");
  });

  it("no readable HTF → UNKNOWN", () => {
    const c = structuralConfluence([{ role: "setup", read: read("up", "H1") }]);
    expect(c.state).toBe("UNKNOWN");
    expect(c.htfDirection).toBe("none");
  });
});

// ══════════════════════════════════════════════════════════════════
// H — missing timeframes
// ══════════════════════════════════════════════════════════════════

describe("H — missing timeframes", () => {
  it("a failed fetch keeps its reason and is never replaced or synthesized", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "D1", role: "structure", candles: null, error: "[429] rate limited" },
      { timeframe: "H4", role: "setup", candles: TREND_UP() },
      { timeframe: "H1", role: "trigger", candles: null, error: "no candle data returned" },
    ]);
    expect(ctx.unavailable.map((u) => u.timeframe)).toEqual(["D1", "H1"]);
    expect(ctx.unavailable[0].reason).toContain("429");
    expect(ctx.chainUsed).toEqual(["H4"]);
    expect(ctx.timeframes.map((t) => t.timeframe)).toEqual(["H4"]);
    // No slot was invented for the missing timeframes.
    expect(ctx.timeframes.find((t) => t.timeframe === "D1")).toBeUndefined();
    // The confluence says UNKNOWN rather than borrowing the setup's direction.
    expect(ctx.structuralConfluence!.state).toBe("UNKNOWN");
    expect(ctx.structuralConfluence!.htfDirection).toBe("none");
  });

  it("too few candles → the timeframe is unavailable with its own reason", () => {
    const tiny = mk(EVENTS.slice(0, 12));
    const ctx = buildMtfContext("H1", [
      { timeframe: "D1", role: "structure", candles: tiny },
      { timeframe: "H1", role: "setup", candles: TREND_UP() },
    ]);
    expect(ctx.unavailable[0].timeframe).toBe("D1");
    expect(ctx.unavailable[0].reason).toContain("below the 20");
    expect(ctx.timeframes[0].structural).toBeDefined(); // H1 keeps its OWN read
    expect(ctx.structuralConfluence!.state).toBe("UNKNOWN");
  });

  it("each available timeframe exposes its own event, level and invalidation", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "D1", role: "structure", candles: TREND_UP() },
      { timeframe: "H4", role: "setup", candles: TREND_UP() },
      { timeframe: "H1", role: "trigger", candles: TREND_DOWN() },
    ]);
    for (const t of ctx.timeframes) {
      expect(t.structural).toBeDefined();
      expect(t.structural!.timeframe).toBe(t.timeframe);
      expect(t.structural!.evidenceState).toBe("confirmed_event");
      expect(t.structural!.lastEvent).toBeDefined();
      expect(t.structural!.lastEvent!.candleTime).toBeGreaterThan(0);
      expect(t.structural!.invalidation).toBeDefined();
    }
    const trigger = ctx.timeframes.find((t) => t.role === "trigger")!;
    expect(trigger.structural!.direction).toBe("bearish");
    expect(ctx.structuralConfluence!.htfDirection).toBe("bullish");
    expect(ctx.structuralConfluence!.triggerPullback).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// I — conflicting timeframes
// ══════════════════════════════════════════════════════════════════

describe("I — conflicting timeframes", () => {
  it("macro vs structure disagreement → MIXED (direction never forced)", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "W1", role: "macro", candles: TREND_UP() },
      { timeframe: "D1", role: "structure", candles: TREND_DOWN() },
      { timeframe: "H4", role: "setup", candles: TREND_DOWN() },
    ]);
    expect(ctx.alignment).toBe("MIXED");
    expect(ctx.structuralConfluence!.state).toBe("MIXED");
    expect(ctx.structuralConfluence!.htfDirection).toBe("bullish"); // macro outranks
  });

  it("setup against the HTF → COUNTER_TREND", () => {
    const ctx = buildMtfContext("H1", [
      { timeframe: "H4", role: "structure", candles: TREND_UP() },
      { timeframe: "H1", role: "setup", candles: TREND_DOWN() },
    ]);
    expect(ctx.htfBias).toBe("long");
    // Explicitly non-aligned — never forced into a direction. With no trigger
    // confirmation the legacy matrix calls it MIXED; the structural confluence
    // names the context COUNTER_TREND. Both are explicit disagreement states.
    expect(["MIXED", "COUNTER_TREND"]).toContain(ctx.alignment);
    expect(ctx.structuralConfluence!.state).toBe("COUNTER_TREND");
  });

  it("only the trigger opposing → pullback (COUNTER_TREND), never a reversal", () => {
    const ctx = buildMtfContext("H4", [
      { timeframe: "D1", role: "structure", candles: TREND_UP() },
      { timeframe: "H4", role: "setup", candles: TREND_UP() },
      { timeframe: "H1", role: "trigger", candles: TREND_DOWN() },
    ]);
    expect(ctx.alignment).toBe("COUNTER_TREND");
    expect(ctx.htfBias).toBe("long");
    // A continuation is not a reversal: with the event layer present only a
    // confirmed HTF CHoCH can be one, so trigger-only bearishness is not.
    expect(ctx.htfReversal).toBeUndefined();
    expect(ctx.structuralConfluence!.triggerPullback).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════
// J — no lookahead
// ══════════════════════════════════════════════════════════════════

describe("J — no lookahead", () => {
  const candles = mk(EVENTS);
  const full = readStructure(candles, "H1", { lookback: 1 });

  it("prefix invariance: a truncated series produces EXACTLY the events already known", () => {
    for (let n = 1; n <= candles.length; n += 1) {
      const partial = candles.slice(0, n);
      const read = readStructure(partial, "H1", { lookback: 1 });
      const expected = full.events.filter((e) => e.candleIndex <= n - 1);
      expect(read.events).toEqual(expected);
      const expectedDir =
        expected.length > 0 ? expected[expected.length - 1].direction : "none";
      expect(read.direction).toBe(expectedDir);
    }
  });

  it("a swing that needs a later candle is unknown until that candle closes", () => {
    // Candle 2 is the peak; it cannot exist without candle 3.
    expect(detectConfirmedSwings(candles.slice(0, 3), 1)).toEqual([]);
    const at3 = detectConfirmedSwings(candles.slice(0, 4), 1);
    expect(at3.map((s) => [s.kind, s.index])).toEqual([["high", 2]]);
    // …and the live edge is still never scanned for a new swing.
    expect(detectConfirmedSwings(candles, 1).some((s) => s.index === 14)).toBe(false);
  });

  it("event timestamps are the confirming candle, never the swing candle", () => {
    const bos = full.events[0];
    expect(bos.candleIndex).toBe(6);
    expect(bos.candleTime).toBe(candles[6].timestamp);
    expect(bos.candleTime).not.toBe(candles[2].timestamp);
    const choch = full.events[1];
    expect(choch.candleTime).toBe(candles[14].timestamp);
    expect(choch.candleTime).not.toBe(candles[11].timestamp);
  });

  it("a wider lookback never fires an event before its confirmation candle", () => {
    for (const lookback of [1, 2, 3, 5]) {
      const read = readStructure(candles, "H1", { lookback });
      for (const e of read.events) {
        expect(e.candleIndex).toBeGreaterThanOrEqual(lookback);
        expect(e.confirmedAtIndex).toBe(e.candleIndex);
        // The swing was knowable at or before the event candle.
        const swing = read.swings.find(
          (s) => s.index === e.brokenSwingIndex && s.kind === e.brokenSwingKind,
        )!;
        expect(swing.confirmedAtIndex).toBeLessThanOrEqual(e.candleIndex);
      }
    }
  });

  it("invalidation levels come only from swings knowable at the last candle", () => {
    const partial = candles.slice(0, 13);
    expect(partial).toHaveLength(13);
    const read = readStructure(partial, "H1", { lookback: 1 });
    expect(read.invalidation!.swingIndex).toBe(11); // the latest confirmed low
    expect(read.invalidation!.level).toBe(100.8);
    // No event or level in this read references a candle past the last one.
    for (const e of read.events) expect(e.candleIndex).toBeLessThan(13);
  });
});

// ══════════════════════════════════════════════════════════════════
// K — deterministic repeat
// ══════════════════════════════════════════════════════════════════

describe("K — deterministic repeat", () => {
  it("the same candles produce byte-identical structural reads", () => {
    const a = readStructure(TREND_UP(), "H4", { lookback: 5 });
    const b = readStructure(TREND_UP(), "H4", { lookback: 5 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("repeated calls on the SAME array are identical (no hidden state)", () => {
    const candles = mk(EVENTS);
    const first = readStructure(candles, "H1", { lookback: 1 });
    const second = readStructure(candles, "H1", { lookback: 1 });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(second.events).toEqual(first.events);
  });

  it("the MTF context is reproducible", () => {
    const build = () =>
      buildMtfContext("H4", [
        { timeframe: "D1", role: "structure", candles: TREND_UP() },
        { timeframe: "H4", role: "setup", candles: TREND_UP() },
        { timeframe: "H1", role: "trigger", candles: TREND_DOWN() },
      ]);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

// ══════════════════════════════════════════════════════════════════
// Edge cases — insufficient history, one swing, range, trends
// ══════════════════════════════════════════════════════════════════

describe("edge cases — explicit evidence states", () => {
  it("insufficient history is stated, never guessed", () => {
    const read = readStructure(mk(EVENTS.slice(0, 8)), "H1", { lookback: 5 });
    expect(read.evidenceState).toBe("insufficient_history");
    expect(read.direction).toBe("none");
    expect(read.events).toEqual([]);
    expect(read.reason).toContain("below the 13");
  });

  it("no confirmed swings is stated", () => {
    const read = readStructure(MONOTONE_UP(), "H1", { lookback: 5 });
    expect(read.evidenceState).toBe("no_confirmed_swings");
    expect(read.direction).toBe("none");
    expect(read.reason).toContain("No confirmed swing");
  });

  it("only one swing → no_event, never a fabricated break", () => {
    const rows: Row[] = [
      [100.0, 100.4, 99.6, 100.0],
      [100.0, 103.0, 99.9, 102.0], // the only swing high
      [102.0, 102.6, 101.6, 102.4],
      [102.4, 103.2, 102.0, 103.0], // closes exactly AT the level — not beyond it
      [103.0, 104.0, 102.6, 102.9], // pierces it, closes back below
    ];
    const read = readStructure(mk(rows), "H1", { lookback: 1 });
    expect(read.swings.map((s) => s.kind)).toEqual(["high"]);
    expect(read.evidenceState).toBe("no_event");
    expect(read.direction).toBe("none");
    expect(read.events).toEqual([]);
    expect(read.reason).toContain("unbroken");
  });

  it("range → no event and no direction", () => {
    const read = readStructure(CONVERGING_RANGE(), "H1", { lookback: 3 });
    expect(read.evidenceState).toBe("no_event");
    expect(read.direction).toBe("none");
    expect(read.regime).toBe("range");
  });

  it("bullish and bearish trends both produce a direction with an event", () => {
    const up = readStructure(TREND_UP(), "H1", { lookback: 5 });
    expect(up.direction).toBe("bullish");
    expect(up.evidenceState).toBe("confirmed_event");
    expect(up.lastEvent!.direction).toBe("bullish");

    const down = readStructure(TREND_DOWN(), "H1", { lookback: 5 });
    expect(down.direction).toBe("bearish");
    expect(down.evidenceState).toBe("confirmed_event");
    expect(down.lastEvent!.direction).toBe("bearish");
  });

  it("the digest names structure, event, level and invalidation", () => {
    const read = readStructure(mk(EVENTS), "H1", { lookback: 1 });
    const digest = structureDigest(read).join("\n");
    expect(digest).toContain("H1 [confirmed_event] structure=");
    expect(digest).toContain("latest CHOCH bearish");
    // Bearish read → the LATEST confirmed structural high is the invalidation
    // (swing #13 closed at 102.8), not the older, higher swing #8.
    expect(digest).toContain("invalidation 102.8");
    expect(digest).toContain("structural high #13");
  });

  it("digest states a WICK-only situation without claiming an event", () => {
    const rows: Row[] = [
      [100.0, 100.4, 99.6, 100.0],
      [100.0, 101.5, 99.9, 101.0],
      [101.0, 103.0, 100.9, 102.0],
      [102.0, 102.2, 100.0, 100.5],
      [100.5, 103.8, 100.4, 102.2],
    ];
    const read = readStructure(mk(rows), "H1", { lookback: 1 });
    expect(read.evidenceState).toBe("no_event");
    expect(read.wickOnlyRejections).toBe(1);
    expect(structureDigest(read).join("\n")).toContain("structure is unbroken");
  });
});

// ══════════════════════════════════════════════════════════════════
// L. Data-integrity guard — a manipulated candle is not structure
// ══════════════════════════════════════════════════════════════════

describe("L. anomalous pivot candles never become structural levels", () => {
  /** 80 monotone-up candles; index 40 is replaced by a manipulated bar. */
  const manipulatedSeries = (spike: [number, number, number, number]) => {
    const rows: Row[] = Array.from({ length: 80 }, (_, i) => {
      const price = 60_000 + i * 50;
      return [price - 20, price + 30, price - 40, price] as Row;
    });
    rows[40] = spike;
    return mk(rows);
  };

  it("ignores a pivot candle whose range is orders of magnitude beyond ATR", () => {
    const price = 60_000 + 40 * 50;
    // Same anomaly phase-24 uses: a 50 000-wide wick on an otherwise calm series.
    const candles = manipulatedSeries([price, price + 1000, price - 50_000, price - 500]);
    const read = readStructure(candles, "D1", { lookback: 5 });

    expect(read.anomalousPivots.length).toBe(2); // both extremes of that bar
    expect(read.anomalousPivots.every((a) => a.range > ANOMALY_RANGE_ATR_MULT * a.atr)).toBe(true);
    // The manipulated bar cannot authorise structure: no swing, no event, no direction.
    expect(read.swings.length).toBe(0);
    expect(read.events.length).toBe(0);
    expect(read.direction).toBe("none");
    expect(read.evidenceState).toBe("no_confirmed_swings");
    expect(read.reason).toContain("anomalous pivot");
    expect(structureDigest(read).join("\n")).toContain("ignored 2 anomalous pivot candle(s)");
  });

  it("leaves ordinary structure untouched (guard never fires on a normal series)", () => {
    const read = readStructure(TREND_UP(), "H1", { lookback: 5 });
    expect(read.anomalousPivots).toEqual([]);
    expect(read.evidenceState).toBe("confirmed_event");
    expect(read.lastEvent!.kind).toBe("BOS");
    expect(read.lastEvent!.direction).toBe("bullish");
  });

  it("exposes the raw pivots when a caller opts out of the guard", () => {
    const price = 60_000 + 40 * 50;
    const candles = manipulatedSeries([price, price + 1000, price - 50_000, price - 500]);
    const raw = scanConfirmedSwings(candles, 5, { anomalyGuard: false });
    expect(raw.anomalies).toEqual([]);
    expect(raw.swings.length).toBeGreaterThan(0);
    // …and with the guard on, the very same pivots are the ones rejected.
    expect(scanConfirmedSwings(candles, 5).swings.length).toBe(0);
  });
});
