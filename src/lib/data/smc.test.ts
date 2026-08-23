/**
 * Phase 2 unit tests — SMC algorithms:
 * equal highs/lows, liquidity pools & sweeps, internal/external structure,
 * FVG lifecycle, displacement, validated Order Blocks, VWAP, Volume Profile,
 * and invalid-volume handling.
 */
import { describe, it, expect } from "vitest";
import {
  EQUAL_LEVEL_TOLERANCE,
  detectEqualLevels,
  buildLiquidityPools,
  detectFvgs,
  detectDisplacement,
  detectOrderBlocks,
  computeVwap,
  computeVolumeProfile,
  computeSmcContext,
  type SwingPoint,
} from "./smc";
import type { OhlcvCandle } from "./market-types";

// ── Helpers ───────────────────────────────────────────────────────

function candle(
  timestamp: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100,
): OhlcvCandle {
  return { timestamp, open, high, low, close, volume };
}

const T = (i: number) => 1700000000000 + i * 3600000;

// ── Equal highs / lows ────────────────────────────────────────────

describe("detectEqualLevels", () => {
  it("groups swing highs within the documented relative tolerance", () => {
    const pts: SwingPoint[] = [
      { price: 100.0, index: 0 },
      { price: 100.05, index: 5 }, // |100−100.05|/100.05 ≈ 0.05% ≤ 0.15% ✓
      { price: 105.0, index: 10 }, // far above — separate
    ];
    const groups = detectEqualLevels(pts, EQUAL_LEVEL_TOLERANCE);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(groups[0][0].price).toBe(100.0);
  });

  it("does NOT group levels beyond the tolerance", () => {
    const pts: SwingPoint[] = [
      { price: 100.0, index: 0 },
      { price: 101.0, index: 5 }, // 1% apart > 0.15%
    ];
    expect(detectEqualLevels(pts, EQUAL_LEVEL_TOLERANCE)).toHaveLength(0);
  });
});

// ── Liquidity pools & sweeps ──────────────────────────────────────

describe("buildLiquidityPools", () => {
  it("classifies buy-side vs sell-side and keeps unswept pools resting", () => {
    const candles = [
      candle(T(0), 99, 99.5, 98.5, 99),
      candle(T(1), 99, 99.5, 98.5, 99),
    ];
    const { pools, sweeps } = buildLiquidityPools(
      candles,
      [{ price: 100.5, index: 0 }],
      [{ price: 97.0, index: 1 }],
    );
    expect(sweeps).toHaveLength(0);
    const buy = pools.find((p) => p.source === "swing_high");
    const sell = pools.find((p) => p.source === "swing_low");
    expect(buy?.side).toBe("buy_side");
    expect(buy?.swept).toBe(false);
    expect(buy?.broken).toBe(false);
    expect(sell?.side).toBe("sell_side");
  });

  it("marks a SWEEP when wick pierces the level but close returns", () => {
    const candles = [
      candle(T(0), 99, 99.5, 98.5, 99),
      candle(T(1), 99, 99.5, 98.5, 99),
      // Wick above 100.5 but close back below → sweep, not breakout
      candle(T(2), 99.8, 100.8, 99.5, 99.9),
    ];
    const { pools, sweeps } = buildLiquidityPools(candles, [{ price: 100.5, index: 1 }], []);
    expect(pools[0].swept).toBe(true);
    expect(pools[0].broken).toBe(false);
    expect(sweeps).toHaveLength(1);
    expect(sweeps[0].candleIndex).toBe(2);
  });

  it("marks a BREAKOUT (not a sweep) when price closes through the level", () => {
    const candles = [
      candle(T(0), 99, 99.5, 98.5, 99),
      candle(T(1), 99, 99.5, 98.5, 99),
      candle(T(2), 100, 100.9, 99.8, 100.7), // close > 100.5
    ];
    const { pools, sweeps } = buildLiquidityPools(candles, [{ price: 100.5, index: 1 }], []);
    expect(pools[0].broken).toBe(true);
    expect(pools[0].swept).toBe(false);
    expect(sweeps).toHaveLength(0);
  });

  it("builds equal-high pools from clustered majors with touch count", () => {
    const candles = [
      candle(T(0), 99, 99.5, 98.5, 99),
      candle(T(1), 99, 99.5, 98.5, 99),
    ];
    const { pools } = buildLiquidityPools(
      candles,
      [
        { price: 100.0, index: 0 },
        { price: 100.05, index: 1 },
      ],
      [],
    );
    const eq = pools.find((p) => p.source === "equal_highs");
    expect(eq).toBeDefined();
    expect(eq?.touches).toBe(2);
    expect(eq?.level).toBe(100.05); // pool sits at the cluster extreme
  });
});

