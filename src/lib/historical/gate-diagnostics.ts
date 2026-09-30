/**
 * Phase 295 — GATE BOTTLENECK DIAGNOSTICS (§6, §7, §13).
 *
 * Phase 294 could report "0 actionable out of 80 recorded evaluations" but not
 * WHY. This module aggregates the engine's own gate trace across a set of
 * evaluations so the attribution is visible:
 *
 *   · how many evaluations each gate failed (an occurrence count, never a score);
 *   · how many gates failed together in one evaluation;
 *   · the EARLIEST failure per evaluation in the engine's canonical gate order
 *     (`firstBlockingGate`) — an observation about what the engine saw first,
 *     not a ranking of gates and not a claim that later gates did not matter;
 *   · setup states reached before rejection;
 *   · data-validity failures (GATE0/GATE1/GATE2) separated from analytical ones.
 *
 * HONESTY RULES
 * -------------
 * · One bounded pass, no clock, no randomness, no network.
 * · Counts are counts. Nothing here is ranked, weighted, scored or combined into
 *   a quality figure, and nothing feeds back into a decision.
 * · An evaluation with no recorded failure is reported as such (it is either an
 *   actionable decision or a decline attributed outside the gate list).
 */

import { GATE_IDS } from "@/lib/decision-trace";
import type { OutcomeEvaluation } from "../outcome-validation";

export const GATE_DIAGNOSTICS_VERSION = "phase295.1";

/** Gates that describe data validity rather than analytical disagreement. */
export const DATA_VALIDITY_GATES = ["GATE0_DATA_FRESHNESS", "GATE1_LIVE_PRICE", "GATE2_COMPLETENESS"] as const;

export interface GateBottleneckReport {
  version: string;
  evaluations: number;
  actionable: number;
  noTrade: number;
  /** Canonical gate order; `occurrences` = evaluations in which the gate failed. */
  failedGateCounts: { gateId: string; occurrences: number }[];
  /** Earliest failure per evaluation, in canonical gate order. */
  firstBlockerCounts: { gateId: string; occurrences: number }[];
  /** How many gates failed together within one evaluation. */
  multiGateFailure: { gatesFailed: number; evaluations: number }[];
  setupStatesBeforeRejection: { state: string; occurrences: number; actionable: number }[];
  /** Evaluations where a data-validity gate failed (may overlap analytical). */
  dataQualityFailures: number;
  /** Evaluations where at least one non-data gate failed. */
  analyticalFailures: number;
  /** Evaluations whose recorded trace showed no failure at all. */
  noGateFailureRecorded: number;
  /** True when every evaluation's gate facts were available (trace present). */
  gateFactsAvailable: boolean;
}

export function buildGateBottleneckReport(evaluations: readonly OutcomeEvaluation[]): GateBottleneckReport {
  const failedCounts = new Map<string, number>();
  const firstCounts = new Map<string, number>();
  const multiCounts = new Map<number, number>();
  const stateCounts = new Map<string, { occurrences: number; actionable: number }>();
  let actionable = 0;
  let dataQualityFailures = 0;
  let analyticalFailures = 0;
  let noGateFailureRecorded = 0;
  let withFacts = 0;

  for (const evaluation of evaluations) {
    const decision = evaluation.decision;
    const planned =
      decision.direction !== undefined &&
      decision.entry !== undefined &&
      decision.stopLoss !== undefined &&
      decision.takeProfit !== undefined;
    if (planned) actionable += 1;

    const state = decision.setupState;
    const bucket = stateCounts.get(state) ?? { occurrences: 0, actionable: 0 };
    bucket.occurrences += 1;
    if (planned) bucket.actionable += 1;
    stateCounts.set(state, bucket);

    if (decision.failedGates === undefined) continue;
    withFacts += 1;
    if (decision.failedGates.length === 0) {
      noGateFailureRecorded += 1;
      continue;
    }
    for (const gateId of decision.failedGates) {
      failedCounts.set(gateId, (failedCounts.get(gateId) ?? 0) + 1);
    }
    const first = decision.firstBlockingGate ?? decision.failedGates[0];
    firstCounts.set(first, (firstCounts.get(first) ?? 0) + 1);
    multiCounts.set(decision.failedGates.length, (multiCounts.get(decision.failedGates.length) ?? 0) + 1);
    if (decision.dataQualityFailure === true) dataQualityFailures += 1;
    if (decision.failedGates.some((id) => !(DATA_VALIDITY_GATES as readonly string[]).includes(id))) {
      analyticalFailures += 1;
    }
  }

  const orderedIds = [
    ...GATE_IDS,
    ...[...failedCounts.keys()].filter((id) => !(GATE_IDS as readonly string[]).includes(id)).sort(),
  ];

  return {
    version: GATE_DIAGNOSTICS_VERSION,
    evaluations: evaluations.length,
    actionable,
    noTrade: evaluations.length - actionable,
    failedGateCounts: orderedIds
      .filter((id) => (failedCounts.get(id) ?? 0) > 0)
      .map((gateId) => ({ gateId, occurrences: failedCounts.get(gateId) ?? 0 })),
    firstBlockerCounts: orderedIds
      .filter((id) => (firstCounts.get(id) ?? 0) > 0)
      .map((gateId) => ({ gateId, occurrences: firstCounts.get(gateId) ?? 0 })),
    multiGateFailure: [...multiCounts.entries()]
      .map(([gatesFailed, count]) => ({ gatesFailed, evaluations: count }))
      .sort((a, b) => a.gatesFailed - b.gatesFailed),
    setupStatesBeforeRejection: [...stateCounts.entries()]
      .map(([state, v]) => ({ state, ...v }))
      .sort((a, b) => a.state.localeCompare(b.state)),
    dataQualityFailures,
    analyticalFailures,
    noGateFailureRecorded,
    gateFactsAvailable: withFacts === evaluations.length,
  };
}

