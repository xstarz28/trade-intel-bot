/**
 * Phase 293 — OUTCOME MODEL, AGGREGATION, CALIBRATION, JOURNAL BRIDGE.
 *
 * These tests pin the empirical layer's honesty rules:
 *
 *   · every outcome state is distinguishable, and an ambiguous same-candle path
 *     is never collapsed into a win or a loss;
 *   · realized R exists only for genuinely closed outcomes — a horizon is a
 *     mark-to-market, labelled as such;
 *   · MFE/MAE are excursions of the observed future window, in R;
 *   · aggregates are marked insufficient below an explicit sample floor;
 *   · calibration NEVER turns the engine's confidence into a probability claim,
 *     and nothing is written back into production confidence;
 *   · expectancy reuses the journal's own accounting vocabulary.
 */
import { describe, expect, it } from "vitest";

import {
  CALIBRATION_MIN_RESOLVED,
  MIN_RESOLVED_FOR_AGGREGATE,
  OUTCOME_MODEL_VERSION,
  aggregateBy,
  calibrateConfidence,
  computeRealizedExpectancy,
  decisionFromResult,
  evaluateOutcome,
  formatValidationDiagnostics,
  sampleCounts,
  toJournalOutcome,
  type OutcomeCandle,
  type OutcomeEvaluation,
  type WalkForwardDecision,
} from "./outcome-validation";

// ── Deterministic helpers ────────────────────────────────────────

function candle(t: number, high: number, low: number, close?: number, open?: number): OutcomeCandle {
  return { timestamp: t, open: open ?? (high + low) / 2, high, low, close: close ?? (high + low) / 2 };
}

/** A long plan: entry 100, published stop 95 (R = 5), target 110, invalidation 99. */
function longDecision(over: Partial<WalkForwardDecision> = {}): WalkForwardDecision {
  return {
    evaluationIndex: 10,
    evaluationTime: 1_000_000,
    recommendation: "LONG",
    bias: "Bullish",
    confidence: 62,
    conviction: "Medium",
    setupState: "CONFIRMED_SETUP_CONTEXT",
    location: "inside_fvg",
    timeframe: "H4",
    provider: "fixture",
    instrument: "TEST/USD",
    direction: "long",
    entry: 100,
    stopLoss: 95,
    takeProfit: 110,
    structuralInvalidationLevel: 99,
    riskDistance: 5,
    plannedRR: 2,
    stopSource: "structural_invalidation",
    targetSource: "resting_liquidity",
    triggerConfirmed: true,
    htfAlignment: "ALIGNED_BULLISH",
    sweepPresent: true,
    fvgEngaged: true,
    obEngaged: false,
    structuralEventPresent: true,
    noTradeReasons: [],
    ...over,
  };
}

/** A short plan: entry 100, published stop 105 (R = 5), target 90, invalidation 101. */
function shortDecision(over: Partial<WalkForwardDecision> = {}): WalkForwardDecision {
  return longDecision({
    recommendation: "SHORT",
    bias: "Bearish",
    direction: "short",
    stopLoss: 105,
    takeProfit: 90,
    structuralInvalidationLevel: 101,
    htfAlignment: "ALIGNED_BEARISH",
    ...over,
  });
}

// ── 1. Outcome vocabulary ────────────────────────────────────────

