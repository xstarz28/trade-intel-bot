/**
 * Phase 289 — the EIA/WPSR live path: the request contract and the evidence.
 *
 * ROOT CAUSE THIS FILE PINS (proven live, smoke run 36210208186)
 * -------------------------------------------------------------
 * The product called `https://api.eia.gov/v2/petroleum/sto/data/` with
 * `facets[process][]=STA` and `facets[area][]=NUS-Z00`. `/petroleum/sto` is not
 * a valid APIv2 path — the live API answers
 *
 *   {"error":"Requested path /petroleum/sto is not valid.","code":400}
 *
 * — and `area` is not a facet of the weekly-stocks dataset (`duoarea` is).
 * Every leg therefore failed as a non-2xx transport fault BEFORE any parse,
 * credential check, instrument mapping or dimension logic. The wave raised
 * "every leg failed (…)", the action returned `success:false`, and the optional
 * slow-lane contract attached nothing — so the assessment reported
 * `inventories: unavailable`, no provider reading and zero EIA evidence, for
 * every instrument.
 *
 * The corrected request (each facet verified against the live API) is
 *
 *   GET /v2/petroleum/stoc/wstk/data/
 *     ?data[0]=value&facets[product][]=<EPC0|EPM0|EPD0>
 *     &facets[process][]=<SAX|SAE>&facets[duoarea][]=NUS&…&length=12
 *
 * with crude quoted EXCLUDING SPR (SAX — the headline U.S. series WCESTUS1) and
 * gasoline / distillate as total ending stocks (SAE).
 *
 * WHAT THIS SUITE PROVES
 * ----------------------
 *  A. the request contract each leg issues (route + facets), and that the
 *     pre-fix path can never be requested again;
 *  B. a live-shaped WPSR answer becomes provider-observation-dated series;
 *  C. a provider failure is classified, disclosed and never cached as evidence;
 *  D. an empty provider answer never becomes a fabricated series;
 *  E. on the SHIPPED flow (`runProtectedAnalysis` → optional slow lane → real
 *     `fetchEiaInventory` → `assessCommodityFundamentals`), a genuinely energy
 *     pair (`WTI/USD`) keeps its inventory evidence even when the Twelve Data
 *     market-data leg fails — market-data success is NOT a prerequisite for
 *     physical evidence, and the two legs' reasons stay separate;
 *  F. an EIA auth rejection keeps its exact reason and never fabricates a read;
 *  G. a provider-native non-energy commodity pair (`GAU/EUR`) never reads
 *     petroleum stocks, even when the EIA request itself succeeds;
 *  H. the neighbouring COT leg is unaffected.
 *
 * No production code is simulated above the network boundary: only the
 * providers' HTTP bodies are fixtures.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";

import { runProtectedAnalysis } from "./protectedAnalysis";
import { fetchMarketData, fetchFxRate } from "./marketData";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { fetchCotPositioning } from "./cot";
import { fetchEiaInventory } from "./eia";
import { fetchTreasuryYields } from "./treasury";
import { fetchOkxOrderBook, fetchOkxInstrumentSpec } from "./okx";
import { getProviderCache, resetProviderCache } from "../lib/data/provider-cache-registry";

import type { FundamentalAssessment } from "../lib/fundamental-engine";
import type { LegDiagnostic } from "../lib/data/provenance-diagnostics";

// ─────────────────────────────────────────────────────────────────
// Fixtures — the ONLY non-production layer (provider HTTP bodies)
// ─────────────────────────────────────────────────────────────────

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

/** The period the first (newest) observation of every leg carries. */
const NEWEST_PERIOD = isoDay(-4);

interface LegSpec {
  product: string;
  productName: string;
  process: string;
  processName: string;
  series: string;
  /** Newest → oldest; a declining series is a draw (tightening). */
  values: number[];
}

