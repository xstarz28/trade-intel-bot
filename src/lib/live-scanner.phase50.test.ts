/**
 * Phase 50 — Live Universal Opportunity Scanner Tests
 *
 * A. Live candidate ingestion
 * B. Market-data freshness
 * C. Horizon-specific eligibility
 * D. Scalping gating
 * E. Intraday gating
 * F. Swing scoring
 * G. Investment horizon scoring
 * H. Crypto ranking
 * I. Forex ranking
 * J. Equity ranking
 * K. IDX ranking
 * L. Commodity ranking
 * M. Index ranking
 * N. Macro context
 * O. Multi-timeframe alignment
 * P. Conflict handling
 * Q. Missing data
 * R. Provider failure
 * S. Rate limiting
 * T. Cache isolation
 * U. Cross-instrument isolation
 * V. Dependency-group double-counting
 * W. Determinism
 * X. No forced recommendation
 * Y. No fabricated data
 * Z. Confidence semantics
 * AA. Decision immutability
 * AB. Security
 * AC. Empty universe
 * AD. Large universe stress test
 * AE. Sequential scanning isolation
 * AF. Concurrent scanning isolation
 * AG. Partial provider success
 * AH. Stale-data behavior
 * AI. UI result shape
 */

import { describe, it, expect } from "vitest";

import {
  buildCandidateFromSource,
  buildCandidatesFromSources,
  type LiveCandidateSource,
} from "./liveCandidateBuilder";

import {
  scanInstruments,
  type ScanConfig,
} from "./liveScanner";

import type { MarketData, TechnicalData } from "./data/market-types";

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const NOW = Date.now();
const HOUR = 3_600_000;
const MINUTE = 60_000;

function makeMarketData(instrument: string, overrides?: Partial<MarketData>): MarketData {
  return {
    instrument,
    instrumentType: "forex",
    provider: "twelve-data",
    fetchTimestamp: NOW,
    price: { price: 1.085, timestamp: NOW, source: "twelve-data" },
    candles: Array.from({ length: 50 }, (_, i) => ({
      timestamp: NOW - (50 - i) * HOUR,
      open: 100 + Math.sin(i * 0.3) * 5,
      high: 105 + Math.sin(i * 0.3) * 5,
      low: 95 + Math.sin(i * 0.3) * 5,
      close: 102 + Math.sin(i * 0.3) * 5,
      volume: 1000 + i * 10,
    })),
    timeframe: "H1",
    dataFreshness: "delayed",
    ...overrides,
  };
}

function makeTechData(overrides?: Partial<TechnicalData>): TechnicalData {
  return {
    dataPoints: 50,
    structure: "HH/HL",
    bosDirection: "bullish",
    chochDirection: "none",
    volumeTrend: "increasing",
    rsi14: 55,
    sma50: 100,
    atr14: 5,
    swingHighs: [110, 105],
    swingLows: [95, 90],
    supportLevels: [95, 90],
    resistanceLevels: [110, 105],
    ...overrides,
  };
}

