/**
 * Phase 293 — STRICT WALK-FORWARD EVALUATION THROUGH THE REAL ENGINE.
 *
 * The evaluator is not a second implementation of the analysis: it runs the
 * PRODUCTION engine on the candle prefix that existed at the evaluation
 * instant, then reads the following candles ONLY to classify what happened.
 *
 *   PAST → DECISION        (engine, unchanged)
 *   FUTURE → OUTCOME ONLY  (evaluator)
 *
 * The suite proves the separation both ways: identical prefixes must decide
 * identically no matter what follows them, and different futures must change
 * only the OUTCOME, never the plan.
 *
 * Timeline note: the engine's freshness gate compares the price snapshot with
 * the wall clock (a live-transport safety rule). A historical replay therefore
 * aligns each evaluation window to the observation instant with ONE constant
 * shift that preserves every bar's distance from the decision candle; the
 * decision keeps the bar's own provider instant, and the alignment is recorded
 * in the report.
 */
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import {
  formatValidationDiagnostics,
  runWalkForward,
  type OutcomeCandle,
  toEmpiricalValidationFields,
  type OutcomeValidationReport,
} from "@/lib/outcome-validation";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

const INTERVAL = 4 * 3600_000;

/** The committed Phase 292/293 designed price path, indices 0…199. */
function basePath(): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  const push = (i: number, o: number, h: number, l: number, c: number) =>
    out.push({ timestamp: i * INTERVAL, open: o, high: h, low: l, close: c, volume: 1000 });
  for (let i = 0; i < 121; i++) { const p = 100 + i * 0.5; push(i, p - 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 121; i < 125; i++) { const p = 160 + (i - 120) * 2.1; push(i, p - 0.5, p + 0.5, p - 1, p); }
  push(125, 169, 169.5, 167, 168);
  for (let i = 126; i < 138; i++) { const p = 168 - (i - 125) * 0.65; push(i, p + 0.2, p + 0.6, p - 0.8, p); }
  for (let i = 138; i < 152; i++) { const p = 160 + (i - 138) * 1.15; push(i, p - 0.3, p + 0.5, p - 0.9, p); }
  for (let i = 152; i < 169; i++) { const p = 176 - (i - 151) * 0.82; push(i, p + 0.3, p + 0.7, p - 0.7, p); }
  for (let i = 169; i < 200; i++) { const p = 162 + (i - 168) * 0.05; push(i, p - 0.2, p + 0.4, p - 0.5, p); }
  return out;
}

/** The full walk-forward series: the designed path plus an outcome segment. */
function fullSeries(): OhlcvCandle[] {
  const out = basePath();
  const push = (i: number, o: number, h: number, l: number, c: number) =>
    out.push({ timestamp: i * INTERVAL, open: o, high: h, low: l, close: c, volume: 1000 });
  for (let i = 200; i < 216; i++) { const p = 164 + (i - 199) * 0.8; push(i, p - 0.3, p + 0.5, p - 0.6, p); }
  for (let i = 216; i < 232; i++) { const p = 177 - (i - 215) * 1.1; push(i, p + 0.3, p + 0.6, p - 0.8, p); }
  for (let i = 232; i < 250; i++) { const p = 160 + (i - 231) * 0.02; push(i, p - 0.2, p + 0.3, p - 0.4, p); }
  return out;
}

/** Same prefix, different future — used to prove decisions never see the future. */
function withTail(tail: Array<{ high: number; low: number; close: number }>): OhlcvCandle[] {
  const out = basePath();
  tail.forEach((bar, k) => {
    const index = 200 + k;
    out.push({ timestamp: index * INTERVAL, open: bar.close, high: bar.high, low: bar.low, close: bar.close, volume: 1000 });
  });
  return out;
}

