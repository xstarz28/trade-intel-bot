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
  const priceTimestamp = providerTimestamp ?? input.candleTimestamp;
  const ageMs = now - priceTimestamp;
  const plausible = Number.isFinite(priceTimestamp) && priceTimestamp > 0 && ageMs >= -60_000;
  const quoteHasPrice = Number.isFinite(input.quotePrice) && input.quotePrice > 0;
  const hasLiveQuote = quoteHasPrice && providerTimestamp !== undefined &&
    plausible && ageMs < 5 * 60_000;
  const dataFreshness: QuoteDataFreshness = !plausible || ageMs >= 24 * 60 * 60_000
    ? "unavailable"
    : hasLiveQuote
      ? "realtime"
      : ageMs >= 60 * 60_000
        ? "stale"
        : "delayed";
  return { priceTimestamp, hasLiveQuote, dataFreshness };
}
