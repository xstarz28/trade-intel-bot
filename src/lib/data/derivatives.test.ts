import { describe, it, expect } from "vitest";
import type { CryptoDerivativesData } from "./derivatives-types";

// ── Derivatives Types ──────────────────────────────────────────

describe("CryptoDerivativesData types", () => {
  it("constructs a valid derivatives object", () => {
    const data: CryptoDerivativesData = {
      provider: "coinglass",
      symbol: "BTC",
      timestamp: Date.now(),
      freshness: "delayed",
      openInterest: { current: 15000000000 },
      fundingRate: { currentRate: 0.0001, annualizedRate: 0.1095 },
      longShort: { accountRatio: 1.2 },
      liquidations: { totalVolume: 50000000, dominantSide: "longs" },
      availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
      confidence: "high",
    };
    expect(data.provider).toBe("coinglass");
    expect(data.confidence).toBe("high");
    expect(data.availability.openInterest).toBe(true);
  });

  it("constructs unavailable derivatives object", () => {
    const data: CryptoDerivativesData = {
      provider: "coinglass",
      symbol: "ETH",
      timestamp: Date.now(),
      freshness: "unavailable",
      availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: false },
      confidence: "unavailable",
    };
    expect(data.confidence).toBe("unavailable");
  });
});

// ── Scoring Integration ────────────────────────────────────────

describe("derivatives scoring in analysis engine", () => {
  // We test the scoring logic indirectly by verifying the analysis engine
  // produces different results when derivatives data is provided vs not.

  it("exports runAnalysis from the engine", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    expect(typeof runAnalysis).toBe("function");
  });

  it("scores neutral when no derivatives data for crypto", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const result = runAnalysis({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
    });
    // Without any data, sentiment should be 0
    expect(result.breakdown.sentiment).toBe(0);
  });

  it("applies contrarian funding rate signal", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const result = runAnalysis({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      derivativesData: {
        provider: "coinglass",
        symbol: "BTC",
        timestamp: Date.now(),
        freshness: "delayed",
        fundingRate: { currentRate: 0.002 }, // Very positive = crowded longs
        availability: { openInterest: false, fundingRate: true, longShort: false, liquidations: false },
        confidence: "low",
      },
      technicalData: {
        swingHighs: [], swingLows: [], structure: "range",
        supportLevels: [], resistanceLevels: [],
        volumeTrend: "stable", dataPoints: 100,
      },
      marketData: {
        instrument: "BTC/USD", instrumentType: "crypto", provider: "twelve-data",
        fetchTimestamp: Date.now(),
        price: { price: 65000, timestamp: Date.now(), source: "twelve-data" },
        candles: [], timeframe: "H4",
        dataFreshness: "delayed",
      },
    });
    // Very positive funding (>0.001) should push sentiment bearish
    expect(result.breakdown.sentiment).toBeLessThanOrEqual(-1);
  });

  it("applies long liquidation cascade signal", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const result = runAnalysis({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      derivativesData: {
        provider: "coinglass",
        symbol: "BTC",
        timestamp: Date.now(),
        freshness: "delayed",
        liquidations: { totalVolume: 100000000, dominantSide: "longs", longVolume: 80000000, shortVolume: 20000000 },
        availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: true },
        confidence: "low",
      },
      technicalData: {
        swingHighs: [], swingLows: [], structure: "range",
        supportLevels: [], resistanceLevels: [],
        volumeTrend: "stable", dataPoints: 100,
      },
      marketData: {
        instrument: "BTC/USD", instrumentType: "crypto", provider: "twelve-data",
        fetchTimestamp: Date.now(),
        price: { price: 65000, timestamp: Date.now(), source: "twelve-data" },
        candles: [], timeframe: "H4",
        dataFreshness: "delayed",
      },
    });
    // Long liquidation cascade = potential capitulation (bullish)
    expect(result.breakdown.sentiment).toBeGreaterThanOrEqual(1);
  });

  it("does not apply derivatives scoring to forex", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const result = runAnalysis({
      instrument: "EUR/USD",
      instrumentType: "forex",
      timeframe: "H4",
      derivativesData: {
        provider: "coinglass",
        symbol: "EUR",
        timestamp: Date.now(),
        freshness: "delayed",
        fundingRate: { currentRate: 0.005 },
        availability: { openInterest: false, fundingRate: true, longShort: false, liquidations: false },
        confidence: "low",
      },
    });
    // Forex should not be affected by crypto derivatives
    expect(result.breakdown.sentiment).toBe(0);
  });

  it("includes derivatives data in result", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const derivs: CryptoDerivativesData = {
      provider: "coinglass",
      symbol: "BTC",
      timestamp: Date.now(),
      freshness: "delayed",
      availability: { openInterest: true, fundingRate: true, longShort: true, liquidations: true },
      confidence: "high",
      interpretation: "Test interpretation",
    };
    const result = runAnalysis({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      derivativesData: derivs,
    });
    expect(result.derivativesData).toBeDefined();
    expect(result.derivativesData?.confidence).toBe("high");
    expect(result.derivativesData?.interpretation).toBe("Test interpretation");
  });
});

