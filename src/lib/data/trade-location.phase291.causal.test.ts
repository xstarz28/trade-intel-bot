/**
 * Phase 291 — CAUSALITY (no lookahead) for the SMC objects the location layer
 * is built on, plus the location invariants on real provider candles.
 *
 * The rules under test:
 *   · an FVG exists only once all THREE candles exist, and its knowledge time is
 *     the confirming candle; mitigation and invalidation are different facts;
 *   · a liquidity pool is not actionable before the swing that formed it has
 *     been confirmed, so a wick through the level BEFORE that candle is not a
 *     sweep — and it can never be retro-labelled once the pool becomes known;
 *   · an order block cannot be validated before its displacement AND a matching
 *     confirmed structural event;
 *   · running the engine on a prefix of the series cannot produce an object the
 *     full series contradicts, and no object may claim knowledge from a candle
 *     that had not printed yet.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  buildLiquidityPools,
  computeSmcContext,
  detectFvgs,
  detectOrderBlocks,
  detectSwingPoints,
  type SwingPoint,
} from "./smc";
import { readStructurePair } from "./structure";
import { anchorFromCandles, readZoneLocation } from "./trade-location";
import type { OhlcvCandle } from "./market-types";

const T = (i: number) => 1700000000000 + i * 3600000;

function candle(t: number, open: number, high: number, low: number, close: number, volume = 100): OhlcvCandle {
  return { timestamp: t, open, high, low, close, volume };
}

/** Flat filler candle — keeps indices explicit and detection honest. */
const flat = (i: number, price = 100): OhlcvCandle => candle(T(i), price, price + 1, price - 1, price);

// ── FVG: three-candle concept and lifecycle ───────────────────────

describe("Phase 291 causality — FVG creation, mitigation, invalidation", () => {
  // Candle 0 tops at 100, candle 2 starts at 103 → a 100–103 bullish gap.
  const threeCandles: OhlcvCandle[] = [
    candle(T(0), 99, 100, 98, 99.5),
    candle(T(1), 99.5, 101, 99, 100.5),
    candle(T(2), 101, 104, 103, 103.5),
  ];

  it("an FVG does not exist before its third candle", () => {
    expect(detectFvgs(threeCandles.slice(0, 2), "H4", 1).filter((f) => f.direction === "bullish")).toHaveLength(0);
    const created = detectFvgs(threeCandles, "H4", 1);
    const bullish = created.find((f) => f.direction === "bullish")!;
    expect(bullish.createdAtIndex).toBe(2);
    expect(bullish.createdAt).toBe(T(2));
    expect(bullish.lower).toBe(100);
    expect(bullish.upper).toBe(103);
    expect(bullish.status).toBe("fresh");
  });

  it("the FVG's creation fields never change when later candles trade through it", () => {
    const gapAt = (series: OhlcvCandle[]) =>
      detectFvgs(series, "H4", 1).find((f) => f.direction === "bullish" && f.createdAtIndex === 2)!;
    const before = gapAt(threeCandles);
    const withRetest = [
      ...threeCandles,
      candle(T(3), 103, 104, 101.5, 102), // wick into the gap, closes inside
    ];
    const after = gapAt(withRetest);
    expect(after.createdAtIndex).toBe(before.createdAtIndex);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.upper).toBe(before.upper);
    expect(after.lower).toBe(before.lower);
  });

  it("mitigation (a retest) is NOT invalidation (a close through)", () => {
    const mitigated = detectFvgs([...threeCandles, candle(T(3), 103, 104, 101.5, 102)], "H4", 1).find(
      (f) => f.direction === "bullish" && f.createdAtIndex === 2,
    )!;
    expect(mitigated.status).toBe("mitigated");
    expect(mitigated.mitigatedAtIndex).toBe(3);
    expect(mitigated.invalidatedAtIndex).toBeUndefined();

    const invalidated = detectFvgs([...threeCandles, candle(T(3), 103, 103.2, 98, 98.5)], "H4", 1).find(
      (f) => f.direction === "bullish" && f.createdAtIndex === 2,
    )!;
    expect(invalidated.status).toBe("invalidated");
    expect(invalidated.invalidatedAtIndex).toBe(3);
  });

  it("records both facts when a gap is retested and later closed through, and invalidation outranks mitigation", () => {
    const gap = detectFvgs(
      [
        ...threeCandles,
        candle(T(3), 103, 104, 101.5, 102), // retest → mitigated
        candle(T(4), 102, 102.5, 97, 97.5), // close through → invalidated
      ],
      "H4",
      1,
    ).find((f) => f.direction === "bullish" && f.createdAtIndex === 2)!;
    expect(gap.mitigatedAtIndex).toBe(3);
    expect(gap.invalidatedAtIndex).toBe(4);
    expect(gap.status).toBe("invalidated");
  });

  it("a status recorded on a prefix never references a candle past that prefix", () => {
    const series = [...threeCandles, candle(T(3), 103, 104, 101.5, 102)];
    for (let n = 3; n <= series.length; n++) {
      for (const f of detectFvgs(series.slice(0, n), "H4", 1)) {
        expect(f.createdAtIndex).toBeLessThan(n);
        if (f.mitigatedAtIndex !== undefined) expect(f.mitigatedAtIndex).toBeLessThan(n);
        if (f.invalidatedAtIndex !== undefined) expect(f.invalidatedAtIndex).toBeLessThan(n);
      }
    }
  });
});

