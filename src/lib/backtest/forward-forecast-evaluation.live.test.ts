import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types/analysis";
import { buildForwardForecast, type InvestorForecastHorizon } from "@/lib/forward-forecast";
import { fetchHistoricalBinanceSpotOhlcv } from "./historical-ohlcv";
import {
  evaluateForwardForecastOutcomes,
  type ForwardForecastObservation,
} from "./forward-forecast-evaluation";

const enabled = process.env.RUN_REAL_FORWARD_FORECAST_EVALUATION === "1";
const DAY = 86_400_000;
const COST_SCENARIOS = [15, 20, 25] as const;
const SYMBOLS = ["BNBUSDT", "XRPUSDT", "ADAUSDT"] as const;
const INVESTOR_HORIZONS: InvestorForecastHorizon[] = [
  "1-4_WEEKS",
  "1-3_MONTHS",
  "3-6_MONTHS",
  "6-12_MONTHS",
  "1-3_YEARS",
  "3+_YEARS",
];

function ema(values: number[], period: number): number {
  const multiplier = 2 / (period + 1);
  let value = values[0] ?? 0;
  for (let index = 1; index < values.length; index += 1) {
    value = values[index] * multiplier + value * (1 - multiplier);
  }
  return value;
}

function maxHigh(candles: Array<{ high: number }>): number | undefined {
  return candles.length ? Math.max(...candles.map((candle) => candle.high)) : undefined;
}

function minLow(candles: Array<{ low: number }>): number | undefined {
  return candles.length ? Math.min(...candles.map((candle) => candle.low)) : undefined;
}

function momentumDirection(
  history: Array<{ close: number }>,
): "bullish" | "bearish" | "neutral" {
  if (history.length < 2 || history[0].close <= 0) return "neutral";
  const change = history[history.length - 1].close / history[0].close - 1;
  if (change > 0.001) return "bullish";
  if (change < -0.001) return "bearish";
  return "neutral";
}

function aggregateToHigherTimeframe(
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
  sourceTimeframe: "H1" | "D1",
): Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }> {
  const targetTimeframe = sourceTimeframe === "H1" ? "D1" : "W1";
  const groups = new Map<number, Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>>();
  for (const candle of candles) {
    const date = new Date(candle.timestamp);
    let bucket: number;
    if (targetTimeframe === "D1") {
      bucket = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    } else {
      const mondayOffset = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - mondayOffset);
      bucket = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    }
    const rows = groups.get(bucket) ?? [];
    rows.push(candle);
    groups.set(bucket, rows);
  }
  return [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([timestamp, rows]) => ({
    timestamp,
    open: rows[0].open,
    high: Math.max(...rows.map((row) => row.high)),
    low: Math.min(...rows.map((row) => row.low)),
    close: rows[rows.length - 1].close,
    volume: rows.reduce((sum, row) => sum + row.volume, 0),
  }));
}

function structuralDirection(
  history: Array<{ high: number; low: number }>,
): "HH/HL" | "LH/LL" | "unknown" {
  if (history.length < 60) return "unknown";
  const previous = history.slice(-60, -30);
  const recent = history.slice(-30);
  const previousHigh = maxHigh(previous);
  const recentHigh = maxHigh(recent);
  const previousLow = minLow(previous);
  const recentLow = minLow(recent);
  if (previousHigh === undefined || recentHigh === undefined || previousLow === undefined || recentLow === undefined) return "unknown";
  if (recentHigh > previousHigh && recentLow > previousLow) return "HH/HL";
  if (recentHigh < previousHigh && recentLow < previousLow) return "LH/LL";
  return "unknown";
}

