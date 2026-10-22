import { describe, expect, it } from "vitest";
import { fetchCoinGeckoSupplyPayload, parseCoinGeckoSupplyFallback } from "./coingecko-supply";

describe("CoinGecko public supply fallback", () => {
  it("uses observed supply fields and never invents unlock events", () => {
    const result = parseCoinGeckoSupplyFallback({
      market_data: {
        circulating_supply: 19_800_000,
        total_supply: 19_800_000,
        max_supply: 21_000_000,
        last_updated: "2026-10-15T07:00:00.000Z",
      },
    }, Date.parse("2026-10-15T07:01:00.000Z"));
    expect(result?.available).toBe(true);
    expect(result?.provider).toBe("CoinGecko public API");
    expect(result?.supply?.circulatingPercent).toBeCloseTo(94.2857, 3);
    expect(result?.unlocks).toBeUndefined();
    expect(result?.failureReason).toContain("unlock calendar");
    expect(result?.quality).toBe("DEGRADED");
  });

  it("rejects malformed or supply-empty payloads", () => {
    expect(parseCoinGeckoSupplyFallback(null)).toBeNull();
    expect(parseCoinGeckoSupplyFallback({ market_data: {} })).toBeNull();
    expect(parseCoinGeckoSupplyFallback({ market_data: { circulating_supply: 0, total_supply: null, max_supply: null } })).toBeNull();
  });

  it("marks implausibly future source observations stale", () => {
    const result = parseCoinGeckoSupplyFallback({
      market_data: { circulating_supply: 100, last_updated: "2026-10-16T00:00:00.000Z" },
    }, Date.parse("2026-10-15T00:00:00.000Z"));
    expect(result?.freshness).toBe("STALE");
    expect(result?.failureReason).toContain("unexpectedly in the future");
  });

  it("discloses missing provider timestamps instead of implying verified freshness", () => {
    const result = parseCoinGeckoSupplyFallback({
      market_data: { circulating_supply: 100 },
    }, Date.parse("2026-10-15T00:00:00.000Z"));
    expect(result?.failureReason).toContain("timestamp is missing or invalid");
    expect(result?.quality).toBe("DEGRADED");
  });

  it("marks old source observations stale", () => {
    const result = parseCoinGeckoSupplyFallback({
      market_data: { circulating_supply: 100, last_updated: "2026-10-10T00:00:00.000Z" },
    }, Date.parse("2026-10-15T00:00:00.000Z"));
    expect(result?.freshness).toBe("STALE");
  });
});


describe("CoinGecko supply fetch resilience", () => {
  it("sends the configured Demo API key and returns the real response payload", async () => {
    const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>)["x-cg-demo-api-key"]).toBe("demo-key");
      return new Response(JSON.stringify({ market_data: { circulating_supply: 123 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const result = await fetchCoinGeckoSupplyPayload("bitcoin", { apiKey: " demo-key ", fetchImpl });
    expect(result.payload).toEqual({ market_data: { circulating_supply: 123 } });
    expect(result.failureReason).toBeUndefined();
  });

  it("retries one 429 only when Retry-After fits the safe wait window", async () => {
    let calls = 0;
    const waits: number[] = [];
    const fetchImpl = async () => {
      calls += 1;
      return calls === 1
        ? new Response("rate limited", { status: 429, headers: { "retry-after": "0" } })
        : new Response(JSON.stringify({ market_data: { circulating_supply: 123 } }), { status: 200 });
    };
    const result = await fetchCoinGeckoSupplyPayload("bitcoin", {
      fetchImpl,
      sleepImpl: async (ms) => { waits.push(ms); },
    });
    expect(calls).toBe(2);
    expect(waits).toEqual([0]);
    expect(result.payload).toEqual({ market_data: { circulating_supply: 123 } });
  });

  it("returns a visible failure after repeated 429 instead of silently skipping", async () => {
    let calls = 0;
    const result = await fetchCoinGeckoSupplyPayload("bitcoin", {
      fetchImpl: async () => { calls += 1; return new Response("rate limited", { status: 429 }); },
      sleepImpl: async () => {},
    });
    expect(calls).toBe(2);
    expect(result.payload).toBeUndefined();
    expect(result.failureReason).toMatch(/rate-limited \(HTTP 429\)/);
  });

  it("does not retry when Retry-After exceeds the safe bound and reports HTTP/JSON failures", async () => {
    let calls = 0;
    const rateLimited = await fetchCoinGeckoSupplyPayload("bitcoin", {
      fetchImpl: async () => {
        calls += 1;
        return new Response("rate limited", { status: 429, headers: { "retry-after": "30" } });
      },
      sleepImpl: async () => { throw new Error("must not wait beyond bound"); },
    });
    expect(calls).toBe(1);
    expect(rateLimited.failureReason).toMatch(/exceeds the safe 1s retry window/);

    const httpError = await fetchCoinGeckoSupplyPayload("bitcoin", {
      fetchImpl: async () => new Response("forbidden", { status: 403 }),
    });
    expect(httpError.failureReason).toMatch(/HTTP 403/);

    const invalidJson = await fetchCoinGeckoSupplyPayload("bitcoin", {
      fetchImpl: async () => new Response("{", { status: 200 }),
    });
    expect(invalidJson.failureReason).toMatch(/invalid JSON/);
  });
});
