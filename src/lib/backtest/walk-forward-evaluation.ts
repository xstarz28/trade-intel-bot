import type { OhlcvCandle } from "@/lib/data/market-types";
import type { Timeframe, InstrumentType } from "@/types/analysis";
import {
  runProductionWalkForwardBacktest,
  type BacktestTrade,
  type WalkForwardOptions,
  type WalkForwardReport,
} from "./walk-forward";

export interface HistoricalEvaluationDataset {
  provider: string;
  instrument: string;
  instrumentType: InstrumentType;
  timeframe: Timeframe;
  requestedRange: { startTime: number; endTime: number };
  actualRange: { startTime: number; endTime: number } | null;
  retrievedAt: number;
  candleCount: number;
  candles: OhlcvCandle[];
  gaps: Array<{ missingBars: number; expectedTimestamp?: number; nextObservedTimestamp?: number }>;
  warnings?: string[];
}

export interface WalkForwardEvaluationOptions {
  /** Number of candles reserved before each OOS window for historical context. */
  trainingBars?: number;
  /** Number of candles in each consecutive out-of-sample window. */
  testBars?: number;
  /** Maximum number of OOS folds evaluated per asset. */
  maxFolds?: number;
  /** Execution assumptions passed to the existing backtest engine. */
  costBpsPerSide?: number;
  maxHoldingBars?: number;
  minimumHistory?: number;
  /** Missing bars make a dataset ineligible by default; never silently fill them. */
  allowGaps?: boolean;
}

export type HistoricalRegime =
  | "trend_up"
  | "trend_down"
  | "range_high_volatility"
  | "range_low_volatility";

export interface FoldEvaluation {
  instrument: string;
  timeframe: Timeframe;
  fold: number;
  trainingRange: { startTime: number; endTime: number };
  testRange: { startTime: number; endTime: number };
  trainingBars: number;
  testBars: number;
  regime: HistoricalRegime;
  exposurePct: number;
  turnoverTradesPer1000Bars: number;
  report: WalkForwardReport;
}

export interface EvaluationSummary {
  instrument: string;
  regime?: HistoricalRegime;
  folds: number;
  trades: number;
  expectancyR: number | null;
  profitFactor: number | null;
  winRatePct: number | null;
  maxDrawdownR: number;
  totalNetReturnPct: number;
  exposurePct: number;
  turnoverTradesPer1000Bars: number;
  uncertainty: "insufficient_sample" | "descriptive_only";
}

export interface MultiAssetWalkForwardReport {
  schemaVersion: 1;
  methodology: "anchored-walk-forward";
  generatedAt: number;
  providerCoverage: Array<{
    provider: string;
    instrument: string;
    timeframe: Timeframe;
    requestedRange: { startTime: number; endTime: number };
    actualRange: { startTime: number; endTime: number } | null;
    retrievedAt: number;
    candleCount: number;
    gaps: number;
    sourceWarnings: string[];
  }>;
  folds: FoldEvaluation[];
  byAsset: EvaluationSummary[];
  byRegime: EvaluationSummary[];
  limitations: string[];
}

type ProductionBacktest = typeof runProductionWalkForwardBacktest;

export interface WalkForwardEvaluationDependencies {
  now?: () => number;
  runBacktest?: ProductionBacktest;
}

const TIMEFRAME_MS: Record<Timeframe, number> = {
  M1: 60_000,
  M5: 300_000,
  M15: 900_000,
  H1: 3_600_000,
  H4: 14_400_000,
  D1: 86_400_000,
  W1: 604_800_000,
};

function isTimeframeAligned(timestamp: number, timeframe: Timeframe): boolean {
  if (timeframe === "W1") {
    const date = new Date(timestamp);
    return date.getUTCDay() === 1 &&
      date.getUTCHours() === 0 &&
      date.getUTCMinutes() === 0 &&
      date.getUTCSeconds() === 0 &&
      date.getUTCMilliseconds() === 0;
  }
  return timestamp % TIMEFRAME_MS[timeframe] === 0;
}