function createHistoricalForecast(
  instrument: string,
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
  index: number,
  timeframe: "H1" | "D1",
  tradingStyle: "intraday" | "swing",
  requestedInvestorHorizon: InvestorForecastHorizon = "1-3_YEARS",
): ReturnType<typeof buildForwardForecast> {
  const current = candles[index];
  const history = candles.slice(0, index);
  const closes = candles.slice(0, index + 1).map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const bias: AnalysisResult["bias"] = current.close > ema20 && ema20 > ema50
    ? "Bullish"
    : current.close < ema20 && ema20 < ema50
      ? "Bearish"
      : "Neutral";

  const prior20 = history.slice(-20);
  const support = minLow(prior20);
  const resistance = maxHigh(prior20);
  const invalidation = bias === "Bullish" ? support : bias === "Bearish" ? resistance : undefined;
  // Aggregate only completed lower-timeframe candles into a genuine higher-
  // timeframe series: H1→D1 and D1→W1. No primary-timeframe structure is
  // relabeled as HTF evidence.
  const htfCandles = aggregateToHigherTimeframe(history, timeframe);
  const htfStructure = structuralDirection(htfCandles.slice(-60));
  const htfSwingWindow = htfCandles.slice(-90);
  const htfHigh = maxHigh(htfSwingWindow);
  const htfLow = minLow(htfSwingWindow);
  const htfTimeframe = timeframe === "H1" ? "D1" : "W1";
  const dataAsOf = current.timestamp + (timeframe === "D1" ? DAY : 3_600_000);

  const result = {
    id: `oos-${instrument}-${timeframe}-${index}`,
    instrument,
    instrumentType: "crypto",
    timeframe,
    bias,
    confidence: 50,
    recommendation: "NO_TRADE",
    noTradeReasons: ["Research-only historical forecast replay; not an execution recommendation."],
    tradingStyle,
    technicalSummary: "Pre-registered EMA trend and trailing market-structure hypothesis.",
    fundamentalSummary: "Not used by this technical-only research hypothesis.",
    breakdown: { trend: 1, indicator: 1, fundamental: 0, sentiment: 0 },
    keyLevels: {
      support: support?.toString() ?? "N/A",
      resistance: resistance?.toString() ?? "N/A",
      invalidation: invalidation?.toString() ?? "N/A",
    },
    riskNote: "Research-only; no order authority.",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: dataAsOf,
    priceSnapshot: {
      price: current.close,
      timestamp: dataAsOf,
      source: "binance-spot-historical-replay",
    },
    htfAlignment: {
      htfTimeframe,
      htfStructure,
      state: htfStructure === "unknown" ? "unknown" : "aligned",
    },
    technicalData: {
      htfContext: {
        timeframe: htfTimeframe,
        structure: htfStructure,
        bosDirection: "none",
        chochDirection: "none",
        lastSwingHigh: htfHigh,
        lastSwingLow: htfLow,
        dataPoints: htfCandles.length,
      },
    },
  } as unknown as AnalysisResult;

  return buildForwardForecast(result, { investorHorizon: requestedInvestorHorizon });
}

function buildObservations(
  instrument: string,
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
  timeframe: "H1" | "D1",
  horizon: "trader" | "investor",
  warmupBars: number,
  requestedInvestorHorizon: InvestorForecastHorizon = "1-3_YEARS",
): ForwardForecastObservation[] {
  const intervalMs = timeframe === "D1" ? DAY : 3_600_000;
  const tradingStyle = timeframe === "D1" ? "swing" : "intraday";
  // Derive replay spacing from the actual forecast contract. A 90-day step
  // would create overlapping observations for the current 1–3 year investor
  // horizon and falsely inflate the sample count.
  const probe = createHistoricalForecast(
    instrument, candles, warmupBars, timeframe, tradingStyle, requestedInvestorHorizon,
  );
  const probeHorizon = horizon === "investor" ? probe.investor.horizon : probe.trader.horizon;
  const horizonBars = Math.max(1, Math.ceil((probeHorizon.endsAt - probeHorizon.startsAt) / intervalMs));
  const step = horizonBars + 1;
  const observations: ForwardForecastObservation[] = [];

  for (let index = warmupBars; index + horizonBars + 1 < candles.length; index += step) {
    const baselineLookback = horizon === "investor" ? 180 : timeframe === "D1" ? 100 : 100;
    if (index < baselineLookback + 1) continue;
    const priorHistory = candles.slice(index - baselineLookback, index);
    const baselineDirection = momentumDirection(priorHistory);
    const baselineTrainingEndTime = candles[index - 1].timestamp + intervalMs;
    const forecast = createHistoricalForecast(
      instrument, candles, index, timeframe, tradingStyle, requestedInvestorHorizon,
    );
    const selected = horizon === "investor" ? forecast.investor : forecast.trader;
    observations.push({
      id: `${instrument}-${timeframe}-${horizon}-${index}`,
      instrument,
      dataAsOf: candles[index].timestamp + intervalMs,
      horizonEndsAt: selected.horizon.endsAt,
      direction: selected.direction,
      baselineDirection,
      baselineTrainingEndTime,
      baselineMethod: horizon === "investor"
        ? "Prior 180 completed bars: close-to-close momentum sign, computed before forecast candle."
        : `Prior ${baselineLookback} completed bars: close-to-close momentum sign, computed before forecast candle.`,
      objectivePrice: selected.objective?.price,
      invalidationPrice: selected.invalidation?.price,
    });
  }
  return observations;
}

