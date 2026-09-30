/**
 * Phase 294 — CAPTURE → BENCHMARK → WALK-FORWARD PIPELINE SUITE.
 *
 * Covers §4 (capture runner), §6 (deterministic selection), §8 (Phase 293
 * integration), §9 (coverage diagnostics), §12 (no-lookahead on real recorded
 * series), §13 (the recorded OKX material is retained), §14 (recorded vs
 * designed separation inside a run), §15 (Phase 293 semantics untouched) and
 * §16 (bounded work).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import {
  CALIBRATION_MIN_RESOLVED,
  DEFAULT_MAX_EVALUATIONS,
  DEFAULT_MAX_FUTURE_CANDLES,
  MIN_RESOLVED_FOR_AGGREGATE,
  formatValidationDiagnostics,
  type OutcomeCandle,
  toEmpiricalValidationFields,
} from "@/lib/outcome-validation";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

import { DEFAULT_CAPTURE_MAX_ROWS, captureDataset, type CapturePage, type CaptureSpec } from "@/lib/historical/capture";
import {
  HISTORICAL_SCHEMA_VERSION,
  parseCandleRows,
  type HistoricalRow,
  type ParsedDataset,
} from "@/lib/historical/dataset";
import { loadRecordedFixture, loadRecordedFixtureFile, loadRecordedFixtures } from "@/lib/historical/fixtures";
import {
  buildCoverageReport,
  formatBenchmarkSelection,
  formatCoverageReport,
  selectBenchmark,
  summarizeRun,
} from "@/lib/historical/benchmark";
import {
  benchmarkFingerprint,
  closedOutcomeCandles,
  decisiveProjection,
  runRecordedBenchmark,
} from "@/lib/historical/recorded-walkforward";

// One observation instant for every run in this suite: the engine's freshness
// gate is a wall-clock rule, so a historical replay presents itself "as of now"
// (one constant shift per window) and the recorded instants travel alongside.
const NOW = Date.now();
const ALIGNMENT = {
  mode: "WALL_CLOCK_ALIGNED" as const,
  nowMs: NOW,
  note: "Recorded provider candles presented at the observation instant for the live-transport freshness gate; each decision keeps its own provider instant.",
};

const fixtures = loadRecordedFixtures();

function techFor(candles: readonly OutcomeCandle[], timeframe: string): TechnicalData {
  const c = candles as unknown as OhlcvCandle[];
  return {
    ...calculateTechnical(c, c, timeframe),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc: computeSmcContext(c, timeframe),
    mtf: buildMtfContext(timeframe, [
      { timeframe, role: "setup", candles: c },
      ...buildChain(timeframe).map((t) => ({ timeframe: t.timeframe, role: t.role, candles: c } satisfies MtfCandleInput)),
    ]),
  };
}

/**
 * Prefix → production input, carrying the DATASET's real provider identity.
 * A designed fixture may describe its own designed context (instrument class and
 * a designed news line); recorded datasets take everything from their capture.
 */
function inputBuilder(parsed: ParsedDataset, designedContext?: { instrumentType: "forex" | "crypto" | "stock"; economicEvents: string }) {
  const meta = parsed.provenance;
  const instrumentType = designedContext?.instrumentType ?? (meta.assetClass as "crypto" | "forex" | "stock");
  const economicEvents = designedContext?.economicEvents ?? "";
  return (prefix: readonly OutcomeCandle[], _index: number): AnalysisInput => {
    const candles = prefix as unknown as OhlcvCandle[];
    const last = candles[candles.length - 1];
    return {
      instrument: meta.instrument,
      instrumentType,
      timeframe: meta.timeframe as Timeframe,
      provider: meta.provider,
      providerInstrumentId: meta.providerInstrumentId,
      marketData: {
        instrument: meta.instrument,
        instrumentType,
        provider: meta.provider,
        providerInstrumentId: meta.providerInstrumentId,
        fetchTimestamp: last.timestamp,
        price: { price: last.close, timestamp: last.timestamp, source: meta.provider },
        candles,
        timeframe: meta.timeframe,
        dataFreshness: "delayed",
      } as unknown as MarketData,
      technicalData: techFor(prefix, meta.timeframe),
      economicEvents,
    } as unknown as AnalysisInput;
  };
}

const RUN_OPTIONS = { alignment: ALIGNMENT, minPrefixCandles: 24, maxEvaluations: 10, maxFutureCandles: 10 };
/** 10 windows per dataset: 8 datasets × 10 = 80 recorded windows. */
const WINDOWS_PER_DATASET = 10;

function rowsOf(file: string): HistoricalRow[] {
  return loadRecordedFixtureFile(file).rows;
}

