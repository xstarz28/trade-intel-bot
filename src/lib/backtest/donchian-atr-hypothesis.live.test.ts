import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "@/types/analysis";
import { buildForwardForecast } from "@/lib/forward-forecast";
import { fetchHistoricalBinanceSpotOhlcv } from "./historical-ohlcv";
import {
  evaluateForwardForecastOutcomes,
  type ForwardForecastObservation,
} from "./forward-forecast-evaluation";

const enabled = process.env.RUN_REAL_DONCHIAN_ATR_EVALUATION === "1";
const DAY = 86_400_000;
const HOUR = 3_600_000;
const REQUESTED_BARS = 1_800;
const COST_SCENARIOS = [15, 20, 25] as const;
const SYMBOLS = ["LTCUSDT", "DOGEUSDT", "DOTUSDT"] as const;

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

function atr(candles: Array<{ high: number; low: number; close: number }>, index: number, period: number): number {
  if (index < period) return 0;
  let total = 0;
  for (let cursor = index - period + 1; cursor <= index; cursor += 1) {
    const current = candles[cursor];
    const previousClose = candles[cursor - 1].close;
    total += Math.max(
      current.high - current.low,
      Math.abs(current.high - previousClose),
      Math.abs(current.low - previousClose),
    );
  }
  return total / period;
}

function momentumDirection(history: Array<{ close: number }>): "bullish" | "bearish" | "neutral" {
  if (history.length < 2 || history[0].close <= 0) return "neutral";
  const change = history[history.length - 1].close / history[0].close - 1;
  if (change > 0.001) return "bullish";
  if (change < -0.001) return "bearish";
  return "neutral";
}

function createDonchianForecast(
  instrument: string,
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
  index: number,
  timeframe: "H1" | "D1",
  tradingStyle: "intraday" | "swing",
): ReturnType<typeof buildForwardForecast> {
  const current = candles[index];
  const history = candles.slice(0, index);
  const closes = candles.slice(0, index + 1).map((candle) => candle.close);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const channel = history.slice(-55);
  const channelHigh = maxHigh(channel);
  const channelLow = minLow(channel);
  const volatility = atr(candles, index, 20);
  const longBreakout = channelHigh !== undefined && current.close > channelHigh && ema50 > ema200;
  const shortBreakout = channelLow !== undefined && current.close < channelLow && ema50 < ema200;
  const direction = longBreakout ? "long" : shortBreakout ? "short" : undefined;
  const entry = current.close;
  const stop = direction === "long" ? entry - 2 * volatility : direction === "short" ? entry + 2 * volatility : undefined;
  const target = direction === "long" ? entry + 3 * volatility : direction === "short" ? entry - 3 * volatility : undefined;
  const intervalMs = timeframe === "D1" ? DAY : HOUR;
  const dataAsOf = current.timestamp + intervalMs;
  const prior20 = history.slice(-20);
  const support = minLow(prior20);
  const resistance = maxHigh(prior20);
  const bias: AnalysisResult["bias"] = direction === "long" ? "Bullish" : direction === "short" ? "Bearish" : "Neutral";

  const result = {
    id: `donchian-atr-${instrument}-${timeframe}-${index}`,
    instrument,
    instrumentType: "crypto",
    timeframe,
    bias,
    confidence: 50,
    recommendation: "NO_TRADE",
    noTradeReasons: ["Pre-registered research hypothesis; projected setup is not executable."],
    tradingStyle,
    technicalSummary: "Donchian 55-bar breakout with EMA50/EMA200 trend filter and ATR20 risk geometry.",
    fundamentalSummary: "Not used by this technical research hypothesis.",
    breakdown: { trend: 1, indicator: 1, fundamental: 0, sentiment: 0 },
    keyLevels: {
      support: support?.toString() ?? "N/A",
      resistance: resistance?.toString() ?? "N/A",
      invalidation: "N/A",
    },
    projectedTradePlan: direction && stop && target ? {
      direction,
      entry: entry.toString(),
      entryBasis: "Completed-candle 55-bar Donchian breakout; enter at next candle open in replay.",
      stopLoss: stop.toString(),
      slBasis: "2 × ATR(20) volatility invalidation from signal close.",
      takeProfit: target.toString(),
      tpBasis: "3 × ATR(20) volatility objective from signal close.",
      riskReward: 1.5,
    } : undefined,
    riskNote: "Research-only. Projected plan remains conditional and never grants order authority.",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: dataAsOf,
    priceSnapshot: {
      price: current.close,
      timestamp: dataAsOf,
      source: "binance-spot-historical-replay",
    },
  } as unknown as AnalysisResult;
  return buildForwardForecast(result);
}