// ── Liquidity: pool knowledge timing ──────────────────────────────

describe("Phase 291 causality — liquidity pool confirmation timing", () => {
  const LEVEL = 110;
  // A swing high at index 5 that only becomes knowable at index 8.
  const swingHigh: SwingPoint = { price: LEVEL, index: 5, confirmedAtIndex: 8 };

  function seriesWithWickAt(index: number, closeBelow = true): OhlcvCandle[] {
    const out: OhlcvCandle[] = [];
    for (let i = 0; i < 12; i++) out.push(flat(i));
    out[index] = candle(T(index), 100, LEVEL + 1, 99, closeBelow ? 100 : LEVEL + 0.5);
    return out;
  }

  it("a wick through the level BEFORE the swing was confirmed is not a sweep", () => {
    const { pools, sweeps } = buildLiquidityPools(seriesWithWickAt(6), [swingHigh], []);
    const pool = pools.find((p) => p.level === LEVEL)!;
    expect(pool.formedAtIndex).toBe(8);
    expect(pool.swept).toBe(false);
    expect(sweeps.filter((s) => s.level === LEVEL)).toHaveLength(0);
  });

  it("the same level IS swept once price wicks through it after confirmation", () => {
    const { pools, sweeps } = buildLiquidityPools(seriesWithWickAt(9), [swingHigh], []);
    const pool = pools.find((p) => p.level === LEVEL)!;
    expect(pool.swept).toBe(true);
    expect(pool.sweptAtIndex).toBe(9);
    const events = sweeps.filter((s) => s.level === LEVEL);
    expect(events).toHaveLength(1);
    expect(events[0].candleIndex).toBe(9);
    expect(events[0].poolFormedAtIndex).toBe(8);
    expect(events[0].poolFormedAtTime).toBe(T(8));
    // The event can never be dated before the pool was knowable.
    expect(events[0].candleIndex).toBeGreaterThan(events[0].poolFormedAtIndex);
  });

  it("a close through the level is a breakout (broken level), not a sweep", () => {
    const { pools, sweeps } = buildLiquidityPools(seriesWithWickAt(9, false), [swingHigh], []);
    const pool = pools.find((p) => p.level === LEVEL)!;
    expect(pool.broken).toBe(true);
    expect(pool.swept).toBe(false);
    expect(sweeps.filter((s) => s.level === LEVEL)).toHaveLength(0);
  });

  it("a pool produces at most ONE sweep event however many times price wicks through", () => {
    const series = seriesWithWickAt(9, false);
    series[9] = candle(T(9), 100, LEVEL + 1, 99, 100); // wick
    series[10] = candle(T(10), 100, LEVEL + 2, 99, 100); // wick again
    series[11] = candle(T(11), 100, LEVEL + 3, 99, 100); // and again
    const { pools, sweeps } = buildLiquidityPools(series, [swingHigh], []);
    expect(pools.find((p) => p.level === LEVEL)!.sweptAtIndex).toBe(9);
    expect(sweeps.filter((s) => s.level === LEVEL)).toHaveLength(1);
  });
});

// ── Equal highs / lows keep exact swing identities ────────────────

describe("Phase 291 causality — equal-level clusters keep swing identities", () => {
  it("an equal-high cluster reports every participating swing with its own confirmation", () => {
    const swings: SwingPoint[] = [
      { price: 110, index: 3, confirmedAtIndex: 6 },
      { price: 110.05, index: 9, confirmedAtIndex: 12 }, // within 0.15%
    ];
    const series: OhlcvCandle[] = [];
    for (let i = 0; i < 16; i++) series.push(flat(i));
    series[3] = candle(T(3), 100, 110, 99, 100);
    series[9] = candle(T(9), 100, 110.05, 99, 100);
    series[14] = candle(T(14), 100, 111, 99, 100); // sweep after both confirmations

    const { pools, sweeps } = buildLiquidityPools(series, swings, []);
    const pool = pools.find((p) => p.source === "equal_highs")!;
    expect(pool.touches).toBe(2);
    expect(pool.level).toBe(110.05);
    // Knowledge = the LAST participant's confirmation candle, never the first.
    expect(pool.formedAtIndex).toBe(12);
    expect(pool.sourceSwings.map((s) => s.index)).toEqual([3, 9]);
    expect(pool.sourceSwings.map((s) => s.confirmedAtIndex)).toEqual([6, 12]);
    expect(sweeps.filter((s) => s.source === "equal_highs")).toHaveLength(1);
    expect(sweeps[0].candleIndex).toBe(14);
  });
});

