/**
 * Phase 295 — RECORDED CLOCK CAUSALITY SUITE (§10 A–I, §12, §13).
 *
 * The causal contract of the canonical decision clock, exercised against the
 * REAL recorded corpus where possible and against designed fixtures only where
 * the mechanics need a resolvable plan:
 *
 *   A same prefix + same historical instant  → same decision, whatever today is
 *   B wall-clock change                      → no historical change
 *   C capture-time change                    → no decision change
 *   D appended future candles                → earlier decision unchanged
 *   E future structure/liquidity events      → cannot alter an earlier decision
 *   F LIVE still uses real wall-clock freshness
 *   G a historical run never becomes LIVE
 *   H a stale LIVE snapshot is still rejected
 *   I a prefix months old is legitimately evaluable as of its own instant
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAnalysis } from "@/lib/analysis-engine";
import { buildChain, buildMtfContext } from "@/lib/data/mtf";
import type { MtfCandleInput } from "@/lib/data/mtf";
import { computeSmcContext } from "@/lib/data/smc";
import { calculateTechnical } from "@/lib/data/technical";
import { assessDataQuality } from "@/lib/data-quality";
import type { MarketData, OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import { describeDecisionClock, historicalAsOfClock } from "@/lib/decision-clock";
import { buildCoverageReport, formatCoverageReport, selectBenchmark } from "@/lib/historical/benchmark";
import { loadRecordedFixture, loadRecordedFixtures } from "@/lib/historical/fixtures";
import { decisiveProjection, runRecordedBenchmark, runRecordedDataset } from "@/lib/historical/recorded-walkforward";
import type { OutcomeCandle } from "@/lib/outcome-validation";
import type { AnalysisInput, AnalysisResult, Timeframe } from "@/types/analysis";

const NOW = Date.now();
const fixtures = loadRecordedFixtures();
const OPTIONS = { minPrefixCandles: 24, maxEvaluations: 10, maxFutureCandles: 10 };

function inputFor(datasetId: string, withClock: boolean) {
  const parsed = fixtures.byId.get(datasetId)!;
  const meta = parsed.provenance;
  return (prefix: readonly OutcomeCandle[]): AnalysisInput => {
    const candles = prefix as unknown as OhlcvCandle[];
    const last = candles[candles.length - 1];
    const tech: TechnicalData = {
      ...calculateTechnical(candles, candles, meta.timeframe),
      structure: "HH/HL",
      bosDirection: "bullish",
      smc: computeSmcContext(candles, meta.timeframe),
      mtf: buildMtfContext(meta.timeframe, [
        { timeframe: meta.timeframe, role: "setup", candles },
        ...buildChain(meta.timeframe).map((t) => ({ timeframe: t.timeframe, role: t.role, candles } satisfies MtfCandleInput)),
      ]),
    };
    return {
      instrument: meta.instrument,
      instrumentType: meta.assetClass as "crypto" | "forex" | "stock",
      timeframe: meta.timeframe as Timeframe,
      provider: meta.provider,
      providerInstrumentId: meta.providerInstrumentId,
      marketData: {
        instrument: meta.instrument,
        instrumentType: meta.assetClass,
        provider: meta.provider,
        providerInstrumentId: meta.providerInstrumentId,
        fetchTimestamp: last.timestamp,
        price: { price: last.close, timestamp: last.timestamp, source: meta.provider },
        candles,
        timeframe: meta.timeframe,
        dataFreshness: "delayed",
      } as unknown as MarketData,
      technicalData: tech,
      economicEvents: "",
      ...(withClock ? { decisionClock: historicalAsOfClock(last.timestamp) } : {}),
    } as unknown as AnalysisInput;
  };
}

/** A decision projection that excludes the id (which carries the wall clock by design). */
const projection = (report: { evaluations: readonly { decision: unknown }[] }) =>
  JSON.stringify(report.evaluations.map((e) => e.decision));

