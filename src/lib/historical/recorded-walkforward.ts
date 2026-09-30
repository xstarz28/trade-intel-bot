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
import { historicalAsOfClock, type DecisionClockMode } from "../decision-clock";
import type { HistoricalCandle, ParsedDataset } from "./dataset";
import type { BenchmarkSelection } from "./benchmark";

export type RecordedClockMode = "HISTORICAL_AS_OF" | "WALL_CLOCK_ALIGNED";

export interface RecordedRunOptions {
  /**
   * Decision-clock policy for the run.
   *  · HISTORICAL_AS_OF (default, Phase 295): each evaluation is decided as of
   *    the prefix's last CLOSED provider candle. Provider timestamps are used
   *    verbatim — no bar is moved — and freshness is measured against that
   *    historical instant.
   *  · WALL_CLOCK_ALIGNED (Phase 294 legacy): the whole window is re-timed by
   *    one constant so the decision candle reads "now". Kept for the wall-clock
   *    alignment path; it does not represent a historical decision instant.
   */
  clock?: RecordedClockMode;
  /** Observation instant for the legacy aligned mode only. */
  wallClockNowMs?: number;
  maxEvaluations?: number;
  maxFutureCandles?: number;
  minPrefixCandles?: number;
  evaluationIndices?: readonly number[];
}

export const HISTORICAL_AS_OF_NOTE =
  "Each evaluation is decided as of the prefix's last CLOSED provider candle (historical as-of decision clock); provider timestamps are used verbatim and no bar is re-timed. RECORDED / HISTORICAL sample — never a live feed, and never evaluated against today's clock.";

export const WALL_CLOCK_ALIGNED_NOTE =
  "Phase 294 legacy wall-clock alignment: one constant shift re-times the window so the decision candle reads the observation instant. Prefer the historical as-of clock for recorded replays.";

/** Alignment used for the legacy wall-clock mode (the as-of mode uses provider timestamps). */
function legacyAlignment(nowMs: number): WalkForwardAlignment {
  return { mode: "WALL_CLOCK_ALIGNED", nowMs, note: WALL_CLOCK_ALIGNED_NOTE };
}

export interface RecordedDatasetRun {
  datasetId: string;
  /**
   * Which decision clock produced these decisions:
   *  · HISTORICAL_AS_OF — the prefix's last closed provider candle;
   *  · LIVE_WALL_CLOCK — the legacy aligned mode, which consumes the process
   *    clock (the live transport clock) on re-timed candles. It names the clock
   *    source only: the candles remain recorded provider history and are still
   *    reported as a RECORDED sample.
   */
  decisionClockMode: DecisionClockMode;
  /** Historical as-of instants of the first and last evaluation (recorded). */
  asOfFirst?: number;
  asOfLast?: number;
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
  const clockMode: RecordedClockMode = options.clock ?? "HISTORICAL_AS_OF";

  // The historical as-of instant is the prefix's last CLOSED candle — taken from
  // the prefix itself, so it can never drift onto the capture instant or today.
  const clockedBuildInput = (prefix: readonly OutcomeCandle[], index: number): AnalysisInput => {
    const input = buildInput(prefix, index);
    if (clockMode !== "HISTORICAL_AS_OF") return input;
    const asOf = prefix[prefix.length - 1]?.timestamp;
    if (asOf === undefined) return input;
    return { ...input, decisionClock: historicalAsOfClock(asOf) };
  };

  const report = runWalkForward(candles, clockedBuildInput, {
    alignment: clockMode === "HISTORICAL_AS_OF" ? { mode: "PROVIDER_TIMESTAMPS", note: HISTORICAL_AS_OF_NOTE } : legacyAlignment(options.wallClockNowMs ?? Date.now()),
    ...(options.maxEvaluations !== undefined ? { maxEvaluations: options.maxEvaluations } : {}),
    ...(options.maxFutureCandles !== undefined ? { maxFutureCandles: options.maxFutureCandles } : {}),
    ...(options.minPrefixCandles !== undefined ? { minPrefixCandles: options.minPrefixCandles } : {}),
    ...(options.evaluationIndices !== undefined ? { evaluationIndices: options.evaluationIndices } : {}),
  });

  const asOfs = report.evaluations.map((e) => e.decision.evaluationTime);

  return {
    datasetId: parsed.provenance.datasetId,
    decisionClockMode: clockMode === "HISTORICAL_AS_OF" ? "HISTORICAL_AS_OF" : "LIVE_WALL_CLOCK",
    ...(clockMode === "HISTORICAL_AS_OF" && asOfs.length > 0 ? { asOfFirst: asOfs[0], asOfLast: asOfs[asOfs.length - 1] } : {}),
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