/** Shapes taken from the live /petroleum/stoc/wstk answer (values are strings). */
const LEGS: LegSpec[] = [
  {
    product: "EPC0",
    productName: "Crude Oil",
    process: "SAX",
    processName: "Ending Stocks Excluding SPR",
    series: "WCESTUS1",
    values: [412_500, 415_100, 417_200, 419_000, 420_800, 422_600, 424_400, 426_200, 428_000, 429_800, 431_600, 433_400],
  },
  {
    product: "EPM0",
    productName: "Total Gasoline",
    process: "SAE",
    processName: "Ending Stocks",
    series: "WGTSTUS1",
    values: [206_046, 207_732, 208_100, 209_400, 210_200, 211_000, 212_100, 213_200, 214_300, 215_400, 216_500, 217_600],
  },
  {
    product: "EPD0",
    productName: "Distillate Fuel Oil",
    process: "SAE",
    processName: "Ending Stocks",
    series: "WDISTUS1",
    values: [107_431, 107_859, 108_400, 109_100, 110_200, 111_300, 112_400, 113_500, 114_600, 115_700, 116_800, 117_900],
  },
];

function legBody(spec: LegSpec): unknown {
  return {
    response: {
      total: spec.values.length,
      dateFormat: "YYYY-MM-DD",
      frequency: "weekly",
      data: spec.values.map((value, i) => ({
        period: isoDay(-(4 + i * 7)),
        duoarea: "NUS",
        "area-name": "U.S.",
        product: spec.product,
        "product-name": spec.productName,
        process: spec.process,
        "process-name": spec.processName,
        series: spec.series,
        "series-description": `U.S. ${spec.processName} of ${spec.productName} (Thousand Barrels)`,
        value: String(value),
        units: "MBBL",
      })),
    },
    request: { command: "/v2/petroleum/stoc/wstk/data/" },
    apiVersion: "2.1.14",
  };
}

function bodyForEiaUrl(url: string): unknown {
  const product = new URL(url).searchParams.get("facets[product][]");
  const spec = LEGS.find((l) => l.product === product);
  expect(spec, `fixture covers every requested product (got ${product})`).toBeTruthy();
  return legBody(spec as LegSpec);
}

function cotRows(net: number) {
  const long = 150_000 + net / 2;
  const short = 150_000 - net / 2;
  return [
    {
      report_date_as_yyyy_mm_dd: isoDay(-5),
      noncomm_positions_long_all: String(long),
      noncomm_positions_short_all: String(short),
      open_interest_all: "500000",
    },
    {
      report_date_as_yyyy_mm_dd: isoDay(-12),
      noncomm_positions_long_all: String(long - 15_000),
      noncomm_positions_short_all: String(short + 5_000),
      open_interest_all: "480000",
    },
  ];
}

// ─────────────────────────────────────────────────────────────────
// Harness
// ─────────────────────────────────────────────────────────────────

type EiaMode = "wpsr" | "auth-error" | "path-error" | "empty";

/** Every provider request actually issued during the run. */
let requestedUrls: string[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? "OK" : `status-${status}`,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

/**
 * The single stubbed network boundary.
 *
 * `eia` selects what the REAL EIA route answers. `marketData` is deliberately
 * the live Grow/Venture-plan rejection: the shipped Twelve Data account cannot
 * serve the commodity OHLCV endpoint, and physical evidence must not depend on
 * it. COT answers with real-shaped rows so the neighbouring leg stays intact.
 */
function installNetwork(eia: EiaMode, marketData: "reject" | "empty" = "reject"): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String((input as Request)?.url ?? input);
      requestedUrls.push(url);

      if (url.includes("api.eia.gov")) {
        if (eia === "auth-error") return jsonResponse(403, { error: "Invalid api_key supplied" });
        if (eia === "path-error") {
          return jsonResponse(400, { error: "Requested path /petroleum/sto is not valid.", code: 400 });
        }
        if (eia === "empty") return jsonResponse(200, { response: { total: 0, data: [] } });
        return jsonResponse(200, bodyForEiaUrl(url));
      }
      if (url.includes("api.twelvedata.com")) {
        return marketData === "reject"
          ? jsonResponse(404, {
              code: 404,
              status: "error",
              message: "This endpoint is available starting with the Grow or Venture plan",
            })
          : jsonResponse(200, { data: [] });
      }
      if (url.includes("publicreporting.cftc.gov")) return jsonResponse(200, cotRows(130_000));
      if (url.includes("home.treasury.gov")) return jsonResponse(500, { error: "not used in this suite" });
      if (url.includes("alphavantage.co")) return jsonResponse(200, { Note: "no payload in this suite" });
      if (url.includes("tickatlas.com")) return jsonResponse(200, { data: [] });
      return jsonResponse(200, {});
    }),
  );
}

