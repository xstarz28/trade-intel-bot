import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdapters } from "./provider-registry";

const readEnv = (name: string): string | undefined =>
  name === "COINGLASS_API_KEY" ? "test-only-key" : undefined;

function coinglassAdapter() {
  const adapter = getAdapters().find((candidate) => candidate.id === "coinglass");
  if (!adapter) throw new Error("CoinGlass adapter is not registered");
  return adapter;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CoinGlass V4 provider adapter", () => {
  it("uses the V4 pairs endpoint, auth header, and exact Binance pair price", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
      void _input;
      void _init;
      return new Response(JSON.stringify({
        code: "0",
        data: [
          {
            instrument_id: "BTC_USDT",
            exchange_name: "OKX",
            current_price: 68000,
            open_interest_usd: 100,
          },
          {
            instrument_id: "BTCUSDT",
            exchange_name: "Binance",
            current_price: 68123.45,
            price_change_percent_24h: 1.25,
            volume_usd: 9000000,
            open_interest_usd: 4000000,
            open_interest_change_percent_24h: -2.5,
            funding_rate: 0.0001,
            long_liquidation_usd_24h: 1200,
            short_liquidation_usd_24h: 3400,
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await coinglassAdapter().fetch("BTC/USD", "crypto", readEnv);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0] ?? [];
    expect(String(requestUrl)).toBe(
      "https://open-api-v4.coinglass.com/api/futures/pairs-markets?symbol=BTC",
    );
    expect(requestInit?.headers).toEqual({
      accept: "application/json",
      "CG-API-KEY": "test-only-key",
    });
    expect(result).toMatchObject({
      instrument: "BTC/USD",
      assetClass: "crypto",
      price: 68123.45,
      change24h: 1.25,
      volume24h: 9000000,
      openInterestUsd: 4000000,
      openInterestChange24h: -2.5,
      fundingRate: 0.0001,
      longLiquidationUsd24h: 1200,
      shortLiquidationUsd24h: 3400,
      provider: "coinglass",
      quality: "VERIFIED",
    });
  });

  it("returns null rather than inventing a price for invalid market data", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        code: "0",
        data: [{ instrument_id: "BTCUSDT", exchange_name: "Binance", current_price: 0 }],
      }), { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(coinglassAdapter().fetch("BTC/USD", "crypto", readEnv)).resolves.toBeNull();
  });

  it("does not make a network request when credentials are absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      coinglassAdapter().fetch("BTC/USD", "crypto", () => undefined),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
