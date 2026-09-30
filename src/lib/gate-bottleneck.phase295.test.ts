/**
 * Phase 295 — GATE BOTTLENECK DIAGNOSTICS SUITE (§6–§9, §12, §13, §15) plus the
 * re-run of the real recorded corpus under the corrected as-of decision clock.
 *
 * The question this suite answers with numbers: was "0 actionable / 80 recorded
 * evaluations" caused by historical freshness semantics, or by the analytical
 * gates? Both halves are measured here.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MtfCandleInput } from "@/lib/data/mtf";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { historicalAsOfClock } from "@/lib/decision-clock";
import {
  buildCoverageReport,
  formatCoverageReport,
  selectBenchmark,
} from "@/lib/historical/benchmark";
import { parseCandleRows, type ParsedDataset } from "@/lib/historical/dataset";
import { loadRecordedFixture, loadRecordedFixtureFile, loadRecordedFixtures } from "@/lib/historical/fixtures";
import {
  buildGateBottleneckReport,
  formatGateBottleneckReport,
  mergeGateBottleneckReports,
} from "@/lib/historical/gate-diagnostics";
import { runRecordedDataset, runRecordedBenchmark } from "@/lib/historical/recorded-walkforward";
import {
  gateFactsFromTrace,
  type OutcomeCandle,
  type OutcomeEvaluation,
  type WalkForwardDecision,
} from "@/lib/outcome-validation";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

const fixtures = loadRecordedFixtures();
const RUN_OPTIONS = { maxEvaluations: 10, minPrefixCandles: 24, maxFutureCandles: 10 };

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

function inputBuilderUnlessClocked(
  parsed: ParsedDataset,
  withClock: boolean,
  designedContext?: { instrumentType: "forex" | "crypto" | "stock"; economicEvents: string },
) {
  const meta = parsed.provenance;
  const instrumentType = designedContext?.instrumentType ?? (meta.assetClass as "crypto" | "forex" | "stock");
  const economicEvents = designedContext?.economicEvents ?? "";
  return (prefix: readonly OutcomeCandle[]): AnalysisInput => {
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
      ...(withClock ? { decisionClock: historicalAsOfClock(last.timestamp) } : {}),
    } as unknown as AnalysisInput;
  };
}

/** The recorded sweep re-run under the corrected clock. */
const selection = selectBenchmark(fixtures.datasets);
const runs = selection.selected.map((s) => {
  const dataset = fixtures.byId.get(s.datasetId)!;
  return runRecordedDataset(dataset, inputBuilderUnlessClocked(dataset, true), RUN_OPTIONS);
});
const merged = mergeGateBottleneckReports(runs.map((r) => buildGateBottleneckReport(r.report.evaluations)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("§6 aggregation semantics (unit)", () => {
  function decisionOf(overrides: Partial<WalkForwardDecision>): WalkForwardDecision {
    return {
      evaluationIndex: 0,
      evaluationTime: 1_780_000_000_000,
      recommendation: "NO_TRADE",
      bias: "Neutral",
      confidence: 30,
      conviction: "Low",
      setupState: "STRUCTURAL_SETUP",
      location: "no_location",
      timeframe: "H4",
      provider: "probe",
      instrument: "PROBE/USD",
      sweepPresent: false,
      fvgEngaged: false,
      obEngaged: false,
      structuralEventPresent: false,
      noTradeReasons: ["declined"],
      ...overrides,
    };
  }
  function evaluationOf(overrides: Partial<WalkForwardDecision>): OutcomeEvaluation {
    return { decision: decisionOf(overrides), outcome: "NO_TRADE", futureCandlesConsidered: 0, notes: [] };
  }

  it("counts occurrences per gate, multi-gate failures and first blockers in canonical order", () => {
    const report = buildGateBottleneckReport([
      evaluationOf({ failedGates: ["GATE4_CONFLUENCE"], firstBlockingGate: "GATE4_CONFLUENCE" }),
      evaluationOf({ failedGates: ["GATE8_RR", "GATE3_DIRECTIONAL_BIAS"], firstBlockingGate: "GATE3_DIRECTIONAL_BIAS" }),
      evaluationOf({ failedGates: ["GATE3_DIRECTIONAL_BIAS", "GATE4_CONFLUENCE"], firstBlockingGate: "GATE3_DIRECTIONAL_BIAS" }),
      evaluationOf({ failedGates: [] }),
    ]);
    expect(report.evaluations).toBe(4);
    expect(report.failedGateCounts).toEqual([
      { gateId: "GATE3_DIRECTIONAL_BIAS", occurrences: 2 },
      { gateId: "GATE4_CONFLUENCE", occurrences: 2 },
      { gateId: "GATE8_RR", occurrences: 1 },
    ]);
    expect(report.firstBlockerCounts).toEqual([
      { gateId: "GATE3_DIRECTIONAL_BIAS", occurrences: 2 },
      { gateId: "GATE4_CONFLUENCE", occurrences: 1 },
    ]);
    expect(report.multiGateFailure).toEqual([
      { gatesFailed: 1, evaluations: 1 },
      { gatesFailed: 2, evaluations: 2 },
    ]);
    expect(report.noGateFailureRecorded).toBe(1);
    expect(report.gateFactsAvailable).toBe(true);
  });

  it("separates data-validity failures from analytical ones and appends unknown gate ids", () => {
    const report = buildGateBottleneckReport([
      evaluationOf({ failedGates: ["GATE0_DATA_FRESHNESS"], firstBlockingGate: "GATE0_DATA_FRESHNESS", dataQualityFailure: true }),
      evaluationOf({ failedGates: ["GATE1_LIVE_PRICE", "GATE8_RR"], firstBlockingGate: "GATE1_LIVE_PRICE", dataQualityFailure: true }),
      evaluationOf({ failedGates: ["GATE4_CONFLUENCE"], firstBlockingGate: "GATE4_CONFLUENCE" }),
      evaluationOf({ failedGates: ["GATE_Z_FUTURE"], firstBlockingGate: "GATE_Z_FUTURE" }),
    ]);
    expect(report.dataQualityFailures).toBe(2);
    expect(report.analyticalFailures).toBe(3);
    expect(report.failedGateCounts[report.failedGateCounts.length - 1]).toEqual({ gateId: "GATE_Z_FUTURE", occurrences: 1 });
  });

  it("counts an actionable decision but keeps it out of the failure counts", () => {
    const report = buildGateBottleneckReport([
      evaluationOf({ direction: "long", entry: 100, stopLoss: 99, takeProfit: 103, failedGates: [] }),
      evaluationOf({ failedGates: ["GATE8_RR"], firstBlockingGate: "GATE8_RR" }),
    ]);
    expect(report.actionable).toBe(1);
    expect(report.noTrade).toBe(1);
    expect(report.failedGateCounts).toEqual([{ gateId: "GATE8_RR", occurrences: 1 }]);
  });

  it("is clock-free, deterministic and additive across shards", () => {
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("a diagnostic aggregate must never read the clock");
    });
    const slice = [
      evaluationOf({ failedGates: ["GATE4_CONFLUENCE"], firstBlockingGate: "GATE4_CONFLUENCE" }),
      evaluationOf({ failedGates: ["GATE3_DIRECTIONAL_BIAS"], firstBlockingGate: "GATE3_DIRECTIONAL_BIAS" }),
    ];
    const whole = buildGateBottleneckReport(slice);
    const split = mergeGateBottleneckReports([buildGateBottleneckReport([slice[0]]), buildGateBottleneckReport([slice[1]])]);
    nowSpy.mockRestore();
    expect(split).toEqual(whole);
    expect(buildGateBottleneckReport(slice)).toEqual(whole);
  });

  it("formats counts as facts — no ranking, no accuracy claim, and names the sample", () => {
    const lines = formatGateBottleneckReport(buildGateBottleneckReport([evaluationOf({ failedGates: ["GATE8_RR"], firstBlockingGate: "GATE8_RR" })]));
    const text = lines.join("\n");
    expect(text).toContain("Recorded / historical evaluations: 1");
    expect(text).toContain("Primary observed blockers");
    expect(text).toContain("not a ranking");
    expect(text).not.toMatch(/\b(best|worst|ranked|winner)\b/i);
    expect(text).not.toMatch(/accurate|win rate|probability|guaranteed/i);
    expect(text).not.toMatch(/\bLIVE\b/);
  });
});