describe("Phase 293 — the outcome model distinguishes every case", () => {
  it("classifies a clean target hit", () => {
    const e = evaluateOutcome(longDecision(), [candle(1_003_600_000, 104, 99.5), candle(1_007_200_000, 111, 102)]);
    expect(e.outcome).toBe("TARGET_HIT");
    expect(e.realizedR).toBeCloseTo(2, 9); // (110 − 100) / 5
    expect(e.outcomeTime).toBe(1_007_200_000);
    expect(e.elapsedCandles).toBe(2);
  });

  it("classifies a clean stop hit as exactly −1 R", () => {
    const e = evaluateOutcome(longDecision(), [candle(1_003_600_000, 102, 94.5)]);
    expect(e.outcome).toBe("STOP_HIT");
    expect(e.realizedR).toBeCloseTo(-1, 9);
    expect(e.invalidationBreached).toBe(true); // the structural level sat above the stop
  });

  it("classifies an invalidation breach that the protective stop survived", () => {
    const tight = longDecision({ stopLoss: 95, structuralInvalidationLevel: 99 });
    const e = evaluateOutcome(tight, [candle(1_003_600_000, 100.5, 98.5), candle(1_007_200_000, 104, 99.5)]);
    expect(e.outcome).toBe("INVALIDATION_HIT");
    expect(e.realizedR).toBeCloseTo(-0.2, 9); // (99 − 100) / 5 — the level that voids the thesis
    expect(e.notes.join(" ")).toMatch(/protective stop was not reached/);
  });

  it("classifies a horizon that ended unresolved as TIME_EXPIRED with a mark, not a closed trade", () => {
    const e = evaluateOutcome(longDecision(), [candle(1_003_600_000, 101, 99.5), candle(1_007_200_000, 106, 100.5, 105)]);
    expect(e.outcome).toBe("TIME_EXPIRED");
    expect(e.realizedR).toBeUndefined();
    expect(e.markToMarketR).toBeCloseTo(1, 9); // (105 − 100) / 5
    expect(e.notes.join(" ")).toMatch(/horizon mark-to-market, not a closed trade/);
  });

  it("classifies a non-thesis as NO_TRADE with no resolution attempt", () => {
    const e = evaluateOutcome(
      longDecision({ recommendation: "NO_TRADE", direction: undefined, entry: undefined, stopLoss: undefined, takeProfit: undefined }),
      [candle(1_003_600_000, 111, 94)],
    );
    expect(e.outcome).toBe("NO_TRADE");
    expect(e.realizedR).toBeUndefined();
    expect(e.futureCandlesConsidered).toBe(0);
  });

  it("classifies a plan with no future candles as INSUFFICIENT_FUTURE_DATA", () => {
    const e = evaluateOutcome(longDecision(), []);
    expect(e.outcome).toBe("INSUFFICIENT_FUTURE_DATA");
    expect(e.futureCandlesConsidered).toBe(0);
  });

  it("classifies a same-candle stop-and-target touch as AMBIGUOUS_PATH, never a win or a loss", () => {
    const e = evaluateOutcome(longDecision(), [candle(1_003_600_000, 111, 94)]);
    expect(e.outcome).toBe("AMBIGUOUS_PATH");
    expect(e.realizedR).toBeUndefined();
    expect(e.markToMarketR).toBeUndefined();
    expect(e.notes.join(" ")).toMatch(/intrabar ordering is unknown/);
    expect(e.mfeR).toBeCloseTo(2.2, 9); // high 111
    expect(e.maeR).toBeCloseTo(-1.2, 9); // low 94
  });

  it("respects the order of separate candles", () => {
    const stopFirst = evaluateOutcome(longDecision(), [candle(1, 103, 94.5), candle(2, 112, 102)]);
    expect(stopFirst.outcome).toBe("STOP_HIT");
    const targetFirst = evaluateOutcome(longDecision(), [candle(1, 111, 99.5), candle(2, 103, 94)]);
    expect(targetFirst.outcome).toBe("TARGET_HIT");
  });

  it("mirrors the model for a bearish plan", () => {
    const target = evaluateOutcome(shortDecision(), [candle(1, 100.5, 89)]);
    expect(target.outcome).toBe("TARGET_HIT");
    expect(target.realizedR).toBeCloseTo(2, 9); // (100 − 90) / 5
    const stop = evaluateOutcome(shortDecision(), [candle(1, 105.5, 99)]);
    expect(stop.outcome).toBe("STOP_HIT");
    expect(stop.realizedR).toBeCloseTo(-1, 9);
    const ambiguous = evaluateOutcome(shortDecision(), [candle(1, 106, 89)]);
    expect(ambiguous.outcome).toBe("AMBIGUOUS_PATH");
  });

  it("honours the future-window limit instead of scanning the whole series", () => {
    const candles = [candle(1, 101, 99.5), candle(2, 101, 99.5), candle(3, 111, 99.6)];
    const e = evaluateOutcome(longDecision(), candles, { maxFutureCandles: 2 });
    expect(e.outcome).toBe("TIME_EXPIRED");
    expect(e.futureCandlesConsidered).toBe(2);
  });
});

