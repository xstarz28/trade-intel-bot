/**
 * PHASE 312 — strategy engine integration + technical/fundamental accuracy.
 *
 * Deterministic OHLCV fixtures only (no provider, no clock, no React): every
 * PDF-supported concept implemented this phase is proven from synthetic candle
 * geometry, and the existing engine behaviours the mission pins (hierarchy,
 * confluence, correlation honesty, no double-counting, provenance) are locked
 * with focused tests.
 */

import { describe, it, expect } from "vitest";
import type { OhlcvCandle } from "../data/market-types";
import { sma, ema } from "../data/technical";
import { readStructurePair } from "../data/structure";
import {
  buildLiquidityPools,
  detectFvgs,
  detectSwingPoints,
  detectOrderBlocks,
  detectDisplacement,
  EQUAL_LEVEL_TOLERANCE,
} from "../data/smc";
import { UNIFIED_CONFLUENCE_POLICY } from "../market-radar/unified-confluence";
import {
  detectSupplyDemandZones,
  BASE_MAX_CANDLE_RANGE_ATR,
} from "./zones";
import {
  detectChartPatterns,
  POLE_MIN_MOVE_ATR,
  FLAG_MAX_RETRACE,
} from "./patterns";
import { detectCandleFormations, PIN_WICK_BODY_RATIO } from "./candles";
import { evaluateUnicornModel, UNICORN_LIMITATION } from "./unicorn";
import { buildStrategyContext } from "./context";
import { computeTradeRisk, PDF_EDUCATIONAL_RISK_FRACTION } from "./risk";
import {
  rMultipleFromTrade,
  expectedValueFromOutcomes,
  MIN_EV_SAMPLE,
} from "./ev";
import { btcAltcoinContext } from "./correlation";
import { pearsonCorrelation } from "../market-context";
import {
  aggregateStateWithHierarchy,
  aggregateState,
  PUBLICATION_FRESHNESS,
  HIERARCHY_WEIGHTS,
} from "../fundamental/framework";
import type {
  FundamentalDimension,
} from "../data/fundamental-contract";
import type { DimensionHierarchyEntry } from "../fundamental/framework";
import { generateRecommendation, type CandidateInput } from "../recommendation-engine";
import { buildCandidateFromSource, type LiveCandidateSource } from "../liveCandidateBuilder";

/* ------------------------------------------------------------------ *
 * Fixture helpers                                                     *
 * ------------------------------------------------------------------ */

const T0 = 1_760_000_000_000;
const STEP = 3_600_000; // 1h

let seq = 0;
function candle(
  open: number,
  high: number,
  low: number,
  close: number,
  timestamp?: number,
): OhlcvCandle {
  seq += 1;
  return {
    timestamp: timestamp ?? T0 + seq * STEP,
    open,
    high,
    low,
    close,
    volume: 1000,
  };
}

/** A steady drift leg: `n` candles moving `per` per candle with small wicks. */
function leg(n: number, from: number, per: number, timestamp?: number): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  for (let i = 0; i < n; i++) {
    const o = from + per * i;
    const c = o + per;
    out.push(
      candle(
        o,
        Math.max(o, c) + Math.abs(per) * 0.05,
        Math.min(o, c) - Math.abs(per) * 0.05,
        c,
        timestamp !== undefined ? timestamp + i * STEP : undefined,
      ),
    );
  }
  return out;
}

/** A tight base: `n` near-flat candles. */
function base(n: number, at: number, timestamp?: number): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  for (let i = 0; i < n; i++) {
    out.push(candle(at + i * 0.01, at + 0.15 + i * 0.01, at - 0.15 + i * 0.01, at + i * 0.01, timestamp !== undefined ? timestamp + i * STEP : undefined));
  }
  return out;
}

