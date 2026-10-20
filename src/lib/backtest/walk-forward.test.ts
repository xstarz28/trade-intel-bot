import { describe, expect, it, vi } from "vitest";
import { runAnalysis } from "@/lib/analysis-engine";
vi.mock("@/lib/analysis-engine", { spy: true });
import { completedHigherTimeframeCandlesAt, runProductionWalkForwardBacktest, runWalkForwardBacktest, type BacktestSignal } from "./walk-forward";
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

  it("scores only the configured out-of-sample period while retaining earlier candles as history", () => {
    const data = candles(30);
    const seenIndices: number[] = [];
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20, outOfSampleStartIndex: 24 },
      analyzeAtClose: (visible, index) => {
        seenIndices.push(index);
        expect(visible.length).toBe(index + 1);
        return { recommendation: "NO_TRADE" };
      },
    });

    expect(seenIndices[0]).toBe(24);
    expect(seenIndices.every((index) => index >= 24)).toBe(true);
    expect(report.signalsChecked).toBe(5);
    expect(report.warnings.some((warning) => warning.includes("Out-of-sample scoring starts at candle index 24"))).toBe(true);
  });

  it("rejects an invalid out-of-sample start index", () => {
    expect(() => runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: candles(30),
      options: { outOfSampleStartIndex: 29 },
      analyzeAtClose: () => ({ recommendation: "NO_TRADE" }),
    })).toThrow(/outOfSampleStartIndex must be an integer/);
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

  it("includes entry and exit costs in realized R and return denominators", () => {
    const data = candles(30);
    data[21] = { ...data[21], open: 100, high: 101, low: 94, close: 96 };
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20, maxHoldingBars: 4, costBpsPerSide: 10 },
      analyzeAtClose: (_visible, index) => index === 19 ? longSignal : { recommendation: "NO_TRADE" },
    });

    expect(report.executedTrades).toBe(1);
    const trade = report.trades[0];
    expect(trade.entry).toBeCloseTo(100.1, 8);
    expect(trade.exit).toBeCloseTo(94.905, 8);
    // With symmetric 10 bps per-side costs, the stop loss is -1R after costs.
    expect(trade.rMultiple).toBeCloseTo(-1, 8);
    expect(trade.netReturnPct).toBeCloseTo(((94.905 - 100.1) / 100.1) * 100, 8);
  });

  it("models a stop-market fill worse than the trigger after an adverse opening gap", () => {
    const data = candles(30);
    data[21] = { ...data[21], open: 90, high: 92, low: 89, close: 91 };
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: data,
      options: { minimumHistory: 20, maxHoldingBars: 4, costBpsPerSide: 0 },
      analyzeAtClose: (_visible, index) => index === 19 ? longSignal : { recommendation: "NO_TRADE" },
    });
    expect(report.executedTrades).toBe(1);
    expect(report.trades[0].exitReason).toBe("stop_loss");
    expect(report.trades[0].exit).toBe(90);
    expect(report.trades[0].rMultiple).toBeLessThan(-1);
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

  it("rejects malformed runtime recommendations instead of interpreting them as shorts", () => {
    const invalidSignal = {
      recommendation: "WAIT",
      tradePlan: { direction: "short", entry: "100", stopLoss: "105", takeProfit: "90" },
      confidence: 80,
    } as unknown as BacktestSignal;
    const report = runWalkForwardBacktest({
      instrument: "TEST",
      timeframe: "M1",
      candles: candles(30),
      options: { minimumHistory: 20 },
      analyzeAtClose: () => invalidSignal,
    });

    expect(report.executedTrades).toBe(0);
    expect(report.rejectedPlans).toBeGreaterThan(0);
    expect(report.losses).toBe(0);
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
    expect(report.warnings.some((warning) => warning.includes("Provider fundamentals, news, COT, and derivatives are not synthesized"))).toBe(true);
    expect(report.warnings.some((warning) => warning.includes("future profitability"))).toBe(true);
  });


  it("uses only fully closed higher-timeframe candles at the signal close", () => {
    const day1 = Date.UTC(2026, 9, 18);
    const day2 = Date.UTC(2026, 9, 19);
    const day3 = Date.UTC(2026, 9, 20);
    const daily = [day1, day2, day3].map((timestamp) => ({
      timestamp,
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000,
    }));

    const visibleAtSignalClose = completedHigherTimeframeCandlesAt(
      daily,
      Date.UTC(2026, 9, 19, 12),
      "D1",
    );

    expect(visibleAtSignalClose.map((candle) => candle.timestamp)).toEqual([day1]);
  });

  it("rejects non-finite signal cutoffs instead of exposing future higher-timeframe candles", () => {
    const daily = candles(3, Date.UTC(2026, 9, 18));
    expect(completedHigherTimeframeCandlesAt(daily, Number.POSITIVE_INFINITY, "D1")).toEqual([]);
    expect(completedHigherTimeframeCandlesAt(daily, Number.NaN, "D1")).toEqual([]);
  });

  it("includes a higher-timeframe candle exactly at its close boundary and excludes later candles", () => {
    const day1 = Date.UTC(2026, 9, 18);
    const day2 = Date.UTC(2026, 9, 19);
    const day3 = Date.UTC(2026, 9, 20);
    const daily = [day1, day2, day3].map((timestamp) => ({
      timestamp,
      open: 100,
      high: 105,
      low: 95,
      close: 102,
      volume: 1000,
    }));

    const atBoundary = completedHigherTimeframeCandlesAt(daily, day2, "D1");
    expect(atBoundary.map((candle) => candle.timestamp)).toEqual([day1]);

    const afterBoundary = completedHigherTimeframeCandlesAt(
      daily,
      day2 + 1,
      "D1",
    );
    expect(afterBoundary.map((candle) => candle.timestamp)).toEqual([day1]);
  });

  it("requires higher-timeframe candles and a strictly higher timeframe together", () => {
    const primary = candles(225);
    const daily = candles(225, 1_600_000_000_000);
    expect(() => runProductionWalkForwardBacktest({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      candles: primary,
      higherTimeframe: "D1",
      options: { minimumHistory: 220 },
    })).toThrow(/must be provided together/);

    expect(() => runProductionWalkForwardBacktest({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      candles: primary,
      higherTimeframe: "H1",
      higherTimeframeCandles: daily,
      options: { minimumHistory: 220 },
    })).toThrow(/must be higher/);
  });

  it("forwards only completed higher-timeframe candles to each production analysis call", () => {
    vi.mocked(runAnalysis).mockClear();
    const base = Date.UTC(2026, 9, 1);
    const primary = Array.from({ length: 150 }, (_, index) => ({
      timestamp: base + index * 4 * 60 * 60 * 1000,
      open: 100 + index * 0.1,
      high: 102 + index * 0.1,
      low: 98 + index * 0.1,
      close: 101 + index * 0.1,
      volume: 1000 + index,
    }));
    const daily = candles(35, base).map((candle, index) => ({
      ...candle,
      timestamp: base + index * 24 * 60 * 60 * 1000,
    }));

    runProductionWalkForwardBacktest({
      instrument: "BTC/USD",
      instrumentType: "crypto",
      timeframe: "H4",
      candles: primary,
      higherTimeframe: "D1",
      higherTimeframeCandles: daily,
      options: { minimumHistory: 20, maxHoldingBars: 2 },
    });

    const calls = vi.mocked(runAnalysis).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    let sawCompletedHigherTimeframe = false;
    for (const [callIndex, [input]] of calls.entries()) {
      const visible = input.marketData?.candles;
      expect(visible?.length).toBeGreaterThan(0);
      const signalClose = visible![visible!.length - 1].timestamp + 4 * 60 * 60 * 1000;
      const expected = daily.filter((candle) => candle.timestamp + 24 * 60 * 60 * 1000 <= signalClose);
      const supplied = input.marketData?.higherTimeframeCandles ?? [];
      expect(supplied.map((candle) => candle.timestamp)).toEqual(expected.map((candle) => candle.timestamp));
      expect(supplied.every((candle) => candle.timestamp + 24 * 60 * 60 * 1000 <= signalClose)).toBe(true);
      if (expected.length > 0) {
        sawCompletedHigherTimeframe = true;
      }
      if (expected.length >= 20) {
        expect(input.technicalData?.htfContext?.timeframe).toBe("D1");
        expect(input.technicalData?.htfContext?.dataPoints).toBe(expected.length);
        const analysisResult = vi.mocked(runAnalysis).mock.results[callIndex];
        expect(analysisResult?.type).toBe("return");
        if (analysisResult?.type === "return") {
          expect(analysisResult.value.htfAlignment).toBeDefined();
          expect(analysisResult.value.dataFlags.join(" ")).not.toContain("No higher-timeframe structural data");
        }
      }
    }
    expect(sawCompletedHigherTimeframe).toBe(true);
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