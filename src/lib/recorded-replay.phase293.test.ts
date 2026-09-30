/**
 * Phase 293 — RECORDED / HISTORICAL REPLAY (§11) AND JOURNAL COMPATIBILITY (§9).
 *
 *   PART 1 — the committed RECORDED OKX payload (real timestamps, unaltered)
 *   replayed through the walk-forward. The sample is stale and structurally
 *   indecisive, so the honest result is NO_TRADE for every window: no plan, no
 *   entry, no outcome, no closed R. Nothing is fabricated to escape it, the
 *   provider instants survive, and the read is labelled RECORDED/HISTORICAL —
 *   it never claims to be a live feed.
 *
 *   PART 2 — ONE complete chronology on a DESIGNED deterministic series
 *   (explicitly labelled test data, provider "fixture"): prefix N → decision →
 *   Phase 291 setup state → Phase 292 published plan → candles N+1…M →
 *   deterministic outcome, with every provenance field preserved.
 *
 *   PART 3 — the journal bridge: realized outcomes flow into the EXISTING
 *   journal accounting (computePnl / classifyOutcome) instead of a second
 *   accounting system, and ambiguous/expired outcomes stay UNKNOWN rather than
 *   being turned into a loss that may never have happened.
 */
import fs from "node:fs";
import { describe, expect, it } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { computePnl } from "@/lib/journal";
import {
  evaluateOutcome,
  formatValidationDiagnostics,
  runWalkForward,
  toEmpiricalValidationFields,
  toJournalOutcome,
  type OutcomeCandle,
  type OutcomeValidationReport,
} from "@/lib/outcome-validation";
import type { AnalysisInput, Timeframe } from "@/types/analysis";

// ════════ PART 1 — RECORDED OKX PAYLOAD ════════

const RECORDED = JSON.parse(
  fs.readFileSync(
    new URL("./data/__fixtures__/real-provider-candles.phase290a.json", import.meta.url),
    "utf8",
  ),
) as { _provenance: Record<string, string>; bars: Record<string, string[][]> };

const recordedBars = (tf: string): OhlcvCandle[] =>
  RECORDED.bars[tf]
    .map((r) => ({
      timestamp: Number(r[0]),
      open: Number(r[1]),
      high: Number(r[2]),
      low: Number(r[3]),
      close: Number(r[4]),
      volume: Number(r[5]),
    }))
    .reverse(); // provider order is newest-first; the engine walks oldest-first

const REC = {
  W1: recordedBars("1W"),
  D1: recordedBars("1D"),
  H4: recordedBars("4H"),
  H1: recordedBars("1H"),
};

/** The recorded windows the replay walks — every one of them a real chronology. */
const WINDOW_INDICES = [7, 11, 15, 19, 23];
const NOW = Date.now();
const ALIGNMENT = {
  mode: "WALL_CLOCK_ALIGNED" as const,
  nowMs: NOW,
  note: "recorded payload replayed at the observation instant; bar spacing and order are the recorded ones",
};

function recordedInput(prefix: readonly OutcomeCandle[]): AnalysisInput {
  const candles = prefix as OhlcvCandle[];
  const last = candles[candles.length - 1];
  const chain: MtfCandleInput[] = buildChain("H1").map((t) => {
    const pool = REC[t.timeframe as keyof typeof REC] ?? candles;
    return { timeframe: t.timeframe, role: t.role, candles: pool.length >= candles.length ? pool : candles };
  });
  const tech: TechnicalData = {
    ...calculateTechnical(candles, REC.D1, "D1"),
    smc: computeSmcContext(candles, "H1"),
    mtf: buildMtfContext("H1", [
      { timeframe: "H1", role: "setup", candles },
      ...chain.filter((c) => c.timeframe !== "H1"),
    ]),
  };
  return {
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    timeframe: "H1" as Timeframe,
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    marketData: {
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      provider: "okx",
      providerInstrumentId: "BTC-USDT",
      fetchTimestamp: last.timestamp,
      price: { price: last.close, timestamp: last.timestamp, source: "okx" },
      candles,
      timeframe: "H1",
      dataFreshness: "delayed",
    } as MarketData,
    technicalData: tech,
    economicEvents: "",
  } as AnalysisInput;
}

function replayRecorded(): OutcomeValidationReport {
  return runWalkForward(REC.H1, recordedInput, {
    alignment: ALIGNMENT,
    evaluationIndices: WINDOW_INDICES,
    minPrefixCandles: 8,
    maxFutureCandles: 24,
  });
}

const RECORDED_REPORT = replayRecorded();

