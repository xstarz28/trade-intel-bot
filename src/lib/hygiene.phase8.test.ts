/**
 * Market-profile integration regression.
 *
 * VPVR value-area levels may change the candidate target and reject a setup
 * whose nearest opposing level cannot meet minimum R:R. They must not alter
 * the core directional factor breakdown or manufacture directional bias.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, SmcContext, TechnicalData } from "@/lib/data/market-types";

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

function tech(vp: SmcContext["volumeProfile"]): TechnicalData {
  return {
    swingHighs: [112], swingLows: [95],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [112],
    volumeTrend: "unknown", dataPoints: 210,
    smc: {
      timeframe: "H4",
      liquidityPools: [],
      internalExternal: {
        external: { structure: "HH/HL", bosDirection: "bullish", chochDirection: "none", lastSwingHigh: 112, lastSwingLow: 95, dataPoints: 210 },
        internal: { structure: "HH/HL", bosDirection: "none", chochDirection: "none", lastSwingHigh: 108, lastSwingLow: 99, dataPoints: 60 },
        internalConflict: false,
      },
      fvgs: [],
      orderBlocks: [],
      vwap: { available: false, unavailableReason: "no session data" },
      volumeProfile: vp,
    } as unknown as SmcContext,
  };
}

function runWith(vp: SmcContext["volumeProfile"]) {
  return runAnalysis({
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100),
    technicalData: tech(vp),
    economicEvents: "Fed signals hawkish stance, rate hike",
  } as AnalysisInput);
}

describe("Market-profile target context", () => {
  it("uses a nearby value-area target without changing core factor scores", () => {
    // Price INSIDE the value area → range vote (RANGING-leaning regime).
    const inside = runWith({
      available: true,
      poc: 100, vah: 104, val: 96,
      vahVolume: 1000, valVolume: 1000,
    } as unknown as SmcContext["volumeProfile"]);
    // Volume profile UNAVAILABLE → fewer regime evidences.
    const withoutVp = runWith({ available: false, unavailableReason: "zero-volume series" });

    expect(inside.recommendation).toBe("NO_TRADE");
    expect(withoutVp.recommendation).toBe("LONG");
    expect(inside.noTradeReasons.join(" ")).toContain("below the 1.500 minimum");
    expect(inside.breakdown).toEqual(withoutVp.breakdown);

    // The nearby value-area high is a real target candidate. Its inadequate
    // R:R can reject execution, while core bias/factor scores remain unchanged.
  });

  it("rejects a long setup when the nearby value-area target fails minimum R:R", () => {
    const r = runAnalysis({
      instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
      marketData: makeMarket(100),
      technicalData: tech({
        available: true, poc: 100, vah: 104, val: 96,
      } as unknown as SmcContext["volumeProfile"]),
      economicEvents: "Fed signals hawkish stance, rate hike",
    } as AnalysisInput);
    expect(r.recommendation).toBe("NO_TRADE");
    expect(r.noTradeReasons.join(" ")).toContain("below the 1.500 minimum");
  });
});
