/**
 * Candle-aware market-data freshness.
 *
 * Provider OHLCV timestamps identify the candle OPEN, not the time the last
 * trade/quote was observed. Comparing every timeframe to a fixed 5m/1h clock
 * incorrectly marks an actively forming D1/W1 candle stale. Classify age
 * relative to the requested bar interval while retaining conservative
 * absolute stale cutoffs for closed markets and missing provider updates.
 */
export type MarketDataFreshness = "realtime" | "delayed" | "stale" | "unavailable";

const TIMEFRAME_MS: Record<string, number> = {
  M1: 60_000,
  M5: 5 * 60_000,
  M15: 15 * 60_000,
  H1: 60 * 60_000,
  H4: 4 * 60 * 60_000,
  D1: 24 * 60 * 60_000,
  W1: 7 * 24 * 60 * 60_000,
};

const STALE_LIMIT_MS: Record<string, number> = {
  M1: 24 * 60 * 60_000,
  M5: 24 * 60 * 60_000,
  M15: 24 * 60 * 60_000,
  H1: 48 * 60 * 60_000,
  H4: 4 * 24 * 60 * 60_000,
  D1: 4 * 24 * 60 * 60_000,
  W1: 14 * 24 * 60 * 60_000,
};

const TIMEFRAME_ALIASES: Record<string, string> = {
  "1M": "M1", "1MIN": "M1",
  "5M": "M5", "5MIN": "M5",
  "15M": "M15", "15MIN": "M15",
  "1H": "H1", "1HR": "H1",
  "4H": "H4", "4HR": "H4",
  "1D": "D1", "1DAY": "D1",
  "1W": "W1", "1WEEK": "W1",
};

export function classifyMarketDataFreshness(
  timestamp: number,
  now: number,
  timeframe: string,
): MarketDataFreshness {
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(now) || now < timestamp) {
    return "unavailable";
  }

  const normalized = timeframe.trim().toUpperCase().replace(/\s+/g, "");
  const canonical = TIMEFRAME_ALIASES[normalized] ?? normalized;
  const intervalMs = TIMEFRAME_MS[canonical];
  const ageMs = now - timestamp;

  // Unknown intervals cannot be granted a long timeframe-specific freshness
  // window. Keep a conservative generic fallback instead.
  if (!intervalMs) {
    if (ageMs < 5 * 60_000) return "realtime";
    if (ageMs < 60 * 60_000) return "delayed";
    return ageMs < 24 * 60 * 60_000 ? "stale" : "unavailable";
  }

  // Preserve the established short-timeframe clock: M1/M5/M15/H1 are
  // actionable only with genuinely recent observations. Higher timeframes
  // need candle-aware windows because their OHLCV timestamps mark bar OPEN.
  if (canonical === "M1" || canonical === "M5" || canonical === "M15" || canonical === "H1") {
    if (ageMs < 5 * 60_000) return "realtime";
    if (ageMs < 60 * 60_000) return "delayed";
  } else {
    if (ageMs < intervalMs) return "realtime";
    // W1 closes on a much slower cadence; once the last weekly bar is over a
    // week old, classify it stale rather than extending "delayed" for 14 days.
    if (canonical !== "W1" && ageMs < intervalMs * 2) return "delayed";
  }
  return ageMs < STALE_LIMIT_MS[canonical]! ? "stale" : "unavailable";
}
