import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { fetchHistoricalBinanceSpotOhlcv } from "@/lib/backtest/historical-ohlcv";
import { runHistoricalWalkForwardEvaluation } from "@/lib/backtest/walk-forward-evaluation";

const enabled = process.env.RUN_REAL_HISTORICAL_EVALUATION === "1";

describe("real historical Binance Spot walk-forward evaluation", () => {
  it.skipIf(!enabled)("downloads real closed OHLCV and writes an auditable multi-asset report", async () => {
    const intervalMs = 4 * 60 * 60 * 1000;
    const now = Date.now();
    const endTime = Math.floor(now / intervalMs) * intervalMs - intervalMs;
    const trainingBars = 600;
    const testBars = 600;
    const maxFolds = 6;
    const requestedBars = trainingBars + testBars * maxFolds;
    const startTime = endTime - (requestedBars - 1) * intervalMs;
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
    const requests = symbols.map((symbol) => ({
      symbol,
      interval: "4h" as const,
      startTime,
      endTime,
    }));

    const report = await runHistoricalWalkForwardEvaluation(
      requests,
      async (request) => fetchHistoricalBinanceSpotOhlcv(request),
      {
        trainingBars,
        testBars,
        maxFolds,
        minimumHistory: 220,
        maxHoldingBars: 20,
        costBpsPerSide: 5,
      },
    );

    expect(report.providerCoverage).toHaveLength(symbols.length);
    expect(report.folds.length).toBeGreaterThanOrEqual(symbols.length);
    for (const coverage of report.providerCoverage) {
      expect(coverage.candleCount).toBeGreaterThanOrEqual(trainingBars + testBars);
      expect(coverage.gaps).toBe(0);
    }

    const summary = {
      title: "Trade Intel Bot — Real Historical Walk-forward Evaluation",
      generatedAtIso: new Date(report.generatedAt).toISOString(),
      methodology: report.methodology,
      parameters: {
        provider: "Binance Spot public OHLCV",
        timeframe: "4h",
        symbols,
        requestedBars,
        trainingBars,
        testBars,
        maxFolds,
        costBpsPerSide: 5,
        maxHoldingBars: 20,
        execution: "signal at completed candle close; next candle open entry; conservative stop-first same-bar ordering",
      },
      coverage: report.providerCoverage.map((item) => ({
        provider: item.provider,
        instrument: item.instrument,
        timeframe: item.timeframe,
        requestedRange: {
          start: new Date(item.requestedRange.startTime).toISOString(),
          end: new Date(item.requestedRange.endTime).toISOString(),
        },
        actualRange: item.actualRange ? {
          start: new Date(item.actualRange.startTime).toISOString(),
          end: new Date(item.actualRange.endTime).toISOString(),
        } : null,
        retrievedAt: new Date(item.retrievedAt).toISOString(),
        candleCount: item.candleCount,
        gaps: item.gaps,
        warnings: item.sourceWarnings,
      })),
      byAsset: report.byAsset,
      byRegime: report.byRegime,
      folds: report.folds.map((fold) => ({
        instrument: fold.instrument,
        timeframe: fold.timeframe,
        fold: fold.fold,
        trainingBars: fold.trainingBars,
        testBars: fold.testBars,
        trainingRange: {
          start: new Date(fold.trainingRange.startTime).toISOString(),
          end: new Date(fold.trainingRange.endTime).toISOString(),
        },
        testRange: {
          start: new Date(fold.testRange.startTime).toISOString(),
          end: new Date(fold.testRange.endTime).toISOString(),
        },
        regime: fold.regime,
        exposurePct: fold.exposurePct,
        turnoverTradesPer1000Bars: fold.turnoverTradesPer1000Bars,
        metrics: {
          executedTrades: fold.report.executedTrades,
          signalsChecked: fold.report.signalsChecked,
          noTradeSignals: fold.report.noTradeSignals,
          rejectedPlans: fold.report.rejectedPlans,
          wins: fold.report.wins,
          losses: fold.report.losses,
          winRatePct: fold.report.winRatePct,
          expectancyR: fold.report.expectancyR,
          profitFactor: fold.report.profitFactor,
          maxDrawdownR: fold.report.maxDrawdownR,
          totalNetReturnPct: fold.report.totalNetReturnPct,
          averageNetReturnPct: fold.report.averageNetReturnPct,
        },
        warnings: fold.report.warnings,
        trades: fold.report.trades,
      })),
      limitations: report.limitations,
      interpretation: "Historical, descriptive evidence only. This report is not a forecast or a guarantee of future profitability. Validate strategy stability and execution assumptions before any release decision.",
    };

    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/historical-walk-forward-report.json", JSON.stringify(summary, null, 2), "utf8");
    const fmt = (value: number | null | undefined, digits = 2) =>
      value == null || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
    const markdown = [
      "# Trade Intel Bot — Real Historical Walk-forward Evaluation",
      "",
      `Generated: ${summary.generatedAtIso}`,
      "",
      "## Method",
      "",
      "- Source: Binance Spot public OHLCV; completed 4-hour candles only.",
      "- Assets: BTCUSDT, ETHUSDT, SOLUSDT.",
      "- Walk-forward: expanding anchored training, six consecutive 600-bar out-of-sample folds per asset (subject to available source data).",
      "- Execution model: signal after candle close, entry at next candle open, stop-first when stop and target touch the same OHLC bar.",
      "- Cost assumption: 5 basis points per side (fee + slippage combined); sensitivity to other cost levels is not tested in this run.",
      "",
      "## Data coverage",
      "",
      "| Asset | Bars | Actual start (UTC) | Actual end (UTC) | Gaps | Source warnings |",
      "|---|---:|---|---|---:|---|",
      ...summary.coverage.map((item) => `| ${item.instrument} | ${item.candleCount} | ${item.actualRange?.start ?? "n/a"} | ${item.actualRange?.end ?? "n/a"} | ${item.gaps} | ${item.warnings.join("; ") || "none"} |`),
      "",
      "## Out-of-sample results by asset",
      "",
      "| Asset | Folds | Trades | Win rate % | Expectancy (R) | Profit factor | Max drawdown (R) | Net compounded return % | Exposure % | Trades / 1k bars | Evidence label |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
      ...summary.byAsset.map((item) => `| ${item.instrument} | ${item.folds} | ${item.trades} | ${fmt(item.winRatePct)} | ${fmt(item.expectancyR, 3)} | ${fmt(item.profitFactor, 3)} | ${fmt(item.maxDrawdownR, 2)} | ${fmt(item.totalNetReturnPct)} | ${fmt(item.exposurePct)} | ${fmt(item.turnoverTradesPer1000Bars)} | ${item.uncertainty} |`),
      "",
      "## Out-of-sample results by training-window regime",
      "",
      "| Regime | Folds | Trades | Win rate % | Expectancy (R) | Profit factor | Max drawdown (R) | Net compounded return % | Evidence label |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---|",
      ...summary.byRegime.map((item) => `| ${item.regime} | ${item.folds} | ${item.trades} | ${fmt(item.winRatePct)} | ${fmt(item.expectancyR, 3)} | ${fmt(item.profitFactor, 3)} | ${fmt(item.maxDrawdownR, 2)} | ${fmt(item.totalNetReturnPct)} | ${item.uncertainty} |`),
      "",
      "## Limitations",
      "",
      ...report.limitations.map((item) => `- ${item}`),
      "",
      "**Interpretation:** Historical descriptive evidence only; not a forecast or proof of future profitability. The cost assumption has not been sensitivity-tested in this run.",
      "",
    ].join("\n");
    await writeFile("artifacts/historical-walk-forward-report.md", markdown, "utf8");
    console.log(markdown);
  }, 900_000);
});