// ── Edge Cases ─────────────────────────────────────────────────

describe("derivatives edge cases", () => {
  it("unavailable derivatives does not affect sentiment", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const result = runAnalysis({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      derivativesData: {
        provider: "coinglass",
        symbol: "BTC",
        timestamp: Date.now(),
        freshness: "unavailable",
        availability: { openInterest: false, fundingRate: false, longShort: false, liquidations: false },
        confidence: "unavailable",
      },
    });
    expect(result.breakdown.sentiment).toBe(0);
  });

  it("partial derivatives data (only funding) is used", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const result = runAnalysis({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      derivativesData: {
        provider: "coinglass",
        symbol: "BTC",
        timestamp: Date.now(),
        freshness: "delayed",
        fundingRate: { currentRate: -0.002 }, // Negative = crowded shorts
        availability: { openInterest: false, fundingRate: true, longShort: false, liquidations: false },
        confidence: "low",
      },
      technicalData: {
        swingHighs: [], swingLows: [], structure: "range",
        supportLevels: [], resistanceLevels: [],
        volumeTrend: "stable", dataPoints: 100,
      },
      marketData: {
        instrument: "BTC/USD", instrumentType: "crypto", provider: "twelve-data",
        fetchTimestamp: Date.now(),
        price: { price: 65000, timestamp: Date.now(), source: "twelve-data" },
        candles: [], timeframe: "H4",
        dataFreshness: "delayed",
      },
    });
    // Very negative funding = crowded shorts = contrarian bullish
    expect(result.breakdown.sentiment).toBeGreaterThanOrEqual(1);
  });

  it("long/short extreme ratio affects sentiment", async () => {
    const { runAnalysis } = await import("@/lib/analysis-engine");
    const result = runAnalysis({
      instrument: "ETH/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      derivativesData: {
        provider: "coinglass",
        symbol: "ETH",
        timestamp: Date.now(),
        freshness: "delayed",
        longShort: { accountRatio: 3.0 }, // Extremely long-heavy
        availability: { openInterest: false, fundingRate: false, longShort: true, liquidations: false },
        confidence: "low",
      },
      technicalData: {
        swingHighs: [], swingLows: [], structure: "range",
        supportLevels: [], resistanceLevels: [],
        volumeTrend: "stable", dataPoints: 100,
      },
      marketData: {
        instrument: "ETH/USD", instrumentType: "crypto", provider: "twelve-data",
        fetchTimestamp: Date.now(),
        price: { price: 3500, timestamp: Date.now(), source: "twelve-data" },
        candles: [], timeframe: "H4",
        dataFreshness: "delayed",
      },
    });
    // Ratio > 2.0 = contrarian bearish
    expect(result.breakdown.sentiment).toBeLessThanOrEqual(-1);
  });
});