function buildDonchianObservations(
  instrument: string,
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>,
  timeframe: "H1" | "D1",
  warmupBars: number,
): { observations: ForwardForecastObservation[]; signalCount: number } {
  const intervalMs = timeframe === "D1" ? DAY : HOUR;
  const horizonBars = timeframe === "D1" ? 20 : 24;
  const step = horizonBars + 1;
  const tradingStyle = timeframe === "D1" ? "swing" : "intraday";
  const observations: ForwardForecastObservation[] = [];
  let signalCount = 0;

  for (let index = warmupBars; index + horizonBars + 1 < candles.length; index += step) {
    const baselineHistory = candles.slice(index - 100, index);
    if (baselineHistory.length < 100) continue;
    const baselineDirection = momentumDirection(baselineHistory);
    const baselineTrainingEndTime = candles[index - 1].timestamp + intervalMs;
    const forecast = createDonchianForecast(instrument, candles, index, timeframe, tradingStyle);
    const selected = forecast.trader;
    if (selected.direction !== "neutral") signalCount += 1;
    observations.push({
      id: `${instrument}-${timeframe}-donchian-atr-${index}`,
      instrument,
      dataAsOf: candles[index].timestamp + intervalMs,
      horizonEndsAt: selected.horizon.endsAt,
      direction: selected.direction,
      baselineDirection,
      baselineTrainingEndTime,
      baselineMethod: "Prior 100 completed bars: close-to-close momentum sign, computed before forecast candle.",
      objectivePrice: selected.objective?.price,
      invalidationPrice: selected.invalidation?.price,
    });
  }
  return { observations, signalCount };
}