function assertDataset(dataset: HistoricalEvaluationDataset, allowGaps: boolean): void {
  if (!dataset.provider.trim()) throw new Error("Historical dataset provider is required.");
  if (!dataset.instrument.trim()) throw new Error("Historical dataset instrument is required.");
  if (!Number.isFinite(dataset.retrievedAt) || dataset.retrievedAt <= 0) {
    throw new Error(`Invalid retrieval timestamp for ${dataset.instrument}.`);
  }
  if (!Number.isFinite(dataset.requestedRange.startTime) ||
      !Number.isFinite(dataset.requestedRange.endTime) ||
      dataset.requestedRange.endTime <= dataset.requestedRange.startTime) {
    throw new Error(`Invalid requested range for ${dataset.instrument}.`);
  }
  if (dataset.candleCount !== dataset.candles.length) {
    throw new Error(`Candle count/provenance mismatch for ${dataset.instrument}.`);
  }
  if (!dataset.actualRange && dataset.candles.length > 0) {
    throw new Error(`Actual range is missing for non-empty dataset ${dataset.instrument}.`);
  }
  if (dataset.candles.length > 0 && dataset.actualRange) {
    if (dataset.actualRange.startTime !== dataset.candles[0].timestamp ||
        dataset.actualRange.endTime !== dataset.candles[dataset.candles.length - 1].timestamp) {
      throw new Error(`Actual range does not match candle data for ${dataset.instrument}.`);
    }
    if (dataset.actualRange.startTime < dataset.requestedRange.startTime ||
        dataset.actualRange.endTime > dataset.requestedRange.endTime) {
      throw new Error(`Actual candle range exceeds the requested bounds for ${dataset.instrument}.`);
    }
  }
  const intervalMs = TIMEFRAME_MS[dataset.timeframe];
  for (let index = 0; index < dataset.candles.length; index += 1) {
    const candle = dataset.candles[index];
    if (!Number.isSafeInteger(candle.timestamp) || !isTimeframeAligned(candle.timestamp, dataset.timeframe)) {
      throw new Error(`Candle timestamp is not aligned to the declared ${dataset.timeframe} UTC interval for ${dataset.instrument}.`);
    }
    if (index > 0) {
      const delta = candle.timestamp - dataset.candles[index - 1].timestamp;
      if (delta <= 0 || delta % intervalMs !== 0) {
        throw new Error(`Candle timestamps are duplicate, descending, or misaligned for ${dataset.instrument}.`);
      }
      if (delta !== intervalMs && !allowGaps) {
        throw new Error(`Candle timestamps contain an unreported gap for ${dataset.instrument}; evaluation is blocked.`);
      }
    }
  }
  if (dataset.gaps.length > 0 && !allowGaps) {
    throw new Error(`Dataset ${dataset.instrument} contains ${dataset.gaps.length} reported gap(s); evaluation is blocked rather than filling missing bars.`);
  }
}

function classifyRegime(training: readonly OhlcvCandle[]): HistoricalRegime {
  if (training.length < 2) throw new Error("At least two training candles are required to classify a regime.");
  const first = training[0].close;
  const last = training[training.length - 1].close;
  const netReturn = first > 0 ? last / first - 1 : 0;
  const absReturns: number[] = [];
  for (let i = 1; i < training.length; i += 1) {
    const previous = training[i - 1].close;
    const current = training[i].close;
    if (previous > 0 && current > 0) absReturns.push(Math.abs(current / previous - 1));
  }
  const meanAbsReturn = absReturns.length
    ? absReturns.reduce((sum, value) => sum + value, 0) / absReturns.length
    : 0;
  if (netReturn >= 0.03) return "trend_up";
  if (netReturn <= -0.03) return "trend_down";
  return meanAbsReturn >= 0.01 ? "range_high_volatility" : "range_low_volatility";
}