// ── 2. Excursions ────────────────────────────────────────────────

describe("Phase 293 — MFE / MAE are observed excursions in R", () => {
  it("records the favourable and adverse extremes before resolution", () => {
    const e = evaluateOutcome(longDecision(), [
      candle(1, 105, 99.5), // +1.0 R / −0.1 R
      candle(2, 111, 99.5), // target
    ]);
    expect(e.mfeR).toBeCloseTo(2.2, 9);
    expect(e.maeR).toBeCloseTo(-0.1, 9);
    expect(e.mfePrice).toBe(111);
    expect(e.maePrice).toBe(99.5);
  });

  it("records the adverse extreme even when the stop resolved the trade", () => {
    const e = evaluateOutcome(longDecision(), [candle(1, 104, 94.9)]);
    expect(e.maeR).toBeCloseTo(-1.02, 9);
    expect(e.mfeR).toBeCloseTo(0.8, 9);
  });

  it("reports partial progress before failure as factual excursions, not as a fill", () => {
    const e = evaluateOutcome(longDecision(), [candle(1, 108, 99.5), candle(2, 102, 94.5)]);
    expect(e.outcome).toBe("STOP_HIT");
    expect(e.mfeR).toBeCloseTo(1.6, 9); // reached 108 before failing
    expect(e.notes.join(" ")).not.toMatch(/partial exit/i);
  });
});

// ── 3. Aggregation ───────────────────────────────────────────────

function evaluationFrom(outcome: OutcomeEvaluation["outcome"], over: Partial<WalkForwardDecision> = {}, realizedR?: number): OutcomeEvaluation {
  const decision = longDecision(over);
  const base: OutcomeEvaluation = { decision, outcome, futureCandlesConsidered: 3, mfeR: 1.5, maeR: -0.5, notes: [], elapsedCandles: 3 };
  return realizedR === undefined ? base : { ...base, realizedR };
}

describe("Phase 293 — aggregation marks insufficiency instead of averaging noise", () => {
  it("counts every outcome state exactly once per evaluation", () => {
    const evals: OutcomeEvaluation[] = [
      evaluationFrom("TARGET_HIT", {}, 2),
      evaluationFrom("STOP_HIT", {}, -1),
      evaluationFrom("INVALIDATION_HIT", {}, -0.2),
      evaluationFrom("TIME_EXPIRED"),
      evaluationFrom("AMBIGUOUS_PATH"),
      evaluationFrom("INSUFFICIENT_FUTURE_DATA"),
      evaluationFrom("NO_TRADE", { direction: undefined }),
    ];
    const s = sampleCounts(evals);
    expect(s).toMatchObject({
      evaluations: 7,
      plannedTrades: 6,
      noTrade: 1,
      resolved: 4,
      targetHits: 1,
      stopHits: 1,
      invalidationHits: 1,
      timeExpired: 1,
      ambiguous: 1,
      insufficientFutureData: 1,
    });
  });

  it("groups by Phase 291 setup state without ranking the states", () => {
    const evals: OutcomeEvaluation[] = [
      evaluationFrom("TARGET_HIT", { setupState: "CONFIRMED_SETUP_CONTEXT" }, 2),
      evaluationFrom("STOP_HIT", { setupState: "CONFIRMED_SETUP_CONTEXT" }, -1),
      evaluationFrom("TIME_EXPIRED", { setupState: "LOCATION_ONLY" }),
      evaluationFrom("NO_TRADE", { setupState: "NO_SETUP_EVIDENCE", direction: undefined }),
    ];
    const buckets = aggregateBy(evals, (e) => e.decision.setupState);
    const confirmed = buckets.find((b) => b.label === "CONFIRMED_SETUP_CONTEXT")!;
    expect(confirmed.occurrences).toBe(2);
    expect(confirmed.realizedR).toEqual({ n: 2, mean: 0.5, median: 0.5 });
    expect(confirmed.sampleSufficient).toBe(false);
    expect(confirmed.insufficientReason).toContain(`${MIN_RESOLVED_FOR_AGGREGATE}-sample floor`);
    const location = buckets.find((b) => b.label === "LOCATION_ONLY")!;
    expect(location.timeExpired).toBe(1);
    // States are reported separately — no ordering or ranking is implied.
    expect(Object.keys(confirmed)).not.toContain("score");
  });

  it("marks a bucket sufficient only at the explicit floor", () => {
    const many: OutcomeEvaluation[] = Array.from({ length: MIN_RESOLVED_FOR_AGGREGATE }, (_, i) =>
      evaluationFrom(i % 2 === 0 ? "TARGET_HIT" : "STOP_HIT", {}, i % 2 === 0 ? 2 : -1),
    );
    const bucket = aggregateBy(many, () => "x")[0];
    expect(bucket.sampleSufficient).toBe(true);
    expect(bucket.insufficientReason).toBeUndefined();
    expect(bucket.realizedR!.n).toBe(MIN_RESOLVED_FOR_AGGREGATE);
    expect(bucket.sampleSufficient).toBe(bucket.resolved >= MIN_RESOLVED_FOR_AGGREGATE);
  });

  it("reports median resolution time over resolved outcomes only", () => {
    const evals = [1, 3, 5, 9].map((n, i) =>
      evaluationFrom(i < 3 ? "TARGET_HIT" : "TIME_EXPIRED", {}, i < 3 ? 2 : undefined) && {
        ...evaluationFrom("TARGET_HIT", {}, 2),
        elapsedCandles: n,
      },
    );
    const bucket = aggregateBy(evals as OutcomeEvaluation[], () => "x")[0];
    expect(bucket.resolutionCandles!.n).toBe(4);
    expect(bucket.resolutionCandles!.median).toBe(4); // (3 + 5) / 2
  });
});

