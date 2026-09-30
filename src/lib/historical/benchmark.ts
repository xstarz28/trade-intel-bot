/**
 * Phase 294 — DETERMINISTIC BENCHMARK SELECTION & COVERAGE DIAGNOSTICS (§6, §9).
 *
 * HOW THE BENCHMARK IS CHOSEN (fixed before any evaluation, never tuned)
 * --------------------------------------------------------------------
 *  1. One instrument per asset class for which a provider genuinely served
 *     history in the recorded set. An asset class with no recorded provider
 *     history is reported as unavailable — the rule cannot invent one.
 *  2. Within an asset class, the instrument with the most recorded candles wins.
 *  3. Ties are broken by provider name, then provider instrument id (alphabetical).
 *  4. Every recorded timeframe of a selected instrument is included; no timeframe
 *     is dropped or resampled to make a window look longer.
 *  5. Selection reads COVERAGE ONLY (counts, dates, timeframes, provider
 *     identity). It never reads an outcome, R-multiple, hit rate or setup state,
 *     so the benchmark cannot be optimised toward a pleasing result.
 *
 * Diagnostics below are descriptive: counts, coverage, window counts and the
 * Phase 293 outcome vocabulary. They deliberately contain no ranking of
 * instruments by results — the evaluator's own aggregates carry the sample-size
 * floors and are marked insufficient when they are.
 */

import type { OutcomeValidationReport } from "../outcome-validation";
import { formatValidationDiagnostics } from "../outcome-validation";
import type { ParsedDataset } from "./dataset";
import { datasetDiagnostics, formatDatasetDiagnostics } from "./dataset";
import { ACQUISITION_GAPS, type RecordedFixtureEntry } from "./fixtures";

export const BENCHMARK_SELECTION_RULE =
  "one instrument per asset class with recorded provider history; most recorded candles wins; ties by provider then provider instrument id; all recorded timeframes of the winner included; coverage facts only — evaluation results never consulted";

export interface BenchmarkCoverage {
  datasetId: string;
  provider: string;
  providerInstrumentId: string;
  instrument: string;
  assetClass: string;
  timeframe: string;
  candles: number;
  earliestTimestamp?: number;
  latestTimestamp?: number;
}

export interface BenchmarkSelection {
  rule: string;
  selected: BenchmarkCoverage[];
  excluded: { datasetId: string; reason: string }[];
  unavailableAssetClasses: { assetClass: string; reason: string }[];
}

export function coverageOf(parsed: ParsedDataset): BenchmarkCoverage {
  const stamps = parsed.candles.map((c) => c.timestamp);
  return {
    datasetId: parsed.provenance.datasetId,
    provider: parsed.provenance.provider,
    providerInstrumentId: parsed.provenance.providerInstrumentId,
    instrument: parsed.provenance.instrument,
    assetClass: parsed.provenance.assetClass,
    timeframe: parsed.provenance.timeframe,
    candles: parsed.candles.length,
    ...(stamps.length > 0 ? { earliestTimestamp: Math.min(...stamps) } : {}),
    ...(stamps.length > 0 ? { latestTimestamp: Math.max(...stamps) } : {}),
  };
}

const TIMEFRAME_ORDER = ["M15", "H1", "H4", "D1", "W1"];

