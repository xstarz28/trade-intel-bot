/**
 * Phase 305 — analysis-readiness: the three confirmed run-36960231581 gaps,
 * turned into testable behavior. LIVE EVIDENCE (verbatim, run 36960231581,
 * harnessCommit ba90c5a):
 *
 *  1. STOCK  — `/stocks discovery failed: no response headers within 20000 ms
 *     (transient-guard retry after: no response headers within 20000 ms)` —
 *     the largest catalog (raw 202,321 rows) tripped the shared 20 s
 *     first-byte guard TWICE, while run 36957205385 proved the endpoint CAN
 *     answer and stage 143,212 rows. The /stocks path now earns its own
 *     bounded first-byte budget; the guard message still names the budget
 *     that ran, so the failure carries its own provenance.
 *  2. FOREX  — `No released macroeconomic measurement was supplied for EUR or
 *     USD` (and AUD/CAD, GBP/JPY) while the SAME records named upcoming
 *     events: the provider (TickAtlas/Trading Economics) DOES carry released
 *     measurements (`status:"released"` events with `actual`), but the
 *     acquisition window was only 7 days — narrower than a central-bank
 *     decision cycle. The lookback now spans 40 days; events stay
 *     provider-verbatim, and a calendar WITHOUT released values still cannot
 *     make a fundamental available (proven functionally below).
 *  3. CRYPTO — the window burned all three attempts on three DIFFERENT base
 *     families sharing one thin quote (BTC-PLN, ETH-PLN, USDC-PLN): a
 *     family-keyed SET cannot accumulate that pattern. Technical strikes are
 *     now COUNTED per `base:<family>` AND `quote:<currency>`, so repeated
 *     failures through one quote steer later picks toward candidates with no
 *     strikes — dynamically, no whitelist, exact inputs untouched.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  observeAttemptOutcome,
  rankByAnalysisEligibility,
} from "../../../scripts/lib/analysis-eligibility.mjs";
import {
  CATALOG_HEADERS_TIMEOUT_MS,
  CATALOG_STOCK_HEADERS_TIMEOUT_MS,
  createTwelveDataCatalogTransport,
} from "../discovery/twelve-data-transport";
import { assessForexFundamentals } from "../fundamental/forex";
import type { EconomicCalendarData, EconomicEvent } from "../data/calendar-types";

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** A fetch that NEVER answers headers, rejecting on abort (the guard's own reason). */
const neverHeaders: typeof fetch = ((_url: string, init: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => {
      reject(init.signal!.reason instanceof Error ? init.signal!.reason : new Error("aborted"));
    });
  })) as unknown as typeof fetch;

describe("phase305 · 1 — the /stocks catalog earns its own bounded first-byte budget", () => {
  it("the budget constants are the evidence-named ones", () => {
    expect(CATALOG_HEADERS_TIMEOUT_MS).toBe(20_000);
    expect(CATALOG_STOCK_HEADERS_TIMEOUT_MS).toBe(45_000);
    expect(CATALOG_STOCK_HEADERS_TIMEOUT_MS).toBeGreaterThan(CATALOG_HEADERS_TIMEOUT_MS);
  });

  it("a /stocks read waits for the PATH budget (not the shared one) and names it in the failure", async () => {
    // Small budgets keep the test fast; the mechanism (per-path override) is
    // what is under test — the production constants are pinned above.
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 1_000,
      headersMsByPath: { "/stocks": 2_500 },
      fetchImpl: neverHeaders,
    });
    const started = Date.now();
    await expect(transport("https://api.twelvedata.com/stocks?apikey=x")).rejects.toThrow(
      /no response headers within 2500 ms/,
    );
    // the guard really waited for the path override, not the shared budget
    expect(Date.now() - started).toBeGreaterThanOrEqual(2_400);
  }, 10_000);

  it("every other path keeps the shared budget", async () => {
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 1_000,
      headersMsByPath: { "/stocks": 2_500 },
      fetchImpl: neverHeaders,
    });
    await expect(transport("https://api.twelvedata.com/commodities?apikey=x")).rejects.toThrow(
      /no response headers within 1000 ms/,
    );
  }, 10_000);

  it("the runtime wires the per-path budget and the harness bound covers the worst read", () => {
    const marketData = read("src/convex/marketData.ts");
    expect(marketData).toContain('headersMsByPath: { "/stocks": CATALOG_STOCK_HEADERS_TIMEOUT_MS }');
    // worst /stocks read = 45 s headers + 180 s body/staging ceiling; the
    // harness discovery-action bound must not abort a progressing walk
    const smoke = read("scripts/development-runtime-smoke.mjs");
    expect(smoke).toContain("const DISCOVERY_CALL_TIMEOUT_MS = 300_000;");
    // the phase-302 one-retry discipline is untouched
    const transportSource = read("src/lib/discovery/twelve-data-transport.ts");
    expect(transportSource).toContain("TRANSIENT_GUARD_PREFIXES");
  });

  it("the failure message is the provenance: the budget that ran is the number reported", async () => {
    const transport = createTwelveDataCatalogTransport({
      apiKey: "test-key",
      headersMs: 1_000,
      headersMsByPath: { "/stocks": 2_500 },
      fetchImpl: neverHeaders,
    });
    const message = await transport("https://api.twelvedata.com/stocks?apikey=x").catch(
      (error: Error) => error.message,
    );
    // BOTH attempts name the path's own budget, and the retry chain is
    // preserved verbatim — the failure IS its own provenance.
    expect(message).toBe(
      "no response headers within 2500 ms (transient-guard retry after: no response headers within 2500 ms)",
    );
  }, 10_000);
});

