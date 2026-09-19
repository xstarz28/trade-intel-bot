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

/**
 * ─────────────────────────────────────────────────────────────────
 * Phase 178d — quota semantics, stated explicitly.
 *
 * `consumedQuota()` was ambiguous: it could mean "this caller caused a
 * provider request" or "this result originated from a request that cost
 * quota". Those differ for exactly one mode — `observed-shared` — and that
 * is precisely the mode single-flight creates, so the ambiguity was load-
 * bearing rather than academic.
 *
 * DEFINITION CHOSEN: (A) attribution to the caller.
 *
 * A single-flight join did NOT cause a provider request; it reused a request
 * another caller had already started. Charging it to this caller would
 * double-count one HTTP call across N callers and overstate provider load,
 * which is the opposite of what this telemetry exists to measure.
 *
 * `consumedQuota` is therefore replaced by two precise predicates, because
 * both questions are legitimate and must not share one name.
 * ─────────────────────────────────────────────────────────────────
 */

/**
 * (A) Did THIS caller cause a provider request?
 *
 * True only when this caller initiated the HTTP call. A single-flight join is
 * FALSE: the request existed already. Summing this across the legs of one
 * analysis gives the exact number of provider requests that analysis caused.
 */
export function quotaChargeAttributableToCaller(
  p: AcquisitionProvenance,
): boolean {
  return p.mode === "observed-now" || p.mode === "uncached-by-design";
}

/**
 * (B) Did this result ultimately come from a quota-consuming request?
 *
 * True for a single-flight join too, because the underlying bytes were paid
 * for by some request. Use this to answer "is this evidence backed by a real
 * provider call?", never to count provider load.
 */
export function originatedFromProviderRequest(
  p: AcquisitionProvenance,
): boolean {
  return (
    p.mode === "observed-now" ||
    p.mode === "observed-shared" ||
    p.mode === "uncached-by-design"
  );
}

/** Was the provider contacted at any point to produce this value? */
export function providerContacted(p: AcquisitionProvenance): boolean {
  return originatedFromProviderRequest(p);
}

/** Was this result shared from another caller's in-flight request? */
export function sharedWithConcurrentCallers(
  p: AcquisitionProvenance,
): boolean {
  return p.mode === "observed-shared";
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
