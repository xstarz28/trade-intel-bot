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
});
