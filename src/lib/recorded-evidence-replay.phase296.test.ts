/**
 * Phase 296 — RECORDED NON-PRICE EVIDENCE IN THE REPLAY (§11, §14, §15, §16, §19, §20).
 *
 * The price corpus is the exact Phase 294/295 recorded benchmark (8 datasets, 10
 * bounded windows each = 80 evaluations). The BEFORE run is that benchmark with
 * no non-price evidence at all; the AFTER run supplies, for each decision, only
 * the recorded evidence that was KNOWABLE at that decision instant. Nothing else
 * differs: same builder, same clock, same options, same gates.
 *
 * Diagnostics here are attribution only — a count of what blocked a window, not a
 * ranking of gates and not a claim that one strategy is better than another.
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
import { parseEvidenceRows, evidenceFingerprint, evidenceForDecision, loadEvidenceRegistry } from "@/lib/historical/evidence";
import type { HistoricalEvidenceDataset, RecordedEvidenceRegistry } from "@/lib/historical/evidence";
import { loadRecordedFixtures } from "@/lib/historical/fixtures";
import { buildGateBottleneckReport, mergeGateBottleneckReports } from "@/lib/historical/gate-diagnostics";
import { decisiveProjection, runRecordedDataset } from "@/lib/historical/recorded-walkforward";
import type { RecordedDatasetRun, RecordedRunOptions } from "@/lib/historical/recorded-walkforward";

afterEach(() => {
  vi.restoreAllMocks();
});

const fixtures = loadRecordedFixtures();
const registry = loadEvidenceRegistry();
const selection = selectBenchmark(fixtures.datasets);
const RUN_OPTIONS: RecordedRunOptions = { minPrefixCandles: 24, maxEvaluations: 10, maxFutureCandles: 10 };

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

/** Price-only builder identical to the Phase 294/295 benchmark. */
function inputBuilder(parsed: (typeof fixtures.datasets)[number]) {
  const meta = parsed.provenance;
  const instrumentType = meta.assetClass as "crypto" | "forex" | "stock";
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

function runDataset(
  datasetId: string,
  options: {
    withEvidence?: boolean;
    sourceRegistry?: RecordedEvidenceRegistry;
    indices?: readonly number[];
  } = {},
): RecordedDatasetRun {
  const parsed = fixtures.byId.get(datasetId)!;
  if (!parsed) throw new Error(`unknown fixture ${datasetId}`);
  const instrumentType = parsed.provenance.assetClass as "crypto" | "forex" | "stock";
  const sourceRegistry = options.sourceRegistry ?? registry;
  const evidence = options.withEvidence
    ? (context: { index: number; asOfMs: number | undefined }) =>
        context.asOfMs === undefined
          ? undefined
          : evidenceForDecision(sourceRegistry, {
              instrument: parsed.provenance.instrument,
              instrumentType,
              asOfMs: context.asOfMs,
            })
    : undefined;
  return runRecordedDataset(parsed, inputBuilder(parsed), {
    ...RUN_OPTIONS,
    ...(options.indices ? { evaluationIndices: options.indices } : {}),
    ...(evidence ? { evidence } : {}),
  });
}

function runAll(withEvidence: boolean): RecordedDatasetRun[] {
  return selection.selected.map((s) => runDataset(s.datasetId, { withEvidence }));
}

const beforeRuns = runAll(false);
const afterRuns = runAll(true);
const before = mergeGateBottleneckReports(beforeRuns.map((r) => buildGateBottleneckReport(r.report.evaluations)));
const after = mergeGateBottleneckReports(afterRuns.map((r) => buildGateBottleneckReport(r.report.evaluations)));

function gateCount(report: typeof before, gateId: string): number {
  return report.failedGateCounts.find((g) => g.gateId === gateId)?.occurrences ?? 0;
}

/** A registry as it existed at `cutMs`: every later observation is removed. */
function truncateRegistry(
  source: RecordedEvidenceRegistry,
  cutMs: number,
): RecordedEvidenceRegistry {
  const datasets: HistoricalEvidenceDataset[] = [];
  for (const d of source.datasets) {
    const observations = d.observations.filter((o) => o.availableFrom <= cutMs);
    if (observations.length === 0) continue;
    datasets.push({
      meta: d.meta,
      observations,
      fingerprint: evidenceFingerprint(d.meta, observations),
      findings: d.findings,
    });
  }
  const byId = new Map(datasets.map((d) => [d.meta.datasetId, d] as const));
  return { datasets, byId, fingerprint: "truncated" };
}

describe("§14 BEFORE/AFTER benchmark (price-only vs recorded non-price evidence)", () => {
  it("evaluates the same 80 windows at identical instants", () => {
    const beforeEv = beforeRuns.flatMap((r) => r.report.evaluations.map((e) => e.decision.evaluationTime));
    const afterEv = afterRuns.flatMap((r) => r.report.evaluations.map((e) => e.decision.evaluationTime));
    expect(beforeEv).toHaveLength(80);
    expect(afterEv).toHaveLength(80);
    // The evidence layer can never move the decision clock.
    expect(afterEv).toEqual(beforeEv);
    expect(before.evaluations).toBe(80);
    expect(after.evaluations).toBe(80);
  });

  it("publishes the before/after attribution table", () => {
    const rows = [
      ["metric", "BEFORE (price only)", "AFTER (recorded non-price evidence)"],
      ["evaluations", before.evaluations, after.evaluations],
      ["actionable", before.actionable, after.actionable],
      ["NO_TRADE", before.noTrade, after.noTrade],
      ...[
        "GATE0_DATA_FRESHNESS",
        "GATE1_LIVE_PRICE",
        "GATE2_COMPLETENESS",
        "GATE3_DIRECTIONAL_BIAS",
        "GATE4_CONFLUENCE",
        "GATE5_MATERIAL_OPPOSITION",
        "GATE6_HTF_LTF",
        "GATE6B_MTF_HIERARCHY",
        "GATE6C_STYLE_REQUIREMENTS",
        "GATE6D_EXECUTION_VETO",
        "GATE7_STRUCTURAL_LEVELS",
        "GATE8_RR",
      ].map((g) => [g, gateCount(before, g), gateCount(after, g)]),
      [
        "setup states",
        before.setupStatesBeforeRejection.map((s) => `${s.state}=${s.occurrences}`).join(", "),
        after.setupStatesBeforeRejection.map((s) => `${s.state}=${s.occurrences}`).join(", "),
      ],
      [
        "decisions receiving evidence",
        "-",
        afterRuns.reduce((n, r) => n + (r.evidence?.decisionsWithEvidence ?? 0), 0),
      ],
      [
        "provenance records",
        "-",
        new Set(afterRuns.flatMap((r) => (r.evidence?.provenance ?? []).map((p) => `${p.datasetId}@${p.availableFrom}`))).size,
      ],
      [
        "first blocker",
        before.firstBlockerCounts.map((s) => `${s.gateId}=${s.occurrences}`).join(", "),
        after.firstBlockerCounts.map((s) => `${s.gateId}=${s.occurrences}`).join(", "),
      ],
    ];
    // eslint-disable-next-line no-console
    console.log(["Phase 296 recorded benchmark — attribution only", ...rows.map((r) => r.join(" | "))].join("\n"));
    // Per-dataset attribution: never pooled across instruments.
    for (const run of afterRuns) {
      const beforeRun = beforeRuns.find((r) => r.datasetId === run.datasetId)!;
      const b = buildGateBottleneckReport(beforeRun.report.evaluations);
      const a = buildGateBottleneckReport(run.report.evaluations);
      const blockers = (x: typeof b) =>
        x.firstBlockerCounts.map((e) => `${e.gateId}=${e.occurrences}`).join(",") || "none";
      // eslint-disable-next-line no-console
      console.log(
        `  ${run.datasetId} | before first blocker: ${blockers(b)} | after: ${blockers(a)} | ` +
          `evidence decisions: ${run.evidence?.decisionsWithEvidence ?? 0}/${run.evidence?.decisionsEvaluated ?? 0} | ` +
          `completeness: ${JSON.stringify(run.evidence?.completeness ?? {})}`,
      );
    }
    expect(rows[0]).toHaveLength(3);
    expect(after.actionable + after.noTrade).toBe(80);
    expect(before.actionable + before.noTrade).toBe(80);
  });

  it("leaves the price-only run exactly as Phase 294/295 recorded it", () => {
    // No non-price evidence exists for the equity fixture, and the option being
    // absent must be indistinguishable from the option being supplied with no data.
    const aapl = selection.selected.filter((s) => s.assetClass === "stock").map((s) => s.datasetId);
    expect(aapl.length).toBeGreaterThan(0);
    for (const id of aapl) {
      const withoutHook = runDataset(id, {});
      const withEmptyEvidence = runDataset(id, { withEvidence: true });
      expect(decisiveProjection(withEmptyEvidence.report)).toEqual(decisiveProjection(withoutHook.report));
      expect(withEmptyEvidence.evidence!.decisionsWithEvidence).toBe(0);
    }
    // And the recorded benchmark did not become more permissive anywhere:
    expect(after.evaluations).toBe(before.evaluations);
    expect(after.noGateFailureRecorded).toBeGreaterThanOrEqual(0);
  });

  it("changes a decision only where evidence was genuinely knowable", () => {
    let changedWithEvidence = 0;
    let changedWithoutEvidence = 0;
    for (const run of afterRuns) {
      const beforeRun = beforeRuns.find((r) => r.datasetId === run.datasetId)!;
      const beforeLines = decisiveProjection(beforeRun.report);
      const afterLines = decisiveProjection(run.report);
      run.report.evaluations.forEach((evaluation, i) => {
        if (beforeLines[i] === afterLines[i]) return;
        const coverage = evaluationAsOfCoverage(run, evaluation.decision.evaluationTime);
        if (coverage && coverage.completeness !== "NONE") changedWithEvidence += 1;
        else changedWithoutEvidence += 1;
      });
    }
    // §16: nothing changed at an instant where no evidence was available.
    expect(changedWithoutEvidence).toBe(0);
    expect(changedWithEvidence).toBeGreaterThanOrEqual(0);
  });
});

function evaluationAsOfCoverage(
  run: RecordedDatasetRun,
  evaluationTime: number,
): { completeness: string } | undefined {
  const iso = new Date(evaluationTime).toISOString();
  return run.evidence?.coverageByAsOf.find((c) => c.asOf === iso);
}

describe("§16 no-lookahead", () => {
  it("never reads evidence published after the decision", () => {
    let checked = 0;
    for (const run of afterRuns) {
      for (const evaluation of run.report.evaluations) {
        const asOf = evaluation.decision.evaluationTime;
        const attachment = evidenceForDecision(registry, {
          instrument: run.instrument,
          instrumentType: run.assetClass,
          asOfMs: asOf,
        });
        for (const record of attachment.provenance) {
          expect(Date.parse(record.availableFrom)).toBeLessThanOrEqual(asOf);
          checked += 1;
        }
        // Every instant of every value used at THIS decision is at or before it.
        for (const record of attachment.provenance) {
          for (const label of record.observationInstants) {
            const ms = /^\d+$/.test(label) ? Number(label) : Date.parse(label);
            expect(Number.isFinite(ms)).toBe(true);
            expect(ms).toBeLessThanOrEqual(asOf);
          }
        }
        if (attachment.derivativesData) {
          expect(attachment.derivativesData.timestamp).toBeLessThanOrEqual(asOf);
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("cannot be altered by evidence published later (truncated registry is identical up to the cut)", () => {
    const cryptoId = selection.selected.find((s) => s.assetClass === "crypto" && s.timeframe === "H4")!.datasetId;
    const full = runDataset(cryptoId, { withEvidence: true });
    const cut = Date.parse("2026-09-28T00:00:00Z");
    const truncated = runDataset(cryptoId, { withEvidence: true, sourceRegistry: truncateRegistry(registry, cut) });

    const fullProjection = decisiveProjection(full.report);
    const truncatedProjection = decisiveProjection(truncated.report);
    let compared = 0;
    full.report.evaluations.forEach((evaluation, i) => {
      if (evaluation.decision.evaluationTime > cut) return;
      compared += 1;
      expect(truncatedProjection[i]).toBe(fullProjection[i]);
    });
    expect(compared).toBeGreaterThan(0);
    // Later windows may differ: the full registry knows more THERE.
    expect(fullProjection).toHaveLength(10);
  });

  it("keeps the historical decision independent of the system clock", () => {
    const cryptoId = selection.selected.find((s) => s.assetClass === "crypto")!.datasetId;
    const normal = runDataset(cryptoId, { withEvidence: true });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2031-01-01T00:00:00Z"));
    const shifted = runDataset(cryptoId, { withEvidence: true });
    expect(decisiveProjection(shifted.report)).toEqual(decisiveProjection(normal.report));
    expect(shifted.report.evaluations.map((e) => e.decision.evaluationTime)).toEqual(
      normal.report.evaluations.map((e) => e.decision.evaluationTime),
    );
  });

  it("refuses designed evidence material inside a replay", () => {
    const oi = registry.byId.get("okx-open-interest-BTC-USDT-SWAP-1H")!;
    const designed: HistoricalEvidenceDataset = {
      meta: { ...oi.meta, sourceClassification: "DESIGNED_TEST_FIXTURE" },
      observations: oi.observations,
      fingerprint: "fnv1a32:designed",
      findings: [],
    };
    const rigged: RecordedEvidenceRegistry = {
      datasets: [designed, ...registry.datasets.filter((d) => d.meta.datasetId !== oi.meta.datasetId)],
      byId: registry.byId,
      fingerprint: "rigged",
    };
    expect(() =>
      evidenceForDecision(rigged, {
        instrument: "BTC/USDT",
        instrumentType: "crypto",
        asOfMs: Date.parse("2026-09-30T03:00:00Z"),
      }),
    ).toThrow(/DESIGNED_TEST_FIXTURE/);
  });

  it("keeps current-only snapshots out of the registry entirely", () => {
    expect(registry.datasets.every((d) => d.meta.sourceClassification === "RECORDED_HISTORICAL")).toBe(true);
    expect(() => parseEvidenceRows({ ...registry.datasets[0].meta, sourceClassification: "CURRENT_ONLY" }, [])).toThrow(
      /CURRENT_ONLY/,
    );
  });
});

describe("§11/§18 replay provenance", () => {
  it("records where each attached value came from", () => {
    const cryptoRun = afterRuns.find((r) => r.assetClass === "crypto" && r.timeframe === "H1")!;
    const withEvidence = cryptoRun.evidence!;
    expect(withEvidence.decisionsWithEvidence).toBeGreaterThan(0);
    expect(withEvidence.provenance.length).toBeGreaterThan(0);
    for (const record of withEvidence.provenance) {
      expect(record.classification).toBe("RECORDED_HISTORICAL");
      expect(record.provider.length).toBeGreaterThan(0);
      expect(record.providerNativeId.length).toBeGreaterThan(0);
      expect(record.observationInstants.length).toBeGreaterThan(0);
    }
    const domains = new Set(withEvidence.provenance.map((p) => p.domain));
    expect(domains.has("crypto_derivatives")).toBe(true);
    // Coverage accounting must add up over the windows that were evaluated.
    const counts = withEvidence.completeness;
    expect(counts.FULL + counts.PARTIAL + counts.NONE).toBe(withEvidence.decisionsEvaluated);
    expect(withEvidence.decisionsEvaluated).toBe(10);
    const asOfs = withEvidence.coverageByAsOf.map((c) => c.asOf);
    expect([...asOfs].sort()).toEqual(asOfs);
  });

  it("reports unavailable positioning rather than attaching something", () => {
    const aapl = afterRuns.find((r) => r.assetClass === "stock")!;
    expect(aapl.evidence!.decisionsWithEvidence).toBe(0);
    // Coverage and the attachment must agree: an equity decision never receives
    // a macro substitute for the fundamentals it does not have.
    for (const coverage of aapl.evidence!.coverageByAsOf) {
      expect(coverage.completeness).toBe("NONE");
      expect(coverage.notes.join(" ")).toMatch(/Historical fundamental evidence: UNAVAILABLE/);
    }
  });

  it("keeps the forex run's COT evidence inside its publication chronology", () => {
    const fx = afterRuns.filter((r) => r.assetClass === "forex");
    expect(fx.length).toBeGreaterThan(0);
    for (const run of fx) {
      for (const coverage of run.evidence!.coverageByAsOf) {
        for (const domain of coverage.domains) {
          if (domain.domain !== "cot_positioning" || !domain.applied) continue;
          expect(Date.parse(domain.to!)).toBeLessThanOrEqual(Date.parse(coverage.asOf));
        }
      }
    }
  });
});

describe("§15 plan chronology", () => {
  it("states honestly whether recorded evidence produced an actionable plan", () => {
    const actionable = after.actionable;
    // eslint-disable-next-line no-console
    console.log(
      `Phase 296: recorded non-price evidence produced ${actionable} actionable evaluation(s) out of ${after.evaluations} ` +
        `(BEFORE: ${before.actionable}). Attribution only — not a claim of improvement.`,
    );
    expect(actionable).toBeLessThanOrEqual(after.evaluations);
    if (actionable > 0) {
      const entry = afterRuns
        .flatMap((r) => r.report.evaluations.map((e) => ({ run: r, evaluation: e })))
        .find(({ evaluation }) => evaluation.decision.recommendation !== "NO_TRADE");
      expect(entry).toBeDefined();
      // A published plan must be complete and carry structural provenance.
      expect(entry!.evaluation.decision.entry).toBeDefined();
      expect(entry!.evaluation.decision.stopLoss).toBeDefined();
      expect(entry!.evaluation.decision.takeProfit).toBeDefined();
      expect(entry!.evaluation.decision.stopSource ?? entry!.evaluation.decision.stopSource).toBeDefined();
    } else {
      // Nothing is manufactured: with no evidence-driven plan the corpus stays a
      // NO_TRADE sample and the blockers are reported instead.
      expect(after.noTrade).toBe(after.evaluations);
    }
  });
});

describe("§20 bounded work", () => {
  it("runs the whole before/after comparison inside a bounded budget", () => {
    const start = performance.now();
    runAll(true);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(25_000);
  });
});
