/**
 * Phase 8 P5 — price-snapshot timestamp robustness (Gate 0).
 *
 * Valid timestamps behave exactly as before. Zero/negative/NaN/non-finite and
 * materially-future timestamps are rejected as invalid market data; a small
 * documented future-skew tolerance (90 s) absorbs benign clock differences.
 */
import { describe, it, expect } from "vitest";
import { runAnalysis } from "./analysis-engine";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, TechnicalData } from "@/lib/data/market-types";

function makeMarket(price: number, timestamp: number): MarketData {
  return {
    instrument: "EUR/USD", instrumentType: "forex", provider: "twelve-data",
    fetchTimestamp: Date.now(),
    price: { price, timestamp, source: "twelve-data" },
    candles: Array.from({ length: 210 }, (_, i) => ({
      timestamp: Date.now() - (210 - i) * 36e5,
      open: price, high: price + 0.5, low: price - 0.5, close: price, volume: 1000,
    })),
    timeframe: "H4", dataFreshness: "delayed",
  };
}

function tech(): TechnicalData {
  return {
    swingHighs: [112], swingLows: [95],
    structure: "HH/HL", bosDirection: "bullish", chochDirection: "none",
    supportLevels: [95], resistanceLevels: [112],
    volumeTrend: "unknown", dataPoints: 210,
  };
}

function runWithTimestamp(ts: number) {
  return runAnalysis({
    instrument: "EUR/USD", instrumentType: "forex", timeframe: "H4",
    marketData: makeMarket(100, ts),
    technicalData: tech(),
    economicEvents: "Fed signals hawkish stance, rate hike",
  } as AnalysisInput);
}

const INVALID_MARKER = /invalid or implausibly in the future/i;
const STALE_MARKER = /older than .* minutes/i;

describe("P5: price snapshot timestamp handling", () => {
  it("valid current timestamp → no freshness reason at all", () => {
    const r = runWithTimestamp(Date.now());
    expect(r.noTradeReasons.join(" ")).not.toMatch(INVALID_MARKER);
    expect(r.noTradeReasons.join(" ")).not.toMatch(STALE_MARKER);
  });

  it("zero timestamp → rejected as invalid", () => {
    const r = runWithTimestamp(0);
    expect(r.noTradeReasons.join(" ")).toMatch(INVALID_MARKER);
  });

  it("negative timestamp → rejected as invalid", () => {
    const r = runWithTimestamp(-1000);
    expect(r.noTradeReasons.join(" ")).toMatch(INVALID_MARKER);
  });

  it("NaN timestamp → rejected as invalid", () => {
    const r = runWithTimestamp(NaN);
    expect(r.noTradeReasons.join(" ")).toMatch(INVALID_MARKER);
  });

  it("slightly future within the documented skew tolerance → accepted", () => {
    const r = runWithTimestamp(Date.now() + 60_000); // 60 s < 90 s skew
    expect(r.noTradeReasons.join(" ")).not.toMatch(INVALID_MARKER);
    expect(r.noTradeReasons.join(" ")).not.toMatch(STALE_MARKER);
  });

  it("materially future beyond the tolerance → rejected as invalid", () => {
    const r = runWithTimestamp(Date.now() + 10 * 60_000);
    expect(r.noTradeReasons.join(" ")).toMatch(INVALID_MARKER);
  });

  it("stale timestamp → stale behavior unchanged (style policy applies)", () => {
    const r = runWithTimestamp(Date.now() - 45 * 60_000); // > intraday 30 min
    expect(r.noTradeReasons.join(" ")).toMatch(STALE_MARKER);
    expect(r.recommendation).toBe("NO_TRADE");
  });
});
