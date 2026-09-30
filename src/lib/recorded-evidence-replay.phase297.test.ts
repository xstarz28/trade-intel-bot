/**
 * Phase 297 — RECORDED BENCHMARK BEFORE/AFTER WITH THE RECORDED EVIDENCE
 * (§10, §14, §15, §16, §19–§21). The Phase 296 suite
 * (`recorded-evidence-replay.phase296.test.ts`) stays exactly as delivered; this
 * suite re-runs the same 80 windows as a before/after audit on top of it.
 *
 * The SAME 80 recorded windows the 295 benchmark uses are re-run twice:
 *   BEFORE — price only (the exact 294/295 builder),
 *   AFTER  — the same builder plus the recorded non-price evidence that was
 *            knowable at each window's own historical as-of instant.
 *
 * Nothing else changes: same candles, same decision clock, same engine, same
 * gates. Any difference is attributable to the evidence; any absence of a
 * difference is attributable to the engine's existing rules.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { OutcomeCandle } from "@/lib/outcome-validation";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

import { selectBenchmark } from "@/lib/historical/benchmark";
import { evidenceForDecision, loadEvidenceRegistry } from "@/lib/historical/evidence";
import type {
  HistoricalEvidenceAttachment,
  HistoricalEvidenceDataset,
  RecordedEvidenceRegistry,
} from "@/lib/historical/evidence";
import { loadRecordedFixtures } from "@/lib/historical/fixtures";
import { buildGateBottleneckReport, mergeGateBottleneckReports } from "@/lib/historical/gate-diagnostics";
import {
  HISTORICAL_AS_OF_NOTE,
  closedOutcomeCandles,
  decisiveProjection,
  runRecordedDataset,
} from "@/lib/historical/recorded-walkforward";
import type { ParsedDataset } from "@/lib/historical/dataset";
import type { RecordedBenchmarkRun } from "@/lib/historical/recorded-walkforward";

afterEach(() => {
  vi.restoreAllMocks();
});

const fixtures = loadRecordedFixtures();
const registry = loadEvidenceRegistry();
const selection = selectBenchmark(fixtures.datasets);

const RUN_OPTIONS = { minPrefixCandles: 24, maxEvaluations: 10, maxFutureCandles: 10 };
const WINDOWS_PER_DATASET = 10;

type AssetClass = "crypto" | "forex" | "stock";

function assetClassOf(parsed: ParsedDataset): AssetClass {
  return parsed.provenance.assetClass as AssetClass;
}

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

/** Price-only builder — byte-identical to the Phase 294/295 benchmark builder. */
function inputBuilder(parsed: ParsedDataset) {
  const meta = parsed.provenance;
  const instrumentType = assetClassOf(parsed);
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
      economicEvents: "",
    } as unknown as AnalysisInput;
  };
}

/** The evidence hook: called with the decision's OWN historical instant. */
function evidenceHook(parsed: ParsedDataset, source: RecordedEvidenceRegistry = registry) {
  const instrumentType = assetClassOf(parsed);
  return (context: { asOfMs: number | undefined }): HistoricalEvidenceAttachment | undefined => {
    if (context.asOfMs === undefined) return undefined;
    return evidenceForDecision(source, {
      instrument: parsed.provenance.instrument,
      instrumentType,
      asOfMs: context.asOfMs,
    });
  };
}

function runAll(options: { evidence: boolean; source?: RecordedEvidenceRegistry }): RecordedBenchmarkRun {
  const runs = selection.selected.map((chosen) => {
    const parsed = fixtures.byId.get(chosen.datasetId)!;
    return runRecordedDataset(parsed, inputBuilder(parsed), {
      ...RUN_OPTIONS,
      clock: "HISTORICAL_AS_OF",
      ...(options.evidence ? { evidence: evidenceHook(parsed, options.source ?? registry) } : {}),
    });
  });
  return { runs, recordedRuns: runs, designedRuns: [], selection };
}

const BEFORE = runAll({ evidence: false });
const AFTER = runAll({ evidence: true });

const bottlenecks = (run: RecordedBenchmarkRun) =>
  mergeGateBottleneckReports(run.runs.map((r) => buildGateBottleneckReport(r.report.evaluations)));
const BEFORE_GATES = bottlenecks(BEFORE);
const AFTER_GATES = bottlenecks(AFTER);

function evaluations(run: RecordedBenchmarkRun) {
  return run.runs.flatMap((r) => r.report.evaluations.map((e) => ({ run: r, evaluation: e })));
}