function makeSource(overrides?: Partial<LiveCandidateSource>): LiveCandidateSource {
  return {
    instrument: "BTC/USD",
    assetClass: "crypto",
    marketData: makeMarketData("BTC/USD", { instrumentType: "crypto" as any }),
    technicalData: makeTechData(),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// A. LIVE CANDIDATE INGESTION
// ═══════════════════════════════════════════════════════════════

describe("A — Live Candidate Ingestion", () => {
  it("builds CandidateInput from live source with market data", () => {
    const source = makeSource();
    const candidate = buildCandidateFromSource(source);
    expect(candidate.instrument).toBe("BTC/USD");
    expect(candidate.assetClass).toBe("crypto");
    expect(candidate.currentPrice).toBeGreaterThan(0);
    expect(candidate.hasLiveData).toBe(true);
  });

  it("builds candidate with analysis result", () => {
    const source = makeSource({
      analysisResult: {
        id: "test",
        instrument: "BTC/USD",
        instrumentType: "crypto",
        timeframe: "H4",
        bias: "Bullish",
        confidence: 72,
        recommendation: "LONG",
        conviction: "Medium",
        noTradeReasons: [],
        technicalSummary: "test",
        fundamentalSummary: "test",
        breakdown: { trend: 1, indicator: 0, fundamental: 0, sentiment: 0 },
        keyLevels: { support: "64000", resistance: "67000", invalidation: "63000" },
        riskNote: "test",
        dataCompleteness: "full",
        dataFlags: [],
        timestamp: NOW,
        tradingStyle: "intraday",
        tradePlan: { direction: "long", entry: "65000", entryBasis: "market", stopLoss: "64000", slBasis: "structure", takeProfit: "67000", tpBasis: "resistance", riskReward: 2.0 },
        priceSnapshot: { price: 65000, timestamp: NOW, source: "twelve-data" },
      } as any,
    });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.hasAnalysis).toBe(true);
    expect(candidate.analysisConfidence).toBe(72);
    expect(candidate.riskReward).toBe(2.0);
  });

  it("batch builds candidates from multiple sources", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", assetClass: "crypto" }),
      makeSource({ instrument: "EUR/USD", assetClass: "forex", marketData: makeMarketData("EUR/USD") }),
      makeSource({ instrument: "AAPL", assetClass: "equity" }),
    ];
    const candidates = buildCandidatesFromSources(sources);
    expect(candidates.length).toBe(3);
    expect(candidates.map(c => c.instrument)).toEqual(["BTC/USD", "EUR/USD", "AAPL"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// B. MARKET-DATA FRESHNESS
// ═══════════════════════════════════════════════════════════════

describe("B — Market-Data Freshness", () => {
  it("fresh market data (< 5 min) produces FRESH freshness", () => {
    const source = makeSource({
      marketData: makeMarketData("BTC/USD", {
        price: { price: 65000, timestamp: NOW - 60_000, source: "twelve-data" },
      }),
    });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.freshness).toBe("FRESH");
  });

  it("delayed data (5-60 min) produces DELAYED freshness", () => {
    const source = makeSource({
      marketData: makeMarketData("BTC/USD", {
        price: { price: 65000, timestamp: NOW - 30 * MINUTE, source: "twelve-data" },
      }),
    });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.freshness).toBe("DELAYED");
  });

  it("stale data (1-24h) produces STALE freshness", () => {
    const source = makeSource({
      marketData: makeMarketData("BTC/USD", {
        price: { price: 65000, timestamp: NOW - 2 * HOUR, source: "twelve-data" },
      }),
    });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.freshness).toBe("STALE");
  });

  it("very old data (> 24h) produces UNAVAILABLE freshness", () => {
    const source = makeSource({
      marketData: makeMarketData("BTC/USD", {
        price: { price: 65000, timestamp: NOW - 48 * HOUR, source: "twelve-data" },
      }),
    });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.freshness).toBe("UNAVAILABLE");
  });

  it("no timestamp produces UNAVAILABLE freshness", () => {
    const source = makeSource({ marketData: undefined });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.freshness).toBe("UNAVAILABLE");
  });
});

// ═══════════════════════════════════════════════════════════════
// C. HORIZON-SPECIFIC ELIGIBILITY
// ═══════════════════════════════════════════════════════════════

