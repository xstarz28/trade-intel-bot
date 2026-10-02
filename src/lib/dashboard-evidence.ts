/**
 * Phase 310 — the SHARED evidence-to-UI vocabulary.
 *
 * ONE pure module that turns the evidence the analysis runtime already
 * delivered (provider diagnostics, candle depth, fundamental assessment with
 * its forex measurement pipeline) into the user-facing states the Dashboard
 * renders. Both the recommendation engine (RankedInstrument.evidence) and the
 * analysis surfaces (AnalysisResult) read from here, so there is exactly ONE
 * derivation of:
 *
 *   · technical evidence state (available / thin / unavailable)
 *   · provider availability state (ELIGIBLE / DEGRADED / RESTRICTED)
 *   · the honest availability class (PASS / UNAVAILABLE / RESTRICTED /
 *     EXTERNAL_DATA_GAP)
 *   · the forex acquisition explanation (from the phase-307/308 pipeline,
 *     verbatim facts, never fabricated)
 *
 * CRITICAL INVARIANTS (unchanged from the runtime workstream):
 *   - nothing here fabricates values, re-times observations, or substitutes
 *     instruments; every sentence is built from fields the runtime delivered;
 *   - a provider-plan limitation reads as a PLAN limitation (RESTRICTED),
 *     never as a generic application failure;
 *   - "the required external measurement was not available"
 *     (EXTERNAL_DATA_GAP) stays distinguishable from a transport failure;
 *   - thin data says LIMITED, never full confirmation.
 */

import { classifyProviderBlock } from "../../scripts/lib/provider-budget.mjs";

/** The analysis engine's own per-timeframe read threshold (phase 309 live: "below the 20 needed"). */
export const MIN_TECHNICAL_OBSERVATIONS = 20;

export type TechnicalEvidenceState = "available" | "thin" | "unavailable";

/**
 * Technical evidence state from the number of observations the engine actually
 * had. `undefined`/0 = nothing was delivered (unavailable); 1..<20 = a real
 * but THIN series (limited evidence, never full confirmation); >=20 = the
 * engine's own minimum for an independent read.
 */
export function technicalEvidenceState(dataPoints: number | undefined | null): TechnicalEvidenceState {
  if (typeof dataPoints !== "number" || !Number.isFinite(dataPoints) || dataPoints <= 0) {
    return "unavailable";
  }
  return dataPoints >= MIN_TECHNICAL_OBSERVATIONS ? "available" : "thin";
}

/**
 * One provider leg fact — the subset of the runtime's LegDiagnostic
 * (src/lib/data/provenance-diagnostics.ts, attached to every result by
 * protectedAnalysis) that evidence rendering needs. LegDiagnostic satisfies
 * this structurally; the builder maps defensively for other producers.
 */
export interface ProviderLegFact {
  provider: string;
  dataset: string;
  acquired: boolean;
  reason?: string;
  /** Provider-native instrument identity for this leg, verbatim. */
  instrument?: string;
  /** The leg's own provider observation instant, verbatim. */
  observedAt?: number;
}

export type ProviderAvailabilityState = "ELIGIBLE" | "DEGRADED" | "RESTRICTED";

export interface ProviderStateInfo {
  state: ProviderAvailabilityState;
  /** The failing legs the state was read from (capped, user-facing). */
  failingLegs: string[];
  reason?: string;
}

/**
 * Provider availability state from the runtime's OWN provider diagnostics.
 * Only the provider's own sentences classify: a plan-name refusal is a
 * RESTRICTED (provider-plan limitation); a rate-limit / missing-credential /
 * provider failure is DEGRADED; nothing failed = ELIGIBLE. A blanket sentence
 * is never upgraded into a classification the evidence does not carry.
 */