type ProtectedResponse = {
  status: string;
  result?: {
    instrument?: string;
    providerInstrumentId?: string;
    eiaContext?: {
      available?: boolean;
      source?: string;
      freshness?: string;
      series?: { productId: string; observationDate: string; latestValue: number; unit?: string }[];
    };
    fundamentalAssessment?: FundamentalAssessment;
    providerDiagnostics?: LegDiagnostic[];
  };
};

function testCtx(subject = "user_phase289_eia") {
  return {
    auth: { getUserIdentity: async () => ({ subject, issuer: "test" }) },
    runMutation: async (ref: unknown) => {
      const name = getFunctionName(ref as never);
      if (name === "protectedAnalysis:resolveAndConsume") {
        return {
          allowed: true,
          plan: "pro",
          remaining: 5,
          charged: true,
          upgradeRequired: false,
          reason: "test entitlement",
        };
      }
      return "user_stub";
    },
    runQuery: async () => null,
    runAction: async (ref: unknown, args: unknown) => {
      let name = "";
      try {
        name = getFunctionName(ref as never);
      } catch {
        return { success: false, error: "unknown leg in this test" };
      }
      const handler = REAL_HANDLERS[name];
      if (!handler) return { success: false, error: `leg ${name} not wired in this test` };
      return handler(testCtxForLeg() as never, args as never);
    },
  };
}

function testCtxForLeg() {
  return { auth: { getUserIdentity: async () => ({ subject: "user_phase289_eia", issuer: "test" }) } };
}

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

const REAL_HANDLERS: Record<string, (c: never, a: never) => Promise<unknown>> = {
  "marketData:fetchMarketData": handlerOf(fetchMarketData) as never,
  "marketData:fetchFxRate": handlerOf(fetchFxRate) as never,
  "alphaVantage:fetchIntelligence": handlerOf(fetchIntelligence) as never,
  "coinglass:fetchDerivatives": handlerOf(fetchDerivatives) as never,
  "tradingEconomics:fetchCalendar": handlerOf(fetchCalendar) as never,
  "cot:fetchCotPositioning": handlerOf(fetchCotPositioning) as never,
  "eia:fetchEiaInventory": handlerOf(fetchEiaInventory) as never,
  "treasury:fetchTreasuryYields": handlerOf(fetchTreasuryYields) as never,
  "okx:fetchOkxOrderBook": handlerOf(fetchOkxOrderBook) as never,
  "okx:fetchOkxInstrumentSpec": handlerOf(fetchOkxInstrumentSpec) as never,
};

const runProtected = handlerOf<{ input: Record<string, unknown> }, ProtectedResponse>(runProtectedAnalysis);

async function analyze(input: Record<string, unknown>): Promise<ProtectedResponse> {
  return runProtected(testCtx() as never, { input });
}

function fundamentalOf(res: ProtectedResponse): FundamentalAssessment {
  const fa = res.result?.fundamentalAssessment;
  expect(fa, "the flow must deliver a fundamental assessment").toBeTruthy();
  return fa as FundamentalAssessment;
}

const dim = (fa: FundamentalAssessment, name: string) => {
  const d = fa.dimensions.find((x) => x.name === name);
  expect(d, `dimension ${name}`).toBeTruthy();
  return d as NonNullable<typeof d>;
};

