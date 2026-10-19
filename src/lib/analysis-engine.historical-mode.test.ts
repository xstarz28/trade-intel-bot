import { describe, expect, it } from "vitest";
import type { AnalysisInput } from "@/types/analysis";
import type { MarketData, OhlcvCandle } from "@/lib/data/market-types";
import { runAnalysis } from "./analysis-engine";

function historicalInput(dataMode?: AnalysisInput["dataMode"], priceTimestamp?: number): AnalysisInput {
  const timestamp = Date.now() - 6 * 60 * 60 * 1000;
  const candles: OhlcvCandle[] = [
    { timestamp: timestamp - 2 * 60 * 60 * 1000, open: 100, high: 102, low: 99, close: 101, volume: 10 },
    { timestamp: timestamp - 60 * 60 * 1000, open: 101, high: 103, low: 100, close: 102, volume: 12 },
    { timestamp, open: 102, high: 104, low: 101, close: 103, volume: 11 },
  ];
  const marketData: MarketData = {
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    provider: "historical-test",
    fetchTimestamp: timestamp,
    price: { price: 103, timestamp: priceTimestamp ?? timestamp, source: "historical-OHLCV" },
    candles,
    timeframe: "H1",
    dataFreshness: "delayed",
  };
  return {
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    timeframe: "H1",
    dataMode,
    currentPrice: "103",
    marketData,
  };
}

describe("analysis historical data mode", () => {
  it("keeps wall-clock stale-price protection enabled for live analysis by default", () => {
    const result = runAnalysis(historicalInput());
    expect(result.noTradeReasons.join(" ")).toContain("older than");
  });

  it("allows an old timestamp only when it is bounded by the last visible historical candle", () => {
    const result = runAnalysis(historicalInput("historical"));
    expect(result.noTradeReasons.join(" ")).not.toContain("older than");
    expect(result.noTradeReasons.join(" ")).not.toContain("Historical price timestamp is invalid");
  });

  it("rejects a historical price timestamp later than the last visible candle", () => {
    const latestVisible = Date.now() - 6 * 60 * 60 * 1000;
    const result = runAnalysis(historicalInput("historical", latestVisible + 60 * 60 * 1000));
    expect(result.noTradeReasons.join(" ")).toContain("later than the last visible candle");
  });
});
