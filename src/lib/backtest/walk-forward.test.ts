import { describe, expect, it } from "vitest";
import { runProductionWalkForwardBacktest, runWalkForwardBacktest, type BacktestSignal } from "./walk-forward";
import type { OhlcvCandle } from "@/lib/data/market-types";

const candles = (count: number, start = 1_700_000_000_000): OhlcvCandle[] =>
  Array.from({ length: count }, (_, i) => ({
    timestamp: start + i * 60_000,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }));

const longSignal: BacktestSignal = {
  recommendation: "LONG",
  tradePlan: { direction: "long", entry: "100", stopLoss: "95", takeProfit: "110" },
  confidence: 70,
};

describe("runWalkForwardBacktest", () => {
  it("does not call the analyzer before the minimum history is available", () => {
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: candles(8),
      options: { minimumHistory: 20 },
      analyzeAtClose: () => longSignal,
    });
    expect(report.signalsChecked).toBe(0);
  });

  it("never gives the analyzer future candles and starts fills after the signal candle", () => {
    const data = candles(30);
    const seenLengths: number[] = [];
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20 },
      analyzeAtClose: (visible, index) => {
        seenLengths.push(visible.length);
        expect(visible.length).toBe(index + 1);
        expect(visible[visible.length - 1].timestamp).toBe(data[index].timestamp);
        return { recommendation: "NO_TRADE" };
      },
    });
    expect(report.executedTrades).toBe(0);
    expect(seenLengths.length).toBeGreaterThan(0);
  });

  it("rejects unsorted/duplicate timestamps and malformed OHLC", () => {
    const data = candles(25);
    data[4] = { ...data[4], timestamp: data[3].timestamp };
    expect(() => runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: data,
      analyzeAtClose: () => longSignal,
    })).toThrow(/strictly ascending/);
    const malformed = candles(25);
    malformed[5] = { ...malformed[5], high: 90 };
    expect(() => runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: malformed,
      analyzeAtClose: () => longSignal,
    })).toThrow(/inconsistent OHLC/);
  });

  it("enters next bar, applies costs, and resolves same-bar stop/target conservatively", () => {
    const data = candles(30);
    data[21] = { ...data[21], open: 100, high: 111, low: 94, close: 105 };
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20, maxHoldingBars: 4, costBpsPerSide: 5 },
      analyzeAtClose: (_visible, index) => index === 19 ? longSignal : { recommendation: "NO_TRADE" },
    });
    expect(report.executedTrades).toBe(1);
    expect(report.trades[0].entryTime).toBe(data[20].timestamp);
    expect(report.trades[0].exitReason).toBe("stop_loss");
    expect(report.trades[0].rMultiple).toBeLessThan(0);
  });

  it("skips trades whose next-open gap makes R:R lower than 1.5", () => {
    const data = candles(30);
    data[20] = { ...data[20], open: 108, high: 109 };
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20 },
      analyzeAtClose: (_visible, index) => index === 19 ? longSignal : { recommendation: "NO_TRADE" },
    });
    expect(report.executedTrades).toBe(0);
    expect(report.rejectedPlans).toBe(1);
  });

  it("rejects invalid numeric options instead of silently disabling the replay", () => {
    expect(() => runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: candles(30),
      options: { minimumHistory: Number.NaN },
      analyzeAtClose: () => ({ recommendation: "NO_TRADE" }),
    })).toThrow(/minimumHistory must be a finite/);
    expect(() => runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: candles(30),
      options: { maxHoldingBars: Number.POSITIVE_INFINITY },
      analyzeAtClose: () => ({ recommendation: "NO_TRADE" }),
    })).toThrow(/maxHoldingBars must be a finite/);
  });

  it("runs the production analysis adapter over historical prefixes without throwing", () => {
    const report = runProductionWalkForwardBacktest({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "M1",
      candles: candles(225),
      options: { minimumHistory: 220, maxHoldingBars: 3 },
    });
    expect(report.candleCount).toBe(225);
    expect(report.signalsChecked).toBeGreaterThan(0);
    expect(report.warnings.some((warning) => warning.includes("MTF feeds are synthesized"))).toBe(false);
    expect(report.warnings.some((warning) => warning.includes("future profitability"))).toBe(true);
  });

  it("reports no fake performance metrics when no trades execute", () => {
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: candles(30),
      options: { minimumHistory: 20 },
      analyzeAtClose: () => ({ recommendation: "NO_TRADE" }),
    });
    expect(report.executedTrades).toBe(0);
    expect(report.winRatePct).toBeNull();
    expect(report.expectancyR).toBeNull();
    expect(report.profitFactor).toBeNull();
  });
});
