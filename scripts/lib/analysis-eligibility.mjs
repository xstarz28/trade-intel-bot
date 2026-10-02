/**
 * Phase 302 — capability-aware ANALYSIS eligibility, distinct from discovery.
 *
 * WHY THIS EXISTS (live evidence, run 36951359320 — the four-asset smoke came
 * back honest-UNAVAILABLE on every domain because the FIRST-RANKED discovery
 * candidates were analytically unusable, not because analysis is broken):
 *
 *   crypto    okx BTC-PLN     market evidence REAL, but D1=3/W1=1/H4=12 candles
 *                             — no MTF chain usable; CoinGlass unconfigured;
 *                             order-book leg failed.
 *   forex     td  AED/ARS     market+technical+unified REAL, but no verified
 *                             economic-calendar mapping for AED or ARS — the
 *                             macro fundamental cannot be produced, and the
 *                             analysis contract requires it for a full claim.
 *   stock     td  /stocks     discovery FAILED: "no response headers within
 *                             20000 ms" — zero equity candidates at all.
 *   commodity td  GAU/EUR     [404] "This symbol is available starting with the
 *                             Grow or Venture plan" (plan restriction); Alpha
 *                             Vantage rejects the slash-form ticker for the
 *                             news leg. WTI/USD (position #7, never tried by
 *                             the bounded loop) consumed its own EIA feed.
 *
 * WHAT THIS MODULE DECIDES — and what it refuses to decide
 * --------------------------------------------------------
 * It ranks and annotates DISCOVERED candidates by whether the selected provider
 * can actually supply the analysis prerequisites, BEFORE anything is requested.
 * It is universal and discovery-driven: no instrument is added, no symbol is
 * substituted, and nothing is removed from discovery. "Discoverable" and
 * "analysis-eligible" become different, explicitly-labelled facts:
 *
 *   tier ELIGIBLE    — full analysis is possible with the provider's own legs.
 *   tier DEGRADED    — some legs cannot be produced (named, with the provider
 *                      reason); the instrument stays discoverable and remains
 *                      requestable, but a full claim is not possible.
 *   tier RESTRICTED  — a known provider-plan/capability rejection makes the
 *                      primary legs impossible; deprioritised behind every
 *                      tier that can produce evidence.
 *
 * Every reason string names the ACTUAL missing capability, in the provider's
 * own words where a provider produced one. Nothing here weakens validation:
 * a DEGRADED candidate that is still requested still gets the runtime's own
 * honest UNAVAILABLE — this module only decides ORDER and EXPECTATION.
 */

export const ANALYSIS_ELIGIBILITY_SCHEMA = "xstarz.analysis-eligibility.v1";

export const ELIGIBILITY_TIERS = {
  ELIGIBLE: "eligible",
  DEGRADED: "degraded",
  RESTRICTED: "restricted",
};

/** Numeric sort key; lower is preferred. */
const TIER_RANK = { [ELIGIBILITY_TIERS.ELIGIBLE]: 0, [ELIGIBILITY_TIERS.DEGRADED]: 1, [ELIGIBILITY_TIERS.RESTRICTED]: 2 };

/**
 * The verified economic-calendar currency mapping — MIRRORED from
 * `src/lib/data/calendar-types.ts` (`FOREX_COUNTRY_MAP` keys). The smoke runs
 * as plain node and cannot import that TS module, so the mirror exists; a test
 * asserts the two sets are equal so they cannot drift.
 */
export const CALENDAR_MAPPED_CURRENCIES = new Set([
  "EUR",
  "GBP",
  "USD",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
]);

/**
 * Twelve Data plan restriction, observed live (run 36951359320) on the
 * tokenized-gold family: `[404] This symbol is available starting with the
 * Grow or Venture plan.` The provider's own catalog ADVERTISES these rows, but
 * the deployment's plan cannot read their candles — the primary market leg is
 * impossible, so the family is RESTRICTED for analysis. Prefix match keeps the
 * rule universal across every quote currency (GAU/EUR, GAU/GBP, GAU/IDR, ...).
 */
export const TWELVE_DATA_PLAN_RESTRICTED_PREFIXES = ["GAU/"];
export const TWELVE_DATA_PLAN_RESTRICTION_REASON =
  "Twelve Data plan restriction (observed live, run 36951359320): [404] This symbol is available starting with the Grow or Venture plan — the OHLCV leg cannot be produced on the deployment's current plan, so no technical or unified claim is possible.";

