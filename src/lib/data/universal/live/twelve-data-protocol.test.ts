import { describe, expect, it } from "vitest";
import {
  classifyLiveFailure,
  formatLiveFailure,
  sanitizeFailureReason,
} from "./failure-class";
import {
  buildOkxCandlesUrl,
  buildTwelveDataQuoteUrl,
  buildTwelveDataTimeSeriesUrl,
  inspectTwelveDataBody,
  mapOkxBar,
  mapTwelveDataInterval,
  parseTwelveDataQuote,
  parseTwelveDataTimeSeries,
} from "./twelve-data-protocol";

describe("Twelve Data live protocol", () => {
  it("builds time_series URLs without credentials", () => {
    const url = buildTwelveDataTimeSeriesUrl("XAU/USD", "H1", 210);
    expect(url).toBe(
      "https://api.twelvedata.com/time_series?symbol=XAU%2FUSD&interval=1h&outputsize=210",
    );
    expect(url.toLowerCase()).not.toMatch(/apikey/);
    expect(buildTwelveDataQuoteUrl("EUR/USD")).not.toMatch(/apikey/i);
  });

  it("maps known intervals and lowercases unknown tokens instead of inventing a bar", () => {
    expect(mapTwelveDataInterval("H1")).toBe("1h");
    expect(mapTwelveDataInterval("1h")).toBe("1h");
    expect(mapTwelveDataInterval("D1")).toBe("1day");
  });

  it("classifies vendor {code} bodies as distinct failures", () => {
    expect(inspectTwelveDataBody({ code: 429, message: "credits" })?.failureClass).toBe(
      "RATE_LIMIT",
    );
    expect(inspectTwelveDataBody({ code: 401, message: "apikey" })?.failureClass).toBe(
      "PROVIDER_AUTH",
    );
    expect(inspectTwelveDataBody({ code: 404, message: "symbol not found" })?.failureClass).toBe(
      "SYMBOL_UNSUPPORTED",
    );
    expect(inspectTwelveDataBody({ values: [] })).toBeNull();
  });

  it("rejects empty and malformed series; sorts remaining candles oldest-first", () => {
    expect(parseTwelveDataTimeSeries({ values: [] }).ok).toBe(false);
    const newestFirst = {
      symbol: "XAU/USD",
      values: [
        { datetime: "2026-01-02T00:00:00Z", open: "2", high: "2", low: "2", close: "2", volume: "1" },
        { datetime: "2026-01-01T00:00:00Z", open: "1", high: "1", low: "1", close: "1", volume: "1" },
      ],
    };
    const parsed = parseTwelveDataTimeSeries(newestFirst);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.candles.map((c) => c.close)).toEqual([1, 2]);
      expect(parsed.symbol).toBe("XAU/USD");
    }
    const bad = parseTwelveDataTimeSeries({
      values: [{ datetime: "nope", open: "n/a", high: "n/a", low: "n/a", close: "n/a" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.failureClass).toBe("MALFORMED_RESPONSE");
  });

  it("parses a quote close without inventing a clock stamp", () => {
    const ok = parseTwelveDataQuote({ close: "1932.4", timestamp: 1_700_000_000 });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.quote.close).toBe(1932.4);
      expect(ok.quote.timestamp).toBe(1_700_000_000);
    }
    expect(parseTwelveDataQuote({ code: 429, message: "credits" }).ok).toBe(false);
  });
});

describe("OKX bar mapping", () => {
  it("does not default an unmapped timeframe", () => {
    expect(mapOkxBar("1h")).toBe("1H");
    expect(mapOkxBar("H1")).toBe("1H");
    expect(mapOkxBar("13min")).toBeUndefined();
    expect(buildOkxCandlesUrl("BTC-USDT", "13min", 100)).toBeUndefined();
    expect(buildOkxCandlesUrl("BTC-USDT-SWAP", "1h", 100)).toContain(
      "instId=BTC-USDT-SWAP",
    );
    expect(buildOkxCandlesUrl("BTC-USDT-SWAP", "1h", 100)).toContain("bar=1H");
  });
});

describe("failure class sanitization", () => {
  it("never echoes an API key or env var name", () => {
    const dirty =
      "https://api.twelvedata.com/time_series?apikey=super-secret-value&symbol=XAU/USD TWELVE_DATA_API_KEY";
    const clean = sanitizeFailureReason(dirty);
    expect(clean).not.toMatch(/super-secret-value/);
    expect(clean).not.toContain("TWELVE_DATA_API_KEY");
    expect(clean).toMatch(/apikey=redacted/);
    expect(formatLiveFailure("PROVIDER_AUTH", dirty)).toMatch(/^PROVIDER_AUTH:/);
    expect(formatLiveFailure("PROVIDER_AUTH", dirty)).not.toMatch(/super-secret/);
  });

  it("keeps quota, auth, unsupported, empty, malformed, and network distinct", () => {
    expect(classifyLiveFailure({ vendorCode: 429 })).toBe("RATE_LIMIT");
    expect(classifyLiveFailure({ vendorCode: 401 })).toBe("PROVIDER_AUTH");
    expect(classifyLiveFailure({ vendorCode: 404, message: "[404] symbol not found" })).toBe(
      "SYMBOL_UNSUPPORTED",
    );
    expect(classifyLiveFailure({ message: "no candle data returned" })).toBe("NO_LIVE_DATA");
    expect(classifyLiveFailure({ message: "provider returned no numerically valid candles" })).toBe(
      "MALFORMED_RESPONSE",
    );
    expect(classifyLiveFailure({ liveStatus: "NETWORK_UNAVAILABLE", message: "Network failure" })).toBe(
      "NETWORK_ERROR",
    );
    expect(classifyLiveFailure({ message: "unsupported bar/timeframe \"13min\"" })).toBe(
      "TIMEFRAME_UNAVAILABLE",
    );
  });
});
