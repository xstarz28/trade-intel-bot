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
import type { ConfirmedSwing } from "./structure";
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

/**
 * Bullish regime fixture (lookback 2) with the pre-event extreme DELIBERATELY
 * more extreme than the post-event one:
 *   high 101.4 @2 (confirmed at 4) · low 98.4 @4 (confirmed at 6)   ← pre-event
 *   BOS bullish at candle 8 (close 102.2 > 101.4)                   ← regime event
 *   low 100.2 @11 (confirmed at 13) · low 100.7 @15 (confirmed at 17) ← post-event
 * `98.4` is the pre-BOS protection and must never become the regime's major line.
 */
const REGIME_BULL_ROWS: Row[] = [
  [100.0, 100.5, 98.0, 100.2],
  [100.2, 101.0, 99.5, 100.8],
  [100.8, 101.4, 99.8, 101.2],
  [101.2, 101.3, 99.9, 100.5],
  [100.5, 100.9, 98.4, 99.0],
  [99.0, 99.6, 98.6, 99.4],
  [99.4, 100.2, 98.9, 100.0],
  [100.0, 101.0, 99.6, 100.8],
  [100.8, 102.5, 100.6, 102.2],
  [102.2, 103.0, 102.0, 102.6],
  [102.6, 103.2, 100.9, 101.2],
  [101.2, 101.5, 100.2, 100.4],
  [100.4, 101.9, 100.3, 100.8],
  [100.8, 101.5, 101.0, 101.4],
  [101.4, 101.5, 101.0, 101.2],
  [101.2, 101.3, 100.7, 100.9],
  [101.6, 102.2, 101.2, 101.9],
  [101.9, 102.4, 101.5, 102.0],
];

/**
 * Exact mirror of a fixture around its own mid-price: highs become lows and
 * strict inequalities survive untouched, so a bullish case becomes the
 * structurally identical bearish case (regime event, protected side, extremes).
 */
const mirrorRows = (rows: Row[]): Row[] => {
  const m = Math.max(...rows.map((r) => r[1])) + Math.min(...rows.map((r) => r[2]));
  return rows.map(([o, h, l, c]) => [m - o, m - l, m - h, m - c]);
};

/**
 * Lagging-confirmation fixture: a swing whose confirmation LAGS the first
 * close-through — the contract this walk accepts from any caller-supplied swing
 * list (a streamed feed, a slower confirmation policy, a replayed list).
 *   · pivot high 105 @2, only knowable at candle 5;
 *   · candle 3 already CLOSES at 106 — beyond 105, BEFORE the level existed;
 *   · candle 5 (the confirmation candle) is still beyond it;
 *   · newer pivot high 112 @7, knowable at candle 10, still below it until 12.
 */
const LAGGING_BREAK_ROWS: Row[] = [
  [100.0, 101.0, 99.0, 100.0],
  [100.0, 104.5, 99.0, 104.0],
  [104.0, 105.0, 103.0, 104.5],
  [104.5, 107.0, 104.0, 106.0],
  [106.0, 108.0, 105.5, 107.0],
  [107.0, 109.0, 105.5, 108.0],
  [108.0, 110.0, 107.0, 109.0],
  [109.0, 112.0, 108.0, 111.0],
  [111.0, 111.5, 109.0, 110.0],
  [110.0, 111.0, 110.5, 110.8],
  [110.8, 111.0, 109.5, 110.0],
  [110.0, 111.0, 110.5, 110.7],
  [110.7, 113.0, 110.6, 112.5],
];
const laggingSwings = (candles: OhlcvCandle[]): ConfirmedSwing[] => [
  { kind: "high", price: 105.0, index: 2, confirmedAtIndex: 5, timestamp: candles[2].timestamp },
  { kind: "high", price: 112.0, index: 7, confirmedAtIndex: 10, timestamp: candles[7].timestamp },
];

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
// B2 — a break must be a CROSSING, never a state found already beyond
// ══════════════════════════════════════════════════════════════════

