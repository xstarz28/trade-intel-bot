/**
 * Phase 1 decision-engine tests:
 * - NO_TRADE gate conditions
 * - RSI/MACD no longer a core directional factor
 * - HTF/LTF alignment & conflict handling
 * - Evidence-based conviction
 * - Structural invalidation & numeric R:R
 * - No synthetic SL/TP fallbacks
 */
import { describe, it, expect } from "vitest";
import { runAnalysis, MIN_RR_THRESHOLD } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { OhlcvCandle, TechnicalData, MarketData } from "@/lib/data/market-types";

function baseInput(overrides?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H4",
    ...overrides,
  };
}

function makeCandles(count: number): OhlcvCandle[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: Date.now() - (count - i) * 3600000,
    open: 100 + i * 0.01,
    high: 100.5 + i * 0.01,
    low: 99.5 + i * 0.01,
    close: 100 + i * 0.01,
    volume: 1000,
  }));
}

function makeMarket(
  price: number,
  overrides?: Partial<MarketData>,
): MarketData {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: makeCandles(210),
    timeframe: "H4",
    dataFreshness: "delayed",
    ...overrides,
  };
}

function makeTech(overrides?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [],
    swingLows: [],
    structure: "range",
    supportLevels: [],
    resistanceLevels: [],
    volumeTrend: "unknown",
    dataPoints: 210,
    ...overrides,
  };
}

/** Bullish-aligned fixture: trend +2 (HH/HL + BOS), fundamental +1, sentiment 0. */
function bullishAligned(overrides?: Partial<AnalysisInput>): AnalysisInput {
  return baseInput({
    marketData: makeMarket(100),
    technicalData: makeTech({
      structure: "HH/HL",
      bosDirection: "bullish",
      supportLevels: [95, 97],
      resistanceLevels: [110],
      swingLows: [95, 97],
      swingHighs: [110],
    }),
    economicEvents: "Fed signals hawkish stance, rate hike",
    ...overrides,
  });
}

// ── NO_TRADE gate ─────────────────────────────────────────────────

describe("NO_TRADE gate", () => {
  it("emits NO_TRADE with undefined conviction on Neutral bias", () => {
    const result = runAnalysis(baseInput());
    expect(result.bias).toBe("Neutral");
    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.conviction).toBeUndefined();
    expect(result.tradePlan).toBeUndefined();
    expect(result.noTradeReasons.length).toBeGreaterThan(0);
  });

  it("emits NO_TRADE when critical data is missing (completeness limited)", () => {
    const result = runAnalysis(
      baseInput({ currentPrice: "1.10", recentHigh: "1.11", recentLow: "1.00" }),
    );
    expect(result.dataCompleteness).toBe("limited");
    expect(result.recommendation).toBe("NO_TRADE");
    expect(
      result.noTradeReasons.some((r) => r.toLowerCase().includes("limited")),
    ).toBe(true);
  });

  it("emits NO_TRADE when no structural invalidation is available", () => {
    // Price below all swing lows → no swing low beneath price to stop against
    const result = runAnalysis(
      bullishAligned({
        marketData: makeMarket(90),
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          // All levels ABOVE price → no support below for a long stop
          supportLevels: [],
          resistanceLevels: [110],
          swingLows: [100, 105],
          swingHighs: [110],
        }),
        economicEvents: "Fed signals hawkish stance, rate hike",
      }),
    );
    expect(result.bias).toBe("Bullish");
    expect(result.recommendation).toBe("NO_TRADE");
    expect(
      result.noTradeReasons.some((r) => r.toLowerCase().includes("structural")),
    ).toBe(true);
    // No synthetic SL was invented
    expect(result.tradePlan).toBeUndefined();
    expect(result.keyLevels.invalidation).toBe("");
  });

  it("emits NO_TRADE when no opposing structural level exists (R:R not computable)", () => {
    // Price above all swing highs → no resistance above for a long target
    const result = runAnalysis(
      bullishAligned({
        marketData: makeMarket(120),
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [95],
          resistanceLevels: [],
          swingLows: [95],
          swingHighs: [110],
        }),
        economicEvents: "Fed signals hawkish stance, rate hike",
      }),
    );
    expect(result.recommendation).toBe("NO_TRADE");
    expect(
      result.noTradeReasons.some(
        (r) =>
          r.toLowerCase().includes("opposing structural") ||
          r.toLowerCase().includes("r:r"),
      ),
    ).toBe(true);
  });

  it("emits NO_TRADE when projected R:R is below the minimum threshold", () => {
    // Risk 1 (stop 99), reward 1 (target 101) → R:R 1.0 < 1.5
    const result = runAnalysis(
      bullishAligned({
        marketData: makeMarket(100),
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [99],
          resistanceLevels: [101],
          swingLows: [99],
          swingHighs: [101],
        }),
        economicEvents: "Fed signals hawkish stance, rate hike",
      }),
    );
    expect(result.recommendation).toBe("NO_TRADE");
    expect(
      result.noTradeReasons.some((r) => r.includes("R:R")),
    ).toBe(true);
  });

  it("emits NO_TRADE when core confluence is too weak (single factor)", () => {
    // Only structure agrees (trend +2); fundamental & sentiment neutral
    const result = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [95],
          resistanceLevels: [110],
          swingLows: [95],
          swingHighs: [110],
        }),
      }),
    );
    expect(result.bias).toBe("Bullish");
    expect(result.recommendation).toBe("NO_TRADE");
    expect(
      result.noTradeReasons.some((r) => r.toLowerCase().includes("confluence")),
    ).toBe(true);
  });
});

