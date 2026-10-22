import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdapters } from "./provider-registry";

function coingeckoAdapter() {
  const adapter = getAdapters().find((candidate) => candidate.id === "coingecko");
  if (!adapter) throw new Error("CoinGecko adapter is not registered");
  return adapter;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CoinGecko Market Radar adapter", () => {
  it("uses the shared validated quote path and preserves the provider timestamp", async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      bitcoin: { usd: 68000, last_updated_at: nowSeconds },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await coingeckoAdapter().fetch("BTC/USD", "crypto", () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("ids=bitcoin");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("include_last_updated_at=true");
    expect(result).toMatchObject({
      instrument: "BTC/USD",
      assetClass: "crypto",
      price: 68000,
      provider: "coingecko",
      observedAt: nowSeconds * 1000,
      freshness: "FRESH",
      quality: "VERIFIED",
      ohlcvAvailable: false,
      availableTimeframes: [],
    });
  });

  it("returns null for stale or unsupported CoinGecko quotes instead of inventing freshness", async () => {
    const staleSeconds = Math.floor(Date.now() / 1000) - 10 * 60;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      bitcoin: { usd: 68000, last_updated_at: staleSeconds },
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(coingeckoAdapter().fetch("BTC/USD", "crypto", () => undefined)).resolves.toBeNull();
    await expect(coingeckoAdapter().fetch("UNKNOWN/USD", "crypto", () => undefined)).resolves.toBeNull();
  });
});