describe("§8 the real recorded corpus under the as-of decision clock", () => {
  it("decides every evaluation as of its own provider candle", () => {
    expect(runs).toHaveLength(8);
    for (const run of runs) {
      expect(run.decisionClockMode).toBe("HISTORICAL_AS_OF");
      expect(run.report.alignment.mode).toBe("PROVIDER_TIMESTAMPS");
      expect(run.asOfFirst).toBeDefined();
      expect(run.asOfLast).toBeDefined();
      const dataset = fixtures.byId.get(run.datasetId)!;
      const closedTimes = dataset.candles.filter((c) => c.closed).map((c) => c.timestamp);
      const captureInstant = Date.parse(dataset.provenance.capturedAt);
      const times: number[] = [];
      for (const evaluation of run.report.evaluations) {
        const instant = evaluation.decision.evaluationTime;
        times.push(instant);
        // The decision instant IS the closed provider candle at that chronology index.
        expect(closedTimes[evaluation.decision.evaluationIndex]).toBe(instant);
        // The capture instant is never a decision instant.
        expect(instant).not.toBe(captureInstant);
      }
      expect([...times].sort((a, b) => a - b)).toEqual(times); // strictly chronological
    }
  });

  it("publishes the measured bottleneck distribution (no gate is ranked)", () => {
    expect(merged.evaluations).toBe(80);
    expect(merged.actionable).toBe(0);
    expect(merged.noTrade).toBe(80);
    expect(merged.gateFactsAvailable).toBe(true);
    expect(merged.failedGateCounts).toEqual([
      { gateId: "GATE3_DIRECTIONAL_BIAS", occurrences: 37 },
      { gateId: "GATE4_CONFLUENCE", occurrences: 43 },
      { gateId: "GATE6B_MTF_HIERARCHY", occurrences: 13 },
      { gateId: "GATE7_STRUCTURAL_LEVELS", occurrences: 15 },
      { gateId: "GATE8_RR", occurrences: 25 },
    ]);
    expect(merged.firstBlockerCounts).toEqual([
      { gateId: "GATE3_DIRECTIONAL_BIAS", occurrences: 37 },
      { gateId: "GATE4_CONFLUENCE", occurrences: 43 },
    ]);
    expect(merged.multiGateFailure).toEqual([
      { gatesFailed: 1, evaluations: 40 },
      { gatesFailed: 2, evaluations: 27 },
      { gatesFailed: 3, evaluations: 13 },
    ]);
    expect(merged.setupStatesBeforeRejection).toEqual([
      { state: "CONFIRMED_SETUP_CONTEXT", occurrences: 39, actionable: 0 },
      { state: "INVALID_SETUP_CONTEXT", occurrences: 11, actionable: 0 },
      { state: "LOCATION_ONLY", occurrences: 23, actionable: 0 },
      { state: "STRUCTURAL_SETUP", occurrences: 7, actionable: 0 },
    ]);
  });

  it("attributes ZERO blocked evaluations to data validity — the clock fix removed that artefact", () => {
    expect(merged.dataQualityFailures).toBe(0);
    expect(merged.analyticalFailures).toBe(80);
    expect(merged.noGateFailureRecorded).toBe(0);
    for (const run of runs) {
      const facts = buildGateBottleneckReport(run.report.evaluations);
      expect(facts.dataQualityFailures, `${run.datasetId} freshness`).toBe(0);
      expect(facts.analyticalFailures).toBe(10);
    }
  });

  it("keeps the per-dataset split (no pooled favourable aggregate)", () => {
    const byClass = new Map<string, number>();
    for (const run of runs) byClass.set(run.assetClass, (byClass.get(run.assetClass) ?? 0) + run.report.evaluations.length);
    expect([...byClass.entries()].sort()).toEqual([
      ["crypto", 40],
      ["forex", 20],
      ["stock", 20],
    ]);
    expect(new Set(runs.map((r) => r.timeframe))).toEqual(new Set(["H1", "H4", "D1", "W1"]));
    expect(new Set(runs.map((r) => r.provider))).toEqual(new Set(["okx", "twelve-data"]));
  });

  it("shows the same counts through the coverage report, with the recorded/historical wording", () => {
    const pairs = runs.map((run) => ({ dataset: fixtures.byId.get(run.datasetId)!, report: run.report }));
    const coverage = buildCoverageReport(fixtures.datasets, pairs);
    expect(coverage.gates.evaluations).toBe(80);
    expect(coverage.gates.dataQualityFailures).toBe(0);
    const text = formatCoverageReport(coverage, pairs).join("\n");
    expect(text).toContain("Recorded / historical evaluations: 80");
    expect(text).toContain("Actionable: 0");
    expect(text).toContain("Data-validity gate failures (GATE0/1/2): 0");
    expect(text).toContain("Decision clock — HISTORICAL AS-OF");
    expect(text).toContain("never a live feed");
    expect(text).not.toMatch(/\bLIVE\b/);
    expect(text).not.toMatch(/accurate|win rate|probability|guaranteed|\b(best|worst|ranked)\b/i);
  });
});