// ── 4. Calibration semantics ─────────────────────────────────────

describe("Phase 293 — confidence calibration stays descriptive", () => {
  it("reports calibration as unavailable below the resolved-sample floor", () => {
    const evals = [evaluationFrom("TARGET_HIT", { confidence: 62 }, 2), evaluationFrom("STOP_HIT", { confidence: 65 }, -1)];
    const cal = calibrateConfidence(evals);
    expect(cal.status).toBe("INSUFFICIENT_SAMPLE");
    expect(cal.minResolvedSample).toBe(CALIBRATION_MIN_RESOLVED);
    const bucket = cal.buckets.find((b) => b.label === "60–80")!;
    expect(bucket.resolved).toBe(2);
    expect(bucket.targetResolutionShare).toBeUndefined();
    expect(bucket.calibrationError).toBeUndefined();
    expect(bucket.sampleSufficient).toBe(false);
    expect(cal.note).toMatch(/calibration is unavailable/);
  });

  it("reports descriptive shares once the floor is met — never a probability", () => {
    const evals: OutcomeEvaluation[] = [
      ...Array.from({ length: 20 }, () => evaluationFrom("TARGET_HIT", { confidence: 70 }, 2)),
      ...Array.from({ length: 10 }, () => evaluationFrom("STOP_HIT", { confidence: 72 }, -1)),
    ];
    const cal = calibrateConfidence(evals);
    expect(cal.status).toBe("DESCRIPTIVE_ONLY");
    const bucket = cal.buckets.find((b) => b.label === "60–80")!;
    expect(bucket.resolved).toBe(30);
    expect(bucket.targetResolutionShare).toBeCloseTo(20 / 30, 9);
    expect(bucket.calibrationError).toBeCloseTo(Math.abs(20 / 30 - 0.7), 9);
    // The semantics string is explicit, and nothing was written back.
    expect(cal.semantics).toMatch(/evidence strength, not a probability/);
    expect(cal.productionConfidenceUnchanged).toBe(true);
  });

  it("never labels a bucket as a win rate or accuracy", () => {
    const evals = Array.from({ length: 40 }, (_, i) => evaluationFrom(i % 2 ? "TARGET_HIT" : "STOP_HIT", { confidence: 85 }, i % 2 ? 2 : -1));
    const cal = calibrateConfidence(evals);
    // The buckets themselves carry no probability/accuracy vocabulary (the
    // semantics string only STATES that it is not a probability).
    const text = JSON.stringify(cal.buckets);
    expect(text).not.toMatch(/win rate|accuracy|probability|guaranteed/i);
  });
});

