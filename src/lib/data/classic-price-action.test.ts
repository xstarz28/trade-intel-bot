import { describe, expect, it } from "vitest";
import { analyzeClassicPriceAction, detectIctUnicorn } from "./classic-price-action";
import type { OhlcvCandle } from "./market-types";

function candles(values: Array<[number, number, number, number]>): OhlcvCandle[] {
  return values.map(([open, high, low, close], i) => ({
    timestamp: 1700000000000 + i * 60000,
    open, high, low, close, volume: 1000,
  }));
}

describe("classic price action", () => {
  it("detects bullish pin bar and engulfing from OHLCV", () => {
    const data = candles([
      [100, 101, 99, 99.5],
      [99.5, 100.2, 97, 100],
      [100, 101, 99.8, 100.8],
      [100.8, 102, 100.5, 101.8],
      [101.8, 103, 101.5, 102.8],
      [102.8, 104, 102.6, 103.6],
      [103.6, 104.2, 103.4, 103.9],
      [103.9, 105, 103.7, 104.8],
      [104.8, 106, 104.5, 105.7],
      [105.7, 107, 105.4, 106.8],
    ]);
    const ctx = analyzeClassicPriceAction(data, "M5");
    expect(ctx.patterns.some((p) => p.name === "bullish_pin_bar")).toBe(true);
  });

  it("produces deterministic supply/demand context without synthetic prices", () => {
    const data = candles([
      [100, 102, 99.5, 101.5],
      [101.5, 101.8, 101.2, 101.4],
      [101.4, 105, 101.3, 104.8],
      [104.8, 106, 104.5, 105.8],
      [105.8, 106, 105.4, 105.6],
      [105.6, 102, 101.8, 102.2],
      [102.2, 103, 101.8, 102.8],
      [102.8, 100, 99.5, 99.8],
      [99.8, 101, 99.4, 100.8],
      [100.8, 102, 100.5, 101.7],
    ]);
    const ctx = analyzeClassicPriceAction(data, "H1");
    expect(ctx.supplyDemand.length).toBeGreaterThan(0);
    for (const zone of ctx.supplyDemand) {
      expect(zone.upper).toBeGreaterThan(zone.lower);
      expect(zone.index).toBeGreaterThanOrEqual(0);
      expect(zone.index).toBeLessThan(data.length);
    }
  });

  it("detects ICT Unicorn only from overlapping validated OB + fresh FVG", () => {
    const unicorn = detectIctUnicorn(
      [{ direction: "bearish", upper: 105, lower: 103, status: "fresh" }],
      [{ direction: "bearish", upper: 104.5, lower: 102.5, status: "fresh" }],
      "M5",
    );
    expect(unicorn).toEqual({
      direction: "bearish",
      lower: 103,
      upper: 104.5,
      timeframe: "M5",
      description: "Validated bearish order block overlaps a fresh bearish FVG.",
    });
  });

  it("does not create Unicorn from non-overlapping or invalidated zones", () => {
    expect(detectIctUnicorn(
      [{ direction: "bullish", upper: 105, lower: 104, status: "invalidated" }],
      [{ direction: "bullish", upper: 103, lower: 102, status: "fresh" }],
      "M5",
    )).toBeUndefined();
  });
});