describe("§9 before/after — what the clock fix changed and what it did not", () => {
  const dataset = loadRecordedFixture("okx-BTC-USDT-4H.json");

  it("removes ONLY the freshness failure and leaves every analytical gate untouched", () => {
    const prefixIndices = [60, 80, 100];
    const before: (readonly string[] | undefined)[] = [];
    const after: (readonly string[] | undefined)[] = [];
    const beforeRecs: string[] = [];
    const afterRecs: string[] = [];

    for (const index of prefixIndices) {
      const prefix = dataset.candles.filter((c) => c.closed).slice(0, index + 1);
      const pre = runAnalysis(inputBuilderUnlessClocked(dataset, false)(prefix));
      const post = runAnalysis(inputBuilderUnlessClocked(dataset, true)(prefix));
      before.push(gateFactsFromTrace(pre).failedGates);
      after.push(gateFactsFromTrace(post).failedGates);
      beforeRecs.push(pre.recommendation);
      afterRecs.push(post.recommendation);
    }

    // Pre-295 behaviour: a recorded prefix evaluated without a decision instant
    // is judged against today and fails Gate 0.
    expect(before.every((gates) => gates?.includes("GATE0_DATA_FRESHNESS"))).toBe(true);
    // With the canonical clock: that artefact disappears…
    expect(after.every((gates) => !gates?.includes("GATE0_DATA_FRESHNESS"))).toBe(true);
    // …and nothing else changes: identical analytical gate sets, identical recommendations.
    const analytical = (gates: readonly string[] | undefined) =>
      (gates ?? []).filter((g) => g !== "GATE0_DATA_FRESHNESS");
    expect(after.map(analytical)).toEqual(before.map(analytical));
    expect(afterRecs).toEqual(beforeRecs);
    expect(afterRecs.every((r) => r === "NO_TRADE")).toBe(true);
  });
});

