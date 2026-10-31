import { describe, expect, it } from "vitest";
import type { OhlcvCandle } from "./market-types";
import { calculateAdvancedTechnicalIndicators } from "./advanced-technical";
import { calculateTechnical } from "./technical";

function trendCandles(count: number, start = 100): OhlcvCandle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = start + index;
    return {
      timestamp: 1_700_000_000_000 + index * 60_000,
      open: close - 0.5,
      high: close + 1,
      low: close - 1,
      close,
      volume: 100 + index,
    };
  });
}

describe("advanced technical indicators", () => {
  it("calculates Wilder ADX/DMI from directional movement without changing core structure", () => {
    const result = calculateAdvancedTechnicalIndicators(trendCandles(60));
    expect(result?.adx14?.value).toBeGreaterThan(20);
    expect(result?.adx14?.plusDi).toBeGreaterThan(result?.adx14?.minusDi ?? Infinity);
    expect(result?.adx14?.strength).toBe("STRONG");
  });

  it("calculates Bollinger bandwidth and percent-B from a population standard deviation", () => {
    const history = trendCandles(40).map((candle, index) => ({
      ...candle,
      close: 100 + Math.sin(index / 2) * 5,
      high: 106 + Math.sin(index / 2) * 5,
      low: 94 + Math.sin(index / 2) * 5,
      open: 100 + Math.sin(index / 2) * 5,
    }));
    const result = calculateAdvancedTechnicalIndicators(history);
    expect(result?.bollinger20?.upper).toBeGreaterThan(result?.bollinger20?.middle ?? Infinity);
    expect(result?.bollinger20?.middle).toBeGreaterThan(result?.bollinger20?.lower ?? Infinity);
    expect(result?.bollinger20?.bandwidthPct).toBeGreaterThan(0);
    expect(Number.isFinite(result?.bollinger20?.percentB)).toBe(true);
  });

  it("calculates smoothed stochastic %K and %D within the 0-100 range", () => {
    const result = calculateAdvancedTechnicalIndicators(trendCandles(40));
    expect(result?.stochastic14?.percentK).toBeGreaterThanOrEqual(0);
    expect(result?.stochastic14?.percentK).toBeLessThanOrEqual(100);
    expect(result?.stochastic14?.percentD).toBeGreaterThanOrEqual(0);
    expect(result?.stochastic14?.percentD).toBeLessThanOrEqual(100);
  });

  it("keeps the latest stochastic when an older rolling window was flat", () => {
    const history = trendCandles(40).map((candle, index) => index < 14
      ? { ...candle, open: 100, high: 100, low: 100, close: 100 }
      : candle);
    const result = calculateAdvancedTechnicalIndicators(history);
    expect(result?.stochastic14?.percentK).toBeDefined();
    expect(result?.stochastic14?.percentD).toBeDefined();
  });

  it("uses the previous 20 completed candles for Donchian breakout levels", () => {
    const history = trendCandles(21).map((candle) => ({
      ...candle,
      open: 100,
      high: 110,
      low: 90,
      close: 100,
    }));
    history[20] = {
      ...history[20],
      open: 100,
      high: 200,
      low: 99,
      close: 150,
    };
    const result = calculateAdvancedTechnicalIndicators(history);
    expect(result?.donchian20).toMatchObject({
      upper: 110,
      lower: 90,
      middle: 100,
      breakout: "ABOVE",
    });
  });

  it("calculates OBV and MFI only when real provider volume exists", () => {
    const result = calculateAdvancedTechnicalIndicators(trendCandles(40));
    expect(result?.volumeFlow?.obv).toBeGreaterThan(0);
    expect(result?.volumeFlow?.obvChange20).toBeGreaterThan(0);
    expect(result?.volumeFlow?.obvDirection).toBe("RISING");
    expect(result?.volumeFlow?.mfi14).toBe(100);

    const noVolume = trendCandles(40).map((candle) => ({ ...candle, volume: 0 }));
    expect(calculateAdvancedTechnicalIndicators(noVolume)?.volumeFlow).toBeUndefined();
  });

  it("does not label a short OBV delta as a 20-bar change", () => {
    const shortVolumeHistory = calculateAdvancedTechnicalIndicators(trendCandles(20));
    expect(shortVolumeHistory?.volumeFlow).toBeUndefined();

    const fullVolumeHistory = calculateAdvancedTechnicalIndicators(trendCandles(21));
    expect(fullVolumeHistory?.volumeFlow?.obvChange20).toBeDefined();
  });

  it("omits indicators when candle history is insufficient or malformed", () => {
    const shortHistory = trendCandles(10).map((candle) => ({ ...candle, volume: 0 }));
    expect(calculateAdvancedTechnicalIndicators(shortHistory)).toBeUndefined();

    const malformed = trendCandles(40);
    malformed[10] = { ...malformed[10], high: malformed[10].low - 1 };
    expect(calculateAdvancedTechnicalIndicators(malformed)).toBeUndefined();
  });

  it("wires optional advanced indicators into the existing technical result without removing legacy fields", () => {
    const technical = calculateTechnical(trendCandles(80));
    expect(technical.sma50).toBeDefined();
    expect(technical.rsi14).toBeDefined();
    expect(technical.macdHistogram).toBeDefined();
    expect(technical.atr14).toBeDefined();
    expect(technical.advancedIndicators?.adx14).toBeDefined();
    expect(technical.advancedIndicators?.bollinger20).toBeDefined();
    expect(technical.advancedIndicators?.stochastic14).toBeDefined();
    expect(technical.advancedIndicators?.donchian20).toBeDefined();
    expect(technical.advancedIndicators?.volumeFlow).toBeDefined();
  });
  it("rejects duplicate or descending candle timestamps", () => {
    const history = trendCandles(40);
    history[20] = { ...history[20], timestamp: history[19].timestamp };
    expect(calculateAdvancedTechnicalIndicators(history)).toBeUndefined();
  });

});