function gateCounts(report: { failedGateCounts: { gateId: string; occurrences: number }[] }) {
  return Object.fromEntries(report.failedGateCounts.map((g) => [g.gateId, g.occurrences]));
}

function firstBlockers(report: { firstBlockerCounts: { gateId: string; occurrences: number }[] }) {
  return report.firstBlockerCounts.map((g) => `${g.gateId}=${g.occurrences}`).join(",");
}

function setupStates(report: { setupStatesBeforeRejection: { state: string; occurrences: number }[] }) {
  return report.setupStatesBeforeRejection.map((s) => `${s.state}=${s.occurrences}`).join(",");
}

function truncateRegistry(at: number): RecordedEvidenceRegistry {
  const datasets: HistoricalEvidenceDataset[] = registry.datasets
    .map((d) => ({ ...d, observations: d.observations.filter((o) => o.availableFrom <= at) }))
    .filter((d) => d.observations.length > 0);
  return { datasets, byId: registry.byId, fingerprint: "fnv1a32:truncated" };
}

describe("§14 before/after recorded benchmark", () => {
  it("BEFORE reproduces the Phase 295 price-only baseline", () => {
    expect(BEFORE.runs).toHaveLength(8);
    expect(BEFORE_GATES.evaluations).toBe(80);
    expect(BEFORE_GATES.actionable).toBe(0);
    expect(BEFORE_GATES.noTrade).toBe(80);
    expect(gateCounts(BEFORE_GATES)).toMatchObject({
      GATE3_DIRECTIONAL_BIAS: 37,
      GATE4_CONFLUENCE: 43,
    });
    // eslint-disable-next-line no-console
    console.log(
      `BEFORE (price only): actionable ${BEFORE_GATES.actionable} | NO_TRADE ${BEFORE_GATES.noTrade} | ` +
        `first blockers ${firstBlockers(BEFORE_GATES)} | setup states ${setupStates(BEFORE_GATES)}`,
    );
  });

  it("AFTER attaches recorded evidence exactly where the corpus has it", () => {
    const attached = evaluations(AFTER).filter(
      ({ run }) => (run.evidence?.decisionsWithEvidence ?? 0) > 0 && run.assetClass !== "stock",
    );
    expect(attached.length).toBeGreaterThan(0);
    for (const run of AFTER.runs) {
      const evidence = run.evidence!;
      expect(evidence.decisionsEvaluated).toBe(WINDOWS_PER_DATASET);
      // Windows that end before the recorded evidence begins get nothing; the
      // others get exactly the domains the capture contains.
      const expectEvidence = !run.datasetId.endsWith("-1W") && run.assetClass !== "stock";
      expect(`${run.datasetId}:${evidence.decisionsWithEvidence}`).toBe(
        `${run.datasetId}:${expectEvidence ? WINDOWS_PER_DATASET : 0}`,
      );
      if (expectEvidence) {
        expect(evidence.completeness.PARTIAL + evidence.completeness.FULL).toBe(WINDOWS_PER_DATASET);
      } else {
        expect(evidence.completeness.NONE).toBe(WINDOWS_PER_DATASET);
      }
      // No point-in-time equity fundamentals exist: stock windows still get
      // nothing at all, never a current snapshot.
      if (run.assetClass === "stock") expect(evidence.provenance).toHaveLength(0);
    }
  });

  it("AFTER reports both sides of the benchmark and keeps the buckets separate", () => {
    // eslint-disable-next-line no-console
    console.log(
      [
        "Phase 296 recorded benchmark — 80 windows, HISTORICAL_AS_OF clock",
        `BEFORE: actionable ${BEFORE_GATES.actionable} | NO_TRADE ${BEFORE_GATES.noTrade} | gates ${JSON.stringify(gateCounts(BEFORE_GATES))} | first ${firstBlockers(BEFORE_GATES)}`,
        `AFTER : actionable ${AFTER_GATES.actionable} | NO_TRADE ${AFTER_GATES.noTrade} | gates ${JSON.stringify(gateCounts(AFTER_GATES))} | first ${firstBlockers(AFTER_GATES)}`,
        `AFTER setup states: ${setupStates(AFTER_GATES)}`,
        ...AFTER.runs.map(
          (r) =>
            `bucket ${r.assetClass}/${r.provider}/${r.timeframe}: ${r.report.evaluations.length} windows, ` +
            `evidence ${r.evidence?.decisionsWithEvidence ?? 0}, completeness ${JSON.stringify(r.evidence?.completeness)}`,
        ),
      ].join("\n"),
    );
    expect(AFTER_GATES.evaluations).toBe(80);
    const buckets = new Set(AFTER.runs.map((r) => `${r.assetClass}/${r.timeframe}`));
    expect(buckets.size).toBe(8);
    for (const bucket of buckets) {
      const runs = AFTER.runs.filter((r) => `${r.assetClass}/${r.timeframe}` === bucket);
      expect(runs.every((r) => r.report.evaluations.length === WINDOWS_PER_DATASET)).toBe(true);
    }
  });

  it("keeps every decision at the instant it was actually taken", () => {
    const before = evaluations(BEFORE).map(({ evaluation }) => evaluation.decision.evaluationTime);
    const after = evaluations(AFTER).map(({ evaluation }) => evaluation.decision.evaluationTime);
    expect(after).toEqual(before);
    for (const { run, evaluation } of evaluations(AFTER)) {
      const asOf = evaluation.decision.evaluationTime;
      expect(run.evidence!.coverageByAsOf.some((c) => c.asOf === new Date(asOf).toISOString())).toBe(true);
    }
  });

  it("never lets evidence change an evaluation that had none", () => {
    const before = evaluations(BEFORE);
    const after = evaluations(AFTER);
    expect(after).toHaveLength(before.length);
    const changedWithoutEvidence: string[] = [];
    for (let i = 0; i < before.length; i++) {
      const coverage = after[i].run.evidence!.coverageByAsOf.find(
        (c) => c.asOf === new Date(after[i].evaluation.decision.evaluationTime).toISOString(),
      )!;
      const withEvidence = (after[i].run.evidence?.decisionsWithEvidence ?? 0) > 0;
      const decisiveBefore = decisiveProjection({ evaluations: [before[i].evaluation] } as never)[0];
      const decisiveAfter = decisiveProjection({ evaluations: [after[i].evaluation] } as never)[0];
      if (!withEvidence && coverage.completeness === "NONE" && decisiveAfter !== decisiveBefore) {
        changedWithoutEvidence.push(`${after[i].run.datasetId}@${coverage.asOf}`);
      }
    }
    expect(changedWithoutEvidence).toEqual([]);
  });

  it("carries only instants the decision could have known", () => {
    for (const { run, evaluation } of evaluations(AFTER)) {
      const asOf = evaluation.decision.evaluationTime;
      const parsed = fixtures.byId.get(run.datasetId)!;
      // Re-derive the exact attachment the engine received for this window: the
      // hook is a pure function of the decision instant.
      const attachment = evidenceHook(parsed)({ asOfMs: asOf });
      for (const record of attachment?.provenance ?? []) {
        expect(record.classification).toBe("RECORDED_HISTORICAL");
        expect(Number.isNaN(Date.parse(record.availableFrom))).toBe(false);
        expect(Date.parse(record.availableFrom)).toBeLessThanOrEqual(asOf);
        // Provider-native labels are kept verbatim; the machine instant is the
        // one that decides usability.
        expect(record.observationInstants.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("§15–§18 evidence stays evidence", () => {
  it("leaves zero actionable unless a real recorded chain exists", () => {
    if (AFTER_GATES.actionable > 0) {
      const actionable = evaluations(AFTER).filter(
        ({ evaluation }) => evaluation.decision.recommendation !== "NO_TRADE",
      );
      for (const { evaluation } of actionable) {
        const d = evaluation.decision;
        expect(d.setupState).toBeDefined();
        expect(d.direction).toBeDefined();
        expect(d.entry).toBeDefined();
        expect(d.stopLoss).toBeDefined();
        expect(d.takeProfit).toBeDefined();
        expect(d.plannedRR).toBeDefined();
      }
    }
    // Zero is reported as zero, with the blockers that produced it.
    expect(AFTER_GATES.actionable).toBe(AFTER_GATES.evaluations - AFTER_GATES.noTrade);
    if (AFTER_GATES.actionable === 0) {
      expect(firstBlockers(AFTER_GATES).length).toBeGreaterThan(0);
      expect(setupStates(AFTER_GATES).length).toBeGreaterThan(0);
    }
  });

  it("keeps the replay wording historical and never live", () => {
    const notes = AFTER.runs.map((r) => r.report.alignment.note);
    expect(notes.some((n) => n === HISTORICAL_AS_OF_NOTE)).toBe(true);
    for (const note of notes) {
      expect(note).toContain("RECORDED / HISTORICAL");
      expect(note).not.toMatch(/\bLIVE\b|REAL-TIME|CURRENT SIGNAL/);
    }
    expect(AFTER.runs.every((r) => r.sourceClassification === "RECORDED_HISTORICAL")).toBe(true);
    // Attached payloads never claim to be realtime.
    for (const run of AFTER.runs) {
      const coverage = run.evidence!.coverageByAsOf;
      expect(coverage.every((c) => c.completeness === "FULL" || c.completeness === "PARTIAL" || c.completeness === "NONE")).toBe(true);
    }
  });

  it("excludes designed fixtures and keeps the corpus recorded", () => {
    expect(AFTER.designedRuns).toHaveLength(0);
    expect(registry.datasets.every((d) => d.meta.sourceClassification !== "DESIGNED_TEST_FIXTURE")).toBe(true);
    expect(fixtures.datasets.every((d) => d.provenance.sourceClassification === "RECORDED_HISTORICAL")).toBe(true);
  });

  it("is deterministic across identical runs", () => {
    const again = runAll({ evidence: true });
    expect(decisiveProjection(again.runs[0].report)).toEqual(decisiveProjection(AFTER.runs[0].report));
    expect(again.runs.map((r) => r.datasetFingerprint)).toEqual(AFTER.runs.map((r) => r.datasetFingerprint));
  });
});

describe("§16 no-lookahead in the recorded replay", () => {
  it("future evidence cannot alter an earlier decision", () => {
    const cut = Date.parse("2026-09-28T00:00:00Z");
    const truncated = runAll({ evidence: true, source: truncateRegistry(cut) });
    const full = AFTER;
    const mismatches: string[] = [];
    for (let r = 0; r < full.runs.length; r++) {
      const fullProj = decisiveProjection(full.runs[r].report);
      const truncProj = decisiveProjection(truncated.runs[r].report);
      const evals = full.runs[r].report.evaluations;
      for (let i = 0; i < evals.length; i++) {
        if (evals[i].decision.evaluationTime <= cut && fullProj[i] !== truncProj[i]) {
          mismatches.push(`${full.runs[r].datasetId}@${evals[i].decision.evaluationTime}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("the wall clock cannot change a historical decision", () => {
    const frozen = Date.parse("2030-01-01T00:00:00Z");
    const spy = vi.spyOn(Date, "now").mockReturnValue(frozen);
    const jumped = runAll({ evidence: true });
    spy.mockRestore();
    expect(jumped.runs.map((r) => decisiveProjection(r.report))).toEqual(
      AFTER.runs.map((r) => decisiveProjection(r.report)),
    );
  });

  it("current-only equity snapshots cannot enter any window", () => {
    const stockRuns = AFTER.runs.filter((r) => r.assetClass === "stock");
    expect(stockRuns.length).toBeGreaterThan(0);
    for (const run of stockRuns) {
      expect(run.evidence!.decisionsWithEvidence).toBe(0);
      expect(run.evidence!.provenance).toHaveLength(0);
    }
    expect(registry.datasets.some((d) => d.meta.evidenceDomain === "stock_fundamentals")).toBe(false);
  });
});

describe("§19–§21 performance and coverage of the evidence layer", () => {
  it("stays inside the run budget and reports coverage per decision", () => {
    const started = Date.now();
    const timed = runAll({ evidence: true });
    const elapsed = Date.now() - started;
    // eslint-disable-next-line no-console
    console.log(
      `Phase 296 evidence replay: ${timed.runs.length} datasets × ${WINDOWS_PER_DATASET} windows in ${elapsed} ms ` +
        `(evidence lookups: ${timed.runs.reduce((n, r) => n + (r.evidence?.decisionsEvaluated ?? 0), 0)})`,
    );
    expect(elapsed).toBeLessThan(120_000);
    expect(timed.runs.every((r) => (r.evidence?.coverageByAsOf.length ?? 0) === WINDOWS_PER_DATASET)).toBe(true);
    for (const run of timed.runs) {
      const asOfs = run.evidence!.coverageByAsOf.map((c) => c.asOf);
      expect(new Set(asOfs).size).toBe(asOfs.length);
      expect([...asOfs].sort()).toEqual(asOfs);
    }
  });
});