// ── RSI/MACD are no longer a core directional factor ──────────────

describe("RSI/MACD demoted to secondary modifier", () => {
  it("cannot create a directional bias on their own", () => {
    // Oversold RSI + positive MACD histogram → indicator +2, nothing else
    const result = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: makeTech({
          rsi14: 25,
          macdHistogram: 500,
          rsiDivergence: "bullish",
        }),
      }),
    );
    expect(result.breakdown.indicator).toBeGreaterThanOrEqual(2);
    // Core bias stays Neutral → NO_TRADE
    expect(result.bias).toBe("Neutral");
    expect(result.recommendation).toBe("NO_TRADE");
  });

  it("cannot flip a bearish core into a bullish recommendation", () => {
    // Bearish structure + bearish fundamental; RSI screams bullish
    const result = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: makeTech({
          structure: "LH/LL",
          bosDirection: "bearish",
          rsi14: 22,
          rsiDivergence: "bullish",
          macdHistogram: 900,
        }),
        economicEvents: "ECB dovish, rate cut expected, recession",
        newsContext: "Extreme fear and panic in markets",
      }),
    );
    // Indicator modifier is bullish, core is bearish
    expect(result.breakdown.indicator).toBeGreaterThan(0);
    expect(result.bias).toBe("Bearish");
    if (result.recommendation !== "NO_TRADE") {
      // If actionable, it must follow the CORE direction, never RSI
      expect(result.recommendation).toBe("SHORT");
    }
  });

  it("reports RSI/MACD as secondary context in the summary", () => {
    const result = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: makeTech({ rsi14: 55, macdHistogram: 10 }),
      }),
    );
    expect(result.technicalSummary).toContain("secondary context only");
  });
});

// ── HTF/LTF behavior ──────────────────────────────────────────────

describe("HTF/LTF top-down logic", () => {
  it("marks aligned HTF/LTF and boosts conviction vs unknown HTF", () => {
    const withHtf = runAnalysis(
      bullishAligned({
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [95],
          resistanceLevels: [110],
          swingLows: [95],
          swingHighs: [110],
          htfContext: {
            timeframe: "D1",
            structure: "HH/HL",
            bosDirection: "bullish",
            chochDirection: "none",
            dataPoints: 100,
          },
        }),
      }),
    );
    const withoutHtf = runAnalysis(
      bullishAligned({
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [95],
          resistanceLevels: [110],
          swingLows: [95],
          swingHighs: [110],
        }),
      }),
    );

    expect(withHtf.htfAlignment?.state).toBe("aligned");
    expect(withoutHtf.htfAlignment?.state).toBeUndefined();
    expect(withHtf.confidence).toBeGreaterThan(withoutHtf.confidence);
  });

  it("emits NO_TRADE on HTF/LTF conflict without counter-trend confirmation", () => {
    // HTF bearish (LH/LL), LTF bullish (HH/HL + BOS) — no LTF CHoCH
    const result = runAnalysis(
      bullishAligned({
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [95],
          resistanceLevels: [110],
          swingLows: [95],
          swingHighs: [110],
          htfContext: {
            timeframe: "D1",
            structure: "LH/LL",
            bosDirection: "bearish",
            chochDirection: "none",
            dataPoints: 100,
          },
        }),
      }),
    );
    expect(result.htfAlignment?.state).toBe("counter_trend");
    expect(result.recommendation).toBe("NO_TRADE");
    expect(
      result.noTradeReasons.some((r) => r.toLowerCase().includes("conflict")),
    ).toBe(true);
  });

  it("detects a confirmed counter-trend context (HTF short, LTF CHoCH long)", () => {
    // D1 is bearish (LH/LL); LTF shows a fresh bullish CHoCH inside it —
    // a potential retracement, NOT an automatic macro reversal.
    const result = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: makeTech({
          structure: "LH/LL",
          chochDirection: "bullish",
          supportLevels: [90],
          resistanceLevels: [110],
          swingLows: [90],
          swingHighs: [110],
          htfContext: {
            timeframe: "D1",
            structure: "LH/LL",
            bosDirection: "bearish",
            chochDirection: "none",
            dataPoints: 100,
          },
        }),
        economicEvents: "Fed signals hawkish stance, rate hike",
      }),
    );
    expect(result.htfAlignment?.state).toBe("counter_trend");
    // Counter-trend context must be visible in the thesis either way
    expect(result.technicalSummary).toContain("CONFLICTS with LTF");
  });
});