const eiaItems = (fa: FundamentalAssessment) =>
  fa.evidence.filter((e) => /EIA|Energy Information Administration/i.test(e.provider));

const commodityInput = (instrument: string) => ({
  instrument,
  instrumentType: "commodity",
  timeframe: "D1",
  tradingStyle: "intraday",
  provider: "twelve-data",
  providerInstrumentId: instrument,
});

beforeEach(() => {
  resetProviderCache();
  requestedUrls = [];
  process.env.EIA_API_KEY = "test-key";
  // The live deployment HAS a Twelve Data key; its commodity OHLCV endpoint is
  // what answers 404 (plan limitation). The stub network reproduces that so the
  // market-data leg fails at the PROVIDER, exactly as the live smoke did —
  // not at a local "not configured" guard.
  process.env.TWELVE_DATA_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
  delete process.env.EIA_API_KEY;
  delete process.env.TWELVE_DATA_API_KEY;
});

// ═════════════════════════════════════════════════════════════════
// A–D. The request contract, against the REAL eia action
// ═════════════════════════════════════════════════════════════════

type EiaEnvelope = {
  success: boolean;
  error?: string;
  errorCode?: string;
  acquisition?: string;
  data?: {
    available: boolean;
    source: string;
    freshness: string;
    series: { productId: string; observationDate: string; latestValue: number; unit?: string }[];
    failedLegs: { productId: string; reason: string }[];
  };
};

const eiaAction = handlerOf<Record<string, never>, EiaEnvelope>(fetchEiaInventory);
const eiaCtx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } } as never;
const EIA_CACHE_KEY = { provider: "eia", dataset: "eia", qualifier: "EPC0,EPM0,EPD0" } as const;

const legPairs = (urls: string[]) =>
  urls.map((u) => {
    const q = new URL(u).searchParams;
    return `${q.get("facets[product][]")}/${q.get("facets[process][]")}`;
  });

describe("289 (A) — every leg calls the valid weekly-stocks route with its real facets", () => {
  it("requests /v2/petroleum/stoc/wstk/data with product+process+duoarea, never the pre-fix path", async () => {
    installNetwork("wpsr");
    const r = await eiaAction(eiaCtx, {});

    expect(r.success).toBe(true);
    expect(requestedUrls).toHaveLength(3);
    for (const url of requestedUrls) {
      expect(url).toContain("https://api.eia.gov/v2/petroleum/stoc/wstk/data/");
      // The pre-fix defects can never come back: the invalid path, the
      // non-existent `area` facet and the `STA` process code.
      expect(url).not.toContain("/v2/petroleum/sto/data");
      expect(url).not.toMatch(/petroleum\/sto\/data/);
      expect(url).not.toContain("facets%5Barea%5D");
      expect(url).not.toContain("facets%5Bprocess%5D%5B%5D=STA");
      expect(url).toContain("facets%5Bduoarea%5D%5B%5D=NUS");
      expect(url).toContain("frequency=weekly");
      expect(url).toContain("sort%5B0%5D%5Bcolumn%5D=period");
    }
    expect(legPairs(requestedUrls).sort()).toEqual(["EPC0/SAX", "EPD0/SAE", "EPM0/SAE"]);
  });

  it("parses the live-shaped answer into provider-observation-dated series", async () => {
    installNetwork("wpsr");
    const r = await eiaAction(eiaCtx, {});

    expect(r.success).toBe(true);
    expect(r.acquisition).toBe("observed-now");
    expect(r.data?.available).toBe(true);
    expect(r.data?.source).toMatch(/Energy Information Administration/);
    expect(r.data?.freshness).toBe("FRESH");
    expect(r.data?.failedLegs).toEqual([]);
    const crude = r.data?.series.find((s) => s.productId === "EPC0");
    expect(crude?.observationDate).toBe(NEWEST_PERIOD);
    expect(crude?.latestValue).toBe(412_500);
    expect(crude?.unit).toBe("MBBL");
    // Only real provider observations land in the context.
    expect(r.data?.series.map((s) => s.productId).sort()).toEqual(["EPC0", "EPD0", "EPM0"]);
    expect(getProviderCache().peek(EIA_CACHE_KEY)).not.toBeNull();
  });

  it("a non-2xx provider answer is classified and NOT cached as evidence", async () => {
    installNetwork("path-error");
    const r = await eiaAction(eiaCtx, {});

    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error ?? "").toMatch(/EIA request failed:/);
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(EIA_CACHE_KEY)).toBeNull();
  });

  it("an EIA auth rejection is AUTH_ERROR, disclosed and uncached", async () => {
    installNetwork("auth-error");
    const r = await eiaAction(eiaCtx, {});

    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(r.error ?? "").toMatch(/key rejected/i);
    expect(r.data).toBeUndefined();
    expect(getProviderCache().peek(EIA_CACHE_KEY)).toBeNull();
  });

  it("an empty-but-valid answer never becomes a fabricated series", async () => {
    installNetwork("empty");
    const r = await eiaAction(eiaCtx, {});

    expect(r.success).toBe(false);
    expect(r.data).toBeUndefined();
    expect(r.error ?? "").toMatch(/No EIA inventory series available|no usable observation/i);
  });
});

