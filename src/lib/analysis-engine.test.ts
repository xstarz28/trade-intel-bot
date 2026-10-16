import { describe, it, expect } from "vitest";
import { calculateBias, runAnalysis } from "./analysis-engine";
import { treasury as treasuryFixture } from "./benchmark-fixtures.phase9";
import type { AnalysisInput } from "@/types/analysis";

function baseInput(overrides?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "D1",
    ...overrides,
  };
}

// ── Bias calculation ──────────────────────────────────────────────

describe("calculateBias (via runAnalysis)", () => {
  it("returns Neutral when all scores are zero", () => {
    const result = runAnalysis(baseInput());
    expect(result.bias).toBe("Neutral");
  });

  it("applies the documented 40/40/20 weights without letting fundamentals flip structure", () => {
    const result = calculateBias({
      trend: 1,
      fundamental: -2,
      sentiment: 0,
      indicator: 0,
    });

    // The score reflects the full fundamental weight, but direction remains
    // structurally bullish; Gate 5 decides whether opposing evidence rejects it.
    expect(result.coreWeightedAvg).toBeCloseTo(-0.4, 8);
    expect(result.bias).toBe("Bullish");
  });

  it("does not create a directional thesis from non-technical evidence alone", () => {
    const result = calculateBias({
      trend: 0,
      fundamental: 2,
      sentiment: 2,
      indicator: 0,
    });

    expect(result.coreWeightedAvg).toBeCloseTo(1.2, 8);
    expect(result.bias).toBe("Neutral");
  });

  it("returns Bullish when trend is strong and price is near high", () => {
    const result = runAnalysis(
      baseInput({
        currentPrice: "1.10",
        recentHigh: "1.11",
        recentLow: "1.00",
      }),
    );
    // Price at upper range → trend +2
    expect(result.breakdown.trend).toBeGreaterThanOrEqual(1);
    // PHASE 8 P1 behavior change:
    // OLD: final bias was Bullish from the price-position-in-range heuristic.
    // WHY CHANGED: price position inside user-supplied highs/lows is NOT
    //      market structure — under the veto-model it cannot create a thesis.
    // NEW: evidence (breakdown.trend) is preserved; final bias is Neutral
    //      because no external structural direction exists.
    // WHY CORRECT: structure creates theses (F-5); a range-position heuristic
    //      is not structural evidence.
    expect(result.bias).toBe("Neutral");
  });

  it("returns Bearish when price is near the low", () => {
    const result = runAnalysis(
      baseInput({
        currentPrice: "1.01",
        recentHigh: "1.11",
        recentLow: "1.00",
      }),
    );
    // PHASE 8 P1 — see the bullish counterpart above for the documented
    // change: evidence stays, thesis authority never comes from a position
    // heuristic without structural data.
    expect(result.breakdown.trend).toBeLessThanOrEqual(-1);
    expect(result.bias).toBe("Neutral");
  });
});

// ── Trend scoring ─────────────────────────────────────────────────

describe("scoreTrend (via breakdown)", () => {
  it("scores bullish when price is near high", () => {
    const result = runAnalysis(
      baseInput({
        currentPrice: "1.10",
        recentHigh: "1.11",
        recentLow: "1.00",
      }),
    );
    expect(result.breakdown.trend).toBeGreaterThanOrEqual(1);
  });

  it("scores bearish when price is near low", () => {
    const result = runAnalysis(
      baseInput({
        currentPrice: "1.01",
        recentHigh: "1.11",
        recentLow: "1.00",
      }),
    );
    expect(result.breakdown.trend).toBeLessThanOrEqual(-1);
  });

  it("scores neutral when no price data is provided", () => {
    const result = runAnalysis(baseInput());
    expect(result.breakdown.trend).toBe(0);
  });
});

// ── Indicator scoring ─────────────────────────────────────────────

