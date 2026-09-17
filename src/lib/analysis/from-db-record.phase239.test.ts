/**
 * Phase 239 — the projection must refuse an unreadable row instead of
 * returning a value whose type lies about its shape.
 *
 * Proven crash before this (real tree, real `analyses.list`):
 *   · a row without `breakdown`  → `TypeError: …reading 'trend'` during the
 *     Dashboard's render, which the root boundary turned into a blank page;
 *   · a row without `keyLevels`  → the projection succeeded, and the consumer
 *     crashed later on `result.keyLevels.support`, one layer further from the
 *     cause than the row that caused it.
 *
 * The rule now: an uninterpretable row yields `null` and is dropped by the
 * caller, which records the drop. What must NOT happen — and is asserted
 * below — is inventing a value for a missing field. A zeroed support level is
 * a market claim, not a degradation.
 */
import { describe, expect, it } from "vitest";
import { fromDbRecord, uninterpretableRowReason } from "./from-db-record";
import type { AnalysisRow } from "./from-db-record";

const row = (overrides: Record<string, unknown> = {}) =>
  ({
    _id: "an_1",
    _creationTime: 1,
    userId: "u1",
    instrument: "EUR/USD",
    instrumentType: "forex",
    timeframe: "H1",
    bias: "Bullish",
    confidence: 72,
    recommendation: "LONG",
    conviction: "High",
    noTradeReasons: [],
    tradingStyle: "intraday",
    technicalSummary: "t",
    fundamentalSummary: "f",
    breakdown: { trend: 1, indicator: 2, fundamental: 0, sentiment: -1 },
    keyLevels: { support: "1.0800", resistance: "1.1000", invalidation: "1.0700" },
    riskNote: "r",
    dataCompleteness: "full",
    dataFlags: [],
    timestamp: 1_700_000_000_000,
    ...overrides,
  }) as unknown as AnalysisRow;

describe("239 — a row that cannot be interpreted is refused", () => {
  it("accepts a well-formed row", () => {
    expect(uninterpretableRowReason(row())).toBeNull();
    expect(fromDbRecord(row())).not.toBeNull();
  });

  it.each([
    ["breakdown missing", { breakdown: undefined }, "breakdown"],
    ["breakdown not an object", { breakdown: "1,2,3,4" }, "breakdown"],
    ["breakdown has a non-numeric member", { breakdown: { trend: "1", indicator: 2, fundamental: 0, sentiment: -1 } }, "breakdown"],
    ["breakdown has NaN", { breakdown: { trend: Number.NaN, indicator: 2, fundamental: 0, sentiment: -1 } }, "breakdown"],
    ["breakdown partial", { breakdown: { trend: 1, indicator: 2 } }, "breakdown"],
    ["keyLevels missing", { keyLevels: undefined }, "key levels"],
    ["keyLevels truncated", { keyLevels: { support: "1.08" } }, "key levels"],
    ["keyLevels numeric", { keyLevels: { support: 1, resistance: 2, invalidation: 3 } }, "key levels"],
  ])("refuses %s", (_label, overrides, expectedReason) => {
    const reason = uninterpretableRowReason(row(overrides));
    expect(reason).toContain(expectedReason);
    expect(fromDbRecord(row(overrides))).toBeNull();
  });

  it("refuses a null, undefined or non-object row", () => {
    expect(uninterpretableRowReason(null)).toBe("row is not an object");
    expect(fromDbRecord(null as unknown as AnalysisRow)).toBeNull();
    expect(fromDbRecord(undefined as unknown as AnalysisRow)).toBeNull();
    expect(fromDbRecord(42 as unknown as AnalysisRow)).toBeNull();
  });

  it("never substitutes a fabricated level for a missing one", () => {
    const missingLevels = row({ keyLevels: undefined });
    expect(fromDbRecord(missingLevels)).toBeNull();

    // The one way this could go wrong: returning a projection with
    // `support: "0"` would look like a real price level downstream.
    const projected = fromDbRecord(row());
    expect(projected?.keyLevels.support).toBe("1.0800");
    expect(projected?.keyLevels.support).not.toBe("0");
  });

  it("keeps the conservative enum mapping of Phase 228 intact", () => {
    const drifted = fromDbRecord(row({ bias: "Long", recommendation: "BUY", conviction: "certain" }));
    expect(drifted?.bias).toBe("Neutral");
    expect(drifted?.recommendation).toBe("NO_TRADE");
    expect(drifted?.conviction).toBeUndefined();
    expect(drifted?.dataCompleteness).toBe("full");
  });

  it("still derives the recommendation from bias for legacy rows without one", () => {
    expect(fromDbRecord(row({ recommendation: undefined, bias: "Bullish" }))?.recommendation).toBe("LONG");
    expect(fromDbRecord(row({ recommendation: undefined, bias: "Bearish" }))?.recommendation).toBe("SHORT");
  });
});