// ── Order blocks: candidate → displacement → confirmed event ──────

describe("Phase 291 causality — order block validation ordering", () => {
  function obSeries(): OhlcvCandle[] {
    const out: OhlcvCandle[] = [];
    for (let i = 0; i < 20; i++) out.push(flat(i, 100));
    out[10] = candle(T(10), 102, 103, 99, 99.5); // opposing (down) candle → bullish candidate
    out[11] = candle(T(11), 99.5, 106, 99.4, 105.5); // displacement up
    return out;
  }

  it("no order block exists without the candles that validate it (displacement alone is not enough)", () => {
    const series = obSeries();
    const blocks = detectOrderBlocks(series.slice(0, 13), "H4", 1);
    expect(blocks.filter((b) => b.sourceIndex === 10)).toHaveLength(0);
  });

  it("legacy validation still waits for the pre-window close, never for the candidate candle", () => {
    const series = obSeries();
    // Close 105.5 at index 11 clears the pre-window high (100+1 = 101) → validated at 11.
    const blocks = detectOrderBlocks(series, "H4", 1);
    const block = blocks.find((b) => b.sourceIndex === 10)!;
    expect(block).toBeDefined();
    expect(block.evidence.validationMethod).toBe("legacy_pre_window_close");
    expect(block.validatedAtIndex).toBe(11);
    expect(block.validatedAtIndex).toBeGreaterThan(block.displacementIndex - 1);
  });

  it("with an authoritative structural read, a block validates only on a matching confirmed event at/after displacement", () => {
    const series = obSeries();
    // A confirmed BULLISH read whose only event fires BEFORE the displacement.
    const earlyEvents = {
      events: [
        {
          kind: "BOS" as const,
          direction: "bullish" as const,
          brokenLevel: 101,
          brokenSwingIndex: 3,
          brokenSwingKind: "high" as const,
          candleIndex: 6,
          candleTime: T(6),
        },
      ],
    };
    const tooEarly = detectOrderBlocks(series, "H4", 1, earlyEvents as never);
    expect(tooEarly.filter((b) => b.sourceIndex === 10)).toHaveLength(0);

    // The same block with an event AFTER its displacement validates on that event.
    const lateEvents = {
      events: [
        {
          kind: "BOS" as const,
          direction: "bullish" as const,
          brokenLevel: 101,
          brokenSwingIndex: 8,
          brokenSwingKind: "high" as const,
          candleIndex: 12,
          candleTime: T(12),
        },
      ],
    };
    const validated = detectOrderBlocks(series, "H4", 1, lateEvents as never).find((b) => b.sourceIndex === 10)!;
    expect(validated).toBeDefined();
    expect(validated.evidence.validationMethod).toBe("confirmed_structural_event");
    expect(validated.validatedAtIndex).toBe(12);
    expect(validated.validatedAtIndex).toBeGreaterThanOrEqual(validated.displacementIndex);
    expect(validated.structuralEvent!.kind).toBe("BOS");
    expect(validated.structuralEvent!.brokenLevel).toBe(101);
  });

  it("a block can never be validated by an event in the opposite direction", () => {
    const series = obSeries();
    const wrongDirection = {
      events: [
        {
          kind: "BOS" as const,
          direction: "bearish" as const,
          brokenLevel: 99,
          brokenSwingIndex: 9,
          brokenSwingKind: "low" as const,
          candleIndex: 12,
          candleTime: T(12),
        },
      ],
    };
    expect(detectOrderBlocks(series, "H4", 1, wrongDirection as never).filter((b) => b.sourceIndex === 10)).toHaveLength(0);
  });

  it("block status only ever reads candles AFTER the validation candle", () => {
    const series = obSeries();
    series.push(candle(T(12), 105.5, 106, 105, 105.8));
    const block = detectOrderBlocks(series, "H4", 1).find((b) => b.sourceIndex === 10)!;
    if (block.mitigatedAtIndex !== undefined) expect(block.mitigatedAtIndex).toBeGreaterThan(block.validatedAtIndex);
    if (block.invalidatedAtIndex !== undefined) expect(block.invalidatedAtIndex).toBeGreaterThan(block.validatedAtIndex);
  });
});

