/**
 * Phase 178b — PRODUCTION-PATH cache integration.
 *
 * This is the evidence that Phase 178 was missing. The Phase 178 suite tested
 * a standalone `new ProviderCache()`, which proved the class worked but proved
 * nothing about the runtime: the Convex actions still used their own private
 * `Map` caches.
 *
 * These tests invoke the REAL exported action handlers
 * (`fetchIntelligence`, `fetchDerivatives`, `fetchCalendar`) with a stubbed
 * auth context and a deterministic mocked `fetch`, then count the external
 * calls those handlers actually make. Nothing here constructs a cache
 * directly — the cache under test is whatever the production code reaches for.
 *
 * If someone reinstates a private provider cache, or bypasses the registry,
 * these call counts change and the suite fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchIntelligence } from "./alphaVantage";
import { fetchDerivatives } from "./coinglass";
import { fetchCalendar } from "./tradingEconomics";
import { resetProviderCache } from "../lib/data/provider-cache-registry";

// ── Harness ─────────────────────────────────────────────────────

/** Minimal ctx: the actions only require a signed-in identity. */
function ctx(subject = "user_A") {
  return {
    auth: {
      getUserIdentity: async () => ({ subject, issuer: "test" }),
    },
  } as never;
}

/** Invoke the real handler behind an action definition. */
function handlerOf<A, R>(action: unknown): (c: never, a: A) => Promise<R> {
  return (action as { _handler: (c: never, a: A) => Promise<R> })._handler;
}

const callIntelligence = handlerOf<
  { instrument: string; instrumentType: string },
  { success: boolean; errorCode?: string; data?: unknown; sentiment?: unknown }
>(fetchIntelligence);

const callDerivatives = handlerOf<
  { instrument: string },
  { success: boolean; errorCode?: string; data?: { timestamp: number; symbol: string; provider: string } }
>(fetchDerivatives);

const callCalendar = handlerOf<
  { instrument: string; instrumentType: string },
  { success: boolean; errorCode?: string; data?: { timestamp: number; provider: string } }
>(fetchCalendar);

/** Records every outbound URL so provider load can be counted exactly. */
let urls: string[] = [];

function mockFetch(responder: (url: string) => unknown) {
  return vi.fn(async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => responder(url),
    } as unknown as Response;
  });
}

const AV_NEWS = {
  feed: [
    {
      title: "Example headline",
      url: "https://example.test/a",
      time_published: "20250101T120000",
      overall_sentiment_score: 0.3,
      overall_sentiment_label: "Somewhat-Bullish",
      source: "Test Wire",
    },
  ],
};

const CG_OK = { code: "0", data: [{ openInterest: "1000", value: "1000" }] };

const TA_OK = [
  {
    id: "e1",
    title: "CPI",
    country: "United States",
    currency: "USD",
    importance: 3,
    date: new Date(Date.now() + 3600_000).toISOString(),
  },
];

function responderFor(url: string) {
  if (url.includes("alphavantage")) return AV_NEWS;
  if (url.includes("coinglass")) return CG_OK;
  if (url.includes("tickatlas")) return TA_OK;
  return {};
}

beforeEach(() => {
  urls = [];
  resetProviderCache();
  process.env.ALPHA_VANTAGE_API_KEY = "test-key";
  process.env.COINGLASS_API_KEY = "test-key";
  process.env.TICKATLAS_API_KEY = "test-key";
  vi.stubGlobal("fetch", mockFetch(responderFor));
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetProviderCache();
});

const countAV = () => urls.filter((u) => u.includes("alphavantage")).length;
const countCG = () => urls.filter((u) => u.includes("coinglass")).length;
const countTA = () => urls.filter((u) => u.includes("tickatlas")).length;

// ═══════════════════════════════════════════════════════════
// 1 — single-flight on the real handlers
// ═══════════════════════════════════════════════════════════

