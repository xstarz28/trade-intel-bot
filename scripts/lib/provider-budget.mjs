/**
 * Phase 303 — DETERMINISTIC PROVIDER BUDGET ORCHESTRATION (pure, dependency-free).
 *
 * LIVE EVIDENCE (run 36954328849, harnessCommit 5b55546): the exact EUR/USD
 * verification failed with the provider's own sentence —
 *
 *   `Rate limited: [429] [429] You have run out of API credits for the current
 *    minute. 11 API credits were used, with the current limit being 8. Wait for
 *    the next minute or consider switching to a higher tier plan at
 *    https://twelvedata.com/pricing`
 *
 * — while the run's pacer model showed `waits:6, modelled-credits:8`. The audit
 * of every Twelve-Data-touching path in one smoke run:
 *
 *   1. catalog discovery (`marketData:discoverTwelveDataInstruments`):
 *      5 catalogs × 1 credit + 1 transient-retry re-read (the phase-302 /stocks
 *      retry) = up to 6-7 REAL credits. The phase-289 pacer only CHARGED this
 *      after the fact (`charge()`), so the spend landed in whatever minute was
 *      current — no reservation, no window separation.
 *   2. generic per-domain analysis (`protectedAnalysis:runProtectedAnalysis`):
 *      reserved BEFORE each attempt at the worst-case fan-out of 8 credits
 *      (= one full minute window) — correctly orchestrated since phase 289.
 *   3. EXACT live verification (phase 302): issued its analysis with NO pacer
 *      reservation at all, immediately after the generic domains had spent
 *      their windows — its real fan-out (~5-6 credits) landed in an already
 *      partially-spent minute: 6 (discovery) + 5 (analysis) = 11 > 8. That is
 *      the exact arithmetic of the provider's 429.
 *   4. the commodity energy-gate probe: EIA/ WPSR + calendar legs — NOT Twelve
 *      Data; never paced, correctly.
 *   5. okx paths: a different provider; never paced, correctly.
 *
 * THE FIX THIS MODULE LOCKS IN (with the smoke):
 *   a. EVERY Twelve-Data path reserves BEFORE it issues: discovery reserves its
 *      worst-case catalog spend, each exact instrument reserves a FULL fresh
 *      window, each generic attempt reserves as before.
 *   b. DETERMINISTIC ORDER: exact verification runs FIRST, on its own fresh
 *      windows, so generic discovery/analysis can never spend the budget the
 *      exact identities need (workstream A.5). The plan is computed up front
 *      and reported verbatim in the run.
 *   c. NO aggressive retry on 429 (unchanged circuit discipline): a real 429
 *      trips the provider circuit and is reported, never retried, never waited
 *      into submission. Backoff exists only as the pre-request window wait the
 *      pacer has always performed.
 *   d. Evidence quality is never lowered to dodge a rate limit: every bucket
 *      keeps its full worst-case reservation, and a bucket that cannot run
 *      says `RATE_LIMITED`/`pacing budget exhausted` honestly.
 *   e. Nothing here invents evidence: this is scheduling and classification of
 *      the provider's OWN sentences, nothing more.
 */

/** Twelve Data's documented weight per catalog/request. */
export const TWELVE_DATA_CREDIT_PER_REQUEST = 1;

/**
 * Worst-case credit spend of ONE catalog discovery walk: 5 reference catalogs
 * (`/forex_pairs`, `/stocks`, `/commodities`, `/indices`, `/cryptocurrencies`)
 * plus the phase-302 transient-guard retry on a catalog that trips the header
 * guard once (live evidence: /stocks, runs 36951359320 and 36954328849).
 */
export const TWELVE_DATA_DISCOVERY_CREDITS = 7;

/** The provider minute-window allowance the deployment's own 429 named. */
export const TWELVE_DATA_MINUTE_CREDITS = 8;

/** One provider minute — Twelve Data resets on the wall-clock minute. */
export const TWELVE_DATA_WINDOW_MS = 60_000;

/** The phase-289 worst-case fan-out of ONE Twelve Data analysis (see above). */
export const TWELVE_DATA_ANALYSIS_MAX_CREDITS = 8;

/** Deterministic provider-budget buckets, in the order a run spends them. */
export const PROVIDER_BUDGET_BUCKETS = Object.freeze({
  EXACT: "exact-verification",
  DISCOVERY: "catalog-discovery",
  DOMAIN_ANALYSIS: "domain-analysis",
});

/** Explicit provider-block classes (workstream B.4 — never blur these). */
export const PROVIDER_BLOCK_CLASSES = Object.freeze({
  RATE_LIMITED: "RATE_LIMITED",
  PLAN_RESTRICTED: "PLAN_RESTRICTED",
  NO_DATA: "NO_DATA",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  PROVIDER_FAILURE: "PROVIDER_FAILURE",
});

/**
 * Classify a provider's OWN failure sentence into the explicit block class.
 * Verbatim anchors are the provider's live messages (runs 36951359320 and
 * 36954328849):
 *
 *   RATE_LIMITED     `Rate limited: [429] ... out of API credits for the current
 *                     minute. 11 API credits were used, with the current limit being 8.`
 *   PLAN_RESTRICTED  `[404] This symbol is available starting with the Grow or
 *                     Venture plan. Consider upgrading now at .../pricing`
 *   NO_DATA          `No live data: ...` (a real symbol the plan serves but the
 *                     provider holds no rows for)
 *   NOT_CONFIGURED   `CoinGlass not configured: COINGLASS_... is missing.`
 *   PROVIDER_FAILURE `provider reported failure` (the provider's own opaque error)
 *
 * Precedence matters and is deliberate: a 404 that NAMES a plan is a plan
 * restriction (the provider found the symbol and refused to serve it), not
 * NO_DATA; a rate-limited response is about the minute-window budget, never
 * about the instrument's existence.
 */