/**
 * Alpha Vantage ticker grammar, verbatim from the provider's own rejection
 * (run 36951359320): "Ticker can only contain alphanumeric characters, colons,
 * underscores, and hyphens." A slash-form identity is provider-native for
 * Twelve Data but cannot cross the Alpha Vantage news-sentiment leg. That is a
 * NAMED DEGRADED LEG, not a full-analysis refusal by itself.
 */
export const ALPHA_VANTAGE_TICKER_REASON =
  "Alpha Vantage rejects slash-form tickers (provider rule: alphanumeric characters, colons, underscores, and hyphens) — the alpha-vantage/news-sentiment leg cannot be produced for this provider-native identity.";

export function alphaVantageTickerIncompatible(providerInstrumentId) {
  return /\//.test(String(providerInstrumentId ?? ""));
}

/**
 * Provider-native commodity routes — the identity model's capability registry.
 * Evidence: WTI/USD consumed its own EIA petroleum feed live (run 36951359320,
 * eia-leg=consumed, seriesCount=3); the provider's gold route on the current
 * plan is the metals symbol XAU/USD (the catalog's GAU/* tokenized-gold family
 * is plan-restricted). This REGISTRY does not add, remove or rewrite any
 * discovery row — it gives the ranker the provider's genuinely supported route
 * so a supported instrument is preferred over a restricted one.
 */
export const COMMODITY_NATIVE_ROUTES = {
  gold: { provider: "twelve-data", providerInstrumentId: "XAU/USD" },
  petroleum: { provider: "twelve-data", providerInstrumentId: "WTI/USD" },
};
export const COMMODITY_GOLD_ROUTE_REASON =
  "Provider-native gold route per the identity-model capability registry: XAU/USD on Twelve Data (the catalog's GAU/* tokenized-gold family is plan-restricted on the deployment's current plan).";

/** Split an A/B-style pair into its currency sides (uppercased, trimmed). */
export function pairSides(providerInstrumentId) {
  return String(providerInstrumentId ?? "")
    .toUpperCase()
    .split("/")
    .map((side) => side.trim())
    .filter((side) => side.length > 0);
}

/** The sides of a pair that have NO verified calendar mapping. */
export function unmappedCalendarSides(providerInstrumentId) {
  return pairSides(providerInstrumentId).filter((side) => !CALENDAR_MAPPED_CURRENCIES.has(side));
}

/**
 * Classify ONE discovered candidate. Pure; no network, no clock, no I/O.
 */
export function classifyInstrumentEligibility({ provider, providerInstrumentId, assetClass }) {
  const reasons = [];
  const degradedLegs = [];
  const p = String(provider ?? "");
  const id = String(providerInstrumentId ?? "");
  const klass = String(assetClass ?? "");

  let tier = ELIGIBILITY_TIERS.ELIGIBLE;
  let fullAnalysisPossible = true;

  // A known plan rejection makes the primary legs impossible.
  if (p === "twelve-data" && TWELVE_DATA_PLAN_RESTRICTED_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    tier = ELIGIBILITY_TIERS.RESTRICTED;
    fullAnalysisPossible = false;
    reasons.push(TWELVE_DATA_PLAN_RESTRICTION_REASON);
    degradedLegs.push("market-data/ohlcv");
  }

  // A pair whose sides the verified calendar mapping cannot name cannot get a
  // macro fundamental — and the analysis contract requires it for a full claim.
  if (klass === "forex") {
    const unmapped = unmappedCalendarSides(id);
    if (unmapped.length > 0) {
      tier = ELIGIBILITY_TIERS.DEGRADED;
      fullAnalysisPossible = false;
      reasons.push(
        `No verified economic-calendar currency mapping for ${id} (${unmapped.join(", ")} ${unmapped.length === 1 ? "is" : "are"} not in the verified mapping; it covers ${[...CALENDAR_MAPPED_CURRENCIES].join(", ")}) — the macro fundamental leg cannot be produced, and none is invented.`,
      );
      degradedLegs.push("tickatlas/calendar");
    }
  }

  // Slash-form identities cannot cross the Alpha Vantage news leg — a named
  // degraded leg. Live evidence (AED/ARS, run 36951359320): the remaining
  // fundamental providers still produced a usable fundamental picture and the
  // unified result was REAL, so this leg alone never blocks the tier — it is
  // disclosed so the degraded leg is expected, never discovered in surprise.
  if (p === "twelve-data" && alphaVantageTickerIncompatible(id)) {
    reasons.push(ALPHA_VANTAGE_TICKER_REASON);
    degradedLegs.push("alpha-vantage/news-sentiment");
  }

  // The genuinely supported gold route is stated as such, with provenance.
  if (
    klass === "commodity" &&
    p === COMMODITY_NATIVE_ROUTES.gold.provider &&
    id === COMMODITY_NATIVE_ROUTES.gold.providerInstrumentId
  ) {
    reasons.push(COMMODITY_GOLD_ROUTE_REASON);
  }

  return {
    schema: ANALYSIS_ELIGIBILITY_SCHEMA,
    provider: p,
    providerInstrumentId: id,
    assetClass: klass,
    tier,
    fullAnalysisPossible,
    reasons,
    degradedLegs,
  };
}