describe("§10 capture-time and future-candle invariance, including the gate facts", () => {
  const dataset = loadRecordedFixture("okx-BTC-USDT-4H.json");
  const indices = [45, 50, 55];

  it("does not change any decision or gate fact when the dataset capture instant differs", () => {
    const withOtherCapture = parseCandleRows(
      { ...dataset.provenance, capturedAt: "2031-01-01T00:00:00.000Z" },
      loadRecordedFixtureFile("okx-BTC-USDT-4H.json").rows,
    );
    const runA = runRecordedDataset(dataset, inputBuilderUnlessClocked(dataset, true), { ...RUN_OPTIONS, evaluationIndices: indices });
    const runB = runRecordedDataset(withOtherCapture, inputBuilderUnlessClocked(withOtherCapture, true), { ...RUN_OPTIONS, evaluationIndices: indices });
    const facts = (run: typeof runA) => run.report.evaluations.map((e) => ({ i: e.decision.evaluationIndex, gates: e.decision.failedGates ?? null }));
    expect(facts(runB)).toEqual(facts(runA));
    expect(runB.report.sample).toEqual(runA.report.sample);
  });

  it("cannot change an earlier evaluation by appending or removing later recorded candles", () => {
    const truncated = parseCandleRows(dataset.provenance, loadRecordedFixtureFile("okx-BTC-USDT-4H.json").rows.slice(60));
    const full = runRecordedDataset(dataset, inputBuilderUnlessClocked(dataset, true), { ...RUN_OPTIONS, evaluationIndices: indices });
    const short = runRecordedDataset(truncated, inputBuilderUnlessClocked(truncated, true), { ...RUN_OPTIONS, evaluationIndices: indices });
    const facts = (run: typeof full) =>
      run.report.evaluations.map((e) => ({
        i: e.decision.evaluationIndex,
        time: e.decision.evaluationTime,
        rec: e.decision.recommendation,
        gates: e.decision.failedGates ?? null,
        first: e.decision.firstBlockingGate ?? null,
      }));
    expect(facts(short)).toEqual(facts(full));
    expect(short.report.sample).toEqual(full.report.sample);
  });
});

