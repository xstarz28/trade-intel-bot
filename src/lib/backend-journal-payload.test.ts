import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@/types/journal";
import { journalEntryToBackendCreate } from "./backend-journal-payload";

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: "local-journal-id",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_001_000,
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
    entry: 64000,
    stopLoss: 62500,
    takeProfit: 68000,
    riskReward: 2.67,
    positionSize: 0.2,
    notionalValue: 12800,
    entryReason: "Breakout retest",
    thesisAtEntry: "Trend continuation",
    notes: "Wait for confirmation",
    ...overrides,
  };
}

describe("journal create payload adapter", () => {
  it("preserves the analysis snapshot and user-entered trade fields", () => {
    const payload = journalEntryToBackendCreate(entry());

    expect(payload).toEqual({
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
      entry: 64000,
      stopLoss: 62500,
      takeProfit: 68000,
      riskReward: 2.67,
      positionSize: 0.2,
      notionalValue: 12800,
      entryReason: "Breakout retest",
      thesisAtEntry: "Trend continuation",
      notes: "Wait for confirmation",
    });
  });

  it("does not send client-owned identifiers or timestamps to the backend", () => {
    const payload = journalEntryToBackendCreate(entry());
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
    expect(payload).not.toHaveProperty("userId");
  });

  it("preserves absent optional fields instead of inventing defaults", () => {
    const payload = journalEntryToBackendCreate(entry({
      entry: undefined,
      stopLoss: undefined,
      takeProfit: undefined,
      positionSize: undefined,
      notes: undefined,
    }));
    expect(payload.entry).toBeUndefined();
    expect(payload.stopLoss).toBeUndefined();
    expect(payload.takeProfit).toBeUndefined();
    expect(payload.positionSize).toBeUndefined();
    expect(payload.notes).toBeUndefined();
  });
});
