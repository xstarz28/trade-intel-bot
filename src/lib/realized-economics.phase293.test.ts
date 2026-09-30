/**
 * Phase 293 — REALIZED ECONOMICS ON REAL PLANS (§4, §9).
 *
 * The evaluator never models execution: it reports what the published plan did
 * in price terms, and the money side is delegated to the layers that already
 * own it — the risk engine for size, the journal for P/L. Two rules are proved
 * here:
 *
 *   1. Planned and realized stay separate. Realized R is measured against the
 *      PUBLISHED stop; the money figure is the journal's own computePnl over
 *      the published levels. No fill, slippage, spread, commission or financing
 *      number is invented when the data was never supplied.
 *   2. The same outcome can be read by the risk and journal layers without a
 *      second accounting system: size × published risk × realized R equals the
 *      journal P/L exactly.
 */
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { computePnl, journalFromAnalysis, transitionEntry } from "@/lib/journal";
import {
  computeRealizedExpectancy,
  evaluateOutcome,
  runWalkForward,
  toEmpiricalValidationFields,
  toJournalOutcome,
  type OutcomeCandle,
  type OutcomeEvaluation,
} from "@/lib/outcome-validation";
import { computePositionSizing, specGaps, type InstrumentSpec } from "@/lib/risk";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

const INTERVAL = 4 * 3600_000;

function designedSeries(): OhlcvCandle[] {
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
  for (let i = 200; i < 216; i++) { const p = 164 + (i - 199) * 0.8; push(i, p - 0.3, p + 0.5, p - 0.6, p); }
  for (let i = 216; i < 232; i++) { const p = 177 - (i - 215) * 1.1; push(i, p + 0.3, p + 0.6, p - 0.8, p); }
  return out;
}

const SERIES = designedSeries();
const NOW = Date.now();

function input(prefix: readonly OutcomeCandle[], extra: Partial<AnalysisInput> = {}): AnalysisInput {
  const candles = prefix as OhlcvCandle[];
  const last = candles[candles.length - 1];
  const tech: TechnicalData = {
    ...calculateTechnical(candles, candles, "D1"),
    structure: "HH/HL",
    bosDirection: "bullish",
    smc: computeSmcContext(candles, "H4"),
    mtf: buildMtfContext("H4", [
      { timeframe: "H4", role: "setup", candles },
      ...buildChain("H4").map((t) => ({ timeframe: t.timeframe, role: t.role, candles } satisfies MtfCandleInput)),
    ]),
  };
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
    technicalData: tech,
    economicEvents: "Fed signals hawkish stance, rate hike",
    ...extra,
  } as AnalysisInput;
}

function alignedPrefix(index: number): { prefix: OhlcvCandle[]; providerTime: number } {
  const raw = SERIES.slice(0, index + 1);
  const providerTime = raw[raw.length - 1].timestamp;
  const shift = NOW - providerTime;
  return { prefix: raw.map((c) => ({ ...c, timestamp: c.timestamp + shift })), providerTime };
}

const PLAN_PREFIX = alignedPrefix(199);
const VERIFIED_SPEC: InstrumentSpec = {
  assetClass: "forex",
  contractSize: 100_000,
  quantityStep: 0.01,
  minQuantity: 0.01,
  quoteCurrency: "USD",
  source: "test-broker-metadata",
};

const PLAN_RESULT = runAnalysis(input(PLAN_PREFIX.prefix, { instrumentSpec: VERIFIED_SPEC }));

const REACHED = runWalkForward(
  SERIES,
  (prefix, index) => {
    void index;
    return input(prefix, { instrumentSpec: VERIFIED_SPEC });
  },
  { alignment: { mode: "WALL_CLOCK_ALIGNED", nowMs: NOW, note: "designed deterministic test series" }, evaluationIndices: [199], minPrefixCandles: 60 },
);
const TARGET_CHRONOLOGY = REACHED.evaluations[0];