// ── calendar fixtures ────────────────────────────────────────────────────────

const event = (over: Partial<EconomicEvent>): EconomicEvent => ({
  id: over.id ?? "evt",
  event: over.event ?? "Interest Rate Decision",
  category: over.category ?? "Interest Rate",
  country: over.country ?? "Euro Area",
  currency: over.currency ?? "EUR",
  datetime: over.datetime ?? Date.now() - 5 * 24 * 60 * 60 * 1000,
  importance: over.importance ?? 3,
  source: over.source ?? "TickAtlas",
  status: over.status ?? "released",
  ...over,
});

const calendarWith = (events: EconomicEvent[]): EconomicCalendarData => ({
  provider: "tickatlas",
  events,
  macroRisk: { level: "low", explanation: "no high-impact events in the forward window", highImpact24h: 0, highImpact72h: 0 },
  confidence: "medium",
  availability: { upcoming24h: false, upcoming72h: false, recentReleased: events.some((e) => e.status === "released") },
  fetchedAt: Date.now(),
  freshness: "observed-now",
} as unknown as EconomicCalendarData);

describe("phase305 · 2 — released measurements make the fundamental; events never do", () => {
  it("released policy-rate + CPI prints inside the 40-day lookback produce an AVAILABLE assessment with verbatim provenance", () => {
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith([
        event({
          id: "ecb-1",
          event: "ECB Interest Rate Decision",
          currency: "EUR",
          category: "Interest Rate",
          datetime: Date.now() - 20 * 24 * 60 * 60 * 1000,
          actual: 2.15,
          previous: 2.4,
          referencePeriod: "Aug 2026",
          status: "released",
        }),
        event({
          id: "cpi-eu-1",
          event: "CPI (YoY)",
          currency: "EUR",
          category: "Inflation",
          datetime: Date.now() - 12 * 24 * 60 * 60 * 1000,
          actual: 2.1,
          forecast: 2.2,
          previous: 2.0,
          referencePeriod: "Sep 2026",
          status: "released",
        }),
        event({
          id: "cpi-us-1",
          event: "CPI (YoY)",
          currency: "USD",
          category: "Inflation",
          datetime: Date.now() - 10 * 24 * 60 * 60 * 1000,
          actual: 3.0,
          forecast: 2.9,
          previous: 2.9,
          referencePeriod: "Sep 2026",
          status: "released",
        }),
      ]),
    });
    expect(assessment.available).toBe(true);
    const dims = assessment.dimensions.filter((d) => d.status !== "unavailable").map((d) => d.name);
    expect(dims).toContain("policy-rates");
    expect(dims).toContain("inflation");
    // provenance is verbatim: the released read names its values, source and instant
    const prose = JSON.stringify(assessment.dimensions);
    expect(prose).toContain("actual");
    expect(prose).toContain("released");
    expect(prose).toContain("TickAtlas");
  });

  it("a calendar with ONLY upcoming high-impact events cannot make the fundamental available", () => {
    const assessment = assessForexFundamentals({
      instrument: "EUR/USD",
      provider: "twelve-data",
      providerInstrumentId: "EUR/USD",
      calendar: calendarWith([
        event({
          id: "cpi-future",
          event: "CPI (YoY)",
          currency: "EUR",
          category: "Inflation",
          datetime: Date.now() + 6 * 60 * 60 * 1000,
          forecast: 2.2,
          status: "upcoming",
          importance: 3,
        }),
        event({
          id: "nfp-future",
          event: "Nonfarm Payrolls",
          currency: "USD",
          category: "Employment",
          datetime: Date.now() + 9 * 60 * 60 * 1000,
          forecast: 180,
          status: "upcoming",
          importance: 3,
        }),
      ]),
    });
    expect(assessment.available).toBe(false);
    expect(assessment.limitations[0]).toContain(
      "No released macroeconomic measurement was supplied for EUR or USD",
    );
    // the events are not lost — they are informational risk context, never a measurement
    expect(JSON.stringify(assessment)).not.toContain('"available":true');
  });

  it("the acquisition now reaches a full decision cycle, still provider-verbatim only", () => {
    const source = read("src/convex/tradingEconomics.ts");
    expect(source).toContain("CALENDAR_RELEASED_LOOKBACK_DAYS = 40");
    expect(source).toContain("RELEASED_MERGE_MIN_IMPORTANCE = 2");
    expect(source).toContain("lookbackMs = CALENDAR_RELEASED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000");
    // the merged released events still require the provider's OWN actual value
    expect(source).toContain("norm.actual !== undefined");
    // macro risk stays a FORWARD-LOOKING measure of upcoming events
    expect(source).toContain("calculateMacroRisk(events)");
  });
});

