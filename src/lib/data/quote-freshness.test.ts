import { describe, expect, it } from "vitest";
import { resolveQuoteObservation } from "./quote-freshness";

const NOW = Date.parse("2026-10-14T12:00:00.000Z");

describe("quote observation freshness", () => {
  it("marks a timestamped recent quote realtime", () => {
    const result = resolveQuoteObservation({
      quotePrice: 100,
      quoteDatetime: "2026-10-14T11:58:00.000Z",
      candleTimestamp: NOW - 15 * 60_000,
      now: NOW,
    });
    expect(result.hasLiveQuote).toBe(true);
    expect(result.dataFreshness).toBe("realtime");
    expect(result.priceTimestamp).toBe(NOW - 2 * 60_000);
  });

  it("does not treat a newly fetched but undated quote as realtime", () => {
    const candleTimestamp = NOW - 12 * 60_000;
    const result = resolveQuoteObservation({
      quotePrice: 100,
      candleTimestamp,
      now: NOW,
    });
    expect(result.hasLiveQuote).toBe(false);
    expect(result.dataFreshness).toBe("delayed");
    expect(result.priceTimestamp).toBe(candleTimestamp);
  });

  it("supports provider Unix timestamps in seconds and milliseconds", () => {
    const seconds = resolveQuoteObservation({
      quotePrice: 100,
      quoteTimestamp: NOW / 1000 - 60,
      candleTimestamp: NOW - 600_000,
      now: NOW,
    });
    const milliseconds = resolveQuoteObservation({
      quotePrice: 100,
      quoteTimestamp: NOW - 60_000,
      candleTimestamp: NOW - 600_000,
      now: NOW,
    });
    expect(seconds.dataFreshness).toBe("realtime");
    expect(milliseconds.dataFreshness).toBe("realtime");
    expect(seconds.priceTimestamp).toBe(NOW - 60_000);
  });

  it("uses candle observation time when quote price is invalid", () => {
    const candleTimestamp = NOW - 90 * 60_000;
    const result = resolveQuoteObservation({
      quotePrice: Number.NaN,
      quoteTimestamp: NOW - 30_000,
      candleTimestamp,
      now: NOW,
    });
    expect(result.hasLiveQuote).toBe(false);
    expect(result.priceTimestamp).toBe(candleTimestamp);
    expect(result.dataFreshness).toBe("stale");
  });

  it("does not treat a stale or implausibly future quote as realtime", () => {
    const stale = resolveQuoteObservation({
      quotePrice: 100,
      quoteTimestamp: NOW - 25 * 60 * 60_000,
      candleTimestamp: NOW - 25 * 60 * 60_000,
      now: NOW,
    });
    const future = resolveQuoteObservation({
      quotePrice: 100,
      quoteTimestamp: NOW + 5 * 60_000,
      candleTimestamp: NOW,
      now: NOW,
    });
    expect(stale.dataFreshness).toBe("unavailable");
    expect(stale.hasLiveQuote).toBe(false);
    expect(future.dataFreshness).toBe("unavailable");
    expect(future.hasLiveQuote).toBe(false);
  });
});
