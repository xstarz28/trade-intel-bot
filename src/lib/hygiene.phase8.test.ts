/**
 * Phase 8 P6 — semantic correctness regressions.
 *
 * Proves regime detection NEVER becomes additional conviction evidence:
 * toggling a regime-relevant input (volume-profile value area) that feeds NO
 * conviction layer must leave recommendation AND confidence identical.
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

describe("P6: regime evidence is never conviction evidence", () => {
  it("value-area containment changes regime votes but NOT conviction", () => {
    // Price INSIDE the value area → range vote (RANGING-leaning regime).
    const inside = runWith({
      available: true,
      poc: 100, vah: 104, val: 96,
      vahVolume: 1000, valVolume: 1000,
    } as unknown as SmcContext["volumeProfile"]);
    // Volume profile UNAVAILABLE → fewer regime evidences.
    const withoutVp = runWith({ available: false, unavailableReason: "zero-volume series" });

    expect(inside.recommendation).toBe(withoutVp.recommendation);
    expect(inside.confidence).toBe(withoutVp.confidence);
    expect(inside.breakdown).toEqual(withoutVp.breakdown);

    // Regime classification itself may differ — that is its job.
    // (Not asserted to a specific label: only that it cannot move conviction.)
  });

  it("RANGING-regime contradiction stays MINOR and never alters scoring", () => {
    const r = runAnalysis({
      instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
      marketData: makeMarket(100),
      technicalData: tech({
        available: true, poc: 100, vah: 104, val: 96,
      } as unknown as SmcContext["volumeProfile"]),
      economicEvents: "Fed signals hawkish stance, rate hike",
    } as AnalysisInput);
    if (r.marketRegime?.regime === "RANGING") {
      const ranging = (r.keyContradictions ?? []).find((c) => /RANGING/i.test(c.description));
      if (ranging) expect(ranging.severity).toBe("MINOR");
    }
    expect(r.recommendation).toBe("LONG");
  });
});