function techFor(candles: readonly OhlcvCandle[]): TechnicalData {
  const c = candles as OhlcvCandle[];
  const smc = computeSmcContext(c, "H4");
  return {
    ...calculateTechnical(c, c, "D1"),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc,
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles: c },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles: c } satisfies MtfCandleInput)),
    ]),
  };
}

function buildInput(prefix: readonly OutcomeCandle[], index?: number): AnalysisInput {
  void index;
  const candles = prefix as OhlcvCandle[];
  const last = candles[candles.length - 1];
  return {
    instrument: "TEST/USD",
    instrumentType: "forex",
    timeframe: "H4" as Timeframe,
    provider: "fixture",
    providerInstrumentId: "TEST/USD",
    marketData: {
      instrument: "TEST/USD",
      instrumentType: "forex",
      provider: "fixture",
      providerInstrumentId: "TEST/USD",
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: "fixture" },
      candles,
      timeframe: "H4",
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: techFor(candles),
    economicEvents: "Fed signals hawkish stance, rate hike",
  } as AnalysisInput;
}
// The engine's freshness/future-skew gates are wall-clock rules; a historical
// replay therefore presents each window as of the observation instant. One
// module-level instant is used by every run in this suite, so all comparisons
// are made against an identical observation clock.
const NOW = Date.now();
const ALIGNMENT = { mode: "WALL_CLOCK_ALIGNED" as const, nowMs: NOW, note: "designed fixture, observation-aligned" };

function run(series: OhlcvCandle[], over: Partial<Parameters<typeof runWalkForward>[2]> = {}): OutcomeValidationReport {
  return runWalkForward(series, buildInput, {
    alignment: ALIGNMENT,
    maxEvaluations: 15,
    maxFutureCandles: 60,
    minPrefixCandles: 60,
    ...over,
  });
}

const SERIES = fullSeries();
const REPORT = run(SERIES);
const planned = REPORT.evaluations.filter((e) => e.decision.direction !== undefined);

// ── A. The walk-forward reaches real plans through the production gate ──

