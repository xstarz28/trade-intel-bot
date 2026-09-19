/**
 * Phase 6 — trading-style adaptation.
 *
 * Core invariant: underlying MARKET FACTS are identical across styles;
 * only decision horizon, requirements and evidence PRIORITY change.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, MtfContext, SmcContext, TechnicalData } from "@/lib/data/market-types";
import { adaptSetupTimeframe } from "./trading-style";

// ── Timeframe adaptation ───────────────────────────────────────────

describe("adaptSetupTimeframe", () => {
  it("keeps in-horizon requests unchanged", () => {
    expect(adaptSetupTimeframe("scalping", "M15")).toEqual({ timeframe: "M15", fallbackApplied: false });
    expect(adaptSetupTimeframe("swing", "W1")).toEqual({ timeframe: "W1", fallbackApplied: false });
    expect(adaptSetupTimeframe("intraday", "H4")).toEqual({ timeframe: "H4", fallbackApplied: false });
  });

  it("falls back to the nearest supported horizon TF and discloses it", () => {
    const r1 = adaptSetupTimeframe("scalping", "D1");
    expect(r1.timeframe).toBe("H1");
    expect(r1.fallbackApplied).toBe(true);
    expect(r1.reason).toMatch(/fell back to H1/);

    expect(adaptSetupTimeframe("swing", "M15").timeframe).toBe("H4");
    expect(adaptSetupTimeframe("intraday", "W1").timeframe).toBe("H4");
  });
});

// ── Fixtures ───────────────────────────────────────────────────────

function makeMarket(price: number, ageMs = 0): MarketData {
  return {
    instrument: "EUR/USD", instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now() - ageMs,
    price: { price, timestamp: Date.now() - ageMs, source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

const smcBase = (extra?: Record<string, unknown>) =>
  ({
    internalExternal: {
      external: { structure: "HH/HL", bosDirection: "none", chochDirection: "none" },
      internal: { structure: "HH/HL", bosDirection: "none", chochDirection: "none" },
      internalConflict: false,
    },
    liquidityPools: [], fvgs: [], orderBlocks: [],
    timeframe: "H4",
    vwap: { available: false },
    volumeProfile: { available: false },
    ...extra,
  }) as unknown as SmcContext;

function techBase(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [105], swingLows: [98],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [98], resistanceLevels: [105], // entry 100: risk 2 / reward 5 → R:R 2.5
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

function baseInput(over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    economicEvents: "hawkish rate hike strong gdp",
    marketData: makeMarket(100),
    technicalData: techBase(),
    ...over,
  };
}

const mtfBullish = (over?: Partial<MtfContext>): MtfContext => ({
  requestedTimeframe: "H4",
  chainUsed: ["D1", "H4", "H1"],
  unavailable: [],
  timeframes: [],
  alignment: "ALIGNED_BULLISH",
  htfBias: "long",
  htfTimeframe: "D1",
  setupTimeframe: "H4",
  triggerTimeframe: "H1",
  ...over,
});

// ── Market facts invariance ────────────────────────────────────────

describe("style never changes MARKET FACTS", () => {
  it("breakdown and structural levels are identical across styles", () => {
    const results = (["scalping", "intraday", "swing"] as const).map((tradingStyle) =>
      runAnalysis(baseInput({ tradingStyle })),
    );
    const b0 = JSON.stringify(results[0].breakdown);
    expect(results.every((r) => JSON.stringify(r.breakdown) === b0)).toBe(true);
    expect(results.every((r) => r.keyLevels.support === results[0].keyLevels.support)).toBe(true);
    expect(results.every((r) => r.keyLevels.resistance === results[0].keyLevels.resistance)).toBe(true);
    // No synthetic SL basis ever appears.
    for (const r of results) {
      if (r.tradePlan) expect(r.tradePlan.slBasis).toContain("structural");
    }
  });

  it("backward compatibility: absent style behaves exactly like intraday", () => {
    const withDefault = runAnalysis(baseInput());
    const explicit = runAnalysis(baseInput({ tradingStyle: "intraday" }));
    expect(withDefault.confidence).toBe(explicit.confidence);
    expect(withDefault.recommendation).toBe(explicit.recommendation);
    expect(withDefault.tradingStyle).toBe("intraday");
  });
});

// ── Style-specific NO_TRADE / divergence ───────────────────────────

describe("style-specific decisions on the SAME market data", () => {
  it("scalping rejects without fresh execution evidence; intraday still trades", () => {
    const input = baseInput({
      tradingStyle: "scalping",
      technicalData: techBase(), // no sweep/displacement/FVG
    });
    const scalping = runAnalysis(input);
    expect(scalping.recommendation).toBe("NO_TRADE");
    expect(scalping.noTradeReasons.join(" ")).toMatch(/SCALPING.*execution evidence/i);

    const intraday = runAnalysis(baseInput());
    expect(intraday.recommendation).toBe("LONG");
  });

  it("scalping is freshness-strict; intraday tolerates the same snapshot", () => {
    const input = baseInput({
      tradingStyle: "scalping",
      marketData: makeMarket(100, 20 * 60 * 1000), // 20 min old
    });
    expect(runAnalysis(input).recommendation).toBe("NO_TRADE");

    const intraday = runAnalysis(
      baseInput({ tradingStyle: "intraday", marketData: makeMarket(100, 20 * 60 * 1000) }),
    );
    expect(intraday.recommendation).toBe("LONG");
  });

  it("scalping target-horizon guard: far target → NO_TRADE, level stays real", () => {
    const r = runAnalysis(baseInput({
      tradingStyle: "scalping",
      technicalData: techBase({
        smc: smcBase({
          displacement: { direction: "bullish", bodyRatio: 0.8, rangeAtrMultiple: 2, candleIndex: 200 },
        }),
        atr14: 0.4, // TP at 105 → distance 10 > 6×0.4
      }),
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toMatch(/SCALPING target horizon/);
  });

  it("intraday event-risk window: imminent high-impact event → NO_TRADE", () => {
    const calendar = {
      provider: "tickatlas" as const,
      timestamp: Date.now(),
      confidence: "high" as const,
      events: [
        {
          event: "FOMC Rate Decision", currency: "USD", status: "upcoming" as const,
          importance: 3, datetime: Date.now() + 60 * 60 * 1000, actual: undefined, forecast: undefined,
        },
      ],
      macroRisk: { level: "medium" as const, explanation: "event ahead" },
    };
    const r = runAnalysis(baseInput({
      tradingStyle: "intraday",
      calendarData: calendar as never,
    }));
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toMatch(/INTRADAY horizon.*event-risk window/i);
  });

  it("swing MIXED exemption: HTF-aligned thesis survives LTF noise that vetoes intraday", () => {
    const mixed = mtfBullish({ alignment: "MIXED" });
    const intraday = runAnalysis(baseInput({ tradingStyle: "intraday", technicalData: techBase({ mtf: mixed }) }));
    expect(intraday.recommendation).toBe("NO_TRADE"); // Phase 3A MIXED gate

    const swing = runAnalysis(baseInput({
      tradingStyle: "swing",
      technicalData: techBase({ mtf: mixed }),
    }));
    expect(swing.recommendation).toBe("LONG"); // LTF noise does not veto HTF thesis
  });

  it("swing requires readable HTF context and fundamental presence", () => {
    // No MTF/HTF context at all.
    const noHtf = runAnalysis(baseInput({ tradingStyle: "swing", technicalData: techBase({ mtf: undefined }) }));
    expect(noHtf.recommendation).toBe("NO_TRADE");
    expect(noHtf.noTradeReasons.join(" ")).toMatch(/SWING horizon.*higher-timeframe/i);

    // HTF present but zero fundamental context.
    const noFundamental = runAnalysis(baseInput({
      tradingStyle: "swing",
      technicalData: techBase({ mtf: mtfBullish() }),
      economicEvents: undefined, newsContext: undefined,
      calendarData: undefined, macroData: undefined,
    }));
    expect(noFundamental.recommendation).toBe("NO_TRADE");
    expect(noFundamental.noTradeReasons.join(" ")).toMatch(/SWING horizon.*fundamental\/macro/i);
  });

  it("swing weights fundamental evidence higher than intraday (priority, not fabrication)", () => {
    const strongFund = baseInput({
      tradingStyle: "swing",
      newsContext: "dovish rate cut easing dovish",
      technicalData: techBase({ mtf: mtfBullish() }),
    });
    const swing = runAnalysis(strongFund);

    const intradayInput = { ...strongFund, tradingStyle: "intraday" as const };
    const intraday = runAnalysis(intradayInput);

    expect(swing.breakdown).toEqual(intraday.breakdown); // same FACTS
    if (swing.confidence !== undefined && intraday.confidence !== undefined) {
      // With agreeing fundamentals the swing layer contributes more.
      expect(swing.confidence).toBeGreaterThan(intraday.confidence);
    }
  });
});

// ── R:R discipline untouched by style ──────────────────────────────

describe("R:R enforcement across styles", () => {
  it("rejects sub-1.5 R:R regardless of style", () => {
    for (const tradingStyle of ["scalping", "intraday", "swing"] as const) {
      const r = runAnalysis(baseInput({
        tradingStyle,
        technicalData: techBase({
          supportLevels: [99], resistanceLevels: [101], // RR = 1.0
          swingHighs: [101], swingLows: [99],
        }),
      }));
      expect(r.recommendation).toBe("NO_TRADE");
      expect(r.noTradeReasons.join(" ")).toMatch(/R:R/);
    }
  });
});
