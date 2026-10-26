import { describe, expect, it, vi } from "vitest";
import { fetchHistoricalBinanceSpotOhlcv } from "./historical-ohlcv";

const minute = 60_000;
const now = Math.floor(1_700_000_000_000 / minute) * minute;

function row(openTime: number, overrides: Record<number, unknown> = []) {
  const values: unknown[] = [
    openTime, "100", "105", "98", "103", "12",
    openTime + minute - 1, "1200", 20, "4", "400", "0",
  ];
  for (const [key, value] of Object.entries(overrides)) values[Number(key)] = value;
  return values;
}

function response(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as Response;
}

describe("fetchHistoricalBinanceSpotOhlcv", () => {
  it("returns normalized candles and reproducibility provenance", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([row(now - 5 * minute), row(now - 4 * minute)]));
    const result = await fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - 5 * minute, endTime: now - 4 * minute,
    }, { fetchImpl, now: () => now });

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(new URL(fetchImpl.mock.calls[0][0]).searchParams.get("symbol")).toBe("BTCUSDT");
    expect(result).toMatchObject({
      provider: "binance-spot",
      instrumentId: "BTCUSDT",
      timeframe: "1m",
      candleCount: 2,
      actualRange: { startTime: now - 5 * minute, endTime: now - 4 * minute },
      gaps: [],
    });
    expect(result.candles[0]).toEqual({
      timestamp: now - 5 * minute, open: 100, high: 105, low: 98, close: 103, volume: 12,
    });
  });

  it("excludes an in-progress candle", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([row(now - minute), row(now)]));
    const result = await fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - minute, endTime: now,
    }, { fetchImpl, now: () => now });
    expect(result.candleCount).toBe(1);
  });

  it("reports missing bars without fabricating candles", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([row(now - 5 * minute), row(now - 2 * minute)]));
    const result = await fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - 5 * minute, endTime: now - 2 * minute,
    }, { fetchImpl, now: () => now });
    expect(result.candleCount).toBe(2);
    expect(result.gaps).toEqual([{
      expectedTimestamp: now - 4 * minute,
      nextObservedTimestamp: now - 2 * minute,
      missingBars: 2,
    }]);
    expect(result.warnings.join(" ")).toContain("missing bars were not synthesized");
  });

  it("rejects malformed OHLC and duplicate timestamps", async () => {
    const malformed = row(now - 5 * minute);
    malformed[2] = "90";
    await expect(fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - 5 * minute, endTime: now - 4 * minute,
    }, { fetchImpl: vi.fn().mockResolvedValue(response([malformed])), now: () => now }))
      .rejects.toThrow(/invalid OHLCV/);

    await expect(fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - 5 * minute, endTime: now - 4 * minute,
    }, { fetchImpl: vi.fn().mockResolvedValue(response([row(now - 5 * minute), row(now - 5 * minute)])), now: () => now }))
      .rejects.toThrow(/duplicate or non-ascending/);
  });

  it("rejects candle timestamps that are not aligned to the requested interval", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([row(now - 5 * minute + 1000)]));
    await expect(fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - 5 * minute, endTime: now - 4 * minute,
    }, { fetchImpl, now: () => now })).rejects.toThrow(/invalid OHLCV/);
  });

  it("warns when a near-current request returns stale provider history", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([row(now - 5 * minute)]));
    const result = await fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - 10 * minute, endTime: now,
    }, { fetchImpl, now: () => now });
    expect(result.warnings.join(" ")).toContain("appears stale");
  });

  it("falls back to a public market-data mirror when the primary host is geo-blocked", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response({}, false, 451))
      .mockResolvedValueOnce(response([row(now - 5 * minute)]));
    const result = await fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - 5 * minute, endTime: now - 4 * minute,
    }, {
      fetchImpl,
      now: () => now,
      baseUrls: ["https://api.binance.com", "https://data-api.binance.vision"],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new URL(fetchImpl.mock.calls[0][0]).host).toBe("api.binance.com");
    expect(new URL(fetchImpl.mock.calls[1][0]).host).toBe("data-api.binance.vision");
    expect(result.candleCount).toBe(1);
  });

  it("rejects invalid ranges and reports HTTP errors clearly", async () => {
    await expect(fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now, endTime: now,
    }, { fetchImpl: vi.fn(), now: () => now })).rejects.toThrow(/endTime > startTime/);

    await expect(fetchHistoricalBinanceSpotOhlcv({
      symbol: "BTCUSDT", interval: "1m", startTime: now - minute, endTime: now,
    }, { fetchImpl: vi.fn().mockResolvedValue(response({}, false, 429)), now: () => now }))
      .rejects.toThrow(/HTTP 429/);
  });
});