describe("real Donchian + ATR forward forecast OOS evaluation", () => {
  it.skipIf(!enabled)("evaluates a pre-registered breakout hypothesis on untouched assets and archives source provenance", async () => {
    const datasets = [];
    for (const symbol of SYMBOLS) {
      for (const interval of ["1h", "1d"] as const) {
        const intervalMs = interval === "1d" ? DAY : HOUR;
        const endTime = Math.floor(Date.now() / intervalMs) * intervalMs - intervalMs;
        const startTime = endTime - (REQUESTED_BARS - 1) * intervalMs;
        datasets.push(await fetchHistoricalBinanceSpotOhlcv({
          symbol,
          interval,
          startTime,
          endTime,
        }));
      }
    }

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

    const reports: Array<Record<string, unknown>> = [];
    for (const dataset of datasets) {
      expect(dataset.candleCount).toBeGreaterThanOrEqual(1_500);
      expect(dataset.gaps).toHaveLength(0);
      const timeframe = dataset.timeframe === "1d" ? "D1" : "H1";
      const warmupBars = timeframe === "D1" ? 600 : 300;
      const { observations, signalCount } = buildDonchianObservations(
        dataset.instrumentId,
        dataset.candles,
        timeframe,
        warmupBars,
      );
      expect(observations.length).toBeGreaterThanOrEqual(30);

      const signalObservations = observations.filter((observation) => observation.direction !== "neutral");
      const costSensitivity = signalObservations.length > 0
        ? COST_SCENARIOS.map((costBpsPerSide) => ({
            costBpsPerSide,
            report: evaluateForwardForecastOutcomes(signalObservations, dataset.candles, {
              costBpsPerSide,
              minimumSampleCount: 30,
              enforceNonOverlapping: true,
            }),
          }))
        : [];
      for (const scenario of costSensitivity) {
        expect(scenario.report.evaluatedCount).toBe(signalObservations.length);
        expect(scenario.report.excludedReasons.overlapping_horizon ?? 0).toBe(0);
        if (signalObservations.length < 30) expect(scenario.report.status).toBe("INSUFFICIENT_SAMPLE");
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
        hypothesis: "Donchian 55-bar breakout with EMA50/EMA200 trend filter; stop 2 × ATR20; objective 3 × ATR20; next-open entry; 20 D1 / 24 H1 bar horizon.",
        baseline: "Prior 100 completed bars: close-to-close momentum sign.",
        opportunityCount: observations.length,
        signalCount,
        signalCoveragePct: observations.length ? signalCount / observations.length * 100 : 0,
        nominalRiskReward: 1.5,
        evaluationPopulation: "Signal-only: neutral/no-trade windows are excluded from directional accuracy and baseline comparison; coverage is reported separately.",
        costSensitivity,
      });
    }

    const report = {
      schemaVersion: 1,
      title: "Trade Intel Bot — Donchian + ATR Forward Hypothesis OOS Evaluation",
      generatedAtIso: new Date().toISOString(),
      provider: "Binance Spot public OHLCV",
      assets: [...SYMBOLS],
      requestedBars: REQUESTED_BARS,
      hypothesisVersion: "donchian55-ema50-ema200-atr20-v1",
      hypothesisRegisteredAt: "2026-10-31",
      noParameterOptimization: true,
      warmupAndOOS: "First 300 H1 / 600 D1 bars are warm-up only. Parameters are fixed and no optimization is performed on OOS windows. All signals use candle prefixes ending at the forecast timestamp.",
      costScenariosBpsPerSide: COST_SCENARIOS,
      sourceSnapshots,
      sourceDatasets,
      reports,
      limitations: [
        "This is a fixed technical research hypothesis, not a calibrated probabilistic model.",
        "The 2 ATR stop and 3 ATR objective are volatility-derived rule levels, not fair value or guaranteed targets.",
        "The prior 100-bar momentum baseline is computed strictly before each signal candle.",
        "Overlapping horizons are excluded and incomplete horizons are right-censored.",
        "Costs are 15/20/25 bps per side sensitivity assumptions, not venue-calibrated realized fills.",
        "Short-side trades are synthetic spot-reference exposures; borrow, funding, margin, liquidation, and basis are not modeled.",
        "Positive outcome evidence remains research-only and does not authorize production release.",
      ],
    };

    const artifactDir = join(process.env.GITHUB_WORKSPACE ?? process.cwd(), "artifacts");
    await mkdir(artifactDir, { recursive: true });
    await writeFile(join(artifactDir, "donchian-atr-oos-report.json"), JSON.stringify(report, null, 2), "utf8");
    const markdown = [
      "# Donchian + ATR Forward Hypothesis OOS Evaluation",
      "",
      `Generated: ${report.generatedAtIso}`,
      "",
      `Assets: ${SYMBOLS.join(", ")}`,
      "",
      "Hypothesis: Donchian55 breakout + EMA50/EMA200 filter, stop 2×ATR20, target 3×ATR20. Baseline: prior-only 100-bar momentum.",
      "",
      ...reports.flatMap((item) => {
        const entry = item as {
          instrument: string;
          timeframe: string;
          opportunityCount: number;
          signalCount: number;
          signalCoveragePct: number;
          costSensitivity: Array<{ costBpsPerSide: number; report: { evaluatedCount: number; directionalAccuracyPct: number | null; baselineAccuracyPct: number | null; accuracyLiftPct: number | null; accuracyLift95Pct: { lowerPct: number; upperPct: number } | null; expectancyR: number | null; expectancyR95: { lower: number; upper: number } | null; profitFactor: number | null; status: string } }>;
        };
        const lines = [
          `## ${entry.instrument} · ${entry.timeframe}`,
          `Opportunities: ${entry.opportunityCount} · active signals: ${entry.signalCount} · coverage: ${entry.signalCoveragePct.toFixed(1)}%`,
          "",
          "| Cost bps/side | Signal N | Accuracy | Baseline | Lift | Lift 95% CI | Expectancy R | Exp. 95% CI | PF | Status |",
          "|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
        ];
        for (const scenario of entry.costSensitivity) {
          const r = scenario.report;
          lines.push(`| ${scenario.costBpsPerSide} | ${r.evaluatedCount} | ${r.directionalAccuracyPct?.toFixed(1) ?? "n/a"}% | ${r.baselineAccuracyPct?.toFixed(1) ?? "n/a"}% | ${r.accuracyLiftPct?.toFixed(1) ?? "n/a"}pp | ${r.accuracyLift95Pct ? `${r.accuracyLift95Pct.lowerPct.toFixed(1)} to ${r.accuracyLift95Pct.upperPct.toFixed(1)}pp` : "n/a"} | ${r.expectancyR?.toFixed(2) ?? "n/a"} | ${r.expectancyR95 ? `${r.expectancyR95.lower.toFixed(2)} to ${r.expectancyR95.upper.toFixed(2)}R` : "n/a"} | ${r.profitFactor?.toFixed(2) ?? "n/a"} | ${r.status} |`);
        }
        lines.push("");
        return lines;
      }),
      "## Limitations",
      "",
      ...report.limitations.map((item) => `- ${item}`),
    ].join("\n");
    await writeFile(join(artifactDir, "donchian-atr-oos-report.md"), markdown, "utf8");

    expect(reports).toHaveLength(6);
    expect(sourceSnapshots.every((snapshot) => snapshot.gapCount === 0 && snapshot.sha256.length === 64)).toBe(true);
  }, 900_000);
});