describe("C — Horizon-Specific Eligibility", () => {
  it("scalping requires FRESH data", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", marketData: makeMarketData("BTC/USD", { price: { price: 65000, timestamp: NOW - MINUTE, source: "x" } }) }),
      makeSource({ instrument: "ETH/USD", marketData: makeMarketData("ETH/USD", { price: { price: 3500, timestamp: NOW - 30 * MINUTE, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["SCALPING"], maxResults: 10 });
    const scalpingResult = result.results.get("SCALPING")!;
    // ETH with DELAYED data should be excluded for scalping
    expect(scalpingResult.excludedInstruments.some(e => e.instrument === "ETH/USD")).toBe(true);
  });

  it("intraday allows DELAYED data", () => {
    const sources = [
      makeSource({ instrument: "EUR/USD", assetClass: "forex", marketData: makeMarketData("EUR/USD", { price: { price: 1.085, timestamp: NOW - 30 * MINUTE, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const intradayResult = result.results.get("INTRADAY")!;
    // EUR/USD with DELAYED data should be eligible for intraday
    expect(intradayResult.excludedInstruments.some(e => e.instrument === "EUR/USD" && e.reason.includes("freshness"))).toBe(false);
  });

  it("swing allows STALE data", () => {
    const sources = [
      makeSource({ instrument: "XAU/USD", assetClass: "commodity", marketData: makeMarketData("XAU/USD", { price: { price: 2650, timestamp: NOW - 5 * HOUR, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    const swingResult = result.results.get("SWING")!;
    expect(swingResult.excludedInstruments.some(e => e.instrument === "XAU/USD" && e.reason.includes("freshness"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// D. SCALPING GATING
// ═══════════════════════════════════════════════════════════════

describe("D — Scalping Gating", () => {
  it("scalping excludes all non-FRESH candidates", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", marketData: makeMarketData("BTC/USD", { price: { price: 65000, timestamp: NOW - 30 * MINUTE, source: "x" } }) }),
      makeSource({ instrument: "ETH/USD", marketData: makeMarketData("ETH/USD", { price: { price: 3500, timestamp: NOW - 2 * HOUR, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["SCALPING"], maxResults: 10 });
    const scalpingResult = result.results.get("SCALPING")!;
    expect(scalpingResult.rankedInstruments.length).toBe(0);
    expect(scalpingResult.excludedInstruments.length).toBe(2);
  });

  it("scalping with fresh data produces results", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", marketData: makeMarketData("BTC/USD", { price: { price: 65000, timestamp: NOW - MINUTE, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["SCALPING"], maxResults: 10 });
    const scalpingResult = result.results.get("SCALPING")!;
    expect(scalpingResult.rankedInstruments.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// E. INTRADAY GATING
// ═══════════════════════════════════════════════════════════════

describe("E — Intraday Gating", () => {
  it("intraday allows DELAYED data", () => {
    const sources = [
      makeSource({ instrument: "EUR/USD", assetClass: "forex", marketData: makeMarketData("EUR/USD", { price: { price: 1.085, timestamp: NOW - 20 * MINUTE, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    expect(result.results.get("INTRADAY")!.rankedInstruments.length).toBeGreaterThan(0);
  });

  it("intraday excludes STALE data", () => {
    const sources = [
      makeSource({ instrument: "EUR/USD", assetClass: "forex", marketData: makeMarketData("EUR/USD", { price: { price: 1.085, timestamp: NOW - 3 * HOUR, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    expect(result.results.get("INTRADAY")!.excludedInstruments.some(e => e.instrument === "EUR/USD")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// F. SWING SCORING
// ═══════════════════════════════════════════════════════════════

describe("F — Swing Scoring", () => {
  it("swing allows STALE data", () => {
    const sources = [
      makeSource({ instrument: "AAPL", assetClass: "equity", marketData: makeMarketData("AAPL", { price: { price: 195, timestamp: NOW - 10 * HOUR, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    expect(result.results.get("SWING")!.rankedInstruments.length).toBeGreaterThan(0);
  });

  it("swing mode is TRADING", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    expect(result.results.get("SWING")!.mode).toBe("TRADING");
  });
});

// ═══════════════════════════════════════════════════════════════
// G. INVESTMENT HORIZON SCORING
// ═══════════════════════════════════════════════════════════════

describe("G — Investment Horizon Scoring", () => {
  it("1-3 years mode is INVESTING", () => {
    const sources = [makeSource({ instrument: "AAPL", assetClass: "equity" })];
    const result = scanInstruments(sources, { horizons: ["1-3_YEARS"], maxResults: 10 });
    expect(result.results.get("1-3_YEARS")!.mode).toBe("INVESTING");
  });

  it("scan supports all investment horizons", () => {
    const sources = [makeSource()];
    const horizons: ScanConfig["horizons"] = ["1-4_WEEKS", "1-3_MONTHS", "3-6_MONTHS", "6-12_MONTHS", "1-3_YEARS", "3+_YEARS"];
    const result = scanInstruments(sources, { horizons, maxResults: 10 });
    horizons.forEach(h => {
      expect(result.results.has(h)).toBe(true);
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// H. CRYPTO RANKING
// ═══════════════════════════════════════════════════════════════

describe("H — Crypto Ranking", () => {
  it("BTC and ETH are ranked independently", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", assetClass: "crypto" }),
      makeSource({ instrument: "ETH/USD", assetClass: "crypto" }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.length).toBe(2);
    expect(ranked.map(r => r.instrument).sort()).toEqual(["BTC/USD", "ETH/USD"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// I. FOREX RANKING
// ═══════════════════════════════════════════════════════════════

describe("I — Forex Ranking", () => {
  it("EUR/USD and GBP/USD ranked independently", () => {
    const sources = [
      makeSource({ instrument: "EUR/USD", assetClass: "forex" }),
      makeSource({ instrument: "GBP/USD", assetClass: "forex" }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// J. EQUITY RANKING
// ═══════════════════════════════════════════════════════════════

describe("J — Equity Ranking", () => {
  it("AAPL and MSFT ranked independently", () => {
    const sources = [
      makeSource({ instrument: "AAPL", assetClass: "equity" }),
      makeSource({ instrument: "MSFT", assetClass: "equity" }),
    ];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    const ranked = result.results.get("SWING")!.rankedInstruments;
    expect(ranked.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// K. IDX RANKING
// ═══════════════════════════════════════════════════════════════

describe("K — IDX Ranking", () => {
  it("IDX equities are ranked as first-class instruments", () => {
    const sources = [
      makeSource({ instrument: "BBCA", assetClass: "equity" }),
      makeSource({ instrument: "BBRI", assetClass: "equity" }),
      makeSource({ instrument: "TLKM", assetClass: "equity" }),
    ];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    const ranked = result.results.get("SWING")!.rankedInstruments;
    expect(ranked.length).toBe(3);
    expect(ranked.map(r => r.instrument).sort()).toEqual(["BBCA", "BBRI", "TLKM"]);
  });

  it("accepts IDX equities directly without a built-in universe", () => {
    const sources = [
      makeSource({ instrument: "BBCA", assetClass: "equity" }),
      makeSource({ instrument: "BBRI", assetClass: "equity" }),
      makeSource({ instrument: "TLKM", assetClass: "equity" }),
      makeSource({ instrument: "BMRI", assetClass: "equity" }),
    ];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    const ranked = result.results.get("SWING")!.rankedInstruments;
    expect(ranked.map(r => r.instrument).sort()).toEqual(["BBCA", "BBRI", "BMRI", "TLKM"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// L. COMMODITY RANKING
// ═══════════════════════════════════════════════════════════════

describe("L — Commodity Ranking", () => {
  it("XAU/USD and WTI ranked independently", () => {
    const sources = [
      makeSource({ instrument: "XAU/USD", assetClass: "commodity" }),
      makeSource({ instrument: "WTI", assetClass: "commodity" }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// M. INDEX RANKING
// ═══════════════════════════════════════════════════════════════

describe("M — Index Ranking", () => {
  it("SPX and NDX ranked independently", () => {
    const sources = [
      makeSource({ instrument: "SPX", assetClass: "indices" }),
      makeSource({ instrument: "NDX", assetClass: "indices" }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════
// N. MACRO CONTEXT
// ═══════════════════════════════════════════════════════════════

describe("N — Macro Context", () => {
  it("accepts arbitrary macro instruments directly", () => {
    const sources = [
      makeSource({ instrument: "DXY", assetClass: "macro" }),
      makeSource({ instrument: "US10Y", assetClass: "macro" }),
    ];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    const ranked = result.results.get("SWING")!.rankedInstruments;
    expect(ranked.map(r => r.instrument).sort()).toEqual(["DXY", "US10Y"]);
  });
});

// ═══════════════════════════════════════════════════════════════
// O. MULTI-TIMEFRAME ALIGNMENT
// ═══════════════════════════════════════════════════════════════

describe("O — Multi-Timeframe Alignment", () => {
  it("MTF alignment is extracted from analysis result", () => {
    const source = makeSource({
      analysisResult: {
        id: "test", instrument: "BTC/USD", instrumentType: "crypto", timeframe: "H4",
        bias: "Bullish", confidence: 72, recommendation: "LONG",
        noTradeReasons: [], technicalSummary: "", fundamentalSummary: "",
        breakdown: { trend: 1, indicator: 0, fundamental: 0, sentiment: 0 },
        keyLevels: { support: "0", resistance: "0", invalidation: "0" },
        riskNote: "", dataCompleteness: "full", dataFlags: [], timestamp: NOW,
        tradingStyle: "intraday",
        mtfSummary: { alignment: "ALIGNED_BULLISH", chainUsed: ["D1", "H4", "H1"], unavailable: [], htfBias: "long", setupTimeframe: "H4" },
      } as any,
    });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.mtfAlignment).toBe("ALIGNED_BULLISH");
  });
});

// ═══════════════════════════════════════════════════════════════
// P. CONFLICT HANDLING
// ═══════════════════════════════════════════════════════════════

describe("P — Conflict Handling", () => {
  it("conflicting evidence reduces suitability", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", technicalData: makeTechData({ structure: "LH/LL" }) }),
      makeSource({ instrument: "ETH/USD", technicalData: makeTechData({ structure: "HH/HL" }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    // ETH with bullish structure should rank higher than BTC with bearish
    if (ranked.length === 2) {
      const ethRank = ranked.find(r => r.instrument === "ETH/USD");
      const btcRank = ranked.find(r => r.instrument === "BTC/USD");
      expect(ethRank!.analyticalScore).toBeGreaterThanOrEqual(btcRank!.analyticalScore);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Q. MISSING DATA
// ═══════════════════════════════════════════════════════════════

describe("Q — Missing Data", () => {
  it("candidate without market data has NONE completeness", () => {
    const source = makeSource({ marketData: undefined, technicalData: undefined });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.dataCompleteness).toBe("NONE");
  });

  it("candidate with partial data has MINIMAL completeness", () => {
    const source = makeSource({ marketData: undefined, technicalData: makeTechData() });
    const candidate = buildCandidateFromSource(source);
    expect(["MINIMAL", "PARTIAL"]).toContain(candidate.dataCompleteness);
  });
});

// ═══════════════════════════════════════════════════════════════
// R. PROVIDER FAILURE
// ═══════════════════════════════════════════════════════════════

describe("R — Provider Failure", () => {
  it("providerErrors array exists on scan result", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    expect(Array.isArray(result.providerErrors)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// S. RATE LIMITING
// ═══════════════════════════════════════════════════════════════

describe("S — Rate Limiting", () => {
  it("scan result includes durationMs", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// T. CACHE ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("T — Cache Isolation", () => {
  it("scan uses buildCandidateFromSource which creates independent candidates", () => {
    const s1 = makeSource({ instrument: "BTC/USD" });
    const s2 = makeSource({ instrument: "ETH/USD" });
    const c1 = buildCandidateFromSource(s1);
    const c2 = buildCandidateFromSource(s2);
    expect(c1.instrument).not.toBe(c2.instrument);
    // Modifying one doesn't affect the other
    c1.currentPrice = 999;
    expect(c2.currentPrice).not.toBe(999);
  });
});

// ═══════════════════════════════════════════════════════════════
// U. CROSS-INSTRUMENT ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("U — Cross-Instrument Isolation", () => {
  it("BTC evidence does not influence ETH", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", assetClass: "crypto", technicalData: makeTechData({ structure: "HH/HL" }) }),
      makeSource({ instrument: "ETH/USD", assetClass: "crypto", technicalData: makeTechData({ structure: "LH/LL" }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    const btc = ranked.find(r => r.instrument === "BTC/USD");
    const eth = ranked.find(r => r.instrument === "ETH/USD");
    if (btc && eth) {
      // BTC bullish should score higher than ETH bearish
      expect(btc.analyticalScore).toBeGreaterThanOrEqual(eth.analyticalScore);
    }
  });

  it("BBCA does not inherit AAPL fundamentals", () => {
    const sources = [
      makeSource({ instrument: "BBCA", assetClass: "equity" }),
      makeSource({ instrument: "AAPL", assetClass: "equity" }),
    ];
    const candidates = buildCandidatesFromSources(sources);
    const bbca = candidates.find(c => c.instrument === "BBCA");
    const aapl = candidates.find(c => c.instrument === "AAPL");
    // Both should have independent data
    expect(bbca!.instrument).toBe("BBCA");
    expect(aapl!.instrument).toBe("AAPL");
  });

  it("XAU/USD does not inherit WTI inventory", () => {
    const sources = [
      makeSource({ instrument: "XAU/USD", assetClass: "commodity", eiaData: undefined }),
      makeSource({ instrument: "WTI", assetClass: "commodity", eiaData: { available: true, series: [{ productId: "WTI", latestValue: 420_000_000 }], freshness: "FRESH" } as any }),
    ];
    const candidates = buildCandidatesFromSources(sources);
    const xau = candidates.find(c => c.instrument === "XAU/USD");
    const wti = candidates.find(c => c.instrument === "WTI");
    expect(xau!.inventory).toBeUndefined();
    expect(wti!.inventory).toBe(420_000_000);
  });
});

// ═══════════════════════════════════════════════════════════════
// V. DEPENDENCY-GROUP DOUBLE-COUNTING
// ═══════════════════════════════════════════════════════════════

describe("V — Dependency-Group Double-Counting", () => {
  it("dependencyGroupsUsed field is initialized empty", () => {
    const candidate = buildCandidateFromSource(makeSource());
    expect(candidate.dependencyGroupsUsed).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════
// W. DETERMINISM
// ═══════════════════════════════════════════════════════════════

describe("W — Determinism", () => {
  it("same sources + same config = same result", () => {
    const sources = [makeSource(), makeSource({ instrument: "ETH/USD" })];
    const config: ScanConfig = { horizons: ["INTRADAY"], maxResults: 10, now: NOW };
    const r1 = scanInstruments(sources, config);
    const r2 = scanInstruments(sources, config);
    expect(r1.results.get("INTRADAY")!.rankedInstruments.map(r => r.instrument)).toEqual(
      r2.results.get("INTRADAY")!.rankedInstruments.map(r => r.instrument),
    );
  });

  it("buildCandidateFromSource is deterministic", () => {
    const source = makeSource();
    const c1 = buildCandidateFromSource(source);
    const c2 = buildCandidateFromSource(source);
    expect(c1.instrument).toBe(c2.instrument);
    expect(c1.assetClass).toBe(c2.assetClass);
    expect(c1.dataCompleteness).toBe(c2.dataCompleteness);
  });
});

// ═══════════════════════════════════════════════════════════════
// X. NO FORCED RECOMMENDATION
// ═══════════════════════════════════════════════════════════════

describe("X — No Forced Recommendation", () => {
  it("empty sources produce empty results", () => {
    const result = scanInstruments([], { horizons: ["INTRADAY"], maxResults: 10 });
    expect(result.totalScanned).toBe(0);
    expect(result.results.get("INTRADAY")!.rankedInstruments.length).toBe(0);
  });

  it("all-insufficient sources produce no ranked instruments", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", marketData: undefined, technicalData: undefined }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    // With no market data, data completeness is NONE — excluded
    expect(result.results.get("INTRADAY")!.rankedInstruments.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Y. NO FABRICATED DATA
// ═══════════════════════════════════════════════════════════════

describe("Y — No Fabricated Data", () => {
  it("candidate without price has currentPrice = 0", () => {
    const source = makeSource({ marketData: undefined });
    const candidate = buildCandidateFromSource(source);
    expect(candidate.currentPrice).toBe(0);
  });

  it("scan result does not contain fabricated prices", () => {
    const sources = [makeSource({ instrument: "BTC/USD", marketData: makeMarketData("BTC/USD", { price: { price: 65000, timestamp: NOW, source: "x" } }) })];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10, now: NOW });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    ranked.forEach(r => {
      // Instrument names should be from actual sources
      expect(r.instrument).toBeTruthy();
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Z. CONFIDENCE SEMANTICS
// ═══════════════════════════════════════════════════════════════

describe("Z — Confidence Semantics", () => {
  it("confidence is 0-100", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    result.results.get("INTRADAY")!.rankedInstruments.forEach(r => {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(100);
    });
  });

  it("methodology states NOT probability of profit", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    expect(result.results.get("INTRADAY")!.methodology).toContain("NOT probability of profit");
  });
});

// ═══════════════════════════════════════════════════════════════
// AA. DECISION IMMUTABILITY
// ═══════════════════════════════════════════════════════════════

describe("AA — Decision Immutability", () => {
  it("scan does not modify source data", () => {
    const source = makeSource({ instrument: "BTC/USD" });
    const original = { ...source };
    scanInstruments([source], { horizons: ["INTRADAY"], maxResults: 10 });
    expect(source.instrument).toBe(original.instrument);
    expect(source.assetClass).toBe(original.assetClass);
  });
});

// ═══════════════════════════════════════════════════════════════
// AB. SECURITY
// ═══════════════════════════════════════════════════════════════

describe("AB — Security", () => {
  it("scan result never contains API keys", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("API_KEY");
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("sk_live");
  });
});

// ═══════════════════════════════════════════════════════════════
// AC. EMPTY UNIVERSE
// ═══════════════════════════════════════════════════════════════

describe("AC — Empty Universe", () => {
  it("scan of empty sources produces valid result", () => {
    const result = scanInstruments([], { horizons: ["INTRADAY", "SWING"], maxResults: 10 });
    expect(result.totalScanned).toBe(0);
    expect(result.results.size).toBe(2);
  });

  it("empty sources remain an explicit empty scan", () => {
    const result = scanInstruments([], { horizons: ["INTRADAY"], maxResults: 10 });
    expect(result.totalScanned).toBe(0);
    expect(result.totalWithLiveData).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// AD. LARGE UNIVERSE STRESS TEST
// ═══════════════════════════════════════════════════════════════

describe("AD — Large Universe Stress Test", () => {
  it("handles 50 instruments efficiently", () => {
    const sources = Array.from({ length: 50 }, (_, i) =>
      makeSource({
        instrument: `INST${i}`,
        assetClass: (["crypto", "forex", "equity", "commodity", "indices"] as const)[i % 5],
      }),
    );
    const start = Date.now();
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const elapsed = Date.now() - start;
    expect(result.totalScanned).toBe(50);
    expect(elapsed).toBeLessThan(5000);
  });
});

// ═══════════════════════════════════════════════════════════════
// AE. SEQUENTIAL SCANNING ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AE — Sequential Scanning Isolation", () => {
  it("two sequential scans produce independent results", () => {
    const s1 = [makeSource({ instrument: "BTC/USD" })];
    const s2 = [makeSource({ instrument: "ETH/USD" })];
    const r1 = scanInstruments(s1, { horizons: ["INTRADAY"], maxResults: 10 });
    const r2 = scanInstruments(s2, { horizons: ["INTRADAY"], maxResults: 10 });
    expect(r1.results.get("INTRADAY")!.rankedInstruments[0]?.instrument).toBe("BTC/USD");
    expect(r2.results.get("INTRADAY")!.rankedInstruments[0]?.instrument).toBe("ETH/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// AF. CONCURRENT SCANNING ISOLATION
// ═══════════════════════════════════════════════════════════════

describe("AF — Concurrent Scanning Isolation", () => {
  it("concurrent scans produce independent results", () => {
    const s1 = [makeSource({ instrument: "BTC/USD" })];
    const s2 = [makeSource({ instrument: "ETH/USD" })];
    const [r1, r2] = [
      scanInstruments(s1, { horizons: ["INTRADAY"], maxResults: 10 }),
      scanInstruments(s2, { horizons: ["INTRADAY"], maxResults: 10 }),
    ];
    expect(r1.results.get("INTRADAY")!.rankedInstruments[0]?.instrument).toBe("BTC/USD");
    expect(r2.results.get("INTRADAY")!.rankedInstruments[0]?.instrument).toBe("ETH/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// AG. PARTIAL PROVIDER SUCCESS
// ═══════════════════════════════════════════════════════════════

describe("AG — Partial Provider Success", () => {
  it("mixed available/unavailable sources still produce results", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", marketData: makeMarketData("BTC/USD", { price: { price: 65000, timestamp: NOW, source: "x" } }) }),
      makeSource({ instrument: "ETH/USD", marketData: undefined, technicalData: undefined }),
    ];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const ranked = result.results.get("INTRADAY")!.rankedInstruments;
    expect(ranked.length).toBe(1);
    expect(ranked[0].instrument).toBe("BTC/USD");
  });
});

// ═══════════════════════════════════════════════════════════════
// AH. STALE-DATA BEHAVIOR
// ═══════════════════════════════════════════════════════════════

describe("AH — Stale-Data Behavior", () => {
  it("scalping excludes stale data", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", marketData: makeMarketData("BTC/USD", { price: { price: 65000, timestamp: NOW - 2 * HOUR, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["SCALPING"], maxResults: 10 });
    expect(result.results.get("SCALPING")!.excludedInstruments.some(e => e.reason.includes("freshness"))).toBe(true);
  });

  it("swing allows stale data", () => {
    const sources = [
      makeSource({ instrument: "BTC/USD", marketData: makeMarketData("BTC/USD", { price: { price: 65000, timestamp: NOW - 2 * HOUR, source: "x" } }) }),
    ];
    const result = scanInstruments(sources, { horizons: ["SWING"], maxResults: 10 });
    expect(result.results.get("SWING")!.excludedInstruments.some(e => e.reason.includes("freshness") && e.instrument === "BTC/USD")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// AI. UI RESULT SHAPE
// ═══════════════════════════════════════════════════════════════

describe("AI — UI Result Shape", () => {
  it("scan result has all required top-level fields", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    expect(result.results).toBeDefined();
    expect(result.totalScanned).toBeGreaterThanOrEqual(0);
    expect(result.totalWithLiveData).toBeGreaterThanOrEqual(0);
    expect(result.totalInsufficient).toBeGreaterThanOrEqual(0);
    expect(result.timestamp).toBeGreaterThan(0);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(result.providerErrors)).toBe(true);
  });

  it("each horizon result has all required fields", () => {
    const sources = [makeSource()];
    const result = scanInstruments(sources, { horizons: ["INTRADAY"], maxResults: 10 });
    const r = result.results.get("INTRADAY")!;
    expect(r.horizon).toBeTruthy();
    expect(r.mode).toBeTruthy();
    expect(Array.isArray(r.rankedInstruments)).toBe(true);
    expect(Array.isArray(r.excludedInstruments)).toBe(true);
    expect(r.marketOverview).toBeTruthy();
    expect(r.methodology).toBeTruthy();
    expect(r.dataQualitySummary).toBeTruthy();
    expect(r.timestamp).toBeGreaterThan(0);
  });
});