// ── FVG lifecycle ─────────────────────────────────────────────────

describe("detectFvgs", () => {
  const base = [
    candle(T(0), 9.8, 10.0, 9.6, 9.9),
    candle(T(1), 9.9, 10.6, 9.8, 10.5), // impulse
    candle(T(2), 10.5, 10.9, 10.5, 10.8), // low 10.5 > c0.high 10.0 → bullish FVG 10.0–10.5
  ];

  it("detects a bullish three-candle FVG", () => {
    const fvgs = detectFvgs(base, "H1", 0.3);
    const fvg = fvgs.find((f) => f.direction === "bullish");
    expect(fvg).toBeDefined();
    expect(fvg?.lower).toBe(10.0);
    expect(fvg?.upper).toBe(10.5);
    expect(fvg?.status).toBe("fresh");
  });

  it("marks FVG mitigated when price trades back into the zone", () => {
    const withMit = [
      ...base,
      candle(T(3), 10.6, 10.8, 10.2, 10.4), // low 10.2 ≤ upper 10.5
    ];
    const fvg = detectFvgs(withMit, "H1", 0.3).find((f) => f.direction === "bullish");
    expect(fvg?.status).toBe("mitigated");
  });

  it("marks FVG invalidated when price closes through the far side", () => {
    const withInv = [
      ...base,
      candle(T(3), 10.2, 10.3, 9.7, 9.8), // close 9.8 < lower 10.0
    ];
    const fvg = detectFvgs(withInv, "H1", 0.3).find((f) => f.direction === "bullish");
    expect(fvg?.status).toBe("invalidated");
  });

  it("filters out noise-sized gaps below MIN_FVG_ATR_MULT", () => {
    // Gap of 0.01 with ATR 0.3 → 0.01 < 0.15×0.3 → filtered
    const tiny = [
      candle(T(0), 10.0, 10.1, 9.9, 10.05),
      candle(T(1), 10.05, 10.15, 9.95, 10.1),
      candle(T(2), 10.1, 10.2, 10.11, 10.15), // low 10.11 vs c0.high 10.1 → 0.01 gap
    ];
    expect(detectFvgs(tiny, "H1", 0.3)).toHaveLength(0);
  });
});

// ── Displacement ──────────────────────────────────────────────────

describe("detectDisplacement", () => {
  const flat = Array.from({ length: 25 }, (_, i) =>
    candle(T(i), 100, 100.25, 99.75, 100), // range 0.5 → ATR ≈ 0.5
  );

  it("detects a dominant-body candle with range ≥ 1.5× ATR", () => {
    const withDisp = [
      ...flat.slice(0, 24),
      candle(T(24), 100, 101.3, 99.9, 101.2), // range 1.4 ≈ 2.8×ATR, body 1.2/1.4
    ];
    const d = detectDisplacement(withDisp, 0.5);
    expect(d).toBeDefined();
    expect(d?.direction).toBe("bullish");
    expect(d?.rangeAtrMultiple).toBeGreaterThanOrEqual(1.5);
    expect(d?.bodyRatio).toBeGreaterThanOrEqual(0.6);
  });

  it("rejects a big-wick/small-body candle as displacement", () => {
    const withWick = [
      ...flat.slice(0, 24),
      candle(T(24), 100, 101.5, 99.0, 100.05), // range 2.5×ATR but body tiny
    ];
    expect(detectDisplacement(withWick, 0.5)).toBeUndefined();
  });

  it("rejects a normal-sized candle", () => {
    expect(detectDisplacement(flat, 0.5)).toBeUndefined();
  });
});

// ── Order Blocks ──────────────────────────────────────────────────