const STOP_SERIES = designedSeries();
STOP_SERIES[200] = { ...STOP_SERIES[200], high: 164.5, low: 160.9, close: 161.5 };
STOP_SERIES[201] = { ...STOP_SERIES[201], high: 161.6, low: 160.5, close: 160.6 };
const STOPPED = runWalkForward(
  STOP_SERIES,
  (prefix, index) => {
    void index;
    return input(prefix, { instrumentSpec: VERIFIED_SPEC });
  },
  { alignment: { mode: "WALL_CLOCK_ALIGNED", nowMs: NOW, note: "designed deterministic test series" }, evaluationIndices: [199], minPrefixCandles: 60 },
);
const STOP_CHRONOLOGY = STOPPED.evaluations[0];

// ── The plan the engine actually published ──

describe("Phase 293 — the plan under evaluation is the engine's published plan", () => {
  it("publishes entry, stop, target and R:R from market structure", () => {
    expect(PLAN_RESULT.recommendation).toBe("LONG");
    expect(PLAN_RESULT.tradePlan?.entry).toBe("163.55");
    expect(PLAN_RESULT.tradePlan?.stopLoss).toBe("161.18");
    expect(PLAN_RESULT.tradePlan?.takeProfit).toBe("175.88");
    expect(TARGET_CHRONOLOGY.decision.entry).toBeCloseTo(163.55, 6);
    expect(TARGET_CHRONOLOGY.decision.stopLoss).toBeCloseTo(161.18, 6);
    expect(TARGET_CHRONOLOGY.decision.takeProfit).toBeCloseTo(175.88, 6);
    expect(TARGET_CHRONOLOGY.decision.riskDistance).toBeCloseTo(2.37, 6);
  });

  it("sizes from the PUBLISHED stop, a real equity and a verified spec", () => {
    const sizing = computePositionSizing({
      equity: 10_000_000,
      riskPercent: 0.01,
      entry: TARGET_CHRONOLOGY.decision.entry!,
      stopLoss: TARGET_CHRONOLOGY.decision.stopLoss!,
      spec: VERIFIED_SPEC,
    });
    expect(sizing.available).toBe(true);
    // risk per unit = published risk distance × contract size
    expect(sizing.riskPerUnit).toBeCloseTo(2.37 * 100_000, 4);
    expect(sizing.quantity).toBeCloseTo(0.42, 9);
    expect(sizing.quantity! * sizing.riskPerUnit!).toBeLessThanOrEqual(sizing.riskAmount!);
    expect(sizing.appliedRiskPercent).toBe(0.01);
    expect(sizing.specificationSource).toBe("test-broker-metadata");
    // A raw-level stop (2.19 away) would have produced 0.45 — the published stop is what was used.
    expect(sizing.quantity).not.toBeCloseTo(0.45, 2);
  });

  it("refuses a size below the instrument minimum and an unverified spec", () => {
    const tiny = computePositionSizing({
      equity: 100_000,
      riskPercent: 0.01,
      entry: TARGET_CHRONOLOGY.decision.entry!,
      stopLoss: TARGET_CHRONOLOGY.decision.stopLoss!,
      spec: VERIFIED_SPEC,
    });
    expect(tiny.available).toBe(false);
    expect(tiny.unavailableReason).toBeTruthy();
    expect(tiny.quantity).toBeUndefined();

    expect(specGaps({ assetClass: "forex" }).length).toBeGreaterThan(0);
    const unverified: InstrumentSpec = { assetClass: "forex", contractSize: 100_000, source: "estimated" };
    expect(specGaps(unverified).length).toBeGreaterThan(0);
  });
});

// ── Realized economics ──