describe("single-flight through the production Alpha Vantage handler", () => {
  it("20 concurrent identical requests cause ONE news acquisition", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        callIntelligence(ctx(), {
          instrument: "EUR/USD",
          instrumentType: "forex",
        }),
      ),
    );

    // Without single-flight this would be 20.
    expect(countAV()).toBe(1);
  });

  it("sequential repeats are served from cache", async () => {
    for (let i = 0; i < 5; i++) {
      await callIntelligence(ctx(), {
        instrument: "EUR/USD",
        instrumentType: "forex",
      });
    }

    expect(countAV()).toBe(1);
  });

  it("different instruments still reach the provider", async () => {
    await callIntelligence(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    await callIntelligence(ctx(), { instrument: "GBP/USD", instrumentType: "forex" });

    expect(countAV()).toBe(2);
  });

  it("the same ticker in a different asset class is not reused", async () => {
    // Regression: `news:${ticker}` once collided across asset classes.
    await callIntelligence(ctx(), { instrument: "BTC/USD", instrumentType: "crypto" });
    await callIntelligence(ctx(), { instrument: "BTC", instrumentType: "stock" });

    expect(countAV()).toBeGreaterThanOrEqual(2);
  });
});

describe("single-flight through the production CoinGlass handler", () => {
  it("20 concurrent identical requests cause ONE acquisition wave", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        callDerivatives(ctx(), { instrument: "BTC/USDT" }),
      ),
    );

    // Each acquisition issues 4 upstream calls (OI, funding, L/S, liquidations).
    // One wave = 4. Twenty un-deduplicated waves would be 80.
    expect(countCG()).toBeLessThanOrEqual(4);
  });

  it("BTC/USDT and BTC/USD are acquired separately", async () => {
    await callDerivatives(ctx(), { instrument: "BTC/USDT" });
    const afterFirst = countCG();
    await callDerivatives(ctx(), { instrument: "BTC/USD" });

    // The pre-178 key truncated both to `deriv:BTC` and served one for the other.
    expect(countCG()).toBeGreaterThan(afterFirst);
  });

  it("a repeat of the same instrument consumes no quota", async () => {
    await callDerivatives(ctx(), { instrument: "BTC/USDT" });
    const afterFirst = countCG();
    await callDerivatives(ctx(), { instrument: "BTC/USDT" });

    expect(countCG()).toBe(afterFirst);
  });
});

describe("single-flight through the production calendar handler", () => {
  it("20 concurrent identical requests cause ONE acquisition wave", async () => {
    const before = countTA();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        callCalendar(ctx(), { instrument: "EUR/USD", instrumentType: "forex" }),
      ),
    );
    const perWave = countTA() - before;

    // The handler makes a small fixed number of calls per acquisition;
    // 20 deduplicated callers must not multiply it.
    expect(perWave).toBeLessThanOrEqual(4);
  });

  it("case variants do not double-fetch", async () => {
    await callCalendar(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    const afterFirst = countTA();
    await callCalendar(ctx(), { instrument: "eur/usd", instrumentType: "forex" });

    expect(countTA()).toBe(afterFirst);
  });

  it("different instruments still reach the provider", async () => {
    await callCalendar(ctx(), { instrument: "EUR/USD", instrumentType: "forex" });
    const afterFirst = countTA();
    await callCalendar(ctx(), { instrument: "USD/JPY", instrumentType: "forex" });

    expect(countTA()).toBeGreaterThan(afterFirst);
  });
});

// ═══════════════════════════════════════════════════════════
// 2 — provenance on the real path
// ═══════════════════════════════════════════════════════════

