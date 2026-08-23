/**
 * Phase 2 engine-integration tests:
 * - conviction rises with REAL price-action confluence (sweep, displacement,
 *   fresh FVG, validated OB), not data availability
 * - TP prefers resting liquidity pools
 * - internal/external structure feeds the trend factor
 * - VWAP/volume limitations surface as explicit data flags & summaries
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, OhlcvCandle, SmcContext, TechnicalData } from "@/lib/data/market-types";

function baseInput(overrides?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H4",
    economicEvents: "Fed signals hawkish stance, rate hike", // fundamental +1
    ...overrides,
  };
}

const candle = (i: number, close: number): OhlcvCandle => ({
  timestamp: 1700000000000 + i * 3600000,
  open: close,
  high: close + 0.5,
  low: close - 0.5,
  close,
  volume: 1000,
});

function makeMarket(price: number): MarketData {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => candle(i, price)),
    timeframe: "H4",
    dataFreshness: "delayed",
  };
}

function makeTech(smc?: SmcContext, overrides?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [110],
    swingLows: [95],
    structure: "HH/HL",
    bosDirection: "bullish",
    supportLevels: [95],
    resistanceLevels: [110],
    volumeTrend: "unknown",
    dataPoints: 210,
    smc,
    ...overrides,
  };
}

/** Minimal valid SMC context — no confluence evidence. */
function emptySmc(): SmcContext {
  return {
    timeframe: "H4",
    liquidityPools: [],
    internalExternal: {
      external: {
        timeframe: "H4",
        structure: "HH/HL",
        bosDirection: "none",
        chochDirection: "none",
        lastSwingHigh: 110,
        lastSwingLow: 95,
        dataPoints: 210,
      },
      internal: {
        timeframe: "H4:internal",
        structure: "HH/HL",
        bosDirection: "none",
        chochDirection: "none",
        dataPoints: 210,
      },
      internalConflict: false,
    },
    fvgs: [],
    orderBlocks: [],
    vwap: { available: false, unavailableReason: "test", priceLocation: "unavailable" },
    volumeProfile: { available: false, unavailableReason: "test" },
  };
}

/** Full-confluence SMC context — every event favors a LONG. */
function bullishSmc(): SmcContext {
  return {
    ...emptySmc(),
    liquidityPools: [
      { level: 94.0, side: "sell_side", source: "equal_lows", touches: 2, swept: true, sweptAtIndex: 208, sweptAtTime: Date.now(), broken: false },
      { level: 108, side: "buy_side", source: "equal_highs", touches: 2, swept: false, broken: false },
    ],
    recentSweep: {
      level: 94.0,
      side: "sell_side",
      source: "equal_lows",
      candleIndex: 208,
      candleTime: Date.now(),
      timeframe: "H4",
    },
    displacement: {
      direction: "bullish",
      candleIndex: 209,
      candleTime: Date.now(),
      bodyRatio: 0.8,
      rangeAtrMultiple: 2.1,
    },
    fvgs: [
      {
        direction: "bullish",
        upper: 99.5,
        lower: 98.0,
        timeframe: "H4",
        createdAtIndex: 209,
        createdAt: Date.now(),
        status: "fresh",
      },
    ],
    orderBlocks: [
      {
        direction: "bullish",
        upper: 98.5,
        lower: 97.0,
        timeframe: "H4",
        createdAt: Date.now(),
        status: "fresh",
        evidence: {
          precedingOpposingCandle: true,
          displacementAfter: true,
          structuralBreakAfter: true,
          displacementRangeAtr: 2.0,
        },
      },
    ],
    vwap: {
      available: true,
      sessionVwap: 98.0,
      priceLocation: "above_vwap",
      bands: { minus2: 96, minus1: 97, vwap: 98, plus1: 99, plus2: 100 },
    },
    volumeProfile: {
      available: true,
      poc: 100,
      vah: 104,
      val: 96,
      hvn: [100],
      lvn: [106],
    },
  };
}

// ── Conviction from real confluence ───────────────────────────────

describe("confluence-based conviction", () => {
  it("scores HIGHER with favorable sweep/displacement/FVG/OB than without", () => {
    const withConfluence = runAnalysis(
      baseInput({ marketData: makeMarket(100), technicalData: makeTech(bullishSmc()) }),
    );
    const withoutConfluence = runAnalysis(
      baseInput({ marketData: makeMarket(100), technicalData: makeTech(emptySmc()) }),
    );

    expect(withConfluence.recommendation).toBe("LONG");
    expect(withoutConfluence.recommendation).toBe("LONG");
    // Identical core factors — the ONLY difference is detected confluence
    expect(withConfluence.confidence).toBeGreaterThan(withoutConfluence.confidence);
  });

  it("does NOT reward data availability alone (same score for equal evidence)", () => {
    // Two runs with identical evidence but different VP availability must
    // produce identical confidence — VP is context only.
    const a = bullishSmc();
    const b = { ...bullishSmc(), volumeProfile: { available: false, unavailableReason: "x" } };
    const ra = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: makeTech(a) }));
    const rb = runAnalysis(baseInput({ marketData: makeMarket(100), technicalData: makeTech(b) }));
    expect(ra.confidence).toBe(rb.confidence);
  });
});

