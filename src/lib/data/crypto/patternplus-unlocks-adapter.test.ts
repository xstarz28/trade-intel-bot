import { describe, expect, it, vi } from "vitest";
import { PatternPlusUnlockAdapter } from "./patternplus-unlocks-adapter";

function dayOffset(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function feed(data: unknown[]) {
  return {
    api: "PatternPlus API",
    version: 1,
    file: "unlocks",
    as_of: dayOffset(0),
    rebuilt: new Date().toISOString(),
    count: data.length,
    data,
  };
}

describe("PatternPlus public unlock fallback", () => {
  it("summarizes tracked unlocks over 30 days and does not invent supply fields", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => feed([
        { date: dayOffset(4), token: "btc-bitcoin", symbol: "BTC", amount: 100, pct_circulating: 0.01, value_usd: 6000000, basis: ["project documentation"] },
        { date: dayOffset(45), token: "btc-bitcoin", symbol: "BTC", amount: 200, pct_circulating: 0.02, value_usd: 12000000, basis: ["project documentation"] },
      ]),
    });
    const adapter = new PatternPlusUnlockAdapter(mockFetch as unknown as typeof fetch);
    const result = await adapter.fetch("BTC/USD");
    expect(result.provider).toBe("PatternPlus");
    expect(result.available).toBe(true);
    expect(result.quality).toBe("DEGRADED");
    expect(result.unlocks?.upcomingCount30d).toBe(1);
    expect(result.unlocks?.upcomingValue30d).toBe(100);
    expect(result.unlocks?.upcomingUsdValue30d).toBe(6000000);
    expect(result.unlocks?.unlockPercentOfCirculating).toBe(0.01);
    expect(result.supply).toBeUndefined();
    expect(result.totalDatasets).toBe(2);
    expect(String(mockFetch.mock.calls[0][0])).toBe("https://pattern.plus/api/v1/unlocks.json");
  });

  it("marks an unlisted token unavailable instead of treating missing rows as zero unlocks", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => feed([
        { date: dayOffset(4), token: "btc-bitcoin", symbol: "BTC", amount: 100, pct_circulating: 0.01 },
      ]),
    });
    const adapter = new PatternPlusUnlockAdapter(mockFetch as unknown as typeof fetch);
    const result = await adapter.fetch("SOL/USD");
    expect(result.available).toBe(false);
    expect(result.failureReason).toContain("Missing rows do not prove zero");
    expect(result.unlocks).toBeUndefined();
  });

  it("rejects ambiguous tickers rather than merging different assets", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => feed([
        { date: dayOffset(4), token: "arb-arbitrum", symbol: "ARB", amount: 100 },
        { date: dayOffset(5), token: "other-arb", symbol: "ARB", amount: 200 },
      ]),
    });
    const adapter = new PatternPlusUnlockAdapter(mockFetch as unknown as typeof fetch);
    const result = await adapter.fetch("ARB/USD");
    expect(result.available).toBe(false);
    expect(result.failureReason).toContain("multiple token identities");
  });

  it("coalesces and caches the shared public dataset across instruments", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => feed([
        { date: dayOffset(4), token: "btc-bitcoin", symbol: "BTC", amount: 100 },
        { date: dayOffset(4), token: "arb-arbitrum", symbol: "ARB", amount: 200 },
      ]),
    });
    const adapter = new PatternPlusUnlockAdapter(mockFetch as unknown as typeof fetch);
    await Promise.all([adapter.fetch("BTC/USD"), adapter.fetch("ARB/USD")]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces HTTP failures without falling back to fabricated data", async () => {
    const adapter = new PatternPlusUnlockAdapter(vi.fn().mockResolvedValue({
      ok: false, status: 503, statusText: "Service Unavailable", json: async () => ({}),
    }) as unknown as typeof fetch);
    const result = await adapter.fetch("BTC/USD");
    expect(result.available).toBe(false);
    expect(result.failureReason).toContain("HTTP 503");
  });
});
