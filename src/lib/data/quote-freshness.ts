export type QuoteDataFreshness = "realtime" | "delayed" | "stale" | "unavailable";

export interface QuoteObservationInput {
  quotePrice: number;
  quoteTimestamp?: number | string | null;
  quoteDatetime?: string | null;
  candleTimestamp: number;
  now?: number;
}

export interface QuoteObservation {
  priceTimestamp: number;
  hasLiveQuote: boolean;
  dataFreshness: QuoteDataFreshness;
}

/**
 * Resolves provider observation time separately from request/fetch time.
 * Missing quote timestamps fall back to candle time and never become realtime.
 */
export function resolveQuoteObservation(input: QuoteObservationInput): QuoteObservation {
  const now = input.now ?? Date.now();
  const numericTimestamp = Number(input.quoteTimestamp);
  const parsedDatetime = input.quoteDatetime ? Date.parse(input.quoteDatetime) : Number.NaN;
  const providerTimestamp =
    Number.isFinite(numericTimestamp) && numericTimestamp > 0
      ? numericTimestamp < 1_000_000_000_000 ? numericTimestamp * 1000 : numericTimestamp
      : Number.isFinite(parsedDatetime) && parsedDatetime > 0
        ? parsedDatetime
        : undefined;
  const quoteHasPrice = Number.isFinite(input.quotePrice) && input.quotePrice > 0;
  const quoteAgeMs = providerTimestamp === undefined ? Number.POSITIVE_INFINITY : now - providerTimestamp;
  const quoteTimestampPlausible = providerTimestamp !== undefined && quoteAgeMs >= -60_000;
  // Only a timestamped quote observed within five minutes is used as the
  // current price. Older quote snapshots must not override a newer candle.
  const hasLiveQuote = quoteHasPrice && quoteTimestampPlausible && quoteAgeMs >= -60_000 && quoteAgeMs < 5 * 60_000;
  const priceTimestamp = hasLiveQuote ? providerTimestamp! : input.candleTimestamp;
  const ageMs = now - input.candleTimestamp;
  const candlePlausible = Number.isFinite(input.candleTimestamp) && input.candleTimestamp > 0 && ageMs >= -60_000;
  const dataFreshness: QuoteDataFreshness = hasLiveQuote
    ? "realtime"
    : !candlePlausible || ageMs >= 24 * 60 * 60_000
      ? "unavailable"
      : ageMs >= 60 * 60_000
        ? "stale"
        : "delayed";
  return { priceTimestamp, hasLiveQuote, dataFreshness };
}