describe("detectOrderBlocks", () => {
  // Pre-window highs ~100.5; OB candle at index 5; displacement + BOS after
  const seq = [
    candle(T(0), 100.0, 100.4, 99.8, 100.2),
    candle(T(1), 100.2, 100.5, 99.9, 100.1),
    candle(T(2), 100.1, 100.4, 99.8, 100.3),
    candle(T(3), 100.3, 100.5, 99.9, 100.0),
    candle(T(4), 100.0, 100.4, 99.8, 100.2),
    // OB candidate: opposing down candle
    candle(T(5), 100.4, 100.5, 99.7, 99.8),
    // Displacement up + BOS (close > 100.5)
    candle(T(6), 99.8, 101.6, 99.7, 101.4),
    candle(T(7), 101.4, 101.8, 101.2, 101.6),
    candle(T(8), 101.6, 101.9, 101.4, 101.7),
  ];

  it("validates an OB with opposing candle + displacement + BOS", () => {
    const blocks = detectOrderBlocks(seq, "H1", 0.4);
    expect(blocks.length).toBeGreaterThanOrEqual(1);
    const ob = blocks[0];
    expect(ob.direction).toBe("bullish");
    expect(ob.lower).toBeCloseTo(99.7, 5);
    expect(ob.upper).toBeCloseTo(100.5, 5);
    expect(ob.evidence.displacementAfter).toBe(true);
    expect(ob.evidence.structuralBreakAfter).toBe(true);
    expect(ob.evidence.displacementRangeAtr).toBeGreaterThanOrEqual(1.5);
  });

  it("marks the OB mitigated when price returns into the zone", () => {
    const withReturn = [
      ...seq,
      candle(T(9), 101.0, 101.2, 100.3, 100.8), // low 100.3 ≤ zone upper 100.5
    ];
    const ob = detectOrderBlocks(withReturn, "H1", 0.4).find((b) => b.direction === "bullish");
    expect(ob?.status).toBe("mitigated");
  });

  it("marks the OB invalidated when price closes through the zone", () => {
    const withBreak = [
      ...seq,
      candle(T(9), 100.5, 100.6, 99.0, 99.2), // close 99.2 < zone lower 99.7
    ];
    const ob = detectOrderBlocks(withBreak, "H1", 0.4).find((b) => b.direction === "bullish");
    expect(ob?.status).toBe("invalidated");
  });

  it("does NOT emit an OB without a structural break", () => {
    // Displacement happens but price never closes above the pre-window high
    const noBos = [
      candle(T(0), 100.0, 101.4, 99.8, 101.0), // pre-window high is high
      candle(T(1), 101.0, 101.4, 100.8, 101.2),
      candle(T(2), 101.2, 101.5, 101.0, 101.3),
      candle(T(3), 101.3, 101.5, 101.1, 101.4),
      candle(T(4), 101.4, 101.6, 101.2, 101.5),
      candle(T(5), 101.5, 101.6, 100.9, 101.0), // down candle
      candle(T(6), 101.0, 101.3, 100.8, 101.2), // small up candle, no displacement
      candle(T(7), 101.2, 101.3, 101.0, 101.1),
      candle(T(8), 101.1, 101.3, 101.0, 101.2),
    ];
    expect(detectOrderBlocks(noBos, "H1", 0.4)).toHaveLength(0);
  });
});

// ── VWAP ──────────────────────────────────────────────────────────

describe("computeVwap", () => {
  it("computes session VWAP as volume-weighted typical price", () => {
    const candles = [
      candle(T(0), 0, 2, 0, 1, 3), // typical 1, vol 3
      candle(T(1), 1, 3, 1, 2, 1), // typical 2, vol 1
    ];
    const v = computeVwap(candles);
    expect(v.available).toBe(true);
    expect(v.sessionVwap).toBeCloseTo((1 * 3 + 2 * 1) / 4, 6); // 1.25
    expect(v.priceLocation).toBe("above_vwap");
    expect(v.bands).toBeDefined();
  });

  it("returns explicit unavailability for zero-volume data (no fake VWAP)", () => {
    const candles = [
      candle(T(0), 0, 2, 0, 1, 0),
      candle(T(1), 1, 3, 1, 2, 0),
    ];
    const v = computeVwap(candles);
    expect(v.available).toBe(false);
    expect(v.unavailableReason).toBeTruthy();
    expect(v.priceLocation).toBe("unavailable");
  });
});

