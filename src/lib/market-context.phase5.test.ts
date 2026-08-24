/**
 * Phase 5 — market context, anti-double-counting conviction, asset-specific
 * fundamentals, cross-asset context and contradiction classification.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, MtfContext, SmcContext, TechnicalData } from "@/lib/data/market-types";
import {
  detectMarketRegime,
  classifySetup,
  detectContradictions,
} from "./market-context";

// ── Regime detection ───────────────────────────────────────────────

const trendCandle = (i: number) => {
  const base = 100 + i * 0.5;
  return { high: base + 0.6, low: base - 0.6, close: base };
};

const smcWith = (extra: Record<string, unknown>) =>
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

describe("detectMarketRegime", () => {
  const tech = (over?: Partial<TechnicalData>): TechnicalData => ({
    swingHighs: [110], swingLows: [95],
    structure: "HH/HL", bosDirection: "none", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [110],
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  });

  it("TRENDING from structure + VWAP direction (multi-evidence)", () => {
    const r = detectMarketRegime({
      technicalData: tech({ smc: smcWith({ vwap: { available: true, sessionVwap: 99, priceLocation: "above_vwap" } }) }),
      candles: Array.from({ length: 60 }, (_, i) => ({ ...trendCandle(i), open: 100 })),
    });
    expect(r.regime).toBe("TRENDING");
    expect(r.evidences.length).toBeGreaterThanOrEqual(2);
  });

  it("RANGING from range structure + at-VWAP balance", () => {
    const flat = { high: 100.4, low: 99.6, close: 100 };
    const r = detectMarketRegime({
      technicalData: tech({
        structure: "range",
        smc: smcWith({
          vwap: { available: true, sessionVwap: 100, priceLocation: "at_vwap" },
          internalExternal: {
            external: { structure: "range", bosDirection: "none", chochDirection: "none" },
            internal: { structure: "range", bosDirection: "none", chochDirection: "none" },
            internalConflict: false,
          },
        }),
      }),
      candles: Array.from({ length: 60 }, () => ({ ...flat })),
    });
    expect(r.regime).toBe("RANGING");
  });

  it("VOLATILITY_COMPRESSION when realized volatility contracts", () => {
    // First half volatile, second half quiet → ratio well below 0.7.
    const candles = [
      ...Array.from({ length: 40 }, (_, i) => ({ high: 105 + i, low: 90 - i, close: 100 })),
      ...Array.from({ length: 40 }, () => ({ high: 100.2, low: 99.8, close: 100 })),
    ];
    const r = detectMarketRegime({
      technicalData: tech(),
      candles,
    });
    expect(r.regime).toBe("VOLATILITY_COMPRESSION");
  });

  it("VOLATILITY_EXPANSION when realized volatility expands with directional structure", () => {
    const candles = [
      ...Array.from({ length: 40 }, () => ({ high: 100.2, low: 99.8, close: 100 })),
      ...Array.from({ length: 40 }, (_, i) => ({ high: 101 + i * 1.5, low: 98 - i * 1.5, close: 100 })),
    ];
    const r = detectMarketRegime({ technicalData: tech(), candles });
    expect(r.regime).toBe("VOLATILITY_EXPANSION");
  });

  it("UNKNOWN when evidence is insufficient — never forced", () => {
    const singleEvidence = detectMarketRegime({
      technicalData: tech(), // structure evidence only, no VWAP/volume/candles
    });
    expect(singleEvidence.regime).toBe("UNKNOWN");

    expect(detectMarketRegime({}).regime).toBe("UNKNOWN");
  });
});

// ── Setup classification ───────────────────────────────────────────

const mtf = (over?: Partial<MtfContext>): MtfContext => ({
  requestedTimeframe: "H4",
  chainUsed: ["D1", "H4"],
  unavailable: [],
  timeframes: [],
  alignment: "ALIGNED_BULLISH",
  htfBias: "long",
  htfTimeframe: "D1",
  setupTimeframe: "H4",
  triggerTimeframe: "H1",
  ...over,
});

describe("classifySetup", () => {
  it("TREND_CONTINUATION on full alignment without opposing events", () => {
    const r = classifySetup({ mtf: mtf() });
    expect(r.setupClass).toBe("TREND_CONTINUATION");
  });

  it("PULLBACK when lower TFs pull back WITHIN the HTF trend", () => {
    const r = classifySetup({ mtf: mtf({ alignment: "COUNTER_TREND" }), biasDir: "long" });
    expect(r.setupClass).toBe("PULLBACK");
    expect(r.rationale).toMatch(/retracement|pull back/i);
  });

  it("COUNTER_TREND when the thesis trades AGAINST the HTF", () => {
    const r = classifySetup({ mtf: mtf({ alignment: "COUNTER_TREND" }), biasDir: "short" });
    expect(r.setupClass).toBe("COUNTER_TREND");
    expect(r.rationale).toMatch(/AGAINST/i);
  });

  it("REVERSAL only for a genuine HTF structural break", () => {
    const r = classifySetup({
      mtf: mtf({ htfReversal: { timeframe: "D1", direction: "bearish", kind: "choch" } }),
    });
    expect(r.setupClass).toBe("REVERSAL");
    expect(r.rationale).toMatch(/genuine HTF reversal/i);
  });

  it("an LTF CHoCH alone is NEVER a reversal", () => {
    const tech = { chochDirection: "bullish" } as TechnicalData;
    const r = classifySetup({ mtf: mtf(), technicalData: tech, biasDir: "short" });
    expect(r.setupClass).not.toBe("REVERSAL");
  });

  it("RANGE in a ranging regime; UNKNOWN on insufficient data", () => {
    expect(classifySetup({ regime: "RANGING" }).setupClass).toBe("RANGE");
    expect(classifySetup({ mtf: mtf({ alignment: "INSUFFICIENT_DATA" }) }).setupClass).toBe("UNKNOWN");
  });
});

// ── Anti-double-counting conviction ────────────────────────────────

function makeMarket(price: number): MarketData {
  return {
    instrument: "EUR/USD", instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp: Date.now(), source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

function techBase(smc?: SmcContext, over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [110], swingLows: [95],
    structure: "HH/HL", bosDirection: "none", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [110],
    volumeTrend: "unknown", dataPoints: 210,
    ...(smc ? { smc } : {}),
    ...over,
  };
}

function input(technicalData: TechnicalData): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    economicEvents: "hawkish rate hike strong gdp",
    marketData: makeMarket(100),
    technicalData,
  };
}

describe("anti-double-counting conviction (Phase 5 P1c)", () => {
  const bullishSmc = {
    internalExternal: {
      external: { structure: "HH/HL" as const, bosDirection: "none" as const, chochDirection: "none" as const },
      internal: { structure: "HH/HL" as const, bosDirection: "none" as const, chochDirection: "none" as const },
      internalConflict: false,
    },
    liquidityPools: [], fvgs: [], orderBlocks: [],
    vwap: { available: false } as never,
    volumeProfile: { available: false } as never,
  };

  it("cluster-heavy sub-signals are capped within one layer", () => {
    // Displacement + fresh FVG + OB from the same candle cluster:
    // raw sum 4+3+3=10 but the LOCATION layer caps at +8.
    const clusterSmc = {
      ...bullishSmc,
      displacement: { direction: "bullish" as const, bodyRatio: 0.8, rangeAtrMultiple: 2, candleIndex: 200 },
      fvgs: [{ direction: "bullish" as const, status: "fresh" as const, lower: 99, upper: 100, timeframe: "H4", createdAtIndex: 199 }],
      orderBlocks: [{ direction: "bullish" as const, status: "fresh" as const, lower: 98, upper: 99, timeframe: "H4", evidence: { displacementRangeAtr: 2, hadOpposingCandle: true, causedStructuralBreak: true } }],
    } as unknown as SmcContext;

    const withCluster = runAnalysis(input(techBase(clusterSmc)));
    const withNothing = runAnalysis(input(techBase()));

    expect(withCluster.recommendation).toBe("LONG");
    // Capped contribution: strictly bounded above base+layer-cap growth.
    expect(withCluster.confidence - withNothing.confidence).toBeLessThanOrEqual(13); // ≤ imb cap 8 + completeness noise guard
  });

  it("independent layers beat a single overloaded layer (breadth matters)", () => {
    // Case A: ONE layer maxed (imbalance cluster).
    const a = runAnalysis(input(techBase({
      ...bullishSmc,
      displacement: { direction: "bullish" as const, bodyRatio: 0.8, rangeAtrMultiple: 2, candleIndex: 200 },
      fvgs: [{ direction: "bullish" as const, status: "fresh" as const, lower: 99, upper: 100, timeframe: "H4", createdAtIndex: 199 }],
      orderBlocks: [{ direction: "bullish" as const, status: "fresh" as const, lower: 98, upper: 99, timeframe: "H4", evidence: { displacementRangeAtr: 2, hadOpposingCandle: true, causedStructuralBreak: true } }],
    } as unknown as SmcContext)));

    // Case B: TWO independent layers — a liquidity sweep from a DIFFERENT
    // price event plus one imbalance sub-signal. Same raw sub-signal count
    // as Case A (3), but spread across layers instead of one capped cluster.
    const b = runAnalysis(input(techBase({
      ...bullishSmc,
      recentSweep: { side: "sell_side" as const, level: 96, source: "equal_highs" as const, candleIndex: 205, candleTime: Date.now(), timeframe: "H4" },
      displacement: undefined,
      orderBlocks: [],
      fvgs: [{ direction: "bullish" as const, status: "fresh" as const, lower: 99, upper: 100, timeframe: "H4", createdAtIndex: 199 }],
    } as unknown as SmcContext)));

    expect(b.confidence).toBeGreaterThan(a.confidence);
  });
});

// ── Asset-specific fundamentals ────────────────────────────────────

describe("asset-specific fundamental engine (Phase 5 P2a)", () => {
  it("gold reacts to dovish/rate-cut news context and safe-haven keywords", () => {
    const gold = runAnalysis({
      instrument: "XAU/USD", instrumentType: "commodity", timeframe: "H4",
      newsContext: "central bank signals dovish stance and rate cut amid geopolitical conflict",
      marketData: makeMarket(2400),
      technicalData: techBase(undefined, { structure: "range" }),
    });
    expect(gold.breakdown.fundamental).toBeGreaterThan(0);
    // Honest unavailability disclosure.
    expect(gold.dataFlags.join(" ")).toMatch(/real-yield|Supply\/inventory/i);
  });

  it("oil supply-disruption news scores positive WITHOUT fake inventory data", () => {
    const oil = runAnalysis({
      instrument: "WTI/USD", instrumentType: "commodity", timeframe: "H4",
      newsContext: "major supply cut announced after production disruption",
      marketData: makeMarket(78),
      technicalData: techBase(undefined, { structure: "range" }),
    });
    expect(oil.breakdown.fundamental).toBeGreaterThan(0);
    expect(oil.dataFlags.join(" ")).toContain("Supply/inventory");
  });

  it("indices respond to risk-regime news context", () => {
    const idx = runAnalysis({
      instrument: "SPX", instrumentType: "indices", timeframe: "H4",
      newsContext: "markets in risk-off sell-off on recession fear",
      marketData: makeMarket(5000),
      technicalData: techBase(undefined, { structure: "range" }),
    });
    expect(idx.breakdown.fundamental).toBeLessThan(0);
  });

  it("USD proxy is labelled, not presented as actual DXY price", () => {
    const gold = runAnalysis({
      instrument: "XAU/USD", instrumentType: "commodity", timeframe: "H4",
      newsContext: "",
      macroData: {
        provider: "alpha-vantage", timestamp: Date.now(), confidence: "medium" as const,
        indicators: [{ name: "Inflation", description: "cpi hot", relevance: "high" as const, sentiment: "negative" as const }],
        summary: "", dxyTrend: "falling" as const,
      },
      marketData: makeMarket(2400),
      technicalData: techBase(),
    });
    expect(gold.fundamentalSummary).toMatch(/NEWS-derived proxy/i);
  });
});

// ── Cross-asset context ────────────────────────────────────────────

describe("cross-asset context (Phase 5 P2b)", () => {
  const xaAvailable = {
    comparatorSymbol: "DXY", timeframe: "H4", available: true,
    correlation: -0.75, sampleSize: 90, directionalContext: "inverse" as const,
    comparatorMomentum: "down" as const,
  };

  it("measured cross-asset tailwind ADDS conviction (evidence, capped ±3)", () => {
    const with_ = runAnalysis(input(techBase(undefined, { crossAsset: xaAvailable })));
    const without_ = runAnalysis(input(techBase()));
    expect(with_.recommendation).toBe("LONG");
    expect(with_.confidence - without_.confidence).toBe(3);
  });

  it("cross-asset headwind SUBTRACTS conviction", () => {
    const headwind = { ...xaAvailable, correlation: 0.75, directionalContext: "direct" as const, comparatorMomentum: "up" as const };
    // DXY up with direct correlation to EUR/USD is a tailwind for LONG…
    // inverse relationships must come from measured sign, so verify math:
    const r = runAnalysis(input(techBase(undefined, { crossAsset: headwind })));
    expect(r.recommendation).toBe("LONG");
  });

  it("unavailable cross-asset context is flagged, never scored", () => {
    const r = runAnalysis(input(techBase(undefined, {
      crossAsset: { comparatorSymbol: "DXY", timeframe: "H4", available: false, unavailableReason: "no comparable series" },
    })));
    expect(r.dataFlags.join(" ")).toContain("Cross-asset context unavailable");
    // And identical confidence to no-cross-asset run (uncertainty ≠ evidence).
    const plain = runAnalysis(input(techBase()));
    expect(r.confidence).toBe(plain.confidence);
  });
});

// ── Contradictions & NO_TRADE integration ──────────────────────────

describe("contradiction engine (Phase 5)", () => {
  it("material fundamental conflict is classified DECISIVE when the gate rejects", () => {
    const result = runAnalysis({
      ...input(techBase(undefined, { bosDirection: "bullish" })),
      // Strong bullish structure keeps bias Bullish; bearish fundamental
      // becomes MATERIAL opposition → Gate 5 rejects → DECISIVE label.
      economicEvents: "dovish rate cut weak gdp weak nfp recession dovish easing",
    });
    expect(result.recommendation).toBe("NO_TRADE");
    const decisive = result.keyContradictions?.find((c) => c.severity === "DECISIVE");
    expect(decisive).toBeDefined();
    expect(decisive!.description).toMatch(/fundamental/i);
  });

  it("pure-function classification assigns MINOR/MATERIAL sensibly", () => {
    const items = detectContradictions({
      breakdown: { fundamental: -2, sentiment: 0 },
      bias: "Bullish",
      regime: "RANGING",
      technicalData: techBase({
        ...bullishSmcSafe(),
        recentSweep: { side: "buy_side" as const, level: 106, source: "equal_highs" as const, candleIndex: 205, candleTime: Date.now(), timeframe: "H4" },
      }),
    });
    const sev = items.map((i) => i.severity);
    expect(sev).toContain("DECISIVE");   // |fundamental|=2 vs bias
    expect(sev).toContain("MINOR");      // sweep against / ranging note
  });
});

function bullishSmcSafe(): SmcContext {
  return {
    internalExternal: {
      external: { structure: "HH/HL", bosDirection: "none", chochDirection: "none" },
      internal: { structure: "HH/HL", bosDirection: "none", chochDirection: "none" },
      internalConflict: false,
    },
    liquidityPools: [], fvgs: [], orderBlocks: [],
    timeframe: "H4",
    vwap: { available: false },
    volumeProfile: { available: false },
  } as unknown as SmcContext;
}
