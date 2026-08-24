/**
 * Phase 8 P3 — cross-layer anti-double-counting.
 *
 * When the MTF trigger timeframe IS the primary/setup timeframe, its SMC
 * events (displacement / fresh FVG) are the SAME candle cluster that the
 * Location layer already scores. The same observation must never earn two
 * independent layer votes. Genuinely separate observations still count.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type {
  MarketData,
  MtfContext,
  SmcContext,
  TechnicalData,
} from "@/lib/data/market-types";

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

/** Primary-TF SMC with an ALIGNED bullish displacement (Location layer +4). */
const primarySmc = (): SmcContext =>
  ({
    timeframe: "H4",
    liquidityPools: [],
    internalExternal: {
      external: { structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 112, lastSwingLow: 95, dataPoints: 210 },
      internal: { structure: "HH/HL", bosDirection: "none", chochDirection: "none", lastSwingHigh: 108, lastSwingLow: 99, dataPoints: 60 },
      internalConflict: false,
    },
    fvgs: [],
    displacement: { direction: "bullish" as const, magnitudeAtr: 1.8, startIndex: 200, endIndex: 202, timeframe: "H4" },
    orderBlocks: [],
    vwap: { available: false as const, unavailableReason: "no session data" },
    volumeProfile: { available: false as const, unavailableReason: "zero-volume series" },
  }) as unknown as SmcContext;

function tech(over?: Partial<TechnicalData>): TechnicalData {
  return {
    swingHighs: [112], swingLows: [95],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [112],
    volumeTrend: "unknown", dataPoints: 210,
    ...over,
  };
}

function input(mtf: MtfContext, over?: Partial<AnalysisInput>): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100),
    technicalData: tech({
      smc: primarySmc(),
      mtf,
    }),
    economicEvents: "Fed signals hawkish stance, rate hike",
    ...over,
  } as AnalysisInput;
}

function mtfWithTrigger(triggerTimeframe: string): MtfContext {
  // The SAME SMC context object is attached to the trigger slot — modeling
  // exactly the degenerate case where the trigger slot carries the primary
  // timeframe's candle cluster.
  return {
    requestedTimeframe: "H4", chainUsed: ["D1", "H4"], unavailable: [],
    timeframes: [
      { timeframe: triggerTimeframe, role: "trigger", available: true, smc: primarySmc() },
    ],
    alignment: "ALIGNED_BULLISH", htfBias: "long",
    htfTimeframe: "D1", setupTimeframe: "H4", triggerTimeframe,
  };
}

describe("P3: same-cluster evidence cannot be counted twice across layers", () => {
  it("trigger timeframe ≠ primary → trigger evidence earns its MTF-layer vote", () => {
    const distinct = runAnalysis(input(mtfWithTrigger("H1"))).confidence!;
    expect(distinct).toBeGreaterThan(0);
  });

  it("trigger timeframe == primary → duplicate vote removed (delta = effective duplicated bonus after layer cap)", () => {
    const distinct = runAnalysis(input(mtfWithTrigger("H1"))).confidence!;
    const same = runAnalysis(input(mtfWithTrigger("H4"))).confidence!;
    // The only difference is whether the trigger sub-score double-counts the
    // primary cluster. NOTE: aligned(+15) + trigger(+4) hits the ±18 MTF layer
    // cap, so the EFFECTIVE duplicated bonus is +3 — the delta must equal it.
    expect(same).toBe(distinct - 3);
  });

  it("genuinely separate observations remain independently countable", () => {
    const distinctMtf = mtfWithTrigger("H1");
    const r = runAnalysis(input(distinctMtf));
    const sameMtf = mtfWithTrigger("H4");
    const rSame = runAnalysis(input(sameMtf));
    // Independent trigger TF keeps its full layered contribution;
    // dedup applies ONLY to identical clusters.
    expect(r.confidence!).toBeGreaterThan(rSame.confidence!);
  });
});
