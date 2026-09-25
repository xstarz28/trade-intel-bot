/**
 * Phase 279 — Shared deterministic fundamental framework.
 *
 * The ONE place where dimensions become a state, a confidence level and a
 * confidence statement. Every domain adapter (equity / crypto / forex /
 * commodity) calls it, so "more metrics ≠ more confidence", "conflicting
 * evidence caps confidence" and "stale periods cap confidence" are properties
 * of the framework rather than conventions each adapter re-implements.
 *
 * PURE: no clock, no randomness, no provider access, no I/O. Every instant it
 * uses was already carried by the evidence.
 */

import type {
  DimensionStatus,
  FundamentalAssessment,
  FundamentalDimension,
  FundamentalState,
} from "@/lib/data/fundamental-contract";

export const DAYS_MS = 86_400_000;
/** Period ends older than this at observation time are called stale. */
export const STALE_PERIOD_DAYS = 210;
/**
 * Freshness for provider datasets that are PUBLISHED on a daily-or-slower
 * cadence and carry no provider-stamped observation instant (DeFiLlama TVL and
 * fee summaries, Tokenomist supply and unlock schedules).
 *
 * Deliberately NOT "FRESH": those datasets describe a published measurement,
 * not a live reading, and the instant recorded against them is the acquisition
 * receipt of the provider response (Phase 267 doctrine — historical/informational
 * sources must never be labelled live, and a live-looking label would be a
 * false provenance claim).
 */
export const PUBLICATION_FRESHNESS = "HISTORICAL";
/** Ages beyond this cap confidence at LOW, not merely medium. */
export const VERY_STALE_PERIOD_DAYS = 400;