// ────────────────────────────────────────────────────────────────
describe("§4 capture runner", () => {
  const okxShape = {
    providerRowShape: "okx-candles-v5-array",
    providerFieldOrder: ["timestamp", "open", "high", "low", "close", "volume", "volumeCcy", "volumeCcyQuote", "confirm"],
    providerBarLabel: "4H",
  };

  function spec(overrides: Partial<CaptureSpec> = {}): CaptureSpec {
    return {
      datasetId: "capture-probe",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      instrument: "BTC/USDT",
      assetClass: "crypto",
      timeframe: "H4",
      rowOrder: "provider (newest first)",
      firstUrl: "https://provider.test/page1",
      nextUrl: (cursor) => `https://provider.test/page?after=${cursor}`,
      captureMethod: "simulated provider pages for the capture-runner tests",
      capturedAt: "2026-09-30T03:11:54.000Z",
      maxPages: 4,
      maxRows: DEFAULT_CAPTURE_MAX_ROWS,
      ...okxShape,
      ...overrides,
    };
  }

  function okxRow(ts: number, close: number, confirm = "1"): HistoricalRow {
    return [String(ts), String(close - 1), String(close + 2), String(close - 2), String(close), String(10 + close), String(0), String(0), confirm];
  }

  const page1 = [okxRow(1_792_000_000_000, 100), okxRow(1_791_985_600_000, 101)];
  const page2 = [okxRow(1_791_985_600_000, 101), okxRow(1_791_971_200_000, 99)]; // seam repeat is identical

  function provider(pages: CapturePage[]) {
    return async (url: string): Promise<CapturePage> => {
      const found = pages.find((p) => p.url === url);
      if (!found) throw new Error(`unexpected page ${url}`);
      return found;
    };
  }

  it("pages oldest-ward deterministically and records the request lineage", async () => {
    const result = await captureDataset(
      spec(),
      provider([
        { url: "https://provider.test/page1", rows: page1, nextCursor: "1791985600000", oldestTimestamp: 1_791_985_600_000 },
        { url: "https://provider.test/page?after=1791985600000", rows: page2, nextCursor: "1791971200000" },
        { url: "https://provider.test/page?after=1791971200000", rows: [], nextCursor: "1791971200000" },
      ]),
    );
    expect(result.stopReason).toBe("NO_NEW_ROWS");
    expect(result.pagesFetched).toBe(3);
    expect(result.requestPages.map((p) => p.url)).toEqual([
      "https://provider.test/page1",
      "https://provider.test/page?after=1791985600000",
      "https://provider.test/page?after=1791971200000",
    ]);
    expect(result.candles.map((c) => c.timestamp)).toEqual([1_791_971_200_000, 1_791_985_600_000, 1_792_000_000_000]);
    // The seam row was served twice, provably identically → collapsed, not duplicated.
    expect(result.duplicateIdenticalCount).toBe(1);
    expect(result.status).toBe("OK");
    expect(result.provenance.requestPages[1].cursorParameter).toBe("after");
    expect(result.provenance.valuesUnmodified).toBe(true);
  });

  it("reproduces a recorded dataset exactly from its own pages (fingerprint equal)", async () => {
    const rows = rowsOf("okx-BTC-USDT-4H.json");
    const recorded = loadRecordedFixture("okx-BTC-USDT-4H.json");
    const first = rows.slice(0, 60);
    const second = rows.slice(60);
    const newestOfSecondPage = (second[0] as string[])[0];
    const result = await captureDataset(
      spec({ datasetId: recorded.provenance.datasetId, nextUrl: (cursor) => `https://www.okx.com/api/v5/market/history-candles?...after=${cursor}` }),
      provider([
        { url: "https://provider.test/page1", rows: first, nextCursor: newestOfSecondPage },
        { url: `https://www.okx.com/api/v5/market/history-candles?...after=${newestOfSecondPage}`, rows: second },
      ]),
    );
    expect(result.stopReason).toBe("END_OF_HISTORY");
    expect(result.candles).toEqual(recorded.candles);
    expect(result.fingerprint).toBe(recorded.fingerprint);
    expect(result.candles).toHaveLength(120);
    expect(result.rejections).toEqual([]);
  });

  it("stops on the documented page and row caps instead of paging without bound", async () => {
    const pageCap = await captureDataset(
      spec({ maxPages: 1 }),
      provider([{ url: "https://provider.test/page1", rows: page1, nextCursor: "1791985600000" }]),
    );
    expect(pageCap.stopReason).toBe("PAGE_CAP");
    expect(pageCap.pagesFetched).toBe(1);

    const rowCap = await captureDataset(
      spec({ maxRows: 2 }),
      provider([{ url: "https://provider.test/page1", rows: page1, nextCursor: "1791985600000" }]),
    );
    expect(rowCap.stopReason).toBe("ROW_CAP");
    expect(rowCap.candles).toHaveLength(2);
  });

  it("never overwrites a conflicting re-served row", async () => {
    const conflicting = [okxRow(1_791_985_600_000, 42), okxRow(1_791_971_200_000, 99)];
    const result = await captureDataset(
      spec(),
      provider([
        { url: "https://provider.test/page1", rows: page1, nextCursor: "1791985600000" },
        { url: "https://provider.test/page?after=1791985600000", rows: conflicting },
      ]),
    );
    expect(result.status).toBe("QUARANTINED");
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].detail).toContain("nothing was overwritten");
    expect(result.candles.find((c) => c.timestamp === 1_791_985_600_000)!.close).toBe(101);
  });

  it("rejects a malformed row, keeps the valid ones and quarantines the dataset", async () => {
    const result = await captureDataset(
      spec(),
      provider([
        {
          url: "https://provider.test/page1",
          rows: [okxRow(1_792_000_000_000, 100), ["1791985600000", "1", "0.5", "2", "1", "5"]],
        },
      ]),
    );
    expect(result.candles).toHaveLength(1);
    expect(result.rejections.map((r) => r.code)).toEqual(["HIGH_BELOW_LOW"]);
    expect(result.status).toBe("QUARANTINED");
  });

  it("keeps a quarantined dataset out of the benchmark instead of silently using it", async () => {
    const quarantined = await captureDataset(
      spec({ datasetId: "quarantined-probe" }),
      provider([{ url: "https://provider.test/page1", rows: [okxRow(1_792_000_000_000, 100), ["1791985600000", "1", "0.5", "2", "1", "5"]] }]),
    );
    const selection = selectBenchmark([
      loadRecordedFixture("okx-BTC-USDT-1D.json"),
      { ...quarantined, provenance: { ...quarantined.provenance, assetClass: "crypto" } },
    ]);
    expect(quarantined.status).toBe("QUARANTINED");
    expect(selection.excluded.some((e) => e.datasetId === "quarantined-probe" && e.reason.includes("quarantined"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
describe("§6 deterministic benchmark selection", () => {
  it("selects by coverage facts and records the unavailable asset class", () => {
    const selection = selectBenchmark(fixtures.datasets);
    expect(selection.selected.map((s) => `${s.assetClass}:${s.providerInstrumentId}:${s.timeframe}`)).toEqual([
      "crypto:BTC-USDT:H1",
      "crypto:BTC-USDT:H4",
      "crypto:BTC-USDT:D1",
      "crypto:BTC-USDT:W1",
      "forex:EUR/USD:H4",
      "forex:EUR/USD:D1",
      "stock:AAPL:D1",
      "stock:AAPL:W1",
    ]);
    expect(selection.excluded).toEqual([]);
    expect(selection.unavailableAssetClasses.map((u) => u.assetClass)).toEqual(["commodity", "commodity"]);
    expect(selection.unavailableAssetClasses[0].reason).toContain("XAU/USD");
    expect(formatBenchmarkSelection(selection).join("\n")).toContain("coverage facts only");
  });

  it("picks the instrument with more recorded candles and says so as coverage, not as a result", () => {
    const ethRows: HistoricalRow[] = [];
    for (let i = 0; i < 10; i += 1) {
      const day = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
      ethRows.push([day, "1", "2", "0.5", "1.5", "10"]);
    }
    const eth: ParsedDataset = parseCandleRows(
      {
        ...loadRecordedFixture("twelvedata-EURUSD-1D.json").provenance,
        datasetId: "probe-ETH-1D",
        providerInstrumentId: "ETH/USD",
        instrument: "ETH/USD",
        assetClass: "crypto",
      },
      ethRows,
    );
    const selection = selectBenchmark([...fixtures.datasets, eth]);
    expect(selection.selected.filter((s) => s.assetClass === "crypto").every((s) => s.providerInstrumentId === "BTC-USDT")).toBe(true);
    const exclusion = selection.excluded.find((e) => e.datasetId === "probe-ETH-1D");
    expect(exclusion?.reason).toContain("more recorded candles");
    expect(exclusion?.reason).toContain("not a result");
  });

  it("is order-independent and never consults an evaluation", () => {
    const forward = selectBenchmark(fixtures.datasets);
    const backward = selectBenchmark([...fixtures.datasets].reverse());
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    expect(forward.rule).toContain("evaluation results never consulted");
  });
});

// ────────────────────────────────────────────────────────────────
describe("§8/§9/§13 recorded benchmark through the Phase 293 evaluator", () => {
  const selection = selectBenchmark(fixtures.datasets);
  const runs = selection.selected.map(
    (s) => runRecordedBenchmark([fixtures.byId.get(s.datasetId)!], selection, inputBuilder(fixtures.byId.get(s.datasetId)!), RUN_OPTIONS).runs[0],
  );

  it("routes every selected dataset through the unchanged Phase 293 chain", () => {
    expect(runs).toHaveLength(8);
    for (const entry of runs) {
      expect(entry.sourceClassification).toBe("RECORDED_HISTORICAL");
      expect(entry.report.modelVersion).toBe("phase293.1");
      expect(entry.report.sample.evaluations).toBe(WINDOWS_PER_DATASET);
      expect(entry.report.evaluations.every((e) => e.decision.evaluationIndex >= 23)).toBe(true);
      expect(entry.report.provenance.provider).toBe(entry.provider);
      expect(entry.report.provenance.timeframe).toBe(entry.timeframe);
      expect(entry.report.provenance.instrument).toBe(entry.instrument);
      expect(entry.report.evaluations.every((e) => e.decision.provider === entry.provider)).toBe(true);
      expect(entry.report.evaluations.every((e) => e.decision.instrument === entry.instrument)).toBe(true);
      expect(entry.report.evaluations.every((e) => e.decision.timeframe === entry.timeframe)).toBe(true);
      expect(entry.datasetFingerprint).toMatch(/^fnv1a32:/);
      expect(entry.capturedAt).toBe("2026-09-30T03:11:54.000Z");
    }
    // Every OKX capture ends on the provider's still-forming bar; it is excluded
    // from decisions and reported, never used.
    expect(runs.map((r) => r.formingCandlesExcluded)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
    expect(runs.slice(0, 4).every((r) => r.closedCandles === (r.datasetId === "okx-BTC-USDT-4H" ? 119 : 59))).toBe(true);
    expect(runs.reduce((sum, r) => sum + r.closedCandles, 0)).toBe(
      fixtures.datasets.reduce((sum, d) => sum + d.candles.filter((c) => c.closed).length, 0),
    );
  });

  it("keeps each decision's provider instant and shifts only the clock reading", () => {
    const intervalOf: Record<string, number> = { H1: 3_600_000, H4: 14_400_000, D1: 86_400_000, W1: 604_800_000 };
    for (const entry of runs) {
      const providerTimes = entry.report.evaluations.map((e) => e.decision.providerEvaluationTime!);
      // The evaluation candle reads "now" — that is the only thing alignment changes.
      expect(entry.report.evaluations.every((e) => e.decision.evaluationTime === NOW)).toBe(true);
      expect([...providerTimes].sort((a, b) => a - b)).toEqual(providerTimes);
      const dataset = fixtures.datasets.find((d) => d.provenance.datasetId === entry.datasetId)!;
      for (const providerTime of providerTimes) {
        expect(dataset.candles.some((c) => c.timestamp === providerTime && c.closed)).toBe(true);
      }
      // Bars keep their own spacing: the windows are the provider's bars, not a resampled series.
      for (let i = 1; i < providerTimes.length; i += 1) {
        const delta = providerTimes[i] - providerTimes[i - 1];
        expect(delta % intervalOf[entry.timeframe]).toBe(0);
        expect(delta).toBeGreaterThan(0);
      }
      expect(entry.report.alignment.mode).toBe("WALL_CLOCK_ALIGNED");
      expect(entry.report.provenance.alignmentShiftMs).toBe(NOW - providerTimes[0]);
      expect(entry.report.alignment.note).toContain("provider instant");
    }
  });

  it("reports the recorded windows honestly — no plan is invented, no calibration is claimed", () => {
    for (const entry of runs) {
      const s = entry.report.sample;
      expect(s.plannedTrades).toBe(0);
      expect(s.resolved).toBe(0);
      expect(s.targetHits + s.stopHits + s.invalidationHits + s.timeExpired).toBe(0);
      expect(entry.report.evaluations.every((e) => e.outcome === "NO_TRADE")).toBe(true);
      expect(entry.report.evaluations.every((e) => e.decision.entry === undefined && e.decision.stopLoss === undefined)).toBe(true);
      expect(entry.report.calibration.status).toBe("INSUFFICIENT_SAMPLE");
      expect(entry.report.calibration.productionConfidenceUnchanged).toBe(true);
      expect(entry.report.expectancy.sampleSize).toBe(0);
      expect(entry.report.expectancy.meanRealizedR).toBeUndefined();
      const fields = toEmpiricalValidationFields(entry.report);
      expect(fields.affectsProductionDecision).toBe(false);
      const text = formatValidationDiagnostics(entry.report).join("\n");
      expect(text).toContain("Chronology: RECORDED / HISTORICAL");
      expect(text).toContain("never a live feed");
      expect(text).not.toMatch(/\bLIVE\b/);
    }
  });

  it("walks the recorded sweep through the 291/292 gates and states the reasons it declines", () => {
    const states = new Set(runs.flatMap((r) => r.report.evaluations.map((e) => e.decision.setupState)));
    // The recorded windows genuinely reach setup evaluation; they simply do not
    // clear the plan gates, and every refusal carries its own recorded reason.
    expect(states.size).toBeGreaterThanOrEqual(3);
    expect(states.has("CONFIRMED_SETUP_CONTEXT")).toBe(true);
    expect(states.has("STRUCTURAL_SETUP")).toBe(true);
    for (const entry of runs) {
      for (const evaluation of entry.report.evaluations) {
        expect(evaluation.outcome).toBe("NO_TRADE");
        expect(evaluation.decision.noTradeReasons.length).toBeGreaterThan(0);
        expect(evaluation.decision.direction).toBeUndefined();
        expect(evaluation.decision.entry).toBeUndefined();
        expect(evaluation.decision.plannedRR).toBeUndefined();
        expect(evaluation.notes.join(" ")).toContain("No executable plan was published at the evaluation instant");
      }
      expect(entry.report.byDirection.map((b) => b.label)).toEqual(["no_plan"]);
      expect(entry.report.bySetupState.every((b) => b.resolved === 0 && b.sampleSufficient === false)).toBe(true);
    }
    // No plan, no outcome horizon, no closed multiple anywhere in the sweep.
    expect(runs.every((r) => r.report.evaluations.every((e) => e.realizedR === undefined && e.markToMarketR === undefined))).toBe(true);
  });

  it("produces a coverage report that is descriptive only", () => {
    const coverage = buildCoverageReport(
      fixtures.datasets,
      runs.map((entry) => ({ dataset: fixtures.datasets.find((d) => d.provenance.datasetId === entry.datasetId)!, report: entry.report })),
    );
    expect(coverage.datasets).toBe(8);
    expect(coverage.candles).toBe(620);
    expect(coverage.evaluations).toBe(80);
    expect(coverage.actionable).toBe(0);
    expect(coverage.noTrade).toBe(80);
    expect(coverage.resolved).toBe(0);
    expect(coverage.byAssetClass.map((b) => b.assetClass)).toEqual(["crypto", "forex", "stock"]);
    expect(coverage.byAssetClass.map((b) => b.evaluations)).toEqual([40, 20, 20]);
    expect(coverage.bySetupState.every((b) => b.sampleSufficient === false)).toBe(true);
    expect(coverage.timeframes).toEqual(["D1", "H1", "H4", "W1"]);

    const pairs = runs.map((entry) => ({
      dataset: fixtures.datasets.find((d) => d.provenance.datasetId === entry.datasetId)!,
      report: entry.report,
    }));
    const lines = formatCoverageReport(coverage, pairs);
    const text = lines.join("\n");
    expect(text).toContain("Recorded historical datasets: 8 (620 candles)");
    expect(text).toContain("Actionable decisions: 0 · NO_TRADE: 80");
    expect(text).toContain("Calibration: INSUFFICIENT_SAMPLE");
    expect(text).not.toMatch(/\b(best|worst|rank(?:ed|ing)?|winner)\b/i);
    expect(text).not.toMatch(/accurate|win rate|probability|guaranteed/i);
    expect(formatCoverageReport(coverage, pairs)).toEqual(lines);

    const summary = summarizeRun(fixtures.datasets[0], runs[0].report);
    expect(summary).toMatchObject({ datasetId: "okx-BTC-USDT-1W", actionable: 0, resolved: 0, calibrationStatus: "INSUFFICIENT_SAMPLE" });
  });

  it("fingerprints the whole recorded benchmark deterministically", () => {
    const runAgain = runRecordedBenchmark(fixtures.datasets, selection, inputBuilder(fixtures.datasets[0]), RUN_OPTIONS);
    // Same datasets, same build order → the same fingerprints, whatever the loading order was.
    expect(runAgain.runs.map((r) => `${r.datasetId}=${r.datasetFingerprint}`).sort()).toEqual(
      runs.map((r) => `${r.datasetId}=${r.datasetFingerprint}`).sort(),
    );
    const fp = benchmarkFingerprint({ runs, recordedRuns: runs, designedRuns: [], selection });
    expect(fp.split(";")).toHaveLength(8);
    expect(fp).toBe([...runs].map((r) => `${r.datasetId}=${r.datasetFingerprint}`).sort().join(";"));
  });
});

// ────────────────────────────────────────────────────────────────
describe("§12 no-lookahead on real recorded series", () => {
  const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");
  const indices = [45, 50, 55] as const;
  const options = { alignment: ALIGNMENT, minPrefixCandles: 40, maxFutureCandles: 12, evaluationIndices: indices };

  it("gives identical decisions for a recorded prefix whether or not its future candles exist", () => {
    const full = runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), options).runs[0];
    // A strict prefix of the SAME recorded rows — no value is invented, 30 future candles are simply absent.
    const truncated = parseCandleRows(okx4h.provenance, rowsOf("okx-BTC-USDT-4H.json").slice(60));
    const short = runRecordedBenchmark([truncated], selectBenchmark([truncated]), inputBuilder(truncated), options).runs[0];
    expect(full.report.sample.evaluations).toBe(3);
    expect(short.report.sample.evaluations).toBe(3);
    expect(short.report.evaluations.map((e) => e.decision.evaluationIndex)).toEqual([...indices]);
    expect(decisiveProjection(short.report)).toEqual(decisiveProjection(full.report));
    // The future only ever changes the OUTCOME, and here it does: without the
    // later candles a window carries fewer observations.
    // A NO_TRADE window has no plan to resolve, so it does not even read the
    // future: with 30 future candles fewer, the decisions and outcomes are identical.
    expect(short.report.evaluations.map((e) => e.futureCandlesConsidered)).toEqual([0, 0, 0]);
    expect(full.report.evaluations.map((e) => e.futureCandlesConsidered)).toEqual([0, 0, 0]);
    expect(short.report.evaluations.map((e) => e.outcome)).toEqual(full.report.evaluations.map((e) => e.outcome));
  });

  it("changes only the observation horizon, never the decision, when maxFutureCandles differs", () => {
    const shortHorizon = runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), { ...options, maxFutureCandles: 4 }).runs[0];
    const longHorizon = runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), { ...options, maxFutureCandles: 24 }).runs[0];
    expect(decisiveProjection(shortHorizon.report)).toEqual(decisiveProjection(longHorizon.report));
    // Neither horizon is read: the recorded windows publish no plan, so no
    // outcome horizon can influence anything — the decisions are equal.
    expect(shortHorizon.report.evaluations.map((e) => e.futureCandlesConsidered)).toEqual([0, 0, 0]);
    expect(longHorizon.report.evaluations.map((e) => e.futureCandlesConsidered)).toEqual([0, 0, 0]);
    expect(shortHorizon.report.sample).toEqual(longHorizon.report.sample);
  });

  it("cannot be moved by the process clock: a different observation instant shifts the clock, not the decision", () => {
    const later = runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), {
      ...options,
      alignment: { ...ALIGNMENT, nowMs: NOW + 3 * 86_400_000 },
    }).runs[0];
    expect(decisiveProjection(later.report)).toEqual(decisiveProjection(runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), options).runs[0].report));
    expect(later.report.provenance.alignmentShiftMs).toBe(NOW + 3 * 86_400_000 - later.report.evaluations[0].decision.providerEvaluationTime!);
  });

  it("hands the engine closed candles only", () => {
    const okx1d = loadRecordedFixture("okx-BTC-USDT-1D.json");
    const { candles, excluded } = closedOutcomeCandles(okx1d);
    expect(excluded).toBe(1);
    expect(candles).toHaveLength(59);
    const dataset = fixtures.datasets.find((d) => d.provenance.datasetId === "okx-BTC-USDT-1D")!;
    const forming = dataset.candles.find((c) => !c.closed)!;
    expect(candles.some((c) => c.timestamp === forming.timestamp)).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────
describe("§14/§16 designed material is separate and work is bounded", () => {
  it("buckets a designed fixture apart from recorded runs and keeps it out of the recorded aggregate", () => {
    const rows: HistoricalRow[] = [];
    for (let i = 0; i < 60; i += 1) {
      const p = 100 + Math.sin(i / 5) * 3 + i * 0.05;
      rows.push([String(1_790_000_000_000 + i * 14_400_000), p.toFixed(3), (p + 0.8).toFixed(3), (p - 0.8).toFixed(3), (p + 0.2).toFixed(3), "1000", "1000", "1000", "1"]);
    }
    const designed: ParsedDataset = parseCandleRows(
      {
        datasetId: "designed-probe-4H",
        schemaVersion: HISTORICAL_SCHEMA_VERSION,
        sourceClassification: "DESIGNED_TEST_FIXTURE",
        provider: "test-fixture-generator",
        providerInstrumentId: "TEST-USD",
        instrument: "TEST/USD",
        assetClass: "crypto",
        timeframe: "H4",
        providerRowShape: "okx-candles-v5-array",
        rowOrder: "provider (newest first)",
        requestPages: [],
        capturedAt: "2026-09-30T03:11:54.000Z",
        captureMethod: "generated closed bars for the bucket-separation test; never provider data",
        valuesUnmodified: true,
      },
      rows,
    );
    const selection = selectBenchmark([designed]);
    const combined = runRecordedBenchmark([designed, ...fixtures.datasets.slice(0, 1)], { ...selection, selected: [...selection.selected, selectBenchmark([fixtures.datasets[0]]).selected[0]] }, inputBuilder(designed), RUN_OPTIONS);
    expect(combined.runs).toHaveLength(2);
    expect(combined.designedRuns.map((r) => r.datasetId)).toEqual(["designed-probe-4H"]);
    expect(combined.recordedRuns.map((r) => r.datasetId)).toEqual(["okx-BTC-USDT-1W"]);
    expect(combined.designedRuns[0].sourceClassification).toBe("DESIGNED_TEST_FIXTURE");
  });

  it("calls the engine at most once per evaluation and never re-reads the whole series per window", () => {
    const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");
    let calls = 0;
    const counted = (prefix: readonly OutcomeCandle[], index: number) => {
      calls += 1;
      return inputBuilder(okx4h)(prefix, index);
    };
    const entry = runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), counted, {
      alignment: ALIGNMENT,
      minPrefixCandles: 40,
      maxEvaluations: 6,
      maxFutureCandles: 8,
    }).runs[0];
    expect(entry.report.sample.evaluations).toBe(6);
    expect(calls).toBe(6);
  });
});