// ── Volume Profile ────────────────────────────────────────────────

describe("computeVolumeProfile", () => {
  it("finds the POC at the most-traded price band", () => {
    // Most volume concentrated around 10; small volume around 20
    const candles = [
      candle(T(0), 9.9, 10.1, 9.8, 10.0, 900),
      candle(T(1), 10.0, 10.1, 9.9, 10.05, 800),
      candle(T(2), 19.9, 20.1, 19.8, 20.0, 100),
    ];
    const vp = computeVolumeProfile(candles);
    expect(vp.available).toBe(true);
    expect(vp.poc).toBeLessThan(12); // POC must sit in the 10-band, not the 20-band
    expect(vp.vah).toBeGreaterThanOrEqual(vp.poc!);
    expect(vp.val).toBeLessThanOrEqual(vp.poc!);
  });

  it("refuses to fabricate a profile from zero-volume data", () => {
    const candles = [
      candle(T(0), 9.9, 10.1, 9.8, 10.0, 0),
      candle(T(1), 10.0, 10.1, 9.9, 10.05, 0),
    ];
    const vp = computeVolumeProfile(candles);
    expect(vp.available).toBe(false);
    expect(vp.unavailableReason).toBeTruthy();
    expect(vp.poc).toBeUndefined();
  });
});

// ── computeSmcContext (integration) ───────────────────────────────

describe("computeSmcContext", () => {
  // Leg-based uptrend: up-legs of 10 bars (+1/bar) separated by pullbacks
  // of 6 bars (−0.5/bar). Real fractal geometry → detectable major swings.
  function trendWithPullbacks(): OhlcvCandle[] {
    const out: OhlcvCandle[] = [];
    let price = 100;
    const legs = [
      { bars: 10, step: 1 },
      { bars: 6, step: -0.5 },
      { bars: 10, step: 1 },
      { bars: 6, step: -0.5 },
      { bars: 10, step: 1 },
      { bars: 6, step: -0.5 },
      { bars: 10, step: 1 },
    ];
    for (const leg of legs) {
      for (let b = 0; b < leg.bars; b++) {
        const o = price;
        price += leg.step;
        out.push(
          candle(T(out.length), o, Math.max(o, price) + 0.2, Math.min(o, price) - 0.2, price),
        );
      }
    }
    return out;
  }

  it("assembles a full context from a trending series", () => {
    const candles = trendWithPullbacks();
    const ctx = computeSmcContext(candles, "H4");

    expect(ctx.timeframe).toBe("H4");
    expect(ctx.internalExternal.external.structure).toBe("HH/HL");
    expect(ctx.internalExternal.external.dataPoints).toBe(candles.length);
    expect(Array.isArray(ctx.liquidityPools)).toBe(true);
    expect(ctx.vwap.available).toBe(true);
    expect(ctx.volumeProfile.available).toBe(true);
  });

  it("flags internal/external conflict when minor structure opposes major", () => {
    const candles = trendWithPullbacks();
    let p = candles[candles.length - 1].close;
    const pushBar = (o: number, h: number, l: number, c: number) =>
      candles.push(candle(T(candles.length), o, h, l, c));
    const runBars = (n: number, step: number) => {
      for (let k = 0; k < n; k++) {
        const o = p;
        p += step;
        pushBar(o, Math.max(o, p) + 0.1, Math.min(o, p) - 0.1, p);
      }
    };
    // Decline with two relief bounces forming MINOR lower-highs; terminal
    // bottom breaks the last minor HL → internal LH/LL. Only the terminal
    // bottom becomes a NEW major low and the recovery ends above the last
    // major HL → external stays HH/HL with no CHoCH.
    runBars(6, -0.75);
    runBars(2, 0.5);
    runBars(7, -0.75);
    runBars(2, 0.45);
    runBars(11, -0.75);
    runBars(4, 1.5);

    const ctx = computeSmcContext(candles, "H1");
    expect(ctx.internalExternal.external.structure).toBe("HH/HL");
    expect(ctx.internalExternal.internal.structure).toBe("LH/LL");
    expect(ctx.internalExternal.internalConflict).toBe(true);
  });
});
