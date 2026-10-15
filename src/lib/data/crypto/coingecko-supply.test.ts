import { describe, expect, it } from "vitest";
import { parseCoinGeckoSupplyFallback } from "./coingecko-supply";

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

  it("marks old source observations stale", () => {
    const result = parseCoinGeckoSupplyFallback({
      market_data: { circulating_supply: 100, last_updated: "2026-10-10T00:00:00.000Z" },
    }, Date.parse("2026-10-15T00:00:00.000Z"));
    expect(result?.freshness).toBe("STALE");
  });
});