function readPhase290a(): unknown {
  return JSON.parse(readFileSync(new URL("./data/__fixtures__/real-provider-candles.phase290a.json", import.meta.url), "utf8"));
}

// ────────────────────────────────────────────────────────────────
describe("§8 append invariance through the Phase 294 pipeline", () => {
  const INTERVAL = 14_400_000;
  const GENERATOR = "test-fixture-generator";

  /** The Phase 292/293 designed H4 path (indices 0…199), written as provider-shaped rows. */
  function designedRows(): HistoricalRow[] {
    const bars: { o: number; h: number; l: number; c: number }[] = [];
    const push = (o: number, h: number, l: number, c: number) => bars.push({ o, h, l, c });
    for (let i = 0; i < 121; i++) { const p = 100 + i * 0.5; push(p - 0.2, p + 0.6, p - 0.8, p); }
    for (let i = 121; i < 125; i++) { const p = 160 + (i - 120) * 2.1; push(p - 0.5, p + 0.5, p - 1, p); }
    push(169, 169.5, 167, 168);
    for (let i = 126; i < 138; i++) { const p = 168 - (i - 125) * 0.65; push(p + 0.2, p + 0.6, p - 0.8, p); }
    for (let i = 138; i < 152; i++) { const p = 160 + (i - 138) * 1.15; push(p - 0.3, p + 0.5, p - 0.9, p); }
    for (let i = 152; i < 169; i++) { const p = 176 - (i - 151) * 0.82; push(p + 0.3, p + 0.7, p - 0.7, p); }
    for (let i = 169; i < 200; i++) { const p = 162 + (i - 168) * 0.05; push(p - 0.2, p + 0.4, p - 0.5, p); }
    for (let i = 200; i < 220; i++) { const p = i < 216 ? 164 + (i - 199) * 0.8 : 177 - (i - 215) * 1.1; push(p - 0.3, p + 0.5, p - 0.6, p); }
    // A real base instant: the quality gates reject a zero timestamp, so the
    // designed series starts at a plausible provider millisecond value.
    const BASE = 1_780_000_000_000;
    return bars.map((bar, i) => [String(BASE + i * INTERVAL), String(bar.o), String(bar.h), String(bar.l), String(bar.c), "1000", "1000", "1000", "1"]);
  }

  function designedDataset(rows: HistoricalRow[]): ParsedDataset {
    return parseCandleRows(
      {
        datasetId: "designed-append-invariance",
        schemaVersion: HISTORICAL_SCHEMA_VERSION,
        sourceClassification: "DESIGNED_TEST_FIXTURE",
        provider: GENERATOR,
        providerInstrumentId: "TEST-USD",
        instrument: "TEST/USD",
        assetClass: "crypto",
        timeframe: "H4",
        providerBarLabel: "4H",
        providerRowShape: "okx-candles-v5-array",
        providerFieldOrder: ["timestamp", "open", "high", "low", "close", "volume", "volumeCcy", "volumeCcyQuote", "confirm"],
        rowOrder: "generated oldest first",
        requestPages: [],
        capturedAt: "2026-09-30T03:11:54.000Z",
        captureMethod: "designed deterministic series for the append-invariance proof; never provider history",
        valuesUnmodified: false,
      },
      rows,
    );
  }

  const options = { alignment: ALIGNMENT, minPrefixCandles: 60, maxFutureCandles: 20, evaluationIndices: [199] as const };

  it("publishes the same plan before and after 20 future candles are appended", () => {
    const all = designedRows();
    const before = designedDataset(all.slice(0, 200));
    const after = designedDataset([...all]);
    // The designed fixture describes its own class and news context — it is not
    // provider history, and it is reported in the designed bucket only.
    const designedBuilder = (d: ParsedDataset) => inputBuilder(d, { instrumentType: "forex", economicEvents: "Fed signals hawkish stance, rate hike" });
    const beforeRun = runRecordedBenchmark([before], selectBenchmark([before]), designedBuilder(before), options).runs[0];
    const afterRun = runRecordedBenchmark([after], selectBenchmark([after]), designedBuilder(after), options).runs[0];

    expect(beforeRun.report.sample.plannedTrades).toBe(1);
    expect(afterRun.report.sample.plannedTrades).toBe(1);
    const plan = beforeRun.report.evaluations[0].decision;
    expect(plan.direction).toBe("long");
    expect(plan.entry).toBeCloseTo(afterRun.report.evaluations[0].decision.entry!, 10);
    expect(plan.stopLoss).toBeCloseTo(afterRun.report.evaluations[0].decision.stopLoss!, 10);
    expect(plan.takeProfit).toBeCloseTo(afterRun.report.evaluations[0].decision.takeProfit!, 10);
    expect(decisiveProjection(afterRun.report)).toEqual(decisiveProjection(beforeRun.report));

    // The appended candles change the OUTCOME only: unresolved → resolved.
    expect(beforeRun.report.evaluations[0].outcome).toBe("INSUFFICIENT_FUTURE_DATA");
    expect(beforeRun.report.evaluations[0].realizedR).toBeUndefined();
    expect(afterRun.report.evaluations[0].outcome).toBe("TARGET_HIT");
    // Realized R is measured from the PUBLISHED stop; the displayed planned R:R
    // is the same plan rounded for publication (5.2025… vs 5.2).
    const publishedRiskReward = (plan.takeProfit! - plan.entry!) / (plan.entry! - plan.stopLoss!);
    expect(afterRun.report.evaluations[0].realizedR).toBeCloseTo(publishedRiskReward, 10);
    expect(plan.plannedRR!).toBeCloseTo(publishedRiskReward, 2);
    expect(afterRun.report.evaluations[0].elapsedCandles).toBeGreaterThan(0);

    // Designed data is bucketed apart from recorded provider history.
    expect(beforeRun.sourceClassification).toBe("DESIGNED_TEST_FIXTURE");
    expect(beforeRun.report.provenance.provider).toBe(GENERATOR);
  });
});

