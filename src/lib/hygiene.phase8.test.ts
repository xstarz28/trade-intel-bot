/**
 * Phase 8 P6 — hygiene semantics.
 *
 * - Regime detection must NEVER become additional conviction evidence:
 *   toggling a regime-only input (value-area containment) while every
 *   conviction-layer input stays byte-identical must leave confidence
 *   unchanged.
 * - The RSI/MACD modifier constant is the real implementation value; the
 *   engine's modifier behavior is pinned at exactly ±3.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, SmcContext, TechnicalData, VolumeProfileContext, VwapContext } from "@/lib/data/market-types";

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

const vwapOff: VwapContext = { available: false as const, unavailableReason: "no session data" } as VwapContext;
const vpOff: VolumeProfileContext = { available: false as const, unavailableReason: "zero-volume series" };
/** Real-looking profile containing the last close → regime "ranging" vote. */
const vpOn: VolumeProfileContext = {
  available: true,
  poc: 100, vah: 104, val: 96,
  totalVolume: 210000,
} as unknown as VolumeProfileContext;

function smcWith(vp: VolumeProfileContext): SmcContext {
  return {
    timeframe: "H4",
    liquidityPools: [],
    internalExternal: {
      external: { structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 112, lastSwingLow: 95, dataPoints: 210 },
      internal: { structure: "HH/HL", bosDirection: "none", chochDirection: "none", lastSwingHigh: 108, lastSwingLow: 99, dataPoints: 60 },
      internalConflict: false,
    },
    fvgs: [], orderBlocks: [],
    vwap: vwapOff,
    volumeProfile: vp,
  } as unknown as SmcContext;
}

function input(vp: VolumeProfileContext): AnalysisInput {
  return {
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100), // close inside [val..vah] when profile is ON
    technicalData: { swingHighs: [112], swingLows: [95], structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", supportLevels: [95], resistanceLevels: [112], volumeTrend: "unknown", dataPoints: 210, smc: smcWith(vp) } as TechnicalData,
    economicEvents: "Fed signals hawkish stance, rate hike",
    sentimentData: {
      provider: "alpha-vantage", timestamp: Date.now(),
      averageScore: 0.8, articleCount: 10, label: "bullish",
      breakdown: { positive: 9, negative: 0, neutral: 1 },
      confidence: "high", articles: [],
    },
  } as AnalysisInput;
}

describe("P6: regime is contextual only — never conviction evidence", () => {
  it("regime vote change alone leaves conviction/confidence identical", () => {
    const withoutProfile = runAnalysis(input(vpOff));
    const withProfile = runAnalysis(input(vpOn));
    // The volume profile toggles a REGIME vote (value-area containment) but is
    // not part of any conviction layer.
    expect(withProfile.confidence).toBe(withoutProfile.confidence);
    expect(withProfile.recommendation).toBe(withoutProfile.recommendation);
    expect(withProfile.conviction).toBe(withoutProfile.conviction);
  });

  it("RSI/MACD modifier remains pinned at the documented ±3 policy value", () => {
    const neutral = runAnalysis(input(vpOff));
    const withBullRsi = runAnalysis({
      ...input(vpOff),
      technicalData: {
        ...input(vpOff).technicalData!,
        rsi14: 55, macdHistogram: 10,
      } as TechnicalData,
    });
    // indicator +1 aligned → exactly +3 conviction points
    expect(neutral.breakdown.indicator).toBe(0);
    expect(withBullRsi.breakdown.indicator).toBe(1);
    expect(withBullRsi.confidence).toBe(neutral.confidence + 3);
  });
});
