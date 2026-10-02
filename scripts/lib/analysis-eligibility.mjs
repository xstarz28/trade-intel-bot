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
 * Twelve Data plan restriction, observed live on the metals the deployment's
 * plan cannot read candles for:
 *
 *   run 36951359320, GAU/EUR: `[404] This symbol is available starting with the
 *   Grow or Venture plan.`
 *   run 36954328849, XAG/AUD: the SAME provider sentence — the plan-restricted
 *   family is NOT the tokenized-gold prefix alone; silver spot (XAG/*) and its
 *   micro-lot variants (XAGg/*) are equally beyond the deployment's plan tier.
 *
 * The provider's own catalog ADVERTISES these rows, but the primary market leg
 * is impossible on the current plan, so the families are RESTRICTED for
 * analysis. Prefix match keeps the rule universal across every quote currency
 * (GAU/EUR, GAU/GBP, XAG/AUD, XAGg/TRY, ...) — this is provider-capability
 * knowledge from the provider's own sentences, NOT a whitelist: every other
 * row stays discoverable, rankable and requestable exactly as before.
 */
export const TWELVE_DATA_PLAN_RESTRICTED_PREFIXES = ["GAU/", "XAG/", "XAGg/"];
export const TWELVE_DATA_PLAN_RESTRICTION_REASON =
  "Twelve Data plan restriction (observed live, runs 36951359320 and 36954328849: GAU/EUR and XAG/AUD): [404] This symbol is available starting with the Grow or Venture plan — the OHLCV leg cannot be produced on the deployment's current plan, so no technical or unified claim is possible.";

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
 * The provider-family of a native identity: the segment before the first
 * separator. `XAU/CHF` -> `XAU` (slash-form), `USDC-PLN` -> `USDC` (dash-form).
 * Families are the unit of within-run learning: a family the PROVIDER itself
 * proved unusable this run (a plan-restricted OHLCV read, a candle series too
 * thin for the technical engine) demotes its SIBLINGS on later picks —
 * within THIS run only, disclosed in the report, never persisted, never a
 * whitelist (a demoted family stays discoverable and pickable when nothing
 * better exists).
 */
export function familyOf(providerInstrumentId) {
  const id = String(providerInstrumentId ?? "");
  const slash = id.indexOf("/");
  if (slash > 0) return id.slice(0, slash);
  const dash = id.indexOf("-");
  if (dash > 0) return id.slice(0, dash);
  return id;
}

/**
 * Phase 304 — ONE pure observer for an attempt's outcome, feeding the ranker's
 * within-run learning sets. The provider's/runtime's OWN sentences are the
 * only input that adds an observation:
 *
 *   macro-gap                   `No released macroeconomic measurement ...`
 *                               names the sides that had no released data;
 *   plan-restricted family      `available starting with the ... plan` on the
 *                               OHLCV leg proves the FAMILY is beyond the plan
 *                               (live: GAU/*, XAG/*, XAU/CHF — runs 36951359320,
 *                               36954328849, 36957205385);
 *   technically-insufficient    `market evidence is real but technical/unified
 *                               evidence is not available` proves this
 *                               instrument's family delivered no usable candle
 *                               series (live: USDC-PLN, runs 36954328849 and
 *                               36957205385).
 *
 * Returns the observations; the CALLER adds them to its run-level sets. Pure:
 * no state, no I/O, nothing invented.
 */
export function observeAttemptOutcome({ providerInstrumentId, assetClass, verdictReason }) {
  const reason = String(verdictReason ?? "");
  const out = {
    macroGapSides: [],
    planRestrictedFamily: null,
    technicallyInsufficientFamily: null,
    technicallyInsufficientQuote: null,
  };
  if (reason.length === 0) return out;
  if (
    assetClass === "forex" &&
    /no released (macroeconomic|policy rates|inflation) measurement/i.test(reason)
  ) {
    out.macroGapSides = String(providerInstrumentId ?? "")
      .split("/")
      .filter((side) => /^[A-Z]{3}$/.test(side) && reason.includes(side));
  }
  if (/available starting with the [a-z ]+plan/i.test(reason)) {
    out.planRestrictedFamily = familyOf(providerInstrumentId);
  }
  if (/market evidence is real but technical\/unified evidence is not available/i.test(reason)) {
    out.technicallyInsufficientFamily = familyOf(providerInstrumentId);
    // Phase 305 — the QUOTE strike. For dash-form identities (okx crypto) the
    // thin-candle pattern repeats across the QUOTE currency, not the base:
    // live evidence (run 36960231581) burned the crypto window on BTC-PLN,
    // ETH-PLN and USDC-PLN — three DIFFERENT base families sharing one thin
    // quote. The quote strike is what makes the learning accumulate across
    // base families and steer toward deeper-quote instruments.
    const id = String(providerInstrumentId ?? "");
    const dash = id.indexOf("-");
    if (dash > 0) {
      const quote = id.slice(dash + 1);
      if (quote.length > 0 && quote !== id.slice(0, dash)) out.technicallyInsufficientQuote = quote;
    }
  }
  return out;
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
export function rankByAnalysisEligibility(candidates, { provider, assetClass }, observations = {}) {
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

  // Phase 303/304 — WITHIN-RUN LEARNING inside the eligible tier. Everything
  // here reorders candidates the PROVIDER ITSELF discovered; nothing is added,
  // dropped, whitelisted or persisted, and every set lives only for this run:
  //
  //   route-preferred (phase 304): the capability registry's provider-native
  //     routes (e.g. XAU/USD, WTI/USD) rank ahead of same-tier peers WHEN the
  //     provider's own catalog contains them — a preference over discovered
  //     rows, never a discovery substitute. Live evidence (run 36957205385):
  //     the commodity window spent attempts on XAU/CHF while the proven route
  //     WTI/USD sat at provider position #2.
  //   plan-restricted family (phase 304): after the PROVIDER proved a family
  //     plan-restricted this run (the 404-that-names-a-plan), siblings sink —
  //     except the registry's own routes, which the live evidence proved
  //     plan-SUPPORTED (XAU/USD exact = PASS).
  //   technically-insufficient family (phase 304): after an attempt delivered
  //     real market bytes but no usable technical series, siblings sink (live:
  //     USDC-PLN).
  //   macro-gap-free (phase 303): pairs whose sides carry no observed
  //     released-measurement gap rank ahead of observed-gap pairs.
  const gaps = observations?.macroGapCurrencies instanceof Set
    ? observations.macroGapCurrencies
    : new Set(observations?.macroGapCurrencies ?? []);
  const planFamilies = observations?.planRestrictedFamilies instanceof Set
    ? observations.planRestrictedFamilies
    : new Set(observations?.planRestrictedFamilies ?? []);
  const techFamilies = observations?.technicallyInsufficientFamilies instanceof Set
    ? observations.technicallyInsufficientFamilies
    : new Set(observations?.technicallyInsufficientFamilies ?? []);
  const techQuotes = observations?.technicallyInsufficientQuotes instanceof Set
    ? observations.technicallyInsufficientQuotes
    : new Set(observations?.technicallyInsufficientQuotes ?? []);
  // Phase 305 — COUNTED strikes (`base:X` / `quote:Y`), accumulated across the
  // run's attempts. A set answers "was this pattern observed"; a count answers
  // "how often", which is what the /stocks-style thin-quote pattern needs
  // (several base families failing through ONE thin quote). A strike on a
  // base family or a quote currency makes candidates carrying it rank behind
  // candidates with fewer strikes — dynamically, without any whitelist.
  const strikes = observations?.technicalStrikes instanceof Map
    ? observations.technicalStrikes
    : null;
  const strikeOf = (key, set) => {
    if (strikes && strikes.has(key)) return strikes.get(key);
    if (set && set.has && set.has(key.slice(key.indexOf(":") + 1))) return 1;
    return 0;
  };
  const routeIds = new Set(
    Object.values(COMMODITY_NATIVE_ROUTES)
      .filter((route) => route.provider === provider)
      .map((route) => route.providerInstrumentId),
  );
  const hasLearning =
    gaps.size > 0 || planFamilies.size > 0 || techFamilies.size > 0 ||
    (strikes !== null && strikes.size > 0) ||
    (routeIds.size > 0 && assetClass === "commodity");
  if (hasLearning) {
    const learning = (entry) => {
      const id = nativeIdOf(entry.candidate);
      const routePreferred = assetClass === "commodity" && routeIds.has(id) ? 1 : 0;
      const family = familyOf(id);
      const familyDemoted =
        routePreferred === 1
          ? 0 // the registry's route is the plan-PROVEN exception to its family
          : planFamilies.has(family) || techFamilies.has(family)
            ? 1
            : 0;
      const gapFree =
        assetClass === "forex" && gaps.size > 0
          ? pairSides(id).every((side) => !gaps.has(side))
            ? 1
            : 0
          : 1;
      // Phase 305 — the candidate's own strike burden: its base family's
      // strikes plus its quote currency's strikes. Ascending order prefers
      // candidates the run has never seen fail through either pattern.
      const dash = String(id).indexOf("-");
      const quote = dash > 0 ? String(id).slice(dash + 1) : null;
      const strikeCount =
        strikeOf(`base:${family}`, techFamilies) +
        (quote ? strikeOf(`quote:${quote}`, techQuotes) : 0);
      return { routePreferred, familyDemoted, gapFree, strikeCount };
    };
    const withIndex = classified.map((entry, i) => ({ entry, i, learning: learning(entry) }));
    withIndex.sort(
      (a, b) =>
        TIER_RANK[a.entry.eligibility.tier] - TIER_RANK[b.entry.eligibility.tier] ||
        b.learning.routePreferred - a.learning.routePreferred ||
        a.learning.strikeCount - b.learning.strikeCount ||
        a.learning.familyDemoted - b.learning.familyDemoted ||
        b.learning.gapFree - a.learning.gapFree ||
        a.i - b.i,
    );
    return withIndex.map(({ entry }) => ({ ...entry.candidate, eligibility: entry.eligibility }));
  }
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
