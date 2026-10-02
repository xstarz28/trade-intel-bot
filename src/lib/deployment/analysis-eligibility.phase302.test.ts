/**
 * Phase 302 — capability-aware analysis eligibility + exact live paths + the
 * /stocks transient-retry.
 *
 * LIVE EVIDENCE UNDER TEST (run 36951359320, verbatim reasons reproduced in the
 * expectations below): the four-asset smoke was honest-UNAVAILABLE everywhere
 * because first-ranked DISCOVERY candidates were analytically unusable —
 * BTC-PLN (3/1/12 candles, no MTF chain), AED/ARS (no verified calendar
 * mapping), /stocks (header timeout), GAU/* (Twelve Data plan restriction +
 * Alpha Vantage slash rejection) — while WTI/USD consumed its own EIA feed and
 * EUR/USD-class majors were never reached.
 *
 * Under test:
 *  - the eligibility classifier (tiers, verbatim provider reasons, degraded
 *    legs) and its ranking (eligible-first, provider order preserved within a
 *    tier, NOTHING dropped from discovery);
 *  - the calendar-mapping mirror cannot drift from the product's
 *    FOREX_COUNTRY_MAP;
 *  - the exact live-verification set matches the phase-298 established native
 *    identities (BTC = okx BTC-USDT, XAU = twelve-data XAU/USD);
 *  - the smoke's selection uses eligibility BEFORE the attempt budget, and the
 *    attempt loop no longer stops on market bytes alone (BTC-PLN case);
 *  - the /stocks transient guard failure earns exactly ONE bounded retry,
 *    while provider rejections are never retried.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ALPHA_VANTAGE_TICKER_REASON,
  CALENDAR_MAPPED_CURRENCIES,
  COMMODITY_NATIVE_ROUTES,
  ELIGIBILITY_TIERS,
  EXACT_LIVE_VERIFICATION_SET,
  TWELVE_DATA_PLAN_RESTRICTION_REASON,
  classifyInstrumentEligibility,
  parseExactInstrumentSpecs,
  rankByAnalysisEligibility,
} from "../../../scripts/lib/analysis-eligibility.mjs";
import { selectCandidates } from "../../../scripts/development-runtime-smoke.mjs";
import { FOREX_COUNTRY_MAP } from "../data/calendar-types";
import { createTwelveDataCatalogTransport } from "../discovery/twelve-data-transport";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

const td = (id: string, assetClass: string) =>
  classifyInstrumentEligibility({ provider: "twelve-data", providerInstrumentId: id, assetClass });
const okx = (id: string) =>
  classifyInstrumentEligibility({ provider: "okx", providerInstrumentId: id, assetClass: "crypto" });

describe("phase302 · eligibility tiers name the ACTUAL missing capability", () => {
  it("GAU/* is RESTRICTED with the provider's verbatim plan reason (run 36951359320)", () => {
    for (const id of ["GAU/EUR", "GAU/GBP", "GAU/IDR", "GAU/TRY", "GAU/USD"]) {
      const verdict = td(id, "commodity");
      expect(verdict.tier).toBe(ELIGIBILITY_TIERS.RESTRICTED);
      expect(verdict.fullAnalysisPossible).toBe(false);
      expect(verdict.reasons.join(" ")).toContain("Grow or Venture plan");
      expect(verdict.degradedLegs).toContain("market-data/ohlcv");
    }
    expect(TWELVE_DATA_PLAN_RESTRICTION_REASON).toContain("36951359320");
  });

  it("XAU/USD and WTI/USD are the eligible provider-native commodity routes", () => {
    const gold = td(COMMODITY_NATIVE_ROUTES.gold.providerInstrumentId, "commodity");
    expect(gold.tier).toBe(ELIGIBILITY_TIERS.ELIGIBLE);
    expect(gold.reasons.join(" ")).toContain("identity-model capability registry");
    expect(td(COMMODITY_NATIVE_ROUTES.petroleum.providerInstrumentId, "commodity").tier).toBe(
      ELIGIBILITY_TIERS.ELIGIBLE,
    );
  });

  it("AED/ARS is DEGRADED naming its unmapped sides; EUR/USD and AUD/CAD are eligible", () => {
    const aedArs = td("AED/ARS", "forex");
    expect(aedArs.tier).toBe(ELIGIBILITY_TIERS.DEGRADED);
    expect(aedArs.fullAnalysisPossible).toBe(false);
    expect(aedArs.reasons.join(" ")).toContain("AED, ARS are not in the verified mapping");
    expect(aedArs.degradedLegs).toContain("tickatlas/calendar");
    for (const pair of ["EUR/USD", "AUD/CAD", "USD/JPY"]) {
      expect(td(pair, "forex").tier).toBe(ELIGIBILITY_TIERS.ELIGIBLE);
    }
  });

  it("slash-form identities carry the Alpha Vantage ticker-grammar leg as a degraded leg", () => {
    const gau = td("GAU/EUR", "commodity");
    expect(gau.degradedLegs).toContain("alpha-vantage/news-sentiment");
    expect(gau.reasons.join(" ")).toContain(ALPHA_VANTAGE_TICKER_REASON.slice(0, 40));
    // the excluded leg is named even for an otherwise eligible pair
    const eurUsd = td("EUR/USD", "forex");
    expect(eurUsd.degradedLegs).toContain("alpha-vantage/news-sentiment");
    // non-slash identities are untouched
    expect(okx("BTC-USDT").tier).toBe(ELIGIBILITY_TIERS.ELIGIBLE);
    expect(okx("BTC-USDT").degradedLegs).toHaveLength(0);
  });

  it("the calendar mirror cannot drift from the product's FOREX_COUNTRY_MAP", () => {
    expect([...CALENDAR_MAPPED_CURRENCIES].sort()).toEqual(Object.keys(FOREX_COUNTRY_MAP).sort());
  });
});

describe("phase302 · discovery order survives; tiers reorder it", () => {
  const commodityRows = [
    { providerInstrumentId: "GAU/EUR", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
    { providerInstrumentId: "GAU/GBP", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
    { providerInstrumentId: "GAU/IDR", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
    { providerInstrumentId: "URALS/USD", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
    { providerInstrumentId: "WTI/USD", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
    { providerInstrumentId: "XAG/AUD", subType: "commodity_spot", assetClass: "commodity", tradingState: "live" },
  ];
  const spec = { discovery: "twelve-data", assetClass: "commodity", label: "COMMODITY", domain: "commodity" };

  it("the bounded attempt window spends itself on candidates the provider can analyse", () => {
    const ranked = rankByAnalysisEligibility(commodityRows, { provider: "twelve-data", assetClass: "commodity" });
    // provider order preserved WITHIN tiers: URALS before WTI (all eligible).
    // Phase 303: XAG/AUD joined the RESTRICTED families — live evidence run
    // 36954328849 gave silver the SAME plan sentence as the tokenized gold.
    expect(ranked.map((r) => r.providerInstrumentId).slice(0, 3)).toEqual(["URALS/USD", "WTI/USD", "GAU/EUR"]);
    // the restricted families sink, still present (never dropped from discovery);
    // within the restricted tier the provider's own order is preserved
    const last = ranked[ranked.length - 1];
    expect(last.providerInstrumentId).toBe("XAG/AUD");
    expect(last.eligibility.tier).toBe(ELIGIBILITY_TIERS.RESTRICTED);
    expect(ranked).toHaveLength(commodityRows.length);
  });

  it("selectCandidates hands the ATTEMPT BUDGET eligible candidates first", () => {
    const candidates = selectCandidates(spec as never, { success: true, instruments: commodityRows }, 3);
    expect(candidates.map((c: { providerInstrumentId?: string }) => c.providerInstrumentId)).toEqual([
      "URALS/USD",
      "WTI/USD",
      "GAU/EUR",
    ]);
    expect(candidates[0]).toHaveProperty("eligibility");
  });

  it("forex candidates without a calendar mapping rank behind mapped majors", () => {
    const rows = [
      { providerInstrumentId: "AED/ARS", subType: "forex_spot", assetClass: "forex", tradingState: "live" },
      { providerInstrumentId: "AED/AUD", subType: "forex_spot", assetClass: "forex", tradingState: "live" },
      { providerInstrumentId: "AUD/CAD", subType: "forex_spot", assetClass: "forex", tradingState: "live" },
      { providerInstrumentId: "EUR/USD", subType: "forex_spot", assetClass: "forex", tradingState: "live" },
    ];
    const ranked = rankByAnalysisEligibility(rows, { provider: "twelve-data", assetClass: "forex" });
    expect(ranked.map((r) => r.providerInstrumentId)).toEqual(["AUD/CAD", "EUR/USD", "AED/ARS", "AED/AUD"]);
  });
});

describe("phase302 · the exact live-verification paths are the established ones", () => {
  it("BTC and XAU match the phase-298 shipped-path identities, plus a mapped major", () => {
    const btc = EXACT_LIVE_VERIFICATION_SET.find((s) => s.label === "BTC")!;
    const xau = EXACT_LIVE_VERIFICATION_SET.find((s) => s.label === "XAU")!;
    expect(btc).toEqual({ label: "BTC", provider: "okx", assetClass: "crypto", providerInstrumentId: "BTC-USDT" });
    expect(xau).toEqual({
      label: "XAU",
      provider: "twelve-data",
      assetClass: "commodity",
      providerInstrumentId: "XAU/USD",
    });
    // the shipped-path suite is the provenance: it pins the same native ids
    const phase298 = read("src/convex/btc-xau-runtime-path.phase298.test.ts");
    expect(phase298).toContain("BTC-USDT");
    expect(phase298).toContain("XAU/USD");
  });

  it("specs parse strictly; a malformed spec refuses the run", () => {
    const parsed = parseExactInstrumentSpecs(
      "okx:crypto:BTC-USDT,twelve-data:commodity:XAU/USD,twelve-data:forex:EUR/USD",
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.specs).toHaveLength(3);
    expect(parsed.specs[1]).toMatchObject({ provider: "twelve-data", assetClass: "commodity", providerInstrumentId: "XAU/USD" });
    const bad = parseExactInstrumentSpecs("okx:BTC-USDT");
    expect(bad.ok).toBe(false);
    expect(bad.problem).toContain("provider:assetClass:nativeId");
    expect(parseExactInstrumentSpecs("").ok).toBe(false);
  });
});

describe("phase302 · the smoke's attempt loop and exact mode are contract-locked", () => {
  const smoke = read("scripts/development-runtime-smoke.mjs");

  it("market bytes alone no longer stop the attempt loop (the BTC-PLN case)", () => {
    expect(smoke).toContain("verdict.evidence?.technical?.available === true");
    expect(smoke).toContain("verdict.evidence?.unified?.present === true");
    expect(smoke).not.toContain('verdict.headline === "PASS" || verdict.evidence?.market?.observedAt) break');
  });

  it("selection runs the eligibility ranking BEFORE the attempt budget is bounded", () => {
    // Phase 303: the ranker call gained the learning-observations argument.
    expect(smoke).toContain("const ranked = rankByAnalysisEligibility(");
    const rankAt = smoke.indexOf("const ranked = rankByAnalysisEligibility(");
    const sliceAt = smoke.indexOf("return ranked.slice(0, Math.max(1, Math.min(maxAttempts, ceiling)));");
    expect(rankAt).toBeGreaterThan(-1);
    expect(sliceAt).toBeGreaterThan(rankAt);
  });

  it("the exact mode is opt-in, validated early, and reports through the same classifier", () => {
    expect(smoke).toContain('flag("--exact", argv) ?? process.env.XSTARZ_SMOKE_EXACT');
    const refuseAt = smoke.indexOf("REFUSED: ${exactParsed.problem}");
    const transportAt = smoke.indexOf("const transport = createTransport(origin);");
    expect(refuseAt).toBeGreaterThan(-1);
    expect(refuseAt).toBeLessThan(transportAt); // refuses before anything is requested
    expect(smoke).toContain('transport.action("protectedAnalysis:runProtectedAnalysis", request, session.token)');
    expect(smoke).toContain("${label} ${verdict.headline}");
  });

  it("the workflow carries the exact_instruments input to the harness env", () => {
    const workflow = read(".github/workflows/development-runtime-smoke.yml");
    expect(workflow).toContain("exact_instruments:");
    expect(workflow).toContain("XSTARZ_SMOKE_EXACT: ${{ inputs.exact_instruments }}");
  });
});

describe("phase302 · /stocks transient guard failure earns exactly ONE bounded retry", () => {
  type Body = AsyncIterable<Uint8Array | string>;
  const streamingResponse = (body: Body): Response =>
    ({ ok: true, status: 200, body, headers: new Headers() }) as unknown as Response;

  it("retries once after a header-guard timeout and succeeds (run 36951359320's /stocks case)", async () => {
    let calls = 0;
    const body: Body = {
      async *[Symbol.asyncIterator]() {
        yield '{"status":"ok","count":1,"data":[{"symbol":"AAPL"}]}';
      },
    };
    const flaky: typeof fetch = ((_url: string, init: { signal?: AbortSignal }) => {
      calls += 1;
      if (calls === 1) {
        // First attempt: no headers at all — the exact live failure.
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(init.signal!.reason instanceof Error ? init.signal!.reason : new Error("aborted"));
          });
        }) as unknown as Promise<Response>;
      }
      return Promise.resolve(streamingResponse(body));
    }) as unknown as typeof fetch;
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 30,
      stallMs: 5_000,
      timeoutMs: 5_000,
      fetchImpl: flaky,
    });
    const result = await transport("https://api.twelvedata.com/stocks");
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
    const chunks: string[] = [];
    for await (const chunk of result.body!) {
      chunks.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
    }
    expect(chunks.join("")).toContain("AAPL");
  }, 5_000);

  it("never retries a provider rejection or a non-transient failure", async () => {
    let calls = 0;
    const hardFail: typeof fetch = (() => {
      calls += 1;
      return Promise.reject(new Error("getaddrinfo EAI_AGAIN"));
    }) as unknown as typeof fetch;
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 30,
      stallMs: 5_000,
      timeoutMs: 5_000,
      fetchImpl: hardFail,
    });
    await expect(transport("https://api.twelvedata.com/stocks")).rejects.toThrow("EAI_AGAIN");
    expect(calls).toBe(1);
  }, 5_000);

  it("a failing retry chains BOTH reasons so nothing is swallowed", async () => {
    const alwaysSlow: typeof fetch = ((_url: string, init: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(init.signal!.reason instanceof Error ? init.signal!.reason : new Error("aborted"));
        });
      })) as unknown as typeof fetch;
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 20,
      stallMs: 5_000,
      timeoutMs: 5_000,
      fetchImpl: alwaysSlow,
    });
    await expect(transport("https://api.twelvedata.com/stocks")).rejects.toThrow(
      /no response headers within 20 ms \(transient-guard retry after: no response headers within 20 ms\)/,
    );
  }, 5_000);
});