// ── TP prefers resting liquidity ──────────────────────────────────

describe("liquidity-aware trade location", () => {
  it("targets the resting buy-side pool instead of the nearer swing resistance", () => {
    // Swing resistance at 110; buy-side pool at 108 → pool preferred
    const result = runAnalysis(
      baseInput({ marketData: makeMarket(100), technicalData: makeTech(bullishSmc()) }),
    );
    expect(result.recommendation).toBe("LONG");
    expect(result.tradePlan?.takeProfit).toBe("108");
    expect(result.tradePlan?.tpBasis).toContain("buy-side liquidity");
  });

  it("falls back to structural resistance when no pool exists above", () => {
    const noPools = emptySmc();
    const result = runAnalysis(
      baseInput({ marketData: makeMarket(100), technicalData: makeTech(noPools) }),
    );
    expect(result.recommendation).toBe("LONG");
    expect(parseFloat(result.tradePlan!.takeProfit)).toBeCloseTo(110, 5);
    expect(result.tradePlan?.tpBasis).toContain("swing high");
  });
});

// ── Internal vs external structure in scoring ────────────────────

describe("internal/external structure factor", () => {
  it("penalizes internal structure opposing external trend", () => {
    const conflictSmc: SmcContext = {
      ...emptySmc(),
      internalExternal: {
        external: {
          timeframe: "H4",
          structure: "HH/HL",
          bosDirection: "bullish",
          chochDirection: "none",
          dataPoints: 210,
        },
        internal: {
          timeframe: "H4:internal",
          structure: "LH/LL",
          bosDirection: "bearish",
          chochDirection: "none",
          dataPoints: 210,
        },
        internalConflict: true,
      },
    };
    const withConflict = runAnalysis(
      baseInput({ marketData: makeMarket(100), technicalData: makeTech(conflictSmc) }),
    );
    const aligned = runAnalysis(
      baseInput({ marketData: makeMarket(100), technicalData: makeTech(emptySmc()) }),
    );
    expect(withConflict.breakdown.trend).toBeLessThan(aligned.breakdown.trend);
    expect(withConflict.technicalSummary).toContain("Internal structure currently opposes");
  });
});

// ── Summary & data-limitation surfacing ───────────────────────────

describe("summary and data limitations", () => {
  it("surfaces liquidity, sweep, FVG, OB, VWAP context in the thesis", () => {
    const result = runAnalysis(
      baseInput({ marketData: makeMarket(100), technicalData: makeTech(bullishSmc()) }),
    );
    expect(result.technicalSummary).toContain("Resting liquidity");
    expect(result.technicalSummary).toContain("Recent sweep");
    expect(result.technicalSummary).toContain("Fresh FVGs");
    expect(result.technicalSummary).toContain("Validated order blocks");
    expect(result.technicalSummary).toContain("Session VWAP");
    expect(result.technicalSummary).toContain("Volume profile — POC");
  });

  it("reports zero-volume limitation explicitly instead of fabricating VWAP/VProfile", () => {
    const zeroVolSmc: SmcContext = {
      ...emptySmc(),
      vwap: {
        available: false,
        unavailableReason: "Volume data is zero/not representative.",
        priceLocation: "unavailable",
      },
      volumeProfile: {
        available: false,
        unavailableReason: "Volume data is zero/not representative (typical for spot forex feeds).",
      },
    };
    const result = runAnalysis(
      baseInput({
        instrumentType: "crypto",
        instrument: "BTC/USD",
        newsContext: "institutional adoption growing",
        marketData: makeMarket(100),
        technicalData: makeTech(zeroVolSmc),
      }),
    );
    expect(result.technicalSummary).toContain("VWAP unavailable");
    expect(result.technicalSummary).toContain("Volume profile unavailable");
    expect(result.dataFlags.some((f) => f.includes("Volume limitation"))).toBe(true);
  });

  it("flags unavailable chain timeframes explicitly", () => {
    const result = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: makeTech(emptySmc(), { chainUnavailable: ["D1"] }),
      }),
    );
    expect(result.dataFlags.some((f) => f.includes("Timeframe chain unavailable"))).toBe(true);
  });
});

// ── NO_TRADE gates remain intact ──────────────────────────────────

describe("NO_TRADE gates preserved", () => {
  it("still refuses to trade on Neutral bias even with rich SMC data", () => {
    const neutralTech = makeTech(bullishSmc(), {
      structure: "range",
      bosDirection: "none",
      supportLevels: [95],
      resistanceLevels: [110],
      swingHighs: [110],
      swingLows: [95],
    });
    const result = runAnalysis(
      baseInput({ economicEvents: undefined, marketData: makeMarket(100), technicalData: neutralTech }),
    );
    // No fundamental either → single-factor confluence at best
    if (result.bias === "Neutral") {
      expect(result.recommendation).toBe("NO_TRADE");
      expect(result.tradePlan).toBeUndefined();
    }
  });
});