export function selectBenchmark(datasets: readonly ParsedDataset[]): BenchmarkSelection {
  const excluded: { datasetId: string; reason: string }[] = [];
  const byInstrumentClass = new Map<string, BenchmarkCoverage[]>();

  for (const parsed of datasets) {
    if (parsed.status === "QUARANTINED") {
      // A dataset that failed the gates is never eligible — not even as a tie-breaker.
      excluded.push({ datasetId: parsed.provenance.datasetId, reason: "quarantined by the quality gates" });
      continue;
    }
    const key = `${parsed.provenance.assetClass}::${parsed.provenance.provider}::${parsed.provenance.providerInstrumentId}`;
    const list = byInstrumentClass.get(key) ?? [];
    list.push(coverageOf(parsed));
    byInstrumentClass.set(key, list);
  }

  // Rule 2/3: pick the instrument per asset class with the most candles; the
  // reduction is a deterministic sort, so equal inputs always pick the same one.
  const bestPerClass = new Map<string, string>();
  const totals = new Map<string, number>();
  for (const [key, list] of byInstrumentClass) {
    const assetClass = key.split("::")[0];
    const total = list.reduce((sum, entry) => sum + entry.candles, 0);
    totals.set(key, total);
  }
  const sortedKeys = [...byInstrumentClass.keys()].sort((a, b) => {
    const totalDiff = (totals.get(b) ?? 0) - (totals.get(a) ?? 0);
    if (totalDiff !== 0) return totalDiff;
    return a.localeCompare(b);
  });
  for (const key of sortedKeys) {
    const assetClass = key.split("::")[0];
    if (!bestPerClass.has(assetClass)) bestPerClass.set(assetClass, key);
  }

  const selected: BenchmarkCoverage[] = [];
  // Iterate the deterministic key order, so the selection does not depend on the
  // order the caller happened to load the datasets in.
  for (const key of sortedKeys) {
    const list = byInstrumentClass.get(key)!;
    const chosen = bestPerClass.get(key.split("::")[0]) === key;
    if (!chosen) {
      excluded.push({
        datasetId: list[0].datasetId,
        reason: `another instrument of asset class ${list[0].assetClass} has more recorded candles (coverage rule, not a result)`,
      });
      continue;
    }
    for (const coverage of [...list].sort((a, b) => TIMEFRAME_ORDER.indexOf(a.timeframe) - TIMEFRAME_ORDER.indexOf(b.timeframe))) {
      selected.push(coverage);
    }
  }

  const unavailableAssetClasses = ACQUISITION_GAPS.map((gap) => ({
    assetClass: gap.assetClass,
    reason: `${gap.symbol}: ${gap.reason}`,
  }));

  return {
    rule: BENCHMARK_SELECTION_RULE,
    selected,
    excluded: excluded.sort((a, b) => a.datasetId.localeCompare(b.datasetId)),
    unavailableAssetClasses,
  };
}

export function formatBenchmarkSelection(selection: BenchmarkSelection): string[] {
  const lines = [`Benchmark selection rule: ${selection.rule}`];
  lines.push(`Selected datasets: ${selection.selected.length}`);
  for (const entry of selection.selected) {
    lines.push(
      `• ${entry.provider} ${entry.providerInstrumentId} (${entry.assetClass}) ${entry.timeframe} — ${entry.candles} recorded candles`,
    );
  }
  for (const entry of selection.excluded) lines.push(`• not selected: ${entry.datasetId} — ${entry.reason}`);
  for (const gap of selection.unavailableAssetClasses) {
    lines.push(`• asset class unavailable: ${gap.assetClass} — ${gap.reason}`);
  }
  return lines;
}

// ── §9 coverage diagnostics ──────────────────────────────────────

export interface BenchmarkRunSummary {
  datasetId: string;
  provider: string;
  instrument: string;
  assetClass: string;
  timeframe: string;
  candles: number;
  evaluations: number;
  actionable: number;
  noTrade: number;
  resolved: number;
  ambiguous: number;
  insufficientFutureData: number;
  calibrationStatus: string;
}

export function summarizeRun(dataset: ParsedDataset, report: OutcomeValidationReport): BenchmarkRunSummary {
  const s = report.sample;
  return {
    datasetId: dataset.provenance.datasetId,
    provider: dataset.provenance.provider,
    instrument: dataset.provenance.instrument,
    assetClass: dataset.provenance.assetClass,
    timeframe: dataset.provenance.timeframe,
    candles: dataset.candles.length,
    evaluations: s.evaluations,
    actionable: s.plannedTrades,
    noTrade: s.noTrade,
    resolved: s.resolved,
    ambiguous: s.ambiguous,
    insufficientFutureData: s.insufficientFutureData,
    calibrationStatus: report.calibration.status,
  };
}

export interface CoverageReport {
  datasets: number;
  candles: number;
  instruments: number;
  providers: number;
  assetClasses: string[];
  timeframes: string[];
  earliestIso?: string;
  latestIso?: string;
  evaluations: number;
  actionable: number;
  noTrade: number;
  resolved: number;
  ambiguous: number;
  insufficientFutureData: number;
  byAssetClass: { assetClass: string; evaluations: number; actionable: number; resolved: number }[];
  bySetupState: { state: string; evaluations: number; resolved: number; sampleSufficient: boolean }[];
  calibrationStatus: string;
}

