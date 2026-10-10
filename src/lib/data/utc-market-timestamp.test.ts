import { describe, expect, it } from "vitest";
import { parseMarketDataTimestamp } from "./utc-market-timestamp";

describe("parseMarketDataTimestamp", () => {
  it("parses timezone-free intraday provider times as UTC", () => {
    expect(parseMarketDataTimestamp("2026-10-10 05:36:42"))
      .toBe(Date.parse("2026-10-10T05:36:42Z"));
  });

  it("preserves an explicit timezone offset from the provider", () => {
    expect(parseMarketDataTimestamp("2026-10-10 10:00:00+05:00"))
      .toBe(Date.parse("2026-10-10T05:00:00Z"));
  });

  it("parses daily candle dates at UTC midnight", () => {
    expect(parseMarketDataTimestamp("2026-10-10"))
      .toBe(Date.parse("2026-10-10T00:00:00Z"));
  });

  it("does not hide malformed provider timestamps", () => {
    expect(parseMarketDataTimestamp("not-a-time")).toBeNaN();
  });
});