describe("a production cache hit preserves the original observation time", () => {
  it("CoinGlass: the second call reports the FIRST call's timestamp", async () => {
    const first = await callDerivatives(ctx(), { instrument: "BTC/USDT" });
    await new Promise((r) => setTimeout(r, 25));
    const second = await callDerivatives(ctx(), { instrument: "BTC/USDT" });

    expect(first.data?.timestamp).toBeDefined();
    // If the hit rebuilt the payload, this timestamp would have advanced —
    // laundering old data into fresh evidence.
    expect(second.data?.timestamp).toBe(first.data?.timestamp);
  });

  it("CoinGlass: evidence genuinely ages across hits", async () => {
    const first = await callDerivatives(ctx(), { instrument: "BTC/USDT" });
    await new Promise((r) => setTimeout(r, 30));
    const second = await callDerivatives(ctx(), { instrument: "BTC/USDT" });

    const ageAtSecondRead = Date.now() - (second.data?.timestamp ?? 0);
    const ageAtFirstRead = Date.now() - (first.data?.timestamp ?? 0);

    expect(ageAtSecondRead).toBe(ageAtFirstRead);
    expect(ageAtSecondRead).toBeGreaterThanOrEqual(25);
  });

  it("calendar: the second call reports the FIRST call's timestamp", async () => {
    const first = await callCalendar(ctx(), {
      instrument: "EUR/USD",
      instrumentType: "forex",
    });
    await new Promise((r) => setTimeout(r, 25));
    const second = await callCalendar(ctx(), {
      instrument: "EUR/USD",
      instrumentType: "forex",
    });

    expect(first.data?.timestamp).toBeDefined();
    expect(second.data?.timestamp).toBe(first.data?.timestamp);
  });

  it("provider identity survives a production cache hit", async () => {
    await callDerivatives(ctx(), { instrument: "BTC/USDT" });
    const hit = await callDerivatives(ctx(), { instrument: "BTC/USDT" });

    expect(hit.data?.provider).toBe("coinglass");
  });
});

// ═══════════════════════════════════════════════════════════
// 3 — failures are never cached on the real path
// ═══════════════════════════════════════════════════════════

