/**
 * Phase 303 — provider budget orchestration, explicit block classes, and the
 * macro-measurement learning, tested against the LIVE evidence.
 *
 * LIVE EVIDENCE UNDER TEST (run 36954328849, verbatim):
 *  - EXACT BTC-USDT PASS, EXACT XAU/USD PASS (foundations from phase 302 — not retested here);
 *  - EXACT EUR/USD UNAVAILABLE — `Rate limited: [429] [429] You have run out of
 *    API credits for the current minute. 11 API credits were used, with the
 *    current limit being 8.` — a BUDGET failure, not unavailability: the exact
 *    analysis was issued with no pacer reservation and landed in a minute the
 *    generic domains had already spent;
 *  - AUD/CAD (BOTH sides calendar-mapped) — `No released macroeconomic
 *    measurement was supplied for AUD or CAD` — mapping is capability, a
 *    released measurement is data;
 *  - XAG/AUD — `[404] This symbol is available starting with the Grow or
 *    Venture plan` — the plan-restricted family is larger than GAU/*;
 *  - /stocks — failed again WITHOUT the retry-chain suffix: the phase-302
 *    transport retry exists in the repo but the dev runtime had not been
 *    redeployed — deployment discipline, recorded in the phase report.
 *
 * Under test:
 *  A. the deterministic budget plan (exact buckets FIRST, discovery, domains),
 *  B. explicit provider-block classification (RATE_LIMITED / PLAN_RESTRICTED /
 *     NO_DATA / NOT_CONFIGURED / PROVIDER_FAILURE) on the provider's own words,
 *  C. the silver families' RESTRICTED tier (provider-capability knowledge, NOT
 *     a whitelist — discovery truth untouched),
 *  D. within-run macro-measurement learning (mapped-but-unmeasured pairs rank
 *     behind unobserved pairs on the NEXT pick; nothing is whitelisted),
 *  E. the smoke's orchestration contract: exact reserves a full window and runs
 *     BEFORE the generic loop; discovery reserves before it issues; forex
 *     evidence-completeness requires the macro fundamental.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ELIGIBILITY_TIERS,
  rankByAnalysisEligibility,
} from "../../../scripts/lib/analysis-eligibility.mjs";
import {
  PROVIDER_BUDGET_BUCKETS,
  PROVIDER_BLOCK_CLASSES,
  TWELVE_DATA_ANALYSIS_MAX_CREDITS,
  TWELVE_DATA_DISCOVERY_CREDITS,
  buildProviderBudgetPlan,
  classifyProviderBlock,
  domainBudgetBuckets,
} from "../../../scripts/lib/provider-budget.mjs";
import { selectCandidates } from "../../../scripts/development-runtime-smoke.mjs";

const root = process.cwd();
const smoke = readFileSync(resolve(root, "scripts/development-runtime-smoke.mjs"), "utf8");

// The provider's own sentences, verbatim from run 36954328849.
const VERBATIM_429 =
  "Rate limited: [429] [429] You have run out of API credits for the current minute. 11 API credits were used, with the current limit being 8. Wait for the next minute or consider switching to a higher tier plan at https://twelvedata.com/pricing";
const VERBATIM_PLAN =
  "No live data: [404] [404] This symbol is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing";
const VERBATIM_COINGLASS =
  "CoinGlass not configured: COINGLASS_[redacted] is missing. Add it via: bunx convex env set COINGLASS_[redacted] <your-key>";
const VERBATIM_MACRO =
  "No released macroeconomic measurement was supplied for AUD or CAD — no two-sided fundamental assessment is produced, and none is invented.";
const VERBATIM_ORDER_BOOK = "provider reported failure";

describe("phase303 · A — the deterministic provider budget plan", () => {
  it("spends exact buckets FIRST, then discovery, then domain worst cases", () => {
    const plan = buildProviderBudgetPlan({
      exactSpecs: [
        { provider: "okx", providerInstrumentId: "BTC-USDT" },
        { provider: "twelve-data", providerInstrumentId: "XAU/USD" },
        { provider: "twelve-data", providerInstrumentId: "EUR/USD" },
      ],
      domainLabels: ["FOREX", "COMMODITY"],
      maxAttempts: 3,
    });
    expect(plan.order).toEqual([
      PROVIDER_BUDGET_BUCKETS.EXACT, // okx draws no TD budget — only TD identities bucket
      PROVIDER_BUDGET_BUCKETS.EXACT,
      PROVIDER_BUDGET_BUCKETS.DISCOVERY,
      PROVIDER_BUDGET_BUCKETS.DOMAIN_ANALYSIS,
      PROVIDER_BUDGET_BUCKETS.DOMAIN_ANALYSIS,
    ]);
    // each exact identity reserves a FULL worst-case window (the 429 fix)
    expect(plan.buckets[0].credits).toBe(TWELVE_DATA_ANALYSIS_MAX_CREDITS);
    expect(plan.buckets[0].windows).toBe(1);
    // discovery reserves the catalog walk worst case (5 catalogs + 1 retry)
    const discovery = plan.buckets.find((b) => b.bucket === PROVIDER_BUDGET_BUCKETS.DISCOVERY)!;
    expect(discovery.credits).toBe(TWELVE_DATA_DISCOVERY_CREDITS);
    // domain buckets bound ATTEMPTS, not evidence quality
    const forex = plan.buckets[3];
    expect(forex.label).toContain("FOREX");
    expect(forex.credits).toBe(TWELVE_DATA_ANALYSIS_MAX_CREDITS * 3);
  });

  it("never schedules more credits into a window than the provider allows", () => {
    const plan = buildProviderBudgetPlan({ domainLabels: ["CRYPTO", "FOREX", "STOCK", "COMMODITY"] });
    for (const bucket of plan.buckets) {
      const perWindow = Math.ceil(bucket.credits / bucket.windows);
      expect(perWindow).toBeLessThanOrEqual(plan.windowCredits);
    }
    expect(plan.estimatedWindows).toBe(
      plan.buckets.reduce((sum, b) => sum + b.windows, 0),
    );
  });

  it("domain buckets are computable alone and honest about the attempt bound", () => {
    const buckets = domainBudgetBuckets({ domainLabels: ["FOREX"], maxAttempts: 2 });
    expect(buckets).toHaveLength(1);
    expect(buckets[0].label).toBe("FOREX × up to 2 attempts");
    expect(buckets[0].bucket).toBe(PROVIDER_BUDGET_BUCKETS.DOMAIN_ANALYSIS);
  });
});

describe("phase303 · B — the provider's own words are classified, never blurred", () => {
  it("the run-36954328849 429 is RATE_LIMITED (a budget fact, not unavailability)", () => {
    expect(classifyProviderBlock(VERBATIM_429)?.class).toBe(PROVIDER_BLOCK_CLASSES.RATE_LIMITED);
  });

  it("the 404-that-names-a-plan is PLAN_RESTRICTED even though it is a 404", () => {
    expect(classifyProviderBlock(VERBATIM_PLAN)?.class).toBe(PROVIDER_BLOCK_CLASSES.PLAN_RESTRICTED);
  });

  it("a missing environment credential is NOT_CONFIGURED; an opaque failure is PROVIDER_FAILURE", () => {
    expect(classifyProviderBlock(VERBATIM_COINGLASS)?.class).toBe(PROVIDER_BLOCK_CLASSES.NOT_CONFIGURED);
    expect(classifyProviderBlock(VERBATIM_ORDER_BOOK)?.class).toBe(PROVIDER_BLOCK_CLASSES.PROVIDER_FAILURE);
  });

  it("genuine absence is NO_DATA, and unrelated text classifies to null", () => {
    expect(classifyProviderBlock("No live data: the provider holds no rows for this identity")?.class).toBe(
      PROVIDER_BLOCK_CLASSES.NO_DATA,
    );
    expect(classifyProviderBlock("")).toBeNull();
    expect(classifyProviderBlock(null)).toBeNull();
    expect(classifyProviderBlock("all legs acquired")).toBeNull();
  });

  it("the exact verdict carries the block class in the smoke's annotation contract", () => {
    expect(smoke).toContain("record.block = verdict.headline === \"PASS\" ? null : (marketBlock?.class ?? null);");
    expect(smoke).toContain("` · block=${record.block}`");
  });
});

describe("phase303 · C — the plan-restricted family is the provider's own fact", () => {
  it("silver spot and micro-lot variants are RESTRICTED with the verbatim plan reason", () => {
    for (const id of ["XAG/AUD", "XAG/USD", "XAGg/TRY", "XAGg/USD", "GAU/EUR"]) {
      const verdict = rankByAnalysisEligibility(
        [{ providerInstrumentId: id, assetClass: "commodity", subType: "commodity_spot", tradingState: "live" }],
        { provider: "twelve-data", assetClass: "commodity" },
      )[0].eligibility;
      expect(verdict.tier).toBe(ELIGIBILITY_TIERS.RESTRICTED);
      expect(verdict.reasons.join(" ")).toContain("Grow or Venture plan");
      expect(verdict.reasons.join(" ")).toContain("36954328849");
    }
  });

  it("restriction reorders the attempt window but drops NOTHING from discovery", () => {
    const rows = [
      { providerInstrumentId: "GAU/EUR", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
      { providerInstrumentId: "WTI/USD", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
      { providerInstrumentId: "XAG/AUD", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
      { providerInstrumentId: "XAGg/USD", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
    ];
    const spec = { discovery: "twelve-data", assetClass: "commodity", label: "COMMODITY", domain: "commodity" };
    const picked = selectCandidates(spec as never, { success: true, instruments: rows }, 3);
    expect(picked.map((c: { providerInstrumentId?: string }) => c.providerInstrumentId)).toEqual([
      "WTI/USD",
      "GAU/EUR",
      "XAG/AUD",
    ]);
    // the full universe stays listed, now ranked — nothing removed
    const ranked = rankByAnalysisEligibility(rows, { provider: "twelve-data", assetClass: "commodity" });
    expect(ranked).toHaveLength(rows.length);
  });
});

describe("phase303 · D — within-run macro-measurement learning (no whitelist)", () => {
  const rows = [
    { providerInstrumentId: "AUD/CAD", subType: "forex_spot", assetClass: "forex", tradingState: "live" },
    { providerInstrumentId: "EUR/USD", subType: "forex_spot", assetClass: "forex", tradingState: "live" },
    { providerInstrumentId: "USD/CHF", subType: "forex_spot", assetClass: "forex", tradingState: "live" },
  ];
  const ctx = { provider: "twelve-data", assetClass: "forex" };

  it("without observations, provider order stands (dynamic discovery is untouched)", () => {
    expect(rankByAnalysisEligibility(rows, ctx).map((r) => r.providerInstrumentId)).toEqual([
      "AUD/CAD",
      "EUR/USD",
      "USD/CHF",
    ]);
  });

  it("after AUD is observed unmeasured, pairs without the observation rank first", () => {
    const ranked = rankByAnalysisEligibility(rows, ctx, { macroGapCurrencies: new Set(["AUD"]) });
    expect(ranked.map((r) => r.providerInstrumentId)).toEqual(["EUR/USD", "USD/CHF", "AUD/CAD"]);
    // the observed pair is STILL eligible — it sank, it was not removed
    expect(ranked[2].eligibility.tier).toBe(ELIGIBILITY_TIERS.ELIGIBLE);
  });

  it("the learning is per-run, selection-driven, and bounded by the attempt budget", () => {
    expect(smoke).toContain("const observedMacroGaps = new Set()");
    expect(smoke).toContain("macroGapCurrencies: observedMacroGaps");
    expect(smoke).toContain("const learningQueueCeiling = Math.max(maxAttempts, MACRO_LEARNING_QUEUE_CEILING);");
    expect(smoke).toContain("/no released (macroeconomic|policy rates|inflation) measurement/i");
  });
});

describe("phase303 · E — the smoke's orchestration contract", () => {
  it("exact verification runs FIRST and reserves a full window before it issues", () => {
    const exactAt = smoke.indexOf("EXACT live verification (runs FIRST, on reserved windows)");
    const domainAt = smoke.indexOf("for (const spec of specs) {", exactAt);
    expect(exactAt).toBeGreaterThan(-1);
    expect(domainAt).toBeGreaterThan(exactAt);
    // the reserve happens in the exact block, BEFORE its analysis request
    const exactBlock = smoke.slice(exactAt, domainAt);
    expect(exactBlock).toContain("reserveAnalysisSlot(pacer, { cost: TWELVE_DATA_ANALYSIS_MAX_CREDITS, label })");
    const reserveAt = exactBlock.indexOf("reserveAnalysisSlot(pacer");
    const requestAt = exactBlock.indexOf('transport.action("protectedAnalysis:runProtectedAnalysis", request, session.token)');
    expect(reserveAt).toBeGreaterThan(-1);
    expect(requestAt).toBeGreaterThan(reserveAt);
  });

  it("discovery reserves its worst-case catalog spend BEFORE it issues", () => {
    const reserveAt = smoke.indexOf("cost: TWELVE_DATA_DISCOVERY_CREDITS");
    const walkAt = smoke.indexOf("await discoverTwelveData(transport, session.token)");
    expect(reserveAt).toBeGreaterThan(-1);
    expect(walkAt).toBeGreaterThan(reserveAt);
  });

  it("forex evidence-completeness requires the macro fundamental (the AUD/CAD case)", () => {
    expect(smoke).toContain('(spec.assetClass !== "forex" || verdict.evidence?.fundamental?.present === true)');
  });

  it("the run reports the plan and what it learned — acceptance reads the run, not the checkmark", () => {
    expect(smoke).toContain("providerBudgetPlan,");
    expect(smoke).toContain("learnedMacroGaps: [...observedMacroGaps],");
    expect(smoke).toContain("order:${providerBudgetPlan.order.join(\">\")}");
  });

  it("a real 429 is never retried: the circuit discipline is still the authority", () => {
    // the pacer's own documented contract, pinned since phase 289
    expect(smoke).toContain("a provider that really answered 429 is never waited");
    expect(smoke).toContain("never retried");
  });
});
