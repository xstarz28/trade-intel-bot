/**
 * Deterministic acquisition rotation for the durable background scanner.
 * Each instrument receives two timeframe requests per visit. Three complete
 * universe passes cover every supported horizon family without burst-scanning
 * the entire universe in one provider-rate window.
 */
export const BACKGROUND_SCAN_TIMEFRAME_PASSES = [
  ["H1", "D1"],
  ["H4", "W1"],
  ["M5", "H1"],
] as const;

export function selectBackgroundScanBatch(cursor: number, universeSize: number): {
  instrumentIndex: number;
  timeframePass: number;
  timeframes: readonly string[];
  nextCursor: number;
} {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("background scan cursor must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(universeSize) || universeSize <= 0) {
    throw new Error("background scan universe must contain at least one instrument");
  }
  const instrumentIndex = cursor % universeSize;
  const timeframePass = Math.floor(cursor / universeSize) % BACKGROUND_SCAN_TIMEFRAME_PASSES.length;
  return {
    instrumentIndex,
    timeframePass,
    timeframes: BACKGROUND_SCAN_TIMEFRAME_PASSES[timeframePass]!,
    nextCursor: cursor + 1,
  };
}


export const RADAR_RANKING_REFRESH_INTERVAL_MS = 30 * 60_000;

/** Refresh full-universe ranking less often than the five-minute acquisition loop. */
export function shouldRefreshRadarRanking(
  now: number,
  lastRankedAt: number,
  candidateCacheVersion: number,
): boolean {
  return candidateCacheVersion < 1 ||
    now - lastRankedAt >= RADAR_RANKING_REFRESH_INTERVAL_MS;
}