export function periodEndValid(iso: string | undefined): iso is string {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

/** Sequential move counts across a newest-first series of numbers. */
export function countMoves(valuesNewestFirst: number[]): { rises: number; falls: number } {
  let rises = 0;
  let falls = 0;
  for (let i = 0; i < valuesNewestFirst.length - 1; i++) {
    if (valuesNewestFirst[i] > valuesNewestFirst[i + 1]) rises++;
    else if (valuesNewestFirst[i] < valuesNewestFirst[i + 1]) falls++;
  }
  return { rises, falls };
}

/** Finite numbers only — an absent/NaN field is never treated as a value. */
export function finite(...values: unknown[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** Latest value of a newest-first series, or undefined. */
export function latestOf(values: number[]): number | undefined {
  return values.length > 0 ? values[0] : undefined;
}

/** Percentage change between two REAL values; undefined when not computable. */
export function percentChange(latest: number | undefined, previous: number | undefined): number | undefined {
  if (!isFiniteNumber(latest) || !isFiniteNumber(previous) || previous === 0) return undefined;
  return ((latest - previous) / Math.abs(previous)) * 100;
}

/** Signed change in percentage points between two REAL values. */
export function pointsChange(latest: number | undefined, previous: number | undefined): number | undefined {
  if (!isFiniteNumber(latest) || !isFiniteNumber(previous)) return undefined;
  return latest - previous;
}

/** Whole days between a period string and an instant — payload-only. */
export function daysBetween(periodIso: string, instant: number): number | undefined {
  if (!periodEndValid(periodIso) || !isFiniteNumber(instant) || instant <= 0) return undefined;
  return Math.floor((instant - Date.parse(periodIso + "T00:00:00Z")) / DAYS_MS);
}

/**
 * Dimensions that actually carry evidence AND contribute to the state.
 * Informational dimensions (evidence another layer already scores) are
 * reported but excluded here so nothing is counted twice.
 */
export function scoredDimensions(dimensions: FundamentalDimension[]): FundamentalDimension[] {
  return dimensions.filter((d) => !d.informational && d.status !== "unavailable");
}

export function statusCounts(dimensions: FundamentalDimension[]): {
  usable: FundamentalDimension[];
  positives: number;
  negatives: number;
} {
  const usable = scoredDimensions(dimensions);
  return {
    usable,
    positives: usable.filter((d) => d.status === "positive").length,
    negatives: usable.filter((d) => d.status === "negative").length,
  };
}

/**
 * Aggregate state from the scored dimensions. A single extreme dimension can
 * never dictate the result: a direction requires at least one positive AND no
 * negative (or the mirror), and a strict majority of the usable evidence.
 */
export function aggregateState(dimensions: FundamentalDimension[]): FundamentalState {
  const { usable, positives, negatives } = statusCounts(dimensions);
  if (usable.length === 0) return "insufficient";
  if (positives > 0 && negatives === 0 && positives >= negatives + 1 && positives * 2 > usable.length) {
    return "improving";
  }
  if (negatives > 0 && positives === 0 && negatives * 2 > usable.length) {
    return "weakening";
  }
  return "mixed";
}

const LEVELS = ["low", "medium", "high"] as const;

export interface ConfidenceInput {
  dimensions: FundamentalDimension[];
  /** Number of domain periods of evidence (fiscal quarters, macro releases…). */
  periodsCount: number;
  /** Human label for those periods — keeps domain wording honest. */
  periodsLabel: string;
  /** Latest period end/measurement label, when one exists. */
  reportingPeriod?: string;
  /** Days between the latest period and the provider observation instant. */
  staleDays?: number;
  /** Domain-specific caps (already-worded), applied after the framework ones. */
  extraCaps?: string[];
}

export interface ConfidenceResult {
  state: FundamentalState;
  confidence: "high" | "medium" | "low" | "insufficient";
  confidenceEvidence: string;
  /** Caps actually applied — each is disclosed in `confidenceEvidence`. */
  caps: string[];
}

/**
 * Evidence-based confidence: a LEVEL derived from how much evidence exists,
 * then CAPPED by disagreement between dimensions and by staleness of the
 * reporting period measured inside the payload itself.
 */
export function aggregateConfidence(input: ConfidenceInput): ConfidenceResult {
  const state = aggregateState(input.dimensions);
  const { usable, positives, negatives } = statusCounts(input.dimensions);
  const caps: string[] = [];

  let level: number;
  if (usable.length >= 5) level = 2;
  else if (usable.length >= 3) level = 1;
  else level = 0;

  if (usable.length > 0 && positives > 0 && negatives > 0) {
    level = Math.min(level, 1);
    caps.push("conflicting dimension evidence caps confidence at medium");
  }
  if (input.staleDays !== undefined && input.staleDays > STALE_PERIOD_DAYS) {
    level = Math.min(level, 1);
    caps.push(`stale reporting period (${input.staleDays} days between period end and observation) caps confidence at medium`);
  }
  if (input.staleDays !== undefined && input.staleDays > VERY_STALE_PERIOD_DAYS) {
    level = Math.min(level, 0);
    caps.push(`very old reporting period (${input.staleDays} days) caps confidence at low`);
  }
  for (const cap of input.extraCaps ?? []) {
    level = Math.min(level, 1);
    caps.push(cap);
  }

  const confidence: ConfidenceResult["confidence"] =
    usable.length === 0 ? "insufficient" : LEVELS[level];

  const directionTxt =
    usable.length === 0
      ? "no usable dimensions"
      : `${positives} strengthening / ${negatives} weakening of ${usable.length} usable dimensions`;

  const confidenceEvidence =
    usable.length === 0
      ? "No usable fundamental dimensions — insufficient evidence, no confidence."
      : `Confidence from ${usable.length} usable dimensions (${directionTxt}), ${input.periodsCount} ${input.periodsLabel} of history${input.reportingPeriod ? `, latest period ${input.reportingPeriod}` : ""}${caps.length > 0 ? ` — ${caps.join("; ")}` : ""}.`;

  return { state, confidence, confidenceEvidence, caps };
}

/**
 * Evidence coverage of the domain's own dimension space. `evidenceClasses`
 * lists the distinct PROVIDER provenance classes behind the usable
 * dimensions — "derived" is never a class of its own.
 */
export function coverageOf(
  dimensions: FundamentalDimension[],
  providers: string[],
): {
  dimensionsAvailable: number;
  dimensionsScored: number;
  dimensionsTotal: number;
  evidenceClasses: string[];
} {
  const available = dimensions.filter((d) => d.status !== "unavailable");
  return {
    dimensionsAvailable: available.length,
    dimensionsScored: scoredDimensions(dimensions).length,
    dimensionsTotal: dimensions.length,
    evidenceClasses: [...new Set(providers.filter((p) => typeof p === "string" && p.length > 0))].sort(),
  };
}

/** A dimension record with a stable shape for unavailable dimensions. */
export function unavailable(name: FundamentalDimension["name"]): FundamentalDimension {
  return { name, status: "unavailable" };
}

export function dimension(
  name: FundamentalDimension["name"],
  status: DimensionStatus,
  evidence: string,
  extra?: Partial<Pick<FundamentalDimension, "informational" | "consumedBy">>,
): FundamentalDimension {
  return { name, status, evidence, ...extra };
}

/**
 * Phase 279 — an EXPLICIT assessment for a routing domain this framework does
 * not assess (for example `indices`). The domain is named, the state is
 * insufficient, there is no dimension space at all, and the reason is stated —
 * another domain's metrics are never borrowed to fill the gap.
 */
export function unassessedDomain(
  instrumentType: string,
  provider: string,
  instrumentId?: string,
): FundamentalAssessment {
  const dimensions: FundamentalDimension[] = [];
  return {
    available: false,
    domain: "insufficient",
    provider: provider.length > 0 ? provider : "none",
    ...(instrumentId ? { instrumentId } : {}),
    observedAt: 0,
    periodsCount: 0,
    state: "insufficient",
    confidence: "insufficient",
    confidenceEvidence: `The "${instrumentType}" routing domain has no fundamental dimension space in this framework — no assessment is produced.`,
    directionalBias: "none",
    dimensions,
    contradictions: [],
    unavailableDimensions: [],
    evidenceCoverage: coverageOf(dimensions, []),
    evidence: [],
    metrics: {},
    limitations: [
      `The "${instrumentType}" routing domain is not one of the four domains this fundamental framework assesses (equity, crypto, forex, commodity) — its evidence is reported as unavailable rather than assessed with another domain's metrics.`,
    ],
  };
}