describe("scoreIndicators (via breakdown)", () => {
  it("scores +1 for rally/surge/breakout keywords", () => {
    const result = runAnalysis(
      baseInput({ newsContext: "Market rally continues strong" }),
    );
    expect(result.breakdown.indicator).toBeGreaterThanOrEqual(1);
  });

  it("scores -1 for crash/plunge/breakdown keywords", () => {
    const result = runAnalysis(
      baseInput({ newsContext: "Market crashes after data" }),
    );
    expect(result.breakdown.indicator).toBeLessThanOrEqual(-1);
  });

  it("scores -1 for bearish divergence (not 0)", () => {
    const result = runAnalysis(
      baseInput({ newsContext: "Bearish divergence on daily chart" }),
    );
    expect(result.breakdown.indicator).toBe(-1);
  });

  it("scores +1 for bullish divergence", () => {
    const result = runAnalysis(
      baseInput({ newsContext: "Bullish divergence forming on RSI" }),
    );
    expect(result.breakdown.indicator).toBe(1);
  });

  it("scores +1 for bare 'divergence' without bearish prefix", () => {
    const result = runAnalysis(
      baseInput({ newsContext: "Divergence noted on MACD" }),
    );
    expect(result.breakdown.indicator).toBe(1);
  });

  it("scores 0 with empty context", () => {
    const result = runAnalysis(baseInput());
    expect(result.breakdown.indicator).toBe(0);
  });
});

// ── Fundamental scoring ───────────────────────────────────────────

describe("scoreFundamentals (via breakdown)", () => {
  it("scores +1 for hawkish forex news", () => {
    const result = runAnalysis(
      baseInput({
        instrumentType: "forex",
        economicEvents: "Fed signals hawkish stance",
      }),
    );
    expect(result.breakdown.fundamental).toBeGreaterThanOrEqual(1);
  });

  it("orients DXY strength for base, quote, and non-USD cross pairs", () => {
    const macroData = {
      provider: "test", timestamp: Date.now(),
      indicators: [{ name: "context", relevance: "low" as const, sentiment: "neutral" as const }],
      summary: "test", confidence: "medium" as const, dxyTrend: "rising" as const,
    };
    const analyze = (instrument: string) => runAnalysis(baseInput({ instrumentType: "forex", instrument, macroData }));
    expect(analyze("EUR/USD").breakdown.fundamental).toBe(-1);
    expect(analyze("USD/JPY").breakdown.fundamental).toBe(1);
    expect(analyze("EUR/GBP").breakdown.fundamental).toBe(0);
  });

  it("scores -1 for dovish forex news", () => {
    const result = runAnalysis(
      baseInput({
        instrumentType: "forex",
        economicEvents: "ECB dovish, rate cut expected",
      }),
    );
    expect(result.breakdown.fundamental).toBeLessThanOrEqual(-1);
  });

  it("scores +1 for crypto institutional adoption", () => {
    const result = runAnalysis(
      baseInput({
        instrumentType: "crypto",
        instrument: "BTC/USD",
        newsContext: "Institutional adoption growing",
      }),
    );
    expect(result.breakdown.fundamental).toBeGreaterThanOrEqual(1);
  });

  it("scores -1 for crypto regulation news", () => {
    const result = runAnalysis(
      baseInput({
        instrumentType: "crypto",
        instrument: "BTC/USD",
        newsContext: "New regulation crackdown announced",
      }),
    );
    expect(result.breakdown.fundamental).toBeLessThanOrEqual(-1);
  });
});

// ── TPO + VPVR integration ────────────────────────────────────────

