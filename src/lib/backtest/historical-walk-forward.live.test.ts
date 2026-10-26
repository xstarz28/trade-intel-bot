import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchHistoricalBinanceSpotOhlcv } from "@/lib/backtest/historical-ohlcv";
import {
  adaptHistoricalSpotDataset,
  evaluateMultiAssetWalkForward,
} from "@/lib/backtest/walk-forward-evaluation";

const enabled = process.env.RUN_REAL_HISTORICAL_EVALUATION === "1";

function categorizeNoTradeReason(reason: string): string {
  if (reason.includes("Price snapshot is older than")) return "Replay freshness gate failure";
  if (reason.includes("Core bias is Neutral")) return "Core bias neutral: structural/fundamental/positioning agreement missing";
  if (reason.startsWith("Plan rejected: the latest confirmed market close")) return "Projected plan invalidated: close crossed target or stop";
  if (reason.startsWith("Confluence too weak")) return "Confluence below minimum";
  if (reason.startsWith("Structural agreement required")) return "Structural veto: external structure does not support bias";
  if (reason.startsWith("No opposing structural level")) return "No opposing structural target available";
  if (reason.startsWith("Projected R:R")) return "Projected R:R below 1.5";
  return reason;
}

describe("real historical Binance Spot walk-forward evaluation", () => {
  it.skipIf(!enabled)("downloads real closed OHLCV and writes an auditable multi-asset report with cost sensitivity", async () => {
    const intervalMs = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const endTime = Math.floor(now / intervalMs) * intervalMs - intervalMs;
    const trainingBars = 300;
    const testBars = 250;
    const maxFolds = 6;
    const requestedBars = trainingBars + testBars * maxFolds;
    const startTime = endTime - (requestedBars - 1) * intervalMs;
    const symbols = ["BTCUSDT", "ETHUSDT", "SOLUSDT"] as const;
    const requests = symbols.map((symbol) => ({
      symbol,
      interval: "1d" as const,
      startTime,
      endTime,
    }));

    const sourceDatasets = [];
    for (const request of requests) {
      sourceDatasets.push(await fetchHistoricalBinanceSpotOhlcv(request));
    }
    const datasets = sourceDatasets.map((dataset) => adaptHistoricalSpotDataset(dataset));
    for (const dataset of datasets) {
      expect(dataset.candleCount).toBeGreaterThanOrEqual(trainingBars + testBars);
      expect(dataset.gaps).toHaveLength(0);
    }

    const sourceSnapshot = {
      title: "Trade Intel Bot — Reproducible historical OHLCV source snapshot",
      capturedAtIso: new Date().toISOString(),
      provider: "Binance Spot public OHLCV",
      datasets: sourceDatasets.map((dataset) => {
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
      }),
    };
    const sourceSnapshotSha256 = createHash("sha256")
      .update(JSON.stringify(sourceSnapshot))
      .digest("hex");

    const costScenarios = [
      { feeBpsPerSide: 10, spreadBpsPerSide: 2, slippageBpsPerSide: 3 },
      { feeBpsPerSide: 10, spreadBpsPerSide: 2, slippageBpsPerSide: 8 },
      { feeBpsPerSide: 10, spreadBpsPerSide: 2, slippageBpsPerSide: 13 },
    ].map((costModel) => {
      const costBpsPerSide = costModel.feeBpsPerSide + costModel.spreadBpsPerSide + costModel.slippageBpsPerSide;
      return {
        ...costModel,
        costBpsPerSide,
        report: evaluateMultiAssetWalkForward(datasets, {
          trainingBars,
          testBars,
          maxFolds,
          minimumHistory: 220,
          maxHoldingBars: 20,
          costBpsPerSide,
        }),
      };
    });
    const report = costScenarios[0].report;

    expect(report.providerCoverage).toHaveLength(symbols.length);
    expect(report.folds.length).toBeGreaterThanOrEqual(symbols.length);
    for (const coverage of report.providerCoverage) {
      expect(coverage.candleCount).toBeGreaterThanOrEqual(trainingBars + testBars);
      expect(coverage.gaps).toBe(0);
    }

    const noTradeReasonCounts = new Map<string, number>();
    for (const fold of report.folds) {
      for (const item of fold.report.noTradeReasonCounts ?? []) {
        const category = categorizeNoTradeReason(item.reason);
        noTradeReasonCounts.set(category, (noTradeReasonCounts.get(category) ?? 0) + item.count);
      }
    }
    const noTradeDiagnostics = [...noTradeReasonCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
    expect(noTradeDiagnostics.some((item) => item.reason === "Replay freshness gate failure")).toBe(false);

    const sensitivity = costScenarios.map(({ costBpsPerSide, feeBpsPerSide, spreadBpsPerSide, slippageBpsPerSide, report: scenarioReport }) => ({
      costBpsPerSide,
      feeBpsPerSide,
      spreadBpsPerSide,
      slippageBpsPerSide,
      byAsset: scenarioReport.byAsset,
      byRegime: scenarioReport.byRegime,
      foldCount: scenarioReport.folds.length,
      tradeCount: scenarioReport.folds.reduce((sum, fold) => sum + fold.report.executedTrades, 0),
    }));
    const summary = {
      title: "Trade Intel Bot — Real Historical Walk-forward Evaluation",
      generatedAtIso: new Date(report.generatedAt).toISOString(),
      sourceSnapshotFile: "historical-ohlcv-snapshot.json",
      sourceSnapshotSha256,
      methodology: report.methodology,
      parameters: {
        provider: "Binance Spot public OHLCV",
        timeframe: "1d",
        symbols,
        requestedBars,
        trainingBars,
        testBars,
        maxFolds,
        costModel: {
          feeBpsPerSide: 10,
          spreadBpsPerSide: 2,
          slippageBpsPerSide: [3, 8, 13],
          totalBpsPerSide: [15, 20, 25],
          note: "Explicit assumptions, not measured historical bid/ask spread; actual account fee tier and realized slippage must be verified.",
        },
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
      noTradeDiagnostics,
      sensitivity,
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
        noTradeReasonCounts: fold.report.noTradeReasonCounts ?? [],
        warnings: fold.report.warnings,
        trades: fold.report.trades,
      })),
      limitations: report.limitations,
      interpretation: "Historical, descriptive evidence only. This report is not a forecast or a guarantee of future profitability. Cost sensitivity uses explicit 15, 20 and 25 bps per-side assumptions; real venue fee, spread and fill assumptions still require validation.",
    };

    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/historical-ohlcv-snapshot.json", JSON.stringify(sourceSnapshot, null, 2), "utf8");
    await writeFile("artifacts/historical-walk-forward-report.json", JSON.stringify(summary, null, 2), "utf8");
    const fmt = (value: number | null | undefined, digits = 2) =>
      value == null || !Number.isFinite(value) ? "n/a" : value.toFixed(digits);
    const markdown = [
      "# Trade Intel Bot — Real Historical Walk-forward Evaluation",
      "",
      `Generated: ${summary.generatedAtIso}`,
      `Source snapshot: ${summary.sourceSnapshotFile} (SHA-256 ${summary.sourceSnapshotSha256})`,
      "",
      "## Method",
      "",
      "- Source: Binance Spot public OHLCV; completed daily candles only.",
      "- Assets: BTCUSDT, ETHUSDT, SOLUSDT.",
      "- Walk-forward: expanding anchored training, six consecutive 250-bar out-of-sample folds per asset (subject to available source data).",
      "- Execution model: signal after candle close, entry at next candle open, stop-first when stop and target touch the same OHLC bar.",
      "- Cost model per side: 10 bps fee assumption + 2 bps half-spread assumption + 3/8/13 bps slippage stress assumptions = 15/20/25 bps total per side. Spread and slippage are explicit assumptions, not reconstructed historical quotes; verify actual account fee tier and fills.",
      "- Funding/borrow is not applicable to this Binance Spot test; results must not be generalized to perpetuals, margin, or borrowed shorts.",
      "- Same-bar stop/target collisions are stop-first; stops crossed at a bar open use the worse open fill (adverse gap handling).",
      "",
      "## Data coverage",
      "",
      "| Asset | Bars | Actual start (UTC) | Actual end (UTC) | Gaps | Source warnings |",
      "|---|---:|---|---|---:|---|",
      ...summary.coverage.map((item) => `| ${item.instrument} | ${item.candleCount} | ${item.actualRange?.start ?? "n/a"} | ${item.actualRange?.end ?? "n/a"} | ${item.gaps} | ${item.warnings.join("; ") || "none"} |`),
      "",
      "## Out-of-sample results by asset (15 bps per side: 10 fee + 2 spread + 3 slippage)",
      "",
      "| Asset | Folds | Trades | Win rate % | Expectancy (R) | Profit factor | Max drawdown (R) | Full-notional trade-return compound %* | 1% risk-budget return % | 1% risk-budget max DD % | Exposure % | Trades / 1k bars | Evidence label |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|",
      ...summary.byAsset.map((item) => `| ${item.instrument} | ${item.folds} | ${item.trades} | ${fmt(item.winRatePct)} | ${fmt(item.expectancyR, 3)} | ${fmt(item.profitFactor, 3)} | ${fmt(item.maxDrawdownR, 2)} | ${fmt(item.totalNetReturnPct)} | ${fmt(item.riskBudgetReturnPct)} | ${fmt(item.riskBudgetMaxDrawdownPct)} | ${fmt(item.exposurePct)} | ${fmt(item.turnoverTradesPer1000Bars)} | ${item.uncertainty} |`),
      "",
      "*Full-notional compounding is trade-return compounding, not an account equity curve. The 1% risk-budget return assumes 1% of current equity at risk per trade and does not model concurrent cross-asset positions or portfolio allocation.*",
      "",
      "## Transaction-cost sensitivity by asset",
      "",
      "| Fee bps | Spread bps | Slippage bps | Total bps/side | Asset | Trades | Win rate % | Expectancy (R) | Profit factor | Max drawdown (R) | Full-notional compound %* | 1% risk-budget return % | 1% risk-budget max DD % | Evidence label |",
      "|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|",
      ...summary.sensitivity.flatMap((scenario) => scenario.byAsset.map((item) =>
        `| ${scenario.feeBpsPerSide} | ${scenario.spreadBpsPerSide} | ${scenario.slippageBpsPerSide} | ${scenario.costBpsPerSide} | ${item.instrument} | ${item.trades} | ${fmt(item.winRatePct)} | ${fmt(item.expectancyR, 3)} | ${fmt(item.profitFactor, 3)} | ${fmt(item.maxDrawdownR, 2)} | ${fmt(item.totalNetReturnPct)} | ${fmt(item.riskBudgetReturnPct)} | ${fmt(item.riskBudgetMaxDrawdownPct)} | ${item.uncertainty} |`)),
      "",
      "## Why the engine declined entries (5 bps per side)",
      "",
      "| Rejection reason | Count |",
      "|---|---:|",
      ...summary.noTradeDiagnostics.map((item) => `| ${item.reason.replace(/\|/g, "/")} | ${item.count} |`),
      "",
      "## Out-of-sample results by training-window regime (5 bps per side)",
      "",
      "| Regime | Folds | Trades | Win rate % | Expectancy (R) | Profit factor | Max drawdown (R) | Net compounded return % | Evidence label |",
      "|---|---:|---:|---:|---:|---:|---:|---:|---|",
      ...summary.byRegime.map((item) => `| ${item.regime} | ${item.folds} | ${item.trades} | ${fmt(item.winRatePct)} | ${fmt(item.expectancyR, 3)} | ${fmt(item.profitFactor, 3)} | ${fmt(item.maxDrawdownR, 2)} | ${fmt(item.totalNetReturnPct)} | ${item.uncertainty} |`),
      "",
      "## Limitations",
      "",
      ...report.limitations.map((item) => `- ${item}`),
      "",
      "**Interpretation:** Historical descriptive evidence only; not a forecast or proof of future profitability. Costs are stress-tested at three assumptions, but venue-specific fees, spread, and actual fills still require validation.",
      "",
    ].join("\n");
    await writeFile("artifacts/historical-walk-forward-report.md", markdown, "utf8");
    console.log(markdown);
  }, 900_000);
});
