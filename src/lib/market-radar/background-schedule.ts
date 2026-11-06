/**
 * Deterministic acquisition rotation for the durable background scanner.
 * M5 is refreshed on every instrument visit to keep short-horizon setups
 * actionable; the second slot rotates through H1/H4/D1/W1 for higher horizons.
 */
export const BACKGROUND_SCAN_TIMEFRAME_PASSES = [
  ["M5", "H1"],
  ["M5", "H4"],
  ["M5", "D1"],
  ["M5", "W1"],
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


export interface BackgroundScanUniverseEntry {
  instrument: string;
  priority: number;
  refreshIntervalMs: number;
}
export interface BackgroundScanSource {
  instrument: string;
  marketData?: { fetchTimestamp?: number };
}

/**
 * Select the most overdue instrument instead of blindly walking the universe.
 * Per-instrument refresh targets now influence acquisition order; priority is
 * a deterministic tie-breaker, and cursor rotation prevents fixed-order bias.
 */
export function selectPriorityScanBatch(
  cursor: number,
  universe: readonly BackgroundScanUniverseEntry[],
  sources: readonly BackgroundScanSource[],
  now: number,
): {
  instrumentIndex: number;
  timeframePass: number;
  timeframes: readonly string[];
  nextCursor: number;
  overdueByMs: number;
} {
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new Error("background scan cursor must be a non-negative safe integer");
  }
  if (universe.length === 0) {
    throw new Error("background scan universe must contain at least one instrument");
  }
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("background scan timestamp must be a non-negative finite number");
  }

  const lastScanned = new Map<string, number>();
  for (const source of sources) {
    const timestamp = source.marketData?.fetchTimestamp;
    if (Number.isFinite(timestamp) && (timestamp ?? 0) > 0) {
      const key = source.instrument.toUpperCase();
      lastScanned.set(key, Math.max(lastScanned.get(key) ?? 0, timestamp!));
    }
  }

  const rotation = cursor % universe.length;
  const candidates = universe.map((entry, index) => {
    const last = lastScanned.get(entry.instrument.toUpperCase()) ?? 0;
    const interval = Number.isFinite(entry.refreshIntervalMs) && entry.refreshIntervalMs > 0
      ? entry.refreshIntervalMs
      : 60_000;
    const overdueByMs = last === 0 ? Number.POSITIVE_INFINITY : now - last - interval;
    const rotationDistance = (index - rotation + universe.length) % universe.length;
    return { index, last, overdueByMs, priority: entry.priority, rotationDistance };
  });

  candidates.sort((a, b) =>
    Number(b.overdueByMs === Number.POSITIVE_INFINITY) - Number(a.overdueByMs === Number.POSITIVE_INFINITY) ||
    b.overdueByMs - a.overdueByMs ||
    a.priority - b.priority ||
    a.rotationDistance - b.rotationDistance,
  );
  const selected = candidates[0]!;
  const timeframePass = Math.floor(cursor / universe.length) % BACKGROUND_SCAN_TIMEFRAME_PASSES.length;
  return {
    instrumentIndex: selected.index,
    timeframePass,
    timeframes: BACKGROUND_SCAN_TIMEFRAME_PASSES[timeframePass]!,
    nextCursor: cursor + 1,
    overdueByMs: Number.isFinite(selected.overdueByMs) ? Math.max(0, selected.overdueByMs) : 0,
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