describe("real historical forward forecast outcome evaluation", () => {
  it.skipIf(!enabled)("replays trader and investor structural forecasts on untouched Binance Spot assets and writes provenance reports", async () => {
    const requestedBars = 1_800;
    const now = Date.now();
    const datasets = [];
    for (const symbol of SYMBOLS) {
      for (const interval of ["1h", "1d"] as const) {
        const intervalMs = interval === "1d" ? DAY : 3_600_000;
        const endTime = Math.floor(now / intervalMs) * intervalMs - intervalMs;
        const startTime = endTime - (requestedBars - 1) * intervalMs;
        datasets.push(await fetchHistoricalBinanceSpotOhlcv({
          symbol,
          interval,
          startTime,
          endTime,
        }));
      }
    }

    const reports: Array<Record<string, unknown>> = [];
    const sourceDatasets = datasets.map((dataset) => {
      const canonical = {
        provider: dataset.provider,
        instrumentId: dataset.instrumentId,
        timeframe: dataset.timeframe,
        requestedRange: dataset.requestedRange,
        actualRange: dataset.actualRange,
        retrievedAt: dataset.retrievedAt,
        candleCount: dataset.candleCount,
        gaps: dataset.gaps,
        warnings: dataset.warnings,
        candles: dataset.candles,
      };
      return {
        ...canonical,
        sha256: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
      };
    });
    const sourceSnapshots = sourceDatasets.map((dataset) => ({
      provider: dataset.provider,
      instrument: dataset.instrumentId,
      timeframe: dataset.timeframe,
      requestedRange: dataset.requestedRange,
      actualRange: dataset.actualRange,
      retrievedAt: dataset.retrievedAt,
      candleCount: dataset.candleCount,
      gapCount: dataset.gaps.length,
      warnings: dataset.warnings,
      sha256: dataset.sha256,
    }));

    for (const dataset of datasets) {
      expect(dataset.candleCount).toBeGreaterThanOrEqual(1_500);
      expect(dataset.gaps).toHaveLength(0);
      const timeframe = dataset.timeframe === "1d" ? "D1" : "H1";
      const warmupBars = timeframe === "D1" ? 600 : 300;
      const traderObservations = buildObservations(dataset.instrumentId, dataset.candles, timeframe, "trader", warmupBars);
      expect(traderObservations.length).toBeGreaterThanOrEqual(30);

      const traderCostSensitivity = COST_SCENARIOS.map((costBpsPerSide) => ({
        costBpsPerSide,
        report: evaluateForwardForecastOutcomes(traderObservations, dataset.candles, {
          costBpsPerSide,
          minimumSampleCount: 30,
          enforceNonOverlapping: true,
        }),
      }));
      for (const scenario of traderCostSensitivity) {
        expect(scenario.report.evaluatedCount).toBeGreaterThanOrEqual(30);
        expect(scenario.report.excludedReasons.overlapping_horizon ?? 0).toBe(0);
      }

      const investorHorizonEvaluations = timeframe === "D1"
        ? INVESTOR_HORIZONS.map((horizon) => {
            const observations = buildObservations(
              dataset.instrumentId, dataset.candles, timeframe, "investor", warmupBars, horizon,
            );
            const costSensitivity = COST_SCENARIOS.map((costBpsPerSide) => ({
              costBpsPerSide,
              report: evaluateForwardForecastOutcomes(
                observations,
                dataset.candles,
                { costBpsPerSide, minimumSampleCount: 30, enforceNonOverlapping: true },
              ),
            }));

            // Each sample must be independent at its selected horizon. Short
            // windows can accumulate enough observations; long windows remain
            // explicitly insufficient until more non-overlapping history exists.
            expect(observations.every((observation, index) =>
              index === 0 || observation.dataAsOf > observations[index - 1].horizonEndsAt
            )).toBe(true);
            expect(costSensitivity.every((scenario) =>
              (scenario.report.excludedReasons.overlapping_horizon ?? 0) === 0
            )).toBe(true);
            if (observations.length < 30) {
              expect(costSensitivity.every((scenario) =>
                scenario.report.status === "INSUFFICIENT_SAMPLE"
              )).toBe(true);
            } else {
              expect(costSensitivity.every((scenario) =>
                scenario.report.evaluatedCount >= 30 &&
                scenario.report.status !== "INSUFFICIENT_SAMPLE"
              )).toBe(true);
            }
            return {
              horizon,
              horizonBars: observations[0]
                ? Math.ceil((observations[0].horizonEndsAt - observations[0].dataAsOf) / DAY)
                : undefined,
              observations: observations.length,
              costSensitivity,
            };
          })
        : [];
      if (timeframe === "D1") {
        expect(investorHorizonEvaluations).toHaveLength(INVESTOR_HORIZONS.length);
        expect(investorHorizonEvaluations[0].observations).toBeGreaterThanOrEqual(30);
      }

      reports.push({
        instrument: dataset.instrumentId,
        timeframe,
        provider: dataset.provider,
        actualRange: dataset.actualRange,
        candleCount: dataset.candleCount,
        gapCount: dataset.gaps.length,
        warmupBars,
        oosStart: dataset.candles[warmupBars]?.timestamp,
        oosEnd: dataset.candles[dataset.candles.length - 1]?.timestamp,
        hypothesis: timeframe === "D1"
          ? "Swing trader: EMA20/EMA50 direction; trailing 20-day support/resistance; 20-bar horizon. Investor: HH/HL or LH/LL from two prior 30-bar windows; 90-week swing bounds from aggregated weekly candles; each of the six explicit investment planning horizons is replayed independently."
          : "Intraday trader: EMA20/EMA50 direction; trailing 20-hour support/resistance; 24-bar horizon.",
        baseline: "Rolling prior-only close-to-close momentum sign (100 bars for trader, 180 bars for investor).",
        traderObservations: traderObservations.length,
        traderCostSensitivity,
        investorHorizonEvaluations,
      });
    }

    const report = {
      schemaVersion: 1,
      title: "Trade Intel Bot — Forward Forecast Outcome Evaluation",
      generatedAtIso: new Date().toISOString(),
      provider: "Binance Spot public OHLCV",
      assets: [...SYMBOLS],
      requestedBars,
      warmupAndOOS: "First 300 H1 / 600 D1 bars are warm-up only. No parameter optimization is performed on the OOS windows. All forecast levels are computed from candles available at or before each signal close.",
      costScenariosBpsPerSide: COST_SCENARIOS,
      hypothesisVersion: "ema-structure-forward-v1",
      hypothesisRegisteredAt: "2026-10-31",
      noParameterOptimization: true,
      sourceSnapshots,
      sourceDatasets,
      reports,
      limitations: [
        "This is a pre-registered technical research proxy, not the complete multi-factor production analysis engine.",
        "Investor forecasts are structural only; no fair value, DCF, fundamental target, or calibrated probability is produced.",
        "The prior 100/180-bar momentum baseline is calculated strictly before each signal candle.",
        "Overlapping horizons are excluded; only completed Binance Spot candles are used.",
        "Spot short scenarios are synthetic references, not executable spot shorts; borrow, funding, liquidation, and basis are not modeled.",
        "The 15/20/25 bps-per-side cost scenarios are sensitivity assumptions, not venue-calibrated fills.",
        "Positive outcome evidence is research-only and does not itself authorize production release.",
      ],
    };

    const artifactDir = join(process.env.GITHUB_WORKSPACE ?? process.cwd(), "artifacts");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "forward-forecast-oos-report.json"), JSON.stringify(report, null, 2), "utf8");
    const markdown = [
      "# Forward Forecast Outcome Evaluation",
      "",
      `Generated: ${report.generatedAtIso}`,
      "",
      `Assets: ${SYMBOLS.join(", ")}`,
      "",
      "Costs: 15 / 20 / 25 bps per side. Baselines are prior-only momentum. Overlapping horizons excluded.",
      "",
      ...reports.flatMap((item) => {
        const entry = item as {
          instrument: string;
          timeframe: string;
          traderCostSensitivity: Array<{ costBpsPerSide: number; report: { evaluatedCount: number; directionalAccuracyPct: number | null; baselineAccuracyPct: number | null; accuracyLiftPct: number | null; accuracyLift95Pct: { lowerPct: number; upperPct: number } | null; accuracyLiftBlockBootstrap95Pct: { lowerPct: number; upperPct: number } | null; expectancyR: number | null; expectancyR95: { lower: number; upper: number } | null; expectancyBlockBootstrap95R: { lower: number; upper: number } | null; profitFactor: number | null; status: string } }>;
          investorHorizonEvaluations: Array<{
            horizon: InvestorForecastHorizon;
            horizonBars?: number;
            observations: number;
            costSensitivity: Array<{ costBpsPerSide: number; report: { evaluatedCount: number; directionalAccuracyPct: number | null; baselineAccuracyPct: number | null; accuracyLiftPct: number | null; accuracyLift95Pct: { lowerPct: number; upperPct: number } | null; accuracyLiftBlockBootstrap95Pct: { lowerPct: number; upperPct: number } | null; expectancyR: number | null; expectancyR95: { lower: number; upper: number } | null; expectancyBlockBootstrap95R: { lower: number; upper: number } | null; profitFactor: number | null; status: string } }>;
          }>;
        };
        const lines = [
          `## ${entry.instrument} · ${entry.timeframe}`,
          "",
          "| Horizon | Cost bps/side | N | Accuracy | Baseline | Lift | Lift normal 95% CI | Lift block 95% CI | Expectancy R | Exp. normal 95% CI | Exp. block 95% CI | PF | Status |",
          "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
        ];
        const traderRows = entry.traderCostSensitivity.map((s) => ({ horizon: "Trader", ...s }));
        const investorRows = entry.investorHorizonEvaluations.flatMap((evaluation) =>
          evaluation.costSensitivity.map((s) => ({
            horizon: `Investor ${evaluation.horizon} (N=${evaluation.observations})`,
            ...s,
          }))
        );
        for (const scenario of [...traderRows, ...investorRows]) {
          const r = scenario.report;
          lines.push(`| ${scenario.horizon} | ${scenario.costBpsPerSide} | ${r.evaluatedCount} | ${r.directionalAccuracyPct?.toFixed(1) ?? "n/a"}% | ${r.baselineAccuracyPct?.toFixed(1) ?? "n/a"}% | ${r.accuracyLiftPct?.toFixed(1) ?? "n/a"}pp | ${r.accuracyLift95Pct ? `${r.accuracyLift95Pct.lowerPct.toFixed(1)} to ${r.accuracyLift95Pct.upperPct.toFixed(1)}pp` : "n/a"} | ${r.accuracyLiftBlockBootstrap95Pct ? `${r.accuracyLiftBlockBootstrap95Pct.lowerPct.toFixed(1)} to ${r.accuracyLiftBlockBootstrap95Pct.upperPct.toFixed(1)}pp` : "n/a"} | ${r.expectancyR?.toFixed(2) ?? "n/a"} | ${r.expectancyR95 ? `${r.expectancyR95.lower.toFixed(2)} to ${r.expectancyR95.upper.toFixed(2)}R` : "n/a"} | ${r.expectancyBlockBootstrap95R ? `${r.expectancyBlockBootstrap95R.lower.toFixed(2)} to ${r.expectancyBlockBootstrap95R.upper.toFixed(2)}R` : "n/a"} | ${r.profitFactor?.toFixed(2) ?? "n/a"} | ${r.status} |`);
        }
        lines.push("");
        return lines;
      }),
      "## Limitations",
      "",
      ...report.limitations.map((item) => `- ${item}`),
    ].join("\n");
    await writeFile(join(artifactDir, "forward-forecast-oos-report.md"), markdown, "utf8");

    expect(reports).toHaveLength(6);
    expect(sourceSnapshots.every((snapshot) => snapshot.gapCount === 0 && snapshot.sha256.length === 64)).toBe(true);
  }, 900_000);
});