// ═════════════════════════════════════════════════════════════════
// E–H. The shipped flow: physical evidence vs market data
// ═════════════════════════════════════════════════════════════════

describe("289 (E) — WTI/USD keeps its inventory evidence when the market-data leg fails", () => {
  it("delivers EIA evidence, provider period and provenance with market data down", async () => {
    installNetwork("wpsr");
    const res = await analyze(commodityInput("WTI/USD"));
    const r = res.result!;

    expect(r.instrument).toBe("WTI/USD");
    expect(r.providerInstrumentId).toBe("WTI/USD");

    const fa = fundamentalOf(res);
    expect(fa.domain).toBe("commodity");
    // Phase 289 product fix stays: the effective profile of WTI/USD is energy.
    expect(fa.commodityProfile?.group).toBe("energy");
    expect(dim(fa, "inventories").status).toBe("positive");
    expect(dim(fa, "inventories").evidence ?? "").toMatch(/EIA|Weekly Petroleum|stocks/i);
    expect(fa.reportingPeriod).toBe(NEWEST_PERIOD);
    expect(fa.commodityMetrics?.inventoryLatest).toBe(412_500);

    // Every EIA evidence item keeps the provider's own identity + period and is
    // sourced from the corrected route — never presented as a live price.
    const items = eiaItems(fa);
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.providerInstrumentId).toBe("WTI/USD");
      expect(item.source).toMatch(/petroleum\/stoc\/wstk|WPSR|Weekly Petroleum/i);
    }
    expect(items.some((i) => i.period === NEWEST_PERIOD)).toBe(true);

    // Engine-bound context: real source, real observation date, real unit.
    const ctx = r.eiaContext!;
    expect(ctx.available).toBe(true);
    expect(ctx.source).toMatch(/Energy Information Administration/);
    expect(ctx.series?.[0].observationDate).toBe(NEWEST_PERIOD);
    expect(ctx.series?.[0].unit).toBe("MBBL");

    // Independence is provable per leg: EIA attached+used, market data not.
    const diags = r.providerDiagnostics ?? [];
    const eiaDiag = diags.find((d) => d.provider === "eia");
    const mdDiag = diags.find((d) => /market-data|twelve/i.test(d.provider));
    expect(eiaDiag?.attached).toBe(true);
    expect(eiaDiag?.usedByEngine).toBe(true);
    expect(mdDiag).toBeTruthy();
    expect(mdDiag?.attached).not.toBe(true);
    expect(mdDiag?.reason ?? "").toMatch(/Grow|Venture|404/i);

    // Requests went to the corrected route.
    const eiaUrls = requestedUrls.filter((u) => u.includes("api.eia.gov"));
    expect(eiaUrls.length).toBe(3);
    for (const u of eiaUrls) expect(u).toContain("/v2/petroleum/stoc/wstk/data/");
  });

  it("(H) the neighbouring COT leg is unaffected and names the exact WTI contract", async () => {
    installNetwork("wpsr");
    const res = await analyze(commodityInput("WTI/USD"));

    const diags = res.result?.providerDiagnostics ?? [];
    const cotDiag = diags.find((d) => d.provider === "cftc");
    expect(cotDiag?.attached).toBe(true);
    expect(cotDiag?.usedByEngine).toBe(true);
    expect(
      requestedUrls.some(
        (u) => u.includes("publicreporting.cftc.gov") && decodeURIComponent(u).includes("WTI FINANCIAL CRUDE OIL"),
      ),
    ).toBe(true);
  });
});

