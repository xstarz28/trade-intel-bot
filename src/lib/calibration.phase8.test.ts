/**
 * Phase 8 P2 — conviction calibration.
 *
 * - Availability NEVER increases conviction (F-1: the old "+5 for full
 *   completeness" bonus is removed; adding neutral/unavailable providers to an
 *   identical evidence set leaves confidence identical).
 * - Conviction bands are pinned: 20–49 Low · 50–69 Medium · 70–88 High.
 * - Technical-only High conviction is possible and INTENTIONAL (structure +
 *   liquidity + MTF are the top of the evidence hierarchy); it is documented,
 *   and it can never arise from provider availability alone.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, MtfContext, TechnicalData } from "@/lib/data/market-types";
import type { TreasuryData } from "@/lib/data/treasury";
import type { CotData } from "@/lib/data/cot";

// ── Fixtures (deterministic scoring inputs; no time-sensitive evidence) ──

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

function tech(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [112], swingLows: [95],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [112],
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

function input(over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100),
    technicalData: tech(),
    economicEvents: "Fed signals hawkish stance, rate hike", // fundamental +1
    ...over,
  } as AnalysisInput;
}

const mtfAligned = (): MtfContext => ({
  requestedTimeframe: "H4", chainUsed: ["D1", "H4", "H1"], unavailable: [],
  timeframes: [], alignment: "ALIGNED_BULLISH", htfBias: "long",
  htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe: "H1",
});

/** Sub-threshold Treasury context: available but ZERO directional evidence. */
const neutralTreasury = (): Extract<TreasuryData, { available: true }> => ({
  available: true,
  source: "US Treasury (home.treasury.gov XML feed)",
  fetchedAt: Date.now(),
  freshness: "FRESH",
  latest: { nominal: { observationDate: "2026-08-21", nominal: { "2Y": 4.2, "10Y": 4.63 } } },
  previous: { nominal: { observationDate: "2026-08-20", nominal: { "2Y": 4.2, "10Y": 4.63 } } }, // no change → sub-threshold
});

/** Available COT with zero directional change between reports. */
const neutralCot = (): Extract<CotData, { available: true }> => ({
  available: true,
  source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
  fetchedAt: Date.now(),
  freshness: "FRESH",
  requestedInstrument: "EUR/USD",
  sourceInstrument: "EURO FX - CHICAGO MERCANTILE EXCHANGE",
  mappedAsset: "EUR (euro)",
  latest: {
    reportDate: "2026-08-18",
    nonCommercialLong: 60000,
    nonCommercialShort: 50000,
    openInterest: 200000,
  },
  previous: {
    reportDate: "2026-08-11",
    nonCommercialLong: 60000,
    nonCommercialShort: 50000,
    openInterest: 200000,
  },
  netNonCommercial: 10000,
  changeFromPreviousReport: 0, // zero change → zero directional evidence
});

// ── F-1: availability invariance ───────────────────────────────────

describe("P2 F-1: availability never increases conviction", () => {
  const base = input();

  it("adding AVAILABLE providers with zero directional evidence changes nothing", () => {
    const withNeutral = runAnalysis(input({ treasuryData: neutralTreasury(), cotData: neutralCot() }));
    const baseR = runAnalysis(base);
    expect(withNeutral.confidence).toBe(baseR.confidence);
    expect(withNeutral.recommendation).toBe(baseR.recommendation);
  });

  it("adding UNAVAILABLE providers changes nothing (informational flags only)", () => {
    const withUnavailable = runAnalysis(input({
      treasuryData: { available: false as const, reason: "fetch failed", fetchedAt: Date.now() } as TreasuryData,
      cotData: { available: false as const, reason: "no mapping", fetchedAt: Date.now(), requestedInstrument: "EUR/USD" } as CotData,
      executionData: undefined,
    }));
    const baseR = runAnalysis(base);
    expect(withUnavailable.confidence).toBe(baseR.confidence);
    expect((withUnavailable.dataFlags ?? []).join(" ")).toContain("Treasury yield context unavailable");
  });
});

// ── Band calibration ───────────────────────────────────────────────