function summarize(instrument: string, folds: FoldEvaluation[], regime?: HistoricalRegime): EvaluationSummary {
  const selected = folds.filter((fold) => fold.instrument === instrument && (!regime || fold.regime === regime));
  const trades = selected.flatMap((fold) => fold.report.trades).sort((a, b) => a.signalTime - b.signalTime);
  const totalTestBars = selected.reduce((sum, fold) => sum + fold.testBars, 0);
  const barsExposed = trades.reduce((sum, trade) => sum + trade.barsHeld, 0);
  const wins = trades.filter((trade) => trade.rMultiple > 0).length;
  const grossWinsR = trades.reduce((sum, trade) => sum + Math.max(0, trade.rMultiple), 0);
  const grossLossesR = trades.reduce((sum, trade) => sum + Math.max(0, -trade.rMultiple), 0);
  let equityR = 0;
  let peakR = 0;
  let maxDrawdownR = 0;
  let compoundedReturn = 1;
  for (const trade of trades) {
    equityR += trade.rMultiple;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
    compoundedReturn *= 1 + trade.netReturnPct / 100;
  }
  return {
    instrument,
    ...(regime ? { regime } : {}),
    folds: selected.length,
    trades: trades.length,
    expectancyR: trades.length ? trades.reduce((sum, trade) => sum + trade.rMultiple, 0) / trades.length : null,
    profitFactor: grossLossesR > 0 ? grossWinsR / grossLossesR : null,
    winRatePct: trades.length ? wins / trades.length * 100 : null,
    maxDrawdownR,
    totalNetReturnPct: (compoundedReturn - 1) * 100,
    exposurePct: totalTestBars > 0 ? Math.min(100, barsExposed / totalTestBars * 100) : 0,
    turnoverTradesPer1000Bars: totalTestBars > 0 ? trades.length / totalTestBars * 1000 : 0,
    uncertainty: trades.length < 30 ? "insufficient_sample" : "descriptive_only",
  };
}

/**
 * Evaluate historical datasets across consecutive anchored OOS windows.
 * Each fold receives only candles through that fold's test end; the existing
 * engine receives a prefix ending at each signal candle. No missing candles are
 * synthesized. Costs are per-side fee+slippage assumptions from walk-forward.ts.
 */