describe("289 (F) — an EIA failure keeps its EXACT reason and fabricates nothing", () => {
  it("auth rejection: no eiaContext, no EIA evidence, reason preserved", async () => {
    installNetwork("auth-error");
    const res = await analyze(commodityInput("WTI/USD"));

    const fa = fundamentalOf(res);
    expect(dim(fa, "inventories").status).toBe("unavailable");
    expect(eiaItems(fa)).toEqual([]);
    expect(fa.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(res.result?.eiaContext).toBeUndefined();

    const diags = res.result?.providerDiagnostics ?? [];
    const eiaDiag = diags.find((d) => d.provider === "eia");
    expect(eiaDiag?.attached).not.toBe(true);
    expect(eiaDiag?.reason ?? "").toMatch(/AUTH_ERROR|key rejected/i);
    // The market-data leg keeps ITS OWN reason — the two failures never blend.
    const mdDiag = diags.find((d) => /market-data|twelve/i.test(d.provider));
    expect(mdDiag?.reason ?? "").toMatch(/Grow|Venture|404/i);
    expect(diags.filter((d) => d.reason).length).toBeGreaterThanOrEqual(2);
  });

  it("the pre-fix route failure is disclosed as a provider fault, never as evidence", async () => {
    installNetwork("path-error");
    const res = await analyze(commodityInput("WTI/USD"));

    const fa = fundamentalOf(res);
    expect(dim(fa, "inventories").status).toBe("unavailable");
    expect(eiaItems(fa)).toEqual([]);
    expect(res.result?.eiaContext).toBeUndefined();
    const eiaDiag = (res.result?.providerDiagnostics ?? []).find((d) => d.provider === "eia");
    expect(eiaDiag?.reason ?? "").toMatch(/not valid|API_UNAVAILABLE|EIA request failed/i);
  });

  it("an empty provider answer is reported, not promoted to a reading", async () => {
    installNetwork("empty");
    const res = await analyze(commodityInput("WTI/USD"));

    const fa = fundamentalOf(res);
    expect(dim(fa, "inventories").status).toBe("unavailable");
    expect(eiaItems(fa)).toEqual([]);
    expect(fa.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(res.result?.eiaContext).toBeUndefined();
    const eiaDiag = (res.result?.providerDiagnostics ?? []).find((d) => d.provider === "eia");
    expect(eiaDiag?.reason ?? "").toMatch(/No EIA inventory series available|no usable observation|no data/i);
  });
});

describe("289 (G) — a non-energy commodity pair never reads petroleum stocks", () => {
  it("GAU/EUR: the EIA request may answer, the assessment never consumes it", async () => {
    installNetwork("wpsr");
    const res = await analyze(commodityInput("GAU/EUR"));

    const fa = fundamentalOf(res);
    expect(fa.domain).toBe("commodity");
    expect(fa.commodityProfile?.group).not.toBe("energy");
    expect(dim(fa, "inventories").status).toBe("unavailable");
    expect(eiaItems(fa)).toEqual([]);
    expect(fa.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(fa.limitations.join(" ")).toMatch(/petroleum|energy/i);
  });
});
