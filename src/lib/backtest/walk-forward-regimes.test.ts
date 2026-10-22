import { describe, expect, it } from "vitest";
import { runWalkForwardBacktest, type BacktestSignal } from "./walk-forward";
import type { OhlcvCandle } from "@/lib/data/market-types";

const start = Date.UTC(2026, 0, 1);
const makeCandles = (closes: number[]): OhlcvCandle[] =>
  closes.map((close, index) => {
    const previous = index === 0 ? close : closes[index - 1];
    return {
      timestamp: start + index * 60_000,
      open: previous,
      high: Math.max(previous, close) + 0.25,
      low: Math.min(previous, close) - 0.25,
      close,
      volume: 1000,
    };
  });

const long: BacktestSignal = {
  recommendation: "LONG",
  tradePlan: { direction: "long", entry: "100", stopLoss: "95", takeProfit: "110" },
  confidence: 70,
};
const short: BacktestSignal = {
  recommendation: "SHORT",
  tradePlan: { direction: "short", entry: "100", stopLoss: "105", takeProfit: "90" },
  confidence: 70,
};

describe("walk-forward market-regime and execution-cost regressions", () => {
  it("does not turn a falling-market short into a long or leak future bars", () => {
    const data = makeCandles(Array.from({ length: 35 }, (_, i) => 110 - i * 0.5));
    const report = runWalkForwardBacktest({
      instrument: "SYNTHETIC-DOWN",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20, maxHoldingBars: 2, costBpsPerSide: 0 },
      analyzeAtClose: (visible, index) => {
        expect(visible.length).toBe(index + 1);
        return index === 19 ? short : { recommendation: "NO_TRADE" };
      },
    });

    expect(report.executedTrades).toBe(1);
    expect(report.trades[0].direction).toBe("short");
    expect(report.trades[0].entryTime).toBe(data[20].timestamp);
    expect(report.trades[0].exitReason).toBe("take_profit");
    expect(report.trades[0].rMultiple).toBeGreaterThan(0);
  });

  it("applies both entry and exit costs to a profitable long in a rising regime", () => {
    const data = makeCandles(Array.from({ length: 35 }, (_, i) => 95 + i * 0.5));
    const signalAt = (visible: readonly OhlcvCandle[], index: number): BacktestSignal => {
      expect(visible.length).toBe(index + 1);
      return index === 19 ? long : { recommendation: "NO_TRADE" };
    };
    const zeroCost = runWalkForwardBacktest({
      instrument: "SYNTHETIC-UP",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20, maxHoldingBars: 2, costBpsPerSide: 0 },
      analyzeAtClose: signalAt,
    });
    const costly = runWalkForwardBacktest({
      instrument: "SYNTHETIC-UP",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20, maxHoldingBars: 2, costBpsPerSide: 25 },
      analyzeAtClose: signalAt,
    });

    expect(zeroCost.executedTrades).toBe(1);
    expect(costly.executedTrades).toBe(1);
    expect(costly.trades[0].entry).toBeGreaterThan(zeroCost.trades[0].entry);
    expect(costly.trades[0].exit).toBeLessThan(zeroCost.trades[0].exit);
    expect(costly.trades[0].netReturnPct).toBeLessThan(zeroCost.trades[0].netReturnPct);
  });

  it("keeps metrics null for a flat/no-trade regime instead of manufacturing a win rate", () => {
    const data = makeCandles(Array.from({ length: 35 }, () => 100));
    const report = runWalkForwardBacktest({
      instrument: "SYNTHETIC-FLAT",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20 },
      analyzeAtClose: () => ({ recommendation: "NO_TRADE" }),
    });

    expect(report.executedTrades).toBe(0);
    expect(report.winRatePct).toBeNull();
    expect(report.expectancyR).toBeNull();
    expect(report.profitFactor).toBeNull();
    expect(report.totalNetReturnPct).toBe(0);
  });
});