// ────────────────────────────────────────────────────────────────
describe("§13 the Phase 293 recorded OKX material is retained", () => {
  it("still carries 32 recorded bars per timeframe", () => {
    const fixture = readPhase290a() as { _provenance: { provider: string; instrumentId: string }; bars: Record<string, HistoricalRow[]> };
    expect(fixture._provenance.provider).toBe("OKX");
    expect(fixture._provenance.instrumentId).toBe("BTC-USDT");
    for (const tf of ["1W", "1D", "4H", "1H"]) expect(fixture.bars[tf]).toHaveLength(32);
  });

  it("still resolves to honest NO_TRADE when driven through the Phase 294 pipeline", () => {
    const fixture = readPhase290a() as { bars: Record<string, HistoricalRow[]> };
    const parsed: ParsedDataset = parseCandleRows(
      {
        datasetId: "okx-phase290a-1D",
        schemaVersion: HISTORICAL_SCHEMA_VERSION,
        sourceClassification: "RECORDED_HISTORICAL",
        provider: "okx",
        providerInstrumentId: "BTC-USDT",
        instrument: "BTC/USDT",
        assetClass: "crypto",
        timeframe: "D1",
        providerBarLabel: "1D",
        providerRowShape: "okx-candles-v5-array",
        providerFieldOrder: ["timestamp", "open", "high", "low", "close", "volume"],
        rowOrder: "provider (newest first)",
        requestPages: [{ page: 1, url: "GET /api/v5/market/candles?instId=BTC-USDT&bar=1D&limit=48", rows: 32 }],
        capturedAt: "2026-09-30T03:11:54.000Z",
        captureMethod: "Phase 290a recorded payload, retained unchanged",
        valuesUnmodified: true,
      },
      fixture.bars["1D"],
    );
    expect(parsed.candles).toHaveLength(32);
    expect(parsed.status).toBe("OK");
    const entry = runRecordedBenchmark([parsed], selectBenchmark([parsed]), inputBuilder(parsed), {
      alignment: ALIGNMENT,
      minPrefixCandles: 24,
      maxEvaluations: 3,
      maxFutureCandles: 6,
    }).runs[0];
    expect(entry.report.evaluations.every((e) => e.outcome === "NO_TRADE")).toBe(true);
    expect(entry.report.sample.plannedTrades).toBe(0);
    expect(entry.report.calibration.status).toBe("INSUFFICIENT_SAMPLE");
  });
});