export function buildCoverageReport(
  datasets: readonly ParsedDataset[],
  runs: readonly { dataset: ParsedDataset; report: OutcomeValidationReport }[],
): CoverageReport {
  const base = datasetDiagnostics(datasets);
  const byAssetClass = new Map<string, { evaluations: number; actionable: number; resolved: number }>();
  const bySetupState = new Map<string, { evaluations: number; resolved: number; sampleSufficient: boolean }>();

  for (const { dataset, report } of runs) {
    const bucket = byAssetClass.get(dataset.provenance.assetClass) ?? { evaluations: 0, actionable: 0, resolved: 0 };
    bucket.evaluations += report.sample.evaluations;
    bucket.actionable += report.sample.plannedTrades;
    bucket.resolved += report.sample.resolved;
    byAssetClass.set(dataset.provenance.assetClass, bucket);

    for (const state of report.bySetupState) {
      const entry = bySetupState.get(state.label) ?? { evaluations: 0, resolved: 0, sampleSufficient: false };
      entry.evaluations += state.occurrences;
      entry.resolved += state.resolved;
      entry.sampleSufficient = state.sampleSufficient;
      bySetupState.set(state.label, entry);
    }
  }

  const sum = (pick: (s: OutcomeValidationReport["sample"]) => number) =>
    runs.reduce((acc, run) => acc + pick(run.report.sample), 0);

  return {
    datasets: base.datasets,
    candles: base.candles,
    instruments: base.instruments,
    providers: base.providers,
    assetClasses: base.assetClasses,
    timeframes: base.timeframes,
    ...(base.earliestTimestamp !== undefined ? { earliestIso: new Date(base.earliestTimestamp).toISOString() } : {}),
    ...(base.latestTimestamp !== undefined ? { latestIso: new Date(base.latestTimestamp).toISOString() } : {}),
    evaluations: sum((s) => s.evaluations),
    actionable: sum((s) => s.plannedTrades),
    noTrade: sum((s) => s.noTrade),
    resolved: sum((s) => s.resolved),
    ambiguous: sum((s) => s.ambiguous),
    insufficientFutureData: sum((s) => s.insufficientFutureData),
    byAssetClass: [...byAssetClass.entries()]
      .map(([assetClass, v]) => ({ assetClass, ...v }))
      .sort((a, b) => a.assetClass.localeCompare(b.assetClass)),
    bySetupState: [...bySetupState.entries()]
      .map(([state, v]) => ({ state, ...v }))
      .sort((a, b) => a.state.localeCompare(b.state)),
    calibrationStatus: runs.every((r) => r.report.calibration.status === "INSUFFICIENT_SAMPLE")
      ? "INSUFFICIENT_SAMPLE"
      : "DESCRIPTIVE_ONLY",
  };
}

export function formatCoverageReport(coverage: CoverageReport, runs: readonly { dataset: ParsedDataset; report: OutcomeValidationReport }[]): string[] {
  const lines = [
    `Recorded historical datasets: ${coverage.datasets} (${coverage.candles} candles)`,
    `Providers: ${coverage.providers} · instruments: ${coverage.instruments}`,
    `Asset classes: ${coverage.assetClasses.join(", ")}`,
    `Timeframes: ${coverage.timeframes.join(", ")}`,
  ];
  if (coverage.earliestIso && coverage.latestIso) lines.push(`Coverage: ${coverage.earliestIso} → ${coverage.latestIso}`);
  lines.push(`Usable windows (evaluations): ${coverage.evaluations}`);
  lines.push(`Actionable decisions: ${coverage.actionable} · NO_TRADE: ${coverage.noTrade}`);
  lines.push(`Resolved outcomes: ${coverage.resolved} · ambiguous: ${coverage.ambiguous} · insufficient future data: ${coverage.insufficientFutureData}`);
  lines.push(`Calibration: ${coverage.calibrationStatus}`);
  for (const entry of coverage.byAssetClass) {
    lines.push(`• ${entry.assetClass}: ${entry.evaluations} windows, ${entry.actionable} actionable, ${entry.resolved} resolved`);
  }
  for (const entry of coverage.bySetupState) {
    lines.push(
      `• setup state ${entry.state}: ${entry.evaluations} windows, ${entry.resolved} resolved, ${
        entry.sampleSufficient ? "DESCRIPTIVE_ONLY" : "INSUFFICIENT_SAMPLE"
      }`,
    );
  }
  for (const run of runs) {
    const p = run.report.provenance;
    if (p.firstProviderTime !== undefined && p.lastProviderTime !== undefined) {
      // The decisions were taken on the provider's own bars; the aligned clock
      // reading is a presentation detail, so the recorded window is printed too.
      lines.push(
        `${run.dataset.provenance.datasetId}: recorded decision window (provider instants): ${new Date(p.firstProviderTime).toISOString()} → ${new Date(p.lastProviderTime).toISOString()}`,
      );
    }
    lines.push(...formatValidationDiagnostics(run.report).map((line) => `${run.dataset.provenance.datasetId}: ${line}`));
  }
  return lines;
}

export { formatDatasetDiagnostics };
