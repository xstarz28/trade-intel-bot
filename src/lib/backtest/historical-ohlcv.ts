import type { OhlcvCandle } from "@/lib/data/market-types";

/**
 * Reproducible historical spot OHLCV ingestion from Binance's public REST API.
 *
 * Scope: Binance spot markets only; this is not futures, funding, borrow, or
 * exchange-wide market coverage. No credentials are required.
 * API reference: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data
 * Binance documents request weights and rate limits separately; callers should
 * cache returned datasets and avoid running overlapping bulk downloads.
 */
export type BinanceSpotInterval =
  | "1m" | "3m" | "5m" | "15m" | "30m"
  | "1h" | "2h" | "4h" | "6h" | "8h" | "12h"
  | "1d" | "3d" | "1w";

const INTERVAL_MS: Record<BinanceSpotInterval, number> = {
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
};

export interface HistoricalOhlcvRequest {
  /** Binance spot symbol, e.g. BTCUSDT. */
  symbol: string;
  interval: BinanceSpotInterval;
  /** Inclusive candle-open timestamp bounds, in Unix milliseconds. */
  startTime: number;
  endTime: number;
}

export interface HistoricalOhlcvGap {
  /** Open timestamp for a candle expected from the selected interval. */
  expectedTimestamp: number;
  /** Open timestamp of the next candle actually returned. */
  nextObservedTimestamp: number;
  missingBars: number;
}

export interface HistoricalOhlcvDataset {
  provider: "binance-spot";
  instrumentId: string;
  timeframe: BinanceSpotInterval;
  requestedRange: { startTime: number; endTime: number };
  actualRange: { startTime: number; endTime: number } | null;
  retrievedAt: number;
  candleCount: number;
  candles: OhlcvCandle[];
  gaps: HistoricalOhlcvGap[];
  warnings: string[];
}

export interface HistoricalOhlcvDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Public market-data mirrors used when a host is geo-restricted or unavailable. */
  baseUrls?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateRequest(request: HistoricalOhlcvRequest): void {
  if (!/^[A-Z0-9]{5,24}$/.test(request.symbol)) {
    throw new Error("symbol must be an uppercase Binance spot symbol, e.g. BTCUSDT.");
  }
  if (!Object.prototype.hasOwnProperty.call(INTERVAL_MS, request.interval)) {
    throw new Error("Unsupported Binance spot interval.");
  }
  if (!Number.isSafeInteger(request.startTime) || !Number.isSafeInteger(request.endTime) ||
      request.startTime < 0 || request.endTime <= request.startTime) {
    throw new Error("startTime/endTime must be valid Unix milliseconds with endTime > startTime.");
  }
}

function isAlignedOpenTime(timestamp: number, interval: BinanceSpotInterval): boolean {
  if (interval === "1w") {
    const date = new Date(timestamp);
    return date.getUTCDay() === 1 &&
      date.getUTCHours() === 0 &&
      date.getUTCMinutes() === 0 &&
      date.getUTCSeconds() === 0 &&
      date.getUTCMilliseconds() === 0;
  }
  return timestamp % INTERVAL_MS[interval] === 0;
}

function parseKline(row: unknown, index: number, interval: BinanceSpotInterval): { candle: OhlcvCandle; closeTime: number } {
  if (!Array.isArray(row) || row.length < 12) {
    throw new Error(`Binance returned malformed kline row at index ${index}.`);
  }
  const values = [row[0], row[1], row[2], row[3], row[4], row[5], row[6]];
  const timestamp = Number(values[0]);
  const open = Number(values[1]);
  const high = Number(values[2]);
  const low = Number(values[3]);
  const close = Number(values[4]);
  const volume = Number(values[5]);
  const closeTime = Number(values[6]);
  if (![timestamp, open, high, low, close, volume, closeTime].every(Number.isFinite) ||
      !Number.isSafeInteger(timestamp) || !Number.isSafeInteger(closeTime) ||
      timestamp < 0 || closeTime < timestamp || open <= 0 || high <= 0 || low <= 0 ||
      close <= 0 || volume < 0 || high < Math.max(open, close, low) ||
      low > Math.min(open, close, high) ||
      !isAlignedOpenTime(timestamp, interval) ||
      closeTime !== timestamp + INTERVAL_MS[interval] - 1) {
    throw new Error(`Binance returned invalid OHLCV values at row ${index}.`);
  }
  return { candle: { timestamp, open, high, low, close, volume }, closeTime };
}

function findGaps(candles: OhlcvCandle[], intervalMs: number): HistoricalOhlcvGap[] {
  const gaps: HistoricalOhlcvGap[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const delta = candles[i].timestamp - candles[i - 1].timestamp;
    if (delta > intervalMs && delta % intervalMs === 0) {
      gaps.push({
        expectedTimestamp: candles[i - 1].timestamp + intervalMs,
        nextObservedTimestamp: candles[i].timestamp,
        missingBars: delta / intervalMs - 1,
      });
    } else if (delta !== intervalMs) {
      gaps.push({
        expectedTimestamp: candles[i - 1].timestamp + intervalMs,
        nextObservedTimestamp: candles[i].timestamp,
        missingBars: 0,
      });
    }
  }
  return gaps;
}

