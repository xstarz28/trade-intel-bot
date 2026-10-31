import type { OhlcvCandle } from "@/lib/data/market-types";
import type { InstrumentType } from "@/types/analysis";
import {
  parseYahooFinanceCandles,
  resolveYahooFinanceMarketCandidates,
} from "@/lib/data/providers/yahoo-finance";
import type { HistoricalSpotDatasetLike } from "./walk-forward-evaluation";

export type YahooHistoricalInterval = "1h" | "1d" | "1w";

export interface HistoricalYahooRequest {
  /** Canonical Trade Intel instrument, e.g. EUR/USD, AAPL, XAU/USD. */
  symbol: string;
  instrumentType: Extract<InstrumentType, "forex" | "stock" | "commodity">;
  interval: YahooHistoricalInterval;
  /** Inclusive candle-open timestamp bounds, Unix milliseconds. */
  startTime: number;
  endTime: number;
}

export interface HistoricalYahooDependencies {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

const INTERVAL_MS: Record<YahooHistoricalInterval, number> = {
  "1h": 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

function validateRequest(request: HistoricalYahooRequest): void {
  if (!request.symbol.trim()) throw new Error("A canonical instrument symbol is required.");
  if (!["forex", "stock", "commodity"].includes(request.instrumentType)) {
    throw new Error("Yahoo historical evaluation supports only explicit forex, stock, or commodity instruments.");
  }
  if (!Object.prototype.hasOwnProperty.call(INTERVAL_MS, request.interval)) {
    throw new Error("Yahoo historical evaluation supports only 1h, 1d, and 1w intervals.");
  }
  if (!Number.isSafeInteger(request.startTime) || !Number.isSafeInteger(request.endTime) ||
      request.startTime < 0 || request.endTime <= request.startTime) {
    throw new Error("startTime/endTime must be valid Unix milliseconds with endTime > startTime.");
  }
}

function findSessionBreaks(candles: OhlcvCandle[], intervalMs: number) {
  const breaks: Array<{ missingBars: number; expectedTimestamp: number; nextObservedTimestamp: number }> = [];
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1].timestamp;
    const next = candles[index].timestamp;
    const delta = next - previous;
    if (delta <= 0) throw new Error("Yahoo historical candles are duplicate or non-ascending.");
    // A provider-session gap is preserved as metadata. It is not filled and
    // cannot be classified as a holiday versus an omitted session without a
    // verified exchange calendar.
    if (delta > intervalMs * 1.5) {
      breaks.push({
        missingBars: Math.max(1, Math.floor(delta / intervalMs) - 1),
        expectedTimestamp: previous + intervalMs,
        nextObservedTimestamp: next,
      });
    }
  }
  return breaks;
}

function sessionCalendarLabel(instrumentType: HistoricalYahooRequest["instrumentType"]): string {
  if (instrumentType === "stock") return "EXCHANGE_SESSION_UNVERIFIED";
  if (instrumentType === "forex") return "OTC_FX_SESSION_UNVERIFIED";
  return "COMMODITY_SESSION_UNVERIFIED";
}

/**
 * Fetches closed Yahoo Finance historical candles for supported non-crypto
 * instruments. The canonical instrument and provider-native ticker are both
 * retained. Session breaks are explicit; no bars or volume are synthesized.
 *
 * This adapter is research infrastructure, not an executable price feed.
 */
export async function fetchHistoricalYahooFinanceOhlcv(
  request: HistoricalYahooRequest,
  dependencies: HistoricalYahooDependencies = {},
): Promise<HistoricalSpotDatasetLike> {
  validateRequest(request);
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const now = dependencies.now ?? Date.now;
  const intervalMs = INTERVAL_MS[request.interval];
  const candidates = resolveYahooFinanceMarketCandidates(request.instrumentType, request.symbol);
  if (candidates.length === 0) {
    throw new Error(`No exact Yahoo Finance historical symbol or explicitly labeled equivalent exists for ${request.instrumentType} ${request.symbol}.`);
  }

  const errors: string[] = [];
  for (const candidate of candidates) {
    try {
      const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(candidate.symbol)}`);
      url.searchParams.set("period1", String(Math.floor(request.startTime / 1000)));
      // Yahoo period2 is exclusive; include the requested final candle interval.
      url.searchParams.set("period2", String(Math.ceil((request.endTime + intervalMs) / 1000)));
      const yahooInterval = request.interval === "1h" ? "60m" : request.interval === "1w" ? "1wk" : "1d";
      url.searchParams.set("interval", yahooInterval);
      url.searchParams.set("events", "div,splits");

      const response = await fetchImpl(url.toString(), {
        headers: {
          accept: "application/json",
          "user-agent": "Mozilla/5.0 (compatible; TradeIntelHistoricalResearch/1.0)",
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        const failure = new Error(`Yahoo Finance historical request failed with HTTP ${response.status} for ${candidate.symbol}.`);
        if (response.status === 418 || response.status === 429) throw failure;
        throw failure;
      }

      const payload: unknown = await response.json();
      const requestedBars = Math.max(1, Math.ceil((request.endTime - request.startTime) / intervalMs) + 10);
      const parsed = parseYahooFinanceCandles(payload, requestedBars);
      const retrievedAt = now();
      const candles = parsed.filter((candle) =>
        candle.timestamp >= request.startTime &&
        candle.timestamp <= request.endTime &&
        candle.timestamp + intervalMs <= retrievedAt
      );
      if (candles.length === 0) {
        throw new Error(`Yahoo Finance returned no completed ${request.interval} candles in the requested range for ${candidate.symbol}.`);
      }
      for (let index = 1; index < candles.length; index += 1) {
        if (candles[index].timestamp <= candles[index - 1].timestamp) {
          throw new Error("Yahoo Finance historical candles are duplicate or non-ascending.");
        }
      }

      const gaps = findSessionBreaks(candles, intervalMs);
      const warnings: string[] = [
        `Yahoo Finance provider ticker: ${candidate.symbol}; ${candidate.label}.`,
        "Provider-session timestamps are preserved. No verified exchange/OTC session calendar was applied; breaks may represent weekends, holidays, or provider omissions.",
      ];
      if (candles.every((candle) => candle.volume === 0)) {
        warnings.push("Provider supplied no usable volume for this series; volume-based indicators and volume confirmation must remain unavailable.");
      }
      if (gaps.length > 0) {
        warnings.push(`${gaps.length} provider-session break(s) preserved without synthesizing missing candles.`);
      }
      if (candles[0].timestamp > request.startTime + intervalMs * 2) {
        warnings.push("Returned history starts after the requested range; provider listing history may be limited.");
      }
      if (candles[candles.length - 1].timestamp < request.endTime - intervalMs * 2) {
        warnings.push("Returned history ends before the requested range; verify provider coverage and closed-session timing.");
      }

      return {
        provider: "yahoo-finance-public",
        instrumentId: request.symbol,
        providerInstrumentId: candidate.symbol,
        instrumentType: request.instrumentType,
        timeframe: request.interval,
        timestampAlignment: "PROVIDER_SESSION",
        sessionCalendar: sessionCalendarLabel(request.instrumentType),
        requestedRange: { startTime: request.startTime, endTime: request.endTime },
        actualRange: {
          startTime: candles[0].timestamp,
          endTime: candles[candles.length - 1].timestamp,
        },
        retrievedAt,
        candleCount: candles.length,
        candles,
        gaps,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HTTP (418|429)/.test(message)) throw error;
      errors.push(`${candidate.symbol}: ${message}`);
    }
  }

  throw new Error("All Yahoo Finance historical candidates failed: " + errors.join("; "));
}
