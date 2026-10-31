import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fetchHistoricalYahooFinanceOhlcv } from "./historical-yahoo";
import { adaptHistoricalSpotDataset, evaluateMultiAssetWalkForward, type HistoricalEvaluationDataset } from "./walk-forward-evaluation";

const enabled = process.env.RUN_REAL_MULTI_ASSET_YAHOO_EVALUATION === "1";

describe("real multi-asset Yahoo Finance historical walk-forward evaluation", () => {
  it.skipIf(!enabled)("fetches real FX, equity, and commodity candles and writes an auditable cross-asset report", async () => {
    const now = Date.now();
    // A small diversified basket is used to avoid mistaking one ticker's
    // behavior for an asset-class edge. Symbols are explicit and provider
    // fallbacks remain visible in each source snapshot.
    const instruments = [
      { symbol: "EUR/USD", instrumentType: "forex" as const },
      { symbol: "GBP/USD", instrumentType: "forex" as const },
      { symbol: "USD/JPY", instrumentType: "forex" as const },
      { symbol: "AAPL", instrumentType: "stock" as const },
      { symbol: "MSFT", instrumentType: "stock" as const },
      { symbol: "SPY", instrumentType: "stock" as const },
      { symbol: "XAU/USD", instrumentType: "commodity" as const },
      { symbol: "XAG/USD", instrumentType: "commodity" as const },
    ];
    const intervals = ["1h", "1d"] as const;
    // Use most of the provider's usable history so the OOS sample can
    // reach meaningful event counts. The parameters are fixed before replay.
    const evaluationConfig = {
      "1h": { trainingBars: 300, testBars: 80, maxFolds: 17, minimumHistory: 300, maxHoldingBars: 20 },
      "1d": { trainingBars: 600, testBars: 100, maxFolds: 15, minimumHistory: 600, maxHoldingBars: 20 },
    } as const;
    const datasets: HistoricalEvaluationDataset[] = [];
    const sourceSnapshots = [];

    for (const instrument of instruments) {
      for (const interval of intervals) {
        const intervalMs = interval === "1h" ? 60 * 60_000 : 24 * 60 * 60_000;
        const lookbackMs = interval === "1h" ? 365 * 24 * 60 * 60_000 : 3_650 * 24 * 60 * 60_000;
        const endTime = Math.floor(now / intervalMs) * intervalMs - 2 * intervalMs;
        const startTime = endTime - lookbackMs;
        const source = await fetchHistoricalYahooFinanceOhlcv({
          symbol: instrument.symbol,
          instrumentType: instrument.instrumentType,
          interval,
          startTime,
          endTime,
        });
        const config = evaluationConfig[interval];
        const minimumBars = config.trainingBars + config.testBars * config.maxFolds;
        expect(source.candleCount).toBeGreaterThanOrEqual(minimumBars);
        const dataset = adaptHistoricalSpotDataset(source);
        datasets.push(dataset);
        const canonical = {
          provider: source.provider,
          instrumentId: source.instrumentId,
          providerInstrumentId: source.providerInstrumentId,
          instrumentType: source.instrumentType,
          timeframe: source.timeframe,
          timestampAlignment: source.timestampAlignment,
          sessionCalendar: source.sessionCalendar,
          requestedRange: source.requestedRange,
          actualRange: source.actualRange,
          retrievedAt: source.retrievedAt,
          candleCount: source.candleCount,
          gaps: source.gaps,
          warnings: source.warnings,
          candles: source.candles,
        };
        sourceSnapshots.push({
          ...canonical,
          sha256: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"),
        });
      }
    }

    const evaluationGroups = intervals.map((interval) => {
      const config = evaluationConfig[interval];
      const timeframe = interval === "1h" ? "H1" : "D1";
      const intervalDatasets = datasets.filter((dataset) => dataset.timeframe === timeframe);
      expect(intervalDatasets).toHaveLength(instruments.length);
      const costScenarios = [15, 20, 25].map((costBpsPerSide) => ({
        costBpsPerSide,
        report: evaluateMultiAssetWalkForward(intervalDatasets, {
          ...config,
          costBpsPerSide,
        }),
      }));
      return { timeframe, config, costScenarios };
    });
    const providerCoverage = evaluationGroups.flatMap((group) => group.costScenarios[0].report.providerCoverage);
    const totalFolds = evaluationGroups.reduce((sum, group) => sum + group.costScenarios[0].report.folds.length, 0);
    const primary = evaluationGroups[0].costScenarios[0].report;
    expect(providerCoverage).toHaveLength(instruments.length * intervals.length);
    expect(totalFolds).toBeGreaterThanOrEqual(instruments.length * intervals.length);

    const report = {
      title: "Trade Intel Bot — Cross-Asset Historical Walk-forward Research",
      generatedAtIso: new Date(primary.generatedAt).toISOString(),
      provider: "Yahoo Finance public chart history",
      assets: instruments,
      intervals,
      methodology: evaluationGroups[0].costScenarios[0].report.methodology,
      parameters: evaluationGroups.map((group) => ({ timeframe: group.timeframe, ...group.config })),
      sourceSnapshots,
      reports: evaluationGroups.map((group) => ({
        timeframe: group.timeframe,
        parameters: group.config,
        costScenarios: group.costScenarios.map((scenario) => ({
        costBpsPerSide: scenario.costBpsPerSide,
        providerCoverage: scenario.report.providerCoverage,
        byAsset: scenario.report.byAsset,
        byRegime: scenario.report.byRegime,
        folds: scenario.report.folds.map((fold) => ({
          instrument: fold.instrument,
          timeframe: fold.timeframe,
          fold: fold.fold,
          trainingRange: fold.trainingRange,
          testRange: fold.testRange,
          trainingBars: fold.trainingBars,
          testBars: fold.testBars,
          regime: fold.regime,
          metrics: {
            executedTrades: fold.report.executedTrades,
            winRatePct: fold.report.winRatePct,
            expectancyR: fold.report.expectancyR,
            profitFactor: fold.report.profitFactor,
            maxDrawdownR: fold.report.maxDrawdownR,
            totalNetReturnPct: fold.report.totalNetReturnPct,
          },
          warnings: fold.report.warnings,
          trades: fold.report.trades,
        })),
        })),
      })),
      limitations: [
        ...primary.limitations,
        "This is a cross-asset technical research proxy, not the complete multi-factor production analysis engine or a proof of predictive edge.",
        "Yahoo provider-session calendars are unverified; session breaks are preserved and not synthesized, but missing sessions cannot be distinguished from legitimate holidays or provider omissions.",
        "Yahoo volume may be absent/zero for FX and spot metals; volume-dependent evidence must remain unavailable for those series.",
        "Commodity spot/futures fallback is explicitly identified by providerInstrumentId and must not be treated as the same instrument exposure.",
        "Cost assumptions are sensitivity scenarios, not measured historical fills, spread, financing, borrow, or roll costs.",
      ],
    };

    await mkdir("artifacts", { recursive: true });
    await writeFile("artifacts/multiasset-yahoo-historical-report.json", JSON.stringify(report, null, 2), "utf8");
    const fmt = (value: number | null | undefined) =>
      value == null || !Number.isFinite(value) ? "n/a" : value.toFixed(3);
    const markdown = [
      "# Cross-Asset Historical Walk-forward Research",
      "",
      `Generated: ${report.generatedAtIso}`,
      "",
      `Assets: ${instruments.map((item) => `${item.symbol} (${item.instrumentType})`).join(", ")}; H1 (365-day history) and D1 (10-year history).`,
      "",
      "## Provider coverage",
      "",
      "| Instrument | Asset class | Provider ticker | Timeframe | Bars | Session breaks | Warnings |",
      "|---|---|---|---|---:|---:|---|",
      ...providerCoverage.map((item) => `| ${item.instrument} | ${item.instrumentType} | ${item.providerInstrumentId ?? "n/a"} | ${item.timeframe} | ${item.candleCount} | ${item.gaps} | ${item.sourceWarnings.join("; ") || "none"} |`),
      "",
      "## OOS summary by cost assumption",
      "",
      ...evaluationGroups.flatMap((group) => [
        `### ${group.timeframe} · ${group.config.trainingBars} training bars · ${group.config.testBars} test bars · ${group.config.maxFolds} folds`,
        "",
        ...group.costScenarios.flatMap((scenario) => [
          `#### ${scenario.costBpsPerSide} bps per side`,
          "",
          "| Instrument | Folds | Trades | Win rate % | Expectancy R | Profit factor | Max DD R | Evidence |",
          "|---|---:|---:|---:|---:|---:|---:|---|",
          ...scenario.report.byAsset.map((item) => `| ${item.instrument} | ${item.folds} | ${item.trades} | ${fmt(item.winRatePct)} | ${fmt(item.expectancyR)} | ${fmt(item.profitFactor)} | ${fmt(item.maxDrawdownR)} | ${item.uncertainty} |`),
          "",
        ]),
      ]),
      "## Limitations",
      "",
      ...report.limitations.map((item) => `- ${item}`),
      "",
      "**Interpretation:** research-only, descriptive historical results; not a forecast, execution authorization, or proof of profitability.",
      "",
    ].join("\n");
    await writeFile("artifacts/multiasset-yahoo-historical-report.md", markdown, "utf8");
    console.log(markdown);
  }, 900_000);
});