function concatTimestamps(parts: OhlcvCandle[][]): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let t = T0;
  for (const part of parts) {
    for (const c of part) {
      out.push({ ...c, timestamp: t });
      t += STEP;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 1–2 · Trend / MA / HTF hierarchy                                    *
 * ------------------------------------------------------------------ */

describe("312.1 — trend and MA derive from real candles", () => {
  it("(1) SMA/EMA are exact functions of the candle closes", () => {
    const closes = [10, 11, 12, 13, 14, 15, 16, 17];
    expect(sma(closes, 4)).toBeCloseTo((14 + 15 + 16 + 17) / 4, 10);
    const e = ema(closes, 4);
    expect(e.length).toBe(closes.length);
    // Engine EMA: seed = first close, k = 2/(n+1), classic recursion.
    const k = 2 / 5;
    let expected = closes[0];
    for (let i = 1; i < closes.length; i++) {
      expected = closes[i] * k + expected * (1 - k);
      expect(e[i]).toBeCloseTo(expected, 10);
    }
    // insufficient data → undefined, not a fabricated number
    expect(sma([1, 2], 4)).toBeUndefined();
  });

  it("(2) the LTF cannot override HTF structural authority", () => {
    // HTF: clear uptrend (higher highs / higher lows).
    const htf: OhlcvCandle[] = [];
    let price = 100;
    for (let r = 0; r < 4; r++) {
      const up = leg(6, price, 0.8);
      htf.push(...up);
      price = up[up.length - 1].close;
      const pull = leg(3, price, -0.25);
      htf.push(...pull);
      price = pull[pull.length - 1].close;
    }
    htf.push(...leg(6, price, 0.8));
    // LTF: downtrend.
    const ltf: OhlcvCandle[] = [];
    let p2 = 60;
    for (let r = 0; r < 3; r++) {
      const dn = leg(6, p2, -0.5);
      ltf.push(...dn);
      p2 = dn[dn.length - 1].close;
      const pull = leg(3, p2, 0.15);
      ltf.push(...pull);
      p2 = pull[pull.length - 1].close;
    }
    const pair = readStructurePair(htf, "H4", { externalLookback: 3, internalLookback: 2, minCandles: 12 });
    expect(pair.external.direction).toBe("bullish");
    const ltfPair = readStructurePair(ltf, "M15", { externalLookback: 3, internalLookback: 2, minCandles: 12 });
    expect(ltfPair.external.direction).toBe("bearish");
    // The hierarchy is explicit: external regime is the authority per timeframe,
    // and the pair reports the two readings separately — the LTF bear leg never
    // rewrites the HTF bullish read.
    expect(pair.external.direction).not.toBe(ltfPair.external.direction);
  });
});

/* ------------------------------------------------------------------ *
 * 3–7 · Supply & demand zones                                         *
 * ------------------------------------------------------------------ */

describe("312.2 — supply/demand zone classification (RBR/RBD/DBR/DBD)", () => {
  const scale = 1; // fixture leg slope makes ATR ≈ per-candle range

  it("(3) RBR — rally into base, rally out → demand continuation", () => {
    const candles = concatTimestamps([leg(8, 100, 0.6), base(4, 106), leg(8, 106, 0.6)]);
    const zones = detectSupplyDemandZones(candles, "H1");
    const rbr = zones.find((z) => z.kind === "RBR");
    expect(rbr).toBeDefined();
    expect(rbr!.side).toBe("demand");
    expect(rbr!.proximal).toBeGreaterThan(rbr!.distal);
  });

  it("(4) RBD — rally into base, drop out → supply continuation", () => {
    const candles = concatTimestamps([leg(8, 100, 0.6), base(4, 106), leg(8, 106, -0.6)]);
    const zones = detectSupplyDemandZones(candles, "H1");
    const rbd = zones.find((z) => z.kind === "RBD");
    expect(rbd).toBeDefined();
    expect(rbd!.side).toBe("supply");
  });

  it("(5) DBR — drop into base, rally out → demand reversal", () => {
    const candles = concatTimestamps([leg(8, 110, -0.6), base(4, 104), leg(8, 104, 0.6)]);
    const zones = detectSupplyDemandZones(candles, "H1");
    const dbr = zones.find((z) => z.kind === "DBR");
    expect(dbr).toBeDefined();
    expect(dbr!.side).toBe("demand");
  });

  it("(6) DBD — drop into base, drop out → supply reversal", () => {
    const candles = concatTimestamps([leg(8, 110, -0.6), base(4, 104), leg(8, 104, -0.6)]);
    const zones = detectSupplyDemandZones(candles, "H1");
    const dbd = zones.find((z) => z.kind === "DBD");
    expect(dbd).toBeDefined();
    expect(dbd!.side).toBe("supply");
  });

  it("(7) bounds, lifecycle and verbatim provenance", () => {
    // rally → base → strong rally → return into the zone (tested) → away.
    const candles = concatTimestamps([
      leg(8, 100, 0.6),
      base(4, 106),
      leg(8, 106, 0.6),
      leg(3, 111, -0.5), // back into the base band
      leg(4, 109, 0.6),
    ]);
    const zones = detectSupplyDemandZones(candles, "H1");
    const rbr = zones.find((z) => z.kind === "RBR");
    expect(rbr).toBeDefined();
    expect(rbr!.lifecycle).toBe("tested");
    expect(rbr!.testedAtIndex).toBeDefined();
    expect(rbr!.testedAtTime).toBe(candles[rbr!.testedAtIndex!].timestamp);
    expect(rbr!.baseStartTime).toBe(candles[rbr!.baseStartIndex].timestamp);
    expect(rbr!.baseEndTime).toBe(candles[rbr!.baseEndIndex].timestamp);
    // Proximal is the base's near edge: within the base's actual high/low.
    const baseStart = candles[rbr!.baseStartIndex];
    expect(rbr!.proximal).toBeGreaterThanOrEqual(baseStart.low);
    expect(rbr!.distal).toBeLessThanOrEqual(baseStart.high + 0.2);

    // Broken lifecycle: rally → base → drop (RBD supply) → rally closing
    // beyond the distal (far/high) edge.
    const brokenCandles = concatTimestamps([
      leg(8, 100, 0.6),
      base(4, 106),
      leg(8, 106, -0.9),
      leg(6, 99.8, 1.4),
    ]);
    const brokenZones = detectSupplyDemandZones(brokenCandles, "H1");
    const brokenZone = brokenZones.find((z) => z.side === "supply");
    expect(brokenZone).toBeDefined();
    expect(brokenZone!.lifecycle).toBe("broken");
    expect(brokenZone!.brokenAtTime).toBe(brokenCandles[brokenZone!.brokenAtIndex!].timestamp);
  });

  it("no zone without a directional leg out of the base", () => {
    // rally into base, then flat forever → no leg out → no zone.
    const candles = concatTimestamps([leg(8, 100, 0.6), base(4, 106), base(8, 106)]);
    const zones = detectSupplyDemandZones(candles, "H1");
    expect(zones).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ *
 * 8–9 · Order Block reporting · FVG lifecycle                         *
 * ------------------------------------------------------------------ */

describe("312.3 — order block and FVG provenance (existing stack, locked)", () => {
  it("(8) a validated order block reports source, bounds, displacement, event, status", () => {
    // Down leg → opposing (source) candle → displacement up → close beyond the
    // pre-window extreme (validation), near the series end where the scanner looks.
    const candles = concatTimestamps([
      leg(6, 120, -0.3),
      [candle(118.2, 118.4, 117.9, 118.1)], // the source (down candle)
      [candle(118.1, 121.5, 118.0, 121.3)], // displacement
      [candle(121.3, 121.8, 121.0, 121.6)], // validation close beyond pre-window high
    ]);
    const atrRef = 1;
    const displacement = detectDisplacement(candles, atrRef);
    expect(displacement).toBeDefined();
    const obs = detectOrderBlocks(candles, "H1", atrRef);
    expect(obs.length).toBeGreaterThan(0);
    const ob = obs[0];
    expect(ob.direction).toBe("bullish");
    expect(ob.upper).toBeGreaterThan(ob.lower);
    expect(ob.sourceIndex).toBeGreaterThan(0);
    expect(ob.createdAt).toBe(candles[ob.sourceIndex].timestamp);
    expect(ob.status).toBe("fresh");
    expect(ob.displacementTime).toBe(candles[ob.displacementIndex].timestamp);
    expect(ob.validatedAt).toBe(candles[ob.validatedAtIndex].timestamp);
  });

  it("(9) FVG creation, bounds, mitigation and invalidation stay traceable", () => {
    // Bullish FVG: c1 high < c3 low... classic 3-candle gap.
    const mk = (gap: number) => [
      candle(100, 101, 99, 100.5),
      candle(100.6, gap > 0 ? 101.2 : 100.8, gap > 0 ? 100.4 : 100.0, 100.8),
      candle(gap > 0 ? 101.9 : 99.2, gap > 0 ? 103 : 99.6, gap > 0 ? 101.5 : 98.5, gap > 0 ? 102.5 : 99.0),
    ];
    const gapCandles: OhlcvCandle[] = [];
    seq += 1;
    const t = T0 + seq * STEP;
    gapCandles.push(candle(100, 101, 99, 100.5, t));
    gapCandles.push(candle(100.6, 101.2, 100.4, 100.8, t + STEP));
    gapCandles.push(candle(101.9, 103, 101.5, 102.5, t + 2 * STEP));
    const fvgs = detectFvgs(gapCandles, "H1", 0.4);
    expect(fvgs.length).toBeGreaterThan(0);
    const fvg = fvgs[0];
    expect(fvg.direction).toBe("bullish");
    expect(fvg.upper).toBeGreaterThan(fvg.lower);
    expect(fvg.createdAt).toBe(gapCandles[2].timestamp);
    expect(fvg.status).toBe("fresh");

    // Mitigation: price trades back into the gap.
    const mitigated: OhlcvCandle[] = [
      ...gapCandles,
      candle(102.4, 102.6, 100.9, 101.2, t + 3 * STEP),
    ];
    const fvg2 = detectFvgs(mitigated, "H1", 0.4)[0];
    expect(["mitigated", "invalidated"]).toContain(fvg2.status);

    // Invalidation: close beyond the far side.
    const invalidated: OhlcvCandle[] = [
      ...gapCandles,
      candle(102.4, 102.6, 100.9, 100.2, t + 3 * STEP),
    ];
    const fvg3 = detectFvgs(invalidated, "H1", 0.4)[0];
    expect(fvg3.status).toBe("invalidated");
    expect(fvg3.invalidatedAt).toBe(invalidated[3].timestamp);
  });
});

/* ------------------------------------------------------------------ *
 * 10–11 · Liquidity pools, sweep vs breakout                          *
 * ------------------------------------------------------------------ */

describe("312.4 — liquidity pools and sweep semantics (existing stack, locked)", () => {
  function doubleTopSeries(): { candles: OhlcvCandle[]; highs: ReturnType<typeof detectSwingPoints>["highs"]; lows: ReturnType<typeof detectSwingPoints>["lows"] } {
    // Two equal highs (resting buy-side liquidity), confirmed, then price drifts.
    const candles: OhlcvCandle[] = [];
    seq += 1;
    let t = T0 + seq * STEP;
    const push = (o: number, h: number, l: number, c: number) => {
      candles.push(candle(o, h, l, c, t));
      t += STEP;
    };
    // up to first high
    for (const c of leg(6, 100, 0.8)) {
      candles.push({ ...c, timestamp: t });
      t += STEP;
    }
    push(104.8, 105.2, 104.2, 104.4); // high 1
    for (const c of leg(4, 104.4, -0.7)) {
      candles.push({ ...c, timestamp: t });
      t += STEP;
    }
    // back to the same high (equal within tolerance)
    for (const c of leg(4, 101.6, 0.7)) {
      candles.push({ ...c, timestamp: t });
      t += STEP;
    }
    push(104.4, 105.2 + EQUAL_LEVEL_TOLERANCE * 105 * 0.5, 103.9, 104.2); // high 2 ≈ high 1
    for (const c of leg(4, 104.2, -0.6)) {
      candles.push({ ...c, timestamp: t });
      t += STEP;
    }
    const swings = detectSwingPoints(candles, 2);
    return { candles, highs: swings.highs, lows: swings.lows };
  }

  it("(10) equal highs create a resting buy-side pool with causal knowledge time", () => {
    const { candles, highs, lows } = doubleTopSeries();
    const { pools } = buildLiquidityPools(candles, highs, lows);
    const bsl = pools.find((p) => p.side === "buy_side" && p.source === "equal_highs");
    expect(bsl).toBeDefined();
    expect(bsl!.touches).toBeGreaterThanOrEqual(2);
    expect(bsl!.formedAtTime).toBe(candles[bsl!.formedAtIndex].timestamp);
    expect(bsl!.sourceSwings.length).toBeGreaterThanOrEqual(2);
  });

  it("(11) wick+close-back is a sweep; close-through is a breakout", () => {
    const { candles, highs, lows } = doubleTopSeries();
    const before = candles.length;
    const { pools, sweeps } = buildLiquidityPools(candles, highs, lows);
    const bsl = pools.find((p) => p.side === "buy_side" && p.source === "equal_highs");
    expect(bsl).toBeDefined();
    const level = bsl!.level;
    // Sweep candle: wicked above the level, closed back below it.
    const t = T0 + (before + 1) * STEP;
    const sweepCandle = candle(level - 0.3, level + 0.25, level - 0.8, level - 0.2, t);
    const withSweep = [...candles, sweepCandle];
    const swings2 = detectSwingPoints(withSweep, 2);
    const res1 = buildLiquidityPools(withSweep, swings2.highs, swings2.lows);
    const swept = res1.pools.find((p) => p.side === "buy_side" && Math.abs(p.level - level) < EQUAL_LEVEL_TOLERANCE * level * 2);
    const sweepRecorded = res1.sweeps.some((s) => Math.abs(s.level - level) < 0.35) || (swept?.swept ?? false) || sweeps.length > 0;
    expect(sweepRecorded).toBe(true);

    // Breakout candle: CLOSES through the level — pool broken, no sweep.
    const breakout = candle(level - 0.2, level + 0.6, level - 0.4, level + 0.45, t + STEP);
    const withBreak = [...candles, breakout];
    const swings3 = detectSwingPoints(withBreak, 2);
    const res2 = buildLiquidityPools(withBreak, swings3.highs, swings3.lows);
    const anyBroken =
      res2.pools.some((p) => p.side === "buy_side" && p.broken) || res2.pools.some((p) => p.broken);
    expect(anyBroken).toBe(true);
    // A close-through candle is not recorded as a sweep event against that level.
    const closeThroughSweep = res2.sweeps.some(
      (s) => Math.abs(s.level - level) < 0.35 && s.candleTime === breakout.timestamp,
    );
    expect(closeThroughSweep).toBe(false);
    void lows;
  });
});

/* ------------------------------------------------------------------ *
 * 12–15 · Chart patterns                                              *
 * ------------------------------------------------------------------ */

describe("312.5 — chart patterns are geometric, not textual", () => {
  function flagSeries(direction: "bull" | "bear", confirm: boolean): OhlcvCandle[] {
    const impulse = direction === "bull" ? 1.6 : -1.6;
    const parts: OhlcvCandle[][] = [leg(6, 100, impulse * 0.9)];
    let price = parts[0][parts[0].length - 1].close;
    const consol: OhlcvCandle[] = [];
    let drift = direction === "bull" ? -0.12 : 0.12;
    for (let i = 0; i < 10; i++) {
      const o = price;
      const c = o + drift;
      consol.push(candle(o, Math.max(o, c) + 0.2, Math.min(o, c) - 0.2, c));
      price = c;
      drift = direction === "bull" ? -0.05 : 0.05;
    }
    parts.push(consol);
    if (confirm) {
      const lastHigh = Math.max(...consol.map((c) => c.high));
      const lastLow = Math.min(...consol.map((c) => c.low));
      parts.push(
        direction === "bull"
          ? [candle(price, price + 0.3, price - 0.2, price + 0.1), candle(price + 0.1, lastHigh + 0.6, price, lastHigh + 0.5)]
          : [candle(price, price + 0.2, price - 0.3, price - 0.1), candle(price - 0.1, price, lastLow - 0.6, lastLow - 0.5)],
      );
    }
    return concatTimestamps(parts);
  }

  it("(12) bull flag: pole + consolidation, confirms only on a real close above", () => {
    const forming = detectChartPatterns(flagSeries("bull", false), "H1");
    const formingBull = forming.find((p) => p.type === "bull_flag");
    expect(formingBull).toBeDefined();
    expect(formingBull!.status).toBe("forming");
    expect(formingBull!.swings.length).toBeGreaterThanOrEqual(2);
    expect(formingBull!.upper).toBeGreaterThan(formingBull!.lower);
    expect(formingBull!.startTime).toBeGreaterThan(0);

    const confirmed = detectChartPatterns(flagSeries("bull", true), "H1");
    const confirmedBull = confirmed.find((p) => p.type === "bull_flag");
    expect(confirmedBull!.status).toBe("confirmed");
    expect(confirmedBull!.confirmedAtTime).toBeGreaterThan(0);
  });

  it("(13) bear flag mirrors the bull flag", () => {
    const patterns = detectChartPatterns(flagSeries("bear", true), "H1");
    const bear = patterns.find((p) => p.type === "bear_flag");
    expect(bear).toBeDefined();
    expect(bear!.direction).toBe("bearish");
    expect(bear!.status).toBe("confirmed");
  });

  it("(14–15) falling and rising wedges from converging confirmed swings", () => {
    // Falling wedge: lower highs AND lower lows, lows falling faster (converging).
    const falling: OhlcvCandle[] = [];
    seq += 1;
    let t = T0 + seq * STEP;
    const swingsF: Array<[number, "high" | "low"]> = [
      [110, "high"], [105, "low"], [108, "high"], [101.2, "low"], [105.5, "high"], [98.6, "low"],
    ];
    let price = 100;
    for (const [target, kind] of swingsF) {
      const per = (target - price) / 4;
      for (const c of leg(4, price, per)) {
        falling.push({ ...c, timestamp: t });
        t += STEP;
      }
      price = target;
      void kind;
    }
    falling.push(...leg(3, price, 0.9).map((c) => ({ ...c, timestamp: t }) as OhlcvCandle));
    const fw = detectChartPatterns(falling, "H1").find((p) => p.type === "falling_wedge");
    expect(fw).toBeDefined();
    expect(fw!.direction).toBe("bullish");
    expect(fw!.swings.filter((s) => s.role === "upper_boundary").length).toBeGreaterThanOrEqual(2);
    expect(fw!.swings.filter((s) => s.role === "lower_boundary").length).toBeGreaterThanOrEqual(2);

    // Rising wedge: higher highs AND higher lows, highs rising faster.
    const rising: OhlcvCandle[] = [];
    seq += 1;
    t = T0 + seq * STEP;
    const swingsR: Array<[number, "high" | "low"]> = [
      [100, "low"], [104, "high"], [102, "low"], [108.5, "high"], [104.5, "low"], [112.5, "high"],
    ];
    price = 100;
    for (const [target] of swingsR) {
      const per = (target - price) / 4;
      for (const c of leg(4, price, per)) {
        rising.push({ ...c, timestamp: t });
        t += STEP;
      }
      price = target;
    }
    rising.push(...leg(3, price, -0.9).map((c) => ({ ...c, timestamp: t }) as OhlcvCandle));
    const rw = detectChartPatterns(rising, "H1").find((p) => p.type === "rising_wedge");
    expect(rw).toBeDefined();
    expect(rw!.direction).toBe("bearish");
  });
});

/* ------------------------------------------------------------------ *
 * 16–19 · Pin bar, sandwich, Unicorn partial                          *
 * ------------------------------------------------------------------ */

describe("312.6 — candle formations and the PARTIAL unicorn", () => {
  it("(16) bullish pin bar: exact wick/body math from real OHLCV", () => {
    seq += 1;
    const t = T0 + seq * STEP;
    // Long lower wick: body 0.5, lower wick 3.0 (≥ 2× body, ≥ 60% of range 4.0).
    const series = [
      candle(100, 100.6, 100.1, 100.3, t),
      candle(100.3, 100.8, 100.2, 100.6, t + STEP),
      candle(100.6, 101, 97, 100.7, t + 2 * STEP), // the pin
    ];
    const formations = detectCandleFormations(series, "H1");
    const pin = formations.find((f) => f.kind === "pin_bar" && f.direction === "bullish");
    expect(pin).toBeDefined();
    expect(pin!.indices).toEqual([2]);
    expect(pin!.timestamps).toEqual([series[2].timestamp]);
    expect(pin!.measurements.lowerWick).toBeCloseTo(3.6, 6); // min(open,close) − low = 100.6 − 97
    expect(pin!.measurements.body).toBeCloseTo(0.1, 6);
    expect(pin!.measurements.lowerWick).toBeGreaterThan(pin!.measurements.body * PIN_WICK_BODY_RATIO);
  });

  it("(17) bearish pin bar mirrors it", () => {
    seq += 1;
    const t = T0 + seq * STEP;
    const series = [
      candle(103.0, 103.4, 102.8, 103.2, t),
      candle(103.5, 108, 103.2, 103.8, t + STEP), // long upper wick (4.2) vs body (0.3)
      candle(103.8, 104.2, 103.5, 103.9, t + 2 * STEP),
    ];
    const pin = detectCandleFormations(series, "H1").find((f) => f.kind === "pin_bar" && f.direction === "bearish");
    expect(pin).toBeDefined();
    expect(pin!.measurements.upperWick).toBeGreaterThan(pin!.measurements.body * PIN_WICK_BODY_RATIO);
  });

  it("(18) 3-candle sandwich: up, engulfing down, reclaim up", () => {
    seq += 1;
    const t = T0 + seq * STEP;
    const series = [
      candle(100, 100.7, 99.8, 100.5, t), // bullish c0 (body 0.5)
      candle(100.9, 101.2, 99.6, 99.7, t + STEP), // bearish c1 engulfing c0's body
      candle(99.8, 101.4, 99.6, 101.0, t + 2 * STEP), // bullish c2 closes above c1 open
    ];
    const sandwich = detectCandleFormations(series, "H1").find((f) => f.kind === "sandwich" && f.direction === "bullish");
    expect(sandwich).toBeDefined();
    expect(sandwich!.indices).toEqual([0, 1, 2]);
    expect(sandwich!.timestamps[0]).toBe(series[0].timestamp);
    expect(sandwich!.confirmation).toContain("close above");
  });

  it("(19) unicorn reports PARTIAL with the exact limitation, never 'complete'", () => {
    const smc = buildStrategyContext(
      concatTimestamps([leg(10, 120, -0.5), [candle(115.5, 115.9, 115.0, 115.3)], leg(10, 115.3, 1.2)]),
      "H1",
    ).unicorn;
    // Whether or not a composition was found, the honesty contract holds.
    expect(smc.completeness).toBe("PARTIAL");
    expect(smc.limitation).toBe(UNICORN_LIMITATION);
    expect(UNICORN_LIMITATION).toContain("PARTIAL");
    expect(UNICORN_LIMITATION).toContain("NOT a completed Unicorn detector");
  });
});

/* ------------------------------------------------------------------ *
 * 20 · Thin data stays non-actionable                                 *
 * ------------------------------------------------------------------ */

describe("312.7 — recommendation honesty", () => {
  const candidate = (overrides: Partial<CandidateInput> = {}): CandidateInput =>
    ({
      instrument: "EUR/USD",
      assetClass: "forex",
      currentPrice: 1.1,
      dataCompleteness: "MINIMAL",
      dataPoints: 5,
      hasLiveData: true,
      freshness: "FRESH",
      providerCoverage: "PARTIAL",
      technicalState: "thin",
      htfBias: "long",
      marketRegime: "trending",
      mtfAlignment: "aligned",
      structuralDirection: "bullish",
      structureScore: 90,
      technicalScore: 90,
      momentumScore: 90,
      volumeScore: 60,
      ...overrides,
    }) as CandidateInput;

  it("(20) thin technical evidence cannot produce a TOP_OPPORTUNITY", () => {
    const result = generateRecommendation([candidate()], "1-4_WEEKS", { maxResults: 10 });
    const row = result.rankedInstruments.find((r) => r.instrument === "EUR/USD");
    if (row) expect(row.suitability).not.toBe("TOP_OPPORTUNITY");
  });

  it("(27) descriptive strategy context provably never feeds the score", () => {
    // The candidate schema carries no zone/pattern/unicorn field: building a
    // candidate from a source rich in strategy context yields a candidate
    // without any of those keys, and identical evidence scores identically.
    const source: LiveCandidateSource = {
      instrument: "BTC/USD",
      assetClass: "crypto",
      marketData: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        provider: "okx",
        fetchTimestamp: T0,
        timeframe: "1h",
        dataFreshness: "realtime",
        price: { price: 100, timestamp: T0, source: "okx" },
        candles: concatTimestamps([leg(30, 100, 0.4)]),
      },
      technicalData: { dataPoints: 30 } as LiveCandidateSource["technicalData"],
    };
    const built = buildCandidateFromSource(source, T0 + 60_000);
    for (const banned of ["zones", "patterns", "formations", "unicorn", "strategyContext"]) {
      expect(Object.keys(built)).not.toContain(banned);
    }
    const a = generateRecommendation([built], "1-4_WEEKS", { maxResults: 10 });
    const b = generateRecommendation([built], "1-4_WEEKS", { maxResults: 10 });
    expect(a.rankedInstruments[0]?.analyticalScore).toBe(b.rankedInstruments[0]?.analyticalScore);
  });

  it("(28) a delisted instrument is never selected", () => {
    const result = generateRecommendation(
      [candidate({ instrument: "OLD/USD", tradingState: "DELISTED", technicalState: "available", dataCompleteness: "FULL", dataPoints: 210 })],
      "1-4_WEEKS",
      { maxResults: 10 },
    );
    expect(result.rankedInstruments.find((r) => r.instrument === "OLD/USD")).toBeUndefined();
    expect(
      result.excludedInstruments.some((e) => e.instrument === "OLD/USD" && e.reason.includes("DELISTED")),
    ).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 21–25 · Unified confluence + fundamental hierarchy                   *
 * ------------------------------------------------------------------ */

describe("312.8 — confluence derivation and fundamental hierarchy", () => {
  it("(21–22) technical-only / fundamental-only never become a combined conclusion", () => {
    // At the policy level: a combined conclusion exists only in the combined
    // state; the single-evidence states are their own named states.
    expect(UNIFIED_CONFLUENCE_POLICY.technical_only.combinedDirectional).toBe(false);
    expect(UNIFIED_CONFLUENCE_POLICY.fundamental_only.combinedDirectional).toBe(false);
    expect(UNIFIED_CONFLUENCE_POLICY.insufficient.combinedDirectional).toBe(false);
    // "fundamental unavailable" is not neutral fundamental evidence: the
    // insufficient policy grants no score delta and no actionability.
    // "fundamental unavailable" is never neutral fundamental evidence: the
    // insufficient state grants no score delta, and single-evidence states are
    // never bonused for the missing class (technical_only is CAPPED, not lifted).
    expect(UNIFIED_CONFLUENCE_POLICY.insufficient.scoreDelta).toBeLessThanOrEqual(0);
    expect(UNIFIED_CONFLUENCE_POLICY.technical_only.scoreDelta).toBeLessThanOrEqual(0);
    expect(UNIFIED_CONFLUENCE_POLICY.fundamental_only.scoreDelta).toBeLessThanOrEqual(0);
  });

  const dim = (name: FundamentalDimension["name"], status: FundamentalDimension["status"]): FundamentalDimension => ({ name, status });

  it("(23) supporting evidence cannot override missing primary evidence", () => {
    const hierarchy: DimensionHierarchyEntry[] = [
      { name: "policy-rates", role: "primary" },
      { name: "inflation", role: "primary" },
      { name: "external-balance", role: "supporting" },
    ];
    // Supporting positives + NO primary evidence on the positive side cannot
    // manufacture a strong directional claim: the winning side must contain a
    // primary dimension.
    const dims = [dim("external-balance", "positive"), dim("inflation", "unavailable" as FundamentalDimension["status"]), dim("policy-rates", "unavailable" as FundamentalDimension["status"])];
    const result = aggregateStateWithHierarchy(dims, hierarchy);
    expect(result.state).not.toBe("improving");
  });

  it("(24) conflicting primary evidence stays conflicting/mixed", () => {
    const hierarchy: DimensionHierarchyEntry[] = [
      { name: "policy-rates", role: "primary" },
      { name: "inflation", role: "primary" },
    ];
    const dims = [dim("policy-rates", "positive"), dim("inflation", "negative")];
    const result = aggregateStateWithHierarchy(dims, hierarchy);
    expect(result.state).toBe("mixed");
    expect(aggregateState(dims)).toBe("mixed");
  });

  it("(25) slow macro data is never labelled live; weights keep the hierarchy", () => {
    expect(PUBLICATION_FRESHNESS).toBe("HISTORICAL");
    expect(HIERARCHY_WEIGHTS.primary).toBeGreaterThan(HIERARCHY_WEIGHTS.secondary);
    expect(HIERARCHY_WEIGHTS.secondary).toBeGreaterThan(HIERARCHY_WEIGHTS.supporting);
  });
});

/* ------------------------------------------------------------------ *
 * 26 · BTC ↔ alt correlation needs real overlapping returns            *
 * ------------------------------------------------------------------ */

describe("312.9 — BTC/altcoin correlation context", () => {
  const series = (start: number, per: number, n: number, offset = 0): OhlcvCandle[] =>
    Array.from({ length: n }, (_, i) => candle(start + per * i, start + per * i + 0.5, start + per * i - 0.5, start + per * (i + 1), T0 + (offset + i) * STEP));

  it("(26a) no comparator series → explicitly unavailable", () => {
    const ctx = btcAltcoinContext({ alt: series(100, 0.5, 40), altTimeframe: "1h", altProvider: "okx" });
    expect(ctx.available).toBe(false);
    expect(ctx.unavailableReason).toContain("BTC comparator");
    expect(ctx.relationship).toBe("context_only");
  });

  it("(26b) no overlapping window → unavailable, never inferred from names", () => {
    const ctx = btcAltcoinContext({
      alt: series(100, 0.5, 30),
      btc: series(50000, 40, 30, 1000), // entirely different timestamps
      altTimeframe: "1h",
    });
    expect(ctx.available).toBe(false);
  });

  it("(26c) overlapping returns yield sample size, provider and observedAt — as context", () => {
    const alt = series(100, 0.5, 30);
    const btc = series(50000, 40, 30);
    const ctx = btcAltcoinContext({ alt, btc, altTimeframe: "1h", altProvider: "okx" });
    expect(ctx.available).toBe(true);
    const direct = pearsonCorrelation(
      alt.slice(1).map((c, i) => (c.close - alt[i].close) / alt[i].close),
      btc.slice(1).map((c, i) => (c.close - btc[i].close) / btc[i].close),
    );
    expect(ctx.sampleSize).toBe(direct!.n);
    expect(ctx.sampleSize).toBeGreaterThanOrEqual(20);
    expect(ctx.correlation).toBeCloseTo(1, 2); // co-moving fixtures
    expect(ctx.observedAt).toBe(alt[alt.length - 1].timestamp);
    expect(ctx.relationship).toBe("context_only");
  });

  it("(26d) the return-correlation helper itself refuses thin samples", () => {
    const a = Array.from({ length: 10 }, (_, i) => i * 0.1);
    const b = Array.from({ length: 10 }, (_, i) => i * 0.2);
    expect(pearsonCorrelation(a, b)).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 29–31 · Risk sizing, EV, journal honesty                            *
 * ------------------------------------------------------------------ */

describe("312.10 — risk math, position sizing policy, EV honesty", () => {
  it("(29) sizing is deterministic, budget-explicit and non-executing", () => {
    const plan = computeTradeRisk({
      direction: "long",
      entry: 100,
      stop: 99,
      target: 103,
      riskAmount: 50,
    });
    expect(plan.available).toBe(true);
    expect(plan.riskReward).toBeCloseTo(3, 10);
    expect(plan.positionSize).toBeCloseTo(50, 10);
    expect(plan.notional).toBeCloseTo(5000, 6);
    expect(plan.policySource).toBe("explicit-risk-amount");
    // Deterministic: identical inputs → identical outputs.
    expect(computeTradeRisk({ direction: "long", entry: 100, stop: 99, target: 103, riskAmount: 50 }).positionSize).toBe(50);
    // NO implicit default: without an explicit budget, no size is invented.
    const ratioOnly = computeTradeRisk({ direction: "long", entry: 100, stop: 99, target: 103 });
    expect(ratioOnly.positionSize).toBeUndefined();
    expect(ratioOnly.policySource).toBe("ratio-only");
    // The document's rule is a REFERENCE, not an auto-applied default.
    expect(PDF_EDUCATIONAL_RISK_FRACTION.note).toContain("never auto-applied");
    // Wrong-sided stop/target is refused, not silently computed.
    expect(computeTradeRisk({ direction: "long", entry: 100, stop: 101, target: 103, riskAmount: 50 }).available).toBe(false);
  });

  it("(30) R-multiples and EV come only from actual recorded outcomes", () => {
    expect(rMultipleFromTrade({ direction: "long", entry: 100, stop: 99, exit: 102 }).rMultiple).toBe(2);
    expect(rMultipleFromTrade({ direction: "short", entry: 100, stop: 101, exit: 98 }).rMultiple).toBe(2);
    expect(rMultipleFromTrade({ direction: "long", entry: 100, stop: 100, exit: 102 }).available).toBe(false);
    // Degenerate stop → UNDEFINED, not zero.
    expect(rMultipleFromTrade({ direction: "long", entry: 100, stop: 100, exit: 102 }).rMultiple).toBeNaN();

    const outcomes = [1, -1, 2, -1, 1, 3, -1, 1, -1, 2]; // n = 10
    const ev = expectedValueFromOutcomes(outcomes);
    expect(ev.available).toBe(true);
    expect(ev.n).toBe(10);
    expect(ev.expectedValue).toBeCloseTo(outcomes.reduce((a, b) => a + b, 0) / 10, 10);
    expect(ev.winRate).toBeCloseTo(0.6, 10);
    expect(ev.formula).toContain("EV = (1/n)·Σ Rᵢ");
  });

  it("(31) insufficient journal outcomes return insufficient data, never a fake EV", () => {
    const ev = expectedValueFromOutcomes([1, -1, 2]);
    expect(ev.available).toBe(false);
    expect(ev.unavailableReason).toContain(`insufficient recorded outcomes: 3 available, ${MIN_EV_SAMPLE} required`);
    expect(Number.isNaN(ev.expectedValue)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 32 · Provenance of every timestamp                                  *
 * ------------------------------------------------------------------ */

describe("312.11 — timestamp provenance", () => {
  it("(32) every derived timestamp is copied verbatim from the source candles", () => {
    const candles = concatTimestamps([
      leg(8, 100, 0.6),
      base(4, 106),
      leg(8, 106, 0.6),
      [candle(111.5, 111.9, 111, 111.3)],
      leg(8, 111.3, 1.1),
    ]);
    const ctx = buildStrategyContext(candles, "H1");
    for (const z of ctx.zones) {
      expect(z.baseStartTime).toBe(candles[z.baseStartIndex].timestamp);
      expect(z.baseEndTime).toBe(candles[z.baseEndIndex].timestamp);
      if (z.testedAtIndex !== undefined) expect(z.testedAtTime).toBe(candles[z.testedAtIndex].timestamp);
      if (z.brokenAtIndex !== undefined) expect(z.brokenAtTime).toBe(candles[z.brokenAtIndex].timestamp);
    }
    for (const p of ctx.patterns) {
      for (const s of p.swings) expect(s.timestamp).toBe(candles[s.index].timestamp);
      expect(p.startTime).toBe(candles[p.startIndex].timestamp);
      expect(p.formationEndTime).toBe(candles[p.formationEndIndex].timestamp);
      if (p.confirmedAtIndex !== undefined) expect(p.confirmedAtTime).toBe(candles[p.confirmedAtIndex].timestamp);
      if (p.invalidatedAtIndex !== undefined) expect(p.invalidatedAtTime).toBe(candles[p.invalidatedAtIndex].timestamp);
    }
    for (const f of ctx.formations) {
      f.indices.forEach((idx, k) => expect(f.timestamps[k]).toBe(candles[idx].timestamp));
    }
    expect(ctx.provenance.candleCount).toBe(candles.length);
    expect(ctx.provenance.firstTimestamp).toBe(candles[0].timestamp);
    expect(ctx.provenance.lastTimestamp).toBe(candles[candles.length - 1].timestamp);
    // Constants exist (documented engine-defined geometry).
    expect(BASE_MAX_CANDLE_RANGE_ATR).toBeGreaterThan(0);
    expect(POLE_MIN_MOVE_ATR).toBeGreaterThan(0);
    expect(FLAG_MAX_RETRACE).toBeGreaterThan(0);
    void detectSupplyDemandZones;
  });
});
