import { describe, expect, it, vi } from "vitest";
import { normalizeOkxSpotCandles, OkxSpotMarketAdapter, toOkxSpotBar, toOkxSpotInstrument } from "./okx-spot-market-adapter";

describe("OKX spot market adapter", () => {
  it("maps symbols and bars", () => {
    expect(toOkxSpotInstrument("BTC/USD")).toBe("BTC-USDT");
    expect(toOkxSpotInstrument("eth/usd")).toBe("ETH-USDT");
    expect(toOkxSpotInstrument("bad")).toBeNull();
    expect(toOkxSpotBar("M15")).toBe("15m");
    expect(toOkxSpotBar("H1")).toBe("1H");
  });

  it("normalizes candles chronologically and discards invalid rows", () => {
    const candles = normalizeOkxSpotCandles({ data: [
      ["3000", "103", "105", "102", "104", "20"],
      ["2000", "bad", "104", "101", "103", "18"],
      ["1000", "102", "104", "101", "103", "18"],
    ] }, 20);
    expect(candles).toHaveLength(2);
    expect(candles[0].timestamp).toBe(1000);
    expect(candles[1].timestamp).toBe(3000);
  });

  it("uses public endpoint and rejects provider errors", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ code: "0", data: [["1700000000000", "10", "11", "9", "10.5", "25"]] }),
    });
    const adapter = new OkxSpotMarketAdapter(mockFetch as unknown as typeof fetch);
    expect((await adapter.fetchCandles("BTC/USD", "M1", 50))[0].close).toBe(10.5);
    expect(String(mockFetch.mock.calls[0][0])).toContain("instId=BTC-USDT");
    const failing = new OkxSpotMarketAdapter(vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: "Forbidden", json: async () => ({ msg: "blocked" }),
    }) as unknown as typeof fetch);
    await expect(failing.fetchCandles("BTC/USD", "M5", 20)).rejects.toThrow("HTTP 403");
  });
});
