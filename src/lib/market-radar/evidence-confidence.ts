/**
 * Evidence-quality confidence.
 *
 * Confidence here is confidence in the QUALITY and COHERENCE of the
 * analysis inputs — never a win-rate, never P(profit), never a popularity
 * bonus for a well-known ticker.
 *
 * The function is pure and deterministic: same inputs → same integer.
 * It never fabricates missing evidence, never substitutes symbols, and
 * never inspects the instrument name.
 */

export type EvidenceFreshness = "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE";
export type EvidenceCompleteness = "FULL" | "PARTIAL" | "MINIMAL" | "NONE";
export type EvidenceCoverage = "FULL" | "PARTIAL" | "MINIMAL" | "NONE";

export interface EvidenceConfidenceInput {
  freshness: EvidenceFreshness;
  dataCompleteness: EvidenceCompleteness;
  providerCoverage: EvidenceCoverage;
  /** Critical slots the analysis needed and did not receive. */
  missingCriticalCount: number;
  /** Distinct conflicting evidence items. */
  conflictingCount: number;
  /** Verified live (or delayed) price actually present. */
  hasVerifiedLivePrice: boolean;
  /** Provider actually returned OHLCV. */
  hasOhlcv: boolean;
  /** Execution/liquidity evidence the provider actually supplied (e.g. spread). */
  hasExecutionEvidence: boolean;
  supportingCount: number;
}

export interface EvidenceConfidenceResult {
  /** 0–100 integer. Quality/coherence, NOT probability of profit. */
  confidence: number;
  /** Marker so callers/tests cannot treat this as a win-rate. */
  readonly notProbabilityOfProfit: true;
}

const FRESHNESS_POINTS: Record<EvidenceFreshness, number> = {
  FRESH: 28,
  DELAYED: 16,
  STALE: 4,
  UNAVAILABLE: 0,
};

const COMPLETENESS_POINTS: Record<EvidenceCompleteness, number> = {
  FULL: 24,
  PARTIAL: 14,
  MINIMAL: 5,
  NONE: 0,
};

const COVERAGE_POINTS: Record<EvidenceCoverage, number> = {
  FULL: 18,
  PARTIAL: 10,
  MINIMAL: 3,
  NONE: 0,
};

function clampInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Score how much we can trust the analysis given the evidence we actually have.
 *
 * Additive weights are intentionally uneven so FULL+FRESH+coherent cannot
 * land on the same number as MINIMAL+DELAYED just because of a shared
 * baseline. There is no baseline of 50.
 */
export function assessEvidenceConfidence(
  input: EvidenceConfidenceInput,
): EvidenceConfidenceResult {
  let points = 0;

  points += FRESHNESS_POINTS[input.freshness];
  points += COMPLETENESS_POINTS[input.dataCompleteness];
  points += COVERAGE_POINTS[input.providerCoverage];

  if (
    input.hasVerifiedLivePrice &&
    (input.freshness === "FRESH" || input.freshness === "DELAYED")
  ) {
    points += 8;
  }

  if (input.hasOhlcv) points += 6;
  if (input.hasExecutionEvidence) points += 6;

  const missing = Math.max(0, Math.floor(input.missingCriticalCount));
  points -= Math.min(40, missing * 10);

  const conflicts = Math.max(0, Math.floor(input.conflictingCount));
  points -= Math.min(42, conflicts * 14);

  const supporting = Math.max(0, Math.floor(input.supportingCount));
  const denom = supporting + conflicts;
  if (denom > 0) {
    points += (supporting / denom) * 10;
  }

  return {
    confidence: clampInt(points),
    notProbabilityOfProfit: true,
  };
}
