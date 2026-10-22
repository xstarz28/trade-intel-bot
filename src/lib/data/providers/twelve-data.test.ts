import { afterEach, describe, expect, it, vi } from "vitest";
import { TwelveDataProvider } from "./twelve-data";

afterEach(() => {
  vi.unstubAllGlobals();
});

function responseFor(values: Array<Record<string, string>>) {
  return new Response(JSON.stringify({ values }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function quoteResponseFor(payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("TwelveDataProvider candle validation", () => {
  it("filters malformed candles and returns valid OHLCV rows in chronological order", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFor([
      {
        datetime: "2026-10-22T10:00:00Z",
        open: "101", high: "100", low: "99", close: "100", volume: "12",
      },
      {
        datetime: "2026-10-22T09:55:00Z",
        open: "98", high: "102", low: "97", close: "101", volume: "",
      },
    ])));

    const provider = new TwelveDataProvider({ apiKey: "test-key", baseUrl: "https://example.test" });
    const candles = await provider.fetchCandles("EUR/USD", "M5", 10);

    expect(candles).toEqual([{
      timestamp: Date.parse("2026-10-22T09:55:00Z"),
      open: 98,
      high: 102,
      low: 97,
      close: 101,
      volume: 0,
    }]);
  });

  it("throws rather than returning an empty or malformed candle set", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFor([
      {
        datetime: "2026-10-22T10:00:00Z",
        open: "101", high: "100", low: "99", close: "Infinity", volume: "12",
      },
    ])));

    const provider = new TwelveDataProvider({ apiKey: "test-key", baseUrl: "https://example.test" });
    await expect(provider.fetchCandles("EUR/USD", "M5", 10))
      .rejects.toThrow(/no valid OHLCV candles/i);
  });

  it("uses the provider timestamp for price snapshots instead of local fetch time", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(quoteResponseFor({
      close: "123.45",
      timestamp: "1792663200",
      bid: "123.40",
      ask: "123.50",
    })));

    const provider = new TwelveDataProvider({ apiKey: "test-key", baseUrl: "https://example.test" });
    await expect(provider.fetchPrice("EUR/USD")).resolves.toEqual({
      price: 123.45,
      timestamp: 1_792_663_200_000,
      source: "twelve-data",
      bid: 123.4,
      ask: 123.5,
    });
  });

  it("rejects a price snapshot when the provider timestamp is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(quoteResponseFor({ close: "123.45" })));

    const provider = new TwelveDataProvider({ apiKey: "test-key", baseUrl: "https://example.test" });
    await expect(provider.fetchPrice("EUR/USD"))
      .rejects.toThrow(/invalid quote timestamp/i);
  });
});
