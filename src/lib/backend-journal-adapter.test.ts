import { describe, expect, it } from "vitest";
import type { BackendJournalRecord } from "@/lib/backend-api";
import { backendJournalToEntry } from "./backend-journal-adapter";

function record(overrides: Partial<BackendJournalRecord> = {}): BackendJournalRecord {
  return {
    _id: "journal-1",
    _creationTime: 1_700_000_000_000,
    instrument: "BTC/USDT",
    instrumentType: "crypto",
    timeframe: "4h",
    style: "swing",
    analysisSnapshot: {
      analysisId: "analysis-1",
      decision: "BUY",
      bias: "BULLISH",
      confidence: 82,
      technicalSummary: "Higher highs",
      fundamentalSummary: "Positive liquidity conditions",
      dataCompleteness: "COMPLETE",
    },
    status: "PLANNED",
    timestamps: { createdAt: 1_700_000_000_000, updatedAt: 1_700_000_001_000 },
    ...overrides,
  };
}

describe("backend journal adapter", () => {
  it("maps persisted records into the existing journal domain model", () => {
    const entry = backendJournalToEntry(record({
      entry: 64000,
      stopLoss: 62500,
      takeProfit: 68000,
      riskReward: 2.67,
      outcome: "WIN",
      notes: "Wait for confirmation",
    }));

    expect(entry).toMatchObject({
      id: "journal-1",
      instrument: "BTC/USDT",
      status: "PLANNED",
      entry: 64000,
      stopLoss: 62500,
      takeProfit: 68000,
      riskReward: 2.67,
      outcome: "WIN",
      notes: "Wait for confirmation",
      analysisSnapshot: {
        analysisId: "analysis-1",
        decision: "BUY",
        bias: "BULLISH",
        confidence: 82,
      },
    });
    expect(entry.createdAt).toBe(1_700_000_000_000);
    expect(entry.updatedAt).toBe(1_700_000_001_000);
  });

  it("maps SQL nulls to absent optional domain fields", () => {
    const entry = backendJournalToEntry(record({
      entry: null,
      stopLoss: null,
      outcome: null,
      notes: null,
    }));

    expect(entry.entry).toBeUndefined();
    expect(entry.stopLoss).toBeUndefined();
    expect(entry.outcome).toBeUndefined();
    expect(entry.notes).toBeUndefined();
  });

  it("rejects an unknown lifecycle status rather than coercing it", () => {
    expect(() => backendJournalToEntry(record({ status: "ARCHIVED" })))
      .toThrow("Invalid backend journal status: ARCHIVED");
  });

  it("rejects incomplete immutable analysis snapshots", () => {
    expect(() => backendJournalToEntry(record({
      analysisSnapshot: { analysisId: "analysis-1", decision: "BUY" },
    }))).toThrow("Invalid backend journal snapshot: confidence must be a finite number");
  });
});
