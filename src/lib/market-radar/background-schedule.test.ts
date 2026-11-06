import { describe, expect, it } from "vitest";
import {
  BACKGROUND_SCAN_TIMEFRAME_PASSES,
  RADAR_RANKING_REFRESH_INTERVAL_MS,
  selectBackgroundScanBatch,
  selectPriorityScanBatch,
  shouldRefreshRadarRanking,
} from "./background-schedule";

describe("persistent background scanner rotation", () => {
  it("visits every instrument in a pass before advancing the timeframe family", () => {
    const size = 4;
    expect(Array.from({ length: size }, (_, cursor) => selectBackgroundScanBatch(cursor, size).instrumentIndex))
      .toEqual([0, 1, 2, 3]);
    expect(selectBackgroundScanBatch(size, size)).toMatchObject({
      instrumentIndex: 0,
      timeframePass: 1,
      timeframes: ["H4", "W1"],
    });
  });

  it("covers M5, H1, H4, D1, and W1 across three complete passes", () => {
    const observed = new Set<string>();
    for (let cursor = 0; cursor < 3 * 2; cursor++) {
      for (const timeframe of selectBackgroundScanBatch(cursor, 2).timeframes) observed.add(timeframe);
    }
    expect([...observed].sort()).toEqual(["D1", "H1", "H4", "M5", "W1"]);
    expect(BACKGROUND_SCAN_TIMEFRAME_PASSES).toHaveLength(3);
  });


  it("prioritizes never-scanned and overdue instruments using their own refresh targets", () => {
    const universe = [
      { instrument: "BTC/USD", priority: 1, refreshIntervalMs: 5 * 60_000 },
      { instrument: "AAPL", priority: 30, refreshIntervalMs: 30 * 60_000 },
      { instrument: "XAU/USD", priority: 2, refreshIntervalMs: 5 * 60_000 },
    ];
    const sources = [
      { instrument: "BTC/USD", marketData: { fetchTimestamp: 9_000_000 } },
      { instrument: "AAPL", marketData: { fetchTimestamp: 9_000_000 } },
    ];
    const first = selectPriorityScanBatch(0, universe, sources, 9_000_001);
    expect(first.instrumentIndex).toBe(2);
    expect(first.timeframes).toEqual(["H1", "D1"]);

    const overdue = selectPriorityScanBatch(1, universe, [
      ...sources,
      { instrument: "XAU/USD", marketData: { fetchTimestamp: 8_000_000 } },
    ], 9_000_000);
    expect(overdue.instrumentIndex).toBe(2);
    expect(overdue.overdueByMs).toBe(700_000);
  });

  it("uses priority and cursor rotation as deterministic tie-breakers", () => {
    const universe = [
      { instrument: "LOW", priority: 20, refreshIntervalMs: 60_000 },
      { instrument: "HIGH", priority: 1, refreshIntervalMs: 60_000 },
    ];
    const first = selectPriorityScanBatch(0, universe, [], 1_000);
    expect(first.instrumentIndex).toBe(1);
    const tied = selectPriorityScanBatch(1, universe, [
      { instrument: "LOW", marketData: { fetchTimestamp: 1_000 } },
      { instrument: "HIGH", marketData: { fetchTimestamp: 1_000 } },
    ], 1_001);
    expect(tied.instrumentIndex).toBe(1);
  });

  it("rejects invalid scheduler timestamps and empty priority universes", () => {
    expect(() => selectPriorityScanBatch(0, [], [], 1)).toThrow(/universe/i);
    expect(() => selectPriorityScanBatch(0, [{ instrument: "BTC", priority: 1, refreshIntervalMs: 1 }], [], NaN)).toThrow(/timestamp/i);
  });

  it("refreshes the global ranking on bootstrap and at the bounded interval", () => {
    expect(shouldRefreshRadarRanking(1_000, 0, 0)).toBe(true);
    expect(shouldRefreshRadarRanking(1_000, 1_000, 1)).toBe(false);
    expect(shouldRefreshRadarRanking(
      1_000 + RADAR_RANKING_REFRESH_INTERVAL_MS - 1,
      1_000,
      1,
    )).toBe(false);
    expect(shouldRefreshRadarRanking(
      1_000 + RADAR_RANKING_REFRESH_INTERVAL_MS,
      1_000,
      1,
    )).toBe(true);
  });

  it("rejects invalid cursors and empty universes rather than silently restarting", () => {
    expect(() => selectBackgroundScanBatch(-1, 4)).toThrow(/cursor/i);
    expect(() => selectBackgroundScanBatch(0, 0)).toThrow(/universe/i);
  });
});