export function describeProviderState(diagnostics: ProviderLegFact[] | undefined): ProviderStateInfo {
  const legs = (diagnostics ?? []).filter((d) => d && d.acquired === false);
  if (legs.length === 0) return { state: "ELIGIBLE", failingLegs: [] };
  const failingLegs = legs
    .slice(0, 3)
    .map((d) =>
      [
        `${d.provider}/${d.dataset}${d.instrument ? ` [${d.instrument}]` : ""}`,
        typeof d.reason === "string" && d.reason.length > 0 ? d.reason : "no data returned",
      ].join(": "),
    );
  const classified = legs
    .map((d) => classifyProviderBlock(`${d.reason ?? ""}`))
    .filter((b) => b !== null);
  const restricted = classified.find((b) => b!.class === "PLAN_RESTRICTED");
  if (restricted) {
    return { state: "RESTRICTED", failingLegs, reason: restricted.evidence };
  }
  const degraded = classified[0];
  if (degraded) {
    return { state: "DEGRADED", failingLegs, reason: degraded.evidence };
  }
  return {
    state: "DEGRADED",
    failingLegs,
    reason: "one or more provider legs did not deliver; the analysis used what actually arrived",
  };
}

/** The forex measurement pipeline, verbatim from the phase-307/308 contract. */
export interface ForexPipelineFact {
  calendarDelivered?: boolean;
  eventsReceived?: number;
  releasedWithActual?: number;
  baseReleasedMatched?: number;
  quoteReleasedMatched?: number;
  acquisition?: {
    lookbackDays?: number;
    upcomingFetched?: number;
    pastFetched?: number;
    pastWithActual?: number;
    merged?: number;
    pastLeg?: string;
  };
  availability?: boolean;
}

/**
 * User-facing sentences for the forex acquisition state. Every number is read
 * from the pipeline the runtime delivered; nothing is rounded into a claim
 * the data does not carry, and no macro value is ever shown as a measurement.
 */
export function forexAcquisitionLines(pipeline: ForexPipelineFact | undefined | null): string[] {
  if (!pipeline) return [];
  const a = pipeline.acquisition ?? {};
  const lookback = typeof a.lookbackDays === "number" ? `${a.lookbackDays} days` : "the configured window";
  const released = typeof pipeline.releasedWithActual === "number" ? pipeline.releasedWithActual : 0;
  const matched =
    (typeof pipeline.baseReleasedMatched === "number" ? pipeline.baseReleasedMatched : 0) +
    (typeof pipeline.quoteReleasedMatched === "number" ? pipeline.quoteReleasedMatched : 0);
  const lines: string[] = [];
  if (pipeline.calendarDelivered === false) {
    lines.push(
      `The economic-calendar provider did not answer for this analysis, so no released macroeconomic measurement could be checked — this is an acquisition problem, not evidence that measurements do not exist.`,
    );
    return lines;
  }
  const pastLeg = typeof a.pastLeg === "string" ? a.pastLeg : undefined;
  if (pastLeg && pastLeg !== "ok") {
    const reason =
      pastLeg === "failed:timeout" ? "the request for released events ran out of time"
        : pastLeg === "failed:provider_error" ? "the provider refused or failed the request for released events"
          : pastLeg === "failed:network" ? "the connection to the provider failed"
            : pastLeg === "failed:malformed" ? "the provider's answer could not be read"
              : "the request for released events did not complete";
    lines.push(
      `No released macroeconomic measurements arrived for this pair: over the last ${lookback} the historical request did not deliver usable rows (${reason}). Upcoming-schedule data is shown as event risk only.`,
    );
    return lines;
  }
  if (released === 0) {
    lines.push(
      `The calendar provider answered but supplied no released measurements with actual values in the last ${lookback} — nothing was substituted and none is invented.`,
    );
    return lines;
  }
  if (matched === 0) {
    lines.push(
      `${released} released measurement${released === 1 ? "" : "s"} arrived for other currencies in the last ${lookback}, but none matched this pair's currencies.`,
    );
    return lines;
  }
  return [
    `Released macroeconomic evidence for this pair was checked over the last ${lookback}: ${released} released measurement${released === 1 ? "" : "s"} carried actual values and ${matched} matched this pair's currencies.`,
  ];
}

/** The honest availability class a UI state chip may show. */
export type AvailabilityClass = "PASS" | "UNAVAILABLE" | "RESTRICTED" | "EXTERNAL_DATA_GAP";

export interface AvailabilityClassInput {
  suitability?: string;
  hasLiveData?: boolean;
  technicalState: TechnicalEvidenceState;
  fundamentalAvailable?: boolean;
  fundamentalDomain?: string;
  hasFundamentalPipeline?: boolean;
  providerState: ProviderAvailabilityState;
}

