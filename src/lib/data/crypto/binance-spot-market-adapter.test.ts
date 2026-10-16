import { describe, expect, it } from "vitest";
import {
  BinanceSpotMarketAdapter,
  normalizeBinanceSpotCandles,
  toBinanceSpotSymbol,
} from "./binance-spot-market-adapter";

const rows = [
  [1_800_000_000_000, "100", "103", "99", "102", "12.5"],
  [1_800_000_300_000, "102", "104", "101", "103", "10"],
  [1_800_000_300_000, "102", "104", "101", "103", "10"],
  [1_800_000_600_000, null, null, null, null, null],
];

describe("Binance public spot fallback", () => {
  it("maps only spot pairs and converts USD quote to USDT", () => {
    expect(toBinanceSpotSymbol("BTC/USD")).toBe("BTCUSDT");
    expect(toBinanceSpotSymbol("ETH-USDT")).toBe("ETHUSDT");
    expect(toBinanceSpotSymbol("SOL/USDC")).toBe("SOLUSDC");
    expect(toBinanceSpotSymbol("BTC/USD-SWAP")).toBeNull();
    expect(toBinanceSpotSymbol("BTC")).toBeNull();
  });

  it("normalizes valid OHLCV rows, sorts and deduplicates timestamps", () => {
    const candles = normalizeBinanceSpotCandles(rows, 10);
    expect(candles).toHaveLength(2);
    expect(candles.map((candle) => candle.timestamp)).toEqual([1_800_000_000_000, 1_800_000_300_000]);
    expect(candles[0]).toEqual({
      timestamp: 1_800_000_000_000,
      open: 100,
      high: 103,
      low: 99,
      close: 102,
      volume: 12.5,
    });
  });

  it("requests the exact public kline route and requested interval", async () => {
    let requestedUrl = "";
    const adapter = new BinanceSpotMarketAdapter(async (input) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const candles = await adapter.fetchCandles("BTC/USD", "M5", 2);
    expect(requestedUrl).toContain("/api/v3/klines?symbol=BTCUSDT");
    expect(requestedUrl).toContain("interval=5m");
    expect(requestedUrl).toContain("limit=2");
    expect(candles).toHaveLength(2);
  });

  it("rejects provider failures and invalid candle payloads", async () => {
    const failing = new BinanceSpotMarketAdapter(async () => new Response(
      JSON.stringify({ code: -1121, msg: "Invalid symbol." }),
      { status: 400, headers: { "content-type": "application/json" } },
    ));
    await expect(failing.fetchCandles("BTC/USD", "M5", 20)).rejects.toThrow(/Binance Spot HTTP 400/);
    expect(normalizeBinanceSpotCandles({ error: "no data" }, 20)).toEqual([]);
  });
});