describe("production failures never populate the cache", () => {
  it("a 429 does not become cached evidence, and the provider recovers", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        urls.push(url);
        attempt++;
        if (attempt === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ Note: "rate limit reached" }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => responderFor(url),
        } as unknown as Response;
      }),
    );

    const first = await callIntelligence(ctx(), {
      instrument: "EUR/USD",
      instrumentType: "forex",
    });
    const second = await callIntelligence(ctx(), {
      instrument: "EUR/USD",
      instrumentType: "forex",
    });

    // The first response must not be retained as evidence: the second call
    // reaches the provider again and succeeds.
    expect(attempt).toBeGreaterThanOrEqual(2);
    expect(second.success).toBe(true);
    void first;
  });

  it("a network failure does not poison the key", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        attempt++;
        if (attempt === 1) throw new Error("network down");
        return {
          ok: true,
          status: 200,
          json: async () => responderFor(url),
        } as unknown as Response;
      }),
    );

    await callDerivatives(ctx(), { instrument: "BTC/USDT" });
    const recovered = await callDerivatives(ctx(), { instrument: "BTC/USDT" });

    expect(attempt).toBeGreaterThanOrEqual(2);
    expect(recovered.success).toBe(true);
  });

  it("a failing instrument does not affect an unrelated one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes("BTC")) throw new Error("provider down for BTC");
        return {
          ok: true,
          status: 200,
          json: async () => responderFor(url),
        } as unknown as Response;
      }),
    );

    await callDerivatives(ctx(), { instrument: "BTC/USDT" });
    const other = await callDerivatives(ctx(), { instrument: "ETH/USDT" });

    expect(other.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
// 4 — cross-user isolation on the real path
// ═══════════════════════════════════════════════════════════

describe("cross-user isolation on the production path", () => {
  it("two users share only public provider evidence", async () => {
    const a = await callDerivatives(ctx("user_A"), { instrument: "BTC/USDT" });
    const b = await callDerivatives(ctx("user_B"), { instrument: "BTC/USDT" });

    // User B's call is a cache hit on User A's acquisition — that is the point
    // (public market data) — but nothing user-specific may ride along.
    const serialized = JSON.stringify(b.data ?? {});
    for (const field of [
      "accountEquity",
      "riskPercent",
      "accountCurrency",
      "userId",
      "email",
      "user_A",
    ]) {
      expect(serialized).not.toContain(field);
    }
    expect(b.data?.timestamp).toBe(a.data?.timestamp);
  });

  it("a second user consumes no additional quota for the same public data", async () => {
    await callDerivatives(ctx("user_A"), { instrument: "BTC/USDT" });
    const afterA = countCG();
    await callDerivatives(ctx("user_B"), { instrument: "BTC/USDT" });

    expect(countCG()).toBe(afterA);
  });

  it("unauthenticated callers are still rejected", async () => {
    const anon = { auth: { getUserIdentity: async () => null } } as never;

    await expect(
      callDerivatives(anon, { instrument: "BTC/USDT" }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});

// ═══════════════════════════════════════════════════════════
// 5 — market-data path: FX rate keying and direction
// ═══════════════════════════════════════════════════════════

import { fetchFxRate } from "./marketData";

const callFx = handlerOf<
  { from: string; to: string },
  { success: boolean; direct?: { rate: number; timestamp: number } | null }
>(fetchFxRate);

const countTD = () => urls.filter((u) => u.includes("twelvedata")).length;

const TD_QUOTE = { close: "1.0850", symbol: "EUR/USD", timestamp: Math.floor(Date.now() / 1000) };

function fxResponder(url: string) {
  if (url.includes("twelvedata")) return { ...TD_QUOTE, timestamp: Math.floor(Date.now() / 1000) };
  return responderFor(url);
}

describe("market-data FX rate through the production handler", () => {
  beforeEach(() => {
    process.env.TWELVE_DATA_API_KEY = "test-key";
    vi.stubGlobal("fetch", mockFetch(fxResponder));
  });

  it("a repeat conversion consumes no additional quota", async () => {
    await callFx(ctx(), { from: "USD", to: "EUR" });
    const afterFirst = countTD();
    await callFx(ctx(), { from: "USD", to: "EUR" });

    expect(countTD()).toBe(afterFirst);
  });

  it("the opposite direction is a DISTINCT key", async () => {
    await callFx(ctx(), { from: "USD", to: "EUR" });
    const afterFirst = countTD();
    await callFx(ctx(), { from: "EUR", to: "USD" });

    // USD>EUR and EUR>USD must not share an entry.
    expect(countTD()).toBeGreaterThan(afterFirst);
  });

  it("a different currency pair is acquired separately", async () => {
    await callFx(ctx(), { from: "USD", to: "EUR" });
    const afterFirst = countTD();
    await callFx(ctx(), { from: "USD", to: "JPY" });

    expect(countTD()).toBeGreaterThan(afterFirst);
  });

  it("20 concurrent identical conversions cause ONE acquisition", async () => {
    await Promise.all(
      Array.from({ length: 20 }, () => callFx(ctx(), { from: "USD", to: "EUR" })),
    );

    // One acquisition issues at most 2 upstream calls (direct + inverse).
    expect(countTD()).toBeLessThanOrEqual(2);
  });

  it("a cache hit preserves the original quote timestamp", async () => {
    const first = await callFx(ctx(), { from: "USD", to: "EUR" });
    await new Promise((r) => setTimeout(r, 25));
    const second = await callFx(ctx(), { from: "USD", to: "EUR" });

    expect(first.direct?.timestamp).toBeDefined();
    expect(second.direct?.timestamp).toBe(first.direct?.timestamp);
  });

  it("an unavailable quote is not cached as a rate", async () => {
    let attempt = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: unknown) => {
        attempt++;
        const url = String(input);
        if (attempt <= 2) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ code: 404, message: "not found" }),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => fxResponder(url),
        } as unknown as Response;
      }),
    );

    const failed = await callFx(ctx(), { from: "USD", to: "EUR" });
    const recovered = await callFx(ctx(), { from: "USD", to: "EUR" });

    expect(failed.success).toBe(false);
    // The failure left no entry, so the retry reached the provider.
    expect(recovered.success).toBe(true);
  });
});
