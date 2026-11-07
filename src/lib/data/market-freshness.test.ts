import { describe, expect, it } from "vitest";
import { classifyMarketDataFreshness } from "./market-freshness";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

describe("candle-aware market-data freshness", () => {
  it("keeps a forming daily candle current instead of marking it stale after one hour", () => {
    expect(classifyMarketDataFreshness(1_000, 1_000 + 12 * hour, "D1")).toBe("realtime");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 36 * hour, "D1")).toBe("delayed");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 3 * day, "D1")).toBe("stale");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 5 * day, "D1")).toBe("unavailable");
  });

  it("uses the weekly candle interval while preserving a finite stale cutoff", () => {
    expect(classifyMarketDataFreshness(1_000, 1_000 + 5 * day, "W1")).toBe("realtime");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 10 * day, "W1")).toBe("stale");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 12 * day, "W1")).toBe("stale");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 15 * day, "W1")).toBe("unavailable");
  });

  it("retains appropriately tight freshness windows for intraday candles", () => {
    expect(classifyMarketDataFreshness(1_000, 1_000 + 30 * minute, "H1")).toBe("delayed");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 90 * minute, "H1")).toBe("stale");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 12 * hour, "H1")).toBe("stale");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 49 * hour, "H1")).toBe("unavailable");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 3 * minute, "M5")).toBe("realtime");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 7 * minute, "M5")).toBe("delayed");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 30 * minute, "M5")).toBe("stale");
  });

  it("normalizes timeframe aliases and fails closed on invalid or future timestamps", () => {
    expect(classifyMarketDataFreshness(1_000, 1_000 + 12 * hour, "1D")).toBe("realtime");
    expect(classifyMarketDataFreshness(2_000, 1_000, "D1")).toBe("unavailable");
    expect(classifyMarketDataFreshness(0, 1_000, "D1")).toBe("unavailable");
    expect(classifyMarketDataFreshness(1_000, 1_000 + 2 * hour, "unknown")).toBe("stale");
  });
});