describe("Phase 293 — recorded replay is honest about a sample that yields no plan", () => {
  it("walks the recorded windows in chronological order with preserved provenance", () => {
    expect(RECORDED._provenance.provider).toBe("OKX");
    expect(RECORDED_REPORT.evaluations.map((e) => e.decision.evaluationIndex)).toEqual(WINDOW_INDICES);
    expect(RECORDED_REPORT.provenance.provider).toBe("okx");
    expect(RECORDED_REPORT.provenance.instrument).toBe("BTC/USDT");
    expect(RECORDED_REPORT.provenance.timeframe).toBe("H1");
    expect(RECORDED_REPORT.alignment.mode).toBe("WALL_CLOCK_ALIGNED");
    for (const e of RECORDED_REPORT.evaluations) {
      // The provider's own instant survives the alignment untouched.
      expect(e.decision.providerEvaluationTime).toBe(REC.H1[e.decision.evaluationIndex].timestamp);
      expect(e.decision.evaluationTime).toBe(NOW);
      expect(e.decision.timeframe).toBe("H1");
    }
    const instants = RECORDED_REPORT.evaluations.map((e) => e.decision.providerEvaluationTime!);
    expect(instants).toEqual([...instants].sort((a, b) => a - b));
    expect(RECORDED_REPORT.provenance.alignmentShiftMs).toBe(NOW - instants[0]);
    expect(RECORDED_REPORT.provenance.firstProviderTime).toBe(instants[0]);
  });

  it("produces an honest NO_TRADE with the Phase 291 evidence intact", () => {
    for (const e of RECORDED_REPORT.evaluations) {
      expect(e.decision.recommendation).toBe("NO_TRADE");
      expect(e.outcome).toBe("NO_TRADE");
      expect(e.decision.entry).toBeUndefined();
      expect(e.decision.stopLoss).toBeUndefined();
      expect(e.decision.takeProfit).toBeUndefined();
      expect(e.realizedR).toBeUndefined();
      expect(e.outcomeIndex).toBeUndefined();
      expect(e.decision.noTradeReasons.length).toBeGreaterThan(0);
      // The setup state the risk layer would have consumed is still reported.
      expect([
        "NO_SETUP_EVIDENCE",
        "LOCATION_ONLY",
        "STRUCTURAL_SETUP",
        "CONFIRMED_SETUP_CONTEXT",
        "COUNTER_TREND_SETUP",
        "INVALID_SETUP_CONTEXT",
        "NO_LOCATION",
      ]).toContain(e.decision.setupState);
    }
    expect(RECORDED_REPORT.sample.plannedTrades).toBe(0);
    expect(RECORDED_REPORT.sample.resolved).toBe(0);
    expect(RECORDED_REPORT.expectancy.sampleSize).toBe(0);
    expect(RECORDED_REPORT.expectancy.meanRealizedR).toBeUndefined();
  });

  it("does not turn the recorded sample into a performance claim", () => {
    const fields = toEmpiricalValidationFields(RECORDED_REPORT);
    expect(fields.empiricalRealizedR).toBeUndefined();
    expect(fields.calibrationStatus).toBe("INSUFFICIENT_SAMPLE");
    expect(fields.evidenceSufficiency.status).toBe("INSUFFICIENT_SAMPLE");
    expect(fields.affectsProductionDecision).toBe(false);
    const lines = formatValidationDiagnostics(RECORDED_REPORT).join("\n");
    expect(lines).toContain("Historical sample: 5");
    expect(lines).toContain("Planned trades: 0");
    expect(lines).toContain("Realized R: no closed outcomes in this sample");
    expect(lines).toContain("RECORDED / HISTORICAL");
    expect(lines).not.toMatch(/\bLIVE\b/);
    expect(lines).not.toMatch(/accurate|probability|guaranteed|predicts/i);
  });

  it("keeps the recorded read identical when the future window grows", () => {
    const short = runWalkForward(REC.H1, recordedInput, {
      alignment: ALIGNMENT,
      evaluationIndices: WINDOW_INDICES,
      minPrefixCandles: 8,
      maxFutureCandles: 1,
    });
    expect(JSON.stringify(short.evaluations.map((e) => e.decision))).toBe(
      JSON.stringify(RECORDED_REPORT.evaluations.map((e) => e.decision)),
    );
    const again = replayRecorded();
    expect(JSON.stringify(again)).toBe(JSON.stringify(RECORDED_REPORT));
  });
});

// ════════ PART 2 — ONE COMPLETE CHRONOLOGY ON A DESIGNED SERIES ════════

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
  // candles 200…214 — the future leg that resolves the published plan
  for (let i = 200; i < 216; i++) { const p = 164 + (i - 199) * 0.8; push(i, p - 0.3, p + 0.5, p - 0.6, p); }
  for (let i = 216; i < 232; i++) { const p = 177 - (i - 215) * 1.1; push(i, p + 0.3, p + 0.6, p - 0.8, p); }
  return out;
}

