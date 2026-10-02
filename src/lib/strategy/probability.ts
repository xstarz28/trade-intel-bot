/**
 * Phase 312 addendum — "probability profit" WITHOUT fabricated probability.
 *
 * Three and only three statuses can exist:
 *   A. historically_estimated — enough ACTUAL recorded outcomes exist
 *      (matched on instrument / timeframe / direction / recorded strategy
 *      context): sample size, observed win rate, loss rate, average R and
 *      expected value are computed from the RECORDS, with a Wilson 95%
 *      uncertainty interval on the win rate.
 *   B. limited_sample — some records exist but too few: only the sample count
 *      is reported and the result is explicitly NOT presented as a reliable
 *      probability.
 *   C. unavailable — no valid recorded outcomes: NO number is produced.
 *
 * The current signal can NEVER manufacture a win probability from indicator
 * agreement: this module accepts ONLY recorded outcome records as input.
 */

import { MIN_EV_SAMPLE } from "./ev";

export type ProbabilityStatus = "historically_estimated" | "limited_sample" | "unavailable";

/** One recorded trade outcome (from the journal — never synthesized). */
export interface HistoricalOutcomeRecord {
  instrument?: string;
  timeframe?: string;
  direction?: "long" | "short";
  /** Recorded strategy context (trading style / setup family) if present. */
  style?: string;
  setupFamily?: string;
  /** Deterministic R multiple derived from the RECORDED trade data. */
  rMultiple?: number;
  closedAt?: number;
}

/** The match key a current signal asks history to answer for. */
export interface ProbabilityMatchKey {
  instrument?: string;
  timeframe?: string;
  direction?: "long" | "short";
  style?: string;
  setupFamily?: string;
}

export interface ProbabilityAssessment {
  status: ProbabilityStatus;
  /** Exact reason — always present for limited_sample/unavailable. */
  reason?: string;
  sampleSize?: number;
  /** Observed fraction of records with rMultiple > 0. Estimated status only. */
  winRate?: number;
  lossRate?: number;
  breakevenRate?: number;
  averageR?: number;
  /** Mean R over the matched records — the honest "expected value". */
  expectedR?: number;
  /** Wilson 95% interval bounds on the win rate (estimated status only). */
  winRateUncertainty?: { low: number; high: number; level: 0.95 };
  matchedOn?: ProbabilityMatchKey;
}

/** Two-sided Wilson score interval; z for 95% (deterministic constant). */
const Z_95 = 1.959963984540054;

function wilsonInterval(wins: number, n: number): { low: number; high: number } {
  const p = wins / n;
  const z2 = Z_95 * Z_95;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const spread = Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    low: Math.max(0, (centre - spread) / denom),
    high: Math.min(1, (centre + spread) / denom),
  };
}

/**
 * Assess recorded outcomes against a match key. Every field present in the key
 * is filtered EXACTLY (string equality); records without a finite rMultiple
 * are excluded (they cannot define R statistics). Pure and deterministic.
 */
export function assessHistoricalProbability(
  records: HistoricalOutcomeRecord[] | undefined,
  key: ProbabilityMatchKey,
): ProbabilityAssessment {
  if (!records || records.length === 0) {
    return {
      status: "unavailable",
      reason:
        "no recorded trade outcomes were supplied for this context — no probability is produced, and indicator agreement on the current signal never substitutes for recorded history",
      matchedOn: key,
    };
  }
  const matched = records.filter((r) => {
    if (key.instrument !== undefined && r.instrument !== key.instrument) return false;
    if (key.timeframe !== undefined && r.timeframe !== key.timeframe) return false;
    if (key.direction !== undefined && r.direction !== key.direction) return false;
    if (key.style !== undefined && r.style !== key.style) return false;
    if (key.setupFamily !== undefined && r.setupFamily !== key.setupFamily) return false;
    return typeof r.rMultiple === "number" && Number.isFinite(r.rMultiple);
  });
  const n = matched.length;
  if (n === 0) {
    return {
      status: "unavailable",
      reason:
        "recorded outcomes exist but none match this instrument/timeframe/direction/context with a valid recorded R — no probability is produced",
      sampleSize: 0,
      matchedOn: key,
    };
  }
  if (n < MIN_EV_SAMPLE) {
    return {
      status: "limited_sample",
      reason: `only ${n} recorded outcome(s) match this context (minimum ${MIN_EV_SAMPLE}) — the sample is shown but is NOT a statistically reliable probability`,
      sampleSize: n,
      matchedOn: key,
    };
  }
  const wins = matched.filter((r) => r.rMultiple! > 0).length;
  const losses = matched.filter((r) => r.rMultiple! < 0).length;
  const breakeven = n - wins - losses;
  const totalR = matched.reduce((acc, r) => acc + r.rMultiple!, 0);
  const interval = wilsonInterval(wins, n);
  return {
    status: "historically_estimated",
    sampleSize: n,
    winRate: wins / n,
    lossRate: losses / n,
    breakevenRate: breakeven / n,
    averageR: totalR / n,
    expectedR: totalR / n,
    winRateUncertainty: { ...interval, level: 0.95 },
    matchedOn: key,
  };
}
