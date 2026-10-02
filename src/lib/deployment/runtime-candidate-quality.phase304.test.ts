/**
 * Phase 304 — staged catalog materialization, capability routing, and runtime
 * candidate quality, tested against the LIVE evidence of run 36957205385.
 *
 * LIVE FACTS UNDER TEST (all verbatim from that run):
 *  - `/stocks COMPLETE 143212 kept` yet `STOCK UNAVAILABLE — discovery returned
 *    no live equity instrument`: a staged catalog never reaches the inline
 *    `discovery.instruments`, so inline-only selection saw an empty pool behind
 *    a COMPLETE catalog (workstream A seam);
 *  - `XAU/CHF` consumed the commodity window while the proven route `WTI/USD`
 *    sat at provider position #2 (workstream B seam);
 *  - EXACT EUR/USD: market+technical+unified REAL, fundamental UNAVAILABLE with
 *    `No released macroeconomic measurement was supplied for EUR or USD` — an
 *    external data gap, not a capability bug (workstream C);
 *  - AUD/CAD was the forex domain's ONLY attempt: the phase-303
 *    evidence-completeness gate read `fundamental.present`, but the runtime
 *    delivers a present-but-`available:false` assessment, so the loop ended
 *    after one candidate (workstream C/D bug);
 *  - `USDC-PLN` was the crypto domain's pick with real market bytes and no
 *    usable technical series (workstream D).
 *
 * Under test:
 *  A. bounded, provider-order, identity-complete staged-catalog selection with
 *     full provenance (never a wholesale load, never a whitelist);
 *  B. capability routing: the registry's routes are preferred WITHIN the
 *     eligible tier, provider-proven plan-restricted families sink after the
 *     run observes them, and the route itself is immune to its family's
 *     demotion (XAU/USD is the plan-PROVEN exception — EXACT PASS);
 *  C. the runtime's own released-measurement sentence classifies as
 *     EXTERNAL_DATA_GAP — distinct from PLAN_RESTRICTED, NO_DATA and bugs;
 *  D. the technical-insufficiency family learning + the visible attempt trail;
 *  E. verdict hygiene: the forex completeness gate reads `available` (the
 *     single-attempt bug), generic verdicts carry `block=<CLASS>` and the
 *     attempt sequence.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  COMMODITY_NATIVE_ROUTES,
  ELIGIBILITY_TIERS,
  familyOf,
  observeAttemptOutcome,
  rankByAnalysisEligibility,
} from "../../../scripts/lib/analysis-eligibility.mjs";
import {
  PROVIDER_BLOCK_CLASSES,
  classifyProviderBlock,
} from "../../../scripts/lib/provider-budget.mjs";
import {
  STAGED_SELECTION_MAX_ROWS,
  STAGED_SELECTION_PAGE_ROWS,
  okxDiscoveryDigest,
  selectCandidatesFromStagedCatalog,
  stagedCatalogFor,
} from "../../../scripts/development-runtime-smoke.mjs";

const root = process.cwd();
const smoke = readFileSync(resolve(root, "scripts/development-runtime-smoke.mjs"), "utf8");

// The provider's own sentences, verbatim from run 36957205385.
const VERBATIM_XAUCHF_404 =
  "no provider market evidence with a provider observation instant — runtime said: Technical evidence unavailable — failing legs: market-data/ohlcv: No live data: [404] [404] This symbol is available starting with the Grow or Venture plan. Consider upgrading now at https://twelvedata.com/pricing";
const VERBATIM_EURUSD_MACRO =
  "market + technical + unified are real; the domain-native FUNDAMENTAL assessment is unavailable — No released macroeconomic measurement was supplied for EUR or USD — no two-sided fundamental assessment is produced, and none is invented.";
const VERBATIM_USDCPLN_TECH =
  "market evidence is real but technical/unified evidence is not available — Technical evidence unavailable — the analysis is a fundamental-only read and makes no combined claim.";

/** A page-cursor stage transport over one array, in provider order. */
function stageTransport(rows: unknown[], pageSize = 480, opts: { failAfter?: number } = {}) {
  let reads = 0;
  const pages: Array<{ afterSeq: number; limit: number }> = [];
  return {
    pages,
    get reads() {
      return reads;
    },
    action: async (_path: string, args: { stageId: string; afterSeq?: number; limit?: number }) => {
      reads += 1;
      if (opts.failAfter !== undefined && reads > opts.failAfter) {
        return { ok: false, appError: "stage read failed: transport closed" };
      }
      const afterSeq = args.afterSeq ?? -1;
      const limit = args.limit ?? pageSize;
      pages.push({ afterSeq, limit });
      const start = afterSeq + 1;
      const batch = rows.slice(start, start + limit);
      return {
        ok: true,
        value: {
          rows: batch,
          hasMore: start + batch.length < rows.length,
          nextAfterSeq: start + batch.length - 1,
          stagedRows: rows.length,
        },
      };
    },
  };
}

