import { describe, expect, it } from "vitest";
import { buildEquityFundamentalEvidence } from "./equity-evidence";

const now = Date.UTC(2026, 9, 16, 12, 0, 0);
const base = {
  provider: "Alpha Vantage",
  timestamp: now - 60_000,
  symbol: "AAPL",
  available: true,
  analystTargetPrice: 120,
  earningsPerShare: 4.2,
  profitMargin: 0.18,
};

describe("buildEquityFundamentalEvidence", () => {
  it("creates attributed directional evidence only for the exact fresh instrument", () => {
    const evidence = buildEquityFundamentalEvidence("AAPL", 100, base, now);
    expect(evidence).toHaveLength(1);
    expect(evidence.map((item) => item.category)).toEqual(["VALUATION"]);
    expect(evidence.every((item) => item.instrument === "AAPL" && item.assetClass === "equity")).toBe(true);
    expect(evidence.every((item) => item.quality === "VERIFIED" && item.freshness === "FRESH")).toBe(true);
    expect(evidence.every((item) => item.providerAvailable)).toBe(true);
  });

  it("rejects mismatched or missing symbols instead of borrowing another company's data", () => {
    expect(buildEquityFundamentalEvidence("MSFT", 100, base, now)).toEqual([]);
    expect(buildEquityFundamentalEvidence("AAPL", 100, { ...base, symbol: undefined }, now)).toEqual([]);
  });

  it("rejects unavailable, stale, future-dated, or unidentified provider observations", () => {
    expect(buildEquityFundamentalEvidence("AAPL", 100, { ...base, available: false }, now)).toEqual([]);
    expect(buildEquityFundamentalEvidence("AAPL", 100, { ...base, timestamp: now - 73 * 60 * 60 * 1000 }, now)).toEqual([]);
    expect(buildEquityFundamentalEvidence("AAPL", 100, { ...base, timestamp: now + 1000 }, now)).toEqual([]);
    expect(buildEquityFundamentalEvidence("AAPL", 100, { ...base, provider: " " }, now)).toEqual([]);
  });

  it("does not invent a directional valuation signal from missing prices or a near-equal target", () => {
    expect(buildEquityFundamentalEvidence("AAPL", undefined, base, now)).toEqual([]);
    expect(buildEquityFundamentalEvidence("AAPL", 100, { ...base, analystTargetPrice: 103 }, now)
      .some((item) => item.category === "VALUATION")).toBe(false);
  });

  it("marks observations within the allowed window as delayed rather than fresh", () => {
    const evidence = buildEquityFundamentalEvidence("AAPL", 100, {
      ...base,
      timestamp: now - 24 * 60 * 60 * 1000,
    }, now);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((item) => item.freshness === "DELAYED")).toBe(true);
  });
});