describe("TPO + VPVR analysis integration", () => {
  it("uses available profile levels in the conviction trace and technical explanation", () => {
    const result = runAnalysis(baseInput({
      currentPrice: "1.11",
      technicalData: {
        swingHighs: [1.08, 1.10],
        swingLows: [1.04, 1.06],
        structure: "HH/HL",
        bosDirection: "bullish",
        supportLevels: [1.06],
        resistanceLevels: [1.10, 1.12],
        volumeTrend: "increasing",
        dataPoints: 60,
        smc: {
          timeframe: "D1",
          liquidityPools: [],
          internalExternal: {
            external: { timeframe: "D1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", dataPoints: 60 },
            internal: { timeframe: "D1", structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", dataPoints: 60 },
            internalConflict: false,
          },
          fvgs: [],
          orderBlocks: [],
          vwap: { available: true, sessionVwap: 1.08, priceLocation: "above_vwap" },
          volumeProfile: {
            available: true, poc: 1.085, vah: 1.10, val: 1.07,
            hvn: [1.09], lvn: [1.075],
            approximation: "OHLCV-range allocation approximation",
          },
          tpoProfile: {
            available: true, poc: 1.087, vah: 1.101, val: 1.071,
            totalTpo: 120, blockMinutes: 30, valueAreaPercent: 0.7,
          },
        },
      },
    }));

    expect(result.technicalSummary).toContain("VPVR");
    expect(result.technicalSummary).toContain("TPO market profile");
    const layer = result.decisionTrace?.convictionBreakdown.layers.find((item) => item.layer === "TPO + VPVR");
    expect(layer).toBeDefined();
    expect(layer?.cap).toBe(5);
    expect(layer?.reason).toContain("VPVR POC");
    expect(layer?.reason).toContain("TPO POC");
  });
});

// ── Sentiment scoring ─────────────────────────────────────────────

describe("scoreSentiment (via breakdown)", () => {
  it("uses increasing volume as bullish confirmation only with HH/HL", () => {
    const result = runAnalysis(baseInput({ technicalData: {
      swingHighs: [1.1, 1.2], swingLows: [1.0, 1.1], structure: "HH/HL",
      supportLevels: [1.1], resistanceLevels: [1.2], volumeTrend: "increasing", dataPoints: 30,
    }}));
    expect(result.breakdown.sentiment).toBeGreaterThan(0);
  });

  it("uses increasing volume as bearish confirmation with LH/LL", () => {
    const result = runAnalysis(baseInput({ technicalData: {
      swingHighs: [1.2, 1.1], swingLows: [1.1, 1.0], structure: "LH/LL",
      supportLevels: [1.0], resistanceLevels: [1.1], volumeTrend: "increasing", dataPoints: 30,
    }}));
    expect(result.breakdown.sentiment).toBeLessThan(0);
  });

  it("treats decreasing volume as weakening bullish structure", () => {
    const result = runAnalysis(baseInput({ technicalData: {
      swingHighs: [1.1, 1.2], swingLows: [1.0, 1.1], structure: "HH/HL",
      supportLevels: [1.1], resistanceLevels: [1.2], volumeTrend: "decreasing", dataPoints: 30,
    }}));
    expect(result.breakdown.sentiment).toBeLessThan(0);
  });

  it("treats decreasing volume as weakening bearish structure", () => {
    const result = runAnalysis(baseInput({ technicalData: {
      swingHighs: [1.2, 1.1], swingLows: [1.1, 1.0], structure: "LH/LL",
      supportLevels: [1.0], resistanceLevels: [1.1], volumeTrend: "decreasing", dataPoints: 30,
    }}));
    expect(result.breakdown.sentiment).toBeGreaterThan(0);
  });

  it("scores -1 for high positive funding rate (contrarian bearish)", () => {
    const result = runAnalysis(
      baseInput({
        instrumentType: "crypto",
        instrument: "BTC/USD",
        fundingRate: "0.08",
      }),
    );
    expect(result.breakdown.sentiment).toBeLessThanOrEqual(-1);
  });

  it("scores +1 for negative funding rate (contrarian bullish)", () => {
    const result = runAnalysis(
      baseInput({
        instrumentType: "crypto",
        instrument: "BTC/USD",
        fundingRate: "-0.08",
      }),
    );
    expect(result.breakdown.sentiment).toBeGreaterThanOrEqual(1);
  });

  it("scores +1 for fear/panic (contrarian bullish)", () => {
    const result = runAnalysis(
      baseInput({ newsContext: "Market in panic mode, extreme fear" }),
    );
    expect(result.breakdown.sentiment).toBeGreaterThanOrEqual(1);
  });

  it("scores -1 for greed/euphoria (contrarian bearish)", () => {
    const result = runAnalysis(
      baseInput({ newsContext: "Euphoria and greed everywhere" }),
    );
    expect(result.breakdown.sentiment).toBeLessThanOrEqual(-1);
  });
});

// ── Data completeness ─────────────────────────────────────────────

describe("dataCompleteness", () => {
  it("marks 'limited' when only manual inputs are provided (no marketData/technicalData)", () => {
    const result = runAnalysis(
      baseInput({
        currentPrice: "1.10",
        recentHigh: "1.11",
        recentLow: "1.00",
        newsContext: "Strong rally",
        economicEvents: "NFP data released",
      }),
    );
    // Without marketData/technicalData, the engine marks partial at best
    expect(["partial", "limited"]).toContain(result.dataCompleteness);
  });

  it("marks 'full' when marketData and technicalData are provided", () => {
    const result = runAnalysis(
      baseInput({
        marketData: {
          instrument: "EUR/USD",
          instrumentType: "forex",
          provider: "twelve-data",
          fetchTimestamp: Date.now(),
          price: { price: 1.10, timestamp: Date.now(), source: "twelve-data" },
          candles: Array.from({ length: 210 }, (_, i) => ({
            timestamp: Date.now() - (210 - i) * 86400000,
            open: 1.0 + i * 0.001,
            high: 1.0 + i * 0.001 + 0.005,
            low: 1.0 + i * 0.001 - 0.005,
            close: 1.0 + i * 0.001 + 0.002,
            volume: 1000,
          })),
          timeframe: "D1",
          dataFreshness: "delayed",
        },
        technicalData: {
          swingHighs: [1.2],
          swingLows: [1.0],
          structure: "HH/HL" as const,
          supportLevels: [1.0],
          resistanceLevels: [1.2],
          volumeTrend: "stable" as const,
          dataPoints: 210,
          rsi14: 55,
        },
      }),
    );
    expect(result.dataCompleteness).toBe("full");
  });

  it("does not count unavailable intelligence payloads as available evidence", () => {
    const result = runAnalysis(baseInput({
      sentimentData: {
        provider: "alpha-vantage", timestamp: Date.now(), averageScore: 0, articleCount: 0,
        label: "neutral", breakdown: { positive: 0, negative: 0, neutral: 0 },
        confidence: "unavailable", articles: [],
      },
      fundamentalData: {
        provider: "alpha-vantage", timestamp: Date.now(), instrumentType: "forex",
        available: false, unavailableReason: "no data",
      },
      macroData: {
        provider: "alpha-vantage", timestamp: Date.now(), indicators: [],
        summary: "unavailable", confidence: "unavailable",
      },
      newsContext: "   ",
    }));
    expect(result.dataFlags).toContain(
      "No news context or core fundamental intelligence data — fundamental analysis limited to technicals",
    );
  });

  it("recognizes actual Treasury macro data when the commodity news feed is unavailable", () => {
    const result = runAnalysis(baseInput({
      instrument: "XAU/USD",
      instrumentType: "commodity",
      treasuryData: treasuryFixture(20),
      fundamentalData: {
        provider: "alpha-vantage", timestamp: Date.now(), instrumentType: "commodity",
        available: false, unavailableReason: "no commodity fundamentals feed",
      },
      sentimentData: {
        provider: "alpha-vantage", timestamp: Date.now(), averageScore: 0, articleCount: 0,
        label: "neutral", breakdown: { positive: 0, negative: 0, neutral: 0 },
        confidence: "unavailable", articles: [],
      },
      newsContext: "",
    }));
    expect(result.dataFlags).not.toContain(
      "No news context or core fundamental intelligence data — fundamental analysis limited to technicals",
    );
  });

  it("does not count an unavailable calendar or zero price as usable data", () => {
    const result = runAnalysis(baseInput({
      instrumentType: "forex",
      marketData: {
        instrument: "EUR/USD", instrumentType: "forex", provider: "test", fetchTimestamp: Date.now(),
        price: { price: 0, timestamp: Date.now(), source: "test" }, candles: [],
        timeframe: "D1", dataFreshness: "unavailable",
      },
      calendarData: {
        provider: "tickatlas", events: [],
        macroRisk: { level: "medium", explanation: "unavailable", highImpact24h: 0, highImpact72h: 0 },
        timestamp: Date.now(), freshness: "unavailable", confidence: "unavailable",
        availability: { upcoming24h: false, upcoming72h: false, recentReleased: false },
      },
    }));
    expect(result.dataFlags).toContain("No valid positive price data available — scored neutral");
    expect(result.dataFlags).toContain("No economic calendar data — macro events not factored");
    expect(result.recommendation).toBe("NO_TRADE");
  });

  it("does not crash for malformed optional provider payloads", () => {
    expect(() => runAnalysis(baseInput({
      derivativesData: { confidence: "medium" } as any,
      marketData: {
        instrument: "EUR/USD", instrumentType: "forex", provider: "test", fetchTimestamp: Date.now(),
        price: undefined, candles: [], timeframe: "D1", dataFreshness: "unavailable",
      } as any,
    }))).not.toThrow();
  });

  it("marks 'limited' with no data at all", () => {
    const result = runAnalysis(baseInput());
    expect(result.dataCompleteness).toBe("limited");
    expect(result.dataFlags.length).toBeGreaterThanOrEqual(3);
  });

  it("marks 'limited' with no manual or auto data", () => {
    const result = runAnalysis(baseInput());
    expect(result.dataCompleteness).toBe("limited");
  });
});

// ── Key levels ────────────────────────────────────────────────────

describe("keyLevels", () => {
  it("uses provided price data for levels", () => {
    const result = runAnalysis(
      baseInput({
        currentPrice: "1.10",
        recentHigh: "1.11",
        recentLow: "1.05",
      }),
    );
    expect(result.keyLevels.support).toBe("1.05");
    expect(result.keyLevels.resistance).toBe("1.11");
  });

  it("does NOT fabricate levels when no market-derived levels exist", () => {
    const result = runAnalysis(
      baseInput({ currentPrice: "1.10" }),
    );
    // Phase 1: no synthetic price×% fallback — levels stay empty and
    // the engine refuses to trade without structural confirmation.
    expect(result.keyLevels.support).toBe("");
    expect(result.keyLevels.resistance).toBe("");
    expect(result.recommendation).toBe("NO_TRADE");
  });

  it("derives resistance from ATR when resistanceLevels is empty but supportLevels exists", () => {
    const result = runAnalysis(
      baseInput({
        instrument: "BTC/USD",
        instrumentType: "crypto",
        timeframe: "H4",
        marketData: {
          instrument: "BTC/USD",
          instrumentType: "crypto",
          provider: "twelve-data",
          fetchTimestamp: Date.now(),
          price: { price: 71720, timestamp: Date.now(), source: "twelve-data" },
          candles: [],
          timeframe: "H4",
          dataFreshness: "delayed",
        },
        technicalData: {
          swingHighs: [65000],
          swingLows: [62000, 63000, 64000],
          structure: "range" as const,
          bosDirection: "bullish" as const,
          supportLevels: [63000, 64000],
          resistanceLevels: [], // price above all swing highs
          volumeTrend: "stable" as const,
          dataPoints: 210,
          atr14: 1150,
          rsi14: 86.7,
          macdHistogram: 700,
          sma50: 64470,
          sma200: 64455,
        },
      }),
    );
    // Support should come from technical levels, not price * 0.98
    expect(result.keyLevels.support).toBe("64000");
    // Phase 1: no synthetic ATR-derived resistance — level stays empty
    expect(result.keyLevels.resistance).toBe("");
    // Without an opposing structural level the engine refuses to trade
    expect(result.recommendation).toBe("NO_TRADE");
    expect(result.noTradeReasons.length).toBeGreaterThan(0);
  });
});

// ── Instrument formatting ─────────────────────────────────────────

describe("instrument formatting", () => {
  it("uppercases the instrument name", () => {
    const result = runAnalysis(baseInput({ instrument: "eur/usd" }));
    expect(result.instrument).toBe("EUR/USD");
  });
});

// ── Confidence bounds ─────────────────────────────────────────────

describe("confidence", () => {
  it("stays within 20-95 range", () => {
    // Very bullish inputs
    const bullish = runAnalysis(
      baseInput({
        currentPrice: "1.109",
        recentHigh: "1.11",
        recentLow: "1.00",
        newsContext: "rally breakout surge institutional adoption",
        economicEvents: "hawkish rate hike tightening strong gdp",
        fundingRate: "-0.1",
      }),
    );
    expect(bullish.confidence).toBeGreaterThanOrEqual(20);
    expect(bullish.confidence).toBeLessThanOrEqual(95);

    // Empty inputs → neutral
    const neutral = runAnalysis(baseInput());
    expect(neutral.confidence).toBeGreaterThanOrEqual(20);
    expect(neutral.confidence).toBeLessThanOrEqual(95);
  });
});
