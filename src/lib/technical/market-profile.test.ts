import { describe, expect, it } from "vitest";
import {
  calculateTpoProfile,
  calculateVpvrProfile,
  type ProfileCandle,
} from "./market-profile";

function candles(volume: number | null = 10): ProfileCandle[] {
  return Array.from({ length: 40 }, (_, i) => {
    const center = 100 + Math.sin(i / 3) * 2;
    return {
      timestamp: 1_800_000_000_000 + i * 15 * 60_000,
      open: center - 0.4,
      high: center + 1,
      low: center - 1,
      close: center + (i % 2 ? 0.3 : -0.3),
      volume,
    };
  });
}

describe("TPO and VPVR profile calculations", () => {
  it("calculates a TPO profile with POC and a bounded value area", () => {
    const result = calculateTpoProfile(candles(), { rows: 40, blockMinutes: 30 });
    expect(result.available).toBe(true);
    expect(result.method).toBe("time-price-opportunity");
    expect(result.poc).toBeGreaterThan(0);
    expect(result.val).toBeLessThanOrEqual(result.poc!);
    expect(result.vah).toBeGreaterThanOrEqual(result.poc!);
    expect(result.rows).toHaveLength(40);
  });

  it("calculates VPVR only when volume is usable and labels the approximation", () => {
    const result = calculateVpvrProfile(candles(100), { rows: 32 });
    expect(result.available).toBe(true);
    expect(result.method).toBe("ohlcv-range-allocation");
    expect(result.approximation).toContain("not true trade-level volume-at-price");
    expect(result.total).toBeGreaterThan(0);
    expect(result.val).toBeLessThanOrEqual(result.poc!);
    expect(result.vah).toBeGreaterThanOrEqual(result.poc!);
  });

  it("does not invent VPVR when volume is missing or zero", () => {
    expect(calculateVpvrProfile(candles(null)).available).toBe(false);
    expect(calculateVpvrProfile(candles(0)).available).toBe(false);
  });

  it("rejects insufficient candle history for both profiles", () => {
    expect(calculateTpoProfile(candles().slice(0, 10)).available).toBe(false);
    expect(calculateVpvrProfile(candles().slice(0, 10)).available).toBe(false);
  });
});
