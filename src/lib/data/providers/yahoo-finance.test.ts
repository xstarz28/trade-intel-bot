import { describe, expect, it } from "vitest";
import {
  fetchYahooFinanceCandles,
  fetchYahooFinanceMarketCandles,
  resolveYahooFinanceMarketCandidates,
  parseYahooFinanceCandles,
  resolveYahooFinanceStockSymbol,
  resolveYahooFinanceMarketSymbol,
  resolveYahooFinanceComparatorSymbol,
  resolveYahooFinanceComparatorSymbols,
} from "./yahoo-finance";

function payload() {
  return {
    chart: {
      result: [{
        timestamp: [1_800_000_000, 1_800_000_300, 1_800_000_600, 1_800_000_900],
        indicators: {
          quote: [{
            open: [10, 11, null, 13],
            high: [12, 13, 14, 14],
            low: [9, 10, 12, 12],
            close: [11, 12, 13, 13.5],
            volume: [100, null, 300, 400],
          }],
        },
      }],
    },
  };
}

describe("free Yahoo Finance stock fallback", () => {
  it("resolves canonical IDX shares and provider-discovered .JK tickers to exact Yahoo tickers", () => {
    expect(resolveYahooFinanceStockSymbol("BBCA")).toBe("BBCA.JK");
    expect(resolveYahooFinanceStockSymbol("ADRO.JK")).toBe("ADRO.JK");
    expect(resolveYahooFinanceStockSymbol("AAPL")).toBe("AAPL");
    expect(resolveYahooFinanceStockSymbol("EUR/USD")).toBeNull();
    expect(resolveYahooFinanceStockSymbol("BTC-USDT-SWAP")).toBeNull();
  });


  it("maps only exact supported FX/metals instruments to free Yahoo tickers", () => {
    expect(resolveYahooFinanceMarketSymbol("forex", "EUR/USD")).toBe("EURUSD=X");
    expect(resolveYahooFinanceMarketSymbol("forex", "USD/JPY")).toBe("JPY=X");
    expect(resolveYahooFinanceMarketSymbol("forex", "USD/IDR")).toBe("IDR=X");
    expect(resolveYahooFinanceMarketSymbol("forex", "EUR/IDR")).toBe("EURIDR=X");
    expect(resolveYahooFinanceMarketSymbol("commodity", "XAU/USD")).toBe("XAUUSD=X");
    expect(resolveYahooFinanceMarketSymbol("commodity", "XAGUSD")).toBe("XAGUSD=X");
    expect(resolveYahooFinanceMarketSymbol("commodity", "WTI")).toBe("CL=F");
    expect(resolveYahooFinanceMarketSymbol("commodity", "BRENT")).toBe("BZ=F");
    expect(resolveYahooFinanceMarketSymbol("commodity", "NGAS")).toBe("NG=F");
    expect(resolveYahooFinanceMarketSymbol("commodity", "COPPER")).toBe("HG=F");
    expect(resolveYahooFinanceMarketSymbol("forex", "BTC/USDT")).toBeNull();
    expect(resolveYahooFinanceMarketSymbol("commodity", "LITHIUM")).toBeNull();
  });

  it("maps cross-asset context only to actual index symbols", () => {
    expect(resolveYahooFinanceComparatorSymbol("DXY")).toBe("DX-Y.NYB");
    expect(resolveYahooFinanceComparatorSymbol("NDX")).toBe("^NDX");
    expect(resolveYahooFinanceComparatorSymbol("SPX")).toBeNull();
    expect(resolveYahooFinanceComparatorSymbols("DXY")).toEqual([
      { symbol: "DX-Y.NYB", label: "DXY" },
      { symbol: "DX=F", label: "DXY futures proxy (DX=F)" },
    ]);
    expect(resolveYahooFinanceComparatorSymbols("NDX")).toEqual([
      { symbol: "^NDX", label: "NDX" },
      { symbol: "NQ=F", label: "Nasdaq-100 futures proxy (NQ=F)" },
    ]);
  });

  it("tries exact spot metals before clearly labeled futures proxies", () => {
    expect(resolveYahooFinanceMarketCandidates("commodity", "XAU/USD")).toEqual([
      { symbol: "XAUUSD=X", label: "Yahoo Finance spot ticker XAUUSD=X" },
      { symbol: "GC=F", label: "Yahoo Finance gold futures proxy GC=F (not spot XAU/USD)" },
    ]);
    expect(resolveYahooFinanceMarketCandidates("commodity", "XAG/USD")).toEqual([
      { symbol: "XAGUSD=X", label: "Yahoo Finance spot ticker XAGUSD=X" },
      { symbol: "SI=F", label: "Yahoo Finance silver futures proxy SI=F (not spot XAG/USD)" },
    ]);
  });

  it("falls back from unavailable spot gold to real GC=F candles with explicit proxy provenance", async () => {
    const requested: string[] = [];
    const result = await fetchYahooFinanceMarketCandles("commodity", "XAU/USD", "M5", 2, async (input) => {
      const url = new URL(String(input));
      const symbol = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      requested.push(symbol);
      if (symbol === "XAUUSD=X") {
        return new Response(JSON.stringify({ chart: { error: { description: "No data found" }, result: null } }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect(requested).toEqual(["XAUUSD=X", "GC=F"]);
    expect(result.symbol).toBe("GC=F");
    expect(result.providerLabel).toContain("futures proxy");
    expect(result.providerLabel).toContain("not spot XAU/USD");
    expect(result.candles).toHaveLength(2);
  });

  it("parses ordered, complete candles and excludes invalid OHLC rows", () => {
    const candles = parseYahooFinanceCandles(payload(), 10);
    expect(candles).toHaveLength(3);
    expect(candles.map((item) => item.close)).toEqual([11, 12, 13.5]);
    expect(candles.map((item) => item.timestamp)).toEqual([1_800_000_000_000, 1_800_000_300_000, 1_800_000_900_000]);
    expect(candles[1].volume).toBe(0);
  });

  it("caps to requested outputsize and rejects empty/invalid chart payloads", () => {
    expect(parseYahooFinanceCandles(payload(), 1)).toHaveLength(1);
    expect(() => parseYahooFinanceCandles({ chart: { result: [] } }, 200))
      .toThrow(/no chart data/i);
    expect(() => parseYahooFinanceCandles({
      chart: { result: [{ timestamp: [1], indicators: { quote: [{ open: [null], high: [null], low: [null], close: [null] }] } }] },
    }, 200)).toThrow(/no valid OHLCV candles/i);
  });

  it("aggregates H4 from four real hourly candles and discards partial fragments", async () => {
    let requestedUrl = "";
    const baseTime = 1_800_000_000;
    const open = [100, 101, 102, 103, 104, 105, 106];
    const payload = {
      chart: {
        result: [{
          timestamp: open.map((_, index) => baseTime + index * 3600),
          indicators: {
            quote: [{
              open,
              high: open.map((value) => value + 1),
              low: open.map((value) => value - 1),
              close: open.map((value) => value + 0.5),
              volume: open.map(() => 100),
            }],
          },
        }],
      },
    };

    const candles = await fetchYahooFinanceCandles("AAPL", "H4", 10, async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(requestedUrl).toContain("interval=60m");
    expect(candles).toHaveLength(1);
    expect(candles[0]).toEqual({
      timestamp: baseTime * 1000,
      open: 100,
      high: 104,
      low: 99,
      close: 103.5,
      volume: 400,
    });
  });

  it("requests the exact Yahoo ticker and correct M5 query through an injected transport", async () => {
    let requestedUrl = "";
    const candles = await fetchYahooFinanceCandles("BBCA.JK", "M5", 2, async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(payload()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    expect(requestedUrl).toContain("/chart/BBCA.JK?");
    expect(requestedUrl).toContain("interval=5m");
    expect(requestedUrl).toContain("range=60d");
    expect(candles).toHaveLength(2);
  });
});