// ── 5. Expectancy ────────────────────────────────────────────────

describe("Phase 293 — expectancy excludes what cannot be scored", () => {
  it("computes EV as the mean realized R over closed outcomes only", () => {
    const evals = [
      evaluationFrom("TARGET_HIT", {}, 2),
      evaluationFrom("STOP_HIT", {}, -1),
      evaluationFrom("INVALIDATION_HIT", {}, -0.2),
      evaluationFrom("AMBIGUOUS_PATH"),
      evaluationFrom("TIME_EXPIRED"),
      evaluationFrom("INSUFFICIENT_FUTURE_DATA"),
      evaluationFrom("NO_TRADE", { direction: undefined }),
    ];
    const ev = computeRealizedExpectancy(evals);
    expect(ev.sampleSize).toBe(3);
    expect(ev.meanRealizedR).toBeCloseTo((2 - 1 - 0.2) / 3, 9);
    expect(ev.excluded).toEqual({ ambiguous: 1, timeExpired: 1, unresolved: 1, noTrade: 1 });
    expect(ev.sampleSufficient).toBe(false);
    expect(ev.method).toMatch(/mean realized R over closed outcomes/);
  });

  it("returns no number at all when nothing closed", () => {
    const ev = computeRealizedExpectancy([evaluationFrom("AMBIGUOUS_PATH")]);
    expect(ev.sampleSize).toBe(0);
    expect(ev.meanRealizedR).toBeUndefined();
  });
});

// ── 6. Journal bridge ────────────────────────────────────────────

describe("Phase 293 — the journal bridge reuses the existing accounting vocabulary", () => {
  it("maps a target hit to WIN with the journal's own P/L", () => {
    const e = evaluateOutcome(longDecision(), [candle(1, 111, 99.5)]);
    const bridged = toJournalOutcome(e, { positionSize: 2 });
    expect(bridged.outcome).toBe("WIN");
    expect(bridged.pnl).toBeCloseTo(20, 9); // (110 − 100) × 2
    expect(bridged.realizedR).toBeCloseTo(2, 9);
  });

  it("maps a stop hit to LOSS and an invalidation breach to its own factual loss", () => {
    const stop = toJournalOutcome(evaluateOutcome(longDecision(), [candle(1, 101, 94)]), {});
    expect(stop.outcome).toBe("LOSS");
    expect(stop.pnl).toBeCloseTo(-5, 9);
    const invalidation = toJournalOutcome(evaluateOutcome(longDecision(), [candle(1, 100.2, 98.5)]), {});
    expect(invalidation.outcome).toBe("LOSS");
    expect(invalidation.pnl).toBeCloseTo(-1, 9); // (99 − 100)
  });

  it("keeps ambiguous and expired outcomes UNKNOWN — the journal has no loss that may not have happened", () => {
    const ambiguous = toJournalOutcome(evaluateOutcome(longDecision(), [candle(1, 111, 94)]), {});
    expect(ambiguous.outcome).toBe("UNKNOWN");
    expect(ambiguous.pnl).toBeUndefined();
    const expired = toJournalOutcome(evaluateOutcome(longDecision(), [candle(1, 101, 99.5)]), {});
    expect(expired.outcome).toBe("UNKNOWN");
  });
});

// ── 7. Diagnostics language + determinism ────────────────────────