// ────────────────────────────────────────────────────────────────
describe("§10/§11/§17 the floors, reproducibility and the wording of the diagnostics", () => {
  it("never lowers the Phase 293 sample floors to make a recorded run look sufficient", () => {
    expect(MIN_RESOLVED_FOR_AGGREGATE).toBe(20);
    expect(CALIBRATION_MIN_RESOLVED).toBe(30);
    expect(DEFAULT_MAX_EVALUATIONS).toBe(40);
    expect(DEFAULT_MAX_FUTURE_CANDLES).toBe(60);
    const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");
    const entry = runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), RUN_OPTIONS).runs[0];
    expect(entry.report.calibration.minResolvedSample).toBe(CALIBRATION_MIN_RESOLVED);
    expect(entry.report.calibration.status).toBe("INSUFFICIENT_SAMPLE");
    expect(entry.report.calibration.productionConfidenceUnchanged).toBe(true);
    expect(entry.report.bySetupState.every((b) => b.resolved === 0 && !b.sampleSufficient)).toBe(true);
  });

  it("reproduces the same decisions and outcomes byte-for-byte on a second run", () => {
    const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");
    const build = () => runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), RUN_OPTIONS).runs[0];
    const first = build();
    const second = build();
    expect(JSON.stringify(second.report.evaluations)).toBe(JSON.stringify(first.report.evaluations));
    expect(second.report.sample).toEqual(first.report.sample);
    expect(second.report.calibration).toEqual(first.report.calibration);
    expect(second.report.provenance).toEqual(first.report.provenance);
    expect(second.datasetFingerprint).toBe(first.datasetFingerprint);
  });

  it("words the diagnostics as observations — no accuracy, win-rate or probability claim", () => {
    const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");
    const selection = selectBenchmark([okx4h]);
    const entry = runRecordedBenchmark([okx4h], selection, inputBuilder(okx4h), RUN_OPTIONS).runs[0];
    const text = [
      ...formatValidationDiagnostics(entry.report),
      ...formatBenchmarkSelection(selection),
      ...formatCoverageReport(
        buildCoverageReport([okx4h], [{ dataset: okx4h, report: entry.report }]),
        [{ dataset: okx4h, report: entry.report }],
      ),
    ].join("\n");
    expect(text).toMatch(/provider okx, instrument BTC\/USDT, timeframe H4/);
    expect(text).toMatch(/insufficient sample/i);
    expect(text).toMatch(/recorded decision window \(provider instants\): \d{4}-\d{2}-\d{2}T/);
    expect(text).not.toMatch(/accurate|accuracy|win rate|win-rate|probability|guarantee|AI predicts|proven/i);
    expect(text).not.toMatch(/LIVE/);
  });
});

