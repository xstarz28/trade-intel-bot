import { describe, expect, it } from "vitest";
import type { JournalEntry } from "@/types/journal";
import { journalEntryToBackendCreate } from "./backend-journal-payload";

const entry: JournalEntry = {
  id: "local-only-id",
  createdAt: 1,
  updatedAt: 2,
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
    fundamentalSummary: "Liquidity improving",
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
  notes: "Wait for candle close",
};

describe("journalEntryToBackendCreate", () => {
  it("preserves the immutable analysis snapshot and user-entered trade data", () => {
    expect(journalEntryToBackendCreate(entry)).toEqual({
      instrument: "BTC/USDT",
      instrumentType: "crypto",
      timeframe: "4h",
      style: "swing",
      analysisSnapshot: entry.analysisSnapshot,
      status: "PLANNED",
      entry: 64000,
      stopLoss: 62500,
      takeProfit: 68000,
      riskReward: 2.67,
      positionSize: 0.2,
      notionalValue: 12800,
      entryReason: "Breakout retest",
      thesisAtEntry: "Trend continuation",
      notes: "Wait for candle close",
    });
  });

  it("never sends client-generated identity or timestamps to the backend", () => {
    const payload = journalEntryToBackendCreate(entry);
    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("_id");
    expect(payload).not.toHaveProperty("createdAt");
    expect(payload).not.toHaveProperty("updatedAt");
  });
});
