/**
 * Phase 178c — acquisition provenance.
 *
 * Phase 177 records WHY a provider leg failed. This module records HOW a
 * successful leg's data was obtained, which is a different question and one
 * the failure taxonomy cannot answer.
 *
 * The distinction matters because "the provider returned data" is ambiguous
 * once caching exists: the data may have been observed microseconds ago or
 * hours ago. Collapsing those two cases is exactly how a cache launders old
 * data into fresh evidence.
 *
 * This is additive. It does not modify the Phase 177 timeout architecture,
 * and `ProviderFailureCategory` remains the authority on failures.
 */

/**
 * How a provider leg's result came to exist.
 *
 * `observed-now` and `cache-reused` are BOTH successes, but they are not the
 * same evidence: only the first is proof of a new provider observation.
 */
export type AcquisitionMode =
  /** A real provider call completed during this analysis. */
  | "observed-now"
  /** Served from cache. The provider was NOT contacted. */
  | "cache-reused"
  /** A real call completed, shared with concurrent callers via single-flight. */
  | "observed-shared"
  /** Provider returned no usable data. */
  | "unavailable"
  /** Provider exceeded its deadline. */
  | "timed-out"
  /** Provider reported a rate limit. */
  | "rate-limited"
  /** Not attempted — irrelevant for this instrument/style. */
  | "skipped"
  /**
   * Deliberately never cached, so every use is a new observation by design.
   * Distinct from `observed-now`: this records an architectural decision, not
   * an incidental cache miss.
   */
  | "uncached-by-design";

/** Modes that represent a genuine new provider observation. */
const NEW_OBSERVATION: ReadonlySet<AcquisitionMode> = new Set<AcquisitionMode>([
  "observed-now",
  "observed-shared",
  "uncached-by-design",
]);

/** Modes that carry usable evidence at all. */
const CARRIES_EVIDENCE: ReadonlySet<AcquisitionMode> = new Set<AcquisitionMode>([
  "observed-now",
  "observed-shared",
  "uncached-by-design",
  "cache-reused",
]);

export interface AcquisitionProvenance {
  provider: string;
  dataset: string;
  mode: AcquisitionMode;
  /**
   * When the PROVIDER observed the data. Absent when nothing was acquired.
   * This is never the time the value was read or reused.
   */
  observedAt?: number;
  /** When this analysis used the value. */
  usedAt: number;
  /** `usedAt - observedAt`. Absent when there is no observation. */
  evidenceAgeMs?: number;
}

/**
 * Build a provenance record.
 *
 * `usedAt` is recorded separately from `observedAt` and is NEVER substituted
 * for it: a missing observation time stays missing rather than being back-
 * filled with the time of use, which would fabricate an observation.
 */
export function recordProvenance(input: {
  provider: string;
  dataset: string;
  mode: AcquisitionMode;
  observedAt?: number;
  usedAt?: number;
}): AcquisitionProvenance {
  const usedAt = input.usedAt ?? Date.now();
  const hasObservation =
    input.observedAt !== undefined &&
    Number.isFinite(input.observedAt) &&
    CARRIES_EVIDENCE.has(input.mode);

  return {
    provider: input.provider,
    dataset: input.dataset,
    mode: input.mode,
    ...(hasObservation
      ? {
          observedAt: input.observedAt,
          evidenceAgeMs: Math.max(0, usedAt - (input.observedAt as number)),
        }
      : {}),
    usedAt,
  };
}

/** True only when the provider was actually contacted during this analysis. */
export function isNewObservation(p: AcquisitionProvenance): boolean {
  return NEW_OBSERVATION.has(p.mode);
}

/** True when the value came from memory rather than the provider. */
export function isCacheReuse(p: AcquisitionProvenance): boolean {
  return p.mode === "cache-reused";
}

/** True when this leg consumed provider quota. */
export function consumedQuota(p: AcquisitionProvenance): boolean {
  return p.mode === "observed-now" || p.mode === "uncached-by-design";
}

/**
 * A one-line, credential-free summary for diagnostics.
 *
 * A cache reuse is always reported as a reuse with its true age — never as a
 * fresh observation.
 */
export function describeProvenance(p: AcquisitionProvenance): string {
  const age =
    p.evidenceAgeMs === undefined
      ? ""
      : ` (evidence age ${Math.round(p.evidenceAgeMs / 1000)}s)`;
  switch (p.mode) {
    case "observed-now":
      return `${p.provider}/${p.dataset}: observed now${age}`;
    case "observed-shared":
      return `${p.provider}/${p.dataset}: observed now, shared with concurrent callers${age}`;
    case "cache-reused":
      return `${p.provider}/${p.dataset}: reused earlier observation${age} — provider NOT contacted`;
    case "uncached-by-design":
      return `${p.provider}/${p.dataset}: observed now, never cached by design${age}`;
    case "unavailable":
      return `${p.provider}/${p.dataset}: unavailable`;
    case "timed-out":
      return `${p.provider}/${p.dataset}: timed out`;
    case "rate-limited":
      return `${p.provider}/${p.dataset}: rate-limited`;
    case "skipped":
      return `${p.provider}/${p.dataset}: skipped`;
  }
}