describe("phase305 · 3 — counted technical strikes (base AND quote) steer later picks", () => {
  const okxPool = [
    { instId: "BTC-PLN", assetClass: "crypto" },
    { instId: "ETH-PLN", assetClass: "crypto" },
    { instId: "USDC-PLN", assetClass: "crypto" },
    { instId: "USDT-SGD", assetClass: "crypto" },
    { instId: "USDC-SGD", assetClass: "crypto" },
    { instId: "USDG-SGD", assetClass: "crypto" },
    { instId: "ETH-USD", assetClass: "crypto" },
    { instId: "SOL-USDT", assetClass: "crypto" },
    { instId: "XRP-USDT", assetClass: "crypto" },
  ];
  const ctx = { provider: "okx", assetClass: "crypto" };
  const TECH_REASON =
    "market evidence is real but technical/unified evidence is not available — Technical evidence unavailable";

  it("the live failure sequence accumulates strikes on base families AND the thin quote", () => {
    const strikes = new Map<string, number>();
    for (const instrument of ["BTC-PLN", "ETH-PLN", "USDC-PLN", "USDT-SGD"]) {
      const observed = observeAttemptOutcome({
        providerInstrumentId: instrument,
        assetClass: "crypto",
        verdictReason: TECH_REASON,
      });
      expect(observed.technicallyInsufficientFamily).toBeTruthy();
      expect(observed.technicallyInsufficientQuote).toBeTruthy();
      strikes.set(`base:${observed.technicallyInsufficientFamily}`, (strikes.get(`base:${observed.technicallyInsufficientFamily}`) ?? 0) + 1);
      strikes.set(`quote:${observed.technicallyInsufficientQuote}`, (strikes.get(`quote:${observed.technicallyInsufficientQuote}`) ?? 0) + 1);
    }
    // three different base families failed through ONE thin quote (the live pattern)
    expect(strikes.get("quote:PLN")).toBe(3);
    expect(strikes.get("base:BTC")).toBe(1);
    expect(strikes.get("base:ETH")).toBe(1);
    expect(strikes.get("base:USDC")).toBe(1);
    expect(strikes.get("quote:SGD")).toBe(1);

    const ranked = rankByAnalysisEligibility(okxPool, ctx, { technicalStrikes: strikes });
    // zero-strike candidates first (deep quote currencies) in provider order:
    // ETH-USD carries its OWN strike (base:ETH from ETH-PLN's failure — the
    // learning is honest about the base family too), so the first picks are
    // the untouched SOL-USDT / XRP-USDT, then single-strike rows.
    expect(ranked.slice(0, 3).map((r) => r.instId)).toEqual(["SOL-USDT", "XRP-USDT", "USDG-SGD"]);
    expect(ranked[3].instId).toBe("ETH-USD");
    // the thrice-failed thin-quote pattern ranks last (4 strikes each)
    expect(ranked.map((r) => r.instId).slice(-3).sort()).toEqual(["BTC-PLN", "ETH-PLN", "USDC-PLN"]);
    // NOTHING was dropped — every discovered instrument stays pickable
    expect(ranked).toHaveLength(okxPool.length);
  });

  it("the phase-304 family-set behavior is preserved (USDC sink reaches ETH-USD)", () => {
    const ranked = rankByAnalysisEligibility(
      [
        { instId: "USDC-PLN", assetClass: "crypto" },
        { instId: "USDC-EUR", assetClass: "crypto" },
        { instId: "ETH-USD", assetClass: "crypto" },
      ],
      ctx,
      { technicallyInsufficientFamilies: new Set(["USDC"]) },
    );
    expect(ranked.map((r) => r.instId)).toEqual(["ETH-USD", "USDC-PLN", "USDC-EUR"]);
  });

  it("the observer names the quote only for dash-form identities", () => {
    const dash = observeAttemptOutcome({ providerInstrumentId: "ETH-PLN", assetClass: "crypto", verdictReason: TECH_REASON });
    expect(dash.technicallyInsufficientQuote).toBe("PLN");
    const slash = observeAttemptOutcome({ providerInstrumentId: "XAU/CHF", assetClass: "commodity", verdictReason: TECH_REASON });
    expect(slash.technicallyInsufficientQuote).toBeNull();
    expect(slash.technicallyInsufficientFamily).toBe("XAU");
  });

  it("the smoke accumulates and reports both strike dimensions", () => {
    const smoke = read("scripts/development-runtime-smoke.mjs");
    expect(smoke).toContain("addStrike(`base:${observed.technicallyInsufficientFamily}`)");
    expect(smoke).toContain("addStrike(`quote:${observed.technicallyInsufficientQuote}`)");
    expect(smoke).toContain("technicalStrikes: Object.fromEntries(observedTechnicalStrikes)");
    expect(smoke).toContain("technicallyInsufficientQuotes: [...observedTechnicallyInsufficientQuotes]");
  });
});