describe("Phase 293 — planned and realized are reported separately", () => {
  it("measures realized R from the published levels, not from a favourable reference", () => {
    const plannedRatio = (TARGET_CHRONOLOGY.decision.takeProfit! - TARGET_CHRONOLOGY.decision.entry!) /
      (TARGET_CHRONOLOGY.decision.entry! - TARGET_CHRONOLOGY.decision.stopLoss!);
    expect(TARGET_CHRONOLOGY.realizedR).toBeCloseTo(plannedRatio, 6);
    expect(STOP_CHRONOLOGY.realizedR).toBeCloseTo(-1, 9);
    expect(STOP_CHRONOLOGY.outcome).toBe("STOP_HIT");
    // Planned R:R is the engine's own published figure and is untouched by the outcome.
    expect(TARGET_CHRONOLOGY.decision.plannedRR).toBeCloseTo(5.2, 2);
  });

  it("keeps MFE/MAE as observed excursions, never as entries or exits taken", () => {
    expect(TARGET_CHRONOLOGY.mfeR).toBeGreaterThanOrEqual(TARGET_CHRONOLOGY.realizedR!);
    expect(TARGET_CHRONOLOGY.mfePrice).toBeDefined();
    expect(TARGET_CHRONOLOGY.maePrice).toBeDefined();
    expect(TARGET_CHRONOLOGY.notes.join(" ")).not.toMatch(/\bfill(ed)?\b/i);
  });

  it("states that no execution data was supplied instead of inventing costs", () => {
    expect(PLAN_RESULT.slippageEstimate).toBeUndefined();
    expect(REACHED.provenance.executionData).toMatch(/no fills, slippage, spread, commission or financing/);
    for (const e of REACHED.evaluations) {
      expect(e.notes.some((n) => /ordering|fill|assum/i.test(n)) || e.outcome === "TARGET_HIT").toBe(true);
    }
  });

  it("agrees with the journal's own P/L arithmetic for the same closed outcome", () => {
    const size = 0.42;
    const bridged = toJournalOutcome(TARGET_CHRONOLOGY, { positionSize: size });
    const expected = computePnl(
      TARGET_CHRONOLOGY.decision.entry!,
      TARGET_CHRONOLOGY.decision.takeProfit!,
      "long",
      size,
    );
    expect(bridged.outcome).toBe("WIN");
    expect(bridged.pnl).toBeCloseTo(expected.pnl!, 9);
    // size × published risk × realized R must equal the journal's P/L.
    expect(bridged.pnl).toBeCloseTo(size * TARGET_CHRONOLOGY.decision.riskDistance! * TARGET_CHRONOLOGY.realizedR!, 6);

    const stopped = toJournalOutcome(STOP_CHRONOLOGY, { positionSize: size });
    expect(stopped.outcome).toBe("LOSS");
    expect(stopped.pnl).toBeCloseTo(-size * STOP_CHRONOLOGY.decision.riskDistance!, 6);
    expect(stopped.pnl).toBeCloseTo(size * STOP_CHRONOLOGY.decision.riskDistance! * STOP_CHRONOLOGY.realizedR!, 6);
  });
});

// ── Expectancy across several chronologies ──

describe("Phase 293 — expectancy over realized outcomes only", () => {
  const combined: OutcomeEvaluation[] = [TARGET_CHRONOLOGY, STOP_CHRONOLOGY];

  it("averages closed outcomes and excludes the rest explicitly", () => {
    const exp = computeRealizedExpectancy(combined);
    expect(exp.sampleSize).toBe(2);
    expect(exp.meanRealizedR).toBeCloseTo((TARGET_CHRONOLOGY.realizedR! + STOP_CHRONOLOGY.realizedR!) / 2, 9);
    expect(exp.medianRealizedR).toBeDefined();
    expect(exp.method).toMatch(/mean realized R/);
    expect(exp.sampleSufficient).toBe(false);
    expect(exp.excluded.ambiguous).toBe(0);
  });

  it("does not let an ambiguous or expired evaluation enter the average", () => {
    const decision = TARGET_CHRONOLOGY.decision;
    const ambiguous = evaluateOutcome(decision, [
      { timestamp: 200 * INTERVAL, open: 164, high: 176, low: 160.9, close: 165 },
    ]);
    const expired = evaluateOutcome(decision, [
      { timestamp: 200 * INTERVAL, open: 164, high: 165, low: 163, close: 164 },
    ]);
    expect(ambiguous.outcome).toBe("AMBIGUOUS_PATH");
    expect(expired.outcome).toBe("TIME_EXPIRED");
    const exp = computeRealizedExpectancy([...combined, ambiguous, expired]);
    expect(exp.sampleSize).toBe(2);
    expect(exp.excluded.ambiguous).toBe(1);
    expect(exp.excluded.timeExpired).toBe(1);
    expect(exp.meanRealizedR).toBeCloseTo((TARGET_CHRONOLOGY.realizedR! + STOP_CHRONOLOGY.realizedR!) / 2, 9);
  });

  it("reports sufficiency as a field, never as a performance claim", () => {
    const fields = toEmpiricalValidationFields(REACHED);
    expect(fields.evidenceSufficiency.status).toBe("INSUFFICIENT_SAMPLE");
    expect(fields.affectsProductionDecision).toBe(false);
    expect(fields.resolvedSampleSize).toBe(1);
    expect(fields.outcomeCoverage).toBeCloseTo(REACHED.sample.resolved / REACHED.sample.evaluations, 9);
  });
});

