import { describe, expect, it } from "vitest";
import {
  BACKGROUND_SCAN_TIMEFRAME_PASSES,
  RADAR_RANKING_REFRESH_INTERVAL_MS,
  selectBackgroundScanBatch,
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