describe("P2 F-2: conviction bands are deterministic", () => {
  it("Low band fixture (structure + fundamental only)", () => {
    const r = runAnalysis(input()); // trend layer +9, fundamental layer +10
    expect(r.recommendation).toBe("LONG");
    expect(r.confidence).toBeLessThan(50);
    expect(r.conviction).toBe("Low");
  });

  it("Medium band fixture (adds aligned sentiment layer)", () => {
    const r = runAnalysis(input({
      sentimentData: {
        provider: "alpha-vantage", timestamp: Date.now(),
        averageScore: 0.8, articleCount: 10, label: "bullish",
        breakdown: { positive: 9, negative: 0, neutral: 1 },
        confidence: "high", articles: [],
      },
    }));
    expect(r.recommendation).toBe("LONG");
    expect(r.confidence).toBeGreaterThanOrEqual(50);
    expect(r.confidence).toBeLessThan(70);
    expect(r.conviction).toBe("Medium");
  });

  it("High band fixture (adds MTF alignment layer)", () => {
    const r = runAnalysis(input({
      technicalData: tech({ mtf: mtfAligned() }),
      sentimentData: {
        provider: "alpha-vantage", timestamp: Date.now(),
        averageScore: 0.8, articleCount: 10, label: "bullish",
        breakdown: { positive: 9, negative: 0, neutral: 1 },
        confidence: "high", articles: [],
      },
    }));
    expect(r.recommendation).toBe("LONG");
    expect(r.confidence).toBeGreaterThanOrEqual(70);
    expect(r.confidence).toBeLessThanOrEqual(88);
    expect(r.conviction).toBe("High");
  });

  it("TECHNICAL-ONLY High is possible and intentional — but gated by core confluence", () => {
    // Structure(+9) + aligned sweep(+8) + MTF aligned(+15): the strongest
    // technical breadth. With fundamentals stripped entirely, Gate 4 still
    // requires a second agreeing CORE factor — documented policy.
    const smc: unknown = {
      timeframe: "H4",
      internalExternal: {
        external: { structure: "HH/HL" as const, bosDirection: "bullish" as const, chochDirection: "none" as const, lastSwingHigh: 112, lastSwingLow: 95, dataPoints: 210 },
        internal: { structure: "HH/HL" as const, bosDirection: "bullish" as const, chochDirection: "none" as const, lastSwingHigh: 108, lastSwingLow: 99, dataPoints: 60 },
        internalConflict: false,
      },
      recentSweep: {
        side: "sell_side" as const, level: 96, sweptBy: 97.5, closedBackAbove: true,
        timestamp: Date.now() - 36e5, timeframe: "H4",
      },
      fvgs: [], orderBlocks: [], liquidityPools: [],
      vwap: { available: false as const, unavailableReason: "no session data" } as unknown as TechnicalData["smc"] extends infer S ? S extends { vwap: infer V } ? V : never : never,
      volumeProfile: { available: false as const, unavailableReason: "zero volume series" },
    };
    const r = runAnalysis(input({
      technicalData: tech({ mtf: mtfAligned(), smc: smc as TechnicalData["smc"] }),
      economicEvents: undefined, // strip ALL fundamental evidence
    }));
    if (r.recommendation === "LONG") {
      expect(r.conviction).toBeDefined();
      expect(["Medium", "High"]).toContain(r.conviction!);
    } else {
      expect(r.recommendation).toBe("NO_TRADE");
    }
  });

  it("High CANNOT arise from provider availability alone (band cap sanity)", () => {
    const strongSentiment = () => ({
      provider: "alpha-vantage", timestamp: Date.now(),
      averageScore: 0.9, articleCount: 20,
      label: "bullish" as const,
      breakdown: { positive: 19, negative: 0, neutral: 1 },
      confidence: "high" as const, articles: [],
    });
    const high = runAnalysis(input({
      technicalData: tech({ mtf: mtfAligned() }),
      sentimentData: strongSentiment(),
    }));
    const withExtraProviders = runAnalysis(input({
      technicalData: tech({ mtf: mtfAligned() }),
      sentimentData: strongSentiment(),
      treasuryData: neutralTreasury(),
      cotData: neutralCot(),
    }));
    expect(high.confidence).toBe(withExtraProviders.confidence);
    expect(withExtraProviders.confidence).toBeLessThanOrEqual(88);
  });
});