/** Decisive fields of an engine result — the id is excluded (built from the clock). */
const decisive = (result: AnalysisResult) =>
  JSON.stringify({
    recommendation: result.recommendation,
    bias: result.bias,
    confidence: result.confidence,
    reasons: result.noTradeReasons ?? [],
    plan: result.tradePlan ?? null,
    location: result.tradeLocation?.location ?? null,
    state: result.tradeLocation?.context.state ?? null,
    timestamp: result.timestamp,
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("§10 A–C the process clock, the capture instant and the alignment are not decision inputs", () => {
  const datasetId = "okx-BTC-USDT-4H";

  it("A/B/C: identical decisions across a wall-clock jump, a different capture instant and a re-run", () => {
    const parsed = fixtures.byId.get(datasetId)!;
    const baseline = runRecordedDataset(parsed, inputFor(datasetId, true), OPTIONS);
    const snapshot = projection(baseline.report);

    // B — "today" moves forward five years.
    vi.spyOn(Date, "now").mockReturnValue(NOW + 5 * 365 * 86_400_000);
    const jumped = runRecordedDataset(parsed, inputFor(datasetId, true), OPTIONS);
    expect(projection(jumped.report)).toBe(snapshot);
    expect(jumped.report.evaluations.map((e) => e.decision.evaluationTime)).toEqual(
      baseline.report.evaluations.map((e) => e.decision.evaluationTime),
    );
    vi.restoreAllMocks();

    // C — the dataset's capture instant (metadata) is changed; decisions cannot move.
    const recaptured = {
      ...parsed,
      provenance: { ...parsed.provenance, capturedAt: "2031-01-01T00:00:00.000Z" },
    };
    expect(projection(runRecordedDataset(recaptured, inputFor(datasetId, true), OPTIONS).report)).toBe(snapshot);

    // Re-run determinism.
    expect(projection(runRecordedDataset(parsed, inputFor(datasetId, true), OPTIONS).report)).toBe(snapshot);
  });

  it("A: the same prefix and the same historical instant always give the same decision", () => {
    const parsed = fixtures.byId.get(datasetId)!;
    const prefix = parsed.candles.filter((c) => c.closed).slice(0, 61);
    const first = runAnalysis(inputFor(datasetId, true)(prefix));
    vi.spyOn(Date, "now").mockReturnValue(NOW + 900 * 86_400_000);
    const second = runAnalysis(inputFor(datasetId, true)(prefix));
    expect(decisive(second)).toBe(decisive(first));
    expect(second.timestamp).toBe(first.timestamp);
  });
});

describe("§10 D/E future candles and future events cannot alter an earlier decision", () => {
  const datasetId = "okx-BTC-USDT-4H";

  it("D: removing 30 later candles changes no decision", () => {
    const parsed = fixtures.byId.get(datasetId)!;
    const indices = [45, 50, 55];
    const full = runRecordedDataset(parsed, inputFor(datasetId, true), { ...OPTIONS, evaluationIndices: indices });
    // A strict prefix of the same provider rows: no value is invented, the future is simply absent.
    const truncated = { ...parsed, candles: parsed.candles.slice(0, 60) };
    const short = runRecordedDataset(truncated, inputFor(datasetId, true), { ...OPTIONS, evaluationIndices: indices });
    expect(projection(short.report)).toBe(projection(full.report));
    expect(short.report.sample).toEqual(full.report.sample);
  });

  it("E: a future structure/liquidity event cannot change the decision taken before it", () => {
    const parsed = fixtures.byId.get(datasetId)!;
    const closed = parsed.candles.filter((c) => c.closed);
    // The widest displacement candle after the first 40 bars — the kind of bar
    // that creates FVG/OB/structure evidence. A look-ahead bug would leak it
    // backwards into the decision taken just before it.
    let eventIndex = 40;
    let widest = -Infinity;
    for (let i = 40; i < closed.length; i += 1) {
      const width = closed[i].high - closed[i].low;
      if (width > widest) {
        widest = width;
        eventIndex = i;
      }
    }
    expect(eventIndex).toBeGreaterThanOrEqual(40);
    const indices = [eventIndex - 6, eventIndex - 1];
    const full = runRecordedDataset(parsed, inputFor(datasetId, true), { ...OPTIONS, evaluationIndices: indices });
    // Truncation removes the event candle itself and everything after it.
    const beforeTheEvent = { ...parsed, candles: parsed.candles.slice(0, eventIndex) };
    const truncated = runRecordedDataset(beforeTheEvent, inputFor(datasetId, true), { ...OPTIONS, evaluationIndices: indices });
    expect(projection(truncated.report)).toBe(projection(full.report));
    // The event candle is not part of any deciding prefix.
    expect(beforeTheEvent.candles[beforeTheEvent.candles.length - 1].timestamp).toBeLessThan(closed[eventIndex].timestamp);
    expect(truncated.report.evaluations.every((e) => e.decision.evaluationTime < closed[eventIndex].timestamp)).toBe(true);
  });
});

describe("§10 F/H live freshness is untouched by all of this", () => {
  const datasetId = "okx-BTC-USDT-4H";

  it("H: the recorded snapshot is still rejected when evaluated as LIVE", () => {
    const parsed = fixtures.byId.get(datasetId)!;
    const prefix = parsed.candles.filter((c) => c.closed);
    const live = runAnalysis(inputFor(datasetId, false)(prefix));
    expect(live.recommendation).toBe("NO_TRADE");
    expect((live.noTradeReasons ?? []).join(" ")).toMatch(/older than/);
    expect(live.tradePlan).toBeUndefined();
    expect(live.positionSizing).toBeUndefined();
  });

  it("F: the data-quality layer keeps its own timestamp validation, now clock-aware", () => {
    const parsed = fixtures.byId.get(datasetId)!;
    const prefix = parsed.candles.filter((c) => c.closed).slice(0, 61);
    const base = inputFor(datasetId, false)(prefix);
    const last = prefix[prefix.length - 1];

    // A snapshot dated after the live clock is invalid…
    const future = runAnalysis({
      ...base,
      marketData: { ...base.marketData!, price: { ...base.marketData!.price!, timestamp: NOW + 10 * 60_000 } } as MarketData,
    });
    expect((future.noTradeReasons ?? []).join(" ")).toMatch(/implausibly in the future/);
    expect(assessDataQuality({
      ...base,
      marketData: { ...base.marketData!, price: { ...base.marketData!.price!, timestamp: NOW + 10 * 60_000 } } as MarketData,
    }).primaryData.status).toBe("INVALID");
    // …and a non-finite timestamp is invalid too.
    const invalid = runAnalysis({
      ...base,
      marketData: { ...base.marketData!, price: { ...base.marketData!.price!, timestamp: Number.NaN } } as MarketData,
    });
    expect((invalid.noTradeReasons ?? []).join(" ")).toMatch(/invalid or implausibly in the future/);
    // A historical as-of reading accepts the same snapshot without touching LIVE.
    const historical = runAnalysis({ ...inputFor(datasetId, true)(prefix) });
    expect((historical.noTradeReasons ?? []).join(" ")).not.toMatch(/older than/);
    expect(last.timestamp).toBeLessThan(NOW);
  });
});

describe("§10 G/I a historical sample is never LIVE and is legitimately evaluable as of its instant", () => {
  it("G: the run reports its clock as HISTORICAL AS-OF and never claims a live feed", () => {
    const parsed = fixtures.byId.get("okx-BTC-USDT-4H")!;
    const run = runRecordedDataset(parsed, inputFor("okx-BTC-USDT-4H", true), OPTIONS);
    expect(run.decisionClockMode).toBe("HISTORICAL_AS_OF");
    const pairs = [{ dataset: parsed, report: run.report }];
    const text = formatCoverageReport(buildCoverageReport([parsed], pairs), pairs).join("\n");
    expect(text).toContain("Decision clock — HISTORICAL AS-OF");
    expect(text).toContain("never a live feed");
    expect(text).not.toMatch(/\bLIVE\b/);
    expect(describeDecisionClock(historicalAsOfClock(run.asOfFirst!))).toMatch(/HISTORICAL AS-OF/);
  });

  it("I: every evaluation instant is a recorded closed candle, older than today", () => {
    const parsed = fixtures.byId.get("twelvedata-EURUSD-1D")!;
    const run = runRecordedDataset(parsed, inputFor("twelvedata-EURUSD-1D", true), OPTIONS);
    expect(run.report.evaluations.length).toBe(10);
    for (const evaluation of run.report.evaluations) {
      const instant = evaluation.decision.evaluationTime;
      expect(parsed.candles.some((c) => c.timestamp === instant && c.closed)).toBe(true);
      expect(NOW - instant).toBeGreaterThan(86_400_000); // genuinely historical: at least a day old
    }
    // …and the recorded sample is still honest about what it is.
    expect(run.report.sample.plannedTrades).toBe(0);
    expect(run.report.calibration.status).toBe("INSUFFICIENT_SAMPLE");
  });
});

describe("§12/§13 the recorded aggregate stays honest under the corrected clock", () => {
  it("keeps the recorded benchmark at 0 actionable and 0 resolved, with the gate facts recorded", () => {
    const selection = selectBenchmark(fixtures.datasets);
    const runs = selection.selected.map((s) => {
      const parsed = fixtures.byId.get(s.datasetId)!;
      return runRecordedBenchmark([parsed], selectBenchmark([parsed]), inputFor(s.datasetId, true), OPTIONS).runs[0];
    });
    expect(runs).toHaveLength(8);
    expect(runs.reduce((sum, r) => sum + r.report.sample.plannedTrades, 0)).toBe(0);
    expect(runs.reduce((sum, r) => sum + r.report.sample.resolved, 0)).toBe(0);
    expect(runs.every((r) => r.report.evaluations.every((e) => e.decision.failedGates !== undefined))).toBe(true);
    expect(runs.every((r) => r.decisionClockMode === "HISTORICAL_AS_OF")).toBe(true);
    // Deterministic projections: the same inputs produce the same decisions.
    const again = runs.map((r) => {
      const parsed = fixtures.byId.get(r.datasetId)!;
      return runRecordedBenchmark([parsed], selectBenchmark([parsed]), inputFor(r.datasetId, true), OPTIONS).runs[0];
    });
    expect(again.map((r) => decisiveProjection(r.report))).toEqual(runs.map((r) => decisiveProjection(r.report)));
  });
});
