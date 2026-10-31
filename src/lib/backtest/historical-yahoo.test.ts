import { describe, expect, it } from "vitest";
import { fetchHistoricalYahooFinanceOhlcv, type HistoricalYahooRequest } from "./historical-yahoo";

function yahooPayload(timestamps: number[], volume: Array<number | null> = timestamps.map(() => 100)) {
  return {
    chart: {
      result: [{
        timestamp: timestamps,
        indicators: {
          quote: [{
            open: timestamps.map(() => 100),
            high: timestamps.map(() => 102),
            low: timestamps.map(() => 99),
            close: timestamps.map(() => 101),
            volume,
          }],
        },
      }],
    },
  };
}

describe("fetchHistoricalYahooFinanceOhlcv", () => {
  it("fetches exact FX history, preserves canonical/provider identity, and leaves unavailable volume at zero", async () => {
    const timestamp = 1_700_000_000_000;
    let requestedUrl = "";
    const dataset = await fetchHistoricalYahooFinanceOhlcv({
      symbol: "EUR/USD",
      instrumentType: "forex",
      interval: "1h",
      startTime: timestamp,
      endTime: timestamp,
    }, {
      now: () => timestamp + 2 * 60 * 60_000,
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify(yahooPayload([Math.floor(timestamp / 1000)], [null])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(requestedUrl).toContain("EURUSD%3DX");
    expect(requestedUrl).toContain("period1=");
    expect(requestedUrl).toContain("period2=");
    expect(dataset).toMatchObject({
      provider: "yahoo-finance-public",
      instrumentId: "EUR/USD",
      providerInstrumentId: "EURUSD=X",
      instrumentType: "forex",
      timeframe: "1h",
      timestampAlignment: "PROVIDER_SESSION",
      sessionCalendar: "OTC_FX_SESSION_UNVERIFIED",
      candleCount: 1,
    });
    expect(dataset.candles[0].volume).toBe(0);
    expect(dataset.warnings?.some((warning) => warning.includes("no usable volume"))).toBe(true);
  });

  it("uses only an explicitly labeled equivalent futures family when the requested metal spot ticker is unavailable", async () => {
    const timestamp = 1_700_000_000_000;
    const calls: string[] = [];
    const dataset = await fetchHistoricalYahooFinanceOhlcv({
      symbol: "XAU/USD",
      instrumentType: "commodity",
      interval: "1d",
      startTime: timestamp,
      endTime: timestamp,
    }, {
      now: () => timestamp + 2 * 24 * 60 * 60_000,
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("XAUUSD%3DX")) return new Response("{}", { status: 404 });
        return new Response(JSON.stringify(yahooPayload([Math.floor(timestamp / 1000)])), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("XAUUSD%3DX");
    expect(calls[1]).toContain("GC%3DF");
    expect(dataset.instrumentId).toBe("XAU/USD");
    expect(dataset.providerInstrumentId).toBe("GC=F");
    expect(dataset.warnings?.some((warning) => warning.includes("not spot XAU/USD"))).toBe(true);
  });

  it("drops unfinished candles and records provider-session breaks without filling them", async () => {
    const first = 1_700_000_000_000;
    const second = first + 72 * 60 * 60_000;
    const dataset = await fetchHistoricalYahooFinanceOhlcv({
      symbol: "AAPL",
      instrumentType: "stock",
      interval: "1d",
      startTime: first,
      endTime: second,
    }, {
      now: () => second + 12 * 60 * 60_000,
      fetchImpl: async () => new Response(JSON.stringify(yahooPayload([
        Math.floor(first / 1000),
        Math.floor(second / 1000),
      ])), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });

    expect(dataset.candleCount).toBe(1);
    expect(dataset.candles[0].timestamp).toBe(first);
    expect(dataset.gaps).toHaveLength(0);
  });

  it("fails closed for unsupported provider instruments and timeframes", async () => {
    await expect(fetchHistoricalYahooFinanceOhlcv({
      symbol: "UNKNOWN-COMMODITY",
      instrumentType: "commodity",
      interval: "1d",
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
    })).rejects.toThrow(/No exact Yahoo Finance historical symbol/);

    await expect(fetchHistoricalYahooFinanceOhlcv({
      symbol: "AAPL",
      instrumentType: "stock",
      interval: "4h",
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
    } as unknown as HistoricalYahooRequest)).rejects.toThrow(/supports only 1h, 1d, and 1w/);
  });

  it("does not amplify a Yahoo rate-limit response by trying a second market candidate", async () => {
    let calls = 0;
    await expect(fetchHistoricalYahooFinanceOhlcv({
      symbol: "XAU/USD",
      instrumentType: "commodity",
      interval: "1d",
      startTime: 1_700_000_000_000,
      endTime: 1_700_086_400_000,
    }, {
      fetchImpl: async () => {
        calls += 1;
        return new Response("rate limited", { status: 429 });
      },
    })).rejects.toThrow(/HTTP 429/);
    expect(calls).toBe(1);
  });
});
