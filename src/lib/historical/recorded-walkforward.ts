/**
 * Phase 294 — RECORDED DATASET → PHASE 293 WALK-FORWARD INTEGRATION (§8, §15).
 *
 * This is the join between the canonical recorded dataset and the Phase 293
 * evaluator. Phase 293 is consumed, not reimplemented: the prefix → production
 * analysis → Phase 291 context → Phase 292 plan → future candles → Phase 293
 * outcome chain stays exactly as it is. What this module adds:
 *
 *  · only CLOSED candles of a recorded dataset are ever handed to the engine —
 *    a forming bar is a historical payload's live edge and is excluded from
 *    decisions (its presence is reported, not silently used);
 *  · the recorded provenance travels with the run (provider, instrument,
 *    timeframe, dataset id, dataset fingerprint, capture instant);
 *  · aligned runs keep each decision's ORIGINAL provider instant, so the
 *    chronology is auditable and the wall-clock alignment is one constant;
 *  · designed test fixtures can be run for causality tests, but they are
 *    reported in a separate bucket and can never reach the recorded aggregates.
 */

import type { AnalysisInput } from "@/types/analysis";
import type { OutcomeCandle, OutcomeValidationReport, WalkForwardAlignment } from "../outcome-validation";
import { runWalkForward } from "../outcome-validation";
import type { HistoricalCandle, ParsedDataset } from "./dataset";
import type { BenchmarkSelection } from "./benchmark";

export interface RecordedRunOptions {
  alignment: WalkForwardAlignment;
  maxEvaluations?: number;
  maxFutureCandles?: number;
  minPrefixCandles?: number;
  evaluationIndices?: readonly number[];
}

export interface RecordedDatasetRun {
  datasetId: string;
  provider: string;
  providerInstrumentId: string;
  instrument: string;
  assetClass: string;
  timeframe: string;
  sourceClassification: ParsedDataset["provenance"]["sourceClassification"];
  datasetFingerprint: string;
  capturedAt: string;
  /** Candles used for decisions — closed bars only. */
  closedCandles: number;
  /** Forming bars excluded from decisions (recorded, never used). */
  formingCandlesExcluded: number;
  report: OutcomeValidationReport;
}

export interface RecordedBenchmarkRun {
  runs: RecordedDatasetRun[];
  /** Aggregates over RECORDED_HISTORICAL datasets only. */
  recordedRuns: RecordedDatasetRun[];
  /** Runs over DESIGNED_TEST_FIXTURE data — reported apart, never pooled. */
  designedRuns: RecordedDatasetRun[];
  selection: BenchmarkSelection;
}

/** Outcome candles carry OHLC only — recorded volume is not needed by Phase 293. */
export function closedOutcomeCandles(parsed: ParsedDataset): { candles: OutcomeCandle[]; excluded: number } {
  const closed: HistoricalCandle[] = parsed.candles.filter((c) => c.closed);
  return {
    candles: closed.map((c) => ({ timestamp: c.timestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
    excluded: parsed.candles.length - closed.length,
  };
}

/**
 * Evaluate one recorded dataset with the Phase 293 driver. `buildInput` is the
 * caller's mapping from a candle prefix to a production `AnalysisInput` — the
 * same callable Phase 293 uses, so the decision chain is unchanged.
 */
export function runRecordedDataset(
  parsed: ParsedDataset,
  buildInput: (prefix: readonly OutcomeCandle[], index: number) => AnalysisInput,
  options: RecordedRunOptions,
): RecordedDatasetRun {
  const { candles, excluded } = closedOutcomeCandles(parsed);
  const report = runWalkForward(candles, buildInput, {
    alignment: options.alignment,
    ...(options.maxEvaluations !== undefined ? { maxEvaluations: options.maxEvaluations } : {}),
    ...(options.maxFutureCandles !== undefined ? { maxFutureCandles: options.maxFutureCandles } : {}),
    ...(options.minPrefixCandles !== undefined ? { minPrefixCandles: options.minPrefixCandles } : {}),
    ...(options.evaluationIndices !== undefined ? { evaluationIndices: options.evaluationIndices } : {}),
  });

  return {
    datasetId: parsed.provenance.datasetId,
    provider: parsed.provenance.provider,
    providerInstrumentId: parsed.provenance.providerInstrumentId,
    instrument: parsed.provenance.instrument,
    assetClass: parsed.provenance.assetClass,
    timeframe: parsed.provenance.timeframe,
    sourceClassification: parsed.provenance.sourceClassification,
    datasetFingerprint: parsed.fingerprint,
    capturedAt: parsed.provenance.capturedAt,
    closedCandles: candles.length,
    formingCandlesExcluded: excluded,
    report,
  };
}

export function runRecordedBenchmark(
  datasets: readonly ParsedDataset[],
  selection: BenchmarkSelection,
  buildInput: (prefix: readonly OutcomeCandle[], index: number) => AnalysisInput,
  options: RecordedRunOptions,
): RecordedBenchmarkRun {
  const selectedIds = new Set(selection.selected.map((s) => s.datasetId));
  const chosen = datasets.filter((d) => selectedIds.has(d.provenance.datasetId));
  const runs = chosen.map((d) => runRecordedDataset(d, buildInput, options));
  return {
    runs,
    recordedRuns: runs.filter((r) => r.sourceClassification === "RECORDED_HISTORICAL"),
    designedRuns: runs.filter((r) => r.sourceClassification === "DESIGNED_TEST_FIXTURE"),
    selection,
  };
}

/** Deterministic dataset identity for a whole benchmark run (§11). */
export function benchmarkFingerprint(run: RecordedBenchmarkRun): string {
  return run.recordedRuns
    .map((r) => `${r.datasetId}=${r.datasetFingerprint}`)
    .sort()
    .join(";");
}

/**
 * §8 proof helper: the decision snapshot of a window must not change when
 * future candles are appended. Returns the decisive fields only — an engine
 * result carries an id built from the clock, which is not part of the decision.
 */
export function decisiveProjection(report: OutcomeValidationReport): string[] {
  return report.evaluations.map((e) => {
    const d = e.decision;
    return JSON.stringify({
      i: d.evaluationIndex,
      recommendation: d.recommendation,
      setupState: d.setupState,
      location: d.location,
      confidence: d.confidence,
      conviction: d.conviction,
      bias: d.bias,
      direction: d.direction ?? null,
      entry: d.entry ?? null,
      stopLoss: d.stopLoss ?? null,
      takeProfit: d.takeProfit ?? null,
      plannedRR: d.plannedRR ?? null,
      stopSource: d.stopSource ?? null,
      targetSource: d.targetSource ?? null,
      sweep: d.sweepPresent,
      fvg: d.fvgEngaged,
      ob: d.obEngaged,
      structural: d.structuralEventPresent,
    });
  });
}