describe("§12 a recorded decision→plan→outcome chain when one exists", () => {
  it("reports the honest zero and proves the mechanics on a designed fixture kept out of the recorded aggregate", () => {
    expect(merged.actionable).toBe(0); // no recorded window publishes a plan — nothing is manufactured
    const designed = parseCandleRows(
      {
        datasetId: "designed-gate-chain",
        schemaVersion: "phase294.1",
        sourceClassification: "DESIGNED_TEST_FIXTURE",
        provider: "test-fixture-generator",
        providerInstrumentId: "TEST-USD",
        instrument: "TEST/USD",
        assetClass: "crypto",
        timeframe: "H4",
        providerRowShape: "okx-candles-v5-array",
        rowOrder: "generated oldest first",
        requestPages: [],
        capturedAt: "2026-09-30T03:11:54.000Z",
        captureMethod: "designed series for the gate-chain mechanics proof; never provider history",
        valuesUnmodified: false,
      },
      designedRows(),
    );
    // The designed fixture states its own designed class and news context; it is
    // not provider history and is reported in the designed bucket only.
    const designedBuilder = inputBuilderUnlessClocked(designed, true, {
      instrumentType: "forex",
      economicEvents: "Fed signals hawkish stance, rate hike",
    });
    const run = runRecordedBenchmark([designed], selectBenchmark([designed]), designedBuilder, {
      maxEvaluations: 1,
      minPrefixCandles: 60,
      maxFutureCandles: 20,
      evaluationIndices: [199],
    }).runs[0];
    const evaluation = run.report.evaluations[0];
    expect(run.sourceClassification).toBe("DESIGNED_TEST_FIXTURE");
    expect(evaluation.decision.direction).toBe("long");
    expect(evaluation.decision.entry).toBeCloseTo(163.55, 2);
    expect(evaluation.decision.stopLoss).toBeCloseTo(161.18, 2);
    expect(evaluation.decision.takeProfit).toBeCloseTo(175.88, 2);
    expect(evaluation.decision.plannedRR).toBeCloseTo(5.2, 2);
    expect(evaluation.outcome).toBe("TARGET_HIT");
    expect(evaluation.realizedR).toBeGreaterThan(5);
    expect(evaluation.decision.evaluationTime).toBe(evaluation.decision.providerEvaluationTime ?? evaluation.decision.evaluationTime);
    expect(evaluation.decision.failedGates).toEqual([]);
    // …and it never enters the recorded aggregate.
    expect(merged.evaluations).toBe(80);
  });
});

function designedRows(): string[][] {
  const INTERVAL = 14_400_000;
  const BASE = 1_780_000_000_000;
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
  return bars.map((bar, i) => [String(BASE + i * INTERVAL), String(bar.o), String(bar.h), String(bar.l), String(bar.c), "1000", "1000", "1000", "1"]);
}