describe("Phase 293 — the walk-forward runs the production engine, not a reimplementation", () => {
  it("evaluates a bounded, deterministic set of prefixes", () => {
    expect(REPORT.evaluations.length).toBe(15);
    expect(REPORT.limits.maxEvaluations).toBe(15);
    expect(REPORT.evaluations[REPORT.evaluations.length - 1].decision.evaluationIndex).toBe(241);
    // Explicit windows are honoured (and bounded) when a chronology is pinned.
    const pinned = run(SERIES, { evaluationIndices: [199, 175, 240], maxEvaluations: 2 });
    expect(pinned.evaluations.map((e) => e.decision.evaluationIndex)).toEqual([175, 199]);
    expect(REPORT.modelVersion).toMatch(/^phase293\./);
    const indices = REPORT.evaluations.map((e) => e.decision.evaluationIndex);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("reproduces the engine's own decision for the same prefix", () => {
    const evaluation = REPORT.evaluations[REPORT.evaluations.length - 1];
    const aligned = SERIES.slice(0, evaluation.decision.evaluationIndex + 1).map((c) => ({
      ...c,
      timestamp: c.timestamp + (NOW - evaluation.decision.evaluationTime),
    }));
    const direct = runAnalysis(buildInput(aligned));
    expect(direct.recommendation).toBe(evaluation.decision.recommendation);
    expect(direct.tradeLocation?.context.state).toBe(evaluation.decision.setupState);
    if (evaluation.decision.direction) {
      expect(parseFloat(direct.tradePlan!.entry)).toBeCloseTo(evaluation.decision.entry!, 9);
      expect(parseFloat(direct.tradePlan!.stopLoss)).toBeCloseTo(evaluation.decision.stopLoss!, 9);
      expect(parseFloat(direct.tradePlan!.takeProfit)).toBeCloseTo(evaluation.decision.takeProfit!, 9);
    }
  });

  it("produces the decision's plan facts verbatim and keeps the provider instant", () => {
    for (const e of planned) {
      expect(e.decision.entry).toBeGreaterThan(0);
      expect(e.decision.stopLoss!).toBeLessThan(e.decision.entry!);
      expect(e.decision.takeProfit!).toBeGreaterThan(e.decision.entry!);
      expect(e.decision.riskDistance).toBeCloseTo(Math.abs(e.decision.entry! - e.decision.stopLoss!), 9);
      // The bar's own provider timestamp survives the alignment.
      expect(e.decision.providerEvaluationTime).toBe(e.decision.evaluationIndex * INTERVAL);
      expect(e.decision.evaluationTime).toBe(NOW);
      expect(REPORT.alignment.mode).toBe("WALL_CLOCK_ALIGNED");
    }
  });

  it("is repeatable: identical inputs produce byte-identical reports", () => {
    const again = run(fullSeries());
    expect(JSON.stringify(again)).toBe(JSON.stringify(REPORT));
  });

  it("reports a spread of real outcomes", () => {
    expect(REPORT.sample.plannedTrades).toBeGreaterThanOrEqual(3);
    expect(REPORT.sample.targetHits).toBeGreaterThanOrEqual(1);
    expect(REPORT.sample.stopHits).toBeGreaterThanOrEqual(1);
    expect(REPORT.sample.noTrade).toBeGreaterThanOrEqual(1);
  });
});

// ── B. Causality: PAST → DECISION, FUTURE → OUTCOME ONLY ──

describe("Phase 293 — no future information flows back into a decision", () => {
  it("A. adding future candles cannot change an earlier decision", () => {
    const shorter = SERIES.slice(0, 200);
    const shortReport = run(shorter, { maxEvaluations: 15, minPrefixCandles: 60 });
    const longReport = run(SERIES, { maxEvaluations: 15, minPrefixCandles: 60 });
    const decisions = (r: OutcomeValidationReport) =>
      new Map(r.evaluations.map((e) => [e.decision.evaluationIndex, JSON.stringify(e.decision)]));
    const shortMap = decisions(shortReport);
    const longMap = decisions(longReport);
    let compared = 0;
    for (const [index, json] of shortMap) {
      if (!longMap.has(index)) continue;
      // The extra 50 candles exist only AFTER these decisions — nothing changes.
      expect(longMap.get(index)).toBe(json);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(2);
  });

  it("B. a future structural event cannot create a historical setup", () => {
    for (const e of REPORT.evaluations) {
      const prefix = SERIES.slice(0, e.decision.evaluationIndex + 1).map((c) => ({
        ...c,
        timestamp: c.timestamp + (NOW - e.decision.evaluationTime),
      }));
      const truncated = runAnalysis(buildInput(prefix));
      expect(truncated.tradeLocation?.context.state ?? "NO_LOCATION").toBe(e.decision.setupState);
      expect(truncated.tradeLocation?.location ?? "no_location").toBe(e.decision.location);
      // No structural event in the read can be dated after the prefix.
      const read = truncated.technicalData?.smc?.structural?.external;
      if (read) for (const ev of read.events) expect(ev.candleIndex).toBeLessThan(prefix.length);
    }
  });

  it("C. a future sweep cannot make earlier liquidity appear swept", () => {
    for (const e of REPORT.evaluations) {
      const prefix = SERIES.slice(0, e.decision.evaluationIndex + 1).map((c) => ({
        ...c,
        timestamp: c.timestamp + (NOW - e.decision.evaluationTime),
      }));
      const truncated = runAnalysis(buildInput(prefix));
      const sweep = truncated.tradeLocation?.liquidity.sweep;
      if (sweep) expect(sweep.candleIndex).toBeLessThan(prefix.length);
      expect(e.decision.sweepPresent).toBe(sweep !== undefined);
      // Pools the truncated read already knows cannot have been swept later.
      for (const pool of truncated.technicalData?.smc?.liquidityPools ?? []) {
        if (pool.swept && pool.sweptAtIndex !== undefined) {
          expect(pool.sweptAtIndex).toBeLessThan(prefix.length);
        }
      }
    }
  });

  it("D. a future mitigation cannot change an earlier FVG state", () => {
    for (const e of REPORT.evaluations) {
      const prefix = SERIES.slice(0, e.decision.evaluationIndex + 1).map((c) => ({
        ...c,
        timestamp: c.timestamp + (NOW - e.decision.evaluationTime),
      }));
      const truncated = runAnalysis(buildInput(prefix));
      const zones = truncated.tradeLocation?.zones ?? [];
      for (const zone of zones) {
        // The zone's own state and formation candle belong to the prefix.
        expect(zone.createdAtIndex).toBeLessThan(prefix.length);
        expect(zone.knownAtIndex).toBeLessThan(prefix.length);
        expect(zone.status).not.toBe(undefined);
      }
      expect(truncated.tradeLocation?.flags.insideFvg).toBe(
        !!e.decision.fvgEngaged || !!truncated.tradeLocation?.flags.atFvgBoundary,
      );
    }
  });

  it("E. a future OB validation cannot appear in an earlier candle", () => {
    for (const e of REPORT.evaluations) {
      const prefix = SERIES.slice(0, e.decision.evaluationIndex + 1).map((c) => ({
        ...c,
        timestamp: c.timestamp + (NOW - e.decision.evaluationTime),
      }));
      const truncated = runAnalysis(buildInput(prefix));
      for (const ob of truncated.technicalData?.smc?.orderBlocks ?? []) {
        if (ob.validatedAtIndex !== undefined) expect(ob.validatedAtIndex).toBeLessThan(prefix.length);
        expect(ob.sourceIndex).toBeLessThan(prefix.length);
        expect(ob.status).not.toBe("validated_by_future_event");
      }
    }
  });

  it("F. future targets and stops affect only the OUTCOME, never the plan", () => {
    // The SAME prefix (0…199) is followed by four different futures.
    const variants = {
      target: withTail([{ high: 176, low: 162, close: 175 }, { high: 176.5, low: 174, close: 176 }]),
      stop: withTail([{ high: 164, low: 160.9, close: 161 }, { high: 161.5, low: 160.5, close: 160.8 }]),
      both: withTail([{ high: 176, low: 160.9, close: 163.5 }]),
      flat: withTail([{ high: 164.5, low: 162.5, close: 163 }, { high: 164.6, low: 162.6, close: 163.2 }, { high: 164.7, low: 162.7, close: 163.3 }]),
    };
    const decisions: string[] = [];
    const outcomes: string[] = [];
    for (const series of Object.values(variants)) {
      const r = run(series, { evaluationIndices: [199], minPrefixCandles: 60 });
      const e = r.evaluations.find((x) => x.decision.evaluationIndex === 199)!;
      decisions.push(JSON.stringify(e.decision));
      outcomes.push(e.outcome);
    }
    // One identical plan, four different futures.
    expect(new Set(decisions).size).toBe(1);
    expect(outcomes).toEqual(["TARGET_HIT", "STOP_HIT", "AMBIGUOUS_PATH", "TIME_EXPIRED"]);
  });

  it("G. identical prefixes decide identically across independent runs", () => {
    const runOne = run(SERIES, { maxEvaluations: 5, minPrefixCandles: 60 });
    const runTwo = run(SERIES, { maxEvaluations: 5, minPrefixCandles: 60 });
    expect(JSON.stringify(runOne.evaluations.map((e) => e.decision))).toBe(
      JSON.stringify(runTwo.evaluations.map((e) => e.decision)),
    );
    expect(JSON.stringify(runOne)).toBe(JSON.stringify(runTwo));
  });

  it("H. extending the outcome window changes resolution only, never the decision", () => {
    const short = run(SERIES, { maxEvaluations: 15, maxFutureCandles: 3 });
    const long = run(SERIES, { maxFutureCandles: 60 });
    expect(JSON.stringify(short.evaluations.map((e) => e.decision))).toBe(
      JSON.stringify(long.evaluations.map((e) => e.decision)),
    );
    // And the extension can genuinely change what is known about the outcome.
    const changed = short.evaluations.filter((e, i) => e.outcome !== long.evaluations[i].outcome);
    expect(changed.length).toBeGreaterThan(0);
    for (const e of short.evaluations) {
      if (e.outcome === "TIME_EXPIRED") expect(e.futureCandlesConsidered).toBeLessThanOrEqual(3);
    }
  });
});

// ── C. Aggregation over real engine decisions ──

describe("Phase 293 — setup-state and MTF observations", () => {
  it("groups real outcomes by the exact Phase 291 states", () => {
    const labels = REPORT.bySetupState.map((b) => b.label);
    for (const label of labels) {
      expect([
        "NO_SETUP_EVIDENCE",
        "LOCATION_ONLY",
        "STRUCTURAL_SETUP",
        "CONFIRMED_SETUP_CONTEXT",
        "COUNTER_TREND_SETUP",
        "INVALID_SETUP_CONTEXT",
        "NO_LOCATION",
      ]).toContain(label);
    }
    const structural = REPORT.bySetupState.find((b) => b.label === "STRUCTURAL_SETUP")!;
    expect(structural.occurrences).toBeGreaterThan(0);
    // The real plans came from this state in this fixture, and it is reported as
    // insufficient rather than as a quality claim.
    expect(structural.sampleSufficient).toBe(false);
    expect(structural.insufficientReason).toMatch(/sample floor/);
  });

  it("groups by direction, timeframe, HTF alignment and evidence flags", () => {
    const direction = REPORT.byDirection.find((b) => b.label === "long")!;
    expect(direction.planned).toBeGreaterThan(0);
    expect(REPORT.byTimeframe.every((b) => b.label === "H4")).toBe(true);
    expect(REPORT.byHtfAlignment.length).toBeGreaterThan(0);
    const engaged = REPORT.byFlags.find((b) => b.label.includes("fvg"))!;
    expect(engaged.occurrences).toBeGreaterThan(0);
    // Every slice is observational: no ordering or composite score exists.
    expect(Object.keys(REPORT.byFlags[0])).not.toContain("rank");
  });

  it("keeps the confidence buckets descriptive and insufficient at this sample", () => {
    expect(REPORT.calibration.status).toBe("INSUFFICIENT_SAMPLE");
    expect(REPORT.calibration.productionConfidenceUnchanged).toBe(true);
    const totalOccurrences = REPORT.calibration.buckets.reduce((a, b) => a + b.occurrences, 0);
    expect(totalOccurrences).toBe(REPORT.evaluations.length);
    // The engine's own confidence values were read, never rewritten.
    for (const e of REPORT.evaluations) {
      expect(e.decision.confidence).toBeGreaterThanOrEqual(20);
      expect(e.decision.confidence).toBeLessThanOrEqual(90);
    }
  });

  it("reports expectancy with explicit exclusions", () => {
    const exp = REPORT.expectancy;
    expect(exp.sampleSize).toBe(REPORT.sample.targetHits + REPORT.sample.stopHits + REPORT.sample.invalidationHits);
    expect(exp.excluded.noTrade).toBe(REPORT.sample.noTrade);
    expect(exp.excluded.ambiguous).toBe(REPORT.sample.ambiguous);
    expect(exp.sampleSufficient).toBe(false);
    expect(exp.method).toMatch(/mean realized R/);
  });

  it("renders factual diagnostics and no marketing language", () => {
    const lines = formatValidationDiagnostics(REPORT).join("\n");
    expect(lines).toContain(`Historical sample: ${REPORT.sample.evaluations}`);
    expect(lines).toContain(`Planned trades: ${REPORT.sample.plannedTrades}`);
    expect(lines).toMatch(/INSUFFICIENT SAMPLE|insufficient sample/i);
    expect(lines).not.toMatch(/accurate|probability|guaranteed|predicts/i);
  });
});

// ── D. Performance safety: bounded evaluation, not a quadratic sweep ──

describe("Phase 293 — performance safety", () => {
  it("walks a long series with a bounded number of engine runs (§12)", () => {
    // A 3,000-candle series: the driver must not run the engine once per candle.
    const long: OhlcvCandle[] = [];
    for (let i = 0; i < 3_000; i++) {
      const p = 100 + Math.sin(i / 40) * 4 + i * 0.01;
      long.push({ timestamp: i * INTERVAL, open: p - 0.2, high: p + 0.6, low: p - 0.8, close: p, volume: 1000 });
    }
    let calls = 0;
    const counting = (prefix: readonly OutcomeCandle[], index: number) => {
      calls++;
      return buildInput(prefix, index);
    };
    const report = runWalkForward(long, counting, {
      alignment: ALIGNMENT,
      maxEvaluations: 5,
      maxFutureCandles: 20,
      minPrefixCandles: 60,
    });
    expect(calls).toBeLessThanOrEqual(5);
    expect(report.evaluations.length).toBeLessThanOrEqual(5);
    // The walk still spans the dataset rather than stopping early.
    expect(report.evaluations[report.evaluations.length - 1].decision.evaluationIndex).toBeGreaterThan(2_900);
    for (const e of report.evaluations) expect(e.futureCandlesConsidered).toBeLessThanOrEqual(20);
  });
});

// ── E. Recommendation/radar observational fields (no feedback) ──

describe("Phase 293 — the empirical layer is observational for the recommendation surface", () => {
  it("exposes sample, coverage, realized R, calibration and sufficiency — flagged as non-deciding", () => {
    const fields = toEmpiricalValidationFields(REPORT);
    expect(fields.historicalSampleSize).toBe(REPORT.sample.evaluations);
    expect(fields.resolvedSampleSize).toBe(REPORT.sample.resolved - REPORT.sample.timeExpired);
    expect(fields.outcomeCoverage).toBeCloseTo(REPORT.sample.resolved / REPORT.sample.evaluations, 9);
    expect(fields.calibrationStatus).toBe("INSUFFICIENT_SAMPLE");
    expect(fields.evidenceSufficiency.status).toBe("INSUFFICIENT_SAMPLE");
    expect(fields.empiricalRealizedR!.mean).toBeCloseTo(REPORT.expectancy.meanRealizedR!, 9);
    expect(fields.empiricalRealizedR!.sampleSufficient).toBe(false);
    expect(fields.affectsProductionDecision).toBe(false);
  });

  it("attaching a report cannot change what the engine decides", () => {
    const evaluation = planned[0];
    const prefix = SERIES.slice(0, evaluation.decision.evaluationIndex + 1).map((c) => ({
      ...c,
      timestamp: c.timestamp + (NOW - evaluation.decision.evaluationTime),
    }));
    // The result carries a wall-clock analysis id, so compare the fields that
    // carry the DECISION — attaching empirical reporting must not move any.
    const decisive = (r: ReturnType<typeof runAnalysis>) =>
      JSON.stringify({
        recommendation: r.recommendation,
        bias: r.bias,
        confidence: r.confidence,
        setupState: r.tradeLocation?.context.state,
        plan: r.tradePlan,
        status: r.decisionTrace?.tradePlanStatus?.present,
      });
    const before = decisive(runAnalysis(buildInput(prefix)));
    const fields = toEmpiricalValidationFields(REPORT);
    const after = decisive(runAnalysis(buildInput(prefix)));
    expect(after).toBe(before);
    expect(fields.affectsProductionDecision).toBe(false);
  });
});
