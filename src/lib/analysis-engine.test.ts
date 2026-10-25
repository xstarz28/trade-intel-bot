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

  it("uses the 50/100/200-day moving-average group as one bullish conviction modifier", () => {
    const result = runAnalysis(baseInput({
      currentPrice: "120",
      technicalData: {
        sma50: 100, sma100: 110, sma200: 115,
        rsi14: 50, macdHistogram: 0,
        swingHighs: [], swingLows: [], structure: "range",
        supportLevels: [], resistanceLevels: [], volumeTrend: "unknown",
        dataPoints: 60,
      },
    }));
    expect(result.breakdown.indicator).toBe(1);
    // Indicators are conviction context only; they cannot create core bias.
    expect(result.bias).toBe("Neutral");
  });

  it("scores the moving-average group bearishly when price is below the available averages", () => {
    const result = runAnalysis(baseInput({
      currentPrice: "90",
      technicalData: {
        sma50: 100, sma100: 110, sma200: 115,
        rsi14: 50, macdHistogram: 0,
        swingHighs: [], swingLows: [], structure: "range",
        supportLevels: [], resistanceLevels: [], volumeTrend: "unknown",
        dataPoints: 60,
      },
    }));
    expect(result.breakdown.indicator).toBe(-1);
    expect(result.bias).toBe("Neutral");
  });

  it("scores MACD line/signal when the histogram is unavailable without double-counting both", () => {
    const result = runAnalysis(baseInput({
      technicalData: {
        macdLine: 2, macdSignal: 1,
        swingHighs: [], swingLows: [], structure: "range",
        supportLevels: [], resistanceLevels: [], volumeTrend: "unknown",
        dataPoints: 60,
      },
    }));
    expect(result.breakdown.indicator).toBe(1);
    expect(result.bias).toBe("Neutral");
  });

  it("does not assign a directional profile vote when VPVR is above value but TPO is inside value", () => {
    const result = runAnalysis(baseInput({
      currentPrice: "100",
      technicalData: {
        rsi14: 50,
        macdHistogram: 0,
        swingHighs: [],
        swingLows: [],
        structure: "range",
        supportLevels: [],
        resistanceLevels: [],
        volumeTrend: "unknown",
        dataPoints: 60,
        smc: {
          volumeProfile: { available: true, vah: 95, val: 90, poc: 92 },
          tpoProfile: { available: true, vah: 110, val: 90, poc: 100 },
        } as unknown as NonNullable<NonNullable<AnalysisInput["technicalData"]>["smc"]>,
      },
    }));
    expect(result.breakdown.indicator).toBe(0);
  });

  it("does not assign a directional profile vote when VPVR and TPO value areas are on opposite sides of price", () => {
    const result = runAnalysis(baseInput({
      currentPrice: "100",
      technicalData: {
        rsi14: 50,
        macdHistogram: 0,
        swingHighs: [],
        swingLows: [],
        structure: "range",
        supportLevels: [],
        resistanceLevels: [],
        volumeTrend: "unknown",
        dataPoints: 60,
        smc: {
          volumeProfile: { available: true, vah: 99, val: 95, poc: 97 },
          tpoProfile: { available: true, vah: 105, val: 101, poc: 103 },
        } as unknown as NonNullable<NonNullable<AnalysisInput["technicalData"]>["smc"]>,
      },
    }));
    expect(result.breakdown.indicator).toBe(0);
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

  it("orients interest-rate surprises by the event currency's base/quote position", () => {
    const calendarData = {
      provider: "tickatlas" as const,
      events: [{
        id: "rate-surprise",
        event: "Interest Rate Decision",
        category: "Interest Rate",
        country: "United States",
        currency: "USD",
        datetime: Date.now() - 60_000,
        actual: 5.5,
        forecast: 5.0,
        previous: 5.0,
        importance: 3 as const,
        source: "tickatlas",
        status: "released" as const,
      }],
      macroRisk: { level: "low" as const, explanation: "test", highImpact24h: 0, highImpact72h: 0 },
      timestamp: Date.now(),
      freshness: "recent" as const,
      confidence: "medium" as const,
      availability: { upcoming24h: false, upcoming72h: false, recentReleased: true },
    };
    const analyze = (instrument: string) => runAnalysis(baseInput({
      instrumentType: "forex",
      instrument,
      calendarData,
    }));

    expect(analyze("EUR/USD").breakdown.fundamental).toBe(-1);
    expect(analyze("USD/JPY").breakdown.fundamental).toBe(1);
    expect(analyze("GBP/JPY").breakdown.fundamental).toBe(0);
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

  it("scores available stock fundamentals even when macro context is also available", () => {
    const result = runAnalysis(baseInput({
      instrument: "AAPL",
      instrumentType: "stock",
      macroData: {
        provider: "alpha-vantage",
        timestamp: Date.now(),
        indicators: [{ name: "Neutral news context", relevance: "low", sentiment: "neutral" }],
        summary: "Neutral macro/news context",
        confidence: "medium",
      },
      fundamentalData: {
        provider: "alpha-vantage",
        timestamp: Date.now(),
        instrumentType: "stock",
        symbol: "AAPL",
        available: true,
        peRatio: 12,
        profitMargin: 0.25,
        earningsPerShare: 3,
      },
    }));

    expect(result.breakdown.fundamental).toBeGreaterThan(0);
  });
});

// ── TPO + VPVR integration ────────────────────────────────────────

describe("TPO + VPVR analysis integration", () => {
  it("uses available profile levels in the conviction trace and technical explanation", () => {
    const result = runAnalysis(baseInput({
      currentPrice: "1.11",
      marketData: {
        instrument: "EUR/USD",
        instrumentType: "forex",
        provider: "test",
        fetchTimestamp: Date.now(),
        price: { price: 1.11, timestamp: Date.now(), source: "test" },
        candles: Array.from({ length: 60 }, (_, i) => ({
          timestamp: Date.now() - (60 - i) * 86400000,
          open: 1.10, high: 1.12, low: 1.08, close: 1.11, volume: 1000,
        })),
        timeframe: "D1",
        dataFreshness: "delayed",
      },
      technicalData: {
        atr14: 0.01,
        sma50: 1.07,
        sma100: 1.06,
        sma200: 1.05,
        rsi14: 62,
        rsiDivergence: "bullish",
        macdLine: 0.012,
        macdSignal: 0.008,
        macdHistogram: 0.004,
        avgVolume20: 1250,
        dailyRange: 0.02,
        fibLevels: {
          level236: 1.20,
          level382: 1.22,
          level500: 1.24,
          level618: 1.26,
          level786: 1.28,
        },
        swingHighs: [1.25, 1.30],
        swingLows: [1.07, 1.08],
        structure: "HH/HL",
        bosDirection: "bullish",
        supportLevels: [1.08],
        resistanceLevels: [1.30],
        volumeTrend: "increasing",
        dataPoints: 60,
        htfContext: {
          timeframe: "D1",
          structure: "HH/HL",
          bosDirection: "bullish",
          chochDirection: "none",
          dataPoints: 60,
        },
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
    expect(result.technicalSummary).toContain("Moving averages: SMA50");
    expect(result.technicalSummary).toContain("SMA200");
    expect(result.technicalSummary).toContain("Fibonacci retracement levels");
    expect(result.technicalSummary).toContain("MACD(12,26,9)");
    expect(result.technicalSummary).toContain("bullish divergence detected");
    expect(result.technicalSummary).toContain("20-candle average volume");
    expect(result.technicalSummary).toContain("Latest candle range");
    const layer = result.decisionTrace?.convictionBreakdown.layers.find((item) => item.layer === "TPO + VPVR");
    expect(layer).toBeDefined();
    expect(layer?.cap).toBe(5);
    expect(layer?.reason).toContain("VPVR POC");
    expect(layer?.reason).toContain("TPO POC");
    const maLayer = result.decisionTrace?.convictionBreakdown.layers.find((item) => item.layer === "Moving Averages");
    expect(maLayer).toBeDefined();
    expect(maLayer?.cap).toBe(4);
    expect(maLayer?.contribution).toBeGreaterThan(0);
  });
});

describe("asset-specific fundamental evidence integration", () => {
  it("uses verified fresh crypto fundamentals while deduplicating shared dependencies", () => {
    const result = runAnalysis(baseInput({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      currentPrice: "100",
      newsContext: "ETF adoption supports BTC market fundamentals",
      recentHigh: "105",
      recentLow: "90",
      marketData: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        provider: "test",
        fetchTimestamp: Date.now(),
        price: { price: 100, timestamp: Date.now(), source: "test" },
        candles: Array.from({ length: 60 }, (_, i) => ({
          timestamp: Date.now() - (60 - i) * 86400000,
          open: 99, high: 102, low: 98, close: 100, volume: 1000,
        })),
        timeframe: "D1",
        dataFreshness: "delayed",
      },
      technicalData: {
        atr14: 2,
        swingHighs: [115, 120],
        swingLows: [90, 95],
        structure: "HH/HL",
        bosDirection: "bullish",
        supportLevels: [90],
        resistanceLevels: [120],
        volumeTrend: "stable",
        dataPoints: 60,
        htfContext: {
          timeframe: "D1",
          structure: "HH/HL",
          bosDirection: "bullish",
          chochDirection: "none",
          dataPoints: 60,
        },
      },
      cryptoIntelligenceContext: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        assembledAt: Date.now(),
        evidence: [
          {
            source: "DeFiLlama",
            category: "DEFI_FUNDAMENTAL",
            direction: "SUPPORTING",
            strength: "STRONG",
            quality: "VERIFIED",
            freshness: "FRESH",
            dependencyGroup: "DEFI_TVL",
            explanation: "Verified TVL evidence",
            providerAvailable: true,
          },
          {
            source: "DeFiLlama",
            category: "DEFI_FUNDAMENTAL",
            direction: "SUPPORTING",
            strength: "WEAK",
            quality: "VERIFIED",
            freshness: "FRESH",
            dependencyGroup: "DEFI_TVL",
            explanation: "Same underlying TVL dependency",
            providerAvailable: true,
          },
        ],
        overallAvailability: "FULL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "Test-only asset fundamentals",
      },
    }));

    expect(result.bias).toBe("Bullish");
    const layer = result.decisionTrace?.convictionBreakdown.layers.find(
      (item) => item.layer === "Asset-Specific Fundamentals",
    );
    expect(layer).toBeDefined();
    expect(layer?.contribution).toBe(3);
    expect(layer?.reason).toContain("2 eligible evidence items across 1 dependency groups");
  });
  it("opposes a short thesis when the verified fundamentals are long-side bullish", () => {
    const result = runAnalysis(baseInput({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      currentPrice: "100",
      newsContext: "regulation crackdown",
      recentHigh: "105",
      recentLow: "60",
      marketData: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        provider: "test",
        fetchTimestamp: Date.now(),
        price: { price: 100, timestamp: Date.now(), source: "test" },
        candles: Array.from({ length: 60 }, (_, i) => ({
          timestamp: Date.now() - (60 - i) * 86400000,
          open: 99, high: 102, low: 98, close: 100, volume: 1000,
        })),
        timeframe: "D1",
        dataFreshness: "delayed",
      },
      technicalData: {
        swingHighs: [104, 105],
        swingLows: [60, 70],
        structure: "LH/LL",
        bosDirection: "bearish",
        supportLevels: [70],
        resistanceLevels: [105],
        volumeTrend: "stable",
        dataPoints: 60,
        htfContext: {
          timeframe: "D1",
          structure: "LH/LL",
          bosDirection: "bearish",
          chochDirection: "none",
          dataPoints: 60,
        },
      },
      cryptoIntelligenceContext: {
        instrument: "BTC/USD",
        instrumentType: "crypto",
        assembledAt: Date.now(),
        evidence: [{
          source: "DeFiLlama",
          category: "DEFI_FUNDAMENTAL",
          direction: "SUPPORTING",
          strength: "STRONG",
          quality: "VERIFIED",
          freshness: "FRESH",
          dependencyGroup: "DEFI_TVL",
          explanation: "Bullish long-side evidence",
          providerAvailable: true,
        }],
        overallAvailability: "FULL",
        overallQuality: "VERIFIED",
        missingInformation: [],
        dataFlags: [],
        analystSummary: "Test-only asset fundamentals",
      },
    }));

    expect(result.bias).toBe("Bearish");
    const layer = result.decisionTrace?.convictionBreakdown.layers.find(
      (item) => item.layer === "Asset-Specific Fundamentals",
    );
    expect(layer).toBeDefined();
    expect(layer?.contribution).toBe(-3);
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

describe("stock fundamental scoring", () => {
  it("scores company fundamentals even when news-derived macro indicators are available", () => {
    const macroData = {
      provider: "alpha-vantage",
      timestamp: Date.now(),
      indicators: [{
        name: "earnings outlook",
        relevance: "high" as const,
        sentiment: "neutral" as const,
      }],
      summary: "neutral news-derived context",
      confidence: "high" as const,
    };
    const macroOnly = runAnalysis(baseInput({
      instrument: "AAPL",
      instrumentType: "stock",
      macroData,
    }));
    const withFundamentals = runAnalysis(baseInput({
      instrument: "AAPL",
      instrumentType: "stock",
      macroData,
      fundamentalData: {
        provider: "alpha-vantage",
        timestamp: Date.now(),
        instrumentType: "stock",
        symbol: "AAPL",
        available: true,
        peRatio: 12,
        forwardPeRatio: 18,
        profitMargin: 0.25,
        earningsPerShare: 4,
        pegRatio: 0.8,
        priceToSalesRatio: 5.2,
        evToRevenue: 4.1,
        evToEbitda: 15,
        revenueGrowth: 0.12,
        earningsGrowth: 0.22,
        returnOnAssets: 0.08,
        operatingMargin: 0.2,
        returnOnEquity: 0.2,
        priceToBook: 4.2,
        dividendYield: 0.01,
        revenueTTM: 100_000_000_000,
        grossProfitTTM: 50_000_000_000,
        dilutedEPS: 3.8,
        beta: 1.2,
        sharesOutstanding: 15_000_000_000,
        fiftyDayMovingAverage: 120,
        twoHundredDayMovingAverage: 110,
        fiftyTwoWeekLow: 80,
        fiftyTwoWeekHigh: 160,
        analystTargetPrice: 150,
        latestEarnings: { date: "2026-10-01", eps: 4, revenue: 5_000_000_000 },
      },
    }));

    // The stock metrics add a positive signal even with a macro feed present;
    // the engine's documented factor cap limits the aggregate to +2.
    expect(macroOnly.breakdown.fundamental).toBe(0);
    expect(withFundamentals.breakdown.fundamental).toBe(2);
    expect(withFundamentals.fundamentalSummary).toContain("PEG: 0.80");
    expect(withFundamentals.fundamentalSummary).toContain("ROE: 20.0%");
    expect(withFundamentals.fundamentalSummary).toContain("Quarterly revenue growth YoY: 12.0%");
    expect(withFundamentals.fundamentalSummary).toContain("Quarterly earnings growth YoY: 22.0%");
    expect(withFundamentals.fundamentalSummary).toContain("EV/EBITDA: 15.00");
    expect(withFundamentals.fundamentalSummary).toContain("Revenue TTM: $100.00B");
    expect(withFundamentals.fundamentalSummary).toContain("Diluted EPS (TTM): $3.80");
    expect(withFundamentals.fundamentalSummary).toContain("Beta: 1.20");
    expect(withFundamentals.fundamentalSummary).toContain("Analyst target estimate: $150.00");
    expect(withFundamentals.fundamentalSummary).toContain("52-week range: 80.00–160.00");
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


describe("live price freshness gate", () => {
  it("does not let a delayed quote bypass staleness just because it matches the last candle", () => {
    const oldTimestamp = Date.now() - 48 * 60 * 60_000;
    const result = runAnalysis(baseInput({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "D1",
      marketData: {
        instrument: "EUR/USD",
        instrumentType: "forex",
        provider: "test",
        fetchTimestamp: oldTimestamp,
        price: { price: 1.1, timestamp: oldTimestamp, source: "test" },
        candles: [{ timestamp: oldTimestamp, open: 1.09, high: 1.11, low: 1.08, close: 1.1, volume: 100 }],
        timeframe: "D1",
        dataFreshness: "delayed",
      },
    }));
    expect(result.noTradeReasons.join(" ")).toContain("Price snapshot is older than");
  });
});


describe("future market price timestamp gate", () => {
  it("rejects a quote timestamp beyond the documented clock-skew tolerance", () => {
    const futureTimestamp = Date.now() + 5 * 60_000;
    const result = runAnalysis(baseInput({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "D1",
      marketData: {
        instrument: "EUR/USD",
        instrumentType: "forex",
        provider: "test",
        fetchTimestamp: Date.now(),
        price: { price: 1.1, timestamp: futureTimestamp, source: "test" },
        candles: [{ timestamp: futureTimestamp, open: 1.09, high: 1.11, low: 1.08, close: 1.1, volume: 100 }],
        timeframe: "D1",
        dataFreshness: "delayed",
      },
    }));
    expect(result.noTradeReasons.join(" ")).toContain("implausibly in the future");
  });
});
