/**
 * Types for `analysis-eligibility.mjs` — capability-aware analysis eligibility
 * (phase 302). Pure classification/ranking of DISCOVERED candidates; no I/O.
 */

export const ANALYSIS_ELIGIBILITY_SCHEMA: string;

export const ELIGIBILITY_TIERS: {
  readonly ELIGIBLE: "eligible";
  readonly DEGRADED: "degraded";
  readonly RESTRICTED: "restricted";
};

export type EligibilityTier = (typeof ELIGIBILITY_TIERS)[keyof typeof ELIGIBILITY_TIERS];

export const CALENDAR_MAPPED_CURRENCIES: Set<string>;

export const TWELVE_DATA_PLAN_RESTRICTED_PREFIXES: string[];
export const TWELVE_DATA_PLAN_RESTRICTION_REASON: string;

export const ALPHA_VANTAGE_TICKER_REASON: string;
export function alphaVantageTickerIncompatible(providerInstrumentId: string | null | undefined): boolean;

export const COMMODITY_NATIVE_ROUTES: {
  gold: { provider: string; providerInstrumentId: string };
  petroleum: { provider: string; providerInstrumentId: string };
};
export const COMMODITY_GOLD_ROUTE_REASON: string;

export function pairSides(providerInstrumentId: string | null | undefined): string[];
export function unmappedCalendarSides(providerInstrumentId: string | null | undefined): string[];

export type InstrumentEligibility = {
  schema: string;
  provider: string;
  providerInstrumentId: string;
  assetClass: string;
  tier: EligibilityTier;
  fullAnalysisPossible: boolean;
  reasons: string[];
  degradedLegs: string[];
};

export function classifyInstrumentEligibility(options: {
  provider: string | null | undefined;
  providerInstrumentId: string | null | undefined;
  assetClass: string | null | undefined;
}): InstrumentEligibility;

export interface RankObservations {
  macroGapCurrencies?: Set<string> | Iterable<string>;
  planRestrictedFamilies?: Set<string> | Iterable<string>;
  technicallyInsufficientFamilies?: Set<string> | Iterable<string>;
  technicallyInsufficientQuotes?: Set<string> | Iterable<string>;
  /** Counted strikes, keys `base:<family>` / `quote:<currency>`. */
  technicalStrikes?: Map<string, number>;
}

export interface AttemptObservation {
  macroGapSides: string[];
  planRestrictedFamily: string | null;
  technicallyInsufficientFamily: string | null;
  technicallyInsufficientQuote: string | null;
}

export function rankByAnalysisEligibility<T extends Record<string, unknown>>(
  candidates: T[],
  options: { provider: string; assetClass: string },
  observations?: RankObservations,
): Array<T & { eligibility: InstrumentEligibility }>;

export function familyOf(providerInstrumentId: string | null | undefined): string;

export function observeAttemptOutcome(input: {
  providerInstrumentId: string | null | undefined;
  assetClass: string | null | undefined;
  verdictReason: string | null | undefined;
}): AttemptObservation;

export type ExactInstrumentSpec = {
  label: string;
  provider: string;
  assetClass: string;
  discovery: string;
  providerInstrumentId: string;
};

export const EXACT_LIVE_VERIFICATION_SET: Array<{
  label: string;
  provider: string;
  assetClass: string;
  providerInstrumentId: string;
}>;

export function parseExactInstrumentSpecs(
  raw: string | string[] | null | undefined,
): { ok: boolean; specs: ExactInstrumentSpec[]; problem: string | null };
