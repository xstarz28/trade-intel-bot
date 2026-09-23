import { describe, expect, it } from "vitest";
import {
  discoverTwelveDataInstruments,
  type TwelveDataDiscoveryKind,
} from "./twelvedata-discovery";

function mockFetch(
  responses: Record<
    string,
    { status?: number; body: unknown }
  >,
) {
  return async (input: string) => {
    const url = new URL(input);
    const endpoint = url.pathname.split("/").pop() ?? "";
    const response = responses[endpoint] ?? { status: 200, body: { status: "ok", data: [] } };

    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
}

describe("Phase 158 — Twelve Data provider-native discovery", () => {
  it("discovers instruments across supported datasets without a whitelist", async () => {
    const result = await discoverTwelveDataInstruments({
      apiKey: "test-key",
      now: 123456,
      fetchImpl: mockFetch({
        stocks: {
          body: {
            status: "ok",
            data: [
              {
                symbol: "AAPL",
                name: "Apple Inc",
                exchange: "NASDAQ",
                country: "United States",
                type: "Common Stock",
              },
              {
                symbol: "ZZZZ",
                name: "Previously unknown symbol",
                exchange: "TESTX",
                country: "Testland",
                type: "Common Stock",
              },
            ],
          },
        },
        forex_pairs: {
          body: {
            status: "ok",
            data: [{ symbol: "EUR/USD", currency_group: "Major" }],
          },
        },
        cryptocurrencies: {
          body: {
            status: "ok",
            data: [{ symbol: "ETH/BTC", currency_base: "Ethereum", currency_quote: "Bitcoin" }],
          },
        },
        commodities: {
          body: {
            status: "ok",
            data: [{ symbol: "XAG/AUD", name: "Silver Spot", category: "Precious Metal" }],
          },
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.discoveredAt).toBe(123456);
    expect(result.instruments.map((x) => x.providerInstrumentId)).toEqual([
      "AAPL",
      "ZZZZ",
      "EUR/USD",
      "ETH/BTC",
      "XAG/AUD",
    ]);
  });

  it("preserves provider-native identity exactly", async () => {
    const result = await discoverTwelveDataInstruments({
      apiKey: "test-key",
      kinds: ["cryptocurrencies"],
      fetchImpl: mockFetch({
        cryptocurrencies: {
          body: {
            status: "ok",
            data: [{ symbol: "ETH/BTC" }],
          },
        },
      }),
    });

    expect(result.instruments[0]?.provider).toBe("twelve-data");
    expect(result.instruments[0]?.providerInstrumentId).toBe("ETH/BTC");
    expect(result.instruments[0]?.assetClass).toBe("crypto");
  });

  it("drops malformed rows without inventing symbols", async () => {
    const result = await discoverTwelveDataInstruments({
      apiKey: "test-key",
      kinds: ["stocks"],
      fetchImpl: mockFetch({
        stocks: {
          body: {
            status: "ok",
            data: [
              { name: "No symbol" },
              { symbol: "" },
              { symbol: "MSFT", name: "Microsoft Corp" },
            ],
          },
        },
      }),
    });

    expect(result.instruments).toHaveLength(1);
    expect(result.instruments[0]?.providerInstrumentId).toBe("MSFT");
  });

  it("reports a failed dataset while retaining successful datasets", async () => {
    const result = await discoverTwelveDataInstruments({
      apiKey: "test-key",
      kinds: ["stocks", "forex_pairs"] satisfies TwelveDataDiscoveryKind[],
      fetchImpl: mockFetch({
        stocks: {
          body: {
            status: "ok",
            data: [{ symbol: "AAPL" }],
          },
        },
        forex_pairs: {
          status: 503,
          body: { status: "error", message: "temporarily unavailable" },
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.failedKinds).toEqual(["forex_pairs"]);
    expect(result.instruments.map((x) => x.providerInstrumentId)).toEqual([
      "AAPL",
    ]);
  });

  it("marks the whole discovery unavailable when every requested dataset fails", async () => {
    const result = await discoverTwelveDataInstruments({
      apiKey: "test-key",
      kinds: ["stocks", "commodities"],
      fetchImpl: mockFetch({
        stocks: {
          status: 503,
          body: { status: "error", message: "down" },
        },
        commodities: {
          status: 500,
          body: { status: "error", message: "down" },
        },
      }),
    });

    expect(result.success).toBe(false);
    expect(result.instruments).toEqual([]);
    expect(result.failedKinds).toEqual(["stocks", "commodities"]);
    expect(result.error).toContain("all requested datasets");
  });
});