export function classifyProviderBlock(reason) {
  const text = String(reason ?? "");
  if (text.length === 0) return null;
  if (/rate limited|\[429\]|out of API credits/i.test(text)) {
    return {
      class: PROVIDER_BLOCK_CLASSES.RATE_LIMITED,
      evidence: "the provider's own rate-limit sentence names the minute-window credit budget",
    };
  }
  if (/available starting with the [a-z ]+plan|consider upgrading|switching to a higher tier plan/i.test(text)) {
    return {
      class: PROVIDER_BLOCK_CLASSES.PLAN_RESTRICTED,
      evidence: "the provider's own sentence names the plan tier required for this symbol",
    };
  }
  if (/not configured: [A-Z0-9_]+ is missing|add it via:/i.test(text)) {
    return {
      class: PROVIDER_BLOCK_CLASSES.NOT_CONFIGURED,
      evidence: "the runtime names a missing environment credential, not a provider refusal",
    };
  }
  if (/no live data|no data for|symbol not found|unknown symbol/i.test(text)) {
    return {
      class: PROVIDER_BLOCK_CLASSES.NO_DATA,
      evidence: "the provider answered and holds no rows for this identity",
    };
  }
  if (/provider reported failure|provider_error|internal error/i.test(text)) {
    return {
      class: PROVIDER_BLOCK_CLASSES.PROVIDER_FAILURE,
      evidence: "the provider failed without naming a capability boundary",
    };
  }
  return null;
}

/**
 * The deterministic credit plan for one smoke run: the buckets, in the order
 * the run spends them, each with its worst-case credit reservation and the
 * number of provider minute-windows it needs. Pure arithmetic over the inputs;
 * the smoke computes it before anything is issued, reports it verbatim, and
 * drives its reservations from it.
 *
 * ORDER IS THE CONTRACT: every exact bucket precedes discovery, and discovery
 * precedes domain analysis, so the exact identities always reach the provider
 * on their own fresh windows (workstream A.5). A generic domain may end early
 * on the pacing wait budget with an honest reason; the exact buckets never
 * inherit a spent minute.
 */
export function buildProviderBudgetPlan({
  minuteCredits = TWELVE_DATA_MINUTE_CREDITS,
  discoveryCredits = TWELVE_DATA_DISCOVERY_CREDITS,
  analysisCredits = TWELVE_DATA_ANALYSIS_MAX_CREDITS,
  exactSpecs = [],
  /** Only the TWELVE-DATA domain labels, in run order (okx domains draw no TD budget). */
  domainLabels = [],
  maxAttempts = 3,
} = {}) {
  const windowCredits = Math.max(1, Math.floor(minuteCredits));
  const buckets = [];
  // (1) exact verification first — one full window per Twelve-Data identity.
  for (const spec of exactSpecs) {
    if (spec?.provider !== "twelve-data") continue; // other providers draw no TD budget
    buckets.push({
      bucket: PROVIDER_BUDGET_BUCKETS.EXACT,
      label: `exact ${spec.provider} ${spec.providerInstrumentId}`,
      credits: analysisCredits,
      windows: Math.ceil(analysisCredits / windowCredits),
    });
  }
  // (2) the one catalog discovery walk per run.
  buckets.push({
    bucket: PROVIDER_BUDGET_BUCKETS.DISCOVERY,
    label: "catalog discovery walk (5 catalogs + 1 transient retry)",
    credits: discoveryCredits,
    windows: Math.ceil(discoveryCredits / windowCredits),
  });
  // (3) per-domain worst-case attempts, in the run's domain order.
  buckets.push(
    ...domainBudgetBuckets({ domainLabels, analysisCredits, maxAttempts, minuteCredits: windowCredits }),
  );
  return finalizePlan(buckets, { windowCredits });
}

/**
 * @param {Array<{bucket:string,label:string,credits:number,windows:number}>} buckets
 */
function finalizePlan(buckets, { windowCredits }) {
  const windows = buckets.reduce((sum, b) => sum + b.windows, 0);
  return {
    windowCredits,
    buckets,
    totalModelledCredits: buckets.reduce((sum, b) => sum + b.credits, 0),
    estimatedWindows: windows,
    order: buckets.map((b) => b.bucket),
    invariant:
      "every bucket reserves its worst-case spend BEFORE it issues; buckets that cannot fit a window wait for the provider's next wall-clock minute; nothing is retried across a real 429",
  };
}

/**
 * Domain buckets for the plan: one worst-case window per ATTEMPT for every
 * Twelve-Data domain in the run, in run order. Exported separately so the
 * smoke composes `buildProviderBudgetPlan` + `domainBudgetBuckets` explicitly
 * and tests can pin each half.
 */
export function domainBudgetBuckets({ domainLabels = [], analysisCredits = TWELVE_DATA_ANALYSIS_MAX_CREDITS, maxAttempts = 3, minuteCredits = TWELVE_DATA_MINUTE_CREDITS } = {}) {
  const windowCredits = Math.max(1, Math.floor(minuteCredits));
  return domainLabels.map((label) => ({
    bucket: PROVIDER_BUDGET_BUCKETS.DOMAIN_ANALYSIS,
    label: `${label} × up to ${maxAttempts} attempts`,
    credits: analysisCredits * maxAttempts,
    windows: Math.ceil((analysisCredits * maxAttempts) / windowCredits),
  }));
}