/**
 * Downloads closed candles in sequential pages of at most 1000 rows.
 * Data is returned with provenance and explicit gaps; missing bars are never
 * synthesized. The supplied endTime is an inclusive candle-open bound.
 */
export async function fetchHistoricalBinanceSpotOhlcv(
  request: HistoricalOhlcvRequest,
  dependencies: HistoricalOhlcvDependencies = {},
): Promise<HistoricalOhlcvDataset> {
  validateRequest(request);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const intervalMs = INTERVAL_MS[request.interval];
  const candles: OhlcvCandle[] = [];
  let cursor = request.startTime;
  let pageIndex = 0;

  while (cursor <= request.endTime) {
    const baseUrls = dependencies.baseUrls ?? [
      "https://api.binance.com",
      "https://data-api.binance.vision",
      "https://api1.binance.com",
      "https://api2.binance.com",
    ];
    let response: Response | undefined;
    let lastFailure: Error | undefined;
    for (const baseUrl of baseUrls) {
      const url = new URL("/api/v3/klines", baseUrl);
      url.searchParams.set("symbol", request.symbol);
      url.searchParams.set("interval", request.interval);
      url.searchParams.set("startTime", String(cursor));
      url.searchParams.set("endTime", String(request.endTime));
      url.searchParams.set("limit", "1000");
      try {
        const candidate = await fetchImpl(url.toString(), { headers: { Accept: "application/json" } });
        if (candidate.ok) {
          response = candidate;
          break;
        }
        lastFailure = new Error(`Binance historical OHLCV request failed with HTTP ${candidate.status}.`);
        // Rate-limit responses must not be amplified by trying more hosts.
        if (candidate.status === 418 || candidate.status === 429) throw lastFailure;
        // Some regions block api.binance.com (HTTP 451). Retry public market-data mirrors.
        if (candidate.status < 500 && candidate.status !== 403 && candidate.status !== 451) throw lastFailure;
      } catch (error) {
        if (error instanceof Error && /HTTP (418|429|400|401|404)/.test(error.message)) throw error;
        lastFailure = error instanceof Error ? error : new Error("Binance public market-data host request failed.");
      }
    }
    if (!response) throw lastFailure ?? new Error("No Binance public market-data host was available.");
    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      const message = isRecord(payload) && typeof payload.msg === "string" ? payload.msg : "Unexpected response.";
      throw new Error(`Binance historical OHLCV response was not a kline array: ${message}`);
    }
    if (payload.length === 0) break;

    let lastOpenTime = -1;
    for (const row of payload) {
      const parsed = parseKline(row, candles.length, request.interval);
      const { candle, closeTime } = parsed;
      if (candle.timestamp <= lastOpenTime) {
        throw new Error("Binance returned duplicate or non-ascending candle timestamps.");
      }
      lastOpenTime = candle.timestamp;
      if (candle.timestamp < request.startTime || candle.timestamp > request.endTime) continue;
      // Never include an unfinished candle: backtests must use completed bars only.
      if (closeTime >= now()) continue;
      candles.push(candle);
    }

    const lastRow = payload[payload.length - 1] as unknown[];
    const lastTimestamp = Number(lastRow[0]);
    if (!Number.isFinite(lastTimestamp) || lastTimestamp < cursor) {
      throw new Error("Binance pagination did not advance.");
    }
    if (payload.length < 1000 || lastTimestamp >= request.endTime) break;
    const nextCursor = lastTimestamp + intervalMs;
    if (nextCursor <= cursor) throw new Error("Binance pagination cursor did not advance.");
    cursor = nextCursor;
    pageIndex += 1;
    if (pageIndex > 10_000) throw new Error("Historical OHLCV request exceeded the safe page limit.");
  }

  for (let i = 1; i < candles.length; i += 1) {
    if (candles[i].timestamp <= candles[i - 1].timestamp) {
      throw new Error("Historical OHLCV candles are not strictly ascending and unique.");
    }
  }

  const gaps = findGaps(candles, intervalMs);
  const warnings: string[] = [];
  if (candles.length === 0) warnings.push("No completed candles were returned for the requested range.");
  if (gaps.length > 0) warnings.push(`${gaps.length} candle gap(s) or interval-alignment issue(s) detected; missing bars were not synthesized.`);
  if (candles.length > 0 && candles[0].timestamp > request.startTime + intervalMs) {
    warnings.push("Returned history starts after the requested start; check provider listing history and range alignment.");
  }
  if (candles.length > 0 && candles[candles.length - 1].timestamp < request.endTime - intervalMs) {
    warnings.push("Returned history ends before the requested end; check symbol availability, range, and provider coverage.");
  }
  const retrievedNow = now();
  if (
    request.endTime >= retrievedNow - intervalMs * 2 &&
    candles.length > 0 &&
    candles[candles.length - 1].timestamp < retrievedNow - intervalMs * 2
  ) {
    warnings.push("Provider history appears stale relative to the requested near-current range; verify provider freshness before treating this dataset as current.");
  }

  return {
    provider: "binance-spot",
    instrumentId: request.symbol,
    timeframe: request.interval,
    requestedRange: { startTime: request.startTime, endTime: request.endTime },
    actualRange: candles.length
      ? { startTime: candles[0].timestamp, endTime: candles[candles.length - 1].timestamp }
      : null,
    retrievedAt: now(),
    candleCount: candles.length,
    candles,
    gaps,
    warnings,
  };
}
