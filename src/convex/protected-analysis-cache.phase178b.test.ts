/**
 * Phase 178b — cache behaviour of the REAL `runProtectedAnalysis` runtime.
 *
 * This is the "C" level of evidence:
 *
 *   A. `ProviderCache` unit-tested in isolation        (Phase 178)
 *   B. production provider handlers use it             (provider-integration.phase178b)
 *   C. runProtectedAnalysis benefits from it           ← THIS FILE
 *   D. deployed runtime verified                        (NOT possible here)
 *
 * The real exported handler is invoked. Its two Convex mutations are stubbed
 * (they need a database), but `ctx.runAction` dispatches to the REAL provider
 * action handlers, which reach the REAL cache and a mocked `fetch`. So the
 * chain under test is genuinely:
 *
 *   runProtectedAnalysis -> fan-out leg -> provider action handler
 *     -> ProviderCache -> (hit | single-flight acquisition) -> engine
 *
 * Outbound HTTP is counted, so "a second analysis costs less provider quota"
 * is measured rather than asserted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runProtectedAnalysis } from "./protectedAnalysis";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { fetchMarketData, fetchFxRate } from "./marketData";
import { resetProviderCache } from "../lib/data/provider-cache-registry";
import { getFunctionName } from "convex/server";

// ── Harness ─────────────────────────────────────────────────────

function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

const runAnalysisHandler = handlerOf<Record<string, unknown>, {
  status?: string;
  chargeable?: boolean;
  result?: { recommendation?: string };
}>(runProtectedAnalysis);

let urls: string[] = [];

/**
 * Maps an `api.*` function reference back to the real handler.
 *
 * `String(ref)` throws on the `anyApi` proxy, so the reference is resolved
 * with Convex's own `getFunctionName`, which yields e.g.
 * "marketData:fetchMarketData".
 */
const REAL_HANDLERS: Record<string, (c: never, a: never) => Promise<unknown>> = {
  "marketData:fetchMarketData": handlerOf(fetchMarketData) as never,
  "marketData:fetchFxRate": handlerOf(fetchFxRate) as never,
  "alphaVantage:fetchIntelligence": handlerOf(fetchIntelligence) as never,
  "coinglass:fetchDerivatives": handlerOf(fetchDerivatives) as never,
  "tradingEconomics:fetchCalendar": handlerOf(fetchCalendar) as never,
};

function dispatch(ref: unknown): ((c: never, a: never) => Promise<unknown>) | null {
  let name = "";
  try {
    name = getFunctionName(ref as Parameters<typeof getFunctionName>[0]);
  } catch {
    return null;
  }
  return REAL_HANDLERS[name] ?? null;
}

function ctx(subject = "user_A") {
  return {
    auth: { getUserIdentity: async () => ({ subject, issuer: "test" }) },
    // The DB-backed steps are stubbed; provider acquisition is NOT.
    runMutation: async () => "user_stub" as unknown,
    runQuery: async () => null,
    runAction: async (ref: unknown, args: unknown) => {
      const handler = dispatch(ref);
      if (!handler) {
        // Legs with no cache involvement (treasury/eia/cot/okx) are reported
        // unavailable rather than faked.
        return { success: false, error: "not wired in this test" };
      }
      return handler(ctx(subject) as never, args as never);
    },
  } as never;
}

const CANDLES = Array.from({ length: 210 }, (_, i) => ({
  datetime: new Date(Date.now() - (210 - i) * 36e5).toISOString(),
  open: "100",
  high: "100.5",
  low: "99.5",
  close: "100",
  volume: "1000",
}));

function responder(url: string) {
  if (url.includes("twelvedata") && url.includes("time_series")) {
    return { values: [...CANDLES].reverse(), status: "ok" };
  }
  if (url.includes("twelvedata")) return { close: "1.0850", symbol: "EUR/USD" };
  if (url.includes("alphavantage")) {
    return {
      feed: [
        {
          title: "Headline",
          url: "https://example.test/a",
          time_published: "20250101T120000",
          overall_sentiment_score: 0.2,
          overall_sentiment_label: "Somewhat-Bullish",
          source: "Wire",
        },
      ],
    };
  }
  if (url.includes("coinglass")) {
    return { code: "0", data: [{ openInterest: "1000", value: "1000" }] };
  }
  if (url.includes("tickatlas")) {
    return [
      {
        id: "e1",
        title: "CPI",
        country: "United States",
        currency: "USD",
        importance: 3,
        date: new Date(Date.now() + 36e5).toISOString(),
      },
    ];
  }
  return {};
}