/**
 * Classify — precedence:
 *   RESTRICTED          the provider itself named a plan limitation;
 *   EXTERNAL_DATA_GAP   a forex fundamental whose acquisition pipeline proves
 *                       no released measurement arrived (acquisition failure
 *                       or provider zero) — required external data, not app
 *                       failure;
 *   UNAVAILABLE         the analysis cannot make its combined claim (no live
 *                       market data, no technical evidence, or the fundamental
 *                       assessment found nothing usable);
 *   PASS                the analysis is usable as delivered.
 * This is a presentation mapping of ALREADY-ASSESSED evidence — it adds no
 * scoring and never upgrades a state.
 */
export function availabilityClassOf(input: AvailabilityClassInput): AvailabilityClass {
  if (input.providerState === "RESTRICTED") return "RESTRICTED";
  // A missing market or technical leg means the analysis cannot make ANY
  // combined claim — that dominates a fundamental-side gap.
  if (input.hasLiveData === false || input.technicalState === "unavailable") {
    return "UNAVAILABLE";
  }
  // The external measurement itself did not arrive (acquisition failure or
  // provider zero) while market + technical evidence are fine.
  if (
    input.fundamentalAvailable === false &&
    input.fundamentalDomain === "forex" &&
    input.hasFundamentalPipeline
  ) {
    return "EXTERNAL_DATA_GAP";
  }
  if (input.fundamentalAvailable === false) {
    return "UNAVAILABLE";
  }
  return "PASS";
}

/** A user-facing sentence for the availability class (data-driven, no filler). */
export function availabilityClassSentence(availabilityClass: AvailabilityClass, technicalState: TechnicalEvidenceState): string {
  switch (availabilityClass) {
    case "RESTRICTED":
      return "The provider restricted this instrument by plan — the analysis is limited by the provider's own refusal, not by an application error.";
    case "EXTERNAL_DATA_GAP":
      return "A required external measurement was not actually available for this analysis.";
    case "UNAVAILABLE":
      return "The analysis cannot make its combined claim with the evidence that arrived.";
    case "PASS":
      return technicalState === "thin"
        ? "Analysis delivered on limited data — treat the technical read as indicative only."
        : "Analysis delivered with market, technical and fundamental evidence.";
  }
}

/**
 * The recommendation explanation (workstream E): ONE deterministic sentence
 * built from the candidate's actual facts. Every clause is dropped when its
 * fact is absent — the sentence stays correct as availability changes.
 */
export function buildRecommendationExplanation(facts: {
  instrument: string;
  hasLiveData?: boolean;
  freshness?: string;
  dataPoints?: number;
  technicalState: TechnicalEvidenceState;
  fundamentalAvailable?: boolean;
  fundamentalDomain?: string;
  provider?: string;
  providerInstrumentId?: string;
  providerState: ProviderAvailabilityState;
}): string {
  const parts: string[] = [];
  if (facts.provider) {
    parts.push(
      facts.providerInstrumentId && facts.providerInstrumentId !== facts.instrument
        ? `provider ${facts.provider} (${facts.providerInstrumentId})`
        : `provider ${facts.provider}`,
    );
  }
  parts.push(
    facts.hasLiveData
      ? `market evidence is live${typeof facts.dataPoints === "number" && facts.dataPoints > 0 ? ` with ${facts.dataPoints} observations` : ""}`
      : `market evidence is not live${facts.freshness ? ` (${facts.freshness.toLowerCase()})` : ""}`,
  );
  parts.push(
    facts.technicalState === "available" ? "the technical series is deep enough for an independent read"
      : facts.technicalState === "thin" ? `the technical series is thin (${facts.dataPoints ?? 0} observations — limited evidence)`
        : "no technical series arrived",
  );
  if (facts.fundamentalAvailable === true) {
    parts.push(`fundamental evidence is available${facts.fundamentalDomain ? ` (${facts.fundamentalDomain})` : ""}`);
  } else if (facts.fundamentalAvailable === false) {
    parts.push("fundamental evidence is unavailable and none was substituted");
  }
  parts.push(`provider state is ${facts.providerState}`);
  return `Selected because ${parts.join(", ")}.`;
}