describe("§15 Phase 293 semantics still hold for a recorded run", () => {
  it("keeps the outcome vocabulary, ambiguity handling and journal bridge intact", () => {
    const okx4h = loadRecordedFixture("okx-BTC-USDT-4H.json");
    const entry = runRecordedBenchmark([okx4h], selectBenchmark([okx4h]), inputBuilder(okx4h), RUN_OPTIONS).runs[0];
    const vocabulary = new Set([
      "TARGET_HIT",
      "STOP_HIT",
      "INVALIDATION_HIT",
      "TIME_EXPIRED",
      "NO_TRADE",
      "AMBIGUOUS_PATH",
      "INSUFFICIENT_FUTURE_DATA",
    ]);
    for (const evaluation of entry.report.evaluations) {
      expect(vocabulary.has(evaluation.outcome)).toBe(true);
      expect(evaluation.notes.length).toBeGreaterThan(0);
      expect(evaluation.realizedR).toBeUndefined(); // never a closed multiple without a closed outcome
      expect(entry.report.provenance.executionData).toContain("OHLCV only");
      for (const bucket of entry.report.bySetupState) {
        if (bucket.resolved < 20) expect(bucket.sampleSufficient).toBe(false);
      }
    }
    // The production engine is untouched by the empirical layer.
    const probe = runAnalysis(inputBuilder(okx4h)(closedOutcomeCandles(okx4h).candles.slice(0, 60), 59));
    expect(probe.recommendation).toBeTruthy();
  });
});