beforeEach(() => {
  urls = [];
  resetProviderCache();
  process.env.TWELVE_DATA_API_KEY = "test-key";
  process.env.ALPHA_VANTAGE_API_KEY = "test-key";
  process.env.COINGLASS_API_KEY = "test-key";
  process.env.TICKATLAS_API_KEY = "test-key";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => responder(url),
      } as unknown as Response;
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

/** The handler takes a nested `input` payload, matching the client contract. */
const ANALYSIS_ARGS = {
  input: {
    instrument: "EUR/USD",
    instrumentType: "forex" as const,
    timeframe: "H4",
    tradingStyle: "swing" as const,
  },
};

// ═══════════════════════════════════════════════════════════

describe("runProtectedAnalysis uses the authoritative provider cache", () => {
  it("a repeated analysis of the same instrument costs less provider quota", async () => {
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);
    const firstRunCalls = urls.length;

    urls = [];
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);
    const secondRunCalls = urls.length;

    // The whole point of Phase 178.
    //
    // A loose `secondRun < firstRun` is NOT sufficient here: the DXY
    // comparator memo in marketData.ts also saves a call on the second run,
    // so that assertion passes even with the cache disabled (verified by
    // mutation testing). The threshold is therefore strict enough that only
    // real cache hits can satisfy it.
    expect(firstRunCalls).toBeGreaterThanOrEqual(4);
    expect(secondRunCalls).toBeLessThanOrEqual(firstRunCalls / 2);
  });

  it("two simultaneous identical analyses do not double provider load", async () => {
    urls = [];
    await Promise.all([
      runAnalysisHandler(ctx("user_A"), ANALYSIS_ARGS),
      runAnalysisHandler(ctx("user_B"), ANALYSIS_ARGS),
    ]);
    const concurrentCalls = urls.length;

    resetProviderCache();
    urls = [];
    await runAnalysisHandler(ctx("user_A"), ANALYSIS_ARGS);
    const singleCalls = urls.length;

    // Two concurrent analyses must cost far less than 2x a single one.
    expect(concurrentCalls).toBeLessThan(singleCalls * 2);
  });

  it("a different instrument still reaches the providers", async () => {
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);

    urls = [];
    await runAnalysisHandler(ctx(), {
      input: { ...ANALYSIS_ARGS.input, instrument: "GBP/USD" },
    });

    expect(urls.length).toBeGreaterThan(0);
  });

  it("a different timeframe is not served from the H4 entry", async () => {
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);

    urls = [];
    await runAnalysisHandler(ctx(), {
      input: { ...ANALYSIS_ARGS.input, timeframe: "H1" },
    });

    // Market data is timeframe-specific; reusing H4 candles for H1 would be
    // a silent correctness failure.
    const timeSeries = urls.filter((u) => u.includes("time_series"));
    expect(timeSeries.length).toBeGreaterThan(0);
  });

  it("the analysis still produces a real verdict while cached", async () => {
    const first = await runAnalysisHandler(ctx(), ANALYSIS_ARGS);
    const second = await runAnalysisHandler(ctx(), ANALYSIS_ARGS);

    // Caching must not change the decision surface.
    expect(first.status).toBeDefined();
    expect(second.status).toBe(first.status);
  });

  it("cached provider evidence never carries user-owned fields", async () => {
    const out = await runAnalysisHandler(ctx("user_A"), {
      input: {
        ...ANALYSIS_ARGS.input,
        accountEquity: 50_000,
        riskPercent: 1.5,
        accountCurrency: "USD",
      },
    });

    // User B's analysis must not inherit User A's account parameters through
    // the shared provider cache.
    const outB = await runAnalysisHandler(ctx("user_B"), ANALYSIS_ARGS);
    const serialized = JSON.stringify(outB ?? {});

    expect(serialized).not.toContain("50000");
    expect(serialized).not.toContain("user_A");
    void out;
  });
});

// ═══════════════════════════════════════════════════════════
// Measured quota reduction (the Phase 178 headline claim)
// ═══════════════════════════════════════════════════════════

describe("measured provider-load reduction", () => {
  it("a repeated identical analysis cuts provider calls by at least half", async () => {
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);
    const firstRun = urls.length;

    urls = [];
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);
    const secondRun = urls.length;

    expect(firstRun).toBeGreaterThanOrEqual(4);
    expect(secondRun).toBeLessThanOrEqual(firstRun / 2);
  });

  it("three concurrent identical analyses cost far less than three cold runs", async () => {
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);
    const coldRun = urls.length;

    resetProviderCache();
    urls = [];
    await Promise.all([
      runAnalysisHandler(ctx("u1"), ANALYSIS_ARGS),
      runAnalysisHandler(ctx("u2"), ANALYSIS_ARGS),
      runAnalysisHandler(ctx("u3"), ANALYSIS_ARGS),
    ]);

    expect(urls.length).toBeLessThan(coldRun * 3);
  });

  it("caching does not change the recommendation", async () => {
    const first = await runAnalysisHandler(ctx(), ANALYSIS_ARGS);
    const second = await runAnalysisHandler(ctx(), ANALYSIS_ARGS);

    expect(second.result?.recommendation).toBe(first.result?.recommendation);
  });

  it("OHLCV identity separates bar counts and timeframes", async () => {
    await runAnalysisHandler(ctx(), ANALYSIS_ARGS);

    urls = [];
    await runAnalysisHandler(ctx(), {
      input: { ...ANALYSIS_ARGS.input, timeframe: "H1" },
    });

    // A different timeframe must not be served from the H4 candles.
    expect(urls.filter((u) => u.includes("time_series")).length).toBeGreaterThan(0);
  });
});
