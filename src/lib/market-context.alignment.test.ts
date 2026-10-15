import { describe, expect, it } from "vitest";
import { alignCrossAssetCloses, pearsonCorrelation } from "./market-context";

describe("alignCrossAssetCloses", () => {
  it("aligns candle opens and closes within a timeframe tolerance", () => {
    const primary = Array.from({ length: 24 }, (_, i) => ({
      timestamp: 1_800_000_000_000 + i * 300_000,
      close: 100 + i,
    }));
    const comparator = Array.from({ length: 24 }, (_, i) => ({
      // A vendor timestamping bars one minute later must not erase all overlap.
      timestamp: 1_800_000_000_000 + i * 300_000 + 60_000,
      close: 200 + i * 2,
    }));
    const aligned = alignCrossAssetCloses(primary, comparator, "M5");
    expect(aligned.primary).toHaveLength(24);
    expect(aligned.comparator).toHaveLength(24);
    expect(pearsonCorrelation(aligned.primary, aligned.comparator)?.correlation).toBeCloseTo(1, 8);
  });

  it("does not reuse comparator bars or match unrelated timestamps", () => {
    const primary = [
      { timestamp: 1_800_000_000_000, close: 100 },
      { timestamp: 1_800_000_300_000, close: 101 },
      { timestamp: 1_800_000_600_000, close: 102 },
    ];
    const comparator = [
      { timestamp: 1_800_000_060_000, close: 200 },
      { timestamp: 1_800_000_600_000 + 60_000, close: 202 },
      { timestamp: 1_800_100_000_000, close: 999 },
    ];
    const aligned = alignCrossAssetCloses(primary, comparator, "M5");
    expect(aligned.primary).toHaveLength(2);
    expect(new Set(aligned.comparator).size).toBe(2);
  });

  it("returns no pairs when the timeframe is unsupported", () => {
    const bars = [{ timestamp: 1_800_000_000_000, close: 100 }];
    expect(alignCrossAssetCloses(bars, bars, "TICK")).toEqual({ primary: [], comparator: [] });
  });
});