const DESIGNED = designedSeries();

function designedInput(prefix: readonly OutcomeCandle[]): AnalysisInput {
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
  } as AnalysisInput;
}

const DESIGNED_REPORT = runWalkForward(DESIGNED, designedInput, {
  alignment: {
    mode: "WALL_CLOCK_ALIGNED",
    nowMs: NOW,
    note: "designed deterministic test series — not provider data",
  },
  evaluationIndices: [199],
  minPrefixCandles: 60,
  maxFutureCandles: 60,
});

const CHRONOLOGY = DESIGNED_REPORT.evaluations[0];

describe("Phase 293 — one complete chronology: decision → plan → future → outcome", () => {
  it("takes the decision from the prefix only, and labels it as designed test data", () => {
    expect(DESIGNED_REPORT.provenance.provider).toBe("fixture");
    expect(DESIGNED_REPORT.alignment.note).toMatch(/not provider data/);
    expect(CHRONOLOGY.decision.evaluationIndex).toBe(199);
    expect(CHRONOLOGY.decision.providerEvaluationTime).toBe(199 * INTERVAL);
    expect(CHRONOLOGY.decision.setupState).toBe("STRUCTURAL_SETUP");
    expect(CHRONOLOGY.decision.direction).toBe("long");
    expect(CHRONOLOGY.decision.entry).toBeCloseTo(163.55, 6);
    expect(CHRONOLOGY.decision.stopLoss).toBeCloseTo(161.18, 6);
    expect(CHRONOLOGY.decision.takeProfit).toBeCloseTo(175.88, 6);
    expect(CHRONOLOGY.decision.riskDistance).toBeCloseTo(163.55 - 161.18, 6);
    // The published ratio is the engine's own number for these levels.
    expect(CHRONOLOGY.decision.plannedRR).toBeCloseTo(5.2, 2);
    expect(CHRONOLOGY.decision.stopSource).toBe("structural_invalidation");
    expect(CHRONOLOGY.decision.targetSource).toBeTruthy();
    expect(CHRONOLOGY.decision.confidence).toBeGreaterThanOrEqual(20);
  });

  it("is the same decision the engine makes from that prefix alone (no lookahead)", () => {
    const prefix = DESIGNED.slice(0, 200).map((c) => ({
      ...c,
      timestamp: c.timestamp + (NOW - c.timestamp),
    }));
    const direct = runAnalysis(designedInput(prefix));
    expect(direct.recommendation).toBe(CHRONOLOGY.decision.recommendation);
    expect(direct.tradeLocation?.context.state).toBe(CHRONOLOGY.decision.setupState);
    expect(parseFloat(direct.tradePlan!.entry)).toBeCloseTo(CHRONOLOGY.decision.entry!, 6);
    expect(parseFloat(direct.tradePlan!.stopLoss)).toBeCloseTo(CHRONOLOGY.decision.stopLoss!, 6);
    expect(parseFloat(direct.tradePlan!.takeProfit)).toBeCloseTo(CHRONOLOGY.decision.takeProfit!, 6);
  });

  it("resolves the plan from candles 200…M with exact outcome provenance", () => {
    expect(CHRONOLOGY.outcome).toBe("TARGET_HIT");
    expect(CHRONOLOGY.outcomeIndex).toBe(214);
    expect(CHRONOLOGY.elapsedCandles).toBe(214 - 199);
    expect(CHRONOLOGY.outcomeTime).toBe(214 * INTERVAL + (NOW - 199 * INTERVAL));
    expect(CHRONOLOGY.elapsedMs).toBe((214 - 199) * INTERVAL);
    expect(CHRONOLOGY.futureCandlesConsidered).toBe(15);
    // Realized R is measured from the PUBLISHED levels: (target − entry) / (entry − published stop).
    expect(CHRONOLOGY.realizedR).toBeCloseTo((175.88 - 163.55) / (163.55 - 161.18), 6);
    expect(Math.abs(CHRONOLOGY.realizedR! - CHRONOLOGY.decision.plannedRR!)).toBeLessThan(0.01);
    expect(CHRONOLOGY.markToMarketR).toBeUndefined();
    expect(CHRONOLOGY.mfeR).toBeGreaterThanOrEqual(CHRONOLOGY.realizedR!);
    expect(CHRONOLOGY.maeR).toBeLessThanOrEqual(0.5);
    // Every risk figure is quoted against the PUBLISHED stop, never a level moved for R:R.
    expect(CHRONOLOGY.decision.structuralInvalidationLevel).toBeGreaterThan(CHRONOLOGY.decision.stopLoss!);
  });

  it("repeats identically — the same chronology yields the same outcome", () => {
    const again = runWalkForward(DESIGNED, designedInput, {
      alignment: { mode: "WALL_CLOCK_ALIGNED", nowMs: NOW, note: "designed deterministic test series — not provider data" },
      evaluationIndices: [199],
      minPrefixCandles: 60,
      maxFutureCandles: 60,
    });
    expect(JSON.stringify(again)).toBe(JSON.stringify(DESIGNED_REPORT));
  });

  it("cannot be pushed backwards by a different future", () => {
    const stopped = designedSeries();
    stopped[200] = { ...stopped[200], high: 164.5, low: 160.9, close: 161.5 };
    stopped[201] = { ...stopped[201], high: 161.6, low: 160.5, close: 160.6 };
    const stopReport = runWalkForward(stopped, designedInput, {
      alignment: { mode: "WALL_CLOCK_ALIGNED", nowMs: NOW, note: "designed deterministic test series — not provider data" },
      evaluationIndices: [199],
      minPrefixCandles: 60,
      maxFutureCandles: 60,
    });
    const stoppedEvaluation = stopReport.evaluations[0];
    expect(stoppedEvaluation.outcome).toBe("STOP_HIT");
    expect(stoppedEvaluation.realizedR).toBeCloseTo(-1, 6);
    // Same plan, different outcome.
    expect(JSON.stringify(stoppedEvaluation.decision)).toBe(JSON.stringify(CHRONOLOGY.decision));
  });
});