export function evaluateMultiAssetWalkForward(
  datasets: HistoricalEvaluationDataset[],
  options: WalkForwardEvaluationOptions = {},
  dependencies: WalkForwardEvaluationDependencies = {},
): MultiAssetWalkForwardReport {
  const now = dependencies.now ?? Date.now;
  const runBacktest = dependencies.runBacktest ?? runProductionWalkForwardBacktest;
  const trainingBars = Math.floor(options.trainingBars ?? 220);
  const testBars = Math.floor(options.testBars ?? 120);
  const maxFolds = Math.floor(options.maxFolds ?? 5);
  const minimumHistory = Math.floor(options.minimumHistory ?? 220);
  if (trainingBars < 20 || testBars < 10 || maxFolds < 1 || minimumHistory < 20 || minimumHistory > trainingBars) {
    throw new Error("trainingBars must be >=20 and >= minimumHistory; minimumHistory must be >=20, testBars >=10, and maxFolds >=1.");
  }
  if (datasets.length === 0) throw new Error("At least one historical dataset is required for evaluation.");
  if (new Set(datasets.map((dataset) => `${dataset.instrument}|${dataset.timeframe}`)).size !== datasets.length) {
    throw new Error("Duplicate instrument/timeframe datasets are not allowed in one evaluation report.");
  }

  const folds: FoldEvaluation[] = [];
  const providerCoverage: MultiAssetWalkForwardReport["providerCoverage"] = [];
  for (const dataset of datasets) {
    assertDataset(dataset, options.allowGaps ?? false);
    const candles = dataset.candles;
    if (candles.length < trainingBars + 11) {
      throw new Error(`Insufficient candles for ${dataset.instrument}: need at least ${trainingBars + 11} to form training context and a minimally useful OOS window, received ${candles.length}.`);
    }
    providerCoverage.push({
      provider: dataset.provider,
      instrument: dataset.instrument,
      timeframe: dataset.timeframe,
      requestedRange: dataset.requestedRange,
      actualRange: dataset.actualRange,
      retrievedAt: dataset.retrievedAt,
      candleCount: dataset.candleCount,
      gaps: Math.max(dataset.gaps.length, dataset.candles.reduce((count, candle, index) =>
        index > 0 && candle.timestamp - dataset.candles[index - 1].timestamp > TIMEFRAME_MS[dataset.timeframe] ? count + 1 : count, 0)),
      sourceWarnings: dataset.warnings ?? [],
    });

    let testStart = trainingBars;
    let foldNumber = 1;
    while (testStart < candles.length - 1 && foldNumber <= maxFolds) {
      const testEnd = Math.min(candles.length, testStart + testBars);
      const foldCandles = candles.slice(0, testEnd);
      const training = candles.slice(Math.max(0, testStart - trainingBars), testStart);
      if (training.length < trainingBars) break;
      const report = runBacktest({
        instrument: dataset.instrument,
        instrumentType: dataset.instrumentType,
        timeframe: dataset.timeframe,
        candles: foldCandles,
        options: {
          minimumHistory,
          maxHoldingBars: options.maxHoldingBars ?? 20,
          costBpsPerSide: options.costBpsPerSide ?? 5,
          outOfSampleStartIndex: testStart,
        } satisfies WalkForwardOptions,
      });
      folds.push({
        instrument: dataset.instrument,
        timeframe: dataset.timeframe,
        fold: foldNumber,
        trainingRange: { startTime: training[0].timestamp, endTime: training[training.length - 1].timestamp },
        testRange: { startTime: candles[testStart].timestamp, endTime: candles[testEnd - 1].timestamp },
        trainingBars: training.length,
        testBars: testEnd - testStart,
        regime: classifyRegime(training),
        exposurePct: report.candleCount > 0
          ? Math.min(100, report.trades.reduce((sum, trade) => sum + trade.barsHeld, 0) / (testEnd - testStart) * 100)
          : 0,
        turnoverTradesPer1000Bars: testEnd > testStart
          ? report.executedTrades / (testEnd - testStart) * 1000
          : 0,
        report,
      });
      testStart += testBars;
      foldNumber += 1;
    }
  }

  const assets = [...new Set(folds.map((fold) => fold.instrument))];
  const regimes: HistoricalRegime[] = ["trend_up", "trend_down", "range_high_volatility", "range_low_volatility"];
  const byAsset = assets.map((asset) => summarize(asset, folds));
  const byRegime = regimes
    .map((regime) => summarize("ALL_ASSETS", folds.filter((fold) => fold.regime === regime).map((fold) => ({ ...fold, instrument: "ALL_ASSETS" })), regime))
    .filter((summary) => summary.folds > 0);
  return {
    schemaVersion: 1,
    methodology: "anchored-walk-forward",
    generatedAt: now(),
    providerCoverage,
    folds,
    byAsset,
    byRegime,
    limitations: [
      "This report is descriptive evidence, not a prediction or proof of future profitability.",
      "Each fold is scored only after its training window; signal generation sees past-only candle prefixes.",
      "Spot OHLCV does not include funding, borrow, liquidation, or derivatives basis costs; do not generalize spot results to derivatives.",
      "Fees and slippage are combined per-side assumptions; replace them with venue- and instrument-specific estimates before release decisions.",
      "Intrabar stop/target ordering is conservative but OHLC candles cannot reproduce order-book fills, partial fills, latency, or market impact.",
      "Regime labels are deterministic heuristics calculated from each fold's prior training window, not authoritative market-state labels.",
      "Samples with fewer than 30 trades are marked insufficient_sample; larger samples remain descriptive without a confidence interval.",
      "Persist the returned JSON together with the source dataset to make the evaluation auditable and reproducible.",
    ],
  };
}