const equityRow = (symbol: string, extra: Record<string, unknown> = {}) => ({
  seq: 0,
  provider: "twelve-data",
  providerInstrumentId: symbol,
  assetClass: "equity",
  subType: "equity_common",
  baseAsset: symbol,
  quoteAsset: "USD",
  tradingState: "live",
  ...extra,
});

const STOCK_SPEC = { domain: "stock", label: "STOCK", discovery: "twelve-data", assetClass: "equity" };

describe("phase304 · A — bounded staged-catalog candidate selection", () => {
  it("finds the staged catalog for an asset class", () => {
    const discovery = {
      success: true,
      instruments: [],
      catalogs: [
        { path: "/forex_pairs", assetClass: "forex", completeness: "COMPLETE", transport: { mode: "inline" } },
        {
          path: "/stocks",
          assetClass: "equity",
          completeness: "COMPLETE",
          transport: { mode: "staged", state: "complete", stageId: "/stocks|1|abc", stagedRows: 143212 },
        },
      ],
    };
    expect(stagedCatalogFor(discovery, "equity")?.transport.stageId).toBe("/stocks|1|abc");
    expect(stagedCatalogFor(discovery, "commodity")).toBeNull();
  });

  it("reads a bounded provider-order window, filters identity-incomplete rows, ranks and proves provenance", async () => {
    const rows = [
      equityRow("ZZTOP", { tradingState: "disabled" }), // filtered by trading state
      equityRow("AAPL"),
      { seq: 2, provider: "twelve-data", providerInstrumentId: "", assetClass: "equity", baseAsset: "", quoteAsset: "", tradingState: "live" }, // identity-less
      equityRow("MSFT"),
      equityRow("NVDA"),
    ];
    const transport = stageTransport(rows); // tiny pages so pagination is real
    const discovery = {
      success: true,
      instruments: [],
      catalogs: [
        { path: "/stocks", assetClass: "equity", completeness: "COMPLETE", transport: { mode: "staged", state: "complete", stageId: "/stocks|1|abc", stagedRows: 143212 } },
      ],
    };
    const result = await selectCandidatesFromStagedCatalog(STOCK_SPEC as never, discovery as never, transport as never, "tok", {
      maxAttempts: 3,
      pageRows: 2, // exercise the cursor across several bounded pages
    });
    expect(result.ok).toBe(true);
    // provider order preserved within the ranked window (all eligible here)
    expect(result.candidates.map((c: { providerInstrumentId?: string }) => c.providerInstrumentId)).toEqual([
      "AAPL",
      "MSFT",
      "NVDA",
    ]);
    expect(result.provenance!.source).toBe("staged-catalog");
    expect(result.provenance!.stageId).toBe("/stocks|1|abc");
    expect(result.provenance!.stagedRows).toBe(143212);
    expect(result.provenance!.pagesRead).toBe(3);
    expect(result.provenance!.rowsRead).toBe(5);
    expect(result.provenance!.usableRows).toBe(3);
    expect(result.provenance!.selected).toEqual(["AAPL", "MSFT", "NVDA"]);
    expect(result.provenance!.lastAfterSeq).toBe(4);
  });

  it("never loads the catalog wholesale — the row cap stops the walk", async () => {
    const rows = Array.from({ length: 5_000 }, (_, i) => equityRow(`S${i}`));
    const transport = stageTransport(rows, STAGED_SELECTION_PAGE_ROWS);
    const discovery = {
      success: true,
      instruments: [],
      catalogs: [{ path: "/stocks", assetClass: "equity", completeness: "COMPLETE", transport: { mode: "staged", state: "complete", stageId: "/stocks|1|abc", stagedRows: 5_000 } }],
    };
    const result = await selectCandidatesFromStagedCatalog(STOCK_SPEC as never, discovery as never, transport as never, "tok", { maxAttempts: 3 });
    expect(result.provenance!.rowsRead).toBe(STAGED_SELECTION_MAX_ROWS);
    expect(transport.reads).toBe(Math.ceil(STAGED_SELECTION_MAX_ROWS / STAGED_SELECTION_PAGE_ROWS));
    expect(result.provenance!.rowsRead).toBeLessThan(5_000);
  });

  it("reports a failed stage read instead of inventing candidates", async () => {
    const transport = stageTransport([equityRow("AAPL")], 480, { failAfter: 0 });
    const discovery = {
      success: true,
      instruments: [],
      catalogs: [{ path: "/stocks", assetClass: "equity", completeness: "COMPLETE", transport: { mode: "staged", state: "complete", stageId: "/stocks|1|abc", stagedRows: 9 } }],
    };
    const result = await selectCandidatesFromStagedCatalog(STOCK_SPEC as never, discovery as never, transport as never, "tok", { maxAttempts: 3 });
    expect(result.ok).toBe(false);
    expect(result.provenance!.readError).toContain("stage read failed");
    expect(result.candidates).toHaveLength(0);
  });

  it("the run wires the seam only when the inline pool is empty, and records the source", () => {
    expect(smoke).toContain('let candidateSource = "discovery-instruments";');
    expect(smoke).toContain('candidateSource = "staged-catalog";');
    expect(smoke).toContain("record.candidateSource = candidateSource;");
    expect(smoke).toContain("stagedSelection: staged.provenance,");
  });
});

