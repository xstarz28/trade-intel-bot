/**
 * Phase 274 — provider-native fundamental path, driven through the REAL
 * Alpha Vantage action handler with a stubbed `fetch`.
 *
 * This suite proves the vertical slice starts where the mission says it must:
 * a supported STOCK instrument traverses the existing provider infrastructure
 * (OVERVIEW + EARNINGS), the exact native identity is used, the fiscal
 * reporting periods survive normalization, and the deterministic fundamental
 * assessment the analysis result carries is derived from THAT evidence — with
 * an explicit unavailable state when the provider returns nothing.
 *
 * No production formula is mocked; only the HTTP transport is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { fetchIntelligence } from "./alphaVantage";
import { assessFundamentals } from "../lib/fundamental-engine";
import { runAnalysis } from "../lib/analysis-engine";
import type { IntelligenceResult } from "../lib/data/intelligence-types";

type Args = { instrument: string; instrumentType: "stock" | "forex" | "crypto" | "commodity" | "indices" };
type Handler = (ctx: unknown, args: Args) => Promise<IntelligenceResult>;
const av = (fetchIntelligence as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "user_A|sess", issuer: "t" }) } };

type Route = { status?: number; body?: unknown; throws?: unknown };
let routes: Record<string, Route> = {};
const calls: string[] = [];

const NEWS = {
  feed: [
    {
      title: "Apple reports strong quarter",
      url: "https://news/1",
      time_published: "20250731T120000",
      source: "Wire",
      ticker_sentiment: [
        { ticker: "AAPL", ticker_sentiment_score: "0.35", relevance_score: "0.9", ticker_sentiment_label: "Bullish" },
      ],
    },
  ],
};

const OVERVIEW = {
  Symbol: "AAPL",
  Name: "Apple Inc",
  Sector: "TECHNOLOGY",
  MarketCapitalization: "3000000000000",
  PERatio: "28.5",
  ForwardPE: "26.1",
  EPS: "6.42",
  ProfitMargin: "0.265",
  ReturnOnEquityTTM: "1.47",
  ReturnOnAssetsTTM: "0.22",
  PriceToBookRatio: "46.2",
  PriceToSalesRatioTTM: "7.8",
  EVToEBITDA: "22.4",
  QuarterlyRevenueGrowthYOY: "0.061",
  QuarterlyEarningsGrowthYOY: "0.078",
};

const EARNINGS = {
  quarterlyEarnings: [
    { fiscalDateEnding: "2025-06-30", reportedDate: "2025-07-31", reportedEPS: "1.65", estimatedEPS: "1.60", reportedRevenue: "94000000000" },
    { fiscalDateEnding: "2025-03-31", reportedDate: "2025-04-30", reportedEPS: "1.53", estimatedEPS: "1.50", reportedRevenue: "90000000000" },
    { fiscalDateEnding: "2024-12-31", reportedDate: "2025-01-30", reportedEPS: "1.50", estimatedEPS: "1.45", reportedRevenue: "85000000000" },
    { fiscalDateEnding: "2024-09-30", reportedDate: "2024-10-31", reportedEPS: "1.42", estimatedEPS: "1.38", reportedRevenue: "81000000000" },
    { fiscalDateEnding: "2024-06-30", reportedDate: "2024-08-01", reportedEPS: "1.35", estimatedEPS: "1.33", reportedRevenue: "78000000000" },
  ],
  annualEarnings: [{ fiscalDateEnding: "2024-09-30", reportedEPS: "5.55" }],
};

const ALL_OK: Record<string, Route> = {
  NEWS_SENTIMENT: { body: NEWS },
  OVERVIEW: { body: OVERVIEW },
  EARNINGS: { body: EARNINGS },
};

const AAPL: Args = { instrument: "AAPL", instrumentType: "stock" };

function routeFor(url: string): Route {
  for (const k of Object.keys(routes)) if (url.includes(k)) return routes[k];
  return { body: {} };
}

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  routes = { ...ALL_OK };
  process.env.ALPHA_VANTAGE_API_KEY = "k";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      calls.push(url);
      const r = routeFor(url);
      if (r.throws) throw r.throws;
      const status = r.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        statusText: "x",
        text: async () => "",
        json: async () => r.body,
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetProviderCache();
});

describe("274 — real provider-native fundamental request path", () => {
  it("requests OVERVIEW + EARNINGS for the exact native identity", async () => {
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    const overviewCall = calls.find((u) => u.includes("OVERVIEW"));
    const earningsCall = calls.find((u) => u.includes("EARNINGS"));
    expect(overviewCall).toBeDefined();
    expect(earningsCall).toBeDefined();
    expect(overviewCall!).toContain("symbol=AAPL");
    expect(earningsCall!).toContain("symbol=AAPL");
    expect(overviewCall!).not.toMatch(/symbol=(?!AAPL)[A-Z]/);
  });

  it("preserves provider and exact stock identity on the normalized payload", async () => {
    const r = await av(ctx, AAPL);
    const fundamentals = r.fundamentals!;
    expect(fundamentals.provider).toBe("alpha-vantage");
    expect(fundamentals.symbol).toBe("AAPL");
    expect(fundamentals.instrumentType).toBe("stock");
    expect(fundamentals.available).toBe(true);
    expect(fundamentals.name).toBe("Apple Inc");
  });

  it("preserves fiscal reporting periods and report dates from the provider", async () => {
    const r = await av(ctx, AAPL);
    const fundamentals = r.fundamentals!;
    expect(fundamentals.latestEarnings?.date).toBe("2025-06-30");
    expect(fundamentals.quarterlyEarningsHistory).toHaveLength(5);
    expect(fundamentals.quarterlyEarningsHistory![0]).toEqual({
      fiscalDateEnding: "2025-06-30",
      reportedDate: "2025-07-31",
      reportedEps: 1.65,
      estimatedEps: 1.6,
      revenue: 94_000_000_000,
    });
    expect(fundamentals.annualEarningsHistory![0].fiscalDateEnding).toBe("2024-09-30");
  });

  it("stamps the observation instant from the acquisition, not a second clock read", async () => {
    const r = await av(ctx, AAPL);
    expect(r.observedAt).toBeGreaterThan(0);
    expect(r.fundamentals!.timestamp).toBe(r.observedAt);
  });
});

describe("274 — deterministic assessment from real provider evidence", () => {
  it("derives the assessment from the handler's normalized payload", async () => {
    const r = await av(ctx, AAPL);
    const assessment = assessFundamentals(r.fundamentals);
    expect(assessment.available).toBe(true);
    expect(assessment.provider).toBe("alpha-vantage");
    expect(assessment.reportingPeriod).toBe("2025-06-30");
    expect(assessment.periodsCount).toBe(5);
    expect(assessment.metrics.epsRises).toBe(4);
    expect(assessment.metrics.estimateBeats).toBe(5);
    expect(["improving", "mixed"]).toContain(assessment.state);
  });

  it("is identical for two runs over the same cached evidence", async () => {
    const first = await av(ctx, AAPL);
    resetProviderCache();
    const second = await av(ctx, AAPL);
    expect(second.fundamentals!.quarterlyEarningsHistory).toEqual(
      first.fundamentals!.quarterlyEarningsHistory,
    );
    // Observation instants differ between acquisitions, so compare the
    // clock-free derivation of the same figures: the state and metrics.
    const a = assessFundamentals({ ...first.fundamentals!, timestamp: 0 });
    const b = assessFundamentals({ ...second.fundamentals!, timestamp: 0 });
    expect(b).toEqual(a);
  });

  it("reaches the analysis result object the UI consumes", async () => {
    const r = await av(ctx, AAPL);
    const result = runAnalysis({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "D1",
      fundamentalData: r.fundamentals,
    });
    expect(result.fundamentalAssessment).toBeDefined();
    expect(result.fundamentalAssessment!.available).toBe(true);
    expect(result.fundamentalAssessment!.reportingPeriod).toBe("2025-06-30");
    expect(result.fundamentalAssessment!.dimensions.find((d) => d.name === "eps-trend")!.status).toBe(
      "positive",
    );
    // Technical evidence stays untouched: fundamentals never fabricate it.
    expect(result.technicalData).toBeUndefined();
  });
});

describe("274 — unavailable provider result is explicit, never substituted", () => {
  it("keeps the fundamentals absent when the OVERVIEW leg fails", async () => {
    routes.OVERVIEW = { status: 500, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.fundamentals).toBeUndefined();
    expect(r.error).toMatch(/fundamentals: provider_error/);

    const result = runAnalysis({
      instrument: "AAPL",
      instrumentType: "stock",
      timeframe: "D1",
      fundamentalData: r.fundamentals,
    });
    expect(result.fundamentalAssessment!.available).toBe(false);
    expect(result.fundamentalAssessment!.state).toBe("insufficient");
    expect(result.fundamentalAssessment!.dimensions.every((d) => d.status === "unavailable")).toBe(true);
    expect(result.fundamentalAssessment!.limitations.length).toBeGreaterThan(0);
  });

  it("does not substitute a different company's evidence", async () => {
    routes.EARNINGS = { body: {} };
    routes.OVERVIEW = { body: { ...OVERVIEW, Symbol: "" } };
    const r = await av(ctx, AAPL);
    expect(r.fundamentals!.available).toBe(false);
    expect(r.fundamentals!.unavailableReason).toMatch(/No fundamental data available for this symbol/);
    expect(r.fundamentals!.peRatio).toBeUndefined();
    expect(r.fundamentals!.quarterlyEarningsHistory).toBeUndefined();
  });
});