// ════════ PART 3 — JOURNAL / EXPECTANCY COMPATIBILITY ════════

describe("Phase 293 — realized outcomes connect to the existing journal accounting", () => {
  it("maps a resolved target hit through the journal's own P/L math", () => {
    const bridged = toJournalOutcome(CHRONOLOGY, { positionSize: 2 });
    expect(bridged.outcome).toBe("WIN");
    const { pnl, pnlPercent } = computePnl(
      CHRONOLOGY.decision.entry!,
      CHRONOLOGY.decision.takeProfit!,
      CHRONOLOGY.decision.direction!,
      2,
    );
    expect(bridged.pnl).toBeCloseTo(pnl!, 9);
    expect(bridged.pnlPercent).toBeCloseTo(pnlPercent!, 9);
    expect(bridged.realizedR).toBeCloseTo(CHRONOLOGY.realizedR!, 9);
  });

  it("leaves ambiguous and expired outcomes UNKNOWN — the journal has no loss that may not have happened", () => {
    const decision = {
      ...CHRONOLOGY.decision,
      riskDistance: CHRONOLOGY.decision.riskDistance!,
    };
    const ambiguous = evaluateOutcome(decision, [
      { timestamp: 200 * INTERVAL, open: 164, high: 176, low: 160.9, close: 165 },
    ]);
    expect(ambiguous.outcome).toBe("AMBIGUOUS_PATH");
    expect(toJournalOutcome(ambiguous, { positionSize: 2 })).toEqual({ outcome: "UNKNOWN" });
    expect(ambiguous.notes.join(" ")).toMatch(/intrabar ordering is unknown/);

    const expired = evaluateOutcome(decision, [
      { timestamp: 200 * INTERVAL, open: 164, high: 165, low: 163, close: 164 },
    ]);
    expect(expired.outcome).toBe("TIME_EXPIRED");
    expect(expired.markToMarketR).toBeDefined();
    expect(expired.realizedR).toBeUndefined();
    expect(toJournalOutcome(expired, { positionSize: 2 })).toEqual({ outcome: "UNKNOWN" });

    const noFuture = evaluateOutcome(decision, []);
    expect(noFuture.outcome).toBe("INSUFFICIENT_FUTURE_DATA");
    expect(toJournalOutcome(noFuture, { positionSize: 2 })).toEqual({ outcome: "UNKNOWN" });
  });

  it("states the expectancy methodology and every exclusion explicitly", () => {
    const exp = DESIGNED_REPORT.expectancy;
    expect(exp.method).toMatch(/mean realized R/);
    expect(exp.sampleSize).toBe(1);
    expect(exp.meanRealizedR).toBeCloseTo(CHRONOLOGY.realizedR!, 9);
    expect(exp.excluded.noTrade).toBe(DESIGNED_REPORT.sample.noTrade);
    expect(exp.excluded.ambiguous).toBe(DESIGNED_REPORT.sample.ambiguous);
    expect(exp.excluded.timeExpired).toBe(DESIGNED_REPORT.sample.timeExpired);
    expect(exp.sampleSufficient).toBe(false);
    // No execution data was supplied and none is invented.
    expect(DESIGNED_REPORT.provenance.executionData).toMatch(/no fills, slippage, spread, commission or financing/);
  });
});
