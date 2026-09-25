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

/**
 * Phase 280 — EVIDENCE HIERARCHY for domains whose evidence is not equally
 * informative (commodities). A dimension's role is chosen by the DOMAIN
 * PROFILE (e.g. inventories are physical evidence for energy, while the
 * discount-rate channel is supporting), so hierarchy is configuration, never a
 * symbol-specific branch. Domains that do not supply a hierarchy keep the
 * Phase 279 counting rule byte-for-byte.
 */
export type FundamentalDimensionRole = "primary" | "secondary" | "supporting";

export interface DimensionHierarchyEntry {
  name: FundamentalDimension["name"];
  role: FundamentalDimensionRole;
}

/** Documented weights — a primary read outweighs a supporting one. */
export const HIERARCHY_WEIGHTS: Record<FundamentalDimensionRole, number> = {
  primary: 3,
  secondary: 2,
  supporting: 1,
};

export interface HierarchyStateResult {
  state: FundamentalState;
  /** Weighted totals that produced the state (exposed for the explanation). */
  positiveWeight: number;
  negativeWeight: number;
  primaryPositives: number;
  primaryNegatives: number;
  basis: string;
}

/**
 * Weighted state for a hierarchy-aware domain:
 *   · no scored dimension → insufficient;
 *   · a direction needs a strictly larger weighted total on one side;
 *   · the winning side must contain at least one PRIMARY dimension, so
 *     supporting context can never dictate the assessment;
 *   · a single dimension may set the state only when at most ONE dimension
 *     opposes it — one metric never outvotes several contrary reads;
 *   · anything else is mixed (evidence exists, but not a defensible direction).
 */
export function aggregateStateWithHierarchy(
  dimensions: FundamentalDimension[],
  hierarchy: DimensionHierarchyEntry[],
): HierarchyStateResult {
  const usable = scoredDimensions(dimensions);
  if (usable.length === 0) {
    return {
      state: "insufficient",
      positiveWeight: 0,
      negativeWeight: 0,
      primaryPositives: 0,
      primaryNegatives: 0,
      basis: "no scored dimension carries evidence",
    };
  }
  const roleOf = (name: FundamentalDimension["name"]): FundamentalDimensionRole =>
    hierarchy.find((h) => h.name === name)?.role ?? "secondary";
  const weightOf = (name: FundamentalDimension["name"]): number => HIERARCHY_WEIGHTS[roleOf(name)];
  let positiveWeight = 0;
  let negativeWeight = 0;
  let primaryPositives = 0;
  let primaryNegatives = 0;
  let positives = 0;
  let negatives = 0;
  for (const d of usable) {
    if (d.status === "positive") {
      positives += 1;
      positiveWeight += weightOf(d.name);
      if (roleOf(d.name) === "primary") primaryPositives += 1;
    } else if (d.status === "negative") {
      negatives += 1;
      negativeWeight += weightOf(d.name);
      if (roleOf(d.name) === "primary") primaryNegatives += 1;
    }
  }
  const basisOf = (state: FundamentalState, why: string): HierarchyStateResult => ({
    state,
    positiveWeight,
    negativeWeight,
    primaryPositives,
    primaryNegatives,
    basis: why,
  });

  if (positives === 0 && negatives === 0) {
    return basisOf("mixed", "every scored dimension is neutral — evidence exists but carries no direction");
  }
  if (positiveWeight === negativeWeight) {
    return basisOf("mixed", "positive and negative evidence carry equal weight — no net direction");
  }
  const winningPrimary = positiveWeight > negativeWeight ? primaryPositives : primaryNegatives;
  const losingSideCount = positiveWeight > negativeWeight ? negatives : positives;
  const winningSideCount = positiveWeight > negativeWeight ? positives : negatives;
  if (winningPrimary === 0) {
    return basisOf(
      "mixed",
      "direction is only supported by secondary/supporting evidence — a primary read is required before a fundamental direction is claimed",
    );
  }
  if (winningSideCount === 1 && losingSideCount >= 2) {
    return basisOf(
      "mixed",
      "one dimension cannot outvote several opposing dimensions — the read stays mixed",
    );
  }
  return positiveWeight > negativeWeight
    ? basisOf("improving", `weighted strengthening evidence ${positiveWeight} vs ${negativeWeight} with ${primaryPositives} primary dimension(s) strengthening`)
    : basisOf("weakening", `weighted weakening evidence ${negativeWeight} vs ${positiveWeight} with ${primaryNegatives} primary dimension(s) weakening`);
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
  /**
   * Phase 280 — when supplied, the state and the confidence LEVEL come from
   * the documented hierarchy instead of the Phase 279 counting rule:
   * weight = primary 3 / secondary 2 / supporting 1, and confidence counts
   * INDEPENDENT PROVIDER GROUPS plus multi-period history rather than the
   * number of fields.
   */
  hierarchy?: DimensionHierarchyEntry[];
  /** Distinct provider families behind the usable dimensions. */
  independentGroups?: number;
  /** Scored dimensions whose evidence carries multi-period history. */
  historyDepth?: number;
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
  const hierarchy = input.hierarchy;
  const hierarchyState = hierarchy
    ? aggregateStateWithHierarchy(input.dimensions, hierarchy)
    : undefined;
  const state = hierarchyState ? hierarchyState.state : aggregateState(input.dimensions);
  const { usable, positives, negatives } = statusCounts(input.dimensions);
  const caps: string[] = [];

  let level: number;
  if (hierarchy) {
    // Phase 280 — confidence reflects INDEPENDENT evidence groups, not field
    // count: three provider families is the ceiling requirement, and a domain
    // with no multi-period history can not read "high".
    const groups = input.independentGroups ?? 0;
    const depth = input.historyDepth ?? 0;
    if (groups >= 3 && usable.length >= 3 && depth >= 1) level = 2;
    else if (groups >= 2 && usable.length >= 2) level = 1;
    else level = 0;
    if (depth === 0 && usable.length > 0) {
      level = Math.min(level, 1);
      caps.push("no multi-period provider history caps confidence at medium");
    }
  } else if (usable.length >= 5) {
    level = 2;
  } else if (usable.length >= 3) {
    level = 1;
  } else {
    level = 0;
  }

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

  const hierarchyText = hierarchy
    ? `${hierarchyState?.basis ?? ""}${hierarchyState && hierarchyState.basis.length > 0 ? "; " : ""}${input.independentGroups ?? 0} independent provider group(s), ${input.historyDepth ?? 0} dimension(s) with multi-period history`
    : "";
  const confidenceEvidence =
    usable.length === 0
      ? "No usable fundamental dimensions — insufficient evidence, no confidence."
      : `Confidence from ${usable.length} usable dimensions (${directionTxt}), ${input.periodsCount} ${input.periodsLabel} of history${input.reportingPeriod ? `, latest period ${input.reportingPeriod}` : ""}${hierarchyText ? ` — ${hierarchyText}` : ""}${caps.length > 0 ? ` — ${caps.join("; ")}` : ""}.`;

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
