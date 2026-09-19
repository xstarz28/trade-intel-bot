/**
 * Phase 229 — Alpha Vantage leg-failure propagation.
 *
 * Before this phase the news leg swallowed every non-RATE_LIMIT error into a
 * neutral, zero-score `SentimentData` stamped with `Date.now()`, and the
 * fundamentals leg into an `available:false` placeholder. HTTP 429/401/403
 * and AV's `"Error Message"` body were generic errors that took that path, so
 * a quota/credential rejection became `success: true` with empty blocks.
 *
 * Drives the REAL action handler through a stubbed `fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCountingClock } from "../test-counting-clock";
import { resetProviderCache, getProviderCache } from "../lib/data/provider-cache-registry";
import { fetchIntelligence } from "./alphaVantage";
import type { IntelligenceResult } from "../lib/data/intelligence-types";

type Args = { instrument: string; instrumentType: "forex" | "crypto" | "stock" | "commodity" | "indices" };
type Handler = (ctx: unknown, args: Args) => Promise<IntelligenceResult>;
const av = (fetchIntelligence as unknown as { _handler: Handler })._handler;
const ctx = { auth: { getUserIdentity: async () => ({ subject: "user_A|sess", issuer: "t" }) } };

type Route = { status?: number; body?: unknown; throws?: unknown; badJson?: boolean };
let routes: Record<string, Route> = {};
const calls: string[] = [];
const OK_NEWS = {
  feed: Array.from({ length: 6 }, (_, i) => ({
    title: `A${i}`, url: `https://x/${i}`, time_published: "20250101T120000", source: "W",
    ticker_sentiment: [{ ticker: "AAPL", ticker_sentiment_score: "0.4", relevance_score: "0.9", ticker_sentiment_label: "Bullish" }],
  })),
};
const OK_OVERVIEW = { Symbol: "AAPL", Name: "Apple", Sector: "Tech", MarketCapitalization: "12", PERatio: "20" };
const OK_EARNINGS = { quarterlyEarnings: [{ fiscalDateEnding: "2025-03-31", reportedEPS: "1.5" }] };
const ALL_OK: Record<string, Route> = { NEWS_SENTIMENT: { body: OK_NEWS }, OVERVIEW: { body: OK_OVERVIEW }, EARNINGS: { body: OK_EARNINGS } };

function routeFor(url: string): Route {
  for (const k of Object.keys(routes)) if (url.includes(k)) return routes[k];
  return { body: {} };
}
function timeoutError() { const e = new Error("aborted due to timeout"); e.name = "TimeoutError"; return e; }
const AAPL: Args = { instrument: "AAPL", instrumentType: "stock" };
const EURUSD: Args = { instrument: "EUR/USD", instrumentType: "forex" };
const newsKey = { provider: "alpha-vantage", dataset: "news-sentiment", instrument: "AAPL", instrumentType: "stock", qualifier: "AAPL" } as const;
const fundKey = { provider: "alpha-vantage", dataset: "fundamentals", instrument: "AAPL", instrumentType: "stock", qualifier: "AAPL" } as const;

beforeEach(() => {
  resetProviderCache();
  calls.length = 0;
  routes = { ...ALL_OK };
  process.env.ALPHA_VANTAGE_API_KEY = "k";
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    calls.push(url);
    const r = routeFor(url);
    if (r.throws) throw r.throws;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300, status, statusText: "x", text: async () => "",
      json: async () => { if (r.badJson) throw new SyntaxError("Unexpected token <"); return r.body; },
    } as unknown as Response;
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); resetProviderCache(); });

describe("229 AV — 1. valid news + valid fundamentals", () => {
  it("success, both legs present, no error field, both cached", async () => {
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.error).toBeUndefined();
    expect(r.dataAvailable).toEqual({ news: true, fundamentals: true, macro: expect.any(Boolean) });
    expect(r.sentiment!.articleCount).toBe(6);
    expect(r.sentiment!.confidence).toBe("medium");
    expect(r.fundamentals!.available).toBe(true);
    expect(r.fundamentals!.marketCap).toBe(12);
    expect(r.acquisition).toBe("observed-now");
    expect(getProviderCache().peek(newsKey)).not.toBeNull();
    expect(getProviderCache().peek(fundKey)).not.toBeNull();
  });
});

describe("229 AV — 2. news-only failure (partial)", () => {
  it("timeout on news → success, sentiment/macro absent (no neutral zero block), fundamentals kept, error names the leg", async () => {
    routes.NEWS_SENTIMENT = { throws: timeoutError() };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.sentiment).toBeUndefined();
    expect(r.macro).toBeUndefined();
    expect(r.fundamentals!.available).toBe(true);
    expect(r.dataAvailable).toEqual({ news: false, fundamentals: true, macro: false });
    expect(r.error).toMatch(/^news: timeout/);
    expect(r.error).not.toMatch(/fundamentals/);
    expect(getProviderCache().peek(newsKey)).toBeNull();
    expect(getProviderCache().peek(fundKey)).not.toBeNull();
  });
  it("HTTP 500 on news → provider_error class", async () => {
    routes.NEWS_SENTIMENT = { status: 500, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.error).toMatch(/news: provider_error \(Alpha Vantage HTTP 500/);
  });
  it("AV 'Error Message' body on news (invalid symbol) → provider_error, not empty success", async () => {
    routes.NEWS_SENTIMENT = { body: { "Error Message": "Invalid API call. Please retry" } };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.error).toMatch(/news: provider_error/);
    expect(r.sentiment).toBeUndefined();
  });
});

describe("229 AV — 3. fundamentals-only failure (partial)", () => {
  it("timeout on OVERVIEW → fundamentals absent (no available:false placeholder), news kept", async () => {
    routes.OVERVIEW = { throws: timeoutError() };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.fundamentals).toBeUndefined();
    expect(r.sentiment!.articleCount).toBe(6);
    expect(r.dataAvailable).toEqual({ news: true, fundamentals: false, macro: expect.any(Boolean) });
    expect(r.error).toMatch(/^fundamentals: timeout/);
    expect(getProviderCache().peek(fundKey)).toBeNull();
  });
  it("network failure on EARNINGS → network class", async () => {
    routes.EARNINGS = { throws: new TypeError("fetch failed") };
    const r = await av(ctx, AAPL);
    expect(r.error).toMatch(/fundamentals: network/);
  });
  it("answered-but-empty OVERVIEW is 'unavailable', NOT a failure: fundamentals block kept with available:false, no error", async () => {
    routes.OVERVIEW = { body: {} };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.fundamentals!.available).toBe(false);
    expect(r.fundamentals!.unavailableReason).toMatch(/No fundamental data/);
    expect(r.error).toBeUndefined();
  });
});

describe("229 AV — 4. both legs failing", () => {
  it("both timeout → API_UNAVAILABLE, no data blocks, nothing cached", async () => {
    routes.NEWS_SENTIMENT = { throws: timeoutError() };
    routes.OVERVIEW = { throws: timeoutError() };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
    expect(r.error).toMatch(/every leg failed/);
    expect(r.error).toMatch(/news: timeout/);
    expect(r.error).toMatch(/fundamentals: timeout/);
    expect(r.sentiment).toBeUndefined();
    expect(r.acquisition).toBeUndefined();
    expect(getProviderCache().peek(newsKey)).toBeNull();
    expect(getProviderCache().peek(fundKey)).toBeNull();
  });
  it("non-stock: the single news leg failing is a whole-provider failure", async () => {
    routes.NEWS_SENTIMENT = { status: 502, body: {} };
    const r = await av(ctx, EURUSD);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("API_UNAVAILABLE");
  });
  it("non-stock: news answered-but-empty stays success with news=false (existing contract)", async () => {
    routes.NEWS_SENTIMENT = { body: { feed: [] } };
    const r = await av(ctx, EURUSD);
    expect(r.success).toBe(true);
    expect(r.dataAvailable.news).toBe(false);
    expect(r.sentiment!.confidence).toBe("unavailable");
    expect(r.fundamentals!.available).toBe(false); // not-applicable block, unchanged
    expect(r.error).toBeUndefined();
  });
});

describe("229 AV — 5. HTTP 429", () => {
  it.each(["NEWS_SENTIMENT", "OVERVIEW", "EARNINGS"])("HTTP 429 on %s → RATE_LIMIT, the rate-limited dataset is not cached", async (leg) => {
    routes[leg] = { status: 429, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(r.sentiment).toBeUndefined();
    expect(getProviderCache().peek(fundKey)).toBeNull();
    // News and fundamentals are distinct datasets (Phase 178b). A news leg
    // that genuinely succeeded BEFORE the fundamentals 429 is real evidence
    // and stays cached; only the rate-limited dataset is absent.
    if (leg === "NEWS_SENTIMENT") expect(getProviderCache().peek(newsKey)).toBeNull();
    else expect(getProviderCache().peek(newsKey)).not.toBeNull();
  });
});

describe("229 AV — 6. HTTP 401/403", () => {
  it.each([401, 403])("HTTP %d on news → AUTH_ERROR, not partial success", async (status) => {
    routes.NEWS_SENTIMENT = { status, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("AUTH_ERROR");
  });
  it("HTTP 403 on fundamentals after a good news leg → AUTH_ERROR (fatal wins over partial)", async () => {
    routes.OVERVIEW = { status: 403, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.errorCode).toBe("AUTH_ERROR");
    expect(r.success).toBe(false);
  });
  it("AV 'Error Message' mentioning the API key → AUTH_ERROR", async () => {
    routes.NEWS_SENTIMENT = { body: { "Error Message": "the parameter apikey is invalid or missing" } };
    expect((await av(ctx, AAPL)).errorCode).toBe("AUTH_ERROR");
  });
  it("the credential never appears in the envelope", async () => {
    process.env.ALPHA_VANTAGE_API_KEY = "SECRET-VALUE-XYZ";
    routes.NEWS_SENTIMENT = { status: 401, body: {} };
    expect(JSON.stringify(await av(ctx, AAPL))).not.toContain("SECRET-VALUE-XYZ");
  });
});

describe("229 AV — 7. provider-native rate limit", () => {
  it.each(["Note", "Information"])("%s body on news → RATE_LIMIT (earlier-phase handling intact)", async (k) => {
    routes.NEWS_SENTIMENT = { body: { [k]: "Thank you for using Alpha Vantage! Our standard API rate limit is 25 requests per day." } };
    const r = await av(ctx, AAPL);
    expect(r.errorCode).toBe("RATE_LIMIT");
    expect(getProviderCache().peek(newsKey)).toBeNull();
  });
  it("Note body on fundamentals after a good news leg → RATE_LIMIT", async () => {
    routes.OVERVIEW = { body: { Note: "rate limit" } };
    expect((await av(ctx, AAPL)).errorCode).toBe("RATE_LIMIT");
  });
});

describe("229 AV — 8. malformed", () => {
  it("non-JSON body on news → malformed class, partial", async () => {
    routes.NEWS_SENTIMENT = { badJson: true };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.error).toMatch(/news: malformed/);
    expect(r.sentiment).toBeUndefined();
  });
  it("non-JSON body on both → API_UNAVAILABLE", async () => {
    routes.NEWS_SENTIMENT = { badJson: true }; routes.OVERVIEW = { badJson: true };
    expect((await av(ctx, AAPL)).errorCode).toBe("API_UNAVAILABLE");
  });
  it("wrong-container JSON (Phase 227) is still 'answered, nothing usable' → no error field", async () => {
    routes.NEWS_SENTIMENT = { body: { feed: "nope" } };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.dataAvailable.news).toBe(false);
    expect(r.error).toBeUndefined();
  });
});

describe("229 AV — 9. timeout/network never yield zeros or a local-clock timestamp", () => {
  it("failed news leg does not produce a zero-score sentiment block", async () => {
    routes.NEWS_SENTIMENT = { throws: new TypeError("fetch failed") };
    const r = await av(ctx, AAPL);
    expect(r.sentiment?.averageScore).toBeUndefined();
    expect(r.sentiment?.timestamp).toBeUndefined();
    expect(r.macro?.timestamp).toBeUndefined();
  });
});

describe("229 AV — 10. cache behaviour after failure", () => {
  it("a failed news leg is not cached; the next call re-fetches and succeeds", async () => {
    routes.NEWS_SENTIMENT = { throws: timeoutError() };
    const r1 = await av(ctx, AAPL);
    expect(r1.error).toMatch(/news: timeout/);
    routes = { ...ALL_OK };
    const r2 = await av(ctx, AAPL);
    expect(r2.success).toBe(true);
    expect(r2.error).toBeUndefined();
    expect(r2.sentiment!.articleCount).toBe(6);
    expect(calls.filter((u) => u.includes("NEWS_SENTIMENT")).length).toBe(2);
    // fundamentals were good the first time and are reused.
    expect(calls.filter((u) => u.includes("OVERVIEW")).length).toBe(1);
  });
  it("a RATE_LIMIT does not poison either key", async () => {
    routes.OVERVIEW = { status: 429, body: {} };
    expect((await av(ctx, AAPL)).errorCode).toBe("RATE_LIMIT");
    routes = { ...ALL_OK };
    const r2 = await av(ctx, AAPL);
    expect(r2.success).toBe(true);
    expect(r2.fundamentals!.available).toBe(true);
  });
  it("a fatal acquisition performs one round of calls (no retry storm)", async () => {
    routes.NEWS_SENTIMENT = { status: 429, body: {} };
    await av(ctx, AAPL);
    expect(calls.length).toBe(1); // news is fetched first; the fatal short-circuits fundamentals
  });
});

describe("229 AV — 11. partial aggregate semantics", () => {
  it("partial never claims complete: dataAvailable reflects only surviving legs", async () => {
    routes.OVERVIEW = { status: 500, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.dataAvailable.fundamentals).toBe(false);
    expect(r.dataAvailable.news).toBe(true);
    expect(r.error).toBe("fundamentals: provider_error (Alpha Vantage HTTP 500: x)");
  });
  it("mixed: news answered-empty + fundamentals failed → still success (an empty answer is not an outage)", async () => {
    routes.NEWS_SENTIMENT = { body: { feed: [] } };
    routes.OVERVIEW = { status: 500, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.success).toBe(true);
    expect(r.errorCode).toBeUndefined();
    expect(r.error).toBe("fundamentals: provider_error (Alpha Vantage HTTP 500: x)");
    expect(r.sentiment!.confidence).toBe("unavailable");
  });
  it("a failed leg is never stored as an empty-but-successful dataset", async () => {
    routes.NEWS_SENTIMENT = { status: 500, body: {} };
    const r1 = await av(ctx, AAPL);
    expect(r1.dataAvailable.news).toBe(false);
    expect(getProviderCache().peek(newsKey)).toBeNull();
    routes = { ...ALL_OK };
    const r2 = await av(ctx, AAPL);
    expect(r2.sentiment!.articleCount).toBe(6);
    expect(calls.filter((u) => u.includes("NEWS_SENTIMENT")).length).toBe(2);
  });
  it("mixed: news ok + fundamentals answered-empty → no error, not-a-failure", async () => {
    routes.OVERVIEW = { body: { Symbol: 42 } };
    const r = await av(ctx, AAPL);
    expect(r.error).toBeUndefined();
    expect(r.fundamentals!.available).toBe(false);
  });
});

describe("229 AV — 12. provenance", () => {
  it("partial: acquisition/observedAt come only from the surviving leg", async () => {
    routes.NEWS_SENTIMENT = { throws: timeoutError() };

    // Phase 238 — this assertion used to be a RACE. With the real clock it
    // passed whenever both of the acquisition's two reads landed in the same
    // millisecond: always on this sandbox, not always on CI, where run
    // 35187915524 failed it with `expected 1789624822122 to be 1789624822121`.
    // A clock that advances one millisecond per READ makes the property
    // structural: one acquisition, one instant — so a second read can never
    // hide behind a fast machine again.
    const clock = createCountingClock(1_700_000_000_000);
    vi.spyOn(Date, "now").mockImplementation(clock.now);

    const r = await av(ctx, AAPL);
    expect(r.acquisition).toBe("observed-now");
    expect(Number.isFinite(r.observedAt)).toBe(true);
    expect(r.observedAt).toBe(r.fundamentals!.timestamp);
    expect(clock.reads).toContain(r.observedAt);
  });
  it("cache hit after a partial reports cache-reused for the surviving leg only when nothing new was fetched", async () => {
    routes.NEWS_SENTIMENT = { throws: timeoutError() };
    await av(ctx, AAPL);
    const r2 = await av(ctx, AAPL);
    // news still failing → fetched again (observed-now is not claimed for a failed leg); fundamentals reused.
    expect(r2.acquisition).toBe("cache-reused");
    expect(r2.error).toMatch(/news: timeout/);
  });
  it("outage envelope carries no acquisition claim", async () => {
    routes.NEWS_SENTIMENT = { status: 500, body: {} }; routes.OVERVIEW = { status: 500, body: {} };
    const r = await av(ctx, AAPL);
    expect(r.acquisition).toBeUndefined();
    expect(r.observedAt).toBeUndefined();
  });
});