// ── Trade plan: market-derived levels & numeric R:R ───────────────

describe("trade plan", () => {
  it("builds LONG plan from structural levels with correct R:R", () => {
    // entry 100, SL 95 (structural), TP 110 (structural) → R:R 2.0
    const result = runAnalysis(
      bullishAligned({
        marketData: makeMarket(100),
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [95],
          resistanceLevels: [110],
          swingLows: [95],
          swingHighs: [110],
        }),
        economicEvents: "Fed signals hawkish stance, rate hike",
      }),
    );
    expect(result.recommendation).toBe("LONG");
    expect(result.tradePlan).toBeDefined();
    expect(result.tradePlan?.direction).toBe("long");
    expect(result.tradePlan?.entry).toBe("100");
    expect(parseFloat(result.tradePlan!.stopLoss)).toBeCloseTo(95, 5);
    expect(parseFloat(result.tradePlan!.takeProfit)).toBeCloseTo(110, 5);
    expect(result.tradePlan?.riskReward).toBeCloseTo(2.0, 2);
    // SL basis must reference structure
    expect(result.tradePlan?.slBasis).toContain("swing low");
    expect(result.tradePlan?.tpBasis).toContain("swing high");
  });

  it("builds SHORT plan from structural levels with correct R:R", () => {
    // entry 100, SL 105 (swing high above), TP 90 (swing low below) → R:R 2.0
    const result = runAnalysis(
      baseInput({
        marketData: makeMarket(100),
        technicalData: makeTech({
          structure: "LH/LL",
          bosDirection: "bearish",
          supportLevels: [90],
          resistanceLevels: [105, 108],
          swingLows: [90],
          swingHighs: [105, 108],
        }),
        economicEvents: "ECB dovish, rate cut expected",
        newsContext: "Extreme fear and panic",
      }),
    );
    expect(result.recommendation).toBe("SHORT");
    expect(result.tradePlan?.direction).toBe("short");
    expect(parseFloat(result.tradePlan!.stopLoss)).toBeCloseTo(105, 5);
    expect(parseFloat(result.tradePlan!.takeProfit)).toBeCloseTo(90, 5);
    expect(result.tradePlan?.riskReward).toBeCloseTo(2.0, 2);
  });

  it("discloses the ATR technical buffer without hiding the structural base", () => {
    const result = runAnalysis(
      bullishAligned({
        technicalData: makeTech({
          structure: "HH/HL",
          bosDirection: "bullish",
          supportLevels: [95],
          resistanceLevels: [110],
          swingLows: [95],
          swingHighs: [110],
          atr14: 1.0, // buffer = 0.2 → SL 94.8
        }),
      }),
    );
    expect(result.recommendation).toBe("LONG");
    expect(parseFloat(result.tradePlan!.stopLoss)).toBeCloseTo(94.8, 5);
    expect(result.tradePlan?.slBasis).toContain("structural");
    expect(result.tradePlan?.slBasis).toContain("buffer");
  });

  it("exposes the R:R minimum threshold", () => {
    expect(MIN_RR_THRESHOLD).toBeGreaterThan(1);
  });
});

// ── Conviction ────────────────────────────────────────────────────

describe("conviction", () => {
  it("is undefined for NO_TRADE (never forced into a Low conviction trade)", () => {
    const result = runAnalysis(baseInput());
    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.conviction).toBeUndefined();
  });

  it("is lower when fundamentals oppose the trade than when they align", () => {
    const aligned = runAnalysis(bullishAligned()); // fundamental bullish
    const opposed = runAnalysis(
      bullishAligned({ economicEvents: "ECB dovish, rate cut, recession" }), // fundamental bearish
    );
    expect(aligned.recommendation).toBe("LONG");
    // Opposed fundamental either blocks the trade or lowers conviction
    if (opposed.recommendation === "LONG") {
      expect(opposed.confidence).toBeLessThan(aligned.confidence);
    } else {
      expect(opposed.recommendation).toBe("NO_TRADE");
    }
  });
});