// ── Journal integration ──

describe("Phase 293 — the journal keeps its own semantics while gaining realized outcomes", () => {
  it("records the published plan as planned, then closes it with the realized result", () => {
    const entry = journalFromAnalysis(PLAN_RESULT, {
      status: "PLANNED",
      entry: 163.55,
      stopLoss: 161.18,
      takeProfit: 175.88,
      riskReward: PLAN_RESULT.tradePlan?.riskReward,
      positionSize: 0.42,
    });
    expect(entry.status).toBe("PLANNED");
    expect(entry.outcome).toBeUndefined();
    expect(entry.riskReward).toBe(PLAN_RESULT.tradePlan?.riskReward);
    expect(entry.pnl).toBeUndefined();

    // The journal lifecycle stays what it always was (PLANNED → OPEN → CLOSED):
    // the evaluator supplies the realized figures, it does not rewrite the states.
    const opened = transitionEntry(entry, "OPEN");
    expect(opened.status).toBe("OPEN");
    const closed = transitionEntry(opened, "CLOSED", {
      exitPrice: TARGET_CHRONOLOGY.decision.takeProfit,
      pnl: toJournalOutcome(TARGET_CHRONOLOGY, { positionSize: 0.42 }).pnl,
      pnlPercent: toJournalOutcome(TARGET_CHRONOLOGY, { positionSize: 0.42 }).pnlPercent,
      outcome: toJournalOutcome(TARGET_CHRONOLOGY, { positionSize: 0.42 }).outcome,
    });
    // The plan that was published is still the plan on record.
    expect(closed.entry).toBe(163.55);
    expect(closed.stopLoss).toBe(161.18);
    expect(closed.takeProfit).toBe(175.88);
    expect(closed.riskReward).toBe(PLAN_RESULT.tradePlan?.riskReward);
    // …and the realized side is the journal's vocabulary, not a new one.
    expect(closed.status).toBe("CLOSED");
    expect(closed.outcome).toBe("WIN");
    expect(closed.pnl).toBeCloseTo(0.42 * 2.37 * TARGET_CHRONOLOGY.realizedR!, 6);
  });

  it("records a stop-out with the same accounting", () => {
    const entry = journalFromAnalysis(PLAN_RESULT, { status: "PLANNED", entry: 163.55, stopLoss: 161.18, positionSize: 0.42 });
    const bridge = toJournalOutcome(STOP_CHRONOLOGY, { positionSize: 0.42 });
    const closed = transitionEntry(transitionEntry(entry, "OPEN"), "CLOSED", {
      exitPrice: STOP_CHRONOLOGY.decision.stopLoss,
      pnl: bridge.pnl,
      pnlPercent: bridge.pnlPercent,
      outcome: bridge.outcome,
    });
    expect(closed.outcome).toBe("LOSS");
    expect(closed.pnl).toBeCloseTo(-0.42 * 2.37, 6);
    expect(bridge.realizedR).toBeCloseTo(-1, 9);
  });
});