describe("phase304 · B — capability routing within the provider's own pool", () => {
  const commodityPool = [
    { providerInstrumentId: "XAU/CHF", assetClass: "commodity", subType: "commodity_spot", tradingState: "live" },
    { providerInstrumentId: "URALS/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "live" },
    { providerInstrumentId: "WTI/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "live" },
    { providerInstrumentId: "XAU/AUD", assetClass: "commodity", subType: "commodity_spot", tradingState: "live" },
  ];

  it("route-preferred identities (present in the pool) rank ahead of same-tier peers", () => {
    const ranked = rankByAnalysisEligibility(commodityPool, { provider: "twelve-data", assetClass: "commodity" });
    // WTI/USD (the proven petroleum route) is the pool's THIRD provider row and ranks first;
    // nothing was added: XAU/USD is NOT injected when discovery lacks it.
    expect(ranked[0].providerInstrumentId).toBe("WTI/USD");
    expect(ranked).toHaveLength(commodityPool.length);
    expect(Object.values(COMMODITY_NATIVE_ROUTES).map((r) => r.providerInstrumentId)).toContain("XAU/USD");
    const ids = ranked.map((r) => r.providerInstrumentId);
    expect(ids).not.toContain("XAU/USD"); // no route injection — preference, not a whitelist
  });

  it("a provider-proven plan-restricted family sinks for the rest of the run — except the proven route", () => {
    const learned = rankByAnalysisEligibility(commodityPool, { provider: "twelve-data", assetClass: "commodity" }, {
      planRestrictedFamilies: new Set(["XAU"]), // observed live from XAU/CHF's 404-that-names-a-plan
    });
    const ids = learned.map((r) => r.providerInstrumentId);
    // the route (WTI) first; the demoted XAU family last; URALS in between
    expect(ids[0]).toBe("WTI/USD");
    expect(ids.slice(-2).sort()).toEqual(["XAU/AUD", "XAU/CHF"]);
    // XAU/USD, were the provider to list it, is itself a route — the plan's
    // PROVEN exception (EXACT XAU/USD = PASS) — so it ranks WITH the route
    // group, never in its family's demoted tail.
    const withRoute = rankByAnalysisEligibility(
      [...commodityPool, { providerInstrumentId: "XAU/USD", assetClass: "commodity", subType: "commodity_spot", tradingState: "live" }],
      { provider: "twelve-data", assetClass: "commodity" },
      { planRestrictedFamilies: new Set(["XAU"]) },
    );
    const routeIds = withRoute.slice(0, 2).map((r) => r.providerInstrumentId).sort();
    expect(routeIds).toEqual(["WTI/USD", "XAU/USD"]); // the route group leads
    expect(withRoute.slice(-2).map((r) => r.providerInstrumentId).sort()).toEqual(["XAU/AUD", "XAU/CHF"]);
  });

  it("familyOf maps both identity grammars and ignores separator-less ids", () => {
    expect(familyOf("XAU/CHF")).toBe("XAU");
    expect(familyOf("USDC-PLN")).toBe("USDC");
    expect(familyOf("AAPL")).toBe("AAPL");
    expect(familyOf("")).toBe("");
  });

  it("the observer learns ONLY from the provider's/runtime's own sentences", () => {
    // Phase 305: the observer also names the QUOTE strike for dash-form
    // identities (the thin-quote pattern accumulates across base families).
    expect(observeAttemptOutcome({ providerInstrumentId: "XAU/CHF", assetClass: "commodity", verdictReason: VERBATIM_XAUCHF_404 })).toEqual({
      macroGapSides: [],
      planRestrictedFamily: "XAU",
      technicallyInsufficientFamily: null,
      technicallyInsufficientQuote: null,
    });
    expect(observeAttemptOutcome({ providerInstrumentId: "USDC-PLN", assetClass: "crypto", verdictReason: VERBATIM_USDCPLN_TECH })).toEqual({
      macroGapSides: [],
      planRestrictedFamily: null,
      technicallyInsufficientFamily: "USDC",
      technicallyInsufficientQuote: "PLN",
    });
    expect(observeAttemptOutcome({ providerInstrumentId: "EUR/USD", assetClass: "forex", verdictReason: VERBATIM_EURUSD_MACRO })).toEqual({
      macroGapSides: ["EUR", "USD"],
      planRestrictedFamily: null,
      technicallyInsufficientFamily: null,
      technicallyInsufficientQuote: null,
    });
    // a clean verdict observes nothing
    expect(observeAttemptOutcome({ providerInstrumentId: "WTI/USD", assetClass: "commodity", verdictReason: "all evidence present" })).toEqual({
      macroGapSides: [],
      planRestrictedFamily: null,
      technicallyInsufficientFamily: null,
      technicallyInsufficientQuote: null,
    });
  });
});

describe("phase304 · C — external data gap is its own explicit class", () => {
  it("the released-measurement absence is EXTERNAL_DATA_GAP, never a code bug or NO_DATA", () => {
    expect(classifyProviderBlock(VERBATIM_EURUSD_MACRO)?.class).toBe(PROVIDER_BLOCK_CLASSES.EXTERNAL_DATA_GAP);
    expect(classifyProviderBlock("policy rates UNAVAILABLE — the calendar provider supplied no released policy rates measurement for EUR or USD")?.class).toBe(
      PROVIDER_BLOCK_CLASSES.EXTERNAL_DATA_GAP,
    );
  });

  it("precedence holds: plan-named 404 stays PLAN_RESTRICTED; genuine absence stays NO_DATA", () => {
    expect(classifyProviderBlock(VERBATIM_XAUCHF_404)?.class).toBe(PROVIDER_BLOCK_CLASSES.PLAN_RESTRICTED);
    expect(classifyProviderBlock("No live data: the provider holds no rows for this identity")?.class).toBe(
      PROVIDER_BLOCK_CLASSES.NO_DATA,
    );
  });

  it("generic verdicts carry the block class and the exact provider reason stays first", () => {
    expect(smoke).toContain("record.block = genericBlock?.class ?? null;");
    // the reason leads; the class is appended metadata
    expect(smoke).toContain("${record.reason ?? \"\"}${digest === null ? \"\" : ` · informational — ${digest}`}");
    expect(smoke).toContain("record.block ? ` · block=${record.block}` : \"\"");
  });
});

describe("phase304 · D — crypto candidate quality and the visible attempt trail", () => {
  it("a technically-insufficient family sinks on the next pick of the same run", () => {
    const okxPool = [
      { instId: "USDC-PLN", assetClass: "crypto" },
      { instId: "USDC-EUR", assetClass: "crypto" },
      { instId: "ETH-USD", assetClass: "crypto" },
    ];
    const ranked = rankByAnalysisEligibility(okxPool, { provider: "okx", assetClass: "crypto" }, {
      technicallyInsufficientFamilies: new Set(["USDC"]),
    });
    expect(ranked.map((r) => r.instId)).toEqual(["ETH-USD", "USDC-PLN", "USDC-EUR"]);
    // the demoted family is still in the pool — it sank, it was not dropped
    expect(ranked).toHaveLength(3);
  });

  it("the attempt sequence is part of the domain annotation", () => {
    expect(smoke).toContain("const attemptTrail = record.attempts");
    expect(smoke).toContain("${attemptTrail ? ` · attempts=[${attemptTrail}]` : \"\"}");
  });

  it("the OKX pool is now visible in the run (the USDC-PLN blind spot)", () => {
    expect(smoke).toContain("`OKX discovery ${okxDiscovery.success === true ? \"OK\" : \"UNAVAILABLE\"}`");
    expect(okxDiscoveryDigest({ success: true, completeness: "COMPLETE", instruments: [{ instId: "USDC-PLN" }, { instId: "ETH-USD" }], warnings: [] })).toContain(
      "total=2 · identities=USDC-PLN,ETH-USD",
    );
    expect(okxDiscoveryDigest(null)).toContain("no okx discovery result");
  });
});

describe("phase304 · E — verdict hygiene", () => {
  it("the forex completeness gate reads fundamental.available — the single-attempt bug is dead", () => {
    // Run 36957205385: the 303 gate read `present`, which is true whenever the
    // runtime delivers its (honest) unavailable assessment — AUD/CAD became the
    // forex domain's ONLY attempt.
    expect(smoke).toContain('(spec.assetClass !== "forex" || verdict.evidence?.fundamental?.available === true)');
    expect(smoke).not.toContain("verdict.evidence?.fundamental?.present === true");
  });

  it("catalog COMPLETE no longer implies candidate available — the seam is stated in the verdict", () => {
    expect(smoke).toContain("staged-catalog seam attempted:");
    expect(smoke).toContain("Catalog COMPLETE ≠ candidate analysis available".toUpperCase().slice(0, 1) === "C" ? "Phase 304: catalog COMPLETE no longer implies" : "Phase 304: catalog COMPLETE no longer implies");
  });
});