export function mergeGateBottleneckReports(reports: readonly GateBottleneckReport[]): GateBottleneckReport {
  const failed = new Map<string, number>();
  const first = new Map<string, number>();
  const multi = new Map<number, number>();
  const states = new Map<string, { occurrences: number; actionable: number }>();
  let evaluations = 0;
  let actionable = 0;
  let dataQualityFailures = 0;
  let analyticalFailures = 0;
  let noGateFailureRecorded = 0;
  let factsAvailable = true;

  for (const report of reports) {
    evaluations += report.evaluations;
    actionable += report.actionable;
    dataQualityFailures += report.dataQualityFailures;
    analyticalFailures += report.analyticalFailures;
    noGateFailureRecorded += report.noGateFailureRecorded;
    factsAvailable = factsAvailable && report.gateFactsAvailable;
    for (const entry of report.failedGateCounts) failed.set(entry.gateId, (failed.get(entry.gateId) ?? 0) + entry.occurrences);
    for (const entry of report.firstBlockerCounts) first.set(entry.gateId, (first.get(entry.gateId) ?? 0) + entry.occurrences);
    for (const entry of report.multiGateFailure) multi.set(entry.gatesFailed, (multi.get(entry.gatesFailed) ?? 0) + entry.evaluations);
    for (const entry of report.setupStatesBeforeRejection) {
      const bucket = states.get(entry.state) ?? { occurrences: 0, actionable: 0 };
      bucket.occurrences += entry.occurrences;
      bucket.actionable += entry.actionable;
      states.set(entry.state, bucket);
    }
  }

  const orderedIds = [...GATE_IDS, ...[...failed.keys()].filter((id) => !(GATE_IDS as readonly string[]).includes(id)).sort()];
  return {
    version: GATE_DIAGNOSTICS_VERSION,
    evaluations,
    actionable,
    noTrade: evaluations - actionable,
    failedGateCounts: orderedIds
      .filter((id) => (failed.get(id) ?? 0) > 0)
      .map((gateId) => ({ gateId, occurrences: failed.get(gateId) ?? 0 })),
    firstBlockerCounts: orderedIds
      .filter((id) => (first.get(id) ?? 0) > 0)
      .map((gateId) => ({ gateId, occurrences: first.get(gateId) ?? 0 })),
    multiGateFailure: [...multi.entries()].map(([gatesFailed, count]) => ({ gatesFailed, evaluations: count })).sort((a, b) => a.gatesFailed - b.gatesFailed),
    setupStatesBeforeRejection: [...states.entries()].map(([state, v]) => ({ state, ...v })).sort((a, b) => a.state.localeCompare(b.state)),
    dataQualityFailures,
    analyticalFailures,
    noGateFailureRecorded,
    gateFactsAvailable: factsAvailable,
  };
}

/**
 * Factual lines. `label` says what the sample is (recorded historical windows by
 * default) and the wording stays descriptive — no accuracy, no ranking.
 */
export function formatGateBottleneckReport(
  report: GateBottleneckReport,
  label = "Recorded / historical evaluations",
): string[] {
  const lines = [
    `${label}: ${report.evaluations}`,
    `Actionable: ${report.actionable}`,
    `NO_TRADE: ${report.noTrade}`,
  ];
  if (report.failedGateCounts.length === 0) {
    lines.push("Gate failures observed: none recorded — each evaluation either published a plan or was declined outside the gate list.");
  } else {
    lines.push("Observed gate failures (count of evaluations in which the gate failed):");
    for (const entry of report.failedGateCounts) lines.push(`• ${entry.gateId}: ${entry.occurrences}`);
    lines.push(
      "Primary observed blockers (first failure per evaluation, in the engine's canonical gate order — an observation, not a ranking):",
    );
    for (const entry of report.firstBlockerCounts) lines.push(`• ${entry.gateId}: ${entry.occurrences}`);
    lines.push("Evaluations failing multiple gates:");
    for (const entry of report.multiGateFailure) lines.push(`• ${entry.gatesFailed} gate(s): ${entry.evaluations}`);
  }
  lines.push(`Data-validity gate failures (GATE0/1/2): ${report.dataQualityFailures}`);
  lines.push(`Analytical gate failures (GATE3…GATE8): ${report.analyticalFailures}`);
  lines.push(`Evaluations with no recorded gate failure: ${report.noGateFailureRecorded}`);
  if (!report.gateFactsAvailable) {
    lines.push("Gate facts incomplete for this sample — some evaluations carried no engine trace.");
  }
  for (const entry of report.setupStatesBeforeRejection) {
    lines.push(`• setup state ${entry.state}: ${entry.occurrences} evaluation(s), ${entry.actionable} actionable`);
  }
  return lines;
}
