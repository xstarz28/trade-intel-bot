/**
 * Phase 228 — `fromDbRecord` regression suite.
 *
 * The `analyses` table stores enum-like columns as loose strings. Before
 * Phase 228 the Dashboard read the row as `any`, so any drifted value flowed
 * straight into `AnalysisResult`. These tests pin the narrowing semantics.
 */
import { describe, it, expect } from "vitest";
import { fromDbRecord, type AnalysisRow } from "./from-db-record";

function row(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    _id: "an_1" as AnalysisRow["_id"],
    _creationTime: 1,
    userId: "u_1" as AnalysisRow["userId"],
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H1",
    bias: "Bullish",
    confidence: 70,
    technicalSummary: "t",
    fundamentalSummary: "f",
    breakdown: { trend: 1, indicator: 2, fundamental: 0, sentiment: -1 },
    keyLevels: { support: "1", resistance: "2", invalidation: "0.9" },
    riskNote: "r",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: 1_700_000_000_000,
    ...overrides,
  } as AnalysisRow;
}

describe("fromDbRecord (Phase 228)", () => {
  it("passes a well-formed row through unchanged", () => {
    const r = fromDbRecord(row({ recommendation: "LONG", conviction: "High", tradingStyle: "swing" }));
    expect(r.id).toBe("an_1");
    expect(r.instrumentType).toBe("forex");
    expect(r.timeframe).toBe("H1");
    expect(r.bias).toBe("Bullish");
    expect(r.recommendation).toBe("LONG");
    expect(r.conviction).toBe("High");
    expect(r.tradingStyle).toBe("swing");
    expect(r.dataCompleteness).toBe("full");
    expect(r.breakdown).toEqual({ trend: 1, indicator: 2, fundamental: 0, sentiment: -1 });
    expect(r.priceSnapshot).toBeUndefined();
    expect(r.sentimentData).toBeUndefined();
  });

  it("derives recommendation from bias only when the column is absent (legacy rows)", () => {
    expect(fromDbRecord(row({ bias: "Bullish" })).recommendation).toBe("LONG");
    expect(fromDbRecord(row({ bias: "Bearish" })).recommendation).toBe("SHORT");
    expect(fromDbRecord(row({ bias: "Neutral" })).recommendation).toBe("NO_TRADE");
  });

  it("maps an out-of-union stored recommendation to NO_TRADE, never a directional call", () => {
    expect(fromDbRecord(row({ bias: "Bullish", recommendation: "Long" })).recommendation).toBe("NO_TRADE");
    expect(fromDbRecord(row({ bias: "Bullish", recommendation: "BUY" })).recommendation).toBe("NO_TRADE");
  });

  it("maps an out-of-union bias to Neutral and does not upgrade it to a trade", () => {
    const r = fromDbRecord(row({ bias: "bullish" }));
    expect(r.bias).toBe("Neutral");
    expect(r.recommendation).toBe("NO_TRADE");
  });

  it("drops an unrecognised conviction and trading style falls back to intraday", () => {
    const r = fromDbRecord(row({ conviction: "Extreme", tradingStyle: "position" }));
    expect(r.conviction).toBeUndefined();
    expect(r.tradingStyle).toBe("intraday");
  });

  it("maps unknown dataCompleteness to partial (not full)", () => {
    expect(fromDbRecord(row({ dataCompleteness: "complete" })).dataCompleteness).toBe("partial");
    expect(fromDbRecord(row({ dataCompleteness: "limited" })).dataCompleteness).toBe("limited");
  });

  it("clamps out-of-range factor scores to 0 rather than passing arbitrary numbers", () => {
    const r = fromDbRecord(row({ breakdown: { trend: 7, indicator: -3, fundamental: 2, sentiment: 1.5 } }));
    expect(r.breakdown).toEqual({ trend: 0, indicator: 0, fundamental: 2, sentiment: 0 });
  });

  it("only builds a priceSnapshot when a stored price exists, using the row timestamp (no Date.now)", () => {
    const r = fromDbRecord(row({ price: 1.0842, dataSource: "twelvedata" }));
    expect(r.priceSnapshot).toEqual({ price: 1.0842, timestamp: 1_700_000_000_000, source: "twelvedata" });
    expect(r.dataSource).toBe("twelvedata");
    expect(fromDbRecord(row({ price: undefined })).priceSnapshot).toBeUndefined();
  });

  it("reconstructs summary-only intelligence blocks with empty detail arrays and the row timestamp", () => {
    const r = fromDbRecord(row({
      instrument: "BTC/USDT",
      sentimentSummary: "s",
      sentimentScore: 0.3,
      macroSummary: "m",
      derivativesSummary: "d",
      calendarSummary: "c",
    }));
    expect(r.sentimentData?.label).toBe("bullish");
    expect(r.sentimentData?.articles).toEqual([]);
    expect(r.sentimentData?.timestamp).toBe(1_700_000_000_000);
    expect(r.macroData?.summary).toBe("m");
    expect(r.derivativesData?.symbol).toBe("BTC/USDT");
    expect(r.derivativesData?.interpretation).toBe("d");
    expect(r.calendarData?.macroRisk.explanation).toBe("c");
    expect(r.calendarData?.events).toEqual([]);
  });

  it("labels sentiment neutral when no score is stored", () => {
    const r = fromDbRecord(row({ sentimentSummary: "s" }));
    expect(r.sentimentData?.averageScore).toBe(0);
    expect(r.sentimentData?.label).toBe("neutral");
  });
});