// ── Real recorded candles: prefix invariance & location invariants ─

describe("Phase 291 causality — recorded OKX candles", () => {
  const fixture = JSON.parse(
    fs.readFileSync("src/lib/data/__fixtures__/real-provider-candles.phase290a.json", "utf8"),
  ) as { bars: Record<string, string[][]> };

  const load = (raw: string[][]): OhlcvCandle[] =>
    [...raw]
      .reverse()
      .map((r) => ({
        timestamp: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        volume: Number(r[5]),
      }));

  const H4 = load(fixture.bars["4H"]);

  it("running the engine on a prefix cannot invent an object the full series contradicts", () => {
    const full = computeSmcContext(H4, "H4");
    for (let n = 12; n < H4.length; n++) {
      const prefix = computeSmcContext(H4.slice(0, n), "H4");
      // Every object the prefix knows must exist in the full run with the same
      // creation / validation fields — the future never rewrites the past.
      for (const p of prefix.orderBlocks) {
        const same = full.orderBlocks.find((f) => f.sourceIndex === p.sourceIndex);
        if (!same) continue; // window caps may drop it in the full run; never fabricated
        expect(same.validatedAtIndex).toBe(p.validatedAtIndex);
        expect(same.lower).toBe(p.lower);
        expect(same.upper).toBe(p.upper);
        expect(same.direction).toBe(p.direction);
      }
      for (const f of prefix.fvgs) {
        const same = full.fvgs.find((g) => g.createdAtIndex === f.createdAtIndex && g.direction === f.direction);
        if (!same) continue;
        expect(same.lower).toBe(f.lower);
        expect(same.upper).toBe(f.upper);
      }
      // No knowledge from a candle that had not printed yet.
      for (const p of prefix.liquidityPools) expect(p.formedAtIndex).toBeLessThan(n);
      for (const e of prefix.recentSweep ? [prefix.recentSweep] : []) {
        expect(e.candleIndex).toBeLessThan(n);
        expect(e.poolFormedAtIndex).toBeLessThan(n);
      }
    }
  });

  it("statuses only ADVANCE when candles are appended (fresh → mitigated → invalidated)", () => {
    const rank = { fresh: 0, mitigated: 1, invalidated: 2 } as Record<string, number>;
    for (let n = 12; n < H4.length; n++) {
      const prefix = computeSmcContext(H4.slice(0, n), "H4");
      const next = computeSmcContext(H4.slice(0, n + 1), "H4");
      for (const p of prefix.fvgs) {
        const same = next.fvgs.find((g) => g.createdAtIndex === p.createdAtIndex && g.direction === p.direction);
        if (!same) continue;
        expect(rank[same.status]).toBeGreaterThanOrEqual(rank[p.status]);
      }
      for (const p of prefix.orderBlocks) {
        const same = next.orderBlocks.find((b) => b.sourceIndex === p.sourceIndex);
        if (!same) continue;
        expect(rank[same.status]).toBeGreaterThanOrEqual(rank[p.status]);
      }
    }
  });

  it("the location description never references knowledge from after the candle it describes", () => {
    for (const tf of ["1W", "1D", "4H", "1H"]) {
      const candles = load(fixture.bars[tf]);
      const smc = computeSmcContext(candles, tf);
      const location = readZoneLocation(tf, smc, anchorFromCandles(candles));
      expect(location.atCandleIndex).toBe(candles.length - 1);
      for (const zone of location.zones) {
        expect(zone.knownAtIndex).toBeLessThanOrEqual(location.atCandleIndex);
        expect(zone.ageCandles).toBeGreaterThanOrEqual(0);
      }
      if (location.liquidity.sweep) {
        expect(location.liquidity.sweep.candleIndex).toBeLessThanOrEqual(location.atCandleIndex);
        expect(location.liquidity.sweep.poolFormedAtIndex).toBeLessThan(location.liquidity.sweep.candleIndex);
      }
    }
  });

  it("the structural read used for OB validation is itself causal (no event dated after its own candle)", () => {
    for (const tf of ["1W", "1D", "4H", "1H"]) {
      const candles = load(fixture.bars[tf]);
      const pair = readStructurePair(candles, tf, {
        externalLookback: 3,
        internalLookback: 1,
      });
      for (const read of [pair.external, pair.internal]) {
        for (const event of read.events) {
          expect(event.candleIndex).toBeLessThan(candles.length);
          expect(event.candleTime).toBe(candles[event.candleIndex].timestamp);
        }
      }
    }
  });
});
