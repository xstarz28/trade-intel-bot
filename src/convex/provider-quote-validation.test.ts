import { describe, expect, it } from "vitest";
import { normalizeTwelveDataQuotePayload } from "./provider-quote-validation";

describe("normalizeTwelveDataQuotePayload", () => {
  it("accepts a finite positive close without inventing missing bid/ask", () => {
    expect(normalizeTwelveDataQuotePayload({ close: "123.45", timestamp: "1792663200" })).toEqual({
      success: true,
      price: 123.45,
      timestamp: 1_792_663_200_000,
    });
  });

  it("preserves actual positive bid/ask values when the spread is valid", () => {
    expect(normalizeTwelveDataQuotePayload({
      close: "123.45",
      timestamp: "1792663200",
      bid: "123.40",
      ask: "123.50",
    })).toEqual({
      success: true,
      price: 123.45,
      timestamp: 1_792_663_200_000,
      bid: 123.4,
      ask: 123.5,
    });
  });

  it.each(["123garbage", "", "Infinity", "NaN", "0", "-1"])(
    "rejects invalid close value %s",
    (close) => {
      expect(normalizeTwelveDataQuotePayload({ close }).success).toBe(false);
    },
  );

  it("omits invalid or crossed bid/ask values instead of fabricating a spread", () => {
    expect(normalizeTwelveDataQuotePayload({
      close: "100",
      timestamp: "1792663200",
      bid: "101",
      ask: "99",
    })).toEqual({ success: true, price: 100, timestamp: 1_792_663_200_000 });

    expect(normalizeTwelveDataQuotePayload({
      close: "100",
      timestamp: "1792663200",
      bid: "-1",
      ask: "Infinity",
    })).toEqual({ success: true, price: 100, timestamp: 1_792_663_200_000 });
  });

  it("rejects quotes without a trustworthy provider timestamp", () => {
    expect(normalizeTwelveDataQuotePayload({ close: "100" })).toEqual({
      success: false,
      error: "TwelveData returned an invalid quote timestamp",
    });
  });

  it("surfaces provider-declared errors as unavailable data", () => {
    expect(normalizeTwelveDataQuotePayload({
      code: 429,
      message: "rate limit",
      close: "100",
    })).toEqual({
      success: false,
      error: "TwelveData [429]: rate limit",
    });
  });
});