/**
 * Rank DISCOVERED candidates by eligibility, WITHOUT touching discovery truth:
 * the input order (provider order, spot-like preference already applied by the
 * caller) is preserved WITHIN each tier; tiers order eligible < degraded <
 * restricted. Returns the reordered candidate array with each candidate's
 * `eligibility` classification attached, so every downstream record and
 * annotation can name WHY a candidate was preferred, tried or skipped.
 *
 * No candidate is dropped: an ineligible candidate stays discoverable, listed,
 * and requestable within the caller's bounded attempt budget — it just cannot
 * silently outrank an instrument the provider can actually analyse.
 */
export function rankByAnalysisEligibility(candidates, { provider, assetClass }) {
  const nativeIdOf = (candidate) =>
    typeof candidate?.providerInstrumentId === "string" && candidate.providerInstrumentId.length > 0
      ? candidate.providerInstrumentId
      : candidate?.instId;
  const classified = candidates.map((candidate) => {
    const eligibility = classifyInstrumentEligibility({
      provider: candidate?.provider ?? provider,
      providerInstrumentId: nativeIdOf(candidate),
      assetClass,
    });
    return { candidate, eligibility };
  });
  // Array.prototype.sort is stable (ES2019+) — equal tiers keep provider order.
  classified.sort((a, b) => TIER_RANK[a.eligibility.tier] - TIER_RANK[b.eligibility.tier]);
  return classified.map(({ candidate, eligibility }) => ({ ...candidate, eligibility }));
}

/**
 * The repository's EXACT live-verification paths (Workstreams B/C/D) — the
 * provider-native identities the shipped runtime path is already test-locked
 * to (phase 298: BTC = okx BTC-USDT, XAU = twelve-data XAU/USD), plus the
 * calendar-mapped major pair for forex. These are NOT analysis candidates and
 * never substitute for discovery: they are the declared identities of the
 * dedicated exact-live verification mode, supplied by the workflow/harness so
 * the generic discovery-driven smoke stays untouched.
 */
export const EXACT_LIVE_VERIFICATION_SET = [
  { label: "BTC", provider: "okx", assetClass: "crypto", providerInstrumentId: "BTC-USDT" },
  { label: "XAU", provider: "twelve-data", assetClass: "commodity", providerInstrumentId: "XAU/USD" },
  { label: "EUR/USD", provider: "twelve-data", assetClass: "forex", providerInstrumentId: "EUR/USD" },
];

/** Parse an exact-mode spec: `provider:assetClass:nativeId` (CSV or array). */
export function parseExactInstrumentSpecs(raw) {
  const items = Array.isArray(raw) ? raw : String(raw ?? "").split(",");
  const specs = [];
  for (const item of items) {
    const trimmed = String(item ?? "").trim();
    if (trimmed === "") continue;
    const parts = trimmed.split(":");
    if (parts.length !== 3) {
      return { ok: false, problem: `exact instrument spec must be provider:assetClass:nativeId — got ${JSON.stringify(trimmed)}` };
    }
    const [provider, assetClass, nativeId] = parts.map((part) => part.trim());
    if (provider === "" || assetClass === "" || nativeId === "") {
      return { ok: false, problem: `exact instrument spec has an empty field — got ${JSON.stringify(trimmed)}` };
    }
    specs.push({
      label: nativeId,
      provider,
      assetClass,
      discovery: provider,
      providerInstrumentId: nativeId,
    });
  }
  return { ok: specs.length > 0, specs, problem: specs.length > 0 ? null : "no exact instrument specs given" };
}
