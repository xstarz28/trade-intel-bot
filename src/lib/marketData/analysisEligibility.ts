/**
 * Phase 302 — capability-aware ANALYSIS eligibility (the product-lib face).
 *
 * The canonical implementation is the pure, dependency-free
 * `scripts/lib/analysis-eligibility.mjs` — the same module the deployed-runtime
 * smoke ranks its discovery candidates with. It lives there because the smoke
 * runs as plain node; this typed re-export makes the ONE implementation
 * importable by product code, so "discoverable" and "analysis-eligible" can
 * never drift into two different truths.
 *
 * See the module header there for the live evidence (run 36951359320) and the
 * tier contract. This re-export adds nothing and weakens nothing.
 */
export {
  ALPHA_VANTAGE_TICKER_REASON,
  ANALYSIS_ELIGIBILITY_SCHEMA,
  CALENDAR_MAPPED_CURRENCIES,
  COMMODITY_GOLD_ROUTE_REASON,
  COMMODITY_NATIVE_ROUTES,
  ELIGIBILITY_TIERS,
  EXACT_LIVE_VERIFICATION_SET,
  TWELVE_DATA_PLAN_RESTRICTED_PREFIXES,
  TWELVE_DATA_PLAN_RESTRICTION_REASON,
  alphaVantageTickerIncompatible,
  classifyInstrumentEligibility,
  pairSides,
  parseExactInstrumentSpecs,
  rankByAnalysisEligibility,
  unmappedCalendarSides,
} from "../../../scripts/lib/analysis-eligibility.mjs";
export type { InstrumentEligibility } from "../../../scripts/lib/analysis-eligibility.d.mts";
