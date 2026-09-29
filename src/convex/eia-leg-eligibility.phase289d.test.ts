/**
 * Phase 289D — the EIA leg's eligibility and the wiring of its outcome.
 *
 * WHY THIS EXISTS
 * ---------------
 * The deployed WTI/USD run reported `inventories=unavailable inventoryLatest=none
 * eiaEvidence=0` while the pair was correctly classified `energy`. The audit had
 * to separate four different worlds that all produce that line: an instrument
 * that is not eligible for the leg, a credential that is absent, a credential
 * that is rejected, and a provider answer that carries no observation. These
 * tests pin the first world STRUCTURALLY (the shipped eligibility predicate, fed
 * with the exact facts the smoke harness sends) and the remaining ones through
 * the SHIPPED protected-analysis flow, where the leg's own classified reason has
 * to survive all the way into the runtime diagnostics.
 *
 * Nothing here substitutes providers or symbols: the real `fetchEiaInventory`
 * action runs, behind a stubbed network boundary, and the real policy module
 * decides whether the leg is scheduled at all.
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
import { fetchOptionalSlowData } from "../lib/data/optional-providers";
import { buildAnalysisInput } from "../../scripts/development-runtime-smoke.mjs";
import { eiaLegDigest, readResultEvidence } from "../../scripts/development-runtime-smoke.mjs";

import type { EiaContext, EiaData } from "../lib/data/eia";
import type { FundamentalAssessment } from "../lib/fundamental-engine";

const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const NEWEST_PERIOD = isoDay(-4);

// ─────────────────────────────────────────────────────────────────
// Fixtures — provider bodies only, never a production-path stub
// ─────────────────────────────────────────────────────────────────

interface LegSpec {
  product: string;
  productName: string;
  process: string;
  series: string;
  values: number[];
}

const LEGS: LegSpec[] = [
  { product: "EPC0", productName: "Crude Oil", process: "SAX", series: "WCESTUS1", values: [412_500, 415_100, 417_200, 419_000] },
  { product: "EPM0", productName: "Total Gasoline", process: "SAE", series: "WGTSTUS1", values: [206_046, 207_732, 208_100, 209_400] },
  { product: "EPD0", productName: "Distillate Fuel Oil", process: "SAE", series: "WDISTUS1", values: [107_431, 107_859, 108_400, 109_100] },
];

function legBody(spec: LegSpec): unknown {
  return {
    response: {
      total: spec.values.length,
      data: spec.values.map((value, i) => ({
        period: isoDay(-(4 + i * 7)),
        duoarea: "NUS",
        "area-name": "U.S.",
        product: spec.product,
        "product-name": spec.productName,
        process: spec.process,
        "process-name": "Ending Stocks",
        series: spec.series,
        value: String(value),
        units: "MBBL",
      })),
    },
    request: { command: "/v2/petroleum/stoc/wstk/data/" },
    apiVersion: "2.1.14",
  };
}

type EiaMode = "wpsr" | "auth-error" | "empty";

let requestedUrls: string[] = [];

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `status-${status}`,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function installNetwork(eia: EiaMode): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String((input as Request)?.url ?? input);
      requestedUrls.push(url);
      if (url.includes("api.eia.gov")) {
        if (eia === "auth-error") return jsonResponse(403, { error: "Invalid api_key supplied" });
        if (eia === "empty") return jsonResponse(200, { response: { total: 0, data: [] } });
        const product = new URL(url).searchParams.get("facets[product][]");
        const spec = LEGS.find((l) => l.product === product) ?? LEGS[0];
        return jsonResponse(200, legBody(spec));
      }
      if (url.includes("api.twelvedata.com")) {
        return jsonResponse(404, { code: 404, status: "error", message: "Grow or Venture plan required" });
      }
      if (url.includes("publicreporting.cftc.gov")) {
        return jsonResponse(200, [
          {
            report_date_as_yyyy_mm_dd: isoDay(-5),
            noncomm_positions_long_all: "215000",
            noncomm_positions_short_all: "85000",
            open_interest_all: "500000",
          },
        ]);
      }
      return jsonResponse(500, { error: "not used in this suite" });
    }),
  );
}

// ─────────────────────────────────────────────────────────────────
// The shipped flow — real handlers, one stubbed network boundary
// ─────────────────────────────────────────────────────────────────

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

function testCtx() {
  return {
    auth: { getUserIdentity: async () => ({ subject: "user_phase289d", issuer: "test" }) },
    runMutation: async (ref: unknown) =>
      getFunctionName(ref as never) === "protectedAnalysis:resolveAndConsume"
        ? { allowed: true, plan: "pro", remaining: 5, charged: true, upgradeRequired: false, reason: "test" }
        : "user_stub",
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
      return handler(testCtx() as never, args as never);
    },
  };
}

type ProtectedResponse = {
  status: string;
  result?: {
    instrument?: string;
    providerInstrumentId?: string;
    eiaContext?: { available?: boolean; source?: string; series?: { productId: string; observationDate: string; latestValue: number; unit?: string }[] };
    fundamentalAssessment?: FundamentalAssessment;
    providerDiagnostics?: { provider: string; dataset?: string; mode?: string; acquired?: boolean; attached?: boolean; usedByEngine?: boolean; reason?: string }[];
    decisionTrace?: {
      provenance?: { provider: string; available?: boolean; observationDate?: string; failureReason?: string }[];
    };
  };
};

const runProtected = handlerOf<{ input: Record<string, unknown> }, ProtectedResponse>(runProtectedAnalysis);

async function analyze(instrument: string): Promise<ProtectedResponse> {
  return runProtected(testCtx() as never, {
    input: {
      instrument,
      instrumentType: "commodity",
      timeframe: "D1",
      tradingStyle: "intraday",
      provider: "twelve-data",
      providerInstrumentId: instrument,
    },
  });
}

const dim = (fa: FundamentalAssessment, name: string) => {
  const d = fa.dimensions.find((x) => x.name === name);
  expect(d, `dimension ${name}`).toBeTruthy();
  return d as NonNullable<typeof d>;
};
const faOf = (res: ProtectedResponse) => {
  const fa = res.result?.fundamentalAssessment;
  expect(fa, "the flow must deliver a fundamental assessment").toBeTruthy();
  return fa as FundamentalAssessment;
};
const eiaDiag = (res: ProtectedResponse) =>
  (res.result?.providerDiagnostics ?? []).find((d) => d.provider === "eia") ?? null;

beforeEach(() => {
  resetProviderCache();
  requestedUrls = [];
  process.env.EIA_API_KEY = "test-key";
  process.env.TWELVE_DATA_API_KEY = "test-key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
  delete process.env.EIA_API_KEY;
  delete process.env.TWELVE_DATA_API_KEY;
});

// ═════════════════════════════════════════════════════════════════
// 1–2. Eligibility, proved with the SHIPPED predicate and the
//      harness's OWN input builder (no local re-implementation)
// ═════════════════════════════════════════════════════════════════

describe("289D — EIA leg eligibility", () => {
  it("the smoke's own WTI/USD input schedules the leg (commodity + oil + intraday)", async () => {
    // The exact input the deployed run posted: built by the harness function.
    const built = buildAnalysisInput(
      { discovery: "twelve-data", assetClass: "commodity", domain: "commodity", label: "COMMODITY" },
      { providerInstrumentId: "WTI/USD", provider: "twelve-data" },
    ) as { input: Record<string, unknown> };

    expect(built.input.instrument).toBe("WTI/USD");
    expect(built.input.instrumentType).toBe("commodity");
    expect(built.input.tradingStyle).toBe("intraday");

    const context: EiaData = {
      available: true,
      source: "U.S. Energy Information Administration (Weekly Petroleum Status Report)",
      fetchedAt: Date.now(),
      freshness: "FRESH",
      series: [
        {
          productId: "EPC0",
          productName: "Crude Oil",
          observationDate: NEWEST_PERIOD,
          latestValue: 412_500,
          unit: "MBBL",
        },
      ],
      failedLegs: [],
    } as unknown as EiaContext as unknown as EiaData;

    const eia = vi.fn(async () => ({ success: true, data: context }));
    const result = await fetchOptionalSlowData(
      {
        instrumentType: built.input.instrumentType as "commodity",
        instrument: built.input.instrument as string,
        tradingStyle: built.input.tradingStyle as string,
        hasCompleteSpec: false,
      },
      { eia },
    );

    expect(eia).toHaveBeenCalledTimes(1);
    expect(result.eiaData).toBe(context);
  });

  it("scalping stays ineligible — the non-scalping rule is not relaxed", async () => {
    const eia = vi.fn(async () => ({ success: true, data: { available: true } as unknown as EiaData }));
    const cot = vi.fn(async () => ({ success: true, data: undefined }));
    const result = await fetchOptionalSlowData(
      { instrumentType: "commodity", instrument: "WTI/USD", tradingStyle: "scalping", hasCompleteSpec: false },
      { eia, cot },
    );

    expect(eia).not.toHaveBeenCalled();
    expect(cot).not.toHaveBeenCalled();
    expect(result.eiaData).toBeUndefined();
  });

  it("a non-oil commodity is ineligible — no symbol whitelist is involved", async () => {
    const eia = vi.fn(async () => ({ success: true, data: { available: true } as unknown as EiaData }));
    const result = await fetchOptionalSlowData(
      { instrumentType: "commodity", instrument: "GAU/EUR", tradingStyle: "intraday", hasCompleteSpec: false },
      { eia },
    );

    expect(eia).not.toHaveBeenCalled();
    expect(result.eiaData).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════
// 3–4. The runtime branches, at the ACTION level
// ═════════════════════════════════════════════════════════════════

type EiaEnvelope = { success: boolean; error?: string; errorCode?: string; data?: { available: boolean } };

const eiaAction = handlerOf<Record<string, never>, EiaEnvelope>(fetchEiaInventory);
const eiaCtx = { auth: { getUserIdentity: async () => ({ subject: "u", issuer: "t" }) } } as never;
const EIA_KEY = { provider: "eia", dataset: "eia", qualifier: "EPC0,EPM0,EPD0" } as const;

describe("289D — the EIA action's own runtime branches", () => {
  it("a missing EIA_API_KEY is reported as exactly that, with no request and no cache", async () => {
    installNetwork("wpsr");
    delete process.env.EIA_API_KEY;

    const r = await eiaAction(eiaCtx, {});

    expect(r.success).toBe(false);
    expect(r.error ?? "").toMatch(/EIA_API_KEY is missing/);
    expect(r.data).toBeUndefined();
    expect(requestedUrls).toEqual([]);
    expect(getProviderCache().peek(EIA_KEY)).toBeNull();
  });

  it("AUTH_ERROR is explicit, classified and uncached", async () => {
    installNetwork("auth-error");
    const r = await eiaAction(eiaCtx, {});

    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(r.error ?? "").toMatch(/key rejected/i);
    expect(requestedUrls).toHaveLength(3);
    expect(requestedUrls.every((u) => u.includes("/v2/petroleum/stoc/wstk/data/"))).toBe(true);
    expect(getProviderCache().peek(EIA_KEY)).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════
// 5–7. The shipped flow: reason preserved, evidence wired
// ═════════════════════════════════════════════════════════════════

describe("289D — the deployed flow reports the leg's own reason", () => {
  it("missing key: the reason survives into the runtime diagnostics, nothing is fabricated", async () => {
    installNetwork("wpsr");
    delete process.env.EIA_API_KEY;

    const res = await analyze("WTI/USD");
    const fa = faOf(res);

    expect(dim(fa, "inventories").status).toBe("unavailable");
    expect(fa.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(res.result?.eiaContext).toBeUndefined();
    expect(requestedUrls.filter((u) => u.includes("api.eia.gov"))).toEqual([]);

    const leg = eiaDiag(res);
    expect(leg, "the eia leg must appear in providerDiagnostics").toBeTruthy();
    // The runtime redacts credential-shaped names in its own diagnostic text.
    expect(leg?.reason ?? "").toMatch(/EIA_\[redacted\] is missing|EIA_API_KEY is missing/);
    // And the smoke's own digest — the surface the next run prints — says it.
    const digest = eiaLegDigest(readResultEvidence(res.result));
    expect(digest).toContain("eia-leg: no-evidence");
    expect(digest).toMatch(/EIA_\[redacted\] is missing|EIA_API_KEY is missing/);
  });

  it("AUTH_ERROR: the classified reason survives, uncached, distinct from other legs", async () => {
    installNetwork("auth-error");

    const res = await analyze("WTI/USD");
    const fa = faOf(res);

    expect(dim(fa, "inventories").status).toBe("unavailable");
    expect(res.result?.eiaContext).toBeUndefined();
    const leg = eiaDiag(res);
    // AUTH_ERROR semantics, in the runtime's own words.
    expect(leg?.reason ?? "").toMatch(/key rejected/i);
    expect(leg?.attached).not.toBe(true);
    expect(requestedUrls.filter((u) => u.includes("api.eia.gov"))).toHaveLength(3);
    expect(getProviderCache().peek(EIA_KEY)).toBeNull();
    const digest = eiaLegDigest(readResultEvidence(res.result));
    expect(digest).toContain("eia-leg: no-evidence");
    expect(digest).toMatch(/key rejected/i);
  });

  it("an empty provider answer is an explicit unavailable state with no fabricated value", async () => {
    installNetwork("empty");

    const res = await analyze("WTI/USD");
    const fa = faOf(res);

    expect(dim(fa, "inventories").status).toBe("unavailable");
    expect(fa.commodityMetrics?.inventoryLatest).toBeUndefined();
    expect(fa.evidence.filter((e) => /EIA|Energy Information/i.test(e.provider))).toEqual([]);
    expect(res.result?.eiaContext).toBeUndefined();
    const digest = eiaLegDigest(readResultEvidence(res.result));
    expect(digest).toContain("eia-leg: no-evidence");
    expect(digest).toMatch(/No EIA inventory series available/);
  });

  it("a successful acquisition wires through to eiaData, the engine and the provider's own period", async () => {
    installNetwork("wpsr");

    const res = await analyze("WTI/USD");
    const fa = faOf(res);

    // 1. the leg's own record: attached AND used by the engine
    const leg = eiaDiag(res);
    expect(leg?.attached).toBe(true);
    expect(leg?.usedByEngine).toBe(true);
    expect(leg?.reason ?? null).toBeNull();

    // 2. the assessment consumed a provider-derived value from the real payload
    expect(dim(fa, "inventories").status).not.toBe("unavailable");
    expect(fa.commodityMetrics?.inventoryLatest).toBe(412_500);
    expect(fa.reportingPeriod).toBe(NEWEST_PERIOD);

    // 3. the engine received the context (analysis-engine maps eiaData → eiaContext)
    expect(res.result?.eiaContext?.available).toBe(true);
    expect(res.result?.eiaContext?.series?.[0].observationDate).toBe(NEWEST_PERIOD);
    expect(res.result?.eiaContext?.series?.[0].unit).toBe("MBBL");

    // 4. the engine's own decision trace agrees: the EIA feed was AVAILABLE to
    //    the engine with the provider's own observation date (proof that the
    //    acquisition reached `eiaData`, not merely that the leg answered).
    const provenance = res.result?.decisionTrace?.provenance ?? [];
    const eiaLine = provenance.find((p) => /EIA WPSR/i.test(p.provider));
    expect(eiaLine, "the decision trace must carry the EIA WPSR provenance line").toBeTruthy();
    expect(eiaLine?.available).toBe(true);
    expect(eiaLine?.observationDate).toBe(NEWEST_PERIOD);

    // 5. and the smoke's digest reports it as CONSUMED, never as "HTTP 200"
    const digest = eiaLegDigest(readResultEvidence(res.result));
    expect(digest).toContain("eia-leg: consumed");
  });
});
