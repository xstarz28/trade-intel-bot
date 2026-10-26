import { describe, expect, it } from "vitest";
import type { OhlcvCandle } from "@/lib/data/market-types";
import type { WalkForwardReport } from "./walk-forward";
import {
  evaluateMultiAssetWalkForward,
  type HistoricalEvaluationDataset,
} from "./walk-forward-evaluation";

function candles(count: number, close = 100): OhlcvCandle[] {
  const start = Math.floor(1_700_000_000_000 / 60_000) * 60_000;
  return Array.from({ length: count }, (_, index) => ({
    timestamp: start + index * 60_000,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100,
  }));
}

function dataset(overrides: Partial<HistoricalEvaluationDataset> = {}): HistoricalEvaluationDataset {
  const history = candles(500);
  return {
    provider: "test-provider",
    instrument: "BTCUSDT",
    instrumentType: "crypto",
    timeframe: "M1",
    requestedRange: { startTime: history[0].timestamp, endTime: history[history.length - 1].timestamp },
    actualRange: { startTime: history[0].timestamp, endTime: history[history.length - 1].timestamp },
    retrievedAt: 1_800_000_000_000,
    candleCount: history.length,
    candles: history,
    gaps: [],
    ...overrides,
  };
}

function emptyReport(args: { instrument: string; timeframe: string; candles: OhlcvCandle[] }): WalkForwardReport {
  return {
    instrument: args.instrument,
    timeframe: args.timeframe,
    candleCount: args.candles.length,
    signalsChecked: 0,
    noTradeSignals: 0,
    rejectedPlans: 0,
    executedTrades: 0,
    wins: 0,
    losses: 0,
    winRatePct: null,
    expectancyR: null,
    profitFactor: null,
    maxDrawdownR: 0,
    totalNetReturnPct: 0,
    averageNetReturnPct: null,
    trades: [],
    warnings: [],
  };
}

describe("evaluateMultiAssetWalkForward", () => {
  it("creates consecutive OOS folds with past-only training context and provenance", () => {
    const observed: Array<{ candleCount: number; outOfSampleStartIndex: number }> = [];
    const result = evaluateMultiAssetWalkForward(
      [dataset()],
      { trainingBars: 220, testBars: 100, maxFolds: 2, minimumHistory: 220 },
      {
        now: () => 1_800_000_000_001,
        runBacktest: (args) => {
          observed.push({
            candleCount: args.candles.length,
            outOfSampleStartIndex: args.options?.outOfSampleStartIndex ?? -1,
          });
          return emptyReport(args);
        },
      },
    );

    expect(result.schemaVersion).toBe(1);
    expect(result.methodology).toBe("anchored-walk-forward");
    expect(result.generatedAt).toBe(1_800_000_000_001);
    expect(result.providerCoverage[0]).toMatchObject({
      provider: "test-provider",
      instrument: "BTCUSDT",
      candleCount: 500,
      gaps: 0,
    });
    expect(result.folds).toHaveLength(2);
    expect(result.folds[0]).toMatchObject({ fold: 1, trainingBars: 220, testBars: 100 });
    expect(result.folds[1]).toMatchObject({ fold: 2, trainingBars: 220, testBars: 100 });
    expect(observed).toEqual([
      { candleCount: 320, outOfSampleStartIndex: 220 },
      { candleCount: 420, outOfSampleStartIndex: 320 },
    ]);
    expect(result.byAsset[0].uncertainty).toBe("insufficient_sample");
    expect(result.limitations.some((item) => item.includes("past-only"))).toBe(true);
  });

  it("blocks datasets with gaps by default instead of silently synthesizing bars", () => {
    expect(() => evaluateMultiAssetWalkForward([
      dataset({ gaps: [{ missingBars: 1 }] }),
    ], { trainingBars: 220 })).toThrow(/contains 1 reported gap/);
  });

  it("requires explicit opt-in to evaluate a dataset whose gaps are reported", () => {
    const result = evaluateMultiAssetWalkForward(
      [dataset({ gaps: [{ missingBars: 1 }] })],
      { trainingBars: 220, testBars: 100, maxFolds: 1, allowGaps: true },
      { runBacktest: (args) => emptyReport(args) },
    );
    expect(result.providerCoverage[0].gaps).toBe(1);
    expect(result.folds).toHaveLength(1);
  });

  it("blocks timestamp gaps even when the source metadata omitted them", () => {
    const history = candles(500);
    history.splice(250, 1);
    expect(() => evaluateMultiAssetWalkForward([
      dataset({
        candles: history,
        candleCount: history.length,
        actualRange: { startTime: history[0].timestamp, endTime: history[history.length - 1].timestamp },
        requestedRange: { startTime: history[0].timestamp, endTime: candles(500)[499].timestamp },
      }),
    ], { trainingBars: 220 })).toThrow(/unreported gap/);
  });

  it("rejects a minimum history larger than the declared training window", () => {
    expect(() => evaluateMultiAssetWalkForward([dataset()], {
      trainingBars: 220, minimumHistory: 300,
    })).toThrow(/minimumHistory/);
  });

  it("rejects provenance that disagrees with the candle payload", () => {
    expect(() => evaluateMultiAssetWalkForward([
      dataset({ candleCount: 499 }),
    ])).toThrow(/Candle count\/provenance mismatch/);
  });

  it("rejects duplicate instrument/timeframe datasets", () => {
    expect(() => evaluateMultiAssetWalkForward([
      dataset(),
      dataset(),
    ])).toThrow(/Duplicate instrument\/timeframe/);
  });

  it("fails closed when historical coverage cannot form a training window and test bar", () => {
    expect(() => evaluateMultiAssetWalkForward([
      dataset({ candles: candles(100), candleCount: 100, actualRange: {
        startTime: candles(100)[0].timestamp,
        endTime: candles(100)[99].timestamp,
      } }),
    ], { trainingBars: 220 })).toThrow(/Insufficient candles/);
  });
});