describe("Phase 293 — diagnostics are factual and deterministic", () => {
  const reportLike = () => {
    const evals = [evaluationFrom("TARGET_HIT", {}, 2), evaluationFrom("AMBIGUOUS_PATH"), evaluationFrom("NO_TRADE", { direction: undefined })];
    return {
      modelVersion: OUTCOME_MODEL_VERSION,
      evaluations: evals,
      sample: sampleCounts(evals),
      bySetupState: aggregateBy(evals, (e) => e.decision.setupState),
      byDirection: aggregateBy(evals, (e) => e.decision.direction ?? "no_plan"),
      byTimeframe: aggregateBy(evals, (e) => e.decision.timeframe),
      byHtfAlignment: aggregateBy(evals, (e) => e.decision.htfAlignment ?? "unavailable"),
      byFlags: aggregateBy(evals, () => "confirmed_setup_context + sweep"),
      calibration: calibrateConfidence(evals),
      expectancy: computeRealizedExpectancy(evals),
      limits: { maxEvaluations: 40, maxFutureCandles: 60 },
      alignment: { mode: "PROVIDER_TIMESTAMPS" as const, note: "fixture" },
      provenance: {
        provider: "fixture",
        timeframe: "H4",
        instrument: "TEST/USD",
        executionData: "OHLCV only — no fills, slippage, spread, commission or financing data was supplied, so none is modelled.",
      },
    };
  };

  it("prints the factual fields the phase asks for", () => {
    const lines = formatValidationDiagnostics(reportLike()).join("\n");
    expect(lines).toContain("Historical sample: 3");
    expect(lines).toContain("Resolved: 1");
    expect(lines).toContain("Ambiguous (same-candle stop and target): 1");
    expect(lines).toMatch(/INSUFFICIENT SAMPLE|insufficient sample/i);
    expect(lines).toContain("Execution costs: OHLCV only");
  });

  it("contains no marketing or predictive claim", () => {
    const lines = formatValidationDiagnostics(reportLike()).join("\n");
    expect(lines).not.toMatch(/accurate|probability|guaranteed|AI predicts|high confidence signal/i);
  });

  it("is deterministic for identical inputs", () => {
    const a = JSON.stringify(reportLike());
    const b = JSON.stringify(reportLike());
    expect(a).toBe(b);
  });
});

// ── 8. Decision extraction reads the engine, never the future ────

describe("Phase 293 — decision extraction reads only what the engine published", () => {
  it("captures the plan, setup state and slices without recomputation", () => {
    const fake = {
      recommendation: "LONG",
      bias: "Bullish",
      confidence: 55,
      conviction: "Medium",
      timeframe: "H4",
      provider: "okx",
      tradePlan: {
        direction: "long",
        entry: "100.00",
        stopLoss: "95.00",
        takeProfit: "110.00",
        riskReward: 2,
        stopProvenance: { source: "structural_invalidation" },
        targetProvenance: { source: "resting_liquidity" },
        structuralInvalidation: { level: 99 },
        entryContext: { triggerConfirmed: false },
      },
      tradeLocation: {
        location: "inside_fvg",
        flags: { insideFvg: true, atFvgBoundary: false, insideOb: false, atObBoundary: false },
        liquidity: { sweep: { level: 111 } },
        context: { state: "STRUCTURAL_SETUP" },
      },
      structuralEvidence: { timeframes: [{ event: { kind: "BOS" } }, {}] },
      technicalData: { mtf: { alignment: "ALIGNED_BULLISH" } },
      noTradeReasons: [],
    };
    const d = decisionFromResult(fake as unknown as Parameters<typeof decisionFromResult>[0], 42, 1_234);
    expect(d.evaluationIndex).toBe(42);
    expect(d.entry).toBeCloseTo(100, 9);
    expect(d.riskDistance).toBeCloseTo(5, 9);
    expect(d.setupState).toBe("STRUCTURAL_SETUP");
    expect(d.triggerConfirmed).toBe(false);
    expect(d.sweepPresent).toBe(true);
    expect(d.fvgEngaged).toBe(true);
    expect(d.obEngaged).toBe(false);
    expect(d.structuralEventPresent).toBe(true);
    expect(d.htfAlignment).toBe("ALIGNED_BULLISH");
  });

  it("labels a missing location explicitly instead of guessing one", () => {
    const d = decisionFromResult(
      { recommendation: "NO_TRADE", bias: "Neutral", confidence: 20, conviction: "Low", timeframe: "H4", provider: "x", noTradeReasons: ["n"] } as unknown as Parameters<typeof decisionFromResult>[0],
      3,
      99,
    );
    expect(d.setupState).toBe("NO_LOCATION");
    expect(d.location).toBe("no_location");
    expect(d.direction).toBeUndefined();
  });
});