describe("B2 — lagging confirmation cannot create a late BOS/CHoCH", () => {
  const rows = LAGGING_BREAK_ROWS;
  const candles = mk(rows);
  const swings = laggingSwings(candles);

  it("emits nothing at the confirmation candle for a pre-confirmation close-through", () => {
    // Candle 3 closed through 105 while the level was still unknowable.
    expect(candles[3].close).toBeGreaterThan(105.0);
    const upToConfirmation = detectStructureEvents(candles.slice(0, 6), swings);
    expect(upToConfirmation.events).toEqual([]);
    // …and nothing is backdated to the candle that really closed through it.
    expect(upToConfirmation.events.some((e) => e.candleIndex === 3)).toBe(false);
    // It is a state, not a rejection either: no wick claim is invented.
    expect(upToConfirmation.wickOnlyRejections).toBe(0);
  });

  it("still reports a genuine later crossing, at the crossing candle, on the newer level", () => {
    const { events } = detectStructureEvents(candles, swings);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe("BOS"); // no prior regime → establishing break, never CHoCH
    expect(e.direction).toBe("bullish");
    expect(e.brokenLevel).toBe(112.0); // the newer confirmed level
    expect(e.brokenSwingIndex).toBe(7);
    expect(e.candleIndex).toBe(12); // the candle that CROSSED, not the confirmation candle
    expect(e.confirmedAtIndex).toBe(12);
    expect(e.candleTime).toBe(candles[12].timestamp);
    // The candle before the event is on the original side of the level.
    expect(candles[11].close).toBeLessThanOrEqual(e.brokenLevel);
    expect(candles[12].close).toBeGreaterThan(e.brokenLevel);
  });

  it("the same rule holds on the downside (mirrored series)", () => {
    const downRows = mirrorRows(rows);
    const downCandles = mk(downRows);
    const downSwings: ConfirmedSwing[] = [
      { kind: "low", price: downRows[2][2], index: 2, confirmedAtIndex: 5, timestamp: downCandles[2].timestamp },
      { kind: "low", price: downRows[7][2], index: 7, confirmedAtIndex: 10, timestamp: downCandles[7].timestamp },
    ];
    expect(downCandles[3].close).toBeLessThan(downSwings[0].price);
    expect(detectStructureEvents(downCandles.slice(0, 6), downSwings).events).toEqual([]);
    const { events } = detectStructureEvents(downCandles, downSwings);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe("BOS");
    expect(events[0].direction).toBe("bearish");
    expect(events[0].brokenLevel).toBe(downSwings[1].price);
    expect(events[0].candleIndex).toBe(12);
  });

  it("prefix walk: no level before confirmation, no late event at it, real crossings after", () => {
    const full = detectStructureEvents(candles, swings).events;
    for (let n = 1; n <= candles.length; n += 1) {
      const { events } = detectStructureEvents(candles.slice(0, n), swings);
      // Nothing may appear before the confirmation candle at all…
      if (n <= 6) expect(events).toEqual([]);
      // …and every prefix agrees exactly with the events already known by then.
      expect(events).toEqual(full.filter((e) => e.candleIndex <= n - 1));
      for (const e of events) {
        const prev = candles[e.candleIndex - 1].close;
        const crossedUp = e.direction === "bullish" && prev <= e.brokenLevel;
        const crossedDown = e.direction === "bearish" && prev >= e.brokenLevel;
        expect(crossedUp || crossedDown).toBe(true);
      }
    }
    expect(full).toHaveLength(1);
    expect(full[0].candleIndex).toBe(12);
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

  it("majorInvalidation is scoped to the POST-event regime, never a pre-event extreme", () => {
    const read = readStructure(mk(REGIME_BULL_ROWS), "H1", { lookback: 2 });
    const event = read.lastEvent!;
    expect(read.direction).toBe("bullish");
    expect(event.kind).toBe("BOS");
    expect(event.candleIndex).toBe(8); // the regime-establishing event

    // Trailing protection is UNCHANGED: the latest confirmed protected low.
    expect(read.invalidation!.swingKind).toBe("low");
    expect(read.invalidation!.swingIndex).toBe(15);
    expect(read.invalidation!.level).toBeCloseTo(100.7, 10);

    // The regime line comes from the post-event sequence only…
    expect(read.majorInvalidation!.swingKind).toBe("low");
    expect(read.majorInvalidation!.swingIndex).toBe(11);
    expect(read.majorInvalidation!.level).toBeCloseTo(100.2, 10);
    expect(read.majorInvalidation!.swingIndex).toBeGreaterThan(event.candleIndex);
    // …and the MORE extreme pre-BOS low (98.4 @4) is not it.
    const preEventLow = read.swings.find((s) => s.kind === "low" && s.index === 4)!;
    expect(preEventLow.price).toBeCloseTo(98.4, 10);
    expect(preEventLow.price).toBeLessThan(read.majorInvalidation!.level);
    expect(read.majorInvalidation!.level).not.toBeCloseTo(preEventLow.price, 10);
    // The output states both lines when they differ.
    expect(structureDigest(read).join("\n")).toContain(
      "H1 regime invalidation 100.2 (extreme low #11)",
    );
  });

  it("the mirrored bearish regime obeys the same scope", () => {
    const rows = mirrorRows(REGIME_BULL_ROWS);
    const read = readStructure(mk(rows), "H1", { lookback: 2 });
    const event = read.lastEvent!;
    expect(read.direction).toBe("bearish");
    expect(event.direction).toBe("bearish");
    expect(event.candleIndex).toBe(8);
    expect(read.invalidation!.swingKind).toBe("high");
    expect(read.invalidation!.swingIndex).toBe(15);
    expect(read.majorInvalidation!.swingIndex).toBe(11);
    expect(read.majorInvalidation!.swingIndex).toBeGreaterThan(event.candleIndex);
    // The pre-event high is the more extreme one and must stay ignored.
    const preEventHighs = read.swings.filter(
      (s) => s.kind === "high" && s.index < event.candleIndex,
    );
    expect(preEventHighs.length).toBeGreaterThan(0);
    expect(read.majorInvalidation!.level).toBeLessThan(
      Math.max(...preEventHighs.map((s) => s.price)),
    );
  });

  it("a regime with no post-event protected swing exposes NO major level", () => {
    // Prefix ending just after the BOS: the only protected low (98.4 @4) predates it.
    const read = readStructure(mk(REGIME_BULL_ROWS.slice(0, 10)), "H1", { lookback: 2 });
    expect(read.direction).toBe("bullish");
    expect(read.lastEvent!.candleIndex).toBe(8);
    expect(read.majorInvalidation).toBeUndefined(); // absence preserved, nothing invented
    expect(read.swings.filter((s) => s.kind === "low" && s.index > 8)).toEqual([]);
    // …while the trailing invalidation keeps the pre-event protection it always had.
    expect(read.invalidation!.swingIndex).toBe(4);
    expect(read.invalidation!.level).toBeCloseTo(98.4, 10);

    // Production fixture: TREND_UP's BOS is followed by a monotone rally.
    const trend = readStructure(TREND_UP(), "H1", { lookback: 5 });
    expect(trend.lastEvent!.kind).toBe("BOS");
    expect(trend.events[trend.events.length - 1].direction).toBe("bullish");
    expect(trend.swings.filter((s) => s.kind === "low" && s.index > trend.lastEvent!.candleIndex)).toEqual([]);
    expect(trend.invalidation).toBeDefined();
    expect(trend.majorInvalidation).toBeUndefined();
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

  it("every event ever emitted is a genuine close-through, for every prefix", () => {
    const fixtures: Array<[string, OhlcvCandle[], number]> = [
      ["EVENTS", candles, 1],
      ["TREND_UP", TREND_UP(), 3],
      ["TREND_DOWN", TREND_DOWN(), 3],
      ["STAIRCASE", STAIRCASE(), 5],
      ["CONVERGING_RANGE", CONVERGING_RANGE(), 3],
      ["REGIME_BULL", mk(REGIME_BULL_ROWS), 2],
      ["REGIME_BEAR", mk(mirrorRows(REGIME_BULL_ROWS)), 2],
    ];
    let checked = 0;
    for (const [name, series, lookback] of fixtures) {
      for (let n = 1; n <= series.length; n += 1) {
        const read = readStructure(series.slice(0, n), "H1", { lookback });
        for (const e of read.events) {
          checked += 1;
          const close = series[e.candleIndex].close;
          const prev = series[e.candleIndex - 1].close;
          if (e.direction === "bullish") {
            expect(close, `${name} close@${e.candleIndex}`).toBeGreaterThan(e.brokenLevel);
            expect(prev, `${name} prevClose@${e.candleIndex}`).toBeLessThanOrEqual(e.brokenLevel);
          } else {
            expect(close, `${name} close@${e.candleIndex}`).toBeLessThan(e.brokenLevel);
            expect(prev, `${name} prevClose@${e.candleIndex}`).toBeGreaterThanOrEqual(e.brokenLevel);
          }
          // The event is stamped by the candle that confirmed it, never backdated…
          expect(e.confirmedAtIndex).toBe(e.candleIndex);
          expect(e.candleTime).toBe(series[e.candleIndex].timestamp);
          // …and its level belonged to a swing that was already knowable by then.
          const owner = read.swings.find(
            (s) => s.index === e.brokenSwingIndex && s.kind === e.brokenSwingKind,
          );
          expect(owner, `${name} owner@${e.brokenSwingIndex}`).toBeDefined();
          expect(owner!.confirmedAtIndex).toBeLessThanOrEqual(e.candleIndex);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("a lagging swing is unusable before confirmation and never relabelled at it", () => {
    const series = mk(LAGGING_BREAK_ROWS);
    const swings = laggingSwings(series);
    const full = detectStructureEvents(series, swings).events;
    expect(full).toHaveLength(1);
    expect(full[0].candleIndex).toBe(12);

    for (let n = 1; n <= series.length; n += 1) {
      const { events } = detectStructureEvents(series.slice(0, n), swings);
      // Prefix invariance in the presence of an unconfirmed swing.
      expect(events).toEqual(full.filter((e) => e.candleIndex <= n - 1));
      // Before the level is knowable it can never appear as a broken level…
      if (n <= 5) {
        expect(events).toEqual([]);
        expect(events.some((e) => e.brokenLevel === 105.0)).toBe(false);
      }
      // …and the confirmation candle does not convert that earlier close-through
      // into a fresh event.
      if (n === 6) expect(events).toEqual([]);
      for (const e of events) {
        const owner = swings.find((s) => s.index === e.brokenSwingIndex)!;
        expect(owner.confirmedAtIndex).toBeLessThanOrEqual(e.candleIndex);
        expect(e.candleTime).toBe(series[e.candleIndex].timestamp);
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
